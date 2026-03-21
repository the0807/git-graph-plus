<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { branchStore } from '../../lib/stores/branches.svelte';
  import { uiStore } from '../../lib/stores/ui.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import Modal from '../common/Modal.svelte';
  import AddRemoteModal from '../modals/AddRemoteModal.svelte';
  import { modalStore } from '../../lib/stores/modals.svelte';
  import type { FlowStatus, FlowBranches } from '../../lib/types';

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
  let showRepoDropdown = $state(false);
  let showFlowDropdown = $state(false);
  let flowStatus = $state<FlowStatus | null>(null);
  let flowBranches = $state<FlowBranches>({ features: [], releases: [], hotfixes: [] });

  function refresh() {
    operating = 'refresh';
    vscode.postMessage({ type: 'getLog', payload: { limit: 1000 } });
    vscode.postMessage({ type: 'getBranches' });
    vscode.postMessage({ type: 'getRepoList' });
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

  function openFlowDropdown() {
    showFlowDropdown = !showFlowDropdown;
    if (showFlowDropdown) {
      vscode.postMessage({ type: 'checkFlowStatus' });
      vscode.postMessage({ type: 'getFlowBranches' });
    }
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
      if (msg.type === 'flowStatus') flowStatus = msg.payload;
      if (msg.type === 'flowBranches') flowBranches = msg.payload;
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  });

  let ahead = $derived(branchStore.currentBranch?.ahead ?? 0);
  let behind = $derived(branchStore.currentBranch?.behind ?? 0);
</script>

<div class="toolbar">
  <div class="toolbar-left">
    <div class="repo-pill-wrapper">
      <button
        class="repo-pill"
        class:clickable={uiStore.repos.length > 1}
        onclick={() => { if (uiStore.repos.length > 1) showRepoDropdown = !showRepoDropdown; }}
      >
        <i class="codicon codicon-repo repo-icon"></i>
        <span class="repo-name">
          {uiStore.repos.find(r => r.path === uiStore.activeRepo)?.name ?? uiStore.repos[0]?.name ?? 'Repository'}
        </span>
        {#if uiStore.repos.length > 1}
          <i class="codicon codicon-chevron-down repo-chevron"></i>
        {/if}
      </button>
      {#if showRepoDropdown}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="repo-dropdown-backdrop" onclick={() => { showRepoDropdown = false; }}></div>
        <div class="repo-dropdown">
          {#each uiStore.repos as repo}
            <button
              class="repo-dropdown-item"
              class:active={repo.path === uiStore.activeRepo}
              onclick={() => { showRepoDropdown = false; switchRepo(repo.path); }}
            >
              <i class="codicon {repo.path === uiStore.activeRepo ? 'codicon-check' : 'codicon-repo'}"></i>
              {repo.name}
            </button>
          {/each}
        </div>
      {/if}
    </div>
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
      onclick={() => { modalStore.openStashSave(); }}
      disabled={operating !== null}
      title={t('toolbar.stashDesc')}
    >
      <i class="codicon codicon-archive"></i>
    </button>
    <span class="separator"></span>
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
    <span class="separator"></span>
    <div class="flow-wrapper">
      <button
        class="toolbar-btn"
        onclick={openFlowDropdown}
        title={t('flow.button')}
      >
        <i class="codicon codicon-source-control"></i>
        <i class="codicon codicon-chevron-down flow-chevron"></i>
      </button>
      {#if showFlowDropdown}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="flow-dropdown-backdrop" onclick={() => { showFlowDropdown = false; }}></div>
        <div class="flow-dropdown">
          {#if !flowStatus}
            <div class="flow-dropdown-item disabled">Loading...</div>
          {:else if !flowStatus.installed}
            <div class="flow-dropdown-item disabled">{t('flow.notInstalled')}</div>
          {:else if !flowStatus.initialized}
            <button class="flow-dropdown-item" onclick={() => { showFlowDropdown = false; modalStore.openFlowInit(); }}>
              {t('flow.initialize')}
            </button>
          {:else}
            <button class="flow-dropdown-item" onclick={() => { showFlowDropdown = false; modalStore.openFlowStart('feature'); }}>
              {t('flow.startFeature')}
            </button>
            <button class="flow-dropdown-item" onclick={() => { showFlowDropdown = false; modalStore.openFlowStart('release'); }}>
              {t('flow.startRelease')}
            </button>
            <button class="flow-dropdown-item" onclick={() => { showFlowDropdown = false; modalStore.openFlowStart('hotfix'); }}>
              {t('flow.startHotfix')}
            </button>
            {#if flowBranches.features.length || flowBranches.releases.length || flowBranches.hotfixes.length}
              <div class="flow-dropdown-separator"></div>
              {#each flowBranches.features as branch}
                <button class="flow-dropdown-item" onclick={() => { showFlowDropdown = false; modalStore.openFlowFinish('feature', branch); }}>
                  {t('flow.finish', { name: branch })}
                </button>
              {/each}
              {#each flowBranches.releases as branch}
                <button class="flow-dropdown-item" onclick={() => { showFlowDropdown = false; modalStore.openFlowFinish('release', branch); }}>
                  {t('flow.finish', { name: branch })}
                </button>
              {/each}
              {#each flowBranches.hotfixes as branch}
                <button class="flow-dropdown-item" onclick={() => { showFlowDropdown = false; modalStore.openFlowFinish('hotfix', branch); }}>
                  {t('flow.finish', { name: branch })}
                </button>
              {/each}
            {/if}
          {/if}
        </div>
      {/if}
    </div>
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
    height: 44px;
    padding: 0 14px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .repo-pill-wrapper {
    position: relative;
  }

  .repo-pill {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px;
    height: 26px;
    background: rgba(128, 128, 128, 0.12);
    border: 1px solid rgba(128, 128, 128, 0.15);
    color: var(--text-primary);
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: default;
  }

  .repo-pill.clickable {
    cursor: pointer;
  }

  .repo-pill.clickable:hover {
    background: rgba(128, 128, 128, 0.2);
  }

  .repo-icon {
    font-size: 14px;
    opacity: 0.7;
  }

  .repo-name {
    white-space: nowrap;
  }

  .repo-chevron {
    font-size: 10px;
    opacity: 0.6;
    margin-left: -2px;
  }

  .repo-dropdown-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }

  .repo-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 160px;
    background: var(--vscode-menu-background, var(--bg-secondary));
    border: 1px solid var(--vscode-menu-border, var(--border-color));
    border-radius: 6px;
    padding: 4px;
    z-index: 100;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  }

  .repo-dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 10px;
    font-size: 12px;
    color: var(--vscode-menu-foreground, var(--text-primary));
    background: transparent;
    border-radius: 4px;
    text-align: left;
    cursor: pointer;
  }

  .repo-dropdown-item:hover {
    background: var(--vscode-menu-selectionBackground, rgba(128, 128, 128, 0.2));
    color: var(--vscode-menu-selectionForeground, var(--text-primary));
  }

  .repo-dropdown-item.active {
    font-weight: 600;
  }

  .repo-dropdown-item .codicon {
    font-size: 14px;
    width: 14px;
  }

  .current-branch {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px;
    height: 26px;
    background: var(--button-bg);
    color: var(--button-fg);
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
  }

  .branch-icon {
    font-size: 14px;
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
    padding: 3px 11px;
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
    gap: 3px;
  }

  .toolbar-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0;
    font-size: 22px;
    border-radius: 5px;
    background: transparent;
    color: var(--text-secondary);
    min-width: 36px;
    height: 36px;
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

  .flow-wrapper {
    position: relative;
  }

  .flow-chevron {
    font-size: 10px;
    margin-left: -2px;
    opacity: 0.7;
  }

  .flow-dropdown-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 99;
  }

  .flow-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    min-width: 220px;
    background: var(--vscode-menu-background, var(--bg-secondary));
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 4px 0;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .flow-dropdown-item {
    display: block;
    width: 100%;
    padding: 6px 12px;
    font-size: 12px;
    text-align: left;
    background: none;
    border: none;
    color: var(--text-primary);
    cursor: pointer;
    white-space: nowrap;
  }

  .flow-dropdown-item:hover:not(.disabled) {
    background: var(--vscode-menu-selectionBackground, rgba(128, 128, 128, 0.2));
  }

  .flow-dropdown-item.disabled {
    color: var(--text-secondary);
    cursor: default;
  }

  .flow-dropdown-separator {
    border-top: 1px solid var(--border-color);
    margin: 4px 0;
  }

</style>
