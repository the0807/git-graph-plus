<script lang="ts">
  import { commitStore } from '../../lib/stores/commits.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  interface Props {
    onResults: (matchedHashes: Set<string> | null) => void;
    onNavigate: (hash: string) => void;
    remotes?: string[];
    remoteFilter?: string[];
    onFilterChange?: (filter: string[]) => void;
  }

  let { onResults, onNavigate, remotes = [], remoteFilter = [], onFilterChange = () => {} }: Props = $props();

  let query = $state('');
  let matchedHashes = $state<string[]>([]);
  let currentIndex = $state(-1);
  let inputEl: HTMLInputElement | undefined = $state();
  let filterOpen = $state(false);

  const filterActive = $derived(remoteFilter.length > 0);

  function doSearch() {
    const q = query.trim().toLowerCase();
    if (!q) {
      clear();
      return;
    }

    const matched: string[] = [];
    for (const commit of commitStore.commits) {
      const haystack = [
        commit.subject,
        commit.body,
        commit.author.name,
        commit.author.email,
        commit.hash,
        commit.abbreviatedHash,
      ].join(' ').toLowerCase();

      if (haystack.includes(q)) {
        matched.push(commit.hash);
      }
    }

    matchedHashes = matched;
    currentIndex = matched.length > 0 ? 0 : -1;
    onResults(matched.length > 0 ? new Set(matched) : new Set());

    if (matched.length > 0) {
      onNavigate(matched[0]);
    }
  }

  function navigatePrev() {
    if (matchedHashes.length === 0) return;
    currentIndex = (currentIndex - 1 + matchedHashes.length) % matchedHashes.length;
    onNavigate(matchedHashes[currentIndex]);
  }

  function navigateNext() {
    if (matchedHashes.length === 0) return;
    currentIndex = (currentIndex + 1) % matchedHashes.length;
    onNavigate(matchedHashes[currentIndex]);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        navigatePrev();
      } else if (matchedHashes.length > 0 && query.trim()) {
        navigateNext();
      } else {
        doSearch();
      }
    }
    if (e.key === 'Escape') {
      if (filterOpen) {
        filterOpen = false;
      } else {
        clear();
        inputEl?.blur();
      }
    }
  }

  function clear() {
    query = '';
    matchedHashes = [];
    currentIndex = -1;
    onResults(null);
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function onInput() {
    if (!query.trim()) {
      clear();
      return;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => doSearch(), 150);
  }

  function toggleFilter(value: string) {
    const next = remoteFilter.includes(value)
      ? remoteFilter.filter(v => v !== value)
      : [...remoteFilter, value];
    onFilterChange(next);
  }

  function clearFilter() {
    filterOpen = false;
    onFilterChange([]);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="search-bar" role="group" onkeydown={handleKeydown}>
  <div class="search-row" class:has-results={query && matchedHashes.length > 0} class:no-results={query && matchedHashes.length === 0}>
    <i class="codicon codicon-search search-icon"></i>
    <input
      class="search-input"
      type="text"
      bind:this={inputEl}
      bind:value={query}
      oninput={onInput}
      placeholder={t('search.placeholder')}
    />
    {#if query}
      <span class="search-count" class:empty={matchedHashes.length === 0}>
        {#if matchedHashes.length > 0}
          <span class="count-current">{currentIndex + 1}</span><span class="count-sep">/</span><span class="count-total">{matchedHashes.length}</span>
        {:else}
          {t('search.noResults')}
        {/if}
      </span>
      <span class="nav-divider"></span>
      <button class="nav-btn" onclick={navigatePrev} disabled={matchedHashes.length === 0} title={t('search.prev')}>
        <i class="codicon codicon-chevron-up"></i>
      </button>
      <button class="nav-btn" onclick={navigateNext} disabled={matchedHashes.length === 0} title={t('search.next')}>
        <i class="codicon codicon-chevron-down"></i>
      </button>
      <button class="nav-btn close-btn" onclick={clear} title={t('search.clear')}>
        <i class="codicon codicon-close"></i>
      </button>
    {/if}
  </div>

  <div class="filter-wrap">
    <button
      class="filter-btn"
      class:active={filterActive}
      onclick={() => { filterOpen = !filterOpen; }}
      title="Filter branches"
    >
      <span class="filter-side"><i class="codicon codicon-list-filter"></i></span>
      <span class="filter-label">
        Source
        {#if filterActive}<span class="filter-count">{remoteFilter.length}</span>{/if}
      </span>
      <span class="filter-side filter-side--right">
        <i class="codicon {filterOpen ? 'codicon-chevron-up' : 'codicon-chevron-down'} chevron"></i>
      </span>
    </button>

    {#if filterOpen}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="backdrop" onclick={() => { filterOpen = false; }}></div>
      <div class="dropdown">
        <button class="dd-item" class:active={!filterActive} onclick={clearFilter}>
          <input type="checkbox" checked={!filterActive} readonly />
          All
        </button>
        <div class="dd-sep"></div>
        <button class="dd-item" class:active={remoteFilter.includes('local')} onclick={() => toggleFilter('local')}>
          <input type="checkbox" checked={remoteFilter.includes('local')} readonly />
          Local
        </button>
        {#if remotes.length > 0}
          <div class="dd-sep"></div>
          {#each remotes as remote}
            <button class="dd-item" class:active={remoteFilter.includes(remote)} onclick={() => toggleFilter(remote)}>
              <input type="checkbox" checked={remoteFilter.includes(remote)} readonly />
              <span class="remote-name"><i class="codicon codicon-cloud remote-icon"></i>{remote}</span>
            </button>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .search-bar {
    padding: 5px 14px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    position: relative;
  }

  .search-row {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--input-bg);
    border: 1px solid var(--input-border, var(--border-color));
    border-radius: 6px;
    padding: 0 8px;
    height: 30px;
    transition: border-color 0.15s;
  }

  .search-row:focus-within {
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .search-row.has-results:focus-within {
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .search-row.no-results {
    border-color: var(--vscode-inputValidation-warningBorder, #b89500);
  }

  .search-icon {
    font-size: 14px;
    color: var(--text-secondary);
    flex-shrink: 0;
    opacity: 0.6;
  }

  .search-row:focus-within .search-icon {
    opacity: 1;
    color: var(--vscode-focusBorder, #007fd4);
  }

  .search-input {
    flex: 1;
    padding: 0 2px;
    background: transparent;
    color: var(--input-fg);
    border: none;
    font-size: 12px;
    font-family: inherit;
    outline: none;
    min-width: 0;
  }

  .search-count {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .search-count.empty {
    color: var(--vscode-inputValidation-warningForeground, #cca700);
  }

  .count-current {
    color: var(--text-primary);
    font-weight: 600;
  }

  .count-sep {
    opacity: 0.4;
    margin: 0 1px;
  }

  .count-total {
    opacity: 0.7;
  }

  .nav-divider {
    width: 1px;
    height: 14px;
    background: var(--border-color);
    margin: 0 2px;
    flex-shrink: 0;
  }

  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 4px;
    font-size: 14px;
    flex-shrink: 0;
    transition: background 0.1s;
  }

  .nav-btn:hover:not(:disabled) {
    background: rgba(128, 128, 128, 0.2);
    color: var(--text-primary);
  }

  .nav-btn:disabled {
    opacity: 0.25;
    cursor: default;
  }

  .close-btn:hover:not(:disabled) {
    background: rgba(244, 67, 54, 0.15);
    color: #f44336;
  }

  /* ── Filter ── */

  .filter-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .filter-btn {
    display: flex;
    align-items: center;
    width: 120px;
    height: 30px;
    padding: 0 8px;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.1s, border-color 0.1s;
  }

  .filter-side {
    display: flex;
    align-items: center;
    width: 20px;
    flex-shrink: 0;
  }

  .filter-side--right {
    justify-content: flex-end;
  }

  .filter-label {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  .filter-btn:hover {
    color: var(--text-primary);
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .filter-btn.active {
    color: var(--vscode-focusBorder, #007fd4);
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .chevron {
    font-size: 12px;
    opacity: 0.7;
  }

  .filter-count {
    background: var(--vscode-focusBorder, #007fd4);
    color: #fff;
    border-radius: 8px;
    padding: 0 5px;
    font-size: 10px;
    line-height: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
  }


  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }

  .dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    background: var(--vscode-menu-background, #252526);
    border: 1px solid var(--vscode-menu-border, #454545);
    border-radius: 6px;
    padding: 4px 0;
    min-width: 160px;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .dd-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 12px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }

  .dd-item:hover {
    background: var(--vscode-menu-selectionBackground, rgba(255,255,255,0.1));
    color: var(--text-primary);
  }

  .dd-item.active {
    color: var(--text-primary);
  }

  input[type="checkbox"] {
    appearance: none;
    width: 14px;
    height: 14px;
    border: 1px solid var(--text-secondary);
    border-radius: 3px;
    background: transparent;
    cursor: pointer;
    position: relative;
    flex-shrink: 0;
    pointer-events: none;
  }

  input[type="checkbox"]:checked {
    background: var(--vscode-button-background, #0078d4);
    border-color: var(--vscode-button-background, #0078d4);
  }

  input[type="checkbox"]:checked::after {
    content: '';
    position: absolute;
    left: 4px;
    top: 1px;
    width: 4px;
    height: 8px;
    border: solid #fff;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }

  .dd-sep {
    height: 1px;
    background: var(--border-color);
    margin: 3px 0;
  }

  .remote-name {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .remote-icon {
    font-size: 13px;
  }
</style>
