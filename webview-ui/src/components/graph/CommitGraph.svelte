<script lang="ts">
  import { commitStore } from '../../lib/stores/commits.svelte';
  import { branchStore } from '../../lib/stores/branches.svelte';
  import { uiStore } from '../../lib/stores/ui.svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { t } from '../../lib/i18n/index.svelte';
  import { getGravatarUrl } from '../../lib/utils/gravatar';
  import ContextMenu from '../common/ContextMenu.svelte';
  import InteractiveRebase from '../rebase/InteractiveRebase.svelte';
  import Modal from '../common/Modal.svelte';
  import ColorSelect from '../common/ColorSelect.svelte';
  import DeleteTagModal from '../modals/DeleteTagModal.svelte';
  import DeleteBranchModal from '../modals/DeleteBranchModal.svelte';
  import PullAfterCheckoutModal from '../modals/PullAfterCheckoutModal.svelte';
  import CheckoutRemoteModal from '../modals/CheckoutRemoteModal.svelte';
  import MergeBranchModal from '../modals/MergeBranchModal.svelte';
  import RebaseBranchModal from '../modals/RebaseBranchModal.svelte';
  import CreateBranchModal from '../modals/CreateBranchModal.svelte';
  import CreateTagModal from '../modals/CreateTagModal.svelte';
  import type { Commit, CommitGraphData } from '../../lib/types';

  const COLOR_PALETTE = [
    '#63b0f4', '#73d13d', '#ff7a45', '#b37feb',
    '#f759ab', '#36cfc9', '#ffc53d', '#ff4d4f',
    '#597ef7', '#9254de', '#43e8d8', '#faad14',
  ];

  /**
   * Build SVG path `d` string from SourceGit Path points.
   * Exactly mirrors SourceGit's DrawCurves rendering.
   */
  function buildPathD(points: Array<{ x: number; y: number }>): string {
    if (points.length < 2) return '';

    const parts: string[] = [];
    let last = { x: laneX(points[0].x), y: points[0].y * ROW_HEIGHT };
    parts.push(`M ${last.x} ${last.y}`);

    for (let i = 1; i < points.length; i++) {
      const cur = { x: laneX(points[i].x), y: points[i].y * ROW_HEIGHT };

      if (cur.x > last.x) {
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
    searchResults?: CommitGraphData | null;
  }

  let { searchResults = null }: Props = $props();

  const vscode = getVsCodeApi();

  let contextMenu = $state<{ x: number; y: number; items: any[] } | null>(null);
  let contextMenuHash = $state<string | null>(null);
  const worktreeBranches = $derived(new Set(branchStore.worktrees.filter(w => !w.isMain).map(w => w.branch)));

  // Set of commit hashes on the current branch's first-parent line
  const currentBranchCommits = $derived.by(() => {
    const set = new Set<string>();
    const commits = commitStore.commits;
    if (commits.length === 0) return set;
    const hashIndex = new Map<string, number>();
    for (let i = 0; i < commits.length; i++) hashIndex.set(commits[i].hash, i);
    // Find HEAD commit
    const headCommit = commits.find(c => c.refs.some(r => r.type === 'head'));
    if (!headCommit) return set;
    // Walk first parents
    let hash: string | undefined = headCommit.hash;
    while (hash) {
      set.add(hash);
      const idx = hashIndex.get(hash);
      if (idx === undefined) break;
      hash = commits[idx].parents[0]; // first parent
    }
    return set;
  });

  // Set of commit hashes that are remote-ahead for current branch's upstream only
  const currentBranchRemoteAhead = $derived.by(() => {
    const set = new Set<string>();
    const current = branchStore.currentBranch;
    if (!current?.upstream || current.behind === 0) return set;
    const commits = commitStore.commits;
    if (commits.length === 0) return set;
    const hashIndex = new Map<string, number>();
    for (let i = 0; i < commits.length; i++) hashIndex.set(commits[i].hash, i);
    // Find the upstream remote tip commit
    const [remote, ...rest] = current.upstream.split('/');
    const remoteBranchName = rest.join('/');
    const remoteTipCommit = commits.find(c => c.refs.some(r => r.type === 'remote-branch' && r.remote === remote && r.name === remoteBranchName));
    if (!remoteTipCommit) return set;
    // Walk first parents from remote tip, stop when hitting current branch commits
    let hash: string | undefined = remoteTipCommit.hash;
    while (hash && !currentBranchCommits.has(hash)) {
      set.add(hash);
      const idx = hashIndex.get(hash);
      if (idx === undefined) break;
      hash = commits[idx].parents[0];
    }
    return set;
  });

  let compareBase = $state<string | null>(null);
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  let interactiveRebaseBase = $state<string | null>(null);
  let showResetModal = $state(false);
  let resetTarget = $state('');
  let resetMode = $state<'soft' | 'mixed' | 'hard'>('mixed');

  let showRenameBranchModal = $state(false);
  let renameBranchOld = $state('');
  let renameBranchNew = $state('');

  // Confirmation modals
  let showMergeModal = $state(false);
  let mergeTarget = $state('');

  let showRebaseModal = $state(false);
  let rebaseTarget = $state('');

  let showCherryPickModal = $state(false);
  let cherryPickTarget = $state('');
  let cherryPickNoCommit = $state(false);

  let showRevertModal = $state(false);
  let revertTarget = $state('');
  let revertNoCommit = $state(false);

  let showDeleteTagModal = $state(false);
  let deleteTagName = $state('');

  let showDeleteBranchModal = $state(false);
  let deleteBranchName = $state('');

  let showDeleteRemoteBranchModal = $state(false);
  let deleteRemoteBranchRemote = $state('');
  let deleteRemoteBranchName = $state('');

  let showRemoveWorktreeModal = $state(false);
  let removeWorktreePath = $state('');
  let removeWorktreeBranch = $state('');
  let deleteWorktreeBranch = $state(false);

  let showCheckoutRemoteModal = $state(false);
  let checkoutRemoteName = $state('');
  let checkoutRemoteLocalName = $state('');

  let showCheckoutCommitModal = $state(false);
  let checkoutCommitHash = $state('');

  let showCreateTagModal = $state(false);
  let createTagRef = $state('');
  let createTagSubject = $state('');

  let showCreateBranchModal = $state(false);
  let createBranchStartPoint = $state('');
  let createBranchSubject = $state('');

  let showPullAfterCheckoutModal = $state(false);
  let pullAfterCheckoutRef = $state('');
  let pullAfterCheckoutBehind = $state(0);

  function doCheckout(ref: string) {
    // Check if this is a local branch that is behind its remote
    const branch = branchStore.branches.find(b => !b.remote && b.name === ref);
    if (branch && branch.behind > 0) {
      pullAfterCheckoutRef = ref;
      pullAfterCheckoutBehind = branch.behind;
      showPullAfterCheckoutModal = true;
      return;
    }
    vscode.postMessage({ type: 'checkout', payload: { ref } });
  }

  function doCheckoutRemote(remoteName: string, branchName: string) {
    // Check if a local branch tracks this remote (upstream), or has the same name
    const localBranch = branchStore.branches.find(b => !b.remote && (b.upstream === remoteName || b.name === branchName));
    if (localBranch) {
      doCheckout(localBranch.name);
    } else {
      // No local branch → show create modal
      checkoutRemoteName = remoteName;
      checkoutRemoteLocalName = branchName;
      showCheckoutRemoteModal = true;
    }
  }

  let isSearchActive = $derived(searchResults !== null);

  let displayCommits = $derived(searchResults?.commits ?? commitStore.commits);
  let displayPaths = $derived(commitStore.paths);
  let displayLinks = $derived(commitStore.links);
  let displayDots = $derived(commitStore.dots);
  let displayLeftMargin = $derived(commitStore.commitLeftMargin);


  const ROW_HEIGHT = 32;
  // SourceGit uses unitWidth=12 for X coordinates, we scale them up for display
  const X_SCALE = 1.2; // multiply SourceGit X coords by this for pixel positions
  const BUFFER_ROWS = 20; // Larger buffer to keep lines visible during scroll

  let container: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  let viewportHeight = $state(600);

  let totalHeight = $derived(displayCommits.length * ROW_HEIGHT);

  let graphWidth = $derived.by(() => {
    if (displayLeftMargin.length > 0) {
      const maxMargin = Math.max(...displayLeftMargin);
      return Math.ceil(maxMargin * X_SCALE) + 4;
    }
    return 30;
  });

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

  // Hash → commit lookup map
  let commitMap = $derived.by(() => {
    const map = new Map<string, typeof displayCommits[0]>();
    for (const c of displayCommits) {
      map.set(c.hash, c);
    }
    return map;
  });

  function laneX(col: number): number {
    return col * X_SCALE;
  }

  function handleScroll() {
    if (container) {
      scrollTop = container.scrollTop;
    }
  }

  function handleResize() {
    if (container) {
      viewportHeight = container.clientHeight;
    }
  }

  function selectCommit(hash: string) {
    uiStore.selectCommit(uiStore.selectedCommitHash === hash ? null : hash);
  }

  function onCommitContextMenu(e: MouseEvent, commit: Commit) {
    e.preventDefault();
    contextMenuHash = commit.hash;
    const currentBranch = branchStore.currentBranch?.name ?? 'HEAD';
    const items: any[] = [];

    // ── Ref submenus ──
    const refs = commit.refs.filter(r => {
      if (r.type === 'remote-branch' && r.name === 'HEAD') return false;
      return true;
    }).sort((a, b) => {
      const order = { head: 0, branch: 1, 'remote-branch': 2, tag: 3, stash: 4 };
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
            icon: 'folder-opened',
            action: () => {},
            children: [
              {
                label: t('sidebar.checkout'),
                action: () => doCheckout(branchName),
              },
              {
                label: t('graph.mergeInto', { branch: currentBranch }),
                action: () => { mergeTarget = branchName; showMergeModal = true; },
              },
              { separator: true, label: '', action: () => {} },
              {
                label: t('graph.rename'),
                action: () => { renameBranchOld = branchName; renameBranchNew = branchName; showRenameBranchModal = true; },
              },
              {
                label: t('graph.removeWorktree'),
                action: () => { removeWorktreePath = linkedWt.path; removeWorktreeBranch = branchName; deleteWorktreeBranch = false; showRemoveWorktreeModal = true; },
                danger: true,
              },
              {
                label: t('graph.deleteBranch'),
                action: () => { deleteBranchName = branchName; showDeleteBranchModal = true; },
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
                label: t('graph.mergeInto', { branch: currentBranch }),
                action: () => { mergeTarget = branchName; showMergeModal = true; },
              },
              { separator: true, label: '', action: () => {} },
              {
                label: t('graph.rename'),
                action: () => { renameBranchOld = branchName; renameBranchNew = branchName; showRenameBranchModal = true; },
              },
              {
                label: t('graph.deleteBranch'),
                action: () => { deleteBranchName = branchName; showDeleteBranchModal = true; },
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
              action: () => { mergeTarget = fullName; showMergeModal = true; },
            },
            { separator: true, label: '', action: () => {} },
            {
              label: t('graph.deleteRemoteBranch'),
              action: () => { deleteRemoteBranchRemote = ref.remote!; deleteRemoteBranchName = ref.name; showDeleteRemoteBranchModal = true; },
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
        items.push({
          label: ref.name,
          icon: 'tag',
          action: () => {},
          children: [
            {
              label: t('sidebar.checkout'),
              action: () => vscode.postMessage({ type: 'checkout', payload: { ref: ref.name } }),
            },
            {
              label: t('graph.deleteTag'),
              action: () => { deleteTagName = ref.name; showDeleteTagModal = true; },
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
        const stashEntry = branchStore.stashes.find((_s, i) => i === 0);
        items.push({
          label: `stash: ${stashEntry?.message ?? 'stash@{0}'}`,
          icon: 'archive',
          action: () => {},
          children: [
            {
              label: t('sidebar.apply'),
              action: () => vscode.postMessage({ type: 'stashApply', payload: { index: 0, drop: false } }),
            },
            {
              label: t('sidebar.pop'),
              action: () => vscode.postMessage({ type: 'stashApply', payload: { index: 0, drop: true } }),
            },
            { separator: true, label: '', action: () => {} },
            {
              label: t('sidebar.drop'),
              action: () => vscode.postMessage({ type: 'stashDrop', payload: { index: 0 } }),
              danger: true,
            },
          ],
        });
      }
    }

    // Separator after refs (only if there were any refs)
    if (refs.length > 0) {
      items.push({ separator: true, label: '', action: () => {} });
    }

    // ── Create actions ──
    items.push(
      {
        label: t('graph.createBranchHere'),
        action: () => { createBranchStartPoint = commit.hash; createBranchSubject = commit.subject; showCreateBranchModal = true; },
      },
      {
        label: t('graph.newTag'),
        action: () => { createTagRef = commit.hash; createTagSubject = commit.subject; showCreateTagModal = true; },
      },
    );

    // ── Branch operations ──
    items.push(
      { separator: true, label: '', action: () => {} },
      {
        label: t('graph.mergeInto', { branch: currentBranch }),
        action: () => { mergeTarget = commit.hash; showMergeModal = true; },
      },
      {
        label: t('graph.rebaseTo', { branch: currentBranch }),
        action: () => { rebaseTarget = commit.hash; showRebaseModal = true; },
      },
      {
        label: t('graph.interactiveRebaseTo', { branch: currentBranch }),
        action: () => { interactiveRebaseBase = commit.hash; },
      },
    );

    // ── Reset ──
    items.push(
      { separator: true, label: '', action: () => {} },
      {
        label: t('graph.resetBranchToHere', { branch: currentBranch }),
        action: () => { resetTarget = commit.hash; resetMode = 'mixed'; showResetModal = true; },
      },
    );

    // ── Commit operations ──
    items.push(
      { separator: true, label: '', action: () => {} },
      {
        label: t('graph.checkoutCommit'),
        action: () => vscode.postMessage({ type: 'checkout', payload: { ref: commit.hash } }),
      },
      {
        label: t('graph.cherryPickCommit'),
        action: () => { cherryPickTarget = commit.hash; cherryPickNoCommit = false; showCherryPickModal = true; },
      },
      {
        label: t('graph.revertCommit'),
        action: () => { revertTarget = commit.hash; revertNoCommit = false; showRevertModal = true; },
      },
      {
        label: t('graph.savePatch'),
        action: () => vscode.postMessage({ type: 'saveCommitPatch', payload: { hash: commit.hash } }),
      },
    );

    // ── Compare ──
    items.push({ separator: true, label: '', action: () => {} });
    items.push({
      label: t('graph.compareToLocal'),
      action: () => {
        uiStore.comparing = true;
        uiStore.selectedCommitHash = null;
        uiStore.compareRef1 = commit.hash;
        uiStore.compareRef2 = null;
        uiStore.showBottomPanel = true;
        vscode.postMessage({ type: 'compareToWorking', payload: { hash: commit.hash } });
      },
    });

    if (compareBase) {
      items.push({
        label: t('graph.compareWith', { hash: compareBase.substring(0, 7) }),
        action: () => {
          uiStore.comparing = true;
          uiStore.selectedCommitHash = null;
          uiStore.compareRef1 = compareBase;
          uiStore.compareRef2 = commit.hash;
          uiStore.showBottomPanel = true;
          vscode.postMessage({ type: 'compareCommits', payload: { ref1: compareBase!, ref2: commit.hash } });
          compareBase = null;
        },
      });
      items.push({
        label: t('graph.cancelCompare'),
        action: () => { compareBase = null; },
      });
    } else {
      items.push({
        label: t('graph.selectForCompare'),
        action: () => { compareBase = commit.hash; uiStore.selectedCommitHash = null; uiStore.showBottomPanel = false; },
      });
    }

    // ── Copy SHA ──
    items.push(
      { separator: true, label: '', action: () => {} },
      {
        label: t('graph.copySHA'),
        action: () => vscode.postMessage({ type: 'copyToClipboard', payload: { text: commit.hash } }),
      },
    );

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

  $effect(() => {
    if (container) {
      viewportHeight = container.clientHeight;
    }
  });
</script>

<svelte:window onresize={handleResize} />

<div class="commit-graph" bind:this={container} onscroll={handleScroll}>
  {#if commitStore.loading && !isSearchActive}
    <div class="loading"><span class="spinner"></span> {t('graph.loading')}</div>
  {:else if displayCommits.length === 0}
    <div class="empty">{isSearchActive ? t('graph.noResults') : t('graph.noCommits')}</div>
  {:else}
    {#if isSearchActive}
      <div class="search-info">
        {t('graph.searchResults', { count: displayCommits.length, plural: displayCommits.length !== 1 ? 's' : '' })}
      </div>
    {/if}

    <!-- Column headers -->
    <div class="graph-header">
      <div class="col-message">{t('graph.description')}</div>
      <div class="col-author">{t('graph.author')}</div>
      <div class="col-hash">{t('graph.sha')}</div>
      <div class="col-date">{t('graph.date')}</div>
    </div>

    <!-- Virtual scroll container -->
    <div class="scroll-content" style="height: {totalHeight}px; position: relative;">
      <!-- SVG for graph — SourceGit-style Path + Link + Dot rendering -->
      <svg
        class="graph-lines"
        width={graphWidth}
        style="position: absolute; top: 0; height: {totalHeight}px; overflow: visible;"
      >
        <!-- Paths: continuous branch lines -->
        {#each displayPaths as path}
          {@const pathColor = COLOR_PALETTE[path.color % COLOR_PALETTE.length]}
          {@const pathD = buildPathD(path.points)}
          {#if pathD}
            <path d={pathD} fill="none" stroke={pathColor} stroke-width="5" opacity="0.07" stroke-linecap="round" />
            <path d={pathD} fill="none" stroke={pathColor} stroke-width="2" opacity="0.85" stroke-linecap="round" />
          {/if}
        {/each}

        <!-- Links: merge connection curves -->
        {#each displayLinks as link}
          {@const linkColor = COLOR_PALETTE[link.color % COLOR_PALETTE.length]}
          {@const sx = laneX(link.start.x)}
          {@const sy = link.start.y * ROW_HEIGHT}
          {@const cx = laneX(link.control.x)}
          {@const cy = link.control.y * ROW_HEIGHT}
          {@const ex = laneX(link.end.x)}
          {@const ey = link.end.y * ROW_HEIGHT}
          <path
            d="M {sx} {sy} Q {cx} {cy}, {ex} {ey}"
            fill="none" stroke={linkColor} stroke-width="5" opacity="0.07" stroke-linecap="round"
          />
          <path
            d="M {sx} {sy} Q {cx} {cy}, {ex} {ey}"
            fill="none" stroke={linkColor} stroke-width="2" opacity="0.85" stroke-linecap="round"
          />
        {/each}

        <!-- Dots: commit nodes -->
        {#each displayDots as dot, i}
          {@const dotColor = COLOR_PALETTE[dot.color % COLOR_PALETTE.length]}
          {@const dx = laneX(dot.center.x)}
          {@const dy = dot.center.y * ROW_HEIGHT}
          {#if dot.type === 'head'}
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
      >
        {#each visibleCommits as { commit, index } (commit.hash)}
          {@const dot = displayDots[index]}
          {@const nodeColor = dot ? COLOR_PALETTE[dot.color % COLOR_PALETTE.length] : '#888'}
          {@const isRemoteTip = dot?.remoteTip ?? false}
          <div
            class="commit-row"
            class:selected={uiStore.selectedCommitHash === commit.hash}
            class:highlighted={contextMenuHash === commit.hash}
            class:compare-mode={compareBase !== null && compareBase !== commit.hash}
            class:compare-base={compareBase === commit.hash}
            class:compare-active={uiStore.comparing && (uiStore.compareRef1 === commit.hash || uiStore.compareRef2 === commit.hash)}
            style="height: {ROW_HEIGHT}px;"
            onclick={() => {
              if (compareBase && compareBase !== commit.hash) {
                uiStore.comparing = true;
                uiStore.selectedCommitHash = null;
                uiStore.compareRef1 = compareBase;
                uiStore.compareRef2 = commit.hash;
                uiStore.showBottomPanel = true;
                vscode.postMessage({ type: 'compareCommits', payload: { ref1: compareBase, ref2: commit.hash } });
                compareBase = null;
                return;
              }
              if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
              clickTimer = setTimeout(() => { clickTimer = null; selectCommit(commit.hash); }, 200);
            }}
            ondblclick={() => {
              if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
              const localRef = commit.refs.find(r => r.type === 'head' || r.type === 'branch');
              if (localRef) {
                doCheckout(localRef.name);
              } else {
                checkoutCommitHash = commit.hash;
                showCheckoutCommitModal = true;
              }
            }}
            oncontextmenu={(e) => onCommitContextMenu(e, commit)}
            role="row"
            tabindex={0}
            onkeydown={(e) => { if (e.key === 'Enter') selectCommit(commit.hash); }}
          >
            <div class="col-message" style="padding-left: {(displayLeftMargin[index] ?? graphWidth) * X_SCALE + 4}px;">
              {#if dot?.localOnly && currentBranchCommits.has(commit.hash)}
                <span class="local-dot" title="Not pushed"></span>
              {:else if currentBranchRemoteAhead.has(commit.hash)}
                <span class="remote-dot" title="Remote only"></span>
              {/if}
              {#each commit.refs.filter(r => {
                  if (r.type === 'remote-branch') {
                    if (r.name === 'HEAD') return false;
                    // Hide remote badge only if a local branch explicitly tracks it
                    const localRefs = commit.refs.filter(lr => lr.type === 'branch' || lr.type === 'head');
                    for (const lr of localRefs) {
                      const localInfo = branchStore.branches.find(b => !b.remote && b.name === lr.name);
                      if (localInfo?.upstream === `${r.remote}/${r.name}`) return false;
                    }
                  }
                  return true;
                }).sort((a, b) => {
                  const order = { head: 0, branch: 1, 'remote-branch': 2, tag: 3, stash: 4 };
                  return (order[a.type] ?? 4) - (order[b.type] ?? 4);
                }) as ref}
                  {@const hasRemote = (ref.type === 'branch' || ref.type === 'head') && (() => {
                    const localInfo = branchStore.branches.find(b => !b.remote && b.name === ref.name);
                    if (!localInfo?.upstream) return false;
                    return commit.refs.some(r => r.type === 'remote-branch' && `${r.remote}/${r.name}` === localInfo.upstream);
                  })()}
                  {@const isWtBranch = (ref.type === 'branch' || ref.type === 'head') && worktreeBranches.has(ref.name)}
                  {@const badgeColor = ref.type === 'tag' ? '#f0c040' : ref.type === 'stash' ? '#c24de0' : isWtBranch ? '#4caf50' : nodeColor}
                  <span
                    class="ref-badge"
                    style="--badge-color: {badgeColor};"
                    class:badge-bold={ref.type === 'head' || ref.type === 'tag' || ref.type === 'stash' || isWtBranch}
                    title="Double-click to checkout: {ref.type === 'remote-branch' ? `${ref.remote}/${ref.name}` : ref.name}"
                    ondblclick={(e) => {
                      e.stopPropagation();
                      if (ref.type === 'remote-branch') {
                        doCheckoutRemote(`${ref.remote}/${ref.name}`, ref.name);
                      } else if (ref.type === 'tag' || ref.type === 'stash') {
                        checkoutCommitHash = ref.type === 'stash' ? commit.hash : ref.name;
                        showCheckoutCommitModal = true;
                      } else {
                        doCheckout(ref.name);
                      }
                    }}
                    role="button"
                    tabindex={0}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') {
                        if (ref.type === 'remote-branch') {
                          doCheckoutRemote(`${ref.remote}/${ref.name}`, ref.name);
                        } else if (ref.type === 'tag' || ref.type === 'stash') {
                          checkoutCommitHash = ref.type === 'stash' ? commit.hash : ref.name;
                          showCheckoutCommitModal = true;
                        } else {
                          vscode.postMessage({ type: 'checkout', payload: { ref: ref.name } });
                        }
                      }
                    }}
                  >
                    {#if ref.type === 'head'}
                      <i class="codicon codicon-check ref-icon"></i>
                      {#if hasRemote}<i class="codicon codicon-cloud ref-icon"></i>{/if}
                      {#if worktreeBranches.has(ref.name)}<i class="codicon codicon-folder-opened ref-icon"></i>{/if}
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
                      {#if hasRemote}<i class="codicon codicon-cloud ref-icon"></i>{/if}
                      {#if (ref.type === 'branch') && worktreeBranches.has(ref.name)}<i class="codicon codicon-folder-opened ref-icon"></i>{/if}
                      {ref.name}
                    {/if}
                  </span>
                {/each}
                <span class="commit-subject truncate" title={commit.subject}>{commit.subject}</span>
            </div>
              <div class="col-author truncate" title={commit.author.name}>
                <img class="avatar-sm" src={getGravatarUrl(commit.author.email, 20)} alt="" loading="lazy" />
                {commit.author.name}
              </div>
              <div class="col-hash" title={commit.hash}>{commit.abbreviatedHash}</div>
              <div class="col-date" title={new Date(commit.author.date).toLocaleString()}>{formatDate(commit.author.date)}</div>
          </div>
        {/each}
      </div>

    </div>
  {/if}
</div>

{#if compareBase}
  <div class="compare-indicator">
    <i class="codicon codicon-git-compare"></i>
    <span class="compare-label">{t('graph.comparingFrom')}</span>
    <span class="compare-hash">{compareBase.substring(0, 7)}</span>
    <button class="compare-cancel" aria-label="Cancel compare" onclick={() => { compareBase = null; }}>
      <i class="codicon codicon-close"></i>
    </button>
  </div>
{/if}

{#if contextMenu}
  <ContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={contextMenu.items}
    onClose={() => { contextMenu = null; if (!showMergeModal && !showRebaseModal && !showCherryPickModal && !showRevertModal && !showResetModal && !showDeleteTagModal && !showDeleteBranchModal && !showDeleteRemoteBranchModal && !showRemoveWorktreeModal && !showCreateTagModal && !showCreateBranchModal) contextMenuHash = null; }}
  />
{/if}

{#if interactiveRebaseBase}
  <InteractiveRebase
    base={interactiveRebaseBase}
    onClose={() => { interactiveRebaseBase = null; }}
  />
{/if}

{#if showResetModal}
  <Modal title={t('reset.modalTitle')} onClose={() => { showResetModal = false; contextMenuHash = null; }}>
    <p class="modal-desc">{t('reset.desc')}</p>
    <div class="modal-field-row"><span class="modal-field-label">{t('reset.branch')}</span><span class="modal-pill modal-pill--target">{branchStore.currentBranch?.name ?? 'current branch'}</span></div>
    <div class="modal-field-row"><span class="modal-field-label">{t('reset.moveTo')}</span><span class="modal-hash">{resetTarget.substring(0, 7)}</span></div>
      <div class="modal-form-group">
        <div class="modal-field-label">{t('reset.resetType')}</div>
        <ColorSelect
          options={[
            { value: 'soft', label: t('reset.softOption'), color: '#4caf50' },
            { value: 'mixed', label: t('reset.mixedOption'), color: '#ff9800' },
            { value: 'hard', label: t('reset.hardOption'), color: '#f44336', warning: t('reset.hardWarning') },
          ]}
          value={resetMode}
          onChange={(v) => { resetMode = v as typeof resetMode; }}
        />
      </div>
    <div class="form-actions">
      <button onclick={() => { showResetModal = false; contextMenuHash = null; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => {
          vscode.postMessage({ type: 'reset', payload: { ref: resetTarget, mode: resetMode } });
          showResetModal = false;
          contextMenuHash = null;
        }}>{t('reset.resetBtn')}</button>
    </div>
  </Modal>
{/if}

{#if showMergeModal}
  <MergeBranchModal
    source={mergeTarget}
    target={branchStore.currentBranch?.name ?? 'current branch'}
    onClose={() => { showMergeModal = false; contextMenuHash = null; }}
    onMerge={(options) => { showMergeModal = false; contextMenuHash = null; vscode.postMessage({ type: 'merge', payload: { branch: mergeTarget, ...options } }); }}
  />
{/if}

{#if showRebaseModal}
  <RebaseBranchModal
    branch={branchStore.currentBranch?.name ?? 'current branch'}
    onto={rebaseTarget}
    onClose={() => { showRebaseModal = false; contextMenuHash = null; }}
    onRebase={(options) => { showRebaseModal = false; contextMenuHash = null; vscode.postMessage({ type: 'rebase', payload: { onto: rebaseTarget, autostash: options.autostash } }); }}
  />
{/if}

{#if showCherryPickModal}
  <Modal title={t('cherryPick.title')} onClose={() => { showCherryPickModal = false; contextMenuHash = null; }}>
    <p class="modal-desc">{t('cherryPick.desc')}</p>
    <div class="modal-field-row"><span class="modal-field-label">{t('common.commit')}</span><span class="modal-hash">{cherryPickTarget.substring(0, 7)}</span></div>
    <div class="modal-field-row"><span class="modal-field-label">{t('common.onto')}</span><span class="modal-pill modal-pill--target">{branchStore.currentBranch?.name ?? 'current branch'}</span></div>
    <div class="modal-field-row">
        <span class="modal-field-label">{t('common.options')}</span>
        <label class="modal-checkbox">
          <input type="checkbox" bind:checked={cherryPickNoCommit} />
          <span>{t('cherryPick.noCommit')}</span>
        </label>
    </div>
    <div class="form-actions">
      <button onclick={() => { showCherryPickModal = false; contextMenuHash = null; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => { showCherryPickModal = false; contextMenuHash = null; vscode.postMessage({ type: 'cherryPick', payload: { commit: cherryPickTarget, noCommit: cherryPickNoCommit } }); }}>{t('cherryPick.cherryPick')}</button>
    </div>
  </Modal>
{/if}

{#if showRevertModal}
  <Modal title={t('revert.title')} onClose={() => { showRevertModal = false; contextMenuHash = null; }}>
    <p class="modal-desc">{t('revert.desc')}</p>
    <div class="modal-field-row"><span class="modal-field-label">{t('common.commit')}</span><span class="modal-hash">{revertTarget.substring(0, 7)}</span></div>
    <div class="modal-field-row"><span class="modal-field-label">{t('common.branch')}</span><span class="modal-pill modal-pill--target">{branchStore.currentBranch?.name ?? 'current branch'}</span></div>
    <div class="modal-field-row">
        <span class="modal-field-label">{t('common.options')}</span>
        <label class="modal-checkbox">
          <input type="checkbox" bind:checked={revertNoCommit} />
          <span>{t('revert.noCommit')}</span>
        </label>
    </div>
    <div class="form-actions">
      <button onclick={() => { showRevertModal = false; contextMenuHash = null; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => { showRevertModal = false; contextMenuHash = null; vscode.postMessage({ type: 'revert', payload: { commit: revertTarget, noCommit: revertNoCommit } }); }}>{t('revert.revert')}</button>
    </div>
  </Modal>
{/if}

{#if showDeleteTagModal}
  <DeleteTagModal
    tagName={deleteTagName}
    hasRemote={branchStore.remotes.length > 0}
    onClose={() => { showDeleteTagModal = false; contextMenuHash = null; }}
    onDelete={(deleteRemote) => { showDeleteTagModal = false; contextMenuHash = null; vscode.postMessage({ type: 'deleteTag', payload: { name: deleteTagName } }); if (deleteRemote) vscode.postMessage({ type: 'deleteRemoteTag', payload: { name: deleteTagName } }); }}
  />
{/if}

{#if showCreateTagModal}
  <CreateTagModal
    startPoint={createTagRef}
    subject={createTagSubject}
    onClose={() => { showCreateTagModal = false; contextMenuHash = null; }}
    onCreate={(name, message, startPoint, push) => { showCreateTagModal = false; contextMenuHash = null; vscode.postMessage({ type: 'createTag', payload: { name, ref: startPoint, message: message || undefined } }); if (push) vscode.postMessage({ type: 'pushTag', payload: { name } }); }}
  />
{/if}

{#if showCreateBranchModal}
  <CreateBranchModal
    startPoint={createBranchStartPoint}
    subject={createBranchSubject}
    onClose={() => { showCreateBranchModal = false; contextMenuHash = null; }}
    onCreate={(name, startPoint, checkout) => { showCreateBranchModal = false; contextMenuHash = null; vscode.postMessage({ type: 'createBranch', payload: { name, startPoint, checkout } }); }}
  />
{/if}

{#if showDeleteBranchModal}
  <DeleteBranchModal
    branchName={deleteBranchName}
    onClose={() => { showDeleteBranchModal = false; contextMenuHash = null; }}
    onDelete={(force, deleteWorktreePath, deleteRemote) => { showDeleteBranchModal = false; contextMenuHash = null; vscode.postMessage({ type: 'deleteBranch', payload: { name: deleteBranchName, force, worktreePath: deleteWorktreePath, deleteRemote } }); }}
  />
{/if}

{#if showDeleteRemoteBranchModal}
  <Modal title={t('deleteRemoteBranch.title')} onClose={() => { showDeleteRemoteBranchModal = false; contextMenuHash = null; }}>
    <p class="modal-desc">{@html t('deleteRemoteBranch.confirm', { name: `<span class="modal-pill modal-pill--danger">${deleteRemoteBranchRemote}/${deleteRemoteBranchName}</span>` })}</p>
    <div class="form-actions">
      <button onclick={() => { showDeleteRemoteBranchModal = false; contextMenuHash = null; }}>{t('common.cancel')}</button>
      <button class="danger-btn" onclick={() => { showDeleteRemoteBranchModal = false; contextMenuHash = null; vscode.postMessage({ type: 'deleteRemoteBranch', payload: { remote: deleteRemoteBranchRemote, name: deleteRemoteBranchName } }); }}>{t('sidebar.delete')}</button>
    </div>
  </Modal>
{/if}

{#if showRemoveWorktreeModal}
  <Modal title={t('worktree.removeTitle')} onClose={() => { showRemoveWorktreeModal = false; contextMenuHash = null; }}>
    <p class="modal-desc">{t('worktree.removeConfirm', { path: removeWorktreePath })}</p>
    {#if removeWorktreeBranch}
      <div class="modal-form-group">
        <label class="modal-checkbox modal-checkbox--danger">
          <input type="checkbox" bind:checked={deleteWorktreeBranch} />
          <span>{t('worktree.deleteBranch', { name: removeWorktreeBranch })}</span>
        </label>
      </div>
    {/if}
    <div class="form-actions">
      <button onclick={() => { showRemoveWorktreeModal = false; contextMenuHash = null; }}>{t('common.cancel')}</button>
      <button class="danger-btn" onclick={() => { showRemoveWorktreeModal = false; contextMenuHash = null; vscode.postMessage({ type: 'worktreeRemove', payload: { path: removeWorktreePath, deleteBranch: deleteWorktreeBranch ? removeWorktreeBranch : undefined } }); }}>{t('sidebar.delete')}</button>
    </div>
  </Modal>
{/if}

{#if showCheckoutRemoteModal}
  <CheckoutRemoteModal
    remoteName={checkoutRemoteName}
    defaultLocalName={checkoutRemoteLocalName}
    onClose={() => { showCheckoutRemoteModal = false; }}
    onCheckout={(localName) => { showCheckoutRemoteModal = false; vscode.postMessage({ type: 'createBranch', payload: { name: localName, startPoint: checkoutRemoteName, checkout: true } }); }}
  />
{/if}

{#if showCheckoutCommitModal}
  <Modal title={t('checkoutCommit.title')} onClose={() => { showCheckoutCommitModal = false; }}>
    <p class="modal-desc">{t('checkoutCommit.desc', { hash: '' })} <span class="modal-hash">{checkoutCommitHash.substring(0, 7)}</span></p>
    <div class="form-actions">
      <button onclick={() => { showCheckoutCommitModal = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => {
        showCheckoutCommitModal = false;
        vscode.postMessage({ type: 'checkout', payload: { ref: checkoutCommitHash } });
      }}>{t('checkoutCommit.checkout')}</button>
    </div>
  </Modal>
{/if}

{#if showPullAfterCheckoutModal}
  <PullAfterCheckoutModal
    branchName={pullAfterCheckoutRef}
    behind={pullAfterCheckoutBehind}
    onClose={() => { showPullAfterCheckoutModal = false; }}
    onCheckoutOnly={() => { showPullAfterCheckoutModal = false; vscode.postMessage({ type: 'checkout', payload: { ref: pullAfterCheckoutRef } }); }}
    onCheckoutAndPull={() => { showPullAfterCheckoutModal = false; vscode.postMessage({ type: 'checkout', payload: { ref: pullAfterCheckoutRef, pullAfter: true } }); }}
  />
{/if}

{#if showRenameBranchModal}
  <Modal title={t('renameBranch.title')} onClose={() => { showRenameBranchModal = false; }}>
    <div class="modal-context-card">
      <span class="modal-pill modal-pill--target">{renameBranchOld}</span>
    </div>
    <div class="modal-form-group">
      <label class="modal-field-label" for="ctx-rename-input">{t('renameBranch.newName', { name: renameBranchOld })}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="ctx-rename-input" class="modal-input" type="text" bind:value={renameBranchNew} autofocus
        onkeydown={(e) => { if (e.key === 'Enter' && renameBranchNew.trim() && renameBranchNew !== renameBranchOld) { showRenameBranchModal = false; vscode.postMessage({ type: 'renameBranch', payload: { oldName: renameBranchOld, newName: renameBranchNew.trim() } }); } }} />
    </div>
    <div class="form-actions">
      <button onclick={() => { showRenameBranchModal = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => { showRenameBranchModal = false; vscode.postMessage({ type: 'renameBranch', payload: { oldName: renameBranchOld, newName: renameBranchNew.trim() } }); }}
        disabled={!renameBranchNew.trim() || renameBranchNew === renameBranchOld}>{t('renameBranch.rename')}</button>
    </div>
  </Modal>
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

  .search-info {
    padding: 6px 14px;
    font-size: 11px;
    color: var(--text-link);
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
  }

  /* ---- Header ---- */
  .graph-header {
    display: flex;
    align-items: center;
    height: 32px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-secondary);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .graph-header > div {
    padding: 0 10px;
  }

  /* ---- SVG layer — must be ABOVE rows so nodes/lines are visible ---- */
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
    cursor: pointer;
    transition: background 0.08s;
    user-select: none;
  }

  .commit-row:hover {
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

  .commit-row.highlighted:not(.selected) {
    background: var(--bg-hover);
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: -1px;
  }

  .commit-row:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: -1px;
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

  .local-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
    background: #4da6ff;
    opacity: 0.8;
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
    font-size: 12px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .avatar-sm {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .commit-row.selected .col-author,
  .commit-row.selected .col-date,
  .commit-row.selected .col-hash {
    color: var(--text-selected);
    opacity: 0.8;
  }

  .col-date {
    width: 140px;
    flex-shrink: 0;
    padding: 0 10px;
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .col-hash {
    width: 75px;
    flex-shrink: 0;
    padding: 0 10px;
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--text-secondary);
    opacity: 0.7;
  }

  .commit-subject {
    flex: 1;
    min-width: 0;
    font-size: 13px;
  }

  /* ---- Ref badges ---- */
  .ref-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 7px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
    line-height: 16px;
    cursor: pointer;
    transition: filter 0.1s;
    /* Dark theme defaults */
    background: color-mix(in srgb, var(--badge-color) 15%, transparent);
    color: #fff;
    border: 1px solid color-mix(in srgb, var(--badge-color) 25%, transparent);
  }

  .ref-badge.badge-bold {
    background: color-mix(in srgb, var(--badge-color) 55%, transparent);
    border-color: color-mix(in srgb, var(--badge-color) 70%, transparent);
  }

  /* Light theme overrides */
  :global(body.vscode-light) .ref-badge {
    background: color-mix(in srgb, var(--badge-color) 18%, transparent);
    color: color-mix(in srgb, var(--badge-color) 85%, #000);
    border: 1px solid color-mix(in srgb, var(--badge-color) 40%, transparent);
  }

  :global(body.vscode-light) .ref-badge.badge-bold {
    background: color-mix(in srgb, var(--badge-color) 75%, #fff);
    color: #fff;
    border-color: color-mix(in srgb, var(--badge-color) 85%, transparent);
  }

  /* High contrast overrides */
  :global(body.vscode-high-contrast) .ref-badge {
    background: color-mix(in srgb, var(--badge-color) 30%, transparent);
    color: #fff;
    border: 1px solid var(--badge-color);
  }

  .ref-badge:hover {
    filter: brightness(1.2);
  }

  :global(body.vscode-light) .ref-badge:hover {
    filter: brightness(0.9);
  }

  .ref-icon {
    font-size: 12px;
    flex-shrink: 0;
  }


  /* ---- Compare indicator ---- */
  .compare-indicator {
    position: fixed;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(99, 176, 244, 0.15);
    border: 1px solid rgba(99, 176, 244, 0.4);
    color: #63b0f4;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 100;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    backdrop-filter: blur(8px);
  }

  .compare-label {
    color: var(--text-secondary);
    font-size: 11px;
  }

  .compare-hash {
    font-family: monospace;
    font-weight: 600;
    color: #63b0f4;
  }

  .compare-cancel {
    background: transparent;
    color: var(--text-secondary);
    border: none;
    padding: 2px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    font-size: 12px;
  }

  .compare-cancel:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-primary);
  }

  /* ---- Modal styles ---- */
  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

</style>
