<script lang="ts">
  import type { Commit, DiffData, CommitSignature } from '../../lib/types';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { branchStore } from '../../lib/stores/branches.svelte';
  import { uiStore } from '../../lib/stores/ui.svelte';
  import { commitStore } from '../../lib/stores/commits.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { avatarStore } from '../../lib/stores/avatars.svelte';
  import FileDiffView from './FileDiffView.svelte';
  import type { ReverseTarget } from './FileDiffView.svelte';
  import ContextMenu from '../common/ContextMenu.svelte';
  import CommitHoverCard from '../common/CommitHoverCard.svelte';
  import { tooltip } from '../../lib/actions/tooltip';
  import { modalStore } from '../../lib/stores/modals.svelte';
  import LinkifiedText from '../common/LinkifiedText.svelte';
  import Markdown from '../common/Markdown.svelte';
  import { hasMarkdown } from '../../lib/markdown-detect';

  interface Props {
    commit?: Commit;
  }

  let { commit }: Props = $props();

  // Commit message rendering: auto-detect Markdown per commit. When the message
  // has no Markdown we show plain text with no toggle. When it does, we default
  // to Markdown and let the user switch to plain — that choice applies only
  // while viewing this commit (keyed by hash), so navigating re-detects.
  let messageOverride = $state<{ hash: string; mode: 'markdown' | 'plain' } | null>(null);
  const messageText = $derived(
    commit ? (commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject) : '',
  );
  const messageHasMarkdown = $derived(hasMarkdown(messageText));
  const messageMode = $derived<'markdown' | 'plain'>(
    messageOverride && commit && messageOverride.hash === commit.hash
      ? messageOverride.mode
      : 'markdown',
  );

  const vscode = getVsCodeApi();

  interface CommitFile {
    path: string;
    status: string; // A=added, M=modified, D=deleted, R=renamed, C=copied
  }

  let files = $state<CommitFile[]>([]);
  let diffs = $state<DiffData[]>([]);
  let sections = $state<Array<{ file: string; commit: string; diff: DiffData }>>([]);
  let selectedFile = $state<string | null>(null);
  // Files Ctrl/Cmd-clicked for "Create Patch from selected" (committed view only).
  let selectedPatchFiles = $state<Set<string>>(new Set());
  let uncommittedFiles = $state<{ staged: CommitFile[]; unstaged: CommitFile[] } | null>(null);
  let uncommittedDiffCache = $state(new Map<string, DiffData>());
  let lfsFiles = $state<Array<{ oid: string; path: string }>>([]);
  let lfsLocks = $state<Array<{ path: string; owner: string; id: string }>>([]);
  // On-demand signature for the selected commit, fetched independently of the
  // graph-wide setting so the panel always shows verification status.
  let signature = $state<CommitSignature | null>(null);

  // Build a "Name <email>" display for the *verified* signer. git's %GS varies
  // by format: GPG often yields "Name <email>", SSH yields just the principal
  // email. Only a "good" signature has a verified identity, so we only enrich
  // from the committer in that case. For unverified signatures git could not
  // confirm who signed it (%GS is usually empty), so we must NOT fabricate an
  // identity from the committer — we just show whatever %GS actually returned.
  function signerDisplay(): string {
    const s = signature?.signer?.trim() ?? '';
    if (signature?.status !== 'good') return s;
    if (s.includes('<') && s.includes('>')) return s;
    if (s.includes('@')) {
      const name = commit?.committer?.name ?? commit?.author?.name ?? '';
      return name ? `${name} <${s}>` : s;
    }
    if (s) {
      const email = commit?.committer?.email ?? commit?.author?.email ?? '';
      return email ? `${s} <${email}>` : s;
    }
    const name = commit?.committer?.name ?? '';
    const email = commit?.committer?.email ?? '';
    return (name || email) ? `${name} <${email}>`.trim() : '';
  }
  let fileContextMenu = $state<{ x: number; y: number; items: any[] } | null>(null);
  // The row a context menu is currently open on, so it stays outlined (like the
  // commit graph's right-click highlight) until the menu closes. Same key scheme
  // as `selected`: `${staged|unstaged}:path` for uncommitted rows, plain path otherwise.
  let contextMenuRowKey = $state<string | null>(null);

  // Single entry point for every reverse action. Omitting hunkIndex reverses the
  // whole file; omitting lineIndices reverses the whole hunk (see patch-builder).
  function postReverse(commit: string, file: string, hunkIndex?: number, lineIndices?: number[]) {
    vscode.postMessage({ type: 'reverseCommitChanges', payload: { commit, file, hunkIndex, lineIndices } });
  }

  // Right-click on a diff line (committed view) → offer to copy any selected
  // text and to reverse the clicked hunk against the working tree. FileDiffView
  // hands us the location and the hunk index; we build the menu here since this
  // component already owns the ContextMenu host.
  function handleDiffReverse(target: ReverseTarget) {
    const items: Array<{ label: string; action: () => void; danger?: boolean; separator?: boolean }> = [];
    if (target.selectionText) {
      items.push({
        label: t('file.copySelection'),
        action: () => { vscode.postMessage({ type: 'copyToClipboard', payload: { text: target.selectionText } }); fileContextMenu = null; },
      });
    }
    // copyLinesText is '' for a lone blank line, so gate on presence (!== undefined).
    if (target.copyLinesText !== undefined) {
      const text = target.copyLinesText;
      const count = target.copyLinesCount ?? 0;
      items.push({
        label: `${t('file.copyLines')} (${count})`,
        action: () => { vscode.postMessage({ type: 'copyToClipboard', payload: { text } }); fileContextMenu = null; },
      });
    }
    // When the user has dragged a line-selection, offer to reverse just those
    // changed lines (lineIndices) in addition to the whole-hunk action below.
    if (target.selectedLineIndices?.length) {
      const lineIndices = target.selectedLineIndices;
      items.push({
        label: `${t('file.reverseLines')} (${lineIndices.length})`,
        danger: true,
        action: () => { postReverse(target.commitHash, target.file, target.hunkIndex, lineIndices); fileContextMenu = null; },
      });
    }
    items.push({
      label: t('file.reverseHunk'),
      danger: true,
      action: () => { postReverse(target.commitHash, target.file, target.hunkIndex); fileContextMenu = null; },
    });
    fileContextMenu = { x: target.x, y: target.y, items };
  }

  // The per-hunk header "Reverse Hunk" button reverses immediately (no menu).
  function handleHunkReverse(target: Pick<ReverseTarget, 'commitHash' | 'file' | 'hunkIndex'>) {
    postReverse(target.commitHash, target.file, target.hunkIndex);
  }

  // The "Reverse Selected Lines" button reverses just the dragged changed lines.
  function handleLinesReverse(target: Pick<ReverseTarget, 'commitHash' | 'file' | 'hunkIndex'> & { lineIndices: number[] }) {
    postReverse(target.commitHash, target.file, target.hunkIndex, target.lineIndices);
  }
  let previewCommit = $state<Commit | null>(null);
  let previewPos = $state<{ x: number; y: number } | null>(null);
  let hoveredHash = $state<string | null>(null);
  // Bounded LRU so hover previews over many commits don't grow the cache without limit.
  const PREVIEW_CACHE_MAX = 100;
  const previewCache = new Map<string, Commit>();
  function previewCacheSet(hash: string, c: Commit) {
    if (previewCache.has(hash)) previewCache.delete(hash); // re-insert to move to MRU end
    previewCache.set(hash, c);
    if (previewCache.size > PREVIEW_CACHE_MAX) {
      const oldest = previewCache.keys().next().value;
      if (oldest !== undefined) previewCache.delete(oldest);
    }
  }
  function previewCacheGet(hash: string): Commit | undefined {
    const c = previewCache.get(hash);
    if (c) { previewCache.delete(hash); previewCache.set(hash, c); } // bump to MRU
    return c;
  }
  let previewTimeout: ReturnType<typeof setTimeout> | null = null;

  const lfsFileSet = $derived(new Set(lfsFiles.map(f => f.path)));
  const lfsLockMap = $derived(new Map(lfsLocks.map(l => [l.path, l.owner])));

  // The stash this commit represents, if any (graph rows for stashes carry a
  // ref of type 'stash' named `stash@{N}`).
  const stashRef = $derived(commit?.refs?.find(r => r.type === 'stash') ?? null);
  const stashIndex = $derived.by(() => {
    const m = stashRef?.name?.match(/^stash@\{(\d+)\}$/);
    return m ? Number(m[1]) : null;
  });

  // Reversing against the working tree is offered only for a real commit that
  // isn't a stash (stashes offer "restore" instead). Gates every reverse callback
  // passed to FileDiffView and the tree's "Reverse File" action.
  const canReverseInThisView = $derived(!!commit && stashIndex === null);

  let filesPanelWidth = $state(240);
  let isResizing = $state(false);
  let resizeStartX = 0;
  let resizeStartWidth = 0;
  // svelte-ignore state_referenced_locally
  let activeTab = $state<'commit' | 'changes'>(commit ? 'commit' : 'changes');
  let uncommittedTab = $state<'staged' | 'unstaged'>('staged');

  let activeHash = $state('');

  let selectedDiff = $derived(
    activeHash === 'UNCOMMITTED'
      ? (selectedFile ? uncommittedDiffCache.get(selectedFile) ?? null : null)
      : (diffs.find(d => d.file === (selectedFile ?? '')) ?? null)
  );

  let selectedSections = $derived.by(() => {
    if (!selectedFile) return [];
    return sections
      .filter(s => s.file === selectedFile)
      .map(s => ({ ...s, shortHash: s.commit.slice(0, 7), subject: commitStore.getCommit(s.commit)?.subject ?? '' }));
  });

  // True when the selected uncommitted entry is a nested git repo that isn't
  // registered as a submodule — git can't diff inside it, so we show a hint
  // instead of an empty diff pane.
  let selectedIsNestedRepo = $derived.by(() => {
    if (activeHash !== 'UNCOMMITTED' || !selectedFile || !uncommittedFiles) return false;
    const isStaged = selectedFile.startsWith('staged:');
    const filePath = selectedFile.replace(/^(staged|unstaged):/, '');
    const list = isStaged ? uncommittedFiles.staged : uncommittedFiles.unstaged;
    return list.some(f => f.path === filePath && f.status === 'N');
  });

  function startResize(e: MouseEvent) {
    isResizing = true;
    resizeStartX = e.clientX;
    resizeStartWidth = filesPanelWidth;
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', stopResize);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }

  function onResizeMove(e: MouseEvent) {
    if (!isResizing) return;
    const delta = e.clientX - resizeStartX;
    filesPanelWidth = Math.min(480, Math.max(120, resizeStartWidth + delta));
  }

  function stopResize() {
    if (!isResizing) return;
    isResizing = false;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', stopResize);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }

  onDestroy(() => {
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', stopResize);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    // A hover-preview timer may still be pending when the panel closes; without
    // this it fires post-unmount and posts a now-pointless getCommitData.
    if (previewTimeout) clearTimeout(previewTimeout);
  });

  // Request commit diff only when hash actually changes (not on object reference changes from fullRefresh)
  $effect(() => {
    const hash = commit?.hash ?? '';
    if (hash !== activeHash) {
      activeHash = hash;
      files = [];
      diffs = [];
      sections = [];
      selectedFile = null;
      selectedPatchFiles = new Set();
      uncommittedFiles = null;
      uncommittedDiffCache = new Map();
      signature = null;
      if (hash === 'UNCOMMITTED') {
        activeTab = 'changes';
        vscode.postMessage({ type: 'getUncommittedDiff' });
      } else if (hash) {
        vscode.postMessage({ type: 'getCommitDiff', payload: { hash } });
        vscode.postMessage({ type: 'getLfsFiles' });
        vscode.postMessage({ type: 'getCommitSignature', payload: { hash } });
      }
    }
  });

  // Compare mode keeps activeHash === '' across successive comparisons, so the
  // hash-based reset above never fires when the user switches compare target.
  // Clear the stale file list/diffs the moment the compare refs change, so the
  // panel doesn't show the previous comparison's files until the new data lands.
  $effect(() => {
    // Track the compare target; only meaningful while comparing with no commit.
    const r1 = uiStore.compareRef1;
    const r2 = uiStore.compareRef2;
    if (!commit && uiStore.comparing) {
      // Read r1/r2 above so this effect re-runs whenever they change.
      void r1; void r2;
      files = [];
      diffs = [];
      sections = [];
      selectedFile = null;
      selectedPatchFiles = new Set();
    }
  });

  $effect(() => {
    if (selectedFile && activeHash && activeHash !== 'UNCOMMITTED') {
      // Check if we already have the diff
      if (!diffs.some(d => d.file === selectedFile)) {
         vscode.postMessage({ type: 'getFileDiff', payload: { hash: activeHash, file: selectedFile } });
      }
    }
  });

  onMount(() => {
    function handleMessage(event: MessageEvent) {
      const msg = event.data;
      if (msg.type === 'uncommittedDiffData') {
        // Discard stale responses that arrive after the user has navigated to a
        // real commit — the data is only meaningful while viewing UNCOMMITTED.
        if (activeHash !== 'UNCOMMITTED') return;
        uncommittedFiles = msg.payload;
        if (selectedFile) {
          const isStaged = selectedFile.startsWith('staged:');
          const filePath = selectedFile.replace(/^(staged|unstaged):/, '');
          const list = isStaged ? msg.payload.staged : msg.payload.unstaged;
          if (!list.some((f: { path: string }) => f.path === filePath)) {
            selectedFile = null;
          }
        }
      }
      if (msg.type === 'fullRefresh') {
        if (activeHash === 'UNCOMMITTED') {
          uncommittedDiffCache = new Map();
          vscode.postMessage({ type: 'getUncommittedDiff' });
          if (selectedFile) {
            const isStaged = selectedFile.startsWith('staged:');
            const filePath = selectedFile.replace(/^(staged|unstaged):/, '');
            vscode.postMessage({ type: 'getUncommittedFileDiff', payload: { file: filePath, staged: isStaged } });
          }
        }
      }
      if (msg.type === 'multiCommitSectionsData') {
        if (commit || !uiStore.comparing) return; // only valid in compare mode
        files = msg.payload.files;
        diffs = [];
        sections = msg.payload.sections;
      }
      if (msg.type === 'commitDiffData') {
        // Discard stale responses from previous commit selections
        if (msg.payload.hash !== activeHash) return;
        files = msg.payload.files;
        sections = [];
        // Compare mode (compareCommits / compareToWorking) ships all diffs
        // upfront with an empty hash, so lazy per-file fetching never runs for
        // it. Store those diffs so clicking a file shows its content. Normal
        // commit selection omits `diffs` and loads them lazily per file.
        if (msg.payload.diffs) diffs = msg.payload.diffs;
      }
      if (msg.type === 'fileDiffData') {
        if (msg.payload.hash !== activeHash) return;
        if (msg.payload.diff) {
          if (msg.payload.hash === 'UNCOMMITTED' && msg.payload.key) {
            const next = new Map(uncommittedDiffCache);
            next.set(msg.payload.key, msg.payload.diff);
            uncommittedDiffCache = next;
          } else {
            diffs = [...diffs.filter(d => d.file !== msg.payload.file), msg.payload.diff];
          }
        }
      }
      if (msg.type === 'lfsData') {
        lfsFiles = msg.payload.files;
        lfsLocks = msg.payload.locks;
      }
      if (msg.type === 'commitSignatureData') {
        // Discard stale responses from previous commit selections.
        if (msg.payload.hash !== activeHash) return;
        signature = msg.payload.signature;
      }
      if (msg.type === 'commitData') {
        const c = msg.payload.commit;
        previewCacheSet(c.hash, c);
        // Warm the cached avatar (resolved by the extension host).
        avatarStore.url(c.author.email, 32);

        // Only show if still hovering and this is the right hash
        if (hoveredHash === c.hash && previewPos && !previewCommit) {
           previewCommit = c;
        }
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  });

  function formatFullDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString();
  }

  function handleParentMouseEnter(e: MouseEvent, hash: string) {
    if (previewTimeout) clearTimeout(previewTimeout);
    
    const x = e.clientX;
    const y = e.clientY;
    hoveredHash = hash;

    previewTimeout = setTimeout(() => {
      const cached = previewCacheGet(hash) || commitStore.getCommit(hash);
      if (cached) {
        // Warm the cached avatar (resolved by the extension host).
        avatarStore.url(cached.author.email, 32);

        previewCommit = cached;
        previewPos = { x, y };
      } else {
        previewPos = { x, y };
        vscode.postMessage({ type: 'getCommitData', payload: { hash } });
      }
    }, 400);
  }

  function handleParentMouseLeave() {
    if (previewTimeout) clearTimeout(previewTimeout);
    previewTimeout = null;
    previewCommit = null;
    previewPos = null;
    hoveredHash = null;
  }

  // File tree structure
  interface FileTreeNode {
    name: string;
    path: string;
    children: FileTreeNode[];
    isFile: boolean;
    status?: string;
  }

  let expandedDirs = $state<Set<string>>(new Set());

  function compactDirectoryChains(nodes: FileTreeNode[]): FileTreeNode[] {
    return nodes.map(node => {
      if (node.isFile) return { ...node, children: [] };

      let name = node.name;
      let path = node.path;
      let children = node.children;
      while (children.length === 1 && !children[0].isFile) {
        const child = children[0];
        name = `${name} / ${child.name}`;
        path = child.path;
        children = child.children;
      }

      return {
        ...node,
        name,
        path,
        children: compactDirectoryChains(children),
      };
    });
  }

  function buildFileTree(commitFiles: CommitFile[]): FileTreeNode[] {
    const root: FileTreeNode = { name: '', path: '', children: [], isFile: false };

    for (const { path: filePath, status } of commitFiles) {
      const parts = filePath.split('/');
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const isLast = i === parts.length - 1;
        let child = node.children.find(c => c.name === parts[i] && c.isFile === isLast);
        if (!child) {
          child = {
            name: parts[i],
            path: isLast ? filePath : parts.slice(0, i + 1).join('/'),
            children: [],
            isFile: isLast,
            status: isLast ? status : undefined,
          };
          node.children.push(child);
        }
        node = child;
      }
    }

    function sortTree(nodes: FileTreeNode[]): FileTreeNode[] {
      nodes.sort((a, b) => {
        if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
      for (const n of nodes) {
        if (!n.isFile) sortTree(n.children);
      }
      return nodes;
    }

    return compactDirectoryChains(sortTree(root.children));
  }

  // All changed-file paths under a tree node (the node itself if it's a file).
  function collectFilePaths(node: FileTreeNode): string[] {
    return node.isFile ? [node.path] : node.children.flatMap(collectFilePaths);
  }

  // A collapsed folder counts as selected when every changed file under it is
  // selected. An expanded folder is never highlighted: its files are visible and
  // already highlighted individually, so highlighting the folder too is redundant
  // (and looked wrong for a folder holding a single, plainly-selected file).
  function isFolderSelected(node: FileTreeNode): boolean {
    if (expandedDirs.has(node.path)) return false;
    const filesUnder = collectFilePaths(node);
    return filesUnder.length > 0 && filesUnder.every(p => selectedPatchFiles.has(p));
  }

  let fileTree = $derived(buildFileTree(files));
  // Memoize the uncommitted trees too. They were rebuilt inline in the
  // template ({@render renderUncommittedTree(buildFileTree(...))}), so any
  // reactive change (selection, expand/collapse) re-ran buildFileTree over
  // both lists on every render.
  let stagedTree = $derived(uncommittedFiles ? buildFileTree(uncommittedFiles.staged) : []);
  let unstagedTree = $derived(uncommittedFiles ? buildFileTree(uncommittedFiles.unstaged) : []);

  // Mirror the local file selection into the store so the global Esc handler can
  // tell whether a file is selected. Cleared on unmount so a closed panel never
  // leaves the flag stuck on.
  $effect(() => {
    uiStore.commitFileSelected = selectedFile !== null;
    return () => { uiStore.commitFileSelected = false; };
  });

  // When Esc asks to clear the selection (via the store signal), drop the local
  // selection. The panel stays open; only the file/preview is deselected.
  let lastClearSignal = uiStore.clearCommitFileSelectionSignal;
  $effect(() => {
    const signal = uiStore.clearCommitFileSelectionSignal;
    if (signal !== lastClearSignal) {
      lastClearSignal = signal;
      selectedFile = null;
      selectedPatchFiles = new Set();
      // The clicked file/dir button still holds focus; Esc is a keyboard event,
      // so :focus-visible would draw an outline on it after deselecting. Blur it.
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.classList.contains('file-item') || active.classList.contains('dir-item'))) {
        active.blur();
      }
    }
  });

  // Auto-expand all directories when files change
  $effect(() => {
    if (files.length > 0) {
      expandedDirs = new Set(files.flatMap(({ path: p }) => {
        const parts = p.split('/');
        return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
      }));
    }
  });

  $effect(() => {
    if (uncommittedFiles) {
      const dirs = new Set<string>();
      for (const { path: p } of uncommittedFiles.staged) {
        const parts = p.split('/');
        parts.slice(0, -1).forEach((_, i) => dirs.add('staged:' + parts.slice(0, i + 1).join('/')));
      }
      for (const { path: p } of uncommittedFiles.unstaged) {
        const parts = p.split('/');
        parts.slice(0, -1).forEach((_, i) => dirs.add('unstaged:' + parts.slice(0, i + 1).join('/')));
      }
      expandedDirs = dirs;
    }
  });

  function statusColor(s?: string): string {
    if (document.body.classList.contains('vscode-light')) {
      switch (s) {
        case 'A': return '#2e7d32';
        case 'M': return '#8a6d3b';
        case 'D': return '#b71c1c';
        case 'R': return '#1565c0';
        case 'C': return '#6a1b9a';
        case 'N': return '#616161';
        default: return 'var(--text-secondary)';
      }
    }
    switch (s) {
      case 'A': return '#4caf50';
      case 'M': return '#e2c08d';
      case 'D': return '#f44336';
      case 'R': return '#2196f3';
      case 'C': return '#9c27b0';
      case 'N': return '#9e9e9e';
      default: return 'var(--text-secondary)';
    }
  }

  function statusLabel(s?: string): string {
    switch (s) {
      case 'A': return 'Added';
      case 'M': return 'Modified';
      case 'D': return 'Deleted';
      case 'R': return 'Renamed';
      case 'C': return 'Copied';
      case 'U': return 'Untracked';
      case 'N': return t('details.nestedRepoLabel');
      default: return '';
    }
  }

  function toggleDir(dirPath: string) {
    const next = new Set(expandedDirs);
    if (next.has(dirPath)) {
      next.delete(dirPath);
    } else {
      next.add(dirPath);
    }
    expandedDirs = next;
  }

</script>

<div class="commit-details">
  <!-- Top tabs -->
  <div class="top-tabs">
    {#if commit?.hash === 'UNCOMMITTED'}
      <button class="top-tab" class:active={uncommittedTab === 'staged'} onclick={() => { uncommittedTab = 'staged'; selectedFile = null; }}>
        Staged <span class="tab-count">{uncommittedFiles?.staged.length ?? 0}</span>
      </button>
      <button class="top-tab" class:active={uncommittedTab === 'unstaged'} onclick={() => { uncommittedTab = 'unstaged'; selectedFile = null; }}>
        Unstaged <span class="tab-count">{uncommittedFiles?.unstaged.length ?? 0}</span>
      </button>
    {:else}
      {#if commit}
        <button class="top-tab" class:active={activeTab === 'commit'} onclick={() => { activeTab = 'commit'; }}>
          {t('details.commit')}
        </button>
      {/if}
      <button class="top-tab" class:active={activeTab === 'changes'} onclick={() => { activeTab = 'changes'; }}>
        {t('details.changes')} <span class="tab-count">{files.length}</span>
      </button>
    {/if}
    <div class="tabs-actions">
      <button class="tab-action-btn" aria-label={uiStore.commitDetailFullscreen ? t('details.restore') : t('details.fullscreen')} use:tooltip={uiStore.commitDetailFullscreen ? t('details.restore') : t('details.fullscreen')} onclick={() => { uiStore.commitDetailFullscreen = !uiStore.commitDetailFullscreen; }}>
        <i class="codicon {uiStore.commitDetailFullscreen ? 'codicon-chevron-down' : 'codicon-chevron-up'}"></i>
      </button>
      <button class="tab-action-btn" aria-label={t('common.close')} use:tooltip={t('common.close')} onclick={() => { if (!uiStore.multiSelectArmed) { uiStore.selectCommit(null); } uiStore.showBottomPanel = false; uiStore.commitDetailFullscreen = false; }}>
        <i class="codicon codicon-close"></i>
      </button>
    </div>
  </div>

  <!-- Commit tab -->
  {#if activeTab === 'commit' && commit}
    <div class="commit-tab-content">
      <div class="info-section">
        <div class="info-columns">
          <!-- Author -->
          <div class="info-column">
            <div class="info-label">{t('details.author')}</div>
            <div class="person-info">
              <img class="avatar-lg" src={avatarStore.url(commit.author.email, 48)} alt="" />
              <div class="person-details">
                <div class="person-name">
                  {commit.author.name}
                  <span class="person-email">&lt;{commit.author.email}&gt;</span>
                  {#if signature && signature.status !== 'none'}
                    <i
                      class="codicon codicon-{signature.status === 'good' ? 'pass' : 'question'} sig-glyph sig-glyph-{signature.status}"
                      use:tooltip={signature.status === 'good' ? t('signature.verified') : t('signature.unverified')}
                    ></i>
                  {/if}
                </div>
                <div class="person-date">{formatFullDate(commit.author.date)}</div>
              </div>
            </div>
          </div>
          <!-- Committer (Only show if different from author) -->
          {#if commit.author.email !== commit.committer.email || commit.author.name !== commit.committer.name}
            <div class="info-column">
              <div class="info-label">{t('details.committer')}</div>
              <div class="person-info">
                <img class="avatar-lg" src={avatarStore.url(commit.committer.email, 48)} alt="" />
                <div class="person-details">
                  <div class="person-name">
                    {commit.committer.name}
                    <span class="person-email">&lt;{commit.committer.email}&gt;</span>
                  </div>
                  <div class="person-date">{formatFullDate(commit.committer.date)}</div>
                </div>
              </div>
            </div>
          {/if}
        </div>

        <!-- Refs, SHA, Parents -->
        <div class="meta-rows">
          {#if commit.refs.some(r => r.type !== 'stash' && !(r.type === 'remote-branch' && r.name === 'HEAD'))}
            <div class="meta-row">
              <span class="meta-label">{t('details.refs')}</span>
              <span class="meta-value">
                {#each [...commit.refs].filter(r => {
                  if (r.type === 'remote-branch' && r.name === 'HEAD') return false;
                  if (r.type === 'stash') return false;
                  return true;
                }).sort((a, b) => {
                  const order: Record<string, number> = { head: 0, branch: 1, 'remote-branch': 2, tag: 3 };
                  const typeOrder = (order[a.type] ?? 4) - (order[b.type] ?? 4);
                  if (typeOrder !== 0) return typeOrder;
                  const aName = a.type === 'remote-branch' ? `${a.remote}/${a.name}` : a.name;
                  const bName = b.type === 'remote-branch' ? `${b.remote}/${b.name}` : b.name;
                  return aName.localeCompare(bName);
                }) as ref}
                  {@const isWtBranch = (ref.type === 'branch' || ref.type === 'head') && branchStore.worktrees.some(w => !w.isMain && w.branch === ref.name)}
                  {@const badgeColor = ref.type === 'tag' ? '#f0c040' : isWtBranch ? '#4caf50' : '#63b0f4'}
                  <span
                    class="ref-badge"
                    class:badge-fixed={ref.type === 'tag' || isWtBranch}
                    class:badge-head={ref.type === 'head'}
                    style="--badge-color: {badgeColor};"
                  >
                    {#if ref.type === 'remote-branch'}
                      <i class="codicon codicon-cloud ref-icon"></i>
                      {ref.remote}/{ref.name}
                    {:else if ref.type === 'tag'}
                      <i class="codicon codicon-tag ref-icon"></i>
                      {ref.name}
                    {:else}
                      {ref.name}
                    {/if}
                  </span>
                {/each}
              </span>
            </div>
          {/if}
          <div class="meta-row">
            <span class="meta-label">{t('details.sha')}</span>
            <span class="meta-value mono">{commit.hash}
              <div class="copy-btns">
                <button
                  class="copy-btn"
                  onclick={() => vscode.postMessage({ type: 'copyToClipboard', payload: { text: commit.hash } })}
                  aria-label={t('details.copyFullSha')}
                  use:tooltip={t('details.copyFullSha')}
                >
                  <i class="codicon codicon-copy"></i>
                </button>
                <button
                  class="copy-btn"
                  onclick={() => vscode.postMessage({ type: 'copyToClipboard', payload: { text: commit.abbreviatedHash } })}
                  aria-label={t('details.copyShortSha')}
                  use:tooltip={t('details.copyShortSha')}
                >
                  <i class="codicon codicon-git-commit"></i>
                </button>
              </div>
            </span>
          </div>
          {#if signature && signature.status !== 'none'}
            {@const who = signerDisplay()}
            {#if who || signature.keyId}
              <div class="meta-row">
                <span class="meta-label">{t('details.signature')}</span>
                <span class="meta-value sig-value">
                  <span class="sig-detail">
                    {#if who}{who}{/if}{#if signature.keyId}{@const keyLabel = signature.keyId.startsWith('SHA256:') ? 'SSH Key' : 'GPG Key ID'}{#if who}{' '}{/if}({keyLabel}: <span class="mono">{signature.keyId}</span>){/if}
                  </span>
                </span>
              </div>
            {/if}
          {/if}
          {#if commit.parents.length > 0}
            <div class="meta-row">
              <span class="meta-label">{t('details.parents')}</span>
              <span class="meta-value mono">
                {#each commit.parents as parent, i}
                  {#if i > 0}, {/if}
                  <button
                    class="parent-link"
                    onmouseenter={(e) => handleParentMouseEnter(e, parent)}
                    onmouseleave={handleParentMouseLeave}
                    onclick={() => {
                      uiStore.selectedCommitHash = parent;
                      vscode.postMessage({ type: 'searchByHash', payload: { hash: parent } });
                      handleParentMouseLeave();
                    }}
                  >{parent.substring(0, 7)}</button>
                {/each}
              </span>
            </div>
          {/if}
        </div>
      </div>

      <!-- Commit message -->
      <div class="message-section">
        {#if messageHasMarkdown}
          <div class="message-view-toggle">
            <button
              class:active={messageMode === 'markdown'}
              onclick={() => { messageOverride = { hash: commit.hash, mode: 'markdown' }; }}
            >{t('details.viewMarkdown')}</button>
            <button
              class:active={messageMode === 'plain'}
              onclick={() => { messageOverride = { hash: commit.hash, mode: 'plain' }; }}
            >{t('details.viewPlain')}</button>
          </div>
        {/if}
        {#if messageHasMarkdown && messageMode === 'markdown'}
          <div class="message-markdown">
            <Markdown text={messageText} />
          </div>
        {:else}
          <div class="message-subject"><LinkifiedText text={commit.subject} /></div>
          {#if commit.body}
            <div class="message-body"><LinkifiedText text={commit.body} /></div>
          {/if}
        {/if}
      </div>
    </div>

  <!-- Changes tab -->
  {:else if activeTab === 'changes'}
    <div class="changes-tab-content">
      <div class="files-panel" style="width: {filesPanelWidth}px">
        <div class="files-list">
          {#if activeHash === 'UNCOMMITTED' && uncommittedFiles}
            {#snippet renderUncommittedTree(nodes: FileTreeNode[], depth: number, staged: boolean)}
              {#each nodes as node}
                {#if node.isFile}
                  <button
                    class="file-item"
                    class:selected={selectedFile === `${staged ? 'staged' : 'unstaged'}:${node.path}`}
                    class:context-active={contextMenuRowKey === `${staged ? 'staged' : 'unstaged'}:${node.path}`}
                    style="padding-left: {8 + depth * 16 + 18}px;"
                    onclick={() => {
                      const key = `${staged ? 'staged' : 'unstaged'}:${node.path}`;
                      selectedFile = selectedFile === key ? null : key;
                      // Nested repos can't be diffed from the parent — skip the fetch
                      // and let the UI render the dedicated hint pane instead.
                      if (selectedFile && node.status !== 'N' && !uncommittedDiffCache.has(key)) {
                        vscode.postMessage({ type: 'getUncommittedFileDiff', payload: { file: node.path, staged } });
                      }
                    }}
                    ondblclick={() => {
                      // Open the change in the editor: staged → HEAD↔index, unstaged → index↔working.
                      // Nested repos ('N') can't be diffed from the parent — skip them. New/added files
                      // are handled backend-side (diffed against the empty tree when a ref lacks them).
                      if (node.status !== 'N') {
                        vscode.postMessage({ type: 'openDiff', payload: { file: node.path, staged } });
                      }
                    }}
                    oncontextmenu={(e) => {
                      e.preventDefault();
                      contextMenuRowKey = `${staged ? 'staged' : 'unstaged'}:${node.path}`;
                      const items: Array<{ label: string; action: () => void; danger?: boolean; separator?: boolean }> = [
                        {
                          label: t('file.open'),
                          action: () => { vscode.postMessage({ type: 'openFile', payload: { file: node.path } }); fileContextMenu = null; },
                        },
                      ];
                      if (node.status !== 'N') {
                        items.push({
                          label: t('file.openChanges'),
                          action: () => { vscode.postMessage({ type: 'openDiff', payload: { file: node.path, staged } }); fileContextMenu = null; },
                        });
                      }
                      items.push({ separator: true, label: '', action: () => {} });
                      items.push({
                        label: t('file.revealInExplorer'),
                        action: () => { vscode.postMessage({ type: 'revealInExplorer', payload: { file: node.path } }); fileContextMenu = null; },
                      });
                      items.push({
                        label: t('file.copyPath'),
                        action: () => { vscode.postMessage({ type: 'copyFilePath', payload: { file: node.path } }); fileContextMenu = null; },
                      });
                      items.push({
                        label: t('file.copyRelativePath'),
                        action: () => { vscode.postMessage({ type: 'copyToClipboard', payload: { text: node.path } }); fileContextMenu = null; },
                      });
                      fileContextMenu = { x: e.clientX, y: e.clientY, items };
                    }}
                  >
                    <i class="codicon codicon-file"></i>
                    <span class="file-name truncate">{node.name}</span>
                    {#if node.status}
                      <span class="file-status" style="color: {statusColor(node.status)}" use:tooltip={statusLabel(node.status)}>{node.status}</span>
                    {/if}
                  </button>
                {:else}
                  <button
                    class="dir-item"
                    style="padding-left: {8 + depth * 16}px;"
                    onclick={() => toggleDir(`${staged ? 'staged' : 'unstaged'}:${node.path}`)}
                  >
                    <i class="codicon" class:codicon-chevron-right={!expandedDirs.has(`${staged ? 'staged' : 'unstaged'}:${node.path}`)} class:codicon-chevron-down={expandedDirs.has(`${staged ? 'staged' : 'unstaged'}:${node.path}`)}></i>
                    <i class="codicon codicon-folder"></i>
                    <span class="dir-name" title={node.path}>{node.name}</span>
                  </button>
                  {#if expandedDirs.has(`${staged ? 'staged' : 'unstaged'}:${node.path}`)}
                    {@render renderUncommittedTree(node.children, depth + 1, staged)}
                  {/if}
                {/if}
              {/each}
            {/snippet}
            {#if uncommittedTab === 'staged'}
              {#if uncommittedFiles.staged.length > 0}
                {@render renderUncommittedTree(stagedTree, 0, true)}
              {:else}
                <div class="empty-state-text">No staged changes</div>
              {/if}
            {:else}
              {#if uncommittedFiles.unstaged.length > 0}
                {@render renderUncommittedTree(unstagedTree, 0, false)}
              {:else}
                <div class="empty-state-text">No unstaged changes</div>
              {/if}
            {/if}
          {:else if activeHash !== 'UNCOMMITTED'}
          {#snippet renderTree(nodes: FileTreeNode[], depth: number)}
            {#each nodes as node}
              {#if node.isFile}
                <button
                  class="file-item"
                  class:selected={selectedPatchFiles.has(node.path)}
                  class:context-active={contextMenuRowKey === node.path}
                  style="padding-left: {8 + depth * 16 + 18}px;"
                  onclick={(e) => {
                    if ((e.ctrlKey || e.metaKey) && commit) {
                      // Add/remove this file from the selection; reassign for reactivity.
                      const next = new Set(selectedPatchFiles);
                      if (next.has(node.path)) {
                        next.delete(node.path);
                        // Move the diff preview to another selected file (or clear it).
                        if (selectedFile === node.path) {
                          selectedFile = next.size > 0 ? [...next][next.size - 1] : null;
                        }
                      } else {
                        next.add(node.path);
                        selectedFile = node.path;
                      }
                      selectedPatchFiles = next;
                      return;
                    }
                    // Plain click: select just this file (toggle off if it's the sole selection).
                    if (selectedFile === node.path && selectedPatchFiles.size <= 1) {
                      selectedFile = null;
                      selectedPatchFiles = new Set();
                    } else {
                      selectedFile = node.path;
                      selectedPatchFiles = new Set([node.path]);
                    }
                  }}
                  ondblclick={() => {
                    if (commit) {
                      vscode.postMessage({ type: 'openDiff', payload: { file: node.path, commitHash: commit.hash } });
                    } else if (uiStore.comparing && uiStore.compareRef1 && uiStore.compareRef2) {
                      vscode.postMessage({ type: 'openDiff', payload: { file: node.path, ref1: uiStore.compareRef1, ref2: uiStore.compareRef2 } });
                    } else if (uiStore.comparing && uiStore.compareRef1) {
                      vscode.postMessage({ type: 'openDiff', payload: { file: node.path, ref1: uiStore.compareRef1, ref2: 'working' } });
                    } else {
                      vscode.postMessage({ type: 'openDiff', payload: { file: node.path } });
                    }
                  }}
                  use:tooltip={"Double-click to open in editor"}
                  oncontextmenu={(e) => {
                    e.preventDefault();
                    contextMenuRowKey = node.path;
                    const items: Array<{ label: string; action: () => void; danger?: boolean; separator?: boolean }> = [];

                    // Open file
                    items.push({
                      label: t('file.open'),
                      action: () => { vscode.postMessage({ type: 'openFile', payload: { file: node.path } }); fileContextMenu = null; },
                    });

                    // Open changes (diff)
                    items.push({
                      label: t('file.openChanges'),
                      action: () => {
                        if (commit) {
                          vscode.postMessage({ type: 'openDiff', payload: { file: node.path, commitHash: commit.hash } });
                        } else if (uiStore.comparing && uiStore.compareRef1 && uiStore.compareRef2) {
                          vscode.postMessage({ type: 'openDiff', payload: { file: node.path, ref1: uiStore.compareRef1, ref2: uiStore.compareRef2 } });
                        } else if (uiStore.comparing && uiStore.compareRef1) {
                          vscode.postMessage({ type: 'openDiff', payload: { file: node.path, ref1: uiStore.compareRef1, ref2: 'working' } });
                        } else {
                          vscode.postMessage({ type: 'openDiff', payload: { file: node.path } });
                        }
                        fileContextMenu = null;
                      },
                    });

                    // Reverse this file's change against the working tree.
                    if (commit && canReverseInThisView) {
                      const hash = commit.hash;
                      items.push({ separator: true, label: '', action: () => {} });
                      items.push({
                        label: t('file.reverseFile'),
                        danger: true,
                        action: () => { postReverse(hash, node.path); fileContextMenu = null; },
                      });
                    }

                    // Create Patch (committed view only)
                    if (commit) {
                      const multi = selectedPatchFiles.has(node.path) && selectedPatchFiles.size >= 2;
                      const paths = multi ? [...selectedPatchFiles] : [node.path];
                      items.push({ separator: true, label: '', action: () => {} });
                      items.push({
                        label: multi
                          ? t('file.createPatchFromSelected', { count: String(selectedPatchFiles.size) })
                          : t('file.createPatch'),
                        action: () => {
                          vscode.postMessage({ type: 'saveCommitPatch', payload: { hash: commit.hash, paths } });
                          fileContextMenu = null;
                        },
                      });
                    }

                    // Restore from stash (stash commits only)
                    if (stashIndex !== null) {
                      const restoreMulti = selectedPatchFiles.has(node.path) && selectedPatchFiles.size >= 2;
                      const restorePaths = restoreMulti ? [...selectedPatchFiles] : [node.path];
                      items.push({ separator: true, label: '', action: () => {} });
                      items.push({
                        label: restoreMulti
                          ? t('file.restoreStashFromSelected', { count: String(selectedPatchFiles.size) })
                          : t('file.restoreStashFile'),
                        action: () => {
                          modalStore.openStashRestore(stashIndex, commit?.subject ?? '', restorePaths);
                          fileContextMenu = null;
                        },
                      });
                    }

                    // LFS actions - only for LFS files
                    if (lfsFileSet.has(node.path)) {
                      items.push({ separator: true, label: '', action: () => {} });
                      if (lfsLockMap.has(node.path)) {
                        items.push({
                          label: t('lfs.unlock'),
                          action: () => { vscode.postMessage({ type: 'lfsUnlock', payload: { file: node.path } }); fileContextMenu = null; },
                        });
                        items.push({
                          label: t('lfs.unlockForce'),
                          action: () => { vscode.postMessage({ type: 'lfsUnlock', payload: { file: node.path, force: true } }); fileContextMenu = null; },
                          danger: true,
                        });
                      } else {
                        items.push({
                          label: t('lfs.lock'),
                          action: () => { vscode.postMessage({ type: 'lfsLock', payload: { file: node.path } }); fileContextMenu = null; },
                        });
                      }
                    }

                    items.push({ separator: true, label: '', action: () => {} });
                    items.push({
                      label: t('file.revealInExplorer'),
                      action: () => { vscode.postMessage({ type: 'revealInExplorer', payload: { file: node.path } }); fileContextMenu = null; },
                    });
                    items.push({
                      label: t('file.copyPath'),
                      action: () => { vscode.postMessage({ type: 'copyFilePath', payload: { file: node.path } }); fileContextMenu = null; },
                    });
                    items.push({
                      label: t('file.copyRelativePath'),
                      action: () => { vscode.postMessage({ type: 'copyToClipboard', payload: { text: node.path } }); fileContextMenu = null; },
                    });

                    fileContextMenu = { x: e.clientX, y: e.clientY, items };
                  }}
                >
                  <i class="codicon codicon-file"></i>
                  <span class="file-name truncate">{node.name}</span>
                  {#if lfsFileSet.has(node.path)}
                    <span class="lfs-badge" class:locked={lfsLockMap.has(node.path)} use:tooltip={lfsLockMap.has(node.path) ? t('lfs.locked', { owner: lfsLockMap.get(node.path) ?? '' }) : 'LFS'}>
                      {#if lfsLockMap.has(node.path)}<i class="codicon codicon-lock"></i>{/if}
                      LFS
                    </span>
                  {/if}
                  {#if node.status}
                    <span class="file-status" style="color: {statusColor(node.status)}" use:tooltip={statusLabel(node.status)}>{node.status}</span>
                  {/if}
                </button>
              {:else}
                <button
                  class="dir-item"
                  class:selected={isFolderSelected(node)}
                  class:context-active={contextMenuRowKey === node.path}
                  style="padding-left: {8 + depth * 16}px;"
                  onclick={(e) => {
                    if ((e.ctrlKey || e.metaKey) && commit) {
                      // Add/remove every changed file under this folder.
                      const filesUnder = collectFilePaths(node);
                      const next = new Set(selectedPatchFiles);
                      const allSelected = filesUnder.length > 0 && filesUnder.every(p => next.has(p));
                      if (allSelected) {
                        for (const p of filesUnder) next.delete(p);
                        if (selectedFile && filesUnder.includes(selectedFile)) {
                          selectedFile = next.size > 0 ? [...next][next.size - 1] : null;
                        }
                      } else {
                        for (const p of filesUnder) next.add(p);
                        if (filesUnder.length > 0) selectedFile = filesUnder[filesUnder.length - 1];
                      }
                      selectedPatchFiles = next;
                      return;
                    }
                    toggleDir(node.path);
                  }}
                  oncontextmenu={(e) => {
                    e.preventDefault();
                    if (!commit) return;
                    contextMenuRowKey = node.path;
                    const folderItems: Array<{ label: string; action: () => void; danger?: boolean; separator?: boolean }> = [
                      {
                        label: t('file.createPatchFromFolder'),
                        action: () => {
                          vscode.postMessage({ type: 'saveCommitPatch', payload: { hash: commit.hash, paths: [node.path] } });
                          fileContextMenu = null;
                        },
                      },
                    ];
                    if (stashIndex !== null) {
                      folderItems.push({ separator: true, label: '', action: () => {} });
                      folderItems.push({
                        label: t('file.restoreStashFromFolder'),
                        action: () => {
                          modalStore.openStashRestore(stashIndex, commit?.subject ?? '', [node.path]);
                          fileContextMenu = null;
                        },
                      });
                    }
                    fileContextMenu = { x: e.clientX, y: e.clientY, items: folderItems };
                  }}
                >
                  <i class="codicon" class:codicon-chevron-right={!expandedDirs.has(node.path)} class:codicon-chevron-down={expandedDirs.has(node.path)}></i>
                  <i class="codicon codicon-folder"></i>
                  <span class="dir-name" title={node.path}>{node.name}</span>
                </button>
                {#if expandedDirs.has(node.path)}
                  {@render renderTree(node.children, depth + 1)}
                {/if}
              {/if}
            {/each}
          {/snippet}
          {@render renderTree(fileTree, 0)}
          {/if}
        </div>
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="resize-handle"
        class:resizing={isResizing}
        onmousedown={startResize}
      ></div>

      {#if selectedIsNestedRepo}
        <div class="diff-wrapper">
          <div class="diff-panel">
            <div class="diff-empty">{t('details.nestedRepoHint')}</div>
          </div>
        </div>
      {:else if selectedSections.length > 0}
        <div class="sections-pane">
          {#each selectedSections as sec (sec.commit)}
            <FileDiffView
              diff={sec.diff}
              commitHash={sec.commit}
              stacked
              heading={sec.subject ? `${sec.shortHash}  ${sec.subject}` : sec.shortHash}
              onReverse={canReverseInThisView ? handleDiffReverse : undefined}
              onReverseHunk={canReverseInThisView ? handleHunkReverse : undefined}
              onReverseLines={canReverseInThisView ? handleLinesReverse : undefined}
            />
          {/each}
        </div>
      {:else if selectedDiff}
        <FileDiffView
          diff={selectedDiff}
          commitHash={commit?.hash}
          staged={selectedFile?.startsWith('staged:') ?? false}
          onReverse={canReverseInThisView ? handleDiffReverse : undefined}
          onReverseHunk={canReverseInThisView ? handleHunkReverse : undefined}
          onReverseLines={canReverseInThisView ? handleLinesReverse : undefined}
        />
      {/if}
    </div>

  {/if}
</div>

{#if fileContextMenu}
  <ContextMenu
    x={fileContextMenu.x}
    y={fileContextMenu.y}
    items={fileContextMenu.items}
    onClose={() => { fileContextMenu = null; contextMenuRowKey = null; }}
  />
{/if}

{#if previewCommit && previewPos}
  <CommitHoverCard
    commit={previewCommit}
    x={previewPos.x}
    y={previewPos.y}
    onClose={handleParentMouseLeave}
    onNavigate={() => {
      if (previewCommit) {
        uiStore.selectedCommitHash = previewCommit.hash;
        vscode.postMessage({ type: 'searchByHash', payload: { hash: previewCommit.hash } });
        handleParentMouseLeave();
      }
    }}
  />
{/if}

<style>
  .commit-details {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-size: var(--vscode-font-size, 13px);
  }

  /* ── Top tabs ── */
  .top-tabs {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0 8px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .tabs-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .tab-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.9em;
    height: 1.9em;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 3px;
    font-size: 1.25em;
  }

  .tab-action-btn:hover {
    background: rgba(128, 128, 128, 0.2);
    color: var(--text-primary);
  }

  .top-tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 8px 16px;
    font-weight: normal;
    background: transparent;
    color: var(--text-secondary);
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    cursor: pointer;
  }

  .top-tab:hover {
    color: var(--text-primary);
  }

  .top-tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--vscode-focusBorder, #007fd4);
  }

  .tab-count {
    opacity: 0.6;
    font-weight: normal;
    font-size: 0.75em;
  }

  /* ── Commit tab ── */
  .commit-tab-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
  }

  .info-section {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .info-columns {
    display: flex;
    gap: 20px;
  }

  .info-column {
    flex: 1;
    min-width: 0;
  }

  .info-label {
    font-size: 0.85em;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    margin-bottom: 8px;
    opacity: 0.8;
    text-transform: uppercase;
  }

  .person-info {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .avatar-lg {
    width: 3.2em;
    height: 3.2em;
    border-radius: 50%;
    flex-shrink: 0;
    border: 1px solid var(--border-color);
  }

  .person-details {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: 3.2em;
  }

  .person-name {
    font-weight: 600;
    font-size: 1.1em;
    line-height: 1.2;
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .person-email {
    font-weight: 400;
    color: var(--text-secondary);
    font-size: 0.85em;
    opacity: 0.7;
  }

  .person-date {
    font-size: 0.85em;
    color: var(--text-secondary);
    margin-top: 4px;
    opacity: 0.8;
  }

  /* ── Meta rows ── */
  .meta-rows {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 5px; /* Added slight horizontal padding for alignment */
    margin-bottom: 8px;
  }

  .meta-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  .meta-label {
    width: 70px;
    flex-shrink: 0;
    font-size: 0.85em;
    font-weight: 700;
    color: var(--text-secondary);
    opacity: 0.8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .meta-value {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .mono {
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .sig-value {
    gap: 8px;
  }

  .sig-detail {
    font-size: 0.85em;
    color: var(--text-secondary);
  }

  /* Inline status glyph shown right after the author email. The single space
     between the email span and this icon comes from the markup whitespace, so
     no extra left margin (which would read as a double space). */
  .sig-glyph {
    font-size: 0.95em;
    vertical-align: middle;
  }

  .sig-glyph-good {
    color: var(--vscode-testing-iconPassed, #4caf50);
  }

  .sig-glyph-unverified {
    color: var(--vscode-editorWarning-foreground, #d7a000);
  }

  .copy-btns {
    display: inline-flex;
    gap: 2px;
    margin-left: 4px;
    align-items: center;
  }

  .copy-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 2px;
    border-radius: 3px;
    display: inline-flex;
    align-items: center;
    opacity: 0.6;
    transition: opacity 0.1s, background 0.1s;
  }

  .copy-btn:hover {
    opacity: 1;
    background: rgba(128, 128, 128, 0.2);
  }

  .copy-btn i {
    font-size: 1.1em;
  }

  .parent-link {
    background: transparent;
    color: var(--vscode-textLink-foreground, #3794ff);
    border: none;
    cursor: pointer;
    font-family: var(--vscode-editor-font-family, monospace);
    padding: 0;
  }

  .parent-link:hover {
    text-decoration: underline;
  }

  /* Mirrors the graph ref-badge: neutral fill + colored left accent bar
     (::before, clipped to the rounded corners) with light tint for fixed-color
     refs and a stronger tint + bold for the current branch. */
  .ref-badge {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px 1px calc(var(--badge-bar-width, 4px) + 6px);
    border-radius: 4px;
    font-size: 0.9em;
    font-weight: normal;
    margin-right: 6px;
    cursor: default;
    white-space: nowrap;
    line-height: 1.4;
    overflow: hidden;
    /* Dark theme defaults: neutral fill */
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.12);
  }

  .ref-badge::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: var(--badge-bar-width, 4px);
    background: var(--badge-color);
  }

  .ref-badge.badge-fixed {
    background: color-mix(in srgb, var(--badge-color) var(--fixed-tint, 20%), transparent);
  }

  .ref-badge.badge-head {
    background: color-mix(in srgb, var(--badge-color) 55%, transparent);
    font-weight: 600;
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

  .ref-icon {
    font-size: 1em;
    flex-shrink: 0;
    line-height: 1;
    transform: translateY(1px);
  }

  /* ── Message ── */
  .message-section {
    margin-top: 8px;
    background: rgba(128, 128, 128, 0.05);
    padding: 16px;
    border-radius: 8px;
    border: 1px solid rgba(128, 128, 128, 0.1);
  }

  :global(body.vscode-light) .message-section {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.08);
  }

  .message-subject {
    font-weight: 700;
    font-size: 1.15em;
    line-height: 1.4;
  }

  .message-body {
    color: var(--text-primary);
    white-space: pre-wrap;
    line-height: 1.6;
    margin-top: 10px;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .message-view-toggle {
    display: flex;
    gap: 2px;
    margin-bottom: 14px;
  }
  .message-view-toggle button {
    padding: 2px 8px;
    font-size: 11px;
    border: 1px solid var(--vscode-panel-border);
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    border-radius: 3px;
  }
  .message-view-toggle button.active {
    background: var(--vscode-button-secondaryBackground, var(--vscode-toolbar-activeBackground));
    color: var(--vscode-foreground);
  }
  .message-markdown {
    font-size: var(--vscode-font-size, 13px);
    line-height: 1.5;
  }

  /* ── Changes tab ── */
  .changes-tab-content {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  .files-panel {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .resize-handle {
    width: 4px;
    flex-shrink: 0;
    cursor: col-resize;
    background: transparent;
    border-right: 1px solid var(--border-color);
    transition: background 0.15s;
  }

  .resize-handle:hover,
  .resize-handle.resizing {
    background: var(--vscode-sash-hoverBorder, rgba(128, 128, 128, 0.4));
  }

  .files-list {
    overflow-y: auto;
    flex: 1;
  }

  .file-item, .dir-item {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 3px 12px;
    text-align: left;
    background: transparent;
    color: var(--text-primary);
    border: none;
    border-radius: 0;
    cursor: pointer;
  }

  .file-item:hover, .dir-item:hover { background: var(--bg-hover); }
  .file-item.selected { background: var(--bg-selected); color: var(--text-selected); }
  .dir-item.selected { background: var(--bg-selected); color: var(--text-selected); }
  /* Right-clicked row stays outlined while its context menu is open (mirrors the
     commit graph's right-click highlight) so it's clear which row the menu acts on. */
  .file-item.context-active, .dir-item.context-active {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: -1px;
  }

  .dir-item {
    color: var(--text-secondary);
    font-weight: normal;
    font-size: inherit;
  }

  .file-name { font-weight: normal; min-width: 0; }
  .dir-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-status {
    margin-left: auto;
    font-size: 0.85em;
    font-weight: 600;
    font-family: var(--vscode-editor-font-family, monospace);
    flex-shrink: 0;
  }

  /* ── Diff panel ── */
  .diff-wrapper {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 12px);
  }

  .diff-panel {
    flex: 1;
    overflow: auto;
  }

  .diff-empty {
    padding: 20px;
    text-align: center;
    color: var(--text-secondary);
  }

  .lfs-badge {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px;
    font-size: 0.7em;
    font-weight: 600;
    border-radius: 3px;
    background: rgba(156, 39, 176, 0.15);
    color: #ce93d8;
    margin-left: auto;
    flex-shrink: 0;
  }

  .lfs-badge + .file-status {
    margin-left: 6px;
  }

  .lfs-badge.locked {
    background: rgba(255, 152, 0, 0.15);
    color: #ff9800;
  }

  :global(body.vscode-light) .lfs-badge {
    background: rgba(106, 27, 154, 0.1);
    color: #6a1b9a;
  }

  :global(body.vscode-light) .lfs-badge.locked {
    background: rgba(200, 100, 0, 0.1);
    color: #e65100;
  }

  .lfs-badge i {
    font-size: 1em;
  }

  .empty-state-text {
    padding: 16px 8px;
    color: var(--text-muted, #888);
    font-size: 12px;
    text-align: center;
  }

  .sections-pane { flex: 1; min-width: 0; overflow-y: auto; display: flex; flex-direction: column; }

</style>
