<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { branchStore } from '../../lib/stores/branches.svelte';
  import { uiStore } from '../../lib/stores/ui.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import Modal from '../common/Modal.svelte';
  import AddRemoteModal from '../modals/AddRemoteModal.svelte';

  const vscode = getVsCodeApi();

  let operating = $state<string | null>(null);
  let showFetchConfirm = $state(false);
  let fetchPrune = $state(true);
  let fetchRemote = $state('');
  let showPushConfirm = $state(false);
  let forcePush = $state(false);
  let showPullConfirm = $state(false);
  let pullRebase = $state(false);
  let pullStash = $state(false);
  let showAddRemote = $state(false);

  function refresh() {
    operating = 'refresh';
    vscode.postMessage({ type: 'getLog', payload: { limit: 1000 } });
    vscode.postMessage({ type: 'getBranches' });
  }

  function switchToGraph() {
    uiStore.viewMode = 'graph';
  }

  function doFetch() {
    showFetchConfirm = true;
    fetchPrune = true;
    fetchRemote = '';
  }

  function confirmFetch() {
    operating = 'fetch';
    showFetchConfirm = false;
    vscode.postMessage({ type: 'fetch', payload: { remote: fetchRemote || undefined, prune: fetchPrune } });
  }

  function doPull() {
    showPullConfirm = true;
    pullRebase = false;
    pullStash = false;
  }

  function confirmPull() {
    operating = 'pull';
    showPullConfirm = false;
    vscode.postMessage({ type: 'pull', payload: { rebase: pullRebase, stash: pullStash } });
  }

  function doPush() {
    showPushConfirm = true;
    forcePush = false;
  }

  function confirmPush() {
    operating = 'push';
    showPushConfirm = false;
    vscode.postMessage({ type: 'push', payload: { force: forcePush, setUpstream: true } });
  }

  function switchRepo(repoPath: string) {
    vscode.postMessage({ type: 'switchRepo', payload: { path: repoPath } });
  }

  // Listen for operation complete to clear spinner
  onMount(() => {
    function handler(event: MessageEvent) {
      const msg = event.data;
      if ((msg.type === 'operationComplete' || msg.type === 'error') && operating) {
        operating = null;
      }
      if (msg.type === 'logData' && operating === 'refresh') {
        operating = null;
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  });

  let ahead = $derived(branchStore.currentBranch?.ahead ?? 0);
  let behind = $derived(branchStore.currentBranch?.behind ?? 0);
</script>

<div class="toolbar">
  <div class="toolbar-left">
    <span class="toolbar-title">Git Graph+</span>
    {#if uiStore.repos.length > 1}
      <select
        class="repo-selector"
        value={uiStore.activeRepo}
        onchange={(e) => switchRepo((e.target as HTMLSelectElement).value)}
      >
        {#each uiStore.repos as repo}
          <option value={repo.path}>{repo.name}</option>
        {/each}
      </select>
    {/if}
    {#if branchStore.currentBranch}
      <span class="current-branch">
        <i class="codicon codicon-git-branch branch-icon"></i>
        {branchStore.currentBranch.name}
      </span>
      {#if ahead > 0 || behind > 0}
        <span class="branch-sync">
          {#if ahead > 0}<span class="sync-badge ahead"><i class="codicon codicon-arrow-up"></i>{ahead}</span>{/if}
          {#if behind > 0}<span class="sync-badge behind"><i class="codicon codicon-arrow-down"></i>{behind}</span>{/if}
        </span>
      {/if}
    {/if}
  </div>

  <div class="toolbar-center">
    <button
      class="view-tab"
      class:active={uiStore.viewMode === 'graph'}
      onclick={switchToGraph}
    >
      {t('toolbar.history')}
    </button>
    <button
      class="view-tab"
      class:active={uiStore.viewMode === 'log'}
      onclick={() => { uiStore.viewMode = 'log'; }}
    >
      {t('toolbar.log')}
    </button>
    <button
      class="view-tab"
      class:active={uiStore.viewMode === 'stats'}
      onclick={() => { uiStore.viewMode = 'stats'; }}
    >
      {t('toolbar.stats')}
    </button>
  </div>

  <div class="toolbar-right">
    <button
      class="toolbar-btn"
      onclick={doFetch}
      disabled={operating !== null}
      title={t('toolbar.fetchAll')}
    >
      {#if operating === 'fetch'}<span class="spinner"></span>{:else}<i class="codicon codicon-cloud-download"></i>{/if}
      {t('toolbar.fetch')}
    </button>
    <button
      class="toolbar-btn"
      onclick={doPull}
      disabled={operating !== null}
      title={t('toolbar.pullDesc')}
    >
      {#if operating === 'pull'}<span class="spinner"></span>{:else}<i class="codicon codicon-repo-pull"></i>{/if}
      {t('toolbar.pull')}
      {#if behind > 0}<span class="btn-badge">{behind}</span>{/if}
    </button>
    <button
      class="toolbar-btn"
      onclick={doPush}
      disabled={operating !== null}
      title={t('toolbar.pushDesc')}
    >
      {#if operating === 'push'}<span class="spinner"></span>{:else}<i class="codicon codicon-repo-push"></i>{/if}
      {t('toolbar.push')}
      {#if ahead > 0}<span class="btn-badge">{ahead}</span>{/if}
    </button>
    <span class="separator"></span>
    <button class="toolbar-btn" onclick={refresh} disabled={operating !== null} title={t('toolbar.refreshDesc')}>
      {#if operating === 'refresh'}<span class="spinner"></span>{:else}<i class="codicon codicon-refresh"></i>{/if}
      {t('toolbar.refresh')}
    </button>
  </div>
</div>

{#if showFetchConfirm}
  <Modal title={t('fetch.title')} onClose={() => { showFetchConfirm = false; }}>
    <p class="modal-desc">{t('fetch.desc')}</p>
    <div class="modal-form-group">
      <label class="modal-field-label" for="fetch-remote">{t('fetch.remote')}</label>
      <select class="modal-select" id="fetch-remote" bind:value={fetchRemote}>
        <option value="">{t('fetch.allRemotes')}</option>
        {#each branchStore.remotes as remote}
          <option value={remote.name}>{remote.name}</option>
        {/each}
      </select>
    </div>
    <div class="modal-form-group">
      <label class="modal-checkbox">
        <input type="checkbox" bind:checked={fetchPrune} />
        <span>{t('fetch.prune')}</span>
      </label>
    </div>
    <div class="form-actions">
      <button onclick={() => { showFetchConfirm = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={confirmFetch}>{t('fetch.fetch')}</button>
    </div>
  </Modal>
{/if}

{#if showPushConfirm}
  <Modal title={t('push.title')} onClose={() => { showPushConfirm = false; }}>
    <p class="modal-desc">{t('push.desc')}</p>
    <div class="modal-context-card">
      <span class="modal-pill modal-pill--target">{branchStore.currentBranch?.name ?? 'current branch'}</span>
    </div>
    <div class="modal-form-group">
      <label class="modal-checkbox modal-checkbox--danger">
        <input type="checkbox" bind:checked={forcePush} />
        <span>{t('push.forcePushOption')}</span>
      </label>
    </div>
    {#if forcePush}
      <p class="modal-warning" role="alert">{t('push.forceWarning')}</p>
    {/if}
    <div class="form-actions">
      <button onclick={() => { showPushConfirm = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={confirmPush}>{t('push.push')}</button>
    </div>
  </Modal>
{/if}

{#if showPullConfirm}
  <Modal title={t('pull.title')} onClose={() => { showPullConfirm = false; }}>
    <p class="modal-desc">{t('pull.desc')}</p>
    <div class="modal-context-card">
      <span class="modal-pill modal-pill--target">{branchStore.currentBranch?.name ?? 'current branch'}</span>
    </div>
    <div class="modal-form-group">
      <label class="modal-checkbox">
        <input type="checkbox" bind:checked={pullRebase} />
        <span>{t('pull.rebase')}</span>
      </label>
    </div>
    <div class="modal-form-group">
      <label class="modal-checkbox">
        <input type="checkbox" bind:checked={pullStash} />
        <span>{t('pull.stash')}</span>
      </label>
    </div>
    <div class="form-actions">
      <button onclick={() => { showPullConfirm = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={confirmPull}>{t('pull.pull')}</button>
    </div>
  </Modal>
{/if}

{#if showAddRemote}
  <AddRemoteModal
    onClose={() => { showAddRemote = false; }}
    onAdd={(name, url) => { showAddRemote = false; vscode.postMessage({ type: 'addRemote', payload: { name, url } }); }}
  />
{/if}

<style>
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--toolbar-height);
    padding: 0 12px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .toolbar-title {
    font-weight: 600;
    font-size: 13px;
  }

  .repo-selector {
    padding: 2px 6px;
    font-size: 11px;
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border, var(--border-color));
    border-radius: 3px;
    outline: none;
  }

  .current-branch {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 10px;
    background: var(--button-bg);
    color: var(--button-fg);
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
  }

  .branch-icon {
    font-size: 12px;
  }

  .branch-sync {
    display: flex;
    gap: 4px;
    font-size: 10px;
  }

  .sync-badge {
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 1px 5px;
    border-radius: 8px;
    font-weight: 600;
  }

  .sync-badge.ahead {
    background: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground, #73c991) 20%, transparent);
    color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
  }

  .sync-badge.behind {
    background: color-mix(in srgb, var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d) 20%, transparent);
    color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d);
  }

  .toolbar-center {
    display: flex;
    align-items: center;
    gap: 2px;
    background: rgba(128, 128, 128, 0.15);
    border-radius: 4px;
    padding: 2px;
  }

  .view-tab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 10px;
    font-size: 11px;
    border-radius: 3px;
    background: transparent;
    color: var(--text-secondary);
  }

  .view-tab.active {
    background: var(--button-bg);
    color: var(--button-fg);
  }

  .view-tab:hover:not(.active) {
    color: var(--text-primary);
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 3px 8px;
    font-size: 11px;
  }

  .toolbar-btn:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .btn-badge {
    background: var(--vscode-badge-background, #4d4d4d);
    color: var(--vscode-badge-foreground, #fff);
    font-size: 9px;
    padding: 0 4px;
    border-radius: 6px;
    min-width: 14px;
    text-align: center;
  }

  .separator {
    width: 1px;
    height: 16px;
    background: var(--border-color);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .modal-select {
    width: 100%;
    padding: 5px 8px;
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border, var(--border-color));
    border-radius: 3px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
  }
  .modal-select:focus { border-color: var(--vscode-focusBorder, #007fd4); }
</style>
