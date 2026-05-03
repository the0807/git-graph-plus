<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { t } from '../../lib/i18n/index.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import ResetModal from '../modals/ResetModal.svelte';
  import CheckoutCommitModal from '../modals/CheckoutCommitModal.svelte';
  import { branchStore } from '../../lib/stores/branches.svelte';

  const vscode = getVsCodeApi();

  interface ReflogEntry {
    hash: string;
    shortHash: string;
    selector: string;
    message: string;
    date: string;
    dangling: boolean;
  }

  interface MenuItem {
    label: string;
    icon?: string;
    action: () => void;
    danger?: boolean;
    separator?: boolean;
  }

  let { active = false }: { active?: boolean } = $props();

  // ── 데이터 ──────────────────────────────────────────────
  let entries       = $state<ReflogEntry[]>([]);
  let loading       = $state(true);

  // ── 검색 ────────────────────────────────────────────────
  let query         = $state('');
  let inputEl: HTMLInputElement | undefined = $state();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ── 필터 ────────────────────────────────────────────────
  let refOpen          = $state(false);
  let actionOpen       = $state(false);
  let selectedRef      = $state('');
  let activeActions    = $state<Set<string>>(new Set());
  let danglingOnly     = $state(false);

  const ACTION_TYPES = ['commit', 'checkout', 'reset', 'rebase', 'merge', 'cherry-pick', 'stash', 'pull'] as const;

  const refOptions = $derived([
    'HEAD',
    ...branchStore.localBranches.map(b => b.name),
  ]);

  const refActive = $derived(!!selectedRef && selectedRef !== 'HEAD');
  const actionActive  = $derived(activeActions.size > 0);

  // ── 필터링된 항목 ────────────────────────────────────────
  const filteredEntries = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(entry => {
      if (danglingOnly && !entry.dangling) return false;
      if (activeActions.size > 0) {
        const actionType = parseActionType(entry.message);
        if (!activeActions.has(actionType)) return false;
      }
      if (q) {
        const haystack = (entry.shortHash + ' ' + entry.message).toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  });

  // ── 모달 ────────────────────────────────────────────────
  let contextMenu           = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let showResetModal        = $state(false);
  let resetTarget           = $state('');
  let showCheckoutModal     = $state(false);
  let checkoutTarget        = $state('');

  // ── 액션 파싱 ────────────────────────────────────────────
  const ACTION_MAP: Record<string, { color: string }> = {
    commit:        { color: '#4caf50' },
    checkout:      { color: '#2196f3' },
    rebase:        { color: '#9c27b0' },
    reset:         { color: '#f44336' },
    merge:         { color: '#ff9800' },
    pull:          { color: '#00bcd4' },
    'cherry-pick': { color: '#8bc34a' },
    stash:         { color: '#795548' },
  };

  function parseActionType(message: string): string {
    for (const key of Object.keys(ACTION_MAP)) {
      if (message.startsWith(key)) return key;
    }
    return message.split(':')[0] ?? 'other';
  }

  function parseAction(message: string): { type: string; color: string } {
    const type = parseActionType(message);
    return { type, color: ACTION_MAP[type]?.color ?? '#9e9e9e' };
  }

  function getDisplayMessage(message: string): string {
    const idx = message.indexOf(':');
    return idx >= 0 ? message.substring(idx + 2) : message;
  }

  function relativeTime(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60)  return t('reflog.timeSecond', { n: s });
    const m = Math.floor(s / 60);
    if (m < 60)  return t('reflog.timeMinute', { n: m });
    const h = Math.floor(m / 60);
    if (h < 24)  return t('reflog.timeHour',   { n: h });
    const dy = Math.floor(h / 24);
    if (dy < 30) return t('reflog.timeDay',    { n: dy });
    const mo = Math.floor(dy / 30);
    if (mo < 12) return t('reflog.timeMonth',  { n: mo });
    return t('reflog.timeYear', { n: Math.floor(mo / 12) });
  }

  // ── 데이터 로드 ──────────────────────────────────────────
  function load() {
    if (!selectedRef) selectedRef = 'HEAD';
    if (entries.length === 0) loading = true;
    vscode.postMessage({ type: 'getReflog', payload: { ref: selectedRef } });
  }

  function changeRef(ref: string) {
    selectedRef = ref;
    entries = [];
    loading = true;
    vscode.postMessage({ type: 'getReflog', payload: { ref } });
  }

  $effect(() => { if (active) load(); });

  onMount(() => {
    function handleMessage(e: MessageEvent) {
      const msg = e.data;
      if (msg.type === 'reflogData') {
        entries = msg.payload;
        loading = false;
      } else if (msg.type === 'repoChanged' || msg.type === 'operationComplete') {
        if (active) load();
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  });

  // ── 검색 ────────────────────────────────────────────────
  function onInput() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {}, 0); // filteredEntries is reactive
  }

  function clearSearch() {
    query = '';
    inputEl?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (refOpen)    { refOpen = false; }
      else if (actionOpen) { actionOpen = false; }
      else if (query) { clearSearch(); }
      else { inputEl?.blur(); }
    }
  }

  // ── 필터 ────────────────────────────────────────────────
  function toggleAction(action: string) {
    const next = new Set(activeActions);
    if (next.has(action)) next.delete(action); else next.add(action);
    activeActions = next;
  }

  // ── 컨텍스트 메뉴 ────────────────────────────────────────
  const sep: MenuItem = { separator: true, label: '', action: () => {} };

  function openContextMenu(e: MouseEvent, entry: ReflogEntry) {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = [];

    items.push(
      { label: t('reflog.resetTo', { selector: entry.selector }), action: () => { resetTarget = entry.hash; showResetModal = true; } },
      sep,
      { label: t('graph.checkoutCommit'), action: () => { checkoutTarget = entry.hash; showCheckoutModal = true; } },
      sep,
      { label: t('graph.copySHA'), action: () => vscode.postMessage({ type: 'copyToClipboard', payload: { text: entry.hash } }) },
    );
    contextMenu = { x: e.clientX, y: e.clientY, items };
  }
</script>

<!-- ── 래퍼 ───────────────────────────────────────────── -->
<div class="reflog-wrapper">

<!-- ── 검색바 + 필터 ──────────────────────────────────── -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="search-bar" role="group" onkeydown={handleKeydown}>
  <div class="search-row" class:no-results={query && filteredEntries.length === 0 && entries.length > 0}>
    <i class="codicon codicon-search search-icon"></i>
    <input
      class="search-input"
      type="text"
      bind:this={inputEl}
      bind:value={query}
      oninput={onInput}
      placeholder={t('reflog.searchPlaceholder')}
    />
    {#if query || actionActive || danglingOnly}
      <span class="search-count" class:empty={filteredEntries.length === 0}>
        {#if filteredEntries.length === 0}
          {t('search.noResults')}
        {:else if query}
          {t('reflog.matchCount', { n: filteredEntries.length })}
        {:else}
          {filteredEntries.length} / {entries.length}
        {/if}
      </span>
      {#if query}
        <button class="nav-btn close-btn" onclick={clearSearch} title={t('search.clear')}>
          <i class="codicon codicon-close"></i>
        </button>
      {/if}
    {/if}
  </div>

  <!-- Ref 드롭다운 -->
  <div class="filter-wrap">
    <button
      class="filter-btn"
      class:active={refActive}
      onclick={() => { refOpen = !refOpen; actionOpen = false; }}
      title={t('reflog.filterRef')}
    >
      <i class="codicon codicon-git-branch filter-btn-icon"></i>
      <span class="filter-label">{selectedRef}</span>
      <i class="codicon {refOpen ? 'codicon-chevron-up' : 'codicon-chevron-down'} chevron"></i>
    </button>

    {#if refOpen}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="backdrop" onclick={() => { refOpen = false; }}></div>
      <div class="dropdown">
        {#each refOptions as ref (ref)}
          <button
            class="dd-item"
            class:active={selectedRef === ref}
            onclick={() => { if (selectedRef !== ref) changeRef(ref); refOpen = false; }}
          >
            <span class="dd-radio" class:checked={selectedRef === ref}></span>
            <span class="dd-ref-name">{ref}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Action 드롭다운 -->
  <div class="filter-wrap">
    <button
      class="filter-btn"
      class:active={actionActive}
      onclick={() => { actionOpen = !actionOpen; refOpen = false; }}
      title={t('reflog.filterAction')}
    >
      <i class="codicon codicon-list-filter filter-btn-icon"></i>
      <span class="filter-label">
        {t('reflog.filterAction')}
        {#if actionActive}<span class="filter-count">{activeActions.size}</span>{/if}
      </span>
      <i class="codicon {actionOpen ? 'codicon-chevron-up' : 'codicon-chevron-down'} chevron"></i>
    </button>

    {#if actionOpen}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="backdrop" onclick={() => { actionOpen = false; }}></div>
      <div class="dropdown">
        <button class="dd-item" class:active={activeActions.size === 0} onclick={() => { activeActions = new Set(); }}>
          <input type="checkbox" checked={activeActions.size === 0} readonly />
          {t('reflog.filterAll')}
        </button>
        <div class="dd-sep"></div>
        {#each ACTION_TYPES as action}
          {@const color = ACTION_MAP[action]?.color ?? '#9e9e9e'}
          <button class="dd-item" class:active={activeActions.has(action)} onclick={() => toggleAction(action)}>
            <input type="checkbox" checked={activeActions.has(action)} readonly />
            <span class="action-dot-sm" style="background: {color}"></span>
            {action}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- 잃어버린 커밋 토글 -->
  <button
    class="toggle-btn"
    class:active={danglingOnly}
    onclick={() => { danglingOnly = !danglingOnly; }}
    title={t('reflog.filterDanglingOnly')}
  >
    <i class="codicon codicon-warning"></i>
  </button>
</div>

<!-- ── 리스트 ─────────────────────────────────────────── -->
<div class="reflog-container">
  {#if loading}
    <div class="reflog-empty"><span class="spinner"></span> {t('reflog.loading')}</div>
  {:else if filteredEntries.length === 0}
    <div class="reflog-empty">
      {entries.length === 0 ? t('reflog.empty') : t('reflog.noMatches')}
    </div>
  {:else}
    <div class="reflog-header">
      <div class="col-idx">#</div>
      <div class="col-action">{t('reflog.action')}</div>
      <div class="col-description">{t('graph.description')}</div>
      <div class="col-hash">{t('graph.sha')}</div>
      <div class="col-date">{t('reflog.elapsed')}</div>
    </div>

    <div class="reflog-list" role="list">
      {#each filteredEntries as entry (entry.selector)}
        {@const action = parseAction(entry.message)}
        {@const displayMsg = getDisplayMessage(entry.message)}
        {@const idxLabel = entry.selector.match(/\{(\d+)\}/)?.[1] ?? '0'}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="reflog-row"
          class:dangling={entry.dangling}
          oncontextmenu={(e) => openContextMenu(e, entry)}
          role="listitem"
          title={entry.dangling ? t('reflog.danglingTooltip') : undefined}
        >
          <div class="col-idx">{idxLabel}</div>
          <div class="col-action">
            <span class="action-dot" style="background: {action.color}"></span>
            <span class="action-type">{action.type}</span>
          </div>
          <div class="col-description">
            {#if entry.dangling}
              <i class="codicon codicon-warning dangling-icon"></i>
            {/if}
            <span class="reflog-msg truncate" title={entry.message}>{displayMsg}</span>
          </div>
          <div class="col-hash" title={entry.hash}>{entry.shortHash}</div>
          <div class="col-date" title={new Date(entry.date).toLocaleString()}>{relativeTime(entry.date)}</div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- ── 모달 / 컨텍스트 메뉴 ──────────────────────────── -->
{#if contextMenu}
  <ContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={contextMenu.items}
    onClose={() => { contextMenu = null; }}
  />
{/if}

{#if showCheckoutModal}
  <CheckoutCommitModal
    hash={checkoutTarget}
    onCheckout={(ref, dirty) => { vscode.postMessage({ type: 'checkout', payload: { ref, ...dirty } }); }}
    onClose={() => { showCheckoutModal = false; }}
  />
{/if}

{#if showResetModal}
  <ResetModal
    hash={resetTarget}
    branchName={branchStore.currentBranch?.name ?? 'HEAD'}
    onConfirm={(mode) => { vscode.postMessage({ type: 'reset', payload: { ref: resetTarget, mode } }); }}
    onClose={() => { showResetModal = false; }}
  />
{/if}

</div><!-- /reflog-wrapper -->

<style>
  /* ── 래퍼 ──────────────────────────────────────────── */
  .reflog-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ── 검색바 ─────────────────────────────────────────── */
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
    font-size: inherit;
    font-family: inherit;
    outline: none;
    min-width: 0;
  }

  .search-count {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .search-count.empty {
    color: var(--vscode-inputValidation-warningForeground, #cca700);
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

  .close-btn:hover {
    background: rgba(244, 67, 54, 0.15);
    color: #f44336;
  }

  /* ── 필터 버튼 ──────────────────────────────────────── */
  .filter-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .filter-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 30px;
    padding: 0 8px;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    font-size: inherit;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.1s, border-color 0.1s;
    max-width: 130px;
  }

  .filter-btn:hover {
    color: var(--text-primary);
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .filter-btn.active {
    color: var(--vscode-focusBorder, #007fd4);
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .filter-btn-icon { font-size: 13px; flex-shrink: 0; }

  .filter-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .filter-count {
    background: var(--vscode-focusBorder, #007fd4);
    color: var(--vscode-button-foreground, #fff);
    border-radius: 8px;
    padding: 0 5px;
    font-size: 10px;
    line-height: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  .chevron { font-size: 12px; opacity: 0.7; flex-shrink: 0; }

  /* ── 잃어버린 커밋 토글 버튼 ────────────────────────── */
  .toggle-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    font-size: 14px;
    flex-shrink: 0;
    cursor: pointer;
    transition: color 0.1s, border-color 0.1s, background 0.1s;
  }

  .toggle-btn:hover {
    color: var(--vscode-editorWarning-foreground, #ff9800);
    border-color: var(--vscode-editorWarning-foreground, #ff9800);
  }

  .toggle-btn.active {
    color: var(--vscode-editorWarning-foreground, #ff9800);
    border-color: var(--vscode-editorWarning-foreground, #ff9800);
    background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #ff9800) 12%, transparent);
  }

  /* ── 드롭다운 ───────────────────────────────────────── */
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
    min-width: 190px;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  :global(body.vscode-light) .dropdown {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  }

  .dd-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 4px 12px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: inherit;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }

  .dd-item:hover {
    background: var(--vscode-menu-selectionBackground, rgba(255,255,255,0.1));
    color: var(--text-primary);
  }

  .dd-item.active { color: var(--text-primary); }

  .dd-ref-name {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
  }

  .dd-radio {
    width: 14px;
    height: 14px;
    border: 1px solid var(--text-secondary);
    border-radius: 50%;
    flex-shrink: 0;
    position: relative;
  }

  .dd-radio.checked {
    border-color: var(--vscode-button-background, #0078d4);
  }

  .dd-radio.checked::after {
    content: '';
    position: absolute;
    inset: 3px;
    background: var(--vscode-button-background, #0078d4);
    border-radius: 50%;
  }

  .dd-sep {
    height: 1px;
    background: var(--border-color);
    margin: 3px 0;
  }

  .action-dot-sm {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
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

  /* ── 리스트 컨테이너 ─────────────────────────────────── */
  .reflog-container {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  .reflog-empty {
    padding: 32px;
    text-align: center;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  /* ── 헤더 ───────────────────────────────────────────── */
  .reflog-header {
    display: flex;
    align-items: center;
    height: 32px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
    text-transform: uppercase;
    color: var(--text-secondary);
    user-select: none;
  }

  /* ── 행 ─────────────────────────────────────────────── */
  .reflog-list { flex: 1; overflow-y: auto; }

  .reflog-row {
    display: flex;
    align-items: center;
    height: 30px;
    border-bottom: 1px solid var(--border-color);
    cursor: default;
    user-select: none;
    transition: background 0.08s;
  }

  .reflog-row:hover { background: var(--bg-hover); }

  .reflog-row.dangling {
    background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #ff9800) 8%, transparent);
    border-left: 2px solid var(--vscode-editorWarning-foreground, #ff9800);
  }

  .reflog-row.dangling:hover {
    background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #ff9800) 14%, transparent);
  }

  .dangling-icon {
    color: var(--vscode-editorWarning-foreground, #ff9800);
    font-size: 11px;
    flex-shrink: 0;
    margin-right: 4px;
  }

  /* ── 컬럼 ───────────────────────────────────────────── */
  .col-idx {
    width: 30px;
    flex-shrink: 0;
    padding: 0 10px 0 6px;
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--text-secondary);
    text-align: right;
    opacity: 0.7;
  }

  .col-action {
    width: 90px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px;
    overflow: hidden;
  }

  .col-description {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    padding: 0 10px;
    overflow: hidden;
  }

  .col-hash {
    width: 75px;
    flex-shrink: 0;
    padding: 0 10px;
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--text-secondary);
  }

  .col-date {
    width: 80px;
    flex-shrink: 0;
    padding: 0 10px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .action-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .action-type {
    color: var(--text-secondary);
    flex-shrink: 0;
    opacity: 0.8;
  }

  .reflog-msg {
    flex: 1;
    min-width: 0;
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid var(--border-color);
    border-top-color: var(--text-secondary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
</style>
