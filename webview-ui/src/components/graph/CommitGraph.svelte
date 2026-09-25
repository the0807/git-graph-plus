<script lang="ts">
  import { onMount } from 'svelte';
  import { commitStore } from '../../lib/stores/commits.svelte';
  import { branchStore } from '../../lib/stores/branches.svelte';
  import { uiStore } from '../../lib/stores/ui.svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { t } from '../../lib/i18n/index.svelte';
  import { avatarStore } from '../../lib/stores/avatars.svelte';
  import { requestDirtyState } from '../../lib/utils/dirty-check';
  import { resolveGraphColor } from '../../lib/utils/graph-color';
  import { graphColorsStore } from '../../lib/stores/graph-colors.svelte';
  import ContextMenu from '../common/ContextMenu.svelte';
  import InteractiveRebase from '../rebase/InteractiveRebase.svelte';
  import PullAfterCheckoutModal from '../modals/PullAfterCheckoutModal.svelte';
  import FastForwardModal from '../modals/FastForwardModal.svelte';
  import WorktreeBlockedModal from '../modals/WorktreeBlockedModal.svelte';
  import RebaseBranchModal from '../modals/RebaseBranchModal.svelte';
  import CherryPickModal from '../modals/CherryPickModal.svelte';
  import RevertModal from '../modals/RevertModal.svelte';
  import AutosquashCommitModal from '../modals/AutosquashCommitModal.svelte';
  import ResetModal from '../modals/ResetModal.svelte';
  import CheckoutCommitModal from '../modals/CheckoutCommitModal.svelte';
  import SquashModal from '../modals/SquashModal.svelte';
  import MultiCherryPickModal from '../modals/MultiCherryPickModal.svelte';
  import { modalStore } from '../../lib/stores/modals.svelte';
  import type { Commit, CommitGraphData, GraphStyle } from '../../lib/types';
  import { tooltip } from '../../lib/actions/tooltip';
  import { getSquashChain } from '../../lib/utils/squash';
  import { chainBranches } from '../../lib/utils/branchChain';
  import RebaseTargetModal from '../modals/RebaseTargetModal.svelte';
  import DirtyActionModal from '../modals/DirtyActionModal.svelte';
  import type { DirtyPayload } from '../../lib/utils/dirty-payload';
  import { resolveDrop } from '../../lib/utils/dragDrop';
  import { computeNavigationTarget, computeScrollTop, computeJumpTarget, isRowOffscreen, type ScrollAlign } from '../../lib/graph-navigation';
  import LinkifiedText from '../common/LinkifiedText.svelte';
  import { dispatchInteractiveRebase } from '../../lib/interactive-rebase';


  /**
   * Build SVG path `d` string from SourceGit Path points.
   * Rounded (default) exactly mirrors SourceGit's DrawCurves rendering (Q/C
   * beziers); angular draws straight lines with right-angled elbows.
   */
  function buildPathD(points: Array<{ x: number; y: number }>, style: GraphStyle): string {
    if (points.length < 2) return '';

    const parts: string[] = [];
    let last = { x: laneX(points[0].x), y: points[0].y * ROW_HEIGHT };
    parts.push(`M ${last.x} ${last.y}`);

    for (let i = 1; i < points.length; i++) {
      const cur = { x: laneX(points[i].x), y: points[i].y * ROW_HEIGHT };

      if (style === 'angular') {
        if (cur.x !== last.x) {
          // Elbow: horizontal to the target lane, then vertical to the row.
          parts.push(`L ${cur.x} ${last.y} L ${cur.x} ${cur.y}`);
        } else {
          // Same X: straight line
          parts.push(`L ${cur.x} ${cur.y}`);
        }
      } else if (cur.x > last.x) {
        // Going right: QuadraticBezier with control at (cur.x, last.y)
        parts.push(`Q ${cur.x} ${last.y}, ${cur.x} ${cur.y}`);
      } else if (cur.x < last.x) {
        if (i < points.length - 1) {
          // Middle: CubicBezier S-curve
          const midY = (last.y + cur.y) / 2;
          parts.push(`C ${last.x} ${midY + 4}, ${cur.x} ${midY - 4}, ${cur.x} ${cur.y}`);
        } else {
          // Last: QuadraticBezier with control at (last.x, cur.y)
          parts.push(`Q ${last.x} ${cur.y}, ${cur.x} ${cur.y}`);
        }
      } else {
        // Same X: straight line
        parts.push(`L ${cur.x} ${cur.y}`);
      }

      last = cur;
    }

    return parts.join(' ');
  }

  interface Props {
    searchMatchedHashes?: Set<string> | null;
    searchNavigateHash?: string | null;
    bisectActive?: boolean;
    bisectCulpritHash?: string | null;
    remoteFilter?: string[];
    headJumpNonce?: number;
    onHeadOffscreenChange?: (offscreen: boolean) => void;
  }

  let { searchMatchedHashes = null, searchNavigateHash = null, bisectActive = false, bisectCulpritHash = null, remoteFilter = [], headJumpNonce = 0, onHeadOffscreenChange = () => {} }: Props = $props();

  const vscode = getVsCodeApi();

  let contextMenu = $state<{ x: number; y: number; items: any[] } | null>(null);
  let contextMenuHash = $state<string | null>(null);
  let dragSourceBranch = $state<string | null>(null);
  let dragOverBranch = $state<string | null>(null);
  const worktreeBranches = $derived(new Set(branchStore.worktrees.filter(w => !w.isMain).map(w => w.branch)));

  // Maps for O(1) local branch lookup (replaces repeated branches.find())
  const localBranchMap = $derived(new Map(branchStore.branches.filter(b => !b.remote).map(b => [b.name, b])));
  const upstreamBranchMap = $derived(new Map(branchStore.branches.filter(b => !b.remote && b.upstream).map(b => [b.upstream!, b])));

  // Cache key fingerprint avoids rerunning BFS when commits array is recreated
  // but logically identical (e.g., file watcher refresh while only the synthesized
  // "Uncommitted changes" virtual node body changes — first/last hash, length, and
  // branch sync state stay stable).
  type BranchSets = {
    currentBranchCommits: Set<string>;
    currentBranchLocalOnly: Set<string>;
    currentBranchRemoteAhead: Set<string>;
  };
  let branchSetsCache: { fp: string; value: BranchSets } | null = null;

  // Single pass: build hashIndex once, run all BFS traversals together
  const branchSets = $derived.by<BranchSets>(() => {
    const commits = commitStore.commits;
    const empty: BranchSets = { currentBranchCommits: new Set(), currentBranchLocalOnly: new Set(), currentBranchRemoteAhead: new Set() };
    if (commits.length === 0) return empty;

    const current = branchStore.currentBranch;
    const fp = `${commits.length}|${commits[0].hash}|${commits[commits.length - 1].hash}|${current?.name ?? ''}|${current?.upstream ?? ''}|${current?.ahead ?? 0}|${current?.behind ?? 0}`;
    if (branchSetsCache && branchSetsCache.fp === fp) return branchSetsCache.value;

    const hashIndex = new Map<string, number>();
    for (let i = 0; i < commits.length; i++) hashIndex.set(commits[i].hash, i);

    // BFS 1: all commits reachable from HEAD
    const currentBranchCommits = new Set<string>();
    const headCommit = commits.find(c => c.refs.some(r => r.type === 'head'));
    if (headCommit) {
      const queue: string[] = [headCommit.hash];
      let head = 0;
      while (head < queue.length) {
        const hash = queue[head++];
        if (currentBranchCommits.has(hash)) continue;
        currentBranchCommits.add(hash);
        const idx = hashIndex.get(hash);
        if (idx === undefined) continue;
        for (const parent of commits[idx].parents) {
          if (!currentBranchCommits.has(parent)) queue.push(parent);
        }
      }
    }

    const currentBranchLocalOnly = new Set<string>();
    const currentBranchRemoteAhead = new Set<string>();

    if (current?.upstream) {
      const [remote, ...rest] = current.upstream.split('/');
      const remoteBranchName = rest.join('/');
      const remoteTipCommit = commits.find(c => c.refs.some(r => r.type === 'remote-branch' && r.remote === remote && r.name === remoteBranchName));

      if (remoteTipCommit) {
        // BFS 2: commits reachable from upstream tip
        const upstreamReachable = new Set<string>();
        if (current.ahead > 0) {
          const queue: string[] = [remoteTipCommit.hash];
          let head = 0;
          while (head < queue.length) {
            const hash = queue[head++];
            if (upstreamReachable.has(hash)) continue;
            upstreamReachable.add(hash);
            const idx = hashIndex.get(hash);
            if (idx === undefined) continue;
            for (const parent of commits[idx].parents) {
              if (!upstreamReachable.has(parent)) queue.push(parent);
            }
          }
          for (const hash of currentBranchCommits) {
            if (!upstreamReachable.has(hash)) currentBranchLocalOnly.add(hash);
          }
        }

        // BFS 3: commits reachable from upstream tip but not on current branch
        if (current.behind > 0) {
          const queue: string[] = [remoteTipCommit.hash];
          let head = 0;
          while (head < queue.length) {
            const hash = queue[head++];
            if (currentBranchRemoteAhead.has(hash) || currentBranchCommits.has(hash)) continue;
            currentBranchRemoteAhead.add(hash);
            const idx = hashIndex.get(hash);
            if (idx === undefined) continue;
            for (const parent of commits[idx].parents) {
              if (!currentBranchRemoteAhead.has(parent) && !currentBranchCommits.has(parent)) {
                queue.push(parent);
              }
            }
          }
        }
      }
    }

    const value: BranchSets = { currentBranchCommits, currentBranchLocalOnly, currentBranchRemoteAhead };
    branchSetsCache = { fp, value };
    return value;
  });

  const currentBranchCommits = $derived(branchSets.currentBranchCommits);
  const currentBranchLocalOnly = $derived(branchSets.currentBranchLocalOnly);
  const currentBranchRemoteAhead = $derived(branchSets.currentBranchRemoteAhead);

  let bisectBadCommit = $state<string | null>(null);
  let bisectStartBad = $state<string | null>(null);
  let bisectStartGood = $state<string | null>(null);

  $effect(() => {
    if (!bisectActive) {
      bisectBadCommit = null;
      bisectStartBad = null;
      bisectStartGood = null;
    }
  });
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  let interactiveRebaseBase = $state<string | null>(null);
  // Mirror the locally-rendered interactive rebase overlay into modalStore so
  // anyOpen sees it — otherwise the graph's ↑/↓ nav keeps scrolling underneath.
  $effect(() => {
    if (interactiveRebaseBase) { modalStore.openInteractiveRebase(); }
    else { modalStore.closeInteractiveRebase(); }
  });
  let showResetModal = $state(false);
  let resetTarget = $state('');
  let resetMode = $state<'soft' | 'mixed' | 'hard'>('mixed');

  // Confirmation modals
  let showRebaseModal = $state(false);
  let rebaseTarget = $state('');

  let showCherryPickModal = $state(false);
  let cherryPickTarget = $state('');

  let showRevertModal = $state(false);
  let revertTarget = $state('');

  // Single target for the shared fixup/squash modal; null when closed.
  let autosquashTarget = $state<{ hash: string; subject: string; mode: 'fixup' | 'squash' } | null>(null);

  // Squash selected commits: the validated chain (oldest→newest) when open.
  let squashChain = $state<Commit[] | null>(null);
  // Multi cherry-pick: the selected hashes (oldest→newest) when the modal is open.
  let multiCherryPickTargets = $state<string[] | null>(null);

  // Interactive-rebase-from-selection state.
  // rebaseTargetBranches: candidates for the branch+dirty modal (branch pick needed).
  // rebaseDirtyBranch: target branch when only dirty handling is needed (current-branch path).
  // pendingRebaseBase: rebase base held across the checkout round-trip until the editor opens.
  let rebaseTargetBranches = $state<string[] | null>(null);
  let rebaseDirtyBranch = $state<string | null>(null);
  let pendingRebaseBase = $state<string | null>(null);
  let showCheckoutCommitModal = $state(false);
  let checkoutCommitHash = $state('');

  function openCheckoutCommitModal(hash: string) {
    checkoutCommitHash = hash;
    showCheckoutCommitModal = true;
  }

  let showPullAfterCheckoutModal = $state(false);
  let pullAfterCheckoutRef = $state('');
  let pullAfterCheckoutBehind = $state(0);

  let showFastForwardModal = $state(false);
  let fastForwardLocalBranch = $state('');
  let fastForwardRemote = $state('');

  let pendingCheckoutPullAfter = $state(false);
  let pendingCheckoutDirtyPayload: Record<string, boolean> = {};

  let showWorktreeBlockedModal = $state(false);
  let worktreeBlockedRef = $state('');
  let worktreeBlockedPath = $state('');
  let worktreeBlockedAbsPath = $state('');

  // Keep the right-clicked commit outlined while a follow-up modal opened from
  // its context menu is showing, then drop the outline once every modal closes.
  // Covers both modalStore-managed modals (rendered in App.svelte, so they can't
  // clear contextMenuHash themselves) and the modals rendered locally below.
  // interactiveRebaseBase is only mirrored into modalStore via an $effect (runs
  // after the synchronous menu onClose), so it must be ORed in directly here.
  const anyModalOpen = $derived(
    modalStore.anyOpen
    || showResetModal || showRebaseModal || showCherryPickModal || showRevertModal || !!autosquashTarget
    || showCheckoutCommitModal || showFastForwardModal || showPullAfterCheckoutModal || showWorktreeBlockedModal
    || !!squashChain || !!multiCherryPickTargets || !!interactiveRebaseBase
    || !!rebaseTargetBranches || !!rebaseDirtyBranch,
  );
  $effect(() => {
    if (!anyModalOpen) { contextMenuHash = null; }
  });

  function doCheckout(ref: string, pullAfter = false, dirtyPayload: Record<string, boolean> = {}, skipBehindCheck = false) {
    // Check if branch is used by a worktree
    const wt = branchStore.worktrees.find(w => !w.isMain && w.branch === ref);
    if (wt) {
      worktreeBlockedRef = ref;
      worktreeBlockedAbsPath = wt.path;
      worktreeBlockedPath = uiStore.homeDir && wt.path.startsWith(uiStore.homeDir) ? '~' + wt.path.substring(uiStore.homeDir.length) : wt.path;
      showWorktreeBlockedModal = true;
      return;
    }
    // Check if local branch is behind remote - offer fast-forward
    if (!skipBehindCheck) {
      const branch = localBranchMap.get(ref);
      if (branch?.behind && branch.behind > 0 && branch.upstream) {
        fastForwardLocalBranch = ref;
        fastForwardRemote = branch.upstream;
        pendingCheckoutDirtyPayload = dirtyPayload;
        showFastForwardModal = true;
        return;
      }
    }
    pendingCheckoutPullAfter = pullAfter;
    // If dirtyPayload already resolved (from commit modal), skip dirty check
    if (Object.keys(dirtyPayload).length > 0) {
      vscode.postMessage({ type: 'checkout', payload: { ref, pullAfter, ...dirtyPayload } });
      return;
    }
    // Check dirty first, then either checkout directly or show modal
    requestDirtyState().then(dirty => {
      if (dirty) {
        const branchCommit = commitStore.commits.find(c =>
          c.refs.some(r => r.name === ref && (r.type === 'branch' || r.type === 'head'))
        );
        openCheckoutCommitModal(branchCommit?.hash ?? ref);
      } else {
        vscode.postMessage({ type: 'checkout', payload: { ref, pullAfter } });
      }
    }).catch(() => {});
  }

  function doCheckoutRemote(remoteName: string, branchName: string, dirtyPayload: Record<string, boolean> = {}) {
    // Check if a local branch tracks this remote (upstream), or has the same name
    const localBranch = upstreamBranchMap.get(remoteName) ?? localBranchMap.get(branchName);
    if (localBranch) {
      doCheckout(localBranch.name, false, dirtyPayload);
    } else if (Object.keys(dirtyPayload).length > 0) {
      // Dirty already handled - skip dirty check in modal
      modalStore.openCheckoutRemote(remoteName, branchName, false, dirtyPayload);
    } else {
      // No local branch → check dirty, then show create modal
      requestDirtyState()
        .then(dirty => modalStore.openCheckoutRemote(remoteName, branchName, dirty))
        .catch(() => {});
    }
  }

  let isSearchActive = $derived(searchMatchedHashes !== null);

  let displayCommits = $derived(commitStore.commits);
  let displayPaths = $derived(commitStore.paths);
  let displayLinks = $derived(commitStore.links);
  let displayDots = $derived(commitStore.dots);
  let displayLeftMargin = $derived(commitStore.commitLeftMargin);


  const ROW_HEIGHT = 30;
  // Rows of breathing room kept between the selection and the viewport edge when
  // stepping with the arrow keys, so context above/below the selection stays visible.
  const KEYBOARD_NAV_SCROLL_MARGIN_ROWS = 3;
  // SourceGit uses unitWidth=12 for X coordinates, we scale them up for display
  const X_SCALE = 1.05; // multiply SourceGit X coords by this for pixel positions
  const BUFFER_ROWS = 20; // Larger buffer to keep lines visible during scroll

  let container: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  // Hovered row hash, so the row and its pinned meta overlay highlight as one row.
  let hoveredHash = $state<string | null>(null);
  let viewportHeight = $state(600);
  // Trail of commits visited during the current run of Ctrl/Cmd jumps, so reversing
  // a jump returns to where we came from. Cleared by any non-jump navigation.
  let navPath = $state<string[]>([]);
  let viewportWidth = $state(800);

  // Right-side columns (author + sha + date) and the minimum width we always
  // reserve for the commit message. These mirror the fixed column widths in the
  // CSS below.
  const RIGHT_COLS_WIDTH = 120 + 75 + 150;
  const MIN_MESSAGE_WIDTH = 120;

  // In huge repos (e.g. nixpkgs) hundreds of concurrent branches make the graph
  // grow wider than the whole viewport, which would push the commit message off
  // screen and break column alignment. Cap the graph at whatever space is left
  // after the message + right columns; lanes beyond the cap are clipped.
  let maxGraphWidth = $derived(
    Math.max(120, viewportWidth - RIGHT_COLS_WIDTH - MIN_MESSAGE_WIDTH)
  );

  // Bring a row into view when it is off-screen. 'edge' (keyboard stepping)
  // scrolls the minimum amount so the view follows the selection one row at a
  // time; 'center' (search) centers a distant result.
  function scrollHashIntoView(hash: string, align: ScrollAlign) {
    if (!container) return;
    const idx = displayCommits.findIndex(c => c.hash === hash);
    if (idx === -1) return;
    // Keep a few rows of breathing room around the selection when stepping.
    const marginRows = align === 'edge' ? KEYBOARD_NAV_SCROLL_MARGIN_ROWS : 0;
    const next = computeScrollTop(idx, ROW_HEIGHT, container.scrollTop, viewportHeight, align, marginRows);
    if (next !== null) container.scrollTop = next;
  }

  // Scroll to search result when navigating
  $effect(() => {
    if (searchNavigateHash && container) {
      navPath = [];
      scrollHashIntoView(searchNavigateHash, 'center');
    }
  });

  // HEAD's row index, recomputed only when the commit set or HEAD changes - not
  // on every scroll - so the offscreen check below stays O(1) per scroll frame
  // instead of re-scanning displayCommits each time scrollTop updates.
  const headRowIndex = $derived.by(() => {
    const headHash = commitStore.headHash;
    return headHash ? displayCommits.findIndex(c => c.hash === headHash) : -1;
  });

  // Tell the toolbar's "jump to HEAD" button whether HEAD is currently off-screen,
  // so it emphasizes itself only when scrolling is actually needed. Recomputed on
  // scroll (scrollTop), resize (viewportHeight) and data changes (headRowIndex).
  // Guarded so we only notify the parent when the boolean actually flips.
  let lastHeadOffscreen: boolean | null = null;
  $effect(() => {
    const offscreen = isRowOffscreen(headRowIndex, ROW_HEIGHT, scrollTop, viewportHeight);
    if (offscreen !== lastHeadOffscreen) {
      lastHeadOffscreen = offscreen;
      onHeadOffscreenChange(offscreen);
    }
  });

  // Scroll HEAD into view (centered) when the toolbar button is clicked. The nonce
  // (not the hash) drives this so repeated clicks re-scroll even when HEAD hasn't
  // changed. The initial value (0) is skipped so opening the graph never jumps.
  let lastHeadJumpNonce = 0;
  $effect(() => {
    if (headJumpNonce !== lastHeadJumpNonce) {
      lastHeadJumpNonce = headJumpNonce;
      const headHash = commitStore.headHash;
      if (headHash) scrollHashIntoView(headHash, 'center');
    }
  });

  // A reload or repo switch replaces the commit set; drop the jump path so it can't
  // reference commits that are no longer present.
  $effect(() => {
    commitStore.commits;
    uiStore.activeRepo;
    navPath = [];
  });

  // Clearing the selection (e.g. Esc deselects the commit and closes the bottom
  // panel) ends the current jump exploration, so drop the path too.
  $effect(() => {
    if (uiStore.selectedCommitHash === null) navPath = [];
  });

  let totalHeight = $derived(displayCommits.length * ROW_HEIGHT);

  // Full lane span, ignoring the clip cap. Used to decide whether the graph has
  // grown wide enough to switch from clipping to horizontal scrolling.
  let naturalGraphWidth = $derived.by(() => {
    if (displayLeftMargin.length === 0) return 30;
    let maxMargin = 0;
    for (const m of displayLeftMargin) if (m > maxMargin) maxMargin = m;
    return Math.ceil(maxMargin * X_SCALE) + 4;
  });

  // Switch to horizontal scrolling only once the graph is wide enough that the
  // message would otherwise be squeezed below its minimum (i.e. exactly when we'd
  // have started clipping lanes). Below that the graph fits with a usable message
  // column, so normal mode is kept — avoids a premature scrollbar and empty space
  // on the right when the content is narrower than the viewport.
  let horizontalScroll = $derived(naturalGraphWidth > maxGraphWidth);

  // The graph always renders at its full natural width. In normal mode that fits
  // (we only switch to scroll mode once it would exceed maxGraphWidth), so the graph
  // looks identical either way — only the message column and scrolling differ.
  let graphWidth = $derived(naturalGraphWidth);

  // Explicit row/header width in scroll mode so the container shows a horizontal
  // scrollbar. Never narrower than the viewport, so rows always fill the width and
  // the pinned meta stays flush right. 0 means "let the normal flex/100% layout decide".
  let contentWidth = $derived(
    horizontalScroll ? Math.max(graphWidth + MIN_MESSAGE_WIDTH + RIGHT_COLS_WIDTH, viewportWidth) : 0
  );

  let startIndex = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS));
  let endIndex = $derived(
    Math.min(
      displayCommits.length,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER_ROWS
    )
  );

  let visibleCommits = $derived(
    displayCommits.slice(startIndex, endIndex).map((commit, i) => ({
      commit,
      index: startIndex + i,
    }))
  );

  // Precompute path Y-bounds once per paths change so scroll-time filtering is O(1) per path
  // instead of iterating each path's points on every scroll event.
  let pathBounds = $derived.by(() => {
    const bounds: Array<{ minY: number; maxY: number }> = new Array(displayPaths.length);
    for (let i = 0; i < displayPaths.length; i++) {
      const points = displayPaths[i].points;
      let minY = Infinity, maxY = -Infinity;
      for (let j = 0; j < points.length; j++) {
        const y = points[j].y;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      bounds[i] = { minY, maxY };
    }
    return bounds;
  });

  // Path geometry never changes, only which paths are on screen does. Precompute the
  // SVG "d" string once per path (on data change) so scrolling never rebuilds them.
  let pathDs = $derived(displayPaths.map(p => buildPathD(p.points, uiStore.graphStyle)));

  let visiblePaths = $derived.by(() => {
    const out: Array<{ color: number; colorOverride?: string; d: string }> = [];
    for (let i = 0; i < displayPaths.length; i++) {
      const b = pathBounds[i];
      if (b.maxY >= startIndex && b.minY <= endIndex) {
        out.push({ color: displayPaths[i].color, colorOverride: displayPaths[i].colorOverride, d: pathDs[i] });
      }
    }
    return out;
  });
  let visibleLinks = $derived(displayLinks.filter(link => {
    const sy = link.start.y, ey = link.end.y;
    const minY = sy < ey ? sy : ey;
    const maxY = sy > ey ? sy : ey;
    return maxY >= startIndex && minY <= endIndex;
  }));
  // Dots are pushed 1:1 in commit order by the graph builder (dot[i].center.y === i + 0.5),
  // so slicing by [startIndex, endIndex) is equivalent to the previous y-range filter.
  let visibleDots = $derived(displayDots.slice(startIndex, endIndex));

  function laneX(col: number): number {
    return col * X_SCALE;
  }

  // Coalesce scroll events into one update per animation frame. High-refresh
  // displays fire scroll 100+ times/sec; without this every event synchronously
  // pushed a new scrollTop, re-running the headOffscreen effect and the visible
  // path/link filters (which scan the full arrays) far more often than the
  // screen can repaint.
  let scrollRaf: number | null = null;
  function handleScroll() {
    if (scrollRaf !== null) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      if (!container) return;
      const st = container.scrollTop;
      const verticalChanged = st !== scrollTop;
      scrollTop = st;
      // Auto-pan horizontally only when the vertical position actually moved, so
      // the user can still scroll horizontally on their own between vertical
      // scrolls.
      if (horizontalScroll && verticalChanged) autoPanHorizontal();
    });
  }

  // In horizontal-scroll mode, keep the message start (the graph's right edge) of the
  // commit at the vertical centre of the viewport aligned to ~1/4 from the left, so
  // the graph sits in the left quarter and the message gets the right three-quarters.
  // Margins are interpolated between adjacent rows so the pan follows smoothly.
  function autoPanHorizontal() {
    if (!container) return;
    const centerY = scrollTop + viewportHeight / 2;
    const f = centerY / ROW_HEIGHT - 0.5; // fractional row index (row i centred at i+0.5)
    const last = displayCommits.length - 1;
    if (last < 0) return;
    const i0 = Math.max(0, Math.min(last, Math.floor(f)));
    const i1 = Math.min(last, i0 + 1);
    const t = Math.max(0, Math.min(1, f - i0));
    const m0 = displayLeftMargin[i0] ?? 0;
    const m1 = displayLeftMargin[i1] ?? 0;
    const messageStartX = (m0 + (m1 - m0) * t) * X_SCALE + 4;
    const maxLeft = Math.max(0, contentWidth - viewportWidth);
    const target = Math.max(0, Math.min(messageStartX - viewportWidth / 4, maxLeft));
    if (Math.abs(container.scrollLeft - target) > 0.5) container.scrollLeft = target;
  }

  function handleResize() {
    if (container) {
      viewportHeight = container.clientHeight;
      viewportWidth = container.clientWidth;
    }
  }

  // Row click / double-click behaviour, shared by the commit rows and the pinned
  // meta overlay so clicking the author/date area behaves the same as the row.
  function handleRowClick(commit: typeof displayCommits[0], e?: MouseEvent) {
    if (bisectBadCommit && bisectBadCommit !== commit.hash) {
      const bad = bisectBadCommit;
      bisectBadCommit = null;
      bisectStartBad = bad;
      bisectStartGood = commit.hash;
      vscode.postMessage({ type: 'bisectStart', payload: { bad, good: commit.hash } });
      return;
    }
    // The uncommitted-changes row opens VS Code's Source Control view
    // (where the user stages/commits) instead of the in-graph detail panel.
    if (commit.hash === 'UNCOMMITTED') {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      uiStore.selectedCommitHash = null;
      vscode.postMessage({ type: 'openScmView' });
      return;
    }

    // In multi-select mode, only modifier clicks change the set. Shift extends
    // the range, Ctrl/Cmd toggles membership. A plain click falls through to the
    // debounced single-select below, which exits the mode and selects just this row.
    if (uiStore.multiSelectArmed && e && e.shiftKey) {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      uiStore.selectRange(commit.hash, displayCommits.map(c => c.hash));
      return;
    }
    if (uiStore.multiSelectArmed && e && (e.ctrlKey || e.metaKey)) {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      uiStore.toggleHash(commit.hash);
      return;
    }
    // Not armed: Ctrl/Cmd or Shift click promotes to multi-select directly.
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      uiStore.modifierSelect(commit.hash, { range: e.shiftKey, orderedHashes: displayCommits.map(c => c.hash), fallbackAnchor: commitStore.headHash });
      return;
    }
    // Plain click single-selects (debounced).
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
    clickTimer = setTimeout(() => { clickTimer = null; selectCommit(commit.hash); }, 150);
  }

  // Derive the hovered row from the pointer's Y position over the whole scroll
  // surface. One coordinate-based handler covers the rows and the pinned meta
  // overlay alike, so they always resolve to the same row with no cross-element
  // enter/leave flicker.
  function handleRowHover(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const idx = Math.floor((e.clientY - rect.top) / ROW_HEIGHT);
    hoveredHash = idx >= 0 && idx < displayCommits.length ? displayCommits[idx].hash : null;
  }

  function handleRowDblClick(commit: typeof displayCommits[0]) {
    if (commit.hash === 'UNCOMMITTED') return;
    // In selection / compare mode a double-click is just two membership toggles —
    // never a checkout.
    if (uiStore.multiSelectArmed || uiStore.comparing) return;
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    const localRefs = commit.refs.filter(r => r.type === 'head' || r.type === 'branch');
    if (localRefs.length === 1) {
      doCheckout(localRefs[0].name, false, {}, true);
    } else if (localRefs.length > 1) {
      openCheckoutCommitModal(commit.hash);
    } else {
      const remoteRef = commit.refs.find(r => r.type === 'remote-branch' && r.name !== 'HEAD');
      if (remoteRef) {
        doCheckoutRemote(`${remoteRef.remote}/${remoteRef.name}`, remoteRef.name);
      } else {
        openCheckoutCommitModal(commit.hash);
      }
    }
  }

  function selectCommit(hash: string) {
    navPath = [];
    uiStore.selectSingle(hash);
  }

  function onBranchDrop(e: DragEvent, targetBranch: string) {
    e.preventDefault();
    const source = dragSourceBranch;
    dragSourceBranch = null;
    dragOverBranch = null;
    if (!source) return;
    const localNames = new Set(localBranchMap.keys());
    const res = resolveDrop(source, targetBranch, localNames);
    if (res.kind === 'ignore') return;
    const hasUncommitted = commitStore.commits.some(c => c.hash === 'UNCOMMITTED');
    contextMenu = {
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: t('graph.dragRebaseOnto', { source: res.source, target: res.target }),
          action: () => { modalStore.runDrag('rebase', res.source, res.target, hasUncommitted); },
        },
        {
          label: t('graph.dragMergeInto', { source: res.source, target: res.target }),
          action: () => { modalStore.runDrag('merge', res.source, res.target, hasUncommitted); },
        },
        { separator: true, label: '', action: () => {} },
        { label: t('graph.cancelSelection'), action: () => {} },
      ],
    };
  }

  // Route an interactive-rebase request to the GUI modal or the classic
  // terminal flow, per the gitGraphPlus.interactiveRebase.mode setting.
  function openInteractiveRebase(base: string) {
    dispatchInteractiveRebase(base, uiStore.interactiveRebaseMode, {
      // GUI mode keeps the multi-selection armed while the modal is open (the
      // modal clears it on close, like squash/cherry-pick). Classic mode hands
      // off to the terminal with no modal, so clear the selection now.
      openModal: (b) => { interactiveRebaseBase = b; },
      runClassic: (b) => {
        vscode.postMessage({ type: 'runClassicRebase', payload: { base: b } });
        uiStore.exitMultiSelect();
      },
    });
  }

  // Entry for "Interactive Rebase selected commits". `chain` is oldest→newest
  // (getSquashChain); base = parent of the oldest selected commit.
  function startSelectionRebase(chain: Commit[], candidates: string[]) {
    const base = chain[0].parents[0];
    const current = branchStore.currentBranch?.name;
    if (candidates.length === 1 && candidates[0] === current) {
      // No branch switch needed. Clean → open the editor directly. Dirty → let the
      // user stash/keep/discard first (checkout to the current branch applies the
      // stash before a no-op switch).
      const hasUncommitted = commitStore.commits.some(c => c.hash === 'UNCOMMITTED');
      if (!hasUncommitted) {
        openInteractiveRebase(base);
        contextMenuHash = null;
      } else {
        pendingRebaseBase = base;
        rebaseDirtyBranch = current ?? null;
      }
    } else {
      pendingRebaseBase = base;
      rebaseTargetBranches = candidates;
    }
  }

  // After the target branch is checked out (with any stash), HEAD is the branch
  // tip; open the editor with the held base so getRebaseCommits(base)→base..HEAD
  // resolves correctly.
  onMount(() => {
    function handleCheckoutForRebase(event: MessageEvent) {
      const msg = event.data;
      if (!pendingRebaseBase) { return; }
      if (msg?.type === 'operationComplete' && msg.payload?.operation === 'checkout') {
        const resumeBase = pendingRebaseBase;
        pendingRebaseBase = null;
        openInteractiveRebase(resumeBase);
        contextMenuHash = null;
      } else if (msg?.type === 'error') {
        // Checkout failed — drop the pending rebase so a later unrelated checkout
        // does not wrongly reopen the editor.
        pendingRebaseBase = null;
        uiStore.exitMultiSelect();
        contextMenuHash = null;
      }
    }
    window.addEventListener('message', handleCheckoutForRebase);
    return () => {
      window.removeEventListener('message', handleCheckoutForRebase);
      if (scrollRaf !== null) cancelAnimationFrame(scrollRaf);
    };
  });

  function onCommitContextMenu(e: MouseEvent, commit: Commit) {
    e.preventDefault();
    contextMenuHash = commit.hash;
    // git reports non-branch HEAD states as parenthesized pseudo-labels
    // ("(no branch, rebasing main)", "(HEAD detached at …)"); none are real
    // branch names, so menu labels fall back to the short HEAD SHA.
    const head = branchStore.currentBranch;
    const currentBranch = head?.name?.startsWith('(')
      ? (head.hash?.slice(0, 7) || 'HEAD')
      : (head?.name ?? 'HEAD');

    // ── Dedicated multi-select menu ──
    // When 2+ commits are selected and the right-clicked commit is part of the
    // selection, show only actions that operate on the whole selection — not the
    // single-commit menu (whose entries would silently target just this commit).
    if (uiStore.multiSelectArmed
      && uiStore.selectedCommitHashes.length >= 2
      && uiStore.selectedCommitHashes.includes(commit.hash)) {
      const sel = uiStore.selectedCommitHashes;
      // Order the selection oldest→newest (display order is newest-first),
      // excluding the synthetic uncommitted-changes row.
      const orderedOldestFirst = displayCommits
        .filter(c => c.hash !== 'UNCOMMITTED' && sel.includes(c.hash))
        .map(c => c.hash)
        .reverse();
      const multiItems: any[] = [];

      // Toggle the bottom panel showing the comparison of the selected commits.
      multiItems.push({
        label: uiStore.showBottomPanel ? t('graph.hideChanges') : t('graph.viewChanges'),
        action: () => { uiStore.showBottomPanel = !uiStore.showBottomPanel; },
      });
      multiItems.push({ separator: true, label: '', action: () => {} });

      const chain = getSquashChain(sel, commitStore.commitMap as Map<string, Commit>);
      if (chain) {
        multiItems.push({
          label: t('graph.squashCommits', { count: String(chain.length) }),
          action: () => { squashChain = chain; },
        });
        const head = chain[chain.length - 1].hash;
        // BranchInfo.hash is the abbreviated object name; commitMap is keyed by
        // the full hash. Resolve each local branch tip to its full hash so the
        // first-parent walk can start, falling back to the abbreviated value
        // (no match) when the tip is outside the loaded commit range.
        const fullByAbbrev = new Map(commitStore.commits.map(c => [c.abbreviatedHash, c.hash]));
        const localBranchTips = branchStore.localBranches.map(b => ({
          name: b.name,
          hash: fullByAbbrev.get(b.hash) ?? b.hash,
        }));
        const candidates = chainBranches(
          head,
          commitStore.commitMap as Map<string, Commit>,
          localBranchTips,
        );
        if (candidates.length >= 1) {
          multiItems.push({
            label: t('graph.interactiveRebaseSelection', { count: String(chain.length) }),
            action: () => { startSelectionRebase(chain, candidates); },
          });
        }
      }
      multiItems.push({
        label: t('graph.cherryPickCommits', { count: String(sel.length) }),
        action: () => { multiCherryPickTargets = orderedOldestFirst; },
      });
      multiItems.push({ separator: true, label: '', action: () => {} });
      multiItems.push({
        label: t('graph.cancelSelection'),
        action: () => { uiStore.exitMultiSelect(); },
      });

      contextMenu = { x: e.clientX, y: e.clientY, items: multiItems };
      return;
    }

    const items: any[] = [];

    // ── Ref submenus ──
    const refs = commit.refs.filter(r => {
      if (r.type === 'remote-branch' && r.name === 'HEAD') return false;
      return true;
    }).sort((a, b) => {
      const order = { head: 0, branch: 1, 'remote-branch': 2, tag: 3, stash: 4, 'working-dir': 5 };
      const typeOrder = (order[a.type] ?? 4) - (order[b.type] ?? 4);
      if (typeOrder !== 0) return typeOrder;
      // Alphabetical within same type for branches, tags, worktrees
      const nameA = a.type === 'remote-branch' ? `${a.remote}/${a.name}` : a.name;
      const nameB = b.type === 'remote-branch' ? `${b.remote}/${b.name}` : b.name;
      return nameA.localeCompare(nameB);
    });

    for (const ref of refs) {
      if (ref.type === 'head' || ref.type === 'branch') {
        const branchName = ref.name;
        const linkedWt = branchStore.worktrees.find(w => !w.isMain && w.branch === branchName);

        if (linkedWt) {
          // Worktree-linked branch: show worktree menu
          items.push({
            label: branchName,
            icon: 'worktree',
            action: () => {},
            children: [
              {
                label: t('sidebar.checkout'),
                action: () => doCheckout(branchName),
              },
              ...(branchName !== currentBranch ? [{
                label: t('graph.mergeInto', { branch: currentBranch }),
                action: () => { modalStore.openMerge(branchName, branchStore.currentBranch?.name ?? 'current branch'); },
              }] : []),
              { separator: true, label: '', action: () => {} },
              {
                label: t('graph.rename'),
                action: () => { modalStore.openRenameBranch(branchName); },
              },
              {
                label: t('graph.removeWorktree'),
                action: () => { modalStore.openRemoveWorktree(linkedWt.path, branchName); },
                danger: true,
              },
              {
                label: t('graph.deleteBranch'),
                action: () => { modalStore.openDeleteBranch(branchName); },
                danger: true,
              },
              { separator: true, label: '', action: () => {} },
              {
                label: t('graph.copyBranchName'),
                action: () => vscode.postMessage({ type: 'copyToClipboard', payload: { text: branchName } }),
              },
            ],
          });
        } else {
          // Regular branch
          items.push({
            label: branchName,
            icon: 'git-branch',
            action: () => {},
            children: [
              {
                label: t('sidebar.checkout'),
                action: () => doCheckout(branchName),
              },
              {
                label: t('graph.createWorktree'),
                action: () => vscode.postMessage({ type: 'worktreeAddModalRequest', payload: { startPoint: branchName } }),
              },
              ...(branchName !== currentBranch ? [{
                label: t('graph.mergeInto', { branch: currentBranch }),
                action: () => { modalStore.openMerge(branchName, branchStore.currentBranch?.name ?? 'current branch'); },
              }] : []),
              {
                label: t('graph.setUpstream'),
                action: () => {
                  const branchInfo = localBranchMap.get(branchName);
                  modalStore.openSetUpstream(branchName, branchInfo?.upstream);
                },
              },
              { separator: true, label: '', action: () => {} },
              {
                label: t('graph.rename'),
                action: () => { modalStore.openRenameBranch(branchName); },
              },
              {
                label: t('graph.deleteBranch'),
                action: () => { modalStore.openDeleteBranch(branchName); },
                danger: true,
              },
              { separator: true, label: '', action: () => {} },
              {
                label: t('graph.copyBranchName'),
                action: () => vscode.postMessage({ type: 'copyToClipboard', payload: { text: branchName } }),
              },
            ],
          });
        }
      } else if (ref.type === 'remote-branch') {
        const fullName = `${ref.remote}/${ref.name}`;
        items.push({
          label: fullName,
          icon: 'cloud',
          action: () => {},
          children: [
            {
              label: t('sidebar.checkout'),
              action: () => doCheckoutRemote(fullName, ref.name),
            },
            {
              label: t('graph.mergeInto', { branch: currentBranch }),
              action: () => { modalStore.openMerge(fullName, branchStore.currentBranch?.name ?? 'current branch'); },
            },
            { separator: true, label: '', action: () => {} },
            {
              label: t('graph.deleteRemoteBranch'),
              action: () => { modalStore.openDeleteRemoteBranch(ref.remote!, ref.name); },
              danger: true,
            },
            { separator: true, label: '', action: () => {} },
            {
              label: t('graph.copyBranchName'),
              action: () => vscode.postMessage({ type: 'copyToClipboard', payload: { text: fullName } }),
            },
          ],
        });
      } else if (ref.type === 'tag') {
        const defaultRemote = branchStore.remotes[0]?.name ?? 'origin';
        items.push({
          label: ref.name,
          icon: 'tag',
          action: () => {},
          children: [
            {
              label: t('graph.showTagDetails', { tag: ref.name }),
              action: () => vscode.postMessage({ type: 'showTagDetails', payload: { name: ref.name } }),
            },
            {
              label: t('graph.mergeInto', { branch: currentBranch }),
              action: () => { modalStore.openMerge(ref.name, branchStore.currentBranch?.name ?? 'current branch'); },
            },
            {
              label: t('graph.pushTag', { tag: ref.name, remote: defaultRemote }),
              action: () => modalStore.openPushTag(ref.name, defaultRemote),
            },
            { separator: true, label: '', action: () => {} },
            {
              label: t('graph.deleteTag'),
              action: () => { modalStore.openDeleteTag(ref.name); },
              danger: true,
            },
            { separator: true, label: '', action: () => {} },
            {
              label: t('graph.copyTagName'),
              action: () => vscode.postMessage({ type: 'copyToClipboard', payload: { text: ref.name } }),
            },
          ],
        });
      } else if (ref.type === 'stash') {
        const stashIndex = parseInt(ref.name.match(/\{(\d+)\}/)?.[1] ?? '0', 10);
        const stashEntry = branchStore.stashes.find(s => s.index === stashIndex);
        items.push({
          label: ref.name,
          icon: 'archive',
          action: () => {},
          children: [
            {
              label: t('sidebar.apply'),
              action: () => modalStore.openStashApply(stashIndex, ref.name, false),
            },
            {
              label: t('sidebar.pop'),
              action: () => modalStore.openStashApply(stashIndex, ref.name, true),
            },
            { separator: true, label: '', action: () => {} },
            {
              label: t('sidebar.rename'),
              action: () => modalStore.openStashRename(stashIndex, stashEntry?.message ?? ''),
            },
            { separator: true, label: '', action: () => {} },
            {
              label: t('sidebar.drop'),
              action: () => vscode.postMessage({ type: 'stashDrop', payload: { index: stashIndex } }),
              danger: true,
            },
          ],
        });
      }
    }

    const isStashCommit = commit.refs.some(r => r.type === 'stash');
    const sep = { separator: true, label: '', action: () => {} };

    // Groups are collected separately, then joined with separators at the end.
    // Each non-empty group gets a separator before it (after the refs block).
    const groups: any[][] = [];

    if (!isStashCommit) {
      // ── Create ──
      const createGroup: any[] = [
        { label: t('graph.createBranchHere'), action: () => { modalStore.openCreateBranch(commit.hash, commit.subject); } },
        { label: t('graph.newTag'),           action: () => { modalStore.openCreateTag(commit.hash, commit.subject); } },
      ];
      const worktreeStartRef = commit.refs.find(r => r.type === 'head' || r.type === 'branch');
      if (worktreeStartRef) {
        createGroup.push({
          label: t('graph.createWorktree'),
          action: () => vscode.postMessage({ type: 'worktreeAddModalRequest', payload: { startPoint: worktreeStartRef.name } }),
        });
      }
      groups.push(createGroup);

      // ── Branch / tag operations (merge, rebase, interactive rebase) ──
      const branchOps: any[] = [];
      const hasBranchOrTag = commit.refs.some(r => r.type === 'head' || r.type === 'branch' || r.type === 'remote-branch' || r.type === 'tag');
      if (hasBranchOrTag) {
        const localRef  = commit.refs.find(r => r.type === 'head' || r.type === 'branch');
        const remoteRef = commit.refs.find(r => r.type === 'remote-branch');
        const tagRef    = commit.refs.find(r => r.type === 'tag');
        const mergeRef  = localRef?.name ?? (remoteRef ? `${remoteRef.remote}/${remoteRef.name}` : undefined) ?? tagRef?.name ?? commit.hash;
        if (mergeRef !== currentBranch) {
          branchOps.push({ label: t('graph.mergeInto', { branch: currentBranch }), action: () => { modalStore.openMerge(mergeRef, branchStore.currentBranch?.name ?? 'current branch'); } });
        }
      }
      const isOnCurrentBranch = currentBranchCommits.has(commit.hash);
      if (!isOnCurrentBranch) {
        branchOps.push({ label: t('graph.rebaseTo', { branch: currentBranch }), action: () => { rebaseTarget = commit.hash; showRebaseModal = true; } });
      }
      branchOps.push({ label: t('graph.interactiveRebaseTo', { branch: currentBranch }), action: () => { openInteractiveRebase(commit.hash); } });
      groups.push(branchOps);

      // ── Reset ──
      const isHead = commit.refs.some(r => r.type === 'head');
      if (!isHead) {
        groups.push([{ label: t('graph.resetBranchToHere', { branch: currentBranch }), action: () => { resetTarget = commit.hash; resetMode = 'mixed'; showResetModal = true; } }]);
      }

      // ── Modify commit with staged changes (amend / fixup) ──
      // Amend rewrites HEAD; fixup records a `fixup!` commit against any commit.
      // Both fold the currently-staged changes into an existing commit, so they
      // live together. Amend only applies to HEAD.
      const modifyOps: any[] = [];
      if (isHead) {
        const fullMessage = commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject;
        const cur = branchStore.currentBranch;
        const isPushed = !!cur?.upstream && !cur?.upstreamGone && (cur?.ahead ?? 0) === 0;
        modifyOps.push({
          label: t('graph.amendCommit'),
          action: () => {
            modalStore.openAmend({ hash: commit.hash, subject: commit.subject, message: fullMessage, isPushed });
            vscode.postMessage({ type: 'openScmView', payload: { returnFocus: true } });
          },
        });
      }
      // Open the SCM view so the user can stage changes before committing the
      // marker; the modal tracks the staged count live.
      const openAutosquash = (mode: 'fixup' | 'squash') => {
        autosquashTarget = { hash: commit.hash, subject: commit.subject, mode };
        vscode.postMessage({ type: 'openScmView', payload: { returnFocus: true } });
      };
      // fixup!/squash! markers are committed on top of HEAD and only fold into
      // their target via `rebase --autosquash`, which can only reach commits in
      // the current branch's history. A marker against a commit on an unrelated
      // branch could never be autosquashed, so only offer it for ancestors of HEAD.
      if (isOnCurrentBranch) {
        modifyOps.push({ label: t('graph.commitFixup'),  action: () => openAutosquash('fixup') });
        modifyOps.push({ label: t('graph.commitSquash'), action: () => openAutosquash('squash') });
      }
      if (modifyOps.length > 0) groups.push(modifyOps);

      // ── Commit operations ──
      groups.push([
        {
          label: t('graph.checkoutCommit'),
          action: () => {
            const localRefs = commit.refs.filter(r => r.type === 'head' || r.type === 'branch');
            if (localRefs.length === 1) {
              doCheckout(localRefs[0].name);
            } else if (localRefs.length > 1) {
              openCheckoutCommitModal(commit.hash);
            } else {
              const remoteRef = commit.refs.find(r => r.type === 'remote-branch' && r.name !== 'HEAD');
              if (remoteRef) { doCheckoutRemote(`${remoteRef.remote}/${remoteRef.name}`, remoteRef.name); }
              else            { openCheckoutCommitModal(commit.hash); }
            }
          },
        },
        { label: t('graph.cherryPickCommit'), action: () => { cherryPickTarget = commit.hash; showCherryPickModal = true; } },
        { label: t('graph.revertCommit'),     action: () => { revertTarget = commit.hash; showRevertModal = true; } },
      ]);

      // ── Compare / Multi-select ──
      const compareGroup: any[] = [{
        label: t('graph.compareToLocal'),
        action: () => {
          uiStore.multiSelectArmed = false;
          uiStore.comparing = true; uiStore.selectedCommitHash = null;
          uiStore.selectedCommitHashes = [];
          uiStore.compareRef1 = commit.hash; uiStore.compareRef2 = null;
          uiStore.showBottomPanel = true;
          vscode.postMessage({ type: 'compareToWorking', payload: { hash: commit.hash } });
        },
      }];
      // Multi-select is driven by Shift/Cmd-click in the graph; while armed, the
      // single-commit menu still offers adding this commit or clearing the set.
      if (uiStore.multiSelectArmed) {
        compareGroup.push({
          label: t('graph.addToSelection'),
          action: () => { uiStore.toggleHash(commit.hash); },
        });
        compareGroup.push({
          label: t('graph.cancelSelection'),
          action: () => { uiStore.exitMultiSelect(); },
        });
      }
      // ── Bisect ── (shares the compare/inspect group)
      if (bisectBadCommit) {
        compareGroup.push({ label: t('bisect.startGood'), action: () => { const bad = bisectBadCommit!; bisectBadCommit = null; bisectStartBad = bad; bisectStartGood = commit.hash; vscode.postMessage({ type: 'bisectStart', payload: { bad, good: commit.hash } }); } });
        compareGroup.push({ label: t('bisect.cancelSelect'), action: () => { bisectBadCommit = null; } });
      } else {
        compareGroup.push({ label: t('bisect.selectBad'), action: () => { bisectBadCommit = commit.hash; uiStore.selectedCommitHash = null; uiStore.showBottomPanel = false; } });
      }
      groups.push(compareGroup);
    } else {
      // ── Stash: compare to working ──
      groups.push([{
        label: t('graph.compareToLocal'),
        action: () => {
          uiStore.comparing = true; uiStore.selectedCommitHash = null;
          uiStore.compareRef1 = commit.hash; uiStore.compareRef2 = null;
          uiStore.showBottomPanel = true;
          vscode.postMessage({ type: 'compareToWorking', payload: { hash: commit.hash } });
        },
      }]);
    }

    // ── Export / Copy ──
    // Read-only ways to get this commit's content out: copy identifiers to the
    // clipboard, or export the diff as a `.patch` file. Save Patch is offered
    // for real commits only (not stashes).
    const copyGroup: any[] = [];
    if (!isStashCommit) {
      copyGroup.push({ label: t('graph.savePatch'), action: () => vscode.postMessage({ type: 'saveCommitPatch', payload: { hash: commit.hash } }) });
    }
    copyGroup.push(
      { label: t('graph.copySHA'), action: () => vscode.postMessage({ type: 'copyToClipboard', payload: { text: commit.hash } }) },
      { label: t('graph.copyShortSHA'), action: () => vscode.postMessage({ type: 'copyToClipboard', payload: { text: commit.abbreviatedHash } }) },
      { label: t('graph.copyCommitInfo'), action: () => vscode.postMessage({ type: 'copyToClipboard', payload: { text: `${commit.abbreviatedHash} - ${commit.subject}` } }) },
    );
    groups.push(copyGroup);

    // Flatten groups with separators between them, preceded by a separator if there were refs
    if (refs.length > 0) items.push(sep);
    for (let i = 0; i < groups.length; i++) {
      if (i > 0) items.push(sep);
      items.push(...groups[i]);
    }

    contextMenu = { x: e.clientX, y: e.clientY, items };
  }

  // Context menu for the uncommitted-changes row: stash the changes, and amend
  // the last commit when there is one.
  function onUncommittedContextMenu(e: MouseEvent) {
    e.preventDefault();
    const items: any[] = [];

    // Stash is always available: the row only renders when there are uncommitted
    // changes to stash.
    items.push({
      label: t('graph.stash'),
      action: () => {
        contextMenu = null;
        modalStore.openStashSave();
      },
    });

    const headCommit = commitStore.commits.find(c => c.refs.some(r => r.type === 'head'));
    if (headCommit) { // amend needs a HEAD commit (skip on empty repo / no HEAD loaded)
      const cur = branchStore.currentBranch;
      // HEAD is "pushed" when the branch tracks an existing upstream and is not ahead of it.
      const isPushed = !!cur?.upstream && !cur?.upstreamGone && (cur?.ahead ?? 0) === 0;
      const fullMessage = headCommit.body ? `${headCommit.subject}\n\n${headCommit.body}` : headCommit.subject;
      const ref = cur?.name ?? headCommit.abbreviatedHash;
      items.push({
        label: t('graph.amendRef', { ref }),
        action: () => {
          contextMenu = null;
          modalStore.openAmend({ hash: headCommit.hash, subject: headCommit.subject, message: fullMessage, isPushed });
          vscode.postMessage({ type: 'openScmView', payload: { returnFocus: true } });
        },
      });
    }

    contextMenu = { x: e.clientX, y: e.clientY, items };
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours < 12 ? 'AM' : 'PM';
    const h12 = hours % 12 || 12;
    return `${year}-${month}-${day} ${ampm} ${h12}:${mins}`;
  }

  // Keep the viewport size in sync with the actual container. Its height changes
  // when the bottom panel opens/closes or is resized, which fires no window
  // resize — without this, scroll-into-view would compute against a stale height
  // and could leave the selected row hidden behind the bottom panel.
  $effect(() => {
    if (!container) return;
    const el = container;
    const sync = () => {
      viewportHeight = el.clientHeight;
      viewportWidth = el.clientWidth;
    };
    sync();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Orchestration: when armed selection changes, request the right compare data.
  let lastCompareKey = '';
  $effect(() => {
    // Only fetch the comparison while the bottom panel is open — the panel hosts
    // CommitDetails, which is the listener for the compare/section responses.
    // Opening it via "View Changes" re-runs this effect and (re)loads the data.
    if (!uiStore.multiSelectArmed || !uiStore.showBottomPanel) { lastCompareKey = ''; return; }
    const sel = uiStore.selectedCommitHashes;
    if (sel.length < 2) { lastCompareKey = ''; return; }
    // Order by display order (newest first).
    const idx = new Map(displayCommits.map((c, i) => [c.hash, i]));
    const ordered = [...sel].sort((a, b) => (idx.get(a) ?? 0) - (idx.get(b) ?? 0));
    const key = ordered.join(',');
    if (key === lastCompareKey) return;
    lastCompareKey = key;
    uiStore.comparing = true;
    uiStore.selectedCommitHash = null;
    if (ordered.length === 2) {
      const ref2 = ordered[0];                 // newer
      const ref1 = ordered[1];                 // older
      uiStore.compareRef1 = ref1; uiStore.compareRef2 = ref2;
      vscode.postMessage({ type: 'compareCommits', payload: { ref1, ref2 } });
    } else {
      const head = ordered[0];
      const oldest = ordered[ordered.length - 1];
      uiStore.compareRef1 = `${oldest}^`; uiStore.compareRef2 = head;
      vscode.postMessage({ type: 'getMultiCommitSections', payload: { hashes: ordered } });
    }
  });

  function handleGraphNavKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    // Ignore while a modal is open, a multi-select range is armed, or the user
    // is typing in an input (e.g. the search box).
    if (modalStore.anyOpen || uiStore.multiSelectArmed) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
               el.tagName === 'SELECT' || el.isContentEditable)) return;

    const navCommits = displayCommits.filter(c => c.hash !== 'UNCOMMITTED');
    const dir = e.key === 'ArrowDown' ? 'down' : 'up';
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      const result = computeJumpTarget(navCommits, uiStore.selectedCommitHash, dir, navPath);
      navPath = result.path;
      if (result.target) {
        uiStore.selectSingle(result.target);
        scrollHashIntoView(result.target, 'edge');
      }
      return;
    }

    // Plain step abandons the jump exploration path.
    navPath = [];
    const target = computeNavigationTarget(navCommits, uiStore.selectedCommitHash, dir, false);
    if (target) {
      uiStore.selectSingle(target);
      scrollHashIntoView(target, 'edge');
    }
  }

</script>

<svelte:window onresize={handleResize} onkeydown={(e) => {
  if (e.key === 'Escape') {
    if (bisectBadCommit) { bisectBadCommit = null; }
    else if (bisectCulpritHash) { vscode.postMessage({ type: 'bisectReset' }); }
    // 1st Esc closes the open bottom panel; 2nd Esc clears the selection.
    else if (uiStore.multiSelectArmed && uiStore.showBottomPanel) { uiStore.showBottomPanel = false; }
    else if (uiStore.multiSelectArmed) { uiStore.exitMultiSelect(); }
  } else {
    handleGraphNavKey(e);
  }
}} />

<div class="commit-graph" class:h-scroll={horizontalScroll} bind:this={container} onscroll={handleScroll}>
  {#if commitStore.loading && !isSearchActive}
    <div class="loading"><span class="spinner"></span> {t('graph.loading')}</div>
  {:else if commitStore.notGitRepo}
    <div class="empty">{t('graph.notGitRepo')}</div>
  {:else if displayCommits.length === 0}
    <div class="empty">{isSearchActive ? t('graph.noResults') : t('graph.noCommits')}</div>
  {:else}
    {#if false}{/if}

    <!-- Author / hash / date cells, shared by the in-row meta (normal mode) and the
         pinned overlay (horizontal-scroll mode). -->
    {#snippet metaCells(commit: typeof displayCommits[0])}
      <div class="col-author">
        {#if commit.hash !== 'UNCOMMITTED'}
          <span class="author-id" use:tooltip={commit.author.name}>
            <img class="avatar-sm" src={avatarStore.url(commit.author.email, 20)} alt="" />
            <span class="author-name truncate">{commit.author.name}</span>
          </span>
          {#if commit.signatureStatus && commit.signatureStatus !== 'none'}
            <i
              class="codicon codicon-{commit.signatureStatus === 'good' ? 'pass' : 'question'} sig-icon sig-icon-{commit.signatureStatus}"
              use:tooltip={commit.signatureStatus === 'good' ? t('signature.verified') : t('signature.unverified')}
            ></i>
          {/if}
        {/if}
      </div>
      <div class="col-hash" use:tooltip={commit.hash !== 'UNCOMMITTED' ? commit.hash : ''}>{commit.hash !== 'UNCOMMITTED' ? commit.abbreviatedHash : ''}</div>
      <div class="col-date" use:tooltip={commit.hash !== 'UNCOMMITTED' ? new Date(commit.author.date).toLocaleString() : ''}>{commit.hash !== 'UNCOMMITTED' ? formatDate(commit.author.date) : ''}</div>
    {/snippet}

    <!-- Column headers -->
    <div class="graph-header" style={contentWidth ? `width: ${contentWidth}px;` : ''}>
      <div class="col-message">{t('graph.description')}</div>
      <div class="col-meta">
        <div class="col-author">{t('graph.author')}</div>
        <div class="col-hash">{t('graph.sha')}</div>
        <div class="col-date">{t('graph.date')}</div>
      </div>
    </div>

    <!-- Virtual scroll container -->
    <div
      class="scroll-content"
      style="height: {totalHeight}px; position: relative;{contentWidth ? ` width: ${contentWidth}px;` : ''}"
      role="presentation"
      onpointermove={handleRowHover}
      onpointerleave={() => { hoveredHash = null; }}
    >
      <!-- SVG for graph - SourceGit-style Path + Link + Dot rendering -->
      <svg
        class="graph-lines"
        width={graphWidth}
        style="position: absolute; top: 0; height: {totalHeight}px; overflow: hidden;"
      >
        <!-- Paths: continuous branch lines -->
        {#each visiblePaths as path}
          {@const pathColor = resolveGraphColor(graphColorsStore.palette, path.color, path.colorOverride)}
          {#if path.d}
            <path d={path.d} fill="none" stroke={pathColor} stroke-width="5" opacity="0.07" stroke-linecap="round" stroke-linejoin={uiStore.graphStyle === 'angular' ? 'miter' : undefined} />
            <path d={path.d} fill="none" stroke={pathColor} stroke-width="2" opacity="0.85" stroke-linecap="round" stroke-linejoin={uiStore.graphStyle === 'angular' ? 'miter' : undefined} />
          {/if}
        {/each}

        <!-- Links: merge connection curves -->
        {#each visibleLinks as link}
          {@const linkColor = resolveGraphColor(graphColorsStore.palette, link.color, link.colorOverride)}
          {@const sx = laneX(link.start.x)}
          {@const sy = link.start.y * ROW_HEIGHT}
          {@const cx = laneX(link.control.x)}
          {@const cy = link.control.y * ROW_HEIGHT}
          {@const ex = laneX(link.end.x)}
          {@const ey = link.end.y * ROW_HEIGHT}
          {@const linkD = uiStore.graphStyle === 'angular'
            ? `M ${sx} ${sy} L ${cx} ${cy} L ${ex} ${ey}`
            : `M ${sx} ${sy} Q ${cx} ${cy}, ${ex} ${ey}`}
          <path
            d={linkD}
            fill="none" stroke={linkColor} stroke-width="5" opacity="0.07" stroke-linecap="round" stroke-linejoin={uiStore.graphStyle === 'angular' ? 'miter' : undefined}
          />
          <path
            d={linkD}
            fill="none" stroke={linkColor} stroke-width="2" opacity="0.85" stroke-linecap="round" stroke-linejoin={uiStore.graphStyle === 'angular' ? 'miter' : undefined}
          />
        {/each}

        <!-- Dots: commit nodes -->
        {#each visibleDots as dot, i}
          {@const dotColor = resolveGraphColor(graphColorsStore.palette, dot.color, dot.colorOverride)}
          {@const dx = laneX(dot.center.x)}
          {@const dy = dot.center.y * ROW_HEIGHT}
          {@const dotCommit = displayCommits[startIndex + i]}
          {#if dotCommit?.hash === 'UNCOMMITTED'}
            <circle cx={dx} cy={dy} r={5} fill="none" stroke="#888888" stroke-width="1.5" stroke-dasharray="3 2" />
          {:else if dot.type === 'head'}
            <circle cx={dx} cy={dy} r={5} fill="var(--bg-primary, #1e1e1e)" stroke={dotColor} stroke-width="2" />
          {:else if dot.type === 'merge'}
            <circle cx={dx} cy={dy} r={4} fill="var(--bg-primary, #1e1e1e)" stroke={dotColor} stroke-width="1.5" />
            <circle cx={dx} cy={dy} r={2} fill={dotColor} />
          {:else}
            <circle cx={dx} cy={dy} r={4} fill={dotColor} />
          {/if}
        {/each}
      </svg>

      <!-- Commit rows -->
      <div
        class="visible-rows"
        style="position: absolute; top: {startIndex * ROW_HEIGHT}px; width: 100%;"
        role="rowgroup"
      >
        {#each visibleCommits as { commit, index } (commit.hash)}
          {@const dot = displayDots[index]}
          {@const nodeColor = dot ? resolveGraphColor(graphColorsStore.palette, dot.color, dot.colorOverride) : '#888'}
          {@const isRemoteTip = dot?.remoteTip ?? false}
          <div
            class="commit-row"
            class:hovered={hoveredHash === commit.hash}
            class:selected={uiStore.selectedCommitHashes.length > 0
              ? uiStore.selectedCommitHashes.includes(commit.hash)
              : uiStore.selectedCommitHash === commit.hash}
            class:highlighted={contextMenuHash === commit.hash}
            class:search-match={isSearchActive && searchMatchedHashes?.has(commit.hash)}
            class:search-dim={isSearchActive && !searchMatchedHashes?.has(commit.hash)}
            class:search-current={searchNavigateHash === commit.hash}
            class:other-branch={!isSearchActive && !currentBranchCommits.has(commit.hash) && commit.hash !== 'UNCOMMITTED'}
            class:compare-mode={uiStore.multiSelectArmed && !uiStore.selectedCommitHashes.includes(commit.hash)}
            class:compare-base={uiStore.multiSelectArmed && uiStore.selectedCommitHashes.includes(commit.hash)}
            class:compare-active={uiStore.comparing && (uiStore.compareRef1 === commit.hash || uiStore.compareRef2 === commit.hash)}
            class:bisect-mode={bisectBadCommit !== null && bisectBadCommit !== commit.hash}
            class:bisect-bad={bisectBadCommit === commit.hash}
            class:bisect-start-bad={bisectActive && bisectStartBad === commit.hash}
            class:bisect-start-good={bisectActive && bisectStartGood === commit.hash}
            class:bisect-culprit={bisectCulpritHash !== null && commit.hash.startsWith(bisectCulpritHash)}
            style="height: {ROW_HEIGHT}px;"
            onclick={(e) => handleRowClick(commit, e)}
            ondblclick={() => handleRowDblClick(commit)}
            oncontextmenu={(e) => { if (commit.hash === 'UNCOMMITTED') onUncommittedContextMenu(e); else onCommitContextMenu(e, commit); }}
            use:tooltip={commit.hash === 'UNCOMMITTED' ? t('graph.clickToOpenScm') : ''}
            role="row"
            tabindex={0}
            onkeydown={(e) => {
              if (e.key !== 'Enter') return;
              if (commit.hash === 'UNCOMMITTED') {
                uiStore.selectedCommitHash = null;
                vscode.postMessage({ type: 'openScmView' });
              } else {
                selectCommit(commit.hash);
              }
            }}
          >
            <div class="col-message" style="padding-left: {(displayLeftMargin[index] ?? 0) * X_SCALE + 4}px;">
              {#if currentBranchLocalOnly.has(commit.hash)}
                <span class="local-dot" use:tooltip={t('graph.notPushed')}></span>
              {:else if currentBranchRemoteAhead.has(commit.hash)}
                <span class="remote-dot" use:tooltip={t('graph.remoteOnly')}></span>
              {/if}
              {#each commit.refs.filter(r => {
                  if (r.type === 'working-dir') return false;
                  if (r.type === 'remote-branch') {
                    if (r.name === 'HEAD') return false;
                    if (remoteFilter.length > 0 && !remoteFilter.includes(r.remote ?? '')) return false;
                    // Tracked remote branches are shown as cloud-only badges alongside the local badge.
                    // Skip this optimization when local badges are hidden — show the full remote badge instead.
                    if (remoteFilter.length === 0 || remoteFilter.includes('local')) {
                      const localRefs = commit.refs.filter(lr => lr.type === 'branch' || lr.type === 'head');
                      for (const lr of localRefs) {
                        const localInfo = localBranchMap.get(lr.name);
                        if (localInfo?.upstream === `${r.remote}/${r.name}`) return false;
                      }
                    }
                  }
                  if ((r.type === 'branch' || r.type === 'head') && remoteFilter.length > 0 && !remoteFilter.includes('local')) {
                    return false;
                  }
                  return true;
                }).sort((a, b) => {
                  const order = { head: 0, branch: 1, 'remote-branch': 2, tag: 3, stash: 4, 'working-dir': 5 };
                  return (order[a.type] ?? 4) - (order[b.type] ?? 4);
                }) as ref}
                  {@const hasRemote = (ref.type === 'branch' || ref.type === 'head') && (() => {
                    const localInfo = localBranchMap.get(ref.name);
                    if (!localInfo?.upstream) return false;
                    return commit.refs.some(r => r.type === 'remote-branch' && `${r.remote}/${r.name}` === localInfo.upstream);
                  })()}
                  {@const trackedUpstream = (ref.type === 'branch' || ref.type === 'head') ? (localBranchMap.get(ref.name)?.upstream ?? null) : null}
                  {@const isWtBranch = (ref.type === 'branch' || ref.type === 'head') && worktreeBranches.has(ref.name)}
                  {@const badgeColor = ref.type === 'tag' ? '#f0c040' : ref.type === 'stash' ? 'var(--text-secondary, #888)' : isWtBranch ? '#4caf50' : nodeColor}
                  {@const showCloudOnly = hasRemote && trackedUpstream && (remoteFilter.length === 0 || (remoteFilter.includes('local') && remoteFilter.includes(trackedUpstream.split('/')[0])))}
                  {#if showCloudOnly}
                    <span
                      class="ref-badge badge-cloud-only"
                      style="--badge-color: {badgeColor};"
                      class:badge-head={ref.type === 'head'}
                      class:badge-fixed={isWtBranch}
                      use:tooltip={trackedUpstream ?? ''}
                      ondblclick={(e) => {
                        e.stopPropagation();
                        doCheckout(ref.name, false, {}, true);
                      }}
                      role="button"
                      tabindex={0}
                      onkeydown={(e) => {
                        if (e.key === 'Enter') {
                          doCheckout(ref.name, false, {}, true);
                        }
                      }}
                    >
                      <i class="codicon codicon-cloud ref-icon"></i>
                    </span>
                  {/if}
                  <span
                    class="ref-badge"
                    style="--badge-color: {badgeColor};{ref.type === 'stash' ? ' --fixed-tint: 28%;' : ''}"
                    class:badge-fixed={ref.type === 'tag' || ref.type === 'stash' || isWtBranch}
                    class:badge-head={ref.type === 'head'}
                    class:badge-no-bar={showCloudOnly}
                    draggable={ref.type === 'branch' || ref.type === 'head'}
                    class:drag-over={dragOverBranch === ref.name && (ref.type === 'branch' || ref.type === 'head')}
                    ondragstart={(e) => {
                      if (ref.type !== 'branch' && ref.type !== 'head') return;
                      dragSourceBranch = ref.name;
                      e.dataTransfer?.setData('text/plain', ref.name);
                    }}
                    ondragover={(e) => {
                      if ((ref.type === 'branch' || ref.type === 'head') && dragSourceBranch && dragSourceBranch !== ref.name) {
                        e.preventDefault();
                        dragOverBranch = ref.name;
                      }
                    }}
                    ondragleave={() => { if (dragOverBranch === ref.name) dragOverBranch = null; }}
                    ondrop={(e) => { if (ref.type === 'branch' || ref.type === 'head') onBranchDrop(e, ref.name); }}
                    ondragend={() => { dragSourceBranch = null; dragOverBranch = null; }}
                    use:tooltip={t('graph.dblClickCheckout', { ref: ref.type === 'remote-branch' ? ref.remote + '/' + ref.name : ref.name })}
                    ondblclick={(e) => {
                      e.stopPropagation();
                      if (ref.type === 'remote-branch') {
                        const trackingLocal = upstreamBranchMap.get(`${ref.remote}/${ref.name}`);
                        if (trackingLocal) {
                          fastForwardLocalBranch = trackingLocal.name;
                          fastForwardRemote = `${ref.remote}/${ref.name}`;
                          showFastForwardModal = true;
                        } else {
                          doCheckoutRemote(`${ref.remote}/${ref.name}`, ref.name);
                        }
                      } else if (ref.type === 'tag' || ref.type === 'stash') {
                        openCheckoutCommitModal(ref.type === 'stash' ? commit.hash : ref.name);
                      } else {
                        doCheckout(ref.name, false, {}, true);
                      }
                    }}
                    role="button"
                    tabindex={0}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') {
                        if (ref.type === 'remote-branch') {
                          const trackingLocal = upstreamBranchMap.get(`${ref.remote}/${ref.name}`);
                          if (trackingLocal) {
                            fastForwardLocalBranch = trackingLocal.name;
                            fastForwardRemote = `${ref.remote}/${ref.name}`;
                            showFastForwardModal = true;
                          } else {
                            doCheckoutRemote(`${ref.remote}/${ref.name}`, ref.name);
                          }
                        } else if (ref.type === 'tag' || ref.type === 'stash') {
                          openCheckoutCommitModal(ref.type === 'stash' ? commit.hash : ref.name);
                        } else {
                          doCheckout(ref.name, false, {}, true);
                        }
                      }
                    }}
                  >
                    {#if ref.type === 'head'}
                      <i class="codicon codicon-check ref-icon"></i>
                      {#if worktreeBranches.has(ref.name)}<i class="codicon codicon-worktree ref-icon"></i>{/if}
                      {ref.name}
                    {:else if ref.type === 'remote-branch'}
                      <i class="codicon codicon-cloud ref-icon"></i>
                      {ref.remote}/{ref.name}
                    {:else if ref.type === 'tag'}
                      <i class="codicon codicon-tag ref-icon"></i>
                      {ref.name}
                    {:else if ref.type === 'stash'}
                      <i class="codicon codicon-archive ref-icon"></i>
                      {ref.name}
                    {:else}
                      {#if (ref.type === 'branch') && worktreeBranches.has(ref.name)}<i class="codicon codicon-worktree ref-icon"></i>{/if}
                      {ref.name}
                    {/if}
                  </span>
                {/each}
                {#if commit.hash === 'UNCOMMITTED'}
                  {@const counts = JSON.parse(commit.body || '{}')}
                  {@const label = t('graph.uncommitted', { staged: counts.staged ?? 0, unstaged: counts.unstaged ?? 0 })}
                  <span class="commit-subject truncate" use:tooltip={t('graph.clickToOpenScm')}>{label}</span>
                {:else}
                  <span class="commit-subject truncate" use:tooltip={commit.subject}><LinkifiedText text={commit.subject} /></span>
                {/if}
            </div>
              {#if horizontalScroll}
                <!-- Space is reserved here; the visible meta is the pinned overlay below. -->
                <div class="col-meta-spacer" style="width: {RIGHT_COLS_WIDTH}px;"></div>
              {:else}
                <div class="col-meta">{@render metaCells(commit)}</div>
              {/if}
          </div>
        {/each}
      </div>

      <!-- Pinned meta columns (horizontal-scroll mode). A direct child of
           .scroll-content, so its z-index reliably sits above the graph SVG without
           depending on descendants escaping the rows' stacking context. -->
      {#if horizontalScroll}
        <div
          class="meta-overlay"
          style="height: {totalHeight}px; width: {RIGHT_COLS_WIDTH}px;"
        >
          {#each visibleCommits as { commit, index } (commit.hash)}
            <div
              class="meta-row"
              class:selected={uiStore.selectedCommitHashes.length > 0
                ? uiStore.selectedCommitHashes.includes(commit.hash)
                : uiStore.selectedCommitHash === commit.hash}
              class:highlighted={contextMenuHash === commit.hash}
              class:search-dim={isSearchActive && !searchMatchedHashes?.has(commit.hash)}
              class:search-current={searchNavigateHash === commit.hash}
              class:other-branch={!isSearchActive && !currentBranchCommits.has(commit.hash) && commit.hash !== 'UNCOMMITTED'}
              class:compare-base={uiStore.multiSelectArmed && uiStore.selectedCommitHashes.includes(commit.hash)}
              class:compare-active={uiStore.comparing && (uiStore.compareRef1 === commit.hash || uiStore.compareRef2 === commit.hash)}
              class:bisect-bad={bisectBadCommit === commit.hash}
              class:bisect-start-bad={bisectActive && bisectStartBad === commit.hash}
              class:bisect-start-good={bisectActive && bisectStartGood === commit.hash}
              class:bisect-culprit={bisectCulpritHash !== null && commit.hash.startsWith(bisectCulpritHash)}
              class:hovered={hoveredHash === commit.hash}
              style="top: {index * ROW_HEIGHT}px; height: {ROW_HEIGHT}px;"
              role="row"
              tabindex={-1}
              onclick={(e) => handleRowClick(commit, e)}
              ondblclick={() => handleRowDblClick(commit)}
              oncontextmenu={(e) => { if (commit.hash === 'UNCOMMITTED') onUncommittedContextMenu(e); else onCommitContextMenu(e, commit); }}
              onkeydown={(e) => { if (e.key === 'Enter') handleRowClick(commit); }}
            >
              {@render metaCells(commit)}
            </div>
          {/each}
        </div>
      {/if}

    </div>

    {#if commitStore.hasMore && !isSearchActive}
      <div class="load-more-row">
        <button
          class="load-more-btn"
          disabled={commitStore.loadingMore}
          onclick={() => {
            commitStore.setLoadingMore(true);
            vscode.postMessage({ type: 'getLog', payload: { limit: commitStore.currentLimit + uiStore.loadMoreCount } });
          }}
        >
          {#if commitStore.loadingMore}
            <span class="spinner"></span>
          {:else}
            <i class="codicon codicon-chevron-down"></i>
          {/if}
          {t('graph.loadMore')}
        </button>
      </div>
    {/if}
  {/if}
</div>

{#if bisectBadCommit}
  <div class="bisect-indicator">
    <i class="codicon codicon-search"></i>
    <span class="bisect-indicator-label">{t('bisect.clickGoodPrompt')}</span>
    <span class="bisect-indicator-hash">{bisectBadCommit.substring(0, 7)}</span>
    <button class="bisect-indicator-cancel" aria-label="Cancel bisect" onclick={() => { bisectBadCommit = null; }}>
      <i class="codicon codicon-close"></i>
    </button>
  </div>
{/if}

{#if contextMenu}
  <ContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={contextMenu.items}
    onClose={() => { contextMenu = null; if (!anyModalOpen) contextMenuHash = null; }}
  />
{/if}

{#if interactiveRebaseBase}
  <InteractiveRebase
    base={interactiveRebaseBase}
    branchName={branchStore.currentBranch?.name ?? 'HEAD'}
    baseSubject={commitStore.getCommit(interactiveRebaseBase)?.subject ?? ''}
    onClose={() => { interactiveRebaseBase = null; uiStore.exitMultiSelect(); contextMenuHash = null; }}
  />
{/if}

{#if rebaseTargetBranches}
  <RebaseTargetModal
    branches={rebaseTargetBranches}
    currentBranch={branchStore.currentBranch?.name ?? ''}
    base={pendingRebaseBase ?? ''}
    onConfirm={(branch, dirty) => {
      rebaseTargetBranches = null;
      vscode.postMessage({ type: 'checkout', payload: { ref: branch, ...dirty } });
    }}
    onClose={() => {
      if (rebaseTargetBranches) {
        rebaseTargetBranches = null;
        pendingRebaseBase = null;
        uiStore.exitMultiSelect();
        contextMenuHash = null;
      }
    }}
  />
{/if}

{#if rebaseDirtyBranch}
  <DirtyActionModal
    title={t('dirtyAction.title')}
    confirmLabel={t('dirtyAction.continue')}
    onConfirm={(dirty: DirtyPayload) => {
      const branch = rebaseDirtyBranch!;
      rebaseDirtyBranch = null;
      vscode.postMessage({ type: 'checkout', payload: { ref: branch, ...dirty } });
    }}
    onClose={() => {
      if (rebaseDirtyBranch) {
        rebaseDirtyBranch = null;
        pendingRebaseBase = null;
        uiStore.exitMultiSelect();
        contextMenuHash = null;
      }
    }}
  />
{/if}

{#if showResetModal}
  <ResetModal
    hash={resetTarget}
    branchName={branchStore.currentBranch?.name ?? 'HEAD'}
    onConfirm={(mode) => { vscode.postMessage({ type: 'reset', payload: { ref: resetTarget, mode } }); contextMenuHash = null; }}
    onClose={() => { showResetModal = false; contextMenuHash = null; }}
  />
{/if}

{#if showRebaseModal}
  <RebaseBranchModal
    branch={branchStore.currentBranch?.name ?? 'current branch'}
    onto={rebaseTarget}
    onClose={() => { showRebaseModal = false; contextMenuHash = null; }}
    onRebase={(options) => { showRebaseModal = false; contextMenuHash = null; vscode.postMessage({ type: 'rebase', payload: { onto: rebaseTarget, autostash: options.autostash, pushAfter: options.pushAfter } }); }}
  />
{/if}

{#if showCherryPickModal}
  <CherryPickModal
    commit={cherryPickTarget}
    branch={branchStore.currentBranch?.name ?? 'current branch'}
    onClose={() => { showCherryPickModal = false; contextMenuHash = null; }}
    onCherryPick={({ noCommit, pushAfter }) => { showCherryPickModal = false; contextMenuHash = null; vscode.postMessage({ type: 'cherryPick', payload: { commit: cherryPickTarget, noCommit, pushAfter } }); }}
  />
{/if}

{#if showRevertModal}
  <RevertModal
    commit={revertTarget}
    branch={branchStore.currentBranch?.name ?? 'current branch'}
    onClose={() => { showRevertModal = false; contextMenuHash = null; }}
    onRevert={({ noCommit, pushAfter }) => { showRevertModal = false; contextMenuHash = null; vscode.postMessage({ type: 'revert', payload: { commit: revertTarget, noCommit, pushAfter } }); }}
  />
{/if}

{#if autosquashTarget}
  <AutosquashCommitModal
    mode={autosquashTarget.mode}
    commit={autosquashTarget.hash}
    subject={autosquashTarget.subject}
    onClose={() => { autosquashTarget = null; contextMenuHash = null; }}
    onConfirm={() => {
      const target = autosquashTarget!;
      autosquashTarget = null;
      contextMenuHash = null;
      vscode.postMessage({ type: target.mode === 'fixup' ? 'commitFixup' : 'commitSquash', payload: { commit: target.hash } });
    }}
  />
{/if}

{#if squashChain}
  <SquashModal
    chain={squashChain}
    base={squashChain[0].parents[0]}
    hasPushedCommits={!!branchStore.currentBranch?.upstream
      && squashChain.some(c => !currentBranchLocalOnly.has(c.hash))}
    onClose={() => { squashChain = null; uiStore.exitMultiSelect(); contextMenuHash = null; }}
  />
{/if}

{#if multiCherryPickTargets}
  <MultiCherryPickModal
    commits={multiCherryPickTargets}
    branch={branchStore.currentBranch?.name ?? 'current branch'}
    onClose={() => { multiCherryPickTargets = null; contextMenuHash = null; }}
    onCherryPick={({ noCommit, pushAfter }) => {
      // Snapshot the $state proxy into a plain array — posting the proxy
      // directly throws DataCloneError and the message silently never sends.
      const commits = [...multiCherryPickTargets!];
      multiCherryPickTargets = null;
      contextMenuHash = null;
      uiStore.exitMultiSelect();
      vscode.postMessage({ type: 'cherryPick', payload: { commit: commits[0], commits, noCommit, pushAfter } });
    }}
  />
{/if}

{#if showCheckoutCommitModal}
  {@const commitForHash = commitStore.getCommit(checkoutCommitHash)}
  {@const linkedBranches = commitForHash ? commitForHash.refs.filter(r => r.type === 'branch' || r.type === 'head').map(r => r.name) : []}
  {@const linkedRemoteBranches = commitForHash ? commitForHash.refs.filter(r => r.type === 'remote-branch' && r.name !== 'HEAD').map(r => ({ remote: r.remote!, name: r.name })) : []}
  <CheckoutCommitModal
    hash={checkoutCommitHash}
    {linkedBranches}
    {linkedRemoteBranches}
    currentBranch={branchStore.currentBranch?.name}
    onCheckout={(ref, dirty) => {
      if (linkedBranches.includes(ref)) {
        doCheckout(ref, false, dirty);
      } else if (linkedRemoteBranches.some(rb => `${rb.remote}/${rb.name}` === ref)) {
        const rb = linkedRemoteBranches.find(rb => `${rb.remote}/${rb.name}` === ref)!;
        doCheckoutRemote(`${rb.remote}/${rb.name}`, rb.name, dirty);
      } else {
        doCheckout(ref, false, dirty);
      }
    }}
    onClose={() => { showCheckoutCommitModal = false; }}
  />
{/if}

{#if showFastForwardModal}
  <FastForwardModal
    localBranch={fastForwardLocalBranch}
    remote={fastForwardRemote}
    isCurrentBranch={fastForwardLocalBranch === branchStore.currentBranch?.name}
    onClose={() => { showFastForwardModal = false; }}
    onConfirm={(noCheckout) => {
      showFastForwardModal = false;
      const local = fastForwardLocalBranch;
      const remote = fastForwardRemote;
      // A no-checkout fast-forward leaves the working tree alone, so the dirty
      // (stash/clean) payload is irrelevant there.
      const dp = noCheckout ? {} : { ...pendingCheckoutDirtyPayload };
      pendingCheckoutDirtyPayload = {};
      vscode.postMessage({ type: 'fastForward', payload: { local, remote, noCheckout, ...dp } });
    }}
  />
{/if}

{#if showPullAfterCheckoutModal}
  <PullAfterCheckoutModal
    branchName={pullAfterCheckoutRef}
    behind={pullAfterCheckoutBehind}
    onClose={() => { showPullAfterCheckoutModal = false; }}
    onCheckoutOnly={() => { showPullAfterCheckoutModal = false; doCheckout(pullAfterCheckoutRef, false, pendingCheckoutDirtyPayload, true); }}
    onCheckoutAndPull={() => { showPullAfterCheckoutModal = false; doCheckout(pullAfterCheckoutRef, true, pendingCheckoutDirtyPayload, true); }}
  />
{/if}

{#if showWorktreeBlockedModal}
  <WorktreeBlockedModal
    branchRef={worktreeBlockedRef}
    displayPath={worktreeBlockedPath}
    onClose={() => { showWorktreeBlockedModal = false; }}
    onOpenInNewWindow={() => {
      vscode.postMessage({ type: 'openWorktreeInNewWindow', payload: { path: worktreeBlockedAbsPath } });
      showWorktreeBlockedModal = false;
    }}
  />
{/if}

<style>
  /* ---- Layout ---- */
  .commit-graph {
    height: 100%;
    overflow-y: auto;
    overflow-x: auto;
    position: relative;
  }

  .loading, .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    color: var(--text-secondary);
    font-size: 13px;
  }

  /* ---- Load More ---- */
  .load-more-row {
    display: flex;
    justify-content: center;
    padding: 10px 0 12px;
  }

  .load-more-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 16px;
    font-size: inherit;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    cursor: pointer;
  }

  .load-more-btn:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--bg-hover);
    border-color: var(--text-secondary);
  }

  .load-more-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* ---- Header ---- */
  .graph-header {
    display: flex;
    align-items: center;
    height: 32px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    font-size: 0.9em;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-secondary);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .graph-header > div {
    padding: 0 10px;
  }

  /* ---- SVG layer - must be ABOVE rows so nodes/lines are visible ---- */
  .graph-lines {
    pointer-events: none;
    z-index: 3;
  }

  .visible-rows {
    z-index: 1;
  }

  /* ---- Commit row ---- */
  .commit-row {
    display: flex;
    align-items: center;
    font-size: inherit;
    cursor: pointer;
    transition: background 0.08s;
    user-select: none;
  }

  /* Driven by hoveredHash (not :hover) so the row and the pinned meta overlay
     highlight in the same reactive tick instead of a frame apart. */
  .commit-row.hovered {
    background: var(--bg-hover);
  }

  .commit-row.compare-base {
    background: rgba(99, 176, 244, 0.12);
    box-shadow: inset 3px 0 0 #63b0f4;
  }

  .commit-row.compare-active {
    background: rgba(99, 176, 244, 0.10);
    box-shadow: inset 3px 0 0 #63b0f4;
  }

  .commit-row.compare-mode {
    cursor: pointer;
  }

  .commit-row.compare-mode:hover {
    background: rgba(99, 176, 244, 0.08);
  }

  .commit-row.selected {
    background: var(--bg-selected);
    color: var(--text-selected);
  }

  /* Right-click (context menu) highlight. In normal mode this full outline encloses
     the whole row; in scroll mode the pinned overlay draws the right side (see
     .meta-row.highlighted) while this covers the message side. */
  .commit-row.highlighted:not(.selected) {
    background: var(--bg-hover);
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: -1px;
  }
  /* No focus ring on click/keyboard focus (selection is shown by the row background). */
  .commit-row:focus-visible { outline: none; }

  .commit-row:not(.other-branch) .commit-subject {
    font-weight: normal;
  }

  .commit-row.other-branch .commit-subject,
  .commit-row.other-branch .col-author,
  .commit-row.other-branch .col-hash,
  .commit-row.other-branch .col-date {
    opacity: 0.6;
  }

  .commit-row.search-dim {
    opacity: 0.3;
  }

  .commit-row.search-match {
    opacity: 1;
  }

  .commit-row.search-current {
    background: color-mix(in srgb, var(--vscode-focusBorder, #007fd4) 20%, transparent);
    box-shadow: inset 3px 0 0 var(--vscode-focusBorder, #007fd4);
  }

  /* ---- Columns ---- */
  .col-message {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px;
    overflow: hidden;
  }

  /* In normal mode the meta wrapper is transparent to layout, so author/hash/date
     behave exactly as direct flex children of the row. */
  .col-meta {
    display: contents;
  }

  /* The graph header's meta columns stay pinned to the right while the header
     scrolls horizontally. (The body rows use the overlay below instead.) */
  .commit-graph.h-scroll .col-meta {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    position: sticky;
    right: 0;
    z-index: 5;
    background-color: var(--bg-secondary);
    /* Cancel the `.graph-header > div` padding so the header labels line up exactly
       with the overlay content below (whose cells carry their own padding). */
    padding: 0;
  }

  /* Reserve the meta width inside each scrolling row. The visible meta is painted
     by the pinned overlay, which is layered separately above the graph. */
  .col-meta-spacer {
    flex-shrink: 0;
  }

  /* Isolate so the graph SVG and the pinned meta overlay resolve their z-index in
     one local context, regardless of any ancestor stacking contexts. */
  .commit-graph.h-scroll .scroll-content {
    isolation: isolate;
  }

  /* In horizontal-scroll mode the load-more row would otherwise sit at the
     content's left origin and slide out of view as the user scrolls right to
     follow a wide graph. Pin it to the left of the viewport (width stays the
     visible width, so the centered button is always reachable without
     horizontally scrolling back). */
  .commit-graph.h-scroll .load-more-row {
    position: sticky;
    left: 0;
    width: 100%;
  }

  /* Pinned meta columns. A direct child of .scroll-content with a z-index above the
     graph SVG (3), so it reliably covers the lanes scrolling underneath — no reliance
     on descendants escaping the rows' stacking context. */
  .meta-overlay {
    /* Native sticky pins it to the right edge with zero lag during horizontal
       scroll. margin-left:auto right-aligns it so its static position is the
       right of the content (the frozen-column pattern). */
    position: sticky;
    right: 0;
    margin-left: auto;
    z-index: 6;
  }

  .meta-row {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    background-color: var(--bg-primary);
    cursor: pointer;
    user-select: none;
    /* Match the commit row's background transition so the message and the pinned
       author/hash/date highlight in lock-step instead of one snapping early. */
    transition: background 0.08s;
  }

  /* The overlay's share of the right-click highlight border: top, bottom and right
     edges only, so it joins seamlessly with the commit row's outline (which covers
     the message side and left edge) into one box around the whole row — no seam. */
  .meta-row.highlighted:not(.selected) {
    background-color: var(--bg-hover);
    box-shadow:
      inset 0 1px 0 var(--vscode-focusBorder, #007fd4),
      inset 0 -1px 0 var(--vscode-focusBorder, #007fd4),
      inset -1px 0 0 var(--vscode-focusBorder, #007fd4);
  }
  /* No focus ring on click/keyboard focus. */
  .meta-row:focus-visible { outline: none; }

  .meta-row.hovered { background-color: var(--bg-hover); }
  .meta-row.selected { background-color: var(--bg-selected); }
  .meta-row.selected .col-author,
  .meta-row.selected .col-hash,
  .meta-row.selected .col-date { color: var(--text-selected); opacity: 0.8; }
  .meta-row.other-branch .col-author,
  .meta-row.other-branch .col-hash,
  .meta-row.other-branch .col-date { opacity: 0.6; }
  .meta-row.search-dim { opacity: 0.3; }
  .meta-row.search-current { background-color: color-mix(in srgb, var(--vscode-focusBorder, #007fd4) 20%, var(--bg-primary)); }
  .meta-row.compare-base,
  .meta-row.compare-active { background-color: color-mix(in srgb, #63b0f4 12%, var(--bg-primary)); }
  .meta-row.bisect-bad,
  .meta-row.bisect-start-bad { background-color: color-mix(in srgb, #f44336 12%, var(--bg-primary)); }
  .meta-row.bisect-start-good { background-color: color-mix(in srgb, #4caf50 12%, var(--bg-primary)); }
  .meta-row.bisect-culprit { background-color: color-mix(in srgb, #ff9800 15%, var(--bg-primary)); }

  .local-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
    background: #4da6ff;
    opacity: 0.8;
  }

  :global(body.vscode-light) .local-dot {
    background: #1565c0;
  }

  .remote-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--text-secondary, #888);
    opacity: 0.8;
  }

  .col-author {
    width: 120px;
    flex-shrink: 0;
    padding: 0 10px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* Wraps avatar + name so the author-name tooltip is scoped to them only;
     the signature icon sits outside as a sibling so hovering it doesn't also
     trigger this tooltip (which would overlap two tooltips). min-width:0 lets
     the name truncate while the icon (flex-shrink:0) stays visible. */
  .author-id {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .avatar-sm {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* Flex item must allow shrinking below content size for ellipsis to engage. */
  .author-name {
    min-width: 0;
  }

  .commit-row.selected .col-author,
  .commit-row.selected .col-date,
  .commit-row.selected .col-hash {
    color: var(--text-selected);
    opacity: 0.8;
  }

  .col-date {
    width: 150px;
    flex-shrink: 0;
    padding: 0 10px;
    color: var(--text-secondary);
    white-space: nowrap;
    text-align: left;
  }

  .col-hash {
    width: 75px;
    flex-shrink: 0;
    padding: 0 10px;
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--text-secondary);
    /* Large repos abbreviate hashes to 10-12 chars; clip so they never spill
       into the date column. */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .graph-header .col-hash {
    font-family: inherit;
  }

  .commit-subject {
    flex: 1;
    min-width: 0;
  }

  /* Signature status icon, shown right after the author name (with the
     col-author flex gap as the single space) only when the graph is fetched
     with verification on (gitGraphPlus.showSignatureStatus). */
  .sig-icon {
    flex-shrink: 0;
    font-size: 0.95em;
    vertical-align: middle;
  }

  .sig-icon-good {
    color: var(--vscode-testing-iconPassed, #4caf50);
  }

  .sig-icon-unverified {
    color: var(--vscode-editorWarning-foreground, #d7a000);
  }

  /* ---- Ref badges ----
     Branches carry their color through a solid left accent bar (the same color
     as the commit dot, drawn as a ::before so it follows the badge's rounded
     corners cleanly instead of a mismatched thick border) over a neutral fill,
     so a branch's badge color is legible regardless of color vision. Three
     levels of emphasis share this one visual language: regular branch (no fill)
     < tag/stash/worktree (light tint) < current branch (strong tint + bold).
     The bar width is user-configurable via --badge-bar-width (see
     gitGraphPlus.branchBadgeBarThickness). */
  /* Drag-over target uses the same subtle fill as hover. */
  .ref-badge.drag-over {
    box-shadow: inset 0 0 0 100px rgba(255, 255, 255, 0.12);
  }

  :global(body.vscode-light) .ref-badge.drag-over {
    box-shadow: inset 0 0 0 100px rgba(0, 0, 0, 0.06);
  }

  .ref-badge {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 7px 1px calc(var(--badge-bar-width, 4px) + 6px);
    border-radius: 4px;
    font-size: 0.95em;
    font-weight: normal;
    white-space: nowrap;
    flex-shrink: 0;
    line-height: 17px;
    cursor: pointer;
    overflow: hidden;
    transition: box-shadow 0.1s;
    /* Dark theme defaults: neutral fill */
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.12);
  }

  /* Colored accent bar. Clipped to the badge's rounded corners by its
     overflow:hidden, so it reads as an integrated edge accent. Painted above the
     hover overlay (inset box-shadow) while text/icons stay above both. */
  .ref-badge::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: var(--badge-bar-width, 4px);
    background: var(--badge-color);
  }

  /* No focus ring on click/keyboard focus. Otherwise clicking a badge and then
     pressing Esc flips it into :focus-visible, drawing an unwanted outline. */
  .ref-badge:focus-visible { outline: none; }

  /* Fixed-color refs: tag/worktree 20%, stash 28% (via inline --fixed-tint). */
  .ref-badge.badge-fixed {
    background: color-mix(in srgb, var(--badge-color) var(--fixed-tint, 20%), transparent);
  }

  /* Current branch: strongest tint + bold — the most prominent badge. */
  .ref-badge.badge-head {
    background: color-mix(in srgb, var(--badge-color) 55%, transparent);
    font-weight: 600;
  }

  /* Only the current-branch check mark gets a heavier stroke for emphasis.
     Other icons (cloud/worktree/tag/…) keep their normal weight — a text-stroke
     on those glyphs reads as a rendering glitch rather than emphasis. */
  .ref-badge.badge-head .ref-icon.codicon-check {
    -webkit-text-stroke: 1px currentColor;
  }

  /* Paired local badge whose colored bar lives on the cloud companion instead. */
  .ref-badge.badge-no-bar {
    padding-left: 7px;
  }
  .ref-badge.badge-no-bar::before {
    content: none;
  }

  /* Light theme overrides */
  :global(body.vscode-light) .ref-badge {
    background: rgba(0, 0, 0, 0.04);
    color: #000;
    border: 1px solid rgba(0, 0, 0, 0.15);
  }

  :global(body.vscode-light) .ref-badge.badge-fixed {
    background: color-mix(in srgb, var(--badge-color) var(--fixed-tint, 20%), #fff);
  }

  :global(body.vscode-light) .ref-badge.badge-head {
    background: color-mix(in srgb, var(--badge-color) 70%, #fff);
    color: #000;
  }

  /* High contrast overrides */
  :global(body.vscode-high-contrast) .ref-badge {
    background: transparent;
    color: #fff;
    border: 1px solid var(--badge-color);
  }

  .badge-cloud-only {
    padding: 1px 5px 1px calc(var(--badge-bar-width, 4px) + 4px);
    height: calc(17px + 2px + 2px); /* line-height + padding top/bottom + border */
    box-sizing: border-box;
  }

  /* Pull the local name badge closer to its cloud companion: tightens the
     .col-message flex gap (5px) down to 2px for this pair only, so the two
     read as a single unit. */
  .badge-cloud-only + .ref-badge {
    margin-left: -3px;
  }

  /* Hover highlight: a translucent inset overlay painted below the text and the
     accent bar, so it stays visible even on the near-transparent regular-branch
     fill while preserving each badge's tint. Cloud pairs highlight as a unit:
     hovering either the cloud companion or the local name badge highlights both
     (:hover covers the directly-hovered one; the other two selectors cover its
     paired sibling in each direction). */
  .ref-badge:hover,
  .badge-cloud-only:hover + .ref-badge,
  .badge-cloud-only:has(+ .ref-badge:hover) {
    box-shadow: inset 0 0 0 100px rgba(255, 255, 255, 0.12);
  }

  :global(body.vscode-light) .ref-badge:hover,
  :global(body.vscode-light) .badge-cloud-only:hover + .ref-badge,
  :global(body.vscode-light) .badge-cloud-only:has(+ .ref-badge:hover) {
    box-shadow: inset 0 0 0 100px rgba(0, 0, 0, 0.06);
  }

  .ref-icon {
    font-size: 1em;
    flex-shrink: 0;
    line-height: 1;
    transform: translateY(1px);
  }


  /* ---- Bisect indicator ---- */
  .bisect-indicator {
    position: fixed;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(244, 67, 54, 0.15);
    border: 1px solid rgba(244, 67, 54, 0.4);
    color: #f44336;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: var(--vscode-font-size, 13px);
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 100;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    backdrop-filter: blur(8px);
  }

  .bisect-indicator-label {
    color: var(--text-secondary);
    font-size: 0.9em;
  }

  .bisect-indicator-hash {
    font-family: var(--vscode-editor-font-family, monospace);
    color: #f44336;
  }

  .bisect-indicator-cancel {
    background: transparent;
    color: var(--text-secondary);
    border: none;
    padding: 2px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    font-size: inherit;
  }

  .bisect-indicator-cancel:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-primary);
  }

  .commit-row.bisect-bad,
  .commit-row.bisect-start-bad {
    background: rgba(244, 67, 54, 0.12);
    box-shadow: inset 3px 0 0 #f44336;
  }

  .commit-row.bisect-start-good {
    background: rgba(76, 175, 80, 0.12);
    box-shadow: inset 3px 0 0 #4caf50;
  }

  .commit-row.bisect-culprit {
    background: rgba(255, 152, 0, 0.15);
    box-shadow: inset 3px 0 0 #ff9800;
  }

  .commit-row.bisect-mode {
    cursor: pointer;
  }

  .commit-row.bisect-mode:hover {
    background: rgba(99, 176, 244, 0.08);
  }

  /* ---- Light theme overrides ---- */
  :global(body.vscode-light) .bisect-indicator {
    background: rgba(200, 40, 30, 0.08);
    border-color: rgba(200, 40, 30, 0.3);
    color: #b71c1c;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  }

  :global(body.vscode-light) .bisect-indicator-hash {
    color: #b71c1c;
  }

  :global(body.vscode-light) .bisect-indicator-cancel:hover {
    background: rgba(0, 0, 0, 0.06);
  }

  :global(body.vscode-light) .commit-row.compare-base,
  :global(body.vscode-light) .commit-row.compare-active {
    background: rgba(40, 100, 180, 0.08);
    box-shadow: inset 3px 0 0 #1a5fa0;
  }

  :global(body.vscode-light) .commit-row.bisect-bad,
  :global(body.vscode-light) .commit-row.bisect-start-bad {
    background: rgba(200, 40, 30, 0.08);
    box-shadow: inset 3px 0 0 #b71c1c;
  }

  :global(body.vscode-light) .commit-row.bisect-start-good {
    background: rgba(46, 125, 50, 0.08);
    box-shadow: inset 3px 0 0 #2e7d32;
  }

  :global(body.vscode-light) .commit-row.bisect-culprit {
    background: rgba(200, 100, 0, 0.08);
    box-shadow: inset 3px 0 0 #e65100;
  }

</style>
