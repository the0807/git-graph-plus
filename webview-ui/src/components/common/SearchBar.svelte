<script lang="ts">
  import { commitStore } from '../../lib/stores/commits.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  interface Props {
    onResults: (matchedHashes: Set<string> | null) => void;
    onNavigate: (hash: string) => void;
  }

  let { onResults, onNavigate }: Props = $props();

  let query = $state('');
  let matchedHashes = $state<string[]>([]);
  let currentIndex = $state(-1);
  let inputEl: HTMLInputElement | undefined = $state();

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
      clear();
      inputEl?.blur();
    }
  }

  function clear() {
    query = '';
    matchedHashes = [];
    currentIndex = -1;
    onResults(null);
  }

  function onInput() {
    if (!query.trim()) {
      clear();
      return;
    }
    doSearch();
  }
</script>

<div class="search-bar">
  <div class="search-row" class:has-results={query && matchedHashes.length > 0} class:no-results={query && matchedHashes.length === 0}>
    <i class="codicon codicon-search search-icon"></i>
    <input
      class="search-input"
      type="text"
      bind:this={inputEl}
      bind:value={query}
      onkeydown={handleKeydown}
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
</div>

<style>
  .search-bar {
    padding: 5px 14px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
  }

  .search-row {
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
</style>
