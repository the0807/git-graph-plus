<script lang="ts">
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { t } from '../../lib/i18n/index.svelte';

  interface Props {
    onResults: (data: any) => void;
  }

  let { onResults }: Props = $props();

  const vscode = getVsCodeApi();

  let query = $state('');
  let author = $state('');
  let showFilters = $state(false);
  let searching = $state(false);

  function search() {
    const q = query.trim();
    if (!q) return;

    searching = true;

    // Detect if it looks like a hash
    if (/^[0-9a-f]{4,40}$/i.test(q)) {
      vscode.postMessage({ type: 'searchByHash', payload: { hash: q } });
    } else {
      vscode.postMessage({
        type: 'searchCommits',
        payload: {
          query: q,
          author: author.trim() || undefined,
        },
      });
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      search();
    }
    if (e.key === 'Escape') {
      query = '';
      onResults(null);
    }
  }

  function clear() {
    query = '';
    author = '';
    searching = false;
    onResults(null);
  }

  // Listen for search results
  $effect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data.type === 'searchResults') {
        searching = false;
        onResults(event.data.payload);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  });
</script>

<div class="search-bar">
  <div class="search-input-row">
    <input
      class="search-input"
      type="text"
      bind:value={query}
      onkeydown={handleKeydown}
      placeholder={t('search.placeholder')}
    />
    <button class="search-btn" onclick={search} disabled={!query.trim() || searching}>
      {searching ? '...' : t('search.search')}
    </button>
    {#if query}
      <button class="clear-btn" onclick={clear} title={t('search.clear')}><i class="codicon codicon-close"></i></button>
    {/if}
    <button
      class="filter-toggle"
      class:active={showFilters}
      onclick={() => { showFilters = !showFilters; }}
      title={t('search.filters')}
    >
      <i class="codicon codicon-settings-gear"></i>
    </button>
  </div>

  {#if showFilters}
    <div class="search-filters">
      <input
        class="filter-input"
        type="text"
        bind:value={author}
        placeholder={t('search.authorFilter')}
        onkeydown={handleKeydown}
      />
    </div>
  {/if}
</div>

<style>
  .search-bar {
    padding: 4px 8px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
  }

  .search-input-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .search-input {
    flex: 1;
    padding: 3px 8px;
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border, var(--border-color));
    border-radius: 3px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
  }

  .search-input:focus {
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .search-btn {
    padding: 3px 8px;
    font-size: 11px;
  }

  .search-btn:disabled {
    opacity: 0.5;
  }

  .clear-btn {
    padding: 3px 6px;
    font-size: 11px;
    background: transparent;
    color: var(--text-secondary);
  }

  .filter-toggle {
    padding: 3px 6px;
    font-size: 12px;
    background: transparent;
    color: var(--text-secondary);
  }

  .filter-toggle.active {
    color: var(--text-link);
  }

  .search-filters {
    display: flex;
    gap: 4px;
    margin-top: 4px;
  }

  .filter-input {
    flex: 1;
    padding: 3px 8px;
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border, var(--border-color));
    border-radius: 3px;
    font-size: 11px;
    font-family: inherit;
    outline: none;
  }

  .filter-input:focus {
    border-color: var(--vscode-focusBorder, #007fd4);
  }
</style>
