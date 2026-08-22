<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { branchStore } from '../../lib/stores/branches.svelte';
  import { uiStore } from '../../lib/stores/ui.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import AddRemoteModal from '../modals/AddRemoteModal.svelte';
  import NoRemotesErrorModal from '../modals/NoRemotesErrorModal.svelte';
  import { tooltip } from '../../lib/actions/tooltip';
  import { modalStore } from '../../lib/stores/modals.svelte';
  import { commitStore } from '../../lib/stores/commits.svelte';
  import { samePath } from '../../lib/utils/path';
  import type { FlowStatus, FlowBranches } from '../../lib/types';

  const vscode = getVsCodeApi();

  interface Props {
    onRefresh?: () => void;
  }
  let { onRefresh = () => {} }: Props = $props();

  let showAddRemote = $state(false);
  let showRepoDropdown = $state(false);
  let showFlowDropdown = $state(false);
  let defaultBranch = $state<string | null>(null);
  let flowStatus = $state<FlowStatus | null>(null);
  let flowBranches = $state<FlowBranches>({ features: [], releases: [], hotfixes: [] });
  let showNoRemotesError = $state(false);

  function refresh() {
    uiStore.operating = 'refresh';
    onRefresh();
  }

  function switchToGraph() {
    uiStore.viewMode = 'graph';
  }

  function doFetch() {
    if (branchStore.remotes.length === 0) { showNoRemotesError = true; return; }
    // A single-remote repo has nothing to choose, so skip the modal and fetch directly.
    if (branchStore.remotes.length === 1) {
      uiStore.operating = 'fetch';
      vscode.postMessage({ type: 'fetch', payload: { remote: branchStore.remotes[0].name, prune: true } });
      return;
    }
    modalStore.openFetch(branchStore.remotes[0].name);
  }

  function doPull() {
    modalStore.openPull();
  }

  function doPush() {
    if (branchStore.remotes.length === 0) { showNoRemotesError = true; return; }
    modalStore.openPush(branchStore.remotes[0].name);
  }

  function openRemoteRepository() {
    if (branchStore.remotes.length === 0) { showNoRemotesError = true; return; }
    const remote = branchStore.remotes.find(r => r.name === 'origin') ?? branchStore.remotes[0];
    vscode.postMessage({ type: 'openRemoteRepository', payload: { remote: remote.name } });
  }

  function openFlowDropdown() {
    showFlowDropdown = !showFlowDropdown;
    if (showFlowDropdown) {
      vscode.postMessage({ type: 'checkFlowStatus' });
      vscode.postMessage({ type: 'getFlowBranches' });
      vscode.postMessage({ type: 'getDefaultBranch' });
    }
  }

  function switchRepo(repoPath: string) {
    vscode.postMessage({ type: 'switchRepo', payload: { path: repoPath } });
  }

  onMount(() => {
    // Note: App.svelte also listens for `message` events. The two handlers write to
    // disjoint state (App: rebasePaused/conflict, this: uiStore.operating) and read
    // nothing from each other, so the registration order is irrelevant. If a future
    // change introduces cross-dependency between them, route everything through a
    // single dispatcher instead.
    function handler(event: MessageEvent) {
      const msg = event.data;
      if ((msg.type === 'operationComplete' || msg.type === 'error') && uiStore.operating) {
        uiStore.operating = null;
      }
      if (msg.type === 'logData' && uiStore.operating === 'refresh') {
        uiStore.operating = null;
      }
      if (msg.type === 'flowStatus') flowStatus = msg.payload;
      if (msg.type === 'flowBranches') flowBranches = msg.payload;
      if (msg.type === 'defaultBranch') defaultBranch = msg.payload.name;
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  });

  // A "gone" upstream (remote branch deleted) is treated as no upstream so the
  // push button shows the unpublished state and offers to re-create it.
  const hasUpstream = $derived(!!branchStore.currentBranch?.upstream && !branchStore.currentBranch?.upstreamGone);
  let ahead = $derived(branchStore.currentBranch?.ahead ?? 0);
  let behind = $derived(branchStore.currentBranch?.behind ?? 0);
  let activeRepoInfo = $derived(uiStore.repos.find(r => samePath(r.path, uiStore.activeRepo)) ?? uiStore.repos[0]);

  const currentBranchName = $derived(branchStore.currentBranch?.name ?? null);
  // git reports non-branch HEAD states as parenthesized pseudo-labels
  // ("(HEAD detached at …)", "(no branch, rebasing main)", "(no branch, bisect …)").
  // None of these are checkout-able start points, so fall back to the SHA.
  const isDetached = $derived(!!currentBranchName?.startsWith('('));
  // While detached/rebasing/bisecting there's no branch name to show, so the
  // badge falls back to the short HEAD SHA (matching git's "detached at <sha>").
  const detachedSha = $derived(
    branchStore.currentBranch?.hash?.slice(0, 7) || t('toolbar.detachedHead'),
  );
  const createStartPoint = $derived(
    isDetached || !currentBranchName ? (branchStore.currentBranch?.hash ?? 'HEAD') : currentBranchName,
  );
  const hasUncommitted = $derived(commitStore.commits.some(c => c.hash === 'UNCOMMITTED'));
  // Lean Sync/Finish need a real default branch that isn't the current one.
  const leanEnabled = $derived(
    !!defaultBranch && !isDetached && !!currentBranchName && currentBranchName !== defaultBranch,
  );

  function createBranchFromCurrent() {
    modalStore.openCreateBranch(createStartPoint);
  }
  function newWorktree() {
    vscode.postMessage({ type: 'worktreeAddModalRequest', payload: { startPoint: createStartPoint } });
  }
  function leanSync() {
    if (leanEnabled) modalStore.runDrag('rebase', currentBranchName!, defaultBranch!, hasUncommitted);
  }
  function leanFinish() {
    if (leanEnabled) modalStore.runDrag('merge', currentBranchName!, defaultBranch!, hasUncommitted);
  }

  // Esc closes whichever toolbar dropdown is open (mirrors the backdrop click).
  // When a dropdown is open it is the foreground layer, so Esc must dismiss
  // only it — stop the event so App's global Esc handler doesn't also close
  // the bottom panel underneath. Toolbar's <svelte:window> listener is
  // registered before App's (children mount before the parent's onMount), so
  // stopImmediatePropagation here reliably pre-empts that handler.
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (!showFlowDropdown && !showRepoDropdown) return;
    showFlowDropdown = false;
    showRepoDropdown = false;
    // Drop focus from the trigger button so the keyboard :focus-visible
    // outline doesn't linger on it after the menu is dismissed.
    (document.activeElement as HTMLElement | null)?.blur();
    e.stopImmediatePropagation();
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="toolbar">
  <div class="toolbar-left">
    <div class="repo-pill-wrapper">
      <button
        class="repo-pill"
        class:clickable={uiStore.repos.length > 1}
        onclick={() => { if (uiStore.repos.length > 1) showRepoDropdown = !showRepoDropdown; }}
        use:tooltip={activeRepoInfo?.name}
      >
        <i class="codicon {
          activeRepoInfo?.type === 'submodule' ? 'codicon-archive' : 
          activeRepoInfo?.type === 'nested' ? 'codicon-folder-library' : 
          'codicon-repo'
        } repo-icon"></i>
        <span class="repo-name">
          {activeRepoInfo?.name ?? 'Repository'}
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
              class:active={samePath(repo.path, uiStore.activeRepo)}
              onclick={() => { showRepoDropdown = false; switchRepo(repo.path); }}
            >
              <i class="codicon {
                samePath(repo.path, uiStore.activeRepo) ? 'codicon-check' :
                repo.type === 'submodule' ? 'codicon-archive' : 
                repo.type === 'nested' ? 'codicon-folder-library' :
                'codicon-repo'
              }"></i>
              <span class="repo-dropdown-item-name">{repo.name}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
    {#if branchStore.currentBranch}
      <span class="current-branch" use:tooltip={isDetached ? (branchStore.currentBranch.hash || branchStore.currentBranch.name) : branchStore.currentBranch.name}>
        <i class="codicon {isDetached ? 'codicon-git-commit' : 'codicon-git-branch'} branch-icon"></i>
        <span class="branch-name">
          {isDetached ? detachedSha : branchStore.currentBranch.name}
        </span>
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
      onclick={openRemoteRepository}
      disabled={uiStore.operating !== null}
      aria-label={t('toolbar.openRemoteRepository')}
      use:tooltip={t('toolbar.openRemoteRepository')}
    >
      <i class="codicon codicon-globe"></i>
    </button>
    <button
      class="toolbar-btn"
      onclick={doFetch}
      disabled={uiStore.operating !== null}
      use:tooltip={t('toolbar.fetchAll')}
    >
      {#if uiStore.operating === 'fetch'}<span class="spinner"></span>{:else}<i class="codicon codicon-cloud-download"></i>{/if}
    </button>
    <button
      class="toolbar-btn"
      class:has-badge={behind > 0}
      onclick={doPull}
      disabled={uiStore.operating !== null}
      use:tooltip={t('toolbar.pullDesc')}
    >
      {#if uiStore.operating === 'pull'}<span class="spinner"></span>{:else}<i class="codicon codicon-arrow-down"></i>{/if}
      {#if behind > 0}<span class="btn-badge pull-badge">{behind}</span>{/if}
    </button>
    <button
      class="toolbar-btn"
      class:has-badge={ahead > 0}
      onclick={doPush}
      disabled={uiStore.operating !== null}
      use:tooltip={t('toolbar.pushDesc')}
    >
      {#if uiStore.operating === 'push'}
        <span class="spinner"></span>
      {:else if !hasUpstream && branchStore.currentBranch}
        <i class="codicon codicon-cloud-upload unpublished-icon"></i>
      {:else}
        <i class="codicon codicon-arrow-up"></i>
      {/if}
      {#if ahead > 0}<span class="btn-badge push-badge">{ahead}</span>{/if}
    </button>
    <span class="separator"></span>
    <button
      class="toolbar-btn"
      onclick={() => { modalStore.openStashSave(); }}
      disabled={uiStore.operating !== null}
      aria-label={t('toolbar.stashDesc')}
      use:tooltip={t('toolbar.stashDesc')}
    >
      <i class="codicon codicon-archive"></i>
    </button>
    <span class="separator"></span>
    <div class="flow-wrapper">
      <div class="split-btn">
        <button
          class="toolbar-btn split-main"
          onclick={createBranchFromCurrent}
          disabled={uiStore.operating !== null}
          aria-label={t('flow.newBranch')}
          use:tooltip={t('flow.newBranch')}
        >
          <i class="codicon codicon-git-branch"></i>
        </button>
        <button
          class="toolbar-btn split-chevron"
          onclick={openFlowDropdown}
          disabled={uiStore.operating !== null}
          aria-label={t('flow.group')}
          use:tooltip={t('flow.group')}
        >
          <i class="codicon codicon-chevron-down flow-chevron"></i>
        </button>
      </div>
      {#if showFlowDropdown}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="flow-dropdown-backdrop" onclick={() => { showFlowDropdown = false; }}></div>
        <div class="flow-dropdown">
          <button class="flow-dropdown-item" onclick={() => { showFlowDropdown = false; createBranchFromCurrent(); }}>
            {t('flow.newBranch')}
          </button>
          <button class="flow-dropdown-item" onclick={() => { showFlowDropdown = false; newWorktree(); }}>
            {t('flow.newWorktree')}
          </button>
          {#if leanEnabled}
            <div class="flow-dropdown-separator"></div>
            <button class="flow-dropdown-item" onclick={() => { showFlowDropdown = false; leanSync(); }}>
              {t('flow.leanSync', { current: currentBranchName ?? '', branch: defaultBranch ?? '' })}
            </button>
            <button class="flow-dropdown-item" onclick={() => { showFlowDropdown = false; leanFinish(); }}>
              {t('flow.leanFinish', { current: currentBranchName ?? '', branch: defaultBranch ?? '' })}
            </button>
          {/if}
          <div class="flow-dropdown-separator"></div>
          <div class="flow-submenu-wrapper">
            <button class="flow-dropdown-item flow-submenu-trigger">
              {t('flow.group')}<i class="codicon codicon-chevron-right flow-submenu-arrow"></i>
            </button>
            <div class="flow-submenu">
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
                  {#if flowBranches.features.length}
                    <div class="flow-submenu-wrapper">
                      <button class="flow-dropdown-item flow-submenu-trigger">
                        {t('flow.finishFeature')}<i class="codicon codicon-chevron-right flow-submenu-arrow"></i>
                      </button>
                      <div class="flow-submenu">
                        {#each flowBranches.features as branch}
                          <button class="flow-dropdown-item" onclick={() => { showFlowDropdown = false; modalStore.openFlowFinish('feature', branch); }}>{branch}</button>
                        {/each}
                      </div>
                    </div>
                  {/if}
                  {#if flowBranches.releases.length}
                    <div class="flow-submenu-wrapper">
                      <button class="flow-dropdown-item flow-submenu-trigger">
                        {t('flow.finishRelease')}<i class="codicon codicon-chevron-right flow-submenu-arrow"></i>
                      </button>
                      <div class="flow-submenu">
                        {#each flowBranches.releases as branch}
                          <button class="flow-dropdown-item" onclick={() => { showFlowDropdown = false; modalStore.openFlowFinish('release', branch); }}>{branch}</button>
                        {/each}
                      </div>
                    </div>
                  {/if}
                  {#if flowBranches.hotfixes.length}
                    <div class="flow-submenu-wrapper">
                      <button class="flow-dropdown-item flow-submenu-trigger">
                        {t('flow.finishHotfix')}<i class="codicon codicon-chevron-right flow-submenu-arrow"></i>
                      </button>
                      <div class="flow-submenu">
                        {#each flowBranches.hotfixes as branch}
                          <button class="flow-dropdown-item" onclick={() => { showFlowDropdown = false; modalStore.openFlowFinish('hotfix', branch); }}>{branch}</button>
                        {/each}
                      </div>
                    </div>
                  {/if}
                {/if}
              {/if}
            </div>
          </div>
        </div>
      {/if}
    </div>
    <span class="separator"></span>
    <button
      class="toolbar-btn"
      onclick={refresh}
      disabled={uiStore.operating !== null}
      use:tooltip={t('toolbar.refresh')}
    >
      {#if uiStore.operating === 'refresh'}<span class="spinner"></span>{:else}<i class="codicon codicon-refresh"></i>{/if}
    </button>
    <button
      class="toolbar-btn"
      onclick={() => { vscode.postMessage({ type: 'openExtensionSettings' }); }}
      aria-label={t('toolbar.settings')}
      use:tooltip={t('toolbar.settings')}
    >
      <i class="codicon codicon-gear"></i>
    </button>
  </div>
</div>

{#if showAddRemote}
  <AddRemoteModal
    onClose={() => { showAddRemote = false; }}
    onAdd={(name, url) => { showAddRemote = false; vscode.postMessage({ type: 'addRemote', payload: { name, url } }); }}
  />
{/if}

{#if showNoRemotesError}
  <NoRemotesErrorModal
    onClose={() => { showNoRemotesError = false; }}
    onAddRemote={() => { showNoRemotesError = false; showAddRemote = true; }}
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
    max-width: 180px;
    background: rgba(128, 128, 128, 0.12);
    border: 1px solid rgba(128, 128, 128, 0.15);
    color: var(--text-primary);
    border-radius: 6px;
    font-size: inherit;
    font-weight: normal;
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
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
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
    max-width: calc(100vw - 32px);
    background: var(--vscode-menu-background, var(--bg-secondary));
    border: 1px solid var(--vscode-menu-border, var(--border-color));
    border-radius: 6px;
    padding: 4px;
    z-index: 100;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  }

  :global(body.vscode-light) .repo-dropdown {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  }

  .repo-dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 10px;
    font-size: inherit;
    color: var(--vscode-menu-foreground, var(--text-primary));
    background: transparent;
    border-radius: 4px;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  .repo-dropdown-item:hover {
    background: var(--vscode-menu-selectionBackground, rgba(128, 128, 128, 0.2));
    color: var(--vscode-menu-selectionForeground, var(--text-primary));
  }

  .repo-dropdown-item.active {
    font-weight: normal;
  }

  .repo-dropdown-item .codicon {
    font-size: 14px;
    width: 14px;
    flex-shrink: 0;
  }

  .repo-dropdown-item-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .current-branch {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px;
    height: 26px;
    max-width: 180px;
    background: var(--button-bg);
    color: var(--button-fg);
    border-radius: 6px;
    font-size: inherit;
    font-weight: normal;
  }

  .branch-icon {
    font-size: 14px;
  }

  .branch-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    font-size: inherit;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    font-weight: normal;
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

  .btn-badge {
    position: absolute;
    top: -3px;
    right: -3px;
    font-size: 10px;
    font-weight: 700;
    padding: 0 4px;
    border-radius: 8px;
    min-width: 17px;
    text-align: center;
    line-height: 17px;
    box-shadow: 0 0 0 1.5px var(--vscode-editor-background, #1e1e1e);
  }

  .pull-badge {
    background: #e08c00;
    color: #fff;
  }

  .push-badge {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
  }

  .unpublished-icon {
    color: var(--vscode-button-background, #0e639c);
    font-size: 18px;
  }

  .separator {
    width: 1px;
    height: 18px;
    background: var(--border-color);
    margin: 0 4px;
  }

  .flow-wrapper {
    position: relative;
  }

  .split-btn {
    display: flex;
    align-items: center;
  }

  .split-main {
    min-width: 30px;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .split-chevron {
    min-width: 22px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
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
    min-width: 280px;
    background: var(--vscode-menu-background, var(--bg-secondary));
    border: 1px solid var(--vscode-menu-border, var(--border-color));
    border-radius: 4px;
    padding: 4px 0;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    font-size: var(--vscode-font-size, 13px);
  }

  :global(body.vscode-light) .flow-dropdown {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .flow-dropdown-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 3px 14px;
    font-size: inherit;
    text-align: left;
    background: none;
    border: none;
    color: var(--vscode-menu-foreground, var(--text-primary));
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.08s;
  }

  .flow-dropdown-item:hover:not(.disabled) {
    background: var(--vscode-menu-selectionBackground, var(--bg-selected));
    color: var(--vscode-menu-selectionForeground, var(--text-selected));
  }

  .flow-dropdown-item.disabled {
    opacity: 0.5;
    cursor: default;
  }

  .flow-dropdown-separator {
    height: 1px;
    margin: 4px 8px;
    background: var(--border-color);
  }

  .flow-submenu-wrapper {
    position: relative;
  }

  .flow-submenu-trigger {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .flow-submenu-arrow {
    margin-left: auto;
    font-size: 11px;
    opacity: 0.5;
  }

  .flow-submenu {
    display: none;
    position: absolute;
    top: -5px;
    right: 100%;
    margin-right: 2px;
    min-width: 180px;
    background: var(--vscode-menu-background, var(--bg-secondary));
    border: 1px solid var(--vscode-menu-border, var(--border-color));
    border-radius: 4px;
    padding: 4px 0;
    z-index: 101;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  :global(body.vscode-light) .flow-submenu {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  /* Transparent bridge spanning the gap between the trigger and the flyout
     (which opens to the left). Without it, the cursor crossing the 2px
     margin briefly hovers neither element and the pure-CSS :hover flyout
     snaps shut before the pointer reaches it. */
  .flow-submenu::after {
    content: '';
    position: absolute;
    top: 0;
    left: 100%;
    width: 8px;
    height: 100%;
  }

  .flow-submenu-wrapper:hover > .flow-submenu {
    display: block;
  }
</style>
