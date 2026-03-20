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
    </button>
    <button
      class="toolbar-btn"
      class:has-badge={behind > 0}
      onclick={doPull}
      disabled={operating !== null}
      title={t('toolbar.pullDesc')}
    >
      {#if operating === 'pull'}<span class="spinner"></span>{:else}<i class="codicon codicon-arrow-down"></i>{/if}
      {#if behind > 0}<span class="btn-badge pull-badge">{behind}</span>{/if}
    </button>
    <button
      class="toolbar-btn"
      class:has-badge={ahead > 0}
      onclick={doPush}
      disabled={operating !== null}
      title={t('toolbar.pushDesc')}
    >
      {#if operating === 'push'}<span class="spinner"></span>{:else}<i class="codicon codicon-arrow-up"></i>{/if}
      {#if ahead > 0}<span class="btn-badge push-badge">{ahead}</span>{/if}
    </button>
    <span class="separator"></span>
    <button class="toolbar-btn icon-only" onclick={refresh} disabled={operating !== null} title={t('toolbar.refreshDesc')}>
      {#if operating === 'refresh'}<span class="spinner"></span>{:else}<i class="codicon codicon-refresh"></i>{/if}
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
      <i class="codicon codicon-git-branch"></i>
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
      <i class="codicon codicon-git-branch"></i>
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
    height: 36px;
    padding: 0 10px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toolbar-title {
    font-weight: 600;
    font-size: 12px;
    opacity: 0.7;
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

  .toolbar-center {
    display: flex;
    align-items: center;
    gap: 1px;
    background: rgba(128, 128, 128, 0.12);
    border-radius: 5px;
    padding: 2px;
  }

  .view-tab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 12px;
    font-size: 11px;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .view-tab.active {
    background: var(--button-bg);
    color: var(--button-fg);
  }

  .view-tab:hover:not(.active) {
    color: var(--text-primary);
    background: rgba(128, 128, 128, 0.1);
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .toolbar-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 4px 10px;
    font-size: 16px;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    min-width: 32px;
    height: 32px;
  }

  .toolbar-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .toolbar-btn:disabled {
    opacity: 0.4;
    cursor: wait;
  }

  .toolbar-btn.icon-only {
    padding: 4px 6px;
  }

  .btn-badge {
    position: absolute;
    top: -2px;
    right: -2px;
    font-size: 10px;
    font-weight: 700;
    padding: 0 5px;
    border-radius: 8px;
    min-width: 16px;
    text-align: center;
    line-height: 16px;
  }

  .pull-badge {
    background: color-mix(in srgb, var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d) 25%, transparent);
    color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d);
  }

  .push-badge {
    background: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground, #73c991) 25%, transparent);
    color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
  }

  .separator {
    width: 1px;
    height: 18px;
    background: var(--border-color);
    margin: 0 4px;
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
