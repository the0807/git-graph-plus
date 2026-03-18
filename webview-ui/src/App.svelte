<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from './lib/vscode-api';
  import { commitStore } from './lib/stores/commits.svelte';
  import { branchStore } from './lib/stores/branches.svelte';
  import { uiStore } from './lib/stores/ui.svelte';
  import { i18n, t } from './lib/i18n/index.svelte';
  import CommitGraph from './components/graph/CommitGraph.svelte';
  import BottomPanel from './components/layout/BottomPanel.svelte';
  import Toolbar from './components/layout/Toolbar.svelte';
  import SearchBar from './components/common/SearchBar.svelte';
  import ActivityLog from './components/common/ActivityLog.svelte';
  import StatsView from './components/common/StatsView.svelte';
  import type { CommitGraphData } from './lib/types';

  const vscode = getVsCodeApi();

  let searchResults = $state<CommitGraphData | null>(null);
  let resizing = $state(false);
  let conflict = $state<{ operation: string; files: string[] } | null>(null);

  onMount(() => {
    function handleMessage(event: MessageEvent) {
      const msg = event.data;
      switch (msg.type) {
        case 'logData':
          commitStore.setData(msg.payload);
          break;
        case 'branchData':
          branchStore.setData(msg.payload);
          break;
        case 'setLocale':
          i18n.setLocale(msg.payload.locale);
          break;
        case 'repoList':
          uiStore.repos = msg.payload.repos;
          uiStore.activeRepo = msg.payload.active;
          break;
        case 'operationComplete':
          conflict = null;
          break;
        case 'conflictData':
          conflict = msg.payload;
          break;
        case 'error':
          uiStore.setError(msg.payload.message);
          break;
      }
    }

    window.addEventListener('message', handleMessage);

    // Request initial data
    commitStore.setLoading(true);
    vscode.postMessage({ type: 'getLog', payload: { limit: 1000 } });
    vscode.postMessage({ type: 'getBranches' });

    // Keyboard shortcuts
    window.addEventListener('keydown', handleGlobalKeydown);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('keydown', handleGlobalKeydown);
    };
  });

  function handleGlobalKeydown(e: KeyboardEvent) {
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === '1') { e.preventDefault(); uiStore.viewMode = 'graph'; }
    if (ctrl && e.key === '2') { e.preventDefault(); uiStore.viewMode = 'log'; }
    if (ctrl && e.key === '3') { e.preventDefault(); uiStore.viewMode = 'stats'; }

    if (ctrl && e.key === 'f' && uiStore.viewMode === 'graph') {
      e.preventDefault();
      const searchInput = document.querySelector('.search-input') as HTMLInputElement;
      searchInput?.focus();
    }

    if (ctrl && e.key === 'r') {
      e.preventDefault();
      vscode.postMessage({ type: 'getLog', payload: { limit: 1000 } });
      vscode.postMessage({ type: 'getBranches' });
    }

    if (e.key === 'Escape' && uiStore.showBottomPanel && (uiStore.selectedCommitHash || uiStore.comparing)) {
      e.preventDefault();
      uiStore.selectedCommitHash = null;
      uiStore.comparing = false;
      uiStore.showBottomPanel = false;
    }
  }

  function handleSearchResults(data: CommitGraphData | null) {
    searchResults = data;
  }

  // Draggable resize handle
  function startResize(e: MouseEvent) {
    e.preventDefault();
    resizing = true;
    const startY = e.clientY;
    const startHeight = uiStore.bottomPanelHeight;

    function onMouseMove(e: MouseEvent) {
      const delta = startY - e.clientY;
      uiStore.bottomPanelHeight = Math.max(100, Math.min(600, startHeight + delta));
    }

    function onMouseUp() {
      resizing = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }
</script>

<div class="app-container" class:resizing>
  <Toolbar />

  {#if conflict}
    <div class="conflict-banner">
      <div class="conflict-header">
        <div class="conflict-info">
          <i class="codicon codicon-warning conflict-icon"></i>
          <span class="conflict-title">
            <strong>{conflict.operation}</strong> conflict
          </span>
          <span class="conflict-count">{conflict.files.length} file{conflict.files.length > 1 ? 's' : ''}</span>
        </div>
        <div class="conflict-actions">
          <button class="conflict-btn conflict-btn--abort" onclick={() => { vscode.postMessage({ type: 'abortOperation' }); conflict = null; }}>
            <i class="codicon codicon-discard"></i> Abort
          </button>
          <button class="conflict-btn conflict-btn--continue" onclick={() => { vscode.postMessage({ type: 'continueOperation' }); }}>
            <i class="codicon codicon-check"></i> Continue
          </button>
        </div>
      </div>
      <div class="conflict-files">
        {#each conflict.files as file}
          <button class="conflict-file" onclick={() => vscode.postMessage({ type: 'openConflictFile', payload: { file } })}>
            <span class="conflict-file-status">C</span>
            <span class="conflict-file-path">
              {#if file.includes('/')}
                <span class="conflict-file-dir">{file.substring(0, file.lastIndexOf('/') + 1)}</span>{file.substring(file.lastIndexOf('/') + 1)}
              {:else}
                {file}
              {/if}
            </span>
            <i class="codicon codicon-go-to-file conflict-open-icon"></i>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if uiStore.errorMessage}
    <div class="error-bar">
      <span class="error-text">{uiStore.errorMessage}</span>
      <button class="error-dismiss" onclick={() => uiStore.setError(null)}>{t('common.dismiss')}</button>
    </div>
  {/if}

  <div class="content-area">
    {#if uiStore.viewMode === 'graph'}
      <SearchBar onResults={handleSearchResults} />
      <div class="graph-area">
        <CommitGraph {searchResults} />
      </div>
      {#if uiStore.showBottomPanel && (uiStore.selectedCommitHash || uiStore.comparing)}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="resize-handle-h"
          role="separator"
          onmousedown={startResize}
        >
          <div class="resize-handle-line"></div>
        </div>
        <div class="bottom-area" style="height: {uiStore.bottomPanelHeight}px;">
          <BottomPanel />
        </div>
      {/if}
    {:else if uiStore.viewMode === 'log'}
      <div class="log-container">
        <ActivityLog />
      </div>
    {:else if uiStore.viewMode === 'stats'}
      <div class="stats-container">
        <StatsView />
      </div>
    {/if}
  </div>
</div>

<style>
  .app-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
  }

  .app-container.resizing {
    cursor: ns-resize;
    user-select: none;
  }

  .error-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px;
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    border-bottom: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
    font-size: 12px;
    gap: 12px;
  }

  .error-text {
    flex: 1;
    min-width: 0;
  }

  .error-dismiss {
    flex-shrink: 0;
    font-size: 11px;
    padding: 2px 8px;
  }

  /* ---- Conflict banner ---- */
  .conflict-banner {
    background: rgba(240, 160, 32, 0.06);
    border-bottom: 1px solid rgba(240, 160, 32, 0.25);
    font-size: 12px;
  }

  .conflict-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
  }

  .conflict-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .conflict-icon {
    color: #f0a020;
    font-size: 14px;
  }

  .conflict-title {
    color: var(--text-primary);
    font-size: 12px;
  }

  .conflict-title strong {
    text-transform: capitalize;
  }

  .conflict-count {
    color: var(--text-secondary);
    font-size: 11px;
    background: rgba(240, 160, 32, 0.15);
    padding: 1px 6px;
    border-radius: 8px;
    color: #f0a020;
  }

  .conflict-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .conflict-btn {
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .conflict-btn--abort {
    background: transparent;
    color: #f44336;
    border: 1px solid rgba(244, 67, 54, 0.3);
  }

  .conflict-btn--abort:hover {
    background: rgba(244, 67, 54, 0.1);
  }

  .conflict-btn--continue {
    background: var(--vscode-button-background, #0078d4);
    color: var(--vscode-button-foreground, #fff);
    border: none;
  }

  .conflict-files {
    display: flex;
    flex-direction: column;
    padding: 0 14px 8px;
    gap: 1px;
  }

  .conflict-file {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }

  .conflict-file:hover {
    background: rgba(240, 160, 32, 0.08);
  }

  .conflict-file-status {
    font-size: 10px;
    font-weight: 700;
    color: #f0a020;
    background: rgba(240, 160, 32, 0.15);
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .conflict-file-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conflict-file-dir {
    color: var(--text-secondary);
  }

  .conflict-open-icon {
    opacity: 0;
    font-size: 11px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .conflict-file:hover .conflict-open-icon {
    opacity: 1;
  }

  .content-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .graph-area {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .log-container, .stats-container {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .resize-handle-h {
    height: 12px;
    cursor: ns-resize;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  .resize-handle-line {
    width: 80px;
    height: 4px;
    border-radius: 2px;
    background: var(--border-color);
    transition: background 0.15s, width 0.15s;
  }

  .resize-handle-h:hover .resize-handle-line {
    background: var(--vscode-focusBorder, #007fd4);
    width: 120px;
  }

  .bottom-area {
    overflow: hidden;
    flex-shrink: 0;
    border-top: 1px solid var(--border-color);
  }
</style>
