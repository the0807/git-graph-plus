<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { branchStore } from '../../lib/stores/branches.svelte';
  import { uiStore } from '../../lib/stores/ui.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import Modal from '../common/Modal.svelte';
  import ColorSelect from '../common/ColorSelect.svelte';

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
  let newRemoteName = $state('');
  let newRemoteUrl = $state('');

  function refresh() {
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

  function handleAddRemote() {
    const name = newRemoteName.trim();
    const url = newRemoteUrl.trim();
    if (!name || !url) return;
    vscode.postMessage({ type: 'addRemote', payload: { name, url } });
    showAddRemote = false;
    newRemoteName = '';
    newRemoteUrl = '';
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
    <button class="toolbar-btn" onclick={refresh} title={t('toolbar.refreshDesc')}><i class="codicon codicon-refresh"></i> {t('toolbar.refresh')}</button>
  </div>
</div>

{#if showFetchConfirm}
  <Modal title="Fetch" onClose={() => { showFetchConfirm = false; }}>
    <p class="modal-desc">{t('fetch.desc')}</p>
    <div class="info-rows">
      <div class="info-row">
        <span class="info-label">Remote:</span>
        <span class="info-value">
          <select class="modal-select" bind:value={fetchRemote}>
            <option value="">{t('fetch.allRemotes')}</option>
            {#each branchStore.remotes as remote}
              <option value={remote.name}>{remote.name}</option>
            {/each}
          </select>
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">Options:</span>
        <span class="info-value option-checks">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={fetchPrune} />
            <span>{t('fetch.prune')}</span>
          </label>
        </span>
      </div>
    </div>
    <div class="form-actions">
      <button onclick={() => { showFetchConfirm = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={confirmFetch}>Fetch</button>
    </div>
  </Modal>
{/if}

{#if showPushConfirm}
  <Modal title="Push" onClose={() => { showPushConfirm = false; }}>
    <p class="modal-desc">Push local commits to the remote repository.</p>
    <div class="info-rows">
      <div class="info-row"><span class="info-label">Branch:</span><span class="info-value"><i class="codicon codicon-git-branch"></i> {branchStore.currentBranch?.name ?? 'current branch'}</span></div>
      <div class="info-row">
        <span class="info-label">Options:</span>
        <span class="info-value">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={forcePush} />
            <span>Force push (--force-with-lease)</span>
          </label>
        </span>
      </div>
    </div>
    {#if forcePush}
      <p class="warning-text">{t('push.forceWarning')}</p>
    {/if}
    <div class="form-actions">
      <button onclick={() => { showPushConfirm = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={confirmPush}>Push</button>
    </div>
  </Modal>
{/if}

{#if showPullConfirm}
  <Modal title="Pull" onClose={() => { showPullConfirm = false; }}>
    <p class="modal-desc">Pull changes from the remote repository.</p>
    <div class="info-rows">
      <div class="info-row"><span class="info-label">Branch:</span><span class="info-value"><i class="codicon codicon-git-branch"></i> {branchStore.currentBranch?.name ?? 'current branch'}</span></div>
      <div class="info-row">
        <span class="info-label">Options:</span>
        <span class="info-value option-checks">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={pullRebase} />
            <span>Rebase instead of merge</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={pullStash} />
            <span>Stash and reapply local changes</span>
          </label>
        </span>
      </div>
    </div>
    <div class="form-actions">
      <button onclick={() => { showPullConfirm = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={confirmPull}>Pull</button>
    </div>
  </Modal>
{/if}

<!-- Add Remote Modal -->
{#if showAddRemote}
  <Modal title={t('addRemote.title')} onClose={() => { showAddRemote = false; }}>
    <div class="form-group">
      <label for="remote-name">{t('addRemote.name')}</label>
      <input id="remote-name" type="text" bind:value={newRemoteName} placeholder="upstream" />
    </div>
    <div class="form-group">
      <label for="remote-url">{t('addRemote.url')}</label>
      <input id="remote-url" type="text" bind:value={newRemoteUrl} placeholder="https://github.com/..." onkeydown={(e) => { if (e.key === 'Enter') handleAddRemote(); }} />
    </div>
    <div class="form-actions">
      <button onclick={() => { showAddRemote = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={handleAddRemote} disabled={!newRemoteName.trim() || !newRemoteUrl.trim()}>{t('addRemote.add')}</button>
    </div>
  </Modal>
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

  /* Modal form styles */
  .form-group {
    margin-bottom: 12px;
  }

  .form-group label {
    display: block;
    font-size: 12px;
    margin-bottom: 4px;
    color: var(--text-secondary);
  }

  .form-group input[type="text"] {
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

  .form-group input[type="text"]:focus {
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 12px;
  }

  .warning-text {
    font-size: 11px;
    color: var(--vscode-errorForeground, #f44336);
    margin-bottom: 8px;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .modal-desc { font-size: 12px; color: var(--text-secondary); margin-bottom: 16px; }
  .info-rows { display: flex; flex-direction: column; gap: 10px; margin-bottom: 18px; }
  .info-row { display: flex; align-items: center; gap: 12px; font-size: 13px; }
  .info-label { width: 90px; flex-shrink: 0; font-weight: 600; color: var(--text-secondary); }
  .info-value { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .modal-select {
    flex: 1;
    padding: 4px 8px;
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
