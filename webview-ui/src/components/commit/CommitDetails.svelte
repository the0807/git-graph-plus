<script lang="ts">
  import type { Commit, DiffData } from '../../lib/types';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { branchStore } from '../../lib/stores/branches.svelte';
  import { uiStore } from '../../lib/stores/ui.svelte';
  import { onMount } from 'svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { getGravatarUrl } from '../../lib/utils/gravatar';
  import { detectLanguage, highlightLine, escapeHtml } from '../../lib/utils/highlighter';

  import ImageDiff from '../common/ImageDiff.svelte';
  import ContextMenu from '../common/ContextMenu.svelte';

  interface Props {
    commit?: Commit;
  }

  let { commit }: Props = $props();

  const vscode = getVsCodeApi();

  interface CommitFile {
    path: string;
    status: string; // A=added, M=modified, D=deleted, R=renamed, C=copied
  }

  let files = $state<CommitFile[]>([]);
  let diffs = $state<DiffData[]>([]);
  let selectedFile = $state<string | null>(null);
  let lfsFiles = $state<Array<{ oid: string; path: string }>>([]);
  let lfsLocks = $state<Array<{ path: string; owner: string; id: string }>>([]);
  let fileContextMenu = $state<{ x: number; y: number; items: any[] } | null>(null);
  let selectedDiff = $derived(diffs.find(d => d.file === selectedFile));
  const lfsFileSet = $derived(new Set(lfsFiles.map(f => f.path)));
  const lfsLockMap = $derived(new Map(lfsLocks.map(l => [l.path, l.owner])));
  let diffMode = $state<'inline' | 'side-by-side'>('inline');
  // svelte-ignore state_referenced_locally
  let activeTab = $state<'commit' | 'changes'>(commit ? 'commit' : 'changes');

  let activeHash = '';

  // Request commit diff only when hash actually changes (not on object reference changes from fullRefresh)
  $effect(() => {
    const hash = commit?.hash ?? '';
    if (hash === activeHash) return;
    activeHash = hash;
    files = [];
    diffs = [];
    selectedFile = null;
    if (hash) {
      vscode.postMessage({ type: 'getCommitDiff', payload: { hash } });
      vscode.postMessage({ type: 'getLfsFiles' });
    }
  });

  onMount(() => {
    function handleMessage(event: MessageEvent) {
      const msg = event.data;
      if (msg.type === 'commitDiffData') {
        // Discard stale responses from previous commit selections
        if (msg.payload.hash !== activeHash) return;
        files = msg.payload.files;
        diffs = msg.payload.diffs;
      }
      if (msg.type === 'lfsData') {
        lfsFiles = msg.payload.files;
        lfsLocks = msg.payload.locks;
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  });

  function formatFullDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString();
  }

  function getFileName(path: string): string {
    return path.split('/').pop() ?? path;
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

    return sortTree(root.children);
  }

  let fileTree = $derived(buildFileTree(files));

  // Auto-expand all directories when files change
  $effect(() => {
    if (files.length > 0) {
      expandedDirs = new Set(files.flatMap(({ path: p }) => {
        const parts = p.split('/');
        return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
      }));
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
        default: return 'var(--text-secondary)';
      }
    }
    switch (s) {
      case 'A': return '#4caf50';
      case 'M': return '#e2c08d';
      case 'D': return '#f44336';
      case 'R': return '#2196f3';
      case 'C': return '#9c27b0';
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

  // Syntax highlighting for commit diff
  let highlightedLines = $state<Map<string, string>>(new Map());

  $effect(() => {
    if (selectedDiff && !selectedDiff.isBinary) {
      const lang = detectLanguage(selectedDiff.file);
      if (lang) {
        const newMap = new Map<string, string>();
        const promises: Promise<void>[] = [];
        for (const hunk of selectedDiff.hunks) {
          for (let i = 0; i < hunk.lines.length; i++) {
            const line = hunk.lines[i];
            const key = `${hunk.oldStart}-${i}`;
            promises.push(
              highlightLine(line.content, lang).then(html => {
                newMap.set(key, html);
              })
            );
          }
        }
        Promise.all(promises).then(() => {
          highlightedLines = newMap;
        }).catch(() => {});
      } else {
        highlightedLines = new Map();
      }
    }
  });

  function getHighlighted(hunkStart: number, lineIdx: number, content: string): string {
    const key = `${hunkStart}-${lineIdx}`;
    return highlightedLines.get(key) ?? escapeHtml(content);
  }
</script>

<div class="commit-details">
  <!-- Top tabs -->
  <div class="top-tabs">
    {#if commit}
      <button class="top-tab" class:active={activeTab === 'commit'} onclick={() => { activeTab = 'commit'; }}>
        {t('details.commit')}
      </button>
    {/if}
    <button class="top-tab" class:active={activeTab === 'changes'} onclick={() => { activeTab = 'changes'; }}>
      {t('details.changes')} <span class="tab-count">{files.length}</span>
    </button>
    <div class="tabs-actions">
      <button class="tab-action-btn" title={uiStore.commitDetailFullscreen ? t('details.restore') : t('details.fullscreen')} onclick={() => { uiStore.commitDetailFullscreen = !uiStore.commitDetailFullscreen; }}>
        <i class="codicon {uiStore.commitDetailFullscreen ? 'codicon-chevron-down' : 'codicon-chevron-up'}"></i>
      </button>
      <button class="tab-action-btn" title={t('common.close')} onclick={() => { uiStore.selectedCommitHash = null; uiStore.showBottomPanel = false; uiStore.commitDetailFullscreen = false; uiStore.comparing = false; }}>
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
            <div class="info-label">AUTHOR</div>
            <div class="person-info">
              <img class="avatar-lg" src={getGravatarUrl(commit.author.email, 48)} alt="" loading="lazy" />
              <div class="person-details">
                <div class="person-name">{commit.author.name} <span class="person-email">{commit.author.email}</span></div>
                <div class="person-date">{formatFullDate(commit.author.date)}</div>
              </div>
            </div>
          </div>
          <!-- Committer -->
          <div class="info-column">
            <div class="info-label">COMMITTER</div>
            <div class="person-info">
              <img class="avatar-lg" src={getGravatarUrl(commit.committer.email, 48)} alt="" loading="lazy" />
              <div class="person-details">
                <div class="person-name">{commit.committer.name} <span class="person-email">{commit.committer.email}</span></div>
                <div class="person-date">{formatFullDate(commit.committer.date)}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Refs, SHA, Parents -->
        <div class="meta-rows">
          {#if commit.refs.some(r => r.type !== 'stash' && !(r.type === 'remote-branch' && r.name === 'HEAD'))}
            <div class="meta-row">
              <span class="meta-label">REFS</span>
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
                  <span class="ref-badge">
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
            <span class="meta-label">SHA</span>
            <span class="meta-value mono">{commit.hash}</span>
          </div>
          {#if commit.parents.length > 0}
            <div class="meta-row">
              <span class="meta-label">PARENTS</span>
              <span class="meta-value mono">
                {#each commit.parents as parent, i}
                  {#if i > 0}, {/if}
                  <button class="parent-link" onclick={() => vscode.postMessage({ type: 'searchByHash', payload: { hash: parent } })}>{parent.substring(0, 7)}</button>
                {/each}
              </span>
            </div>
          {/if}
        </div>
      </div>

      <!-- Commit message -->
      <div class="message-section">
        <div class="message-subject">{commit.subject}</div>
        {#if commit.body}
          <div class="message-body">{commit.body}</div>
        {/if}
      </div>
    </div>

  <!-- Changes tab -->
  {:else if activeTab === 'changes'}
    <div class="changes-tab-content">
      <div class="files-panel">
        <div class="files-list">
          {#snippet renderTree(nodes: FileTreeNode[], depth: number)}
            {#each nodes as node}
              {#if node.isFile}
                <button
                  class="file-item"
                  class:selected={selectedFile === node.path}
                  style="padding-left: {8 + depth * 16 + 18}px;"
                  onclick={() => { selectedFile = selectedFile === node.path ? null : node.path; }}
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
                  title="Double-click to open in editor"
                  oncontextmenu={(e) => {
                    e.preventDefault();
                    const items: Array<{ label: string; action: () => void; danger?: boolean; separator?: boolean }> = [];

                    // File history - always available
                    items.push({
                      label: t('lfs.fileHistory'),
                      action: () => { vscode.postMessage({ type: 'searchByFile', payload: { file: node.path } }); fileContextMenu = null; },
                    });

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

                    fileContextMenu = { x: e.clientX, y: e.clientY, items };
                  }}
                >
                  <i class="codicon codicon-file"></i>
                  <span class="file-name truncate">{node.name}</span>
                  {#if lfsFileSet.has(node.path)}
                    <span class="lfs-badge" class:locked={lfsLockMap.has(node.path)} title={lfsLockMap.has(node.path) ? t('lfs.locked', { owner: lfsLockMap.get(node.path) ?? '' }) : 'LFS'}>
                      {#if lfsLockMap.has(node.path)}<i class="codicon codicon-lock"></i>{/if}
                      LFS
                    </span>
                  {/if}
                  {#if node.status}
                    <span class="file-status" style="color: {statusColor(node.status)}" title={statusLabel(node.status)}>{node.status}</span>
                  {/if}
                </button>
              {:else}
                <button
                  class="dir-item"
                  style="padding-left: {8 + depth * 16}px;"
                  onclick={() => toggleDir(node.path)}
                >
                  <i class="codicon" class:codicon-chevron-right={!expandedDirs.has(node.path)} class:codicon-chevron-down={expandedDirs.has(node.path)}></i>
                  <i class="codicon codicon-folder"></i>
                  <span class="dir-name">{node.name}</span>
                </button>
                {#if expandedDirs.has(node.path)}
                  {@render renderTree(node.children, depth + 1)}
                {/if}
              {/if}
            {/each}
          {/snippet}
          {@render renderTree(fileTree, 0)}
        </div>
      </div>

      {#if selectedDiff}
        <div class="diff-wrapper">
          <div class="diff-toolbar">
            <span class="diff-file-name">{selectedDiff.file}</span>
            <div class="diff-mode-toggle">
              <button
                class:active={diffMode === 'inline'}
                onclick={() => { diffMode = 'inline'; }}
              >{t('details.inline')}</button>
              <button
                class:active={diffMode === 'side-by-side'}
                onclick={() => { diffMode = 'side-by-side'; }}
              >{t('details.sideBySide')}</button>
            </div>
          </div>

          <div class="diff-panel">
          {#if selectedDiff.isBinary && selectedDiff.isImage}
            <ImageDiff file={selectedDiff.file} staged={false} commitHash={commit?.hash ?? ''} />
          {:else if selectedDiff.isBinary}
            <div class="diff-empty">{t('details.binaryFile')}</div>
          {:else if diffMode === 'inline'}
            <div class="diff-content">
              {#each selectedDiff.hunks as hunk, hunkIdx}
                {#if hunkIdx > 0}<div class="hunk-separator" aria-hidden="true"></div>{/if}
                {#each hunk.lines as line, lineIndex}
                  <div class="diff-line diff-{line.type}">
                    <span class="line-num old">{line.oldLineNumber ?? ''}</span>
                    <span class="line-num new">{line.newLineNumber ?? ''}</span>
                    <span class="line-prefix">{line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '}</span>
                    <span class="line-content">{@html getHighlighted(hunk.oldStart, lineIndex, line.content)}</span>
                  </div>
                {/each}
              {/each}
            </div>
          {:else}
            <div class="diff-sbs">
              {#each selectedDiff.hunks as hunk, hunkIdx}
                {#if hunkIdx > 0}<div class="hunk-separator" aria-hidden="true"></div>{/if}
                <div
                  class="sbs-container"
                  onscroll={(e) => {
                    const target = e.currentTarget;
                    const left = target.querySelector('.sbs-left') as HTMLElement;
                    const right = target.querySelector('.sbs-right') as HTMLElement;
                    if (left && right) {
                      left.scrollTop = target.scrollTop;
                      right.scrollTop = target.scrollTop;
                    }
                  }}
                >
                  <div class="sbs-left">
                    {#each hunk.lines as line, lineIndex}
                      {#if line.type === 'context' || line.type === 'delete'}
                        <div class="diff-line diff-{line.type}">
                          <span class="line-num">{line.oldLineNumber ?? ''}</span>
                          <span class="line-content">{@html getHighlighted(hunk.oldStart, lineIndex, line.content)}</span>
                        </div>
                      {:else}
                        <div class="diff-line diff-empty-line">
                          <span class="line-num"></span>
                          <span class="line-content"></span>
                        </div>
                      {/if}
                    {/each}
                  </div>
                  <div class="sbs-right">
                    {#each hunk.lines as line, lineIndex}
                      {#if line.type === 'context' || line.type === 'add'}
                        <div class="diff-line diff-{line.type}">
                          <span class="line-num">{line.newLineNumber ?? ''}</span>
                          <span class="line-content">{@html getHighlighted(hunk.oldStart, lineIndex, line.content)}</span>
                        </div>
                      {:else}
                        <div class="diff-line diff-empty-line">
                          <span class="line-num"></span>
                          <span class="line-content"></span>
                        </div>
                      {/if}
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
          </div>
        </div>
      {/if}
    </div>

  {/if}
</div>

{#if fileContextMenu}
  <ContextMenu
    x={fileContextMenu.x}
    y={fileContextMenu.y}
    items={fileContextMenu.items}
    onClose={() => { fileContextMenu = null; }}
  />
{/if}

<style>
  .commit-details {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
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
    width: 22px;
    height: 22px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 3px;
    font-size: 14px;
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
    font-size: 13px;
    font-weight: 600;
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
    font-size: 10px;
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
    gap: 40px;
  }

  .info-column {
    flex: 1;
    min-width: 0;
  }

  .info-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-secondary);
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .person-info {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .avatar-lg {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .person-details {
    min-width: 0;
  }

  .person-name {
    font-size: 13px;
    font-weight: 600;
  }

  .person-email {
    font-weight: 400;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .person-date {
    font-size: 12px;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  /* ── Meta rows ── */
  .meta-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .meta-row {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 13px;
  }

  .meta-label {
    width: 65px;
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 700;
    color: var(--text-secondary);
    letter-spacing: 0.5px;
  }

  .meta-value {
    flex: 1;
    min-width: 0;
  }

  .mono {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 13px;
  }

  .parent-link {
    background: transparent;
    color: var(--vscode-textLink-foreground, #3794ff);
    border: none;
    cursor: pointer;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 13px;
    padding: 0;
  }

  .parent-link:hover {
    text-decoration: underline;
  }

  .ref-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    border-radius: 0;
    font-size: 12px;
    font-weight: 600;
    margin-right: 6px;
    border: 1px solid rgba(128, 128, 128, 0.4);
    background: rgba(128, 128, 128, 0.1);
    color: var(--text-primary);
  }

  .ref-icon {
    font-size: 12px;
    flex-shrink: 0;
    opacity: 0.7;
  }

  /* ── Message ── */
  .message-section {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border-color);
  }

  .message-subject {
    font-weight: 700;
    font-size: 15px;
    line-height: 1.4;
  }

  .message-body {
    font-size: 13px;
    color: var(--text-primary);
    white-space: pre-wrap;
    line-height: 1.6;
    margin-top: 10px;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  /* ── Changes tab ── */
  .changes-tab-content {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  .files-panel {
    width: 240px;
    flex-shrink: 0;
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    overflow: hidden;
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
    font-size: 13px;
  }

  .file-item:hover, .dir-item:hover { background: var(--bg-hover); }
  .file-item.selected { background: var(--bg-selected); color: var(--text-selected); }

  .dir-item {
    color: var(--text-secondary);
    font-weight: 600;
    font-size: 12px;
  }

  .file-name { font-weight: 500; min-width: 0; }
  .dir-name { min-width: 0; }
  .file-status {
    margin-left: auto;
    font-size: 11px;
    font-weight: 700;
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

  .diff-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 12px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
    z-index: 5;
  }

  .diff-file-name { font-weight: 600; font-size: 13px; }

  .diff-mode-toggle {
    display: flex;
    gap: 2px;
    background: rgba(128, 128, 128, 0.15);
    border-radius: 3px;
    padding: 1px;
  }

  .diff-mode-toggle button {
    padding: 2px 8px;
    font-size: 10px;
    border-radius: 2px;
    background: transparent;
    color: var(--text-secondary);
  }

  .diff-mode-toggle button.active {
    background: var(--button-bg);
    color: var(--button-fg);
  }

  .diff-content { padding: 0; min-width: max-content; }

  .hunk-separator {
    height: 0;
    border-top: 1px dashed var(--border-color);
    margin: 6px 0;
    opacity: 0.6;
  }

  .diff-line {
    display: flex;
    min-height: 20px;
    line-height: 20px;
  }

  .diff-add { background: var(--vscode-diffEditor-insertedLineBackground, rgba(72, 191, 145, 0.15)); }
  .diff-delete { background: var(--vscode-diffEditor-removedLineBackground, rgba(255, 0, 0, 0.15)); }
  .diff-empty-line { background: rgba(128, 128, 128, 0.05); }

  .line-num {
    width: 45px;
    flex-shrink: 0;
    text-align: right;
    padding-right: 8px;
    color: var(--text-secondary);
    opacity: 0.5;
    font-size: 11px;
    user-select: none;
  }

  .line-prefix {
    width: 14px;
    flex-shrink: 0;
    text-align: center;
    user-select: none;
  }

  .diff-add .line-prefix { color: #4caf50; }
  .diff-delete .line-prefix { color: #f44336; }

  :global(body.vscode-light) .diff-add .line-prefix { color: #2e7d32; }
  :global(body.vscode-light) .diff-delete .line-prefix { color: #b71c1c; }

  .line-content {
    white-space: pre;
  }

  .diff-empty {
    padding: 20px;
    text-align: center;
    color: var(--text-secondary);
  }

  /* Side-by-side */
  .diff-sbs { min-width: max-content; }

  .sbs-container {
    display: flex;
  }

  .sbs-left, .sbs-right {
    flex: 1;
    min-width: 50%;
    overflow: hidden;
  }

  .sbs-left { border-right: 1px solid var(--border-color); }

  .lfs-badge {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px;
    font-size: 9px;
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
    font-size: 9px;
  }

</style>
