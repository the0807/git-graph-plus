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
  }

  interface MenuItem {
    label: string;
    icon?: string;
    action: () => void;
    danger?: boolean;
    separator?: boolean;
  }

  let { active = false }: { active?: boolean } = $props();

  let entries = $state<ReflogEntry[]>([]);
  let loading = $state(true);
  let contextMenu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let showResetModal = $state(false);
  let resetTarget = $state('');
  let showCheckoutModal = $state(false);
  let checkoutTarget = $state('');

  $effect(() => {
    if (active) load();
  });

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

  function parseAction(message: string): { type: string; color: string } {
    for (const [key, val] of Object.entries(ACTION_MAP)) {
      if (message.startsWith(key)) return { type: key, ...val };
    }
    return { type: message.split(':')[0] ?? 'other', color: '#9e9e9e' };
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

  function load() {
    if (entries.length === 0) loading = true;
    vscode.postMessage({ type: 'getReflog' });
  }

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

  const sep: MenuItem = { separator: true, label: '', action: () => {} };

  function openContextMenu(e: MouseEvent, entry: ReflogEntry) {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = [
      { label: t('reflog.resetTo', { selector: entry.selector.replace(/[{}]/g, '') }), action: () => { resetTarget = entry.hash; showResetModal = true; } },
      sep,
      { label: t('graph.checkoutCommit'), action: () => { checkoutTarget = entry.hash; showCheckoutModal = true; } },
      sep,
      { label: t('graph.copySHA'),        action: () => vscode.postMessage({ type: 'copyToClipboard', payload: { text: entry.hash } }) },
    ];
    contextMenu = { x: e.clientX, y: e.clientY, items };
  }
</script>

<div class="reflog-container">
  {#if loading}
    <div class="reflog-empty"><span class="spinner"></span> {t('reflog.loading')}</div>
  {:else if entries.length === 0}
    <div class="reflog-empty">{t('reflog.empty')}</div>
  {:else}
    <div class="reflog-header">
      <div class="col-idx">#</div>
      <div class="col-action">{t('reflog.action')}</div>
      <div class="col-description">{t('graph.description')}</div>
      <div class="col-hash">{t('graph.sha')}</div>
      <div class="col-date">{t('reflog.elapsed')}</div>
    </div>

    <div class="reflog-list" role="list">
      {#each entries as entry (entry.selector)}
        {@const action = parseAction(entry.message)}
        {@const displayMsg = getDisplayMessage(entry.message)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="reflog-row"
          oncontextmenu={(e) => openContextMenu(e, entry)}
          role="listitem"
        >
          <div class="col-idx">{entry.selector.replace(/[{}]/g, '')}</div>
          <div class="col-action">
            <span class="action-dot" style="background: {action.color}"></span>
            <span class="action-type">{action.type}</span>
          </div>
          <div class="col-description">
            <span class="reflog-msg truncate" title={entry.message}>{displayMsg}</span>
          </div>
          <div class="col-hash" title={entry.hash}>{entry.shortHash}</div>
          <div class="col-date" title={new Date(entry.date).toLocaleString()}>{relativeTime(entry.date)}</div>
        </div>
      {/each}
    </div>
  {/if}
</div>

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

<style>
  .reflog-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .reflog-empty {
    padding: 32px;
    text-align: center;
    color: var(--text-secondary);
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  /* ---- Header ---- */
  .reflog-header {
    display: flex;
    align-items: center;
    height: 32px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-secondary);
    user-select: none;
  }

  /* ---- List ---- */
  .reflog-list {
    flex: 1;
    overflow-y: auto;
  }

  /* ---- Row ---- */
  .reflog-row {
    display: flex;
    align-items: center;
    height: 28px;
    font-size: 13px;
    border-bottom: 1px solid var(--border-color);
    cursor: default;
    user-select: none;
    transition: background 0.08s;
  }

  .reflog-row:hover {
    background: var(--bg-hover);
  }

  /* ---- Columns ---- */
  .col-idx {
    width: 30px;
    flex-shrink: 0;
    padding: 0 10px 0 6px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
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
    text-align: left;
  }

  .col-date {
    width: 80px;
    flex-shrink: 0;
    padding: 0 10px;
    color: var(--text-secondary);
    white-space: nowrap;
    text-align: left;
  }

  /* ---- Description internals ---- */
  .action-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .action-type {
    font-size: 11px;
    color: var(--text-secondary);
    flex-shrink: 0;
    opacity: 0.8;
  }

  .reflog-msg {
    flex: 1;
    min-width: 0;
    font-size: 13px;
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
