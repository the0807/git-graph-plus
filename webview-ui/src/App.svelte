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
