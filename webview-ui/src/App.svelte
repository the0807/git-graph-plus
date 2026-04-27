<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getVsCodeApi } from './lib/vscode-api';
  import { commitStore } from './lib/stores/commits.svelte';
  import { branchStore } from './lib/stores/branches.svelte';
  import { uiStore, BOTTOM_PANEL_DEFAULT_RATIO, BOTTOM_PANEL_MIN_RATIO, BOTTOM_PANEL_MAX_RATIO } from './lib/stores/ui.svelte';
  import { i18n, t } from './lib/i18n/index.svelte';
  import CommitGraph from './components/graph/CommitGraph.svelte';
  import BottomPanel from './components/layout/BottomPanel.svelte';
  import Toolbar from './components/layout/Toolbar.svelte';
  import SearchBar from './components/common/SearchBar.svelte';
  import ActivityLog from './components/common/ActivityLog.svelte';
  import StatsView from './components/common/StatsView.svelte';
  import DeleteBranchModal from './components/modals/DeleteBranchModal.svelte';
  import DeleteTagModal from './components/modals/DeleteTagModal.svelte';
  import CreateBranchModal from './components/modals/CreateBranchModal.svelte';
  import CreateTagModal from './components/modals/CreateTagModal.svelte';
  import MergeBranchModal from './components/modals/MergeBranchModal.svelte';
  import CheckoutRemoteModal from './components/modals/CheckoutRemoteModal.svelte';
  import AddWorktreeModal from './components/modals/AddWorktreeModal.svelte';
  import Modal from './components/common/Modal.svelte';
  import ColorSelect from './components/common/ColorSelect.svelte';
  import { modalStore } from './lib/stores/modals.svelte';
  import SetUpstreamModal from './components/modals/SetUpstreamModal.svelte';
  import FlowInitModal from './components/modals/FlowInitModal.svelte';
  import FlowStartModal from './components/modals/FlowStartModal.svelte';
  import FlowFinishModal from './components/modals/FlowFinishModal.svelte';
  import BisectBanner from './components/common/BisectBanner.svelte';
  import type { FlowConfig } from './lib/types';

  const vscode = getVsCodeApi();

  let flowConfig = $state<FlowConfig | null>(null);
  let bisectMessage = $state<string | null>(null);
  let searchMatchedHashes = $state<Set<string> | null>(null);
  let searchNavigateHash = $state<string | null>(null);
  let remoteFilter = $state<string[]>([]);
  let resizing = $state(false);
  let conflict = $state<{ operation: string; files: Array<{ path: string; resolved: boolean }> } | null>(null);
  let showAbortConfirmModal = $state(false);

  // Non-shared modals (unique to Activity Bar)
  let showStashDropModal = $state(false);
  let stashDropIndex = $state(0);
  let stashDropMessage = $state('');
  let showDeleteRemoteTagModal = $state(false);
  let deleteRemoteTagName = $state('');
  let showAddWorktreeModal = $state(false);
  let addWorktreeDefaultPath = $state('');
  let renameBranchNew = $state('');
  let stashRenameNew = $state('');
  $effect(() => { if (modalStore.stashRename.show) stashRenameNew = modalStore.stashRename.message; });
  let stashSaveMessage = $state('');
  let stashSaveIncludeUntracked = $state(true);
  let stashSaveKeepIndex = $state(false);
  let deleteWorktreeBranch = $state(false);
  let tagDetailsModal = $state<{ name: string; hash: string; message?: string; isAnnotated: boolean } | null>(null);
  onMount(() => {
    uiStore.bottomPanelHeight = Math.round(window.innerHeight * BOTTOM_PANEL_DEFAULT_RATIO);

    function handleMessage(event: MessageEvent) {
      const msg = event.data;
      switch (msg.type) {
        case 'logData':
          commitStore.setData(msg.payload);
          break;
        case 'branchData':
          branchStore.setData(msg.payload);
          break;
        case 'fullRefresh':
          remoteFilter = [];
          branchStore.setData(msg.payload.branchData);
          commitStore.setData(msg.payload.logData);
          break;
        case 'setLocale':
          i18n.setLocale(msg.payload.locale);
          if (msg.payload.homeDir) uiStore.homeDir = msg.payload.homeDir;
          break;
        case 'repoList':
          uiStore.repos = msg.payload.repos;
          uiStore.activeRepo = msg.payload.active;
          break;
        case 'tagDetailsData':
          tagDetailsModal = msg.payload;
          break;
        case 'conflictData':
          conflict = msg.payload;
          break;
        case 'error':
          uiStore.setError(msg.payload.message);
          break;
        case 'flowStatus':
          flowConfig = msg.payload.config;
          break;
        case 'bisectResult':
          bisectMessage = msg.payload.message;
          break;
        case 'operationComplete':
          if (msg.payload.operation === 'bisectReset') {
            bisectMessage = null;
          }
          if (msg.payload.operation === 'copied') {
            vscode.postMessage({ type: 'showNotification', payload: { message: t('copiedToClipboard') } });
          }
          conflict = null;
          break;
        case 'showModal':
          if (msg.payload.modal === 'deleteBranch') {
            modalStore.openDeleteBranch(msg.payload.branchName);
          } else if (msg.payload.modal === 'deleteTag') {
            modalStore.openDeleteTag(msg.payload.tagName);
          } else if (msg.payload.modal === 'stashDrop') {
            stashDropIndex = msg.payload.index;
            stashDropMessage = msg.payload.message;
            showStashDropModal = true;
          } else if (msg.payload.modal === 'stashPop') {
            modalStore.openStashApply(msg.payload.index, msg.payload.message, true);
          } else if (msg.payload.modal === 'renameBranch') {
            renameBranchNew = msg.payload.branchName;
            modalStore.openRenameBranch(msg.payload.branchName);
          } else if (msg.payload.modal === 'mergeBranch') {
            modalStore.openMerge(msg.payload.branchName, branchStore.currentBranch?.name ?? 'HEAD');
          } else if (msg.payload.modal === 'createBranch') {
            modalStore.openCreateBranch('HEAD');
          } else if (msg.payload.modal === 'createTag') {
            modalStore.openCreateTag('HEAD');
          } else if (msg.payload.modal === 'stashSave') {
            stashSaveMessage = ''; stashSaveIncludeUntracked = true; stashSaveKeepIndex = false;
            modalStore.openStashSave();
          } else if (msg.payload.modal === 'checkoutRemote') {
            modalStore.openCheckoutRemote(msg.payload.remoteName, msg.payload.localName);
          } else if (msg.payload.modal === 'deleteRemoteTag') {
            deleteRemoteTagName = msg.payload.tagName;
            showDeleteRemoteTagModal = true;
          } else if (msg.payload.modal === 'deleteRemoteBranch') {
            modalStore.openDeleteRemoteBranch(msg.payload.remote, msg.payload.name);
          } else if (msg.payload.modal === 'removeWorktree') {
            deleteWorktreeBranch = false;
            modalStore.openRemoveWorktree(msg.payload.path, msg.payload.branch);
          } else if (msg.payload.modal === 'addWorktree') {
            addWorktreeDefaultPath = msg.payload.defaultPath;
            showAddWorktreeModal = true;
          } else if (msg.payload.modal === 'fetch') {
            modalStore.openFetch();
          } else if (msg.payload.modal === 'pull') {
            modalStore.openPull();
          } else if (msg.payload.modal === 'push') {
            modalStore.openPush();
          }
          break;
      }
    }

    window.addEventListener('message', handleMessage);

    // Request initial data
    commitStore.setLoading(true);
    vscode.postMessage({ type: 'getLog', payload: {} });
    vscode.postMessage({ type: 'getBranches' });
    vscode.postMessage({ type: 'checkFlowStatus' });

    // Refresh conflict status when webview becomes visible
    function handleVisibility() {
      if (!document.hidden && conflict) {
        vscode.postMessage({ type: 'refreshConflicts' });
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    // Keyboard shortcuts
    window.addEventListener('keydown', handleGlobalKeydown);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('keydown', handleGlobalKeydown);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  });

  function handleGlobalKeydown(e: KeyboardEvent) {
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === '1') { e.preventDefault(); uiStore.viewMode = 'graph'; }
    if (ctrl && e.key === '2') { e.preventDefault(); uiStore.viewMode = 'log'; }
    if (ctrl && e.key === '3') { e.preventDefault(); uiStore.viewMode = 'stats'; }

    if (ctrl && e.key === 'f' && uiStore.viewMode === 'graph') {
      e.preventDefault();
      const searchInput = document.querySelector('.search-input') as HTMLInputElement;
      searchInput?.focus();
    }

    if (ctrl && e.key === 'r') {
      e.preventDefault();
      vscode.postMessage({ type: 'getLog', payload: {
        limit: commitStore.currentLimit || undefined,
        remoteFilter: remoteFilter.length > 0 ? remoteFilter : undefined,
      }});
      vscode.postMessage({ type: 'getBranches' });
    }

    if (e.key === 'Escape' && uiStore.showBottomPanel && (uiStore.selectedCommitHash || uiStore.comparing)) {
      e.preventDefault();
      uiStore.selectedCommitHash = null;
      uiStore.comparing = false;
      uiStore.showBottomPanel = false;
    }
  }

  function handleSearchResults(hashes: Set<string> | null) {
    searchMatchedHashes = hashes;
    searchNavigateHash = null;
  }

  function handleSearchNavigate(hash: string) {
    searchNavigateHash = hash;
  }

  function handleFilterChange(filter: string[]) {
    remoteFilter = filter;
    vscode.postMessage({
      type: 'getLog',
      payload: {
        limit: commitStore.currentLimit || undefined,
        remoteFilter: filter.length > 0 ? filter : undefined,
      },
    });
  }

  // Draggable resize handle - track active listeners for cleanup
  let resizeCleanup: (() => void) | null = null;

  function startResize(e: MouseEvent) {
    e.preventDefault();
    resizing = true;
    const startY = e.clientY;
    const startHeight = uiStore.bottomPanelHeight;

    function onMouseMove(e: MouseEvent) {
      const delta = startY - e.clientY;
      uiStore.bottomPanelHeight = Math.max(window.innerHeight * BOTTOM_PANEL_MIN_RATIO, Math.min(window.innerHeight * BOTTOM_PANEL_MAX_RATIO, startHeight + delta));
    }

    function onMouseUp() {
      resizing = false;
      resizeCleanup = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    resizeCleanup = onMouseUp;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  onDestroy(() => { resizeCleanup?.(); });
</script>

<div class="app-container" class:resizing>
  <Toolbar />

  {#if conflict}
    <div class="conflict-banner">
      <div class="conflict-header">
        <div class="conflict-info">
          <i class="codicon codicon-warning conflict-icon"></i>
          <span class="conflict-title">
            <strong>{{ merge: 'Merge', rebase: 'Rebase', revert: 'Revert', cherryPick: 'Cherry-Pick' }[conflict.operation] ?? conflict.operation} Conflict</strong>
          </span>
          <span class="conflict-count">{conflict.files.filter(f => f.resolved).length}/{conflict.files.length} resolved</span>
        </div>
        <div class="conflict-actions">
          <button class="conflict-btn conflict-btn--abort" onclick={() => { showAbortConfirmModal = true; }}>
            <i class="codicon codicon-discard"></i> Abort
          </button>
          <button class="conflict-btn conflict-btn--continue" disabled={conflict.files.some(f => !f.resolved)} onclick={() => { const op = conflict?.operation ?? 'merge'; vscode.postMessage({ type: 'continueOperation' }); conflict = null; vscode.postMessage({ type: 'showNotification', payload: { message: t('conflict.resolveSuccess', { operation: op }) } }); }}>
            <i class="codicon codicon-check"></i> Resolve
          </button>
        </div>
      </div>
      <div class="conflict-files">
        {#each conflict.files as file}
          <div class="conflict-file-row" class:resolved={file.resolved}>
            <button class="conflict-file" onclick={() => vscode.postMessage({ type: 'openConflictFile', payload: { file: file.path } })}>
              {#if file.resolved}
                <i class="codicon codicon-check conflict-file-status resolved-icon"></i>
              {:else}
                <span class="conflict-file-status">C</span>
              {/if}
              <span class="conflict-file-path">
                {#if file.path.includes('/')}
                  <span class="conflict-file-dir">{file.path.substring(0, file.path.lastIndexOf('/') + 1)}</span>{file.path.substring(file.path.lastIndexOf('/') + 1)}
                {:else}
                  {file.path}
                {/if}
              </span>
              {#if !file.resolved}
                <span class="conflict-stage-hint" onclick={(e) => { e.stopPropagation(); vscode.postMessage({ type: 'stageFile', payload: { file: file.path } }); }} role="button" tabindex={0} onkeydown={(e) => { if (e.key === 'Enter') vscode.postMessage({ type: 'stageFile', payload: { file: file.path } }); }} title="Mark as resolved (git add)">
                  <i class="codicon codicon-check"></i>
                </span>
              {/if}
              <i class="codicon codicon-go-to-file conflict-open-icon" title="Open file"></i>
            </button>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if showAbortConfirmModal}
    <Modal title={t('conflict.abortTitle')} onClose={() => { showAbortConfirmModal = false; }}>
      <p class="modal-desc">{@html t('conflict.abortConfirm', { operation: conflict?.operation ?? 'merge' })}</p>
      <div class="form-actions">
        <button onclick={() => { showAbortConfirmModal = false; }}>{t('common.cancel')}</button>
        <button class="danger-btn" onclick={() => { showAbortConfirmModal = false; vscode.postMessage({ type: 'abortOperation' }); conflict = null; }}>{t('conflict.abort')}</button>
      </div>
    </Modal>
  {/if}

  {#if uiStore.errorMessage}
    <div class="error-bar">
      <span class="error-text">{uiStore.errorMessage}</span>
      <button class="error-dismiss" onclick={() => uiStore.setError(null)}>{t('common.dismiss')}</button>
    </div>
  {/if}

  <div class="content-area">
    {#if uiStore.viewMode === 'graph'}
      {#if !bisectMessage && !conflict}
        <SearchBar
          onResults={handleSearchResults}
          onNavigate={handleSearchNavigate}
          remotes={branchStore.remotes.map(r => r.name)}
          {remoteFilter}
          onFilterChange={handleFilterChange}
        />
      {/if}
      {#if bisectMessage}
        <BisectBanner
          message={bisectMessage}
          onReset={() => {
            vscode.postMessage({ type: 'bisectReset' });
          }}
        />
      {/if}
      <div class="graph-area">
        <CommitGraph {searchMatchedHashes} {searchNavigateHash} bisectActive={bisectMessage !== null} bisectCulpritHash={bisectMessage?.includes('is the first bad commit') ? bisectMessage.match(/^([a-f0-9]{7,40})/)?.[1] ?? null : null} {remoteFilter} />
      </div>
      {#if uiStore.showBottomPanel && (uiStore.selectedCommitHash || uiStore.comparing)}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="resize-handle-h"
          role="separator"
          onmousedown={startResize}
        >
          <div class="resize-handle-line"></div>
        </div>
        <div class="bottom-area" style="height: {uiStore.bottomPanelHeight}px;">
          <BottomPanel />
        </div>
      {/if}
    {:else if uiStore.viewMode === 'log'}
      <div class="log-container">
        <ActivityLog />
      </div>
    {:else if uiStore.viewMode === 'stats'}
      <div class="stats-container">
        <StatsView />
      </div>
    {/if}
  </div>
</div>

<!-- Shared modals (via modalStore) -->
{#if modalStore.deleteBranch.show}
  <DeleteBranchModal
    branchName={modalStore.deleteBranch.name}
    onClose={() => { modalStore.closeDeleteBranch(); }}
    onDelete={(force, deleteWorktreePath, deleteRemote) => { const name = modalStore.deleteBranch.name; modalStore.closeDeleteBranch(); vscode.postMessage({ type: 'deleteBranch', payload: { name, force, worktreePath: deleteWorktreePath, deleteRemote } }); }}
  />
{/if}

{#if modalStore.deleteTag.show}
  <DeleteTagModal
    tagName={modalStore.deleteTag.name}
    hasRemote={branchStore.remotes.length > 0}
    onClose={() => { modalStore.closeDeleteTag(); }}
    onDelete={(deleteRemote) => { const name = modalStore.deleteTag.name; modalStore.closeDeleteTag(); vscode.postMessage({ type: 'deleteTag', payload: { name } }); if (deleteRemote) vscode.postMessage({ type: 'deleteRemoteTag', payload: { name } }); }}
  />
{/if}

{#if showStashDropModal}
  <Modal title={t('stashDrop.title')} onClose={() => { showStashDropModal = false; }}>
    <p class="modal-desc">{t('stashDrop.confirm', { message: stashDropMessage })}</p>
    <div class="form-actions">
      <button onclick={() => { showStashDropModal = false; }}>{t('common.cancel')}</button>
      <button class="danger-btn" onclick={() => { showStashDropModal = false; vscode.postMessage({ type: 'stashDrop', payload: { index: stashDropIndex } }); }}>{t('sidebar.drop')}</button>
    </div>
  </Modal>
{/if}

{#if modalStore.stashApply.show}
  <Modal title={modalStore.stashApply.drop ? t('stashPop.title') : t('stashApply.title')} onClose={() => { modalStore.closeStashApply(); }}>
    <p class="modal-desc">{@html modalStore.stashApply.drop ? t('stashPop.desc') : t('stashApply.desc')}</p>
    <div class="modal-context-card">
      <span class="modal-pill modal-pill--stash"><i class="codicon codicon-archive"></i><span class="modal-pill-text">{modalStore.stashApply.message || `stash@{${modalStore.stashApply.index}}`}</span></span>
      <i class="codicon codicon-arrow-right" style="color: var(--text-secondary);"></i>
      <span class="modal-pill modal-pill--target"><i class="codicon codicon-git-branch"></i><span class="modal-pill-text">{branchStore.currentBranch?.name ?? 'current branch'}</span></span>
    </div>
    <div class="form-actions">
      <button onclick={() => { modalStore.closeStashApply(); }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => { const { index, drop } = modalStore.stashApply; modalStore.closeStashApply(); vscode.postMessage({ type: 'stashApply', payload: { index, drop } }); }}>{modalStore.stashApply.drop ? t('stashPop.pop') : t('stashApply.apply')}</button>
    </div>
  </Modal>
{/if}

{#if modalStore.renameBranch.show}
  <Modal title={t('renameBranch.title')} onClose={() => { modalStore.closeRenameBranch(); }}>
    <div class="modal-context-card">
      <span class="modal-pill modal-pill--source"><i class="codicon codicon-git-branch"></i><span class="modal-pill-text">{modalStore.renameBranch.oldName}</span></span>
    </div>
    <div class="modal-form-group">
      <label class="modal-field-label" for="rename-branch-input">{t('renameBranch.newName')}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="rename-branch-input" class="modal-input" type="text" bind:value={renameBranchNew} autofocus
        onkeydown={(e) => { if (e.key === 'Enter' && renameBranchNew.trim() && renameBranchNew !== modalStore.renameBranch.oldName) { const old = modalStore.renameBranch.oldName; modalStore.closeRenameBranch(); vscode.postMessage({ type: 'renameBranch', payload: { oldName: old, newName: renameBranchNew } }); } }} />
    </div>
    <div class="form-actions">
      <button onclick={() => { modalStore.closeRenameBranch(); }}>{t('common.cancel')}</button>
      <button class="primary" disabled={!renameBranchNew.trim() || renameBranchNew === modalStore.renameBranch.oldName} onclick={() => { const old = modalStore.renameBranch.oldName; modalStore.closeRenameBranch(); vscode.postMessage({ type: 'renameBranch', payload: { oldName: old, newName: renameBranchNew } }); }}>{t('renameBranch.rename')}</button>
    </div>
  </Modal>
{/if}

{#if modalStore.stashRename.show}
  <Modal title={t('stashRename.title')} onClose={() => { modalStore.closeStashRename(); }}>
    <div class="modal-context-card">
      <span class="modal-pill modal-pill--stash"><i class="codicon codicon-archive"></i><span class="modal-pill-text">{'stash@{' + modalStore.stashRename.index + '}'}</span></span>
    </div>
    <div class="modal-form-group">
      <label class="modal-field-label" for="stash-rename-input">{t('stashRename.newMessage')}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="stash-rename-input" class="modal-input" type="text" bind:value={stashRenameNew} autofocus
        onkeydown={(e) => { if (e.key === 'Enter' && stashRenameNew.trim()) { const idx = modalStore.stashRename.index; modalStore.closeStashRename(); vscode.postMessage({ type: 'stashRename', payload: { index: idx, message: stashRenameNew } }); } }} />
    </div>
    <div class="form-actions">
      <button onclick={() => { modalStore.closeStashRename(); }}>{t('common.cancel')}</button>
      <button class="primary" disabled={!stashRenameNew.trim()} onclick={() => { const idx = modalStore.stashRename.index; modalStore.closeStashRename(); vscode.postMessage({ type: 'stashRename', payload: { index: idx, message: stashRenameNew } }); }}>{t('stashRename.rename')}</button>
    </div>
  </Modal>
{/if}

{#if modalStore.merge.show}
  <MergeBranchModal
    source={modalStore.merge.source}
    target={modalStore.merge.target}
    onClose={() => { modalStore.closeMerge(); }}
    onMerge={(options) => { const branch = modalStore.merge.source; modalStore.closeMerge(); vscode.postMessage({ type: 'merge', payload: { branch, ...options } }); }}
  />
{/if}

{#if modalStore.createBranch.show}
  <CreateBranchModal
    startPoint={modalStore.createBranch.startPoint}
    subject={modalStore.createBranch.subject}
    onClose={() => { modalStore.closeCreateBranch(); }}
    onCreate={(name, startPoint, checkout) => { modalStore.closeCreateBranch(); vscode.postMessage({ type: 'createBranch', payload: { name, startPoint, checkout } }); }}
  />
{/if}

{#if modalStore.createTag.show}
  <CreateTagModal
    startPoint={modalStore.createTag.ref}
    subject={modalStore.createTag.subject}
    onClose={() => { modalStore.closeCreateTag(); }}
    onCreate={(name, message, startPoint, push) => { modalStore.closeCreateTag(); vscode.postMessage({ type: 'createTag', payload: { name, ref: startPoint, message: message || undefined } }); if (push) vscode.postMessage({ type: 'pushTag', payload: { name } }); }}
  />
{/if}

{#if modalStore.stashSave.show}
  <Modal title={t('stashSave.title')} onClose={() => { modalStore.closeStashSave(); }}>
    <div class="modal-form-group">
      <label class="modal-field-label" for="stash-save-input">{t('stashSave.message')}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="stash-save-input" class="modal-input" type="text" bind:value={stashSaveMessage} placeholder={t('stashSave.placeholder')} autofocus
        onkeydown={(e) => { if (e.key === 'Enter') { modalStore.closeStashSave(); vscode.postMessage({ type: 'stashSave', payload: { message: stashSaveMessage || undefined, includeUntracked: stashSaveIncludeUntracked, keepIndex: stashSaveKeepIndex } }); } }} />
    </div>
    <div class="modal-form-group">
      <label class="modal-checkbox">
        <input type="checkbox" bind:checked={stashSaveIncludeUntracked} />
        <span>{t('stash.includeUntracked')}</span>
        <span class="modal-flag-badge">--include-untracked</span>
      </label>
    </div>
    <div class="modal-form-group">
      <label class="modal-checkbox">
        <input type="checkbox" bind:checked={stashSaveKeepIndex} />
        <span>{t('stash.keepIndex')}</span>
        <span class="modal-flag-badge">--keep-index</span>
      </label>
    </div>
    <div class="form-actions">
      <button onclick={() => { modalStore.closeStashSave(); }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => { modalStore.closeStashSave(); vscode.postMessage({ type: 'stashSave', payload: { message: stashSaveMessage || undefined, includeUntracked: stashSaveIncludeUntracked, keepIndex: stashSaveKeepIndex } }); }}>{t('stash.stash')}</button>
    </div>
  </Modal>
{/if}

{#if modalStore.checkoutRemote.show}
  <CheckoutRemoteModal
    remoteName={modalStore.checkoutRemote.remoteName}
    defaultLocalName={modalStore.checkoutRemote.localName}
    dirty={modalStore.checkoutRemote.dirty}
    onClose={() => { modalStore.closeCheckoutRemote(); }}
    onCheckout={(localName, dirtyOption) => {
      const remote = modalStore.checkoutRemote.remoteName;
      const existingPayload = modalStore.checkoutRemote.dirtyPayload;
      const wasDirty = modalStore.checkoutRemote.dirty;
      modalStore.closeCheckoutRemote();
      const dp = Object.keys(existingPayload).length > 0 ? existingPayload
        : !wasDirty ? {}
        : dirtyOption === 'keep' ? { merge: true }
        : dirtyOption === 'stash' ? { stash: true, stashUntracked: true }
        : dirtyOption === 'discard' ? { force: true, clean: true }
        : {};
      vscode.postMessage({ type: 'createBranch', payload: { name: localName, startPoint: remote, checkout: true, ...dp } });
    }}
  />
{/if}

{#if modalStore.setUpstream.show}
  <SetUpstreamModal
    branchName={modalStore.setUpstream.branchName}
    currentUpstream={modalStore.setUpstream.currentUpstream}
    onClose={() => { modalStore.closeSetUpstream(); }}
    onSet={(remote, remoteBranch, createRemote) => { const branch = modalStore.setUpstream.branchName; modalStore.closeSetUpstream(); vscode.postMessage({ type: 'setUpstream', payload: { branch, remote, remoteBranch, createRemote } }); }}
  />
{/if}

{#if modalStore.pushTag.show}
  <Modal title={t('pushTag.title')} onClose={() => { modalStore.closePushTag(); }}>
    <p class="modal-desc">{t('pushTag.desc')}</p>
    <div class="modal-context-card">
      <span class="modal-pill modal-pill--tag"><i class="codicon codicon-tag"></i><span class="modal-pill-text">{modalStore.pushTag.tagName}</span></span>
      <i class="codicon codicon-arrow-right" style="color: var(--text-secondary);"></i>
      {#if branchStore.remotes.length > 1}
        <i class="codicon codicon-cloud" style="color: var(--text-secondary);"></i>
        <ColorSelect
          options={branchStore.remotes.map(r => ({ value: r.name, label: r.name, color: '' }))}
          value={modalStore.pushTag.remote}
          onChange={(v) => { modalStore.pushTag.remote = v; }}
          showDot={false}
        />
      {:else}
        <span class="modal-pill modal-pill--target"><i class="codicon codicon-cloud"></i><span class="modal-pill-text">{modalStore.pushTag.remote}</span></span>
      {/if}
    </div>
    <div class="form-actions">
      <button onclick={() => { modalStore.closePushTag(); }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => {
        vscode.postMessage({ type: 'pushTag', payload: { name: modalStore.pushTag.tagName, remote: modalStore.pushTag.remote } });
        modalStore.closePushTag();
      }}>{t('pushTag.push')}</button>
    </div>
  </Modal>
{/if}

{#if tagDetailsModal}
  <Modal title={t('graph.showTagDetails', { tag: tagDetailsModal.name })} onClose={() => { tagDetailsModal = null; }}>
    <div class="tag-details">
      <div class="tag-details-row">
        <span class="tag-details-label">{t('graph.tagLabel')}:</span>
        <span class="tag-details-value"><span class="modal-pill modal-pill--tag"><i class="codicon codicon-tag"></i><span class="modal-pill-text"> {tagDetailsModal.name}</span></span></span>
      </div>
      {#if tagDetailsModal.message}
        <div class="tag-details-row tag-details-message-row">
          <span class="tag-details-label">{t('createTag.message')}</span>
          <textarea class="tag-details-message" readonly rows="6">{tagDetailsModal.message}</textarea>
        </div>
      {/if}

    </div>
    <div class="form-actions">
      <button onclick={() => { tagDetailsModal = null; }}>{t('common.close')}</button>
    </div>
  </Modal>
{/if}

{#if showDeleteRemoteTagModal}
  <Modal title={t('deleteRemoteTag.title')} onClose={() => { showDeleteRemoteTagModal = false; }}>
    <p class="modal-desc">{@html t('deleteRemoteTag.confirm', { name: deleteRemoteTagName })}</p>
    <div class="form-actions">
      <button onclick={() => { showDeleteRemoteTagModal = false; }}>{t('common.cancel')}</button>
      <button class="danger-btn" onclick={() => { showDeleteRemoteTagModal = false; vscode.postMessage({ type: 'deleteRemoteTag', payload: { name: deleteRemoteTagName } }); }}>{t('sidebar.delete')}</button>
    </div>
  </Modal>
{/if}

{#if showAddWorktreeModal}
  <AddWorktreeModal
    defaultPath={addWorktreeDefaultPath}
    onClose={() => { showAddWorktreeModal = false; }}
    onAdd={(path, branch, newBranch) => { showAddWorktreeModal = false; vscode.postMessage({ type: 'worktreeAdd', payload: { path, branch, newBranch } }); }}
  />
{/if}

{#if modalStore.deleteRemoteBranch.show}
  <Modal title={t('deleteRemoteBranch.title')} onClose={() => { modalStore.closeDeleteRemoteBranch(); }}>
    <p class="modal-desc">{@html t('deleteRemoteBranch.confirm', { name: `${modalStore.deleteRemoteBranch.remote}/${modalStore.deleteRemoteBranch.name}` })}</p>
    <div class="form-actions">
      <button onclick={() => { modalStore.closeDeleteRemoteBranch(); }}>{t('common.cancel')}</button>
      <button class="danger-btn" onclick={() => { const { remote, name } = modalStore.deleteRemoteBranch; modalStore.closeDeleteRemoteBranch(); vscode.postMessage({ type: 'deleteRemoteBranch', payload: { remote, name } }); }}>{t('sidebar.delete')}</button>
    </div>
  </Modal>
{/if}

{#if modalStore.removeWorktree.show}
  <Modal title={t('worktree.removeTitle')} onClose={() => { modalStore.closeRemoveWorktree(); }}>
    <p class="modal-desc">{t('worktree.removeConfirm', { path: modalStore.removeWorktree.path })}</p>
    {#if modalStore.removeWorktree.branch}
      <div class="modal-form-group">
        <label class="modal-checkbox modal-checkbox--danger">
          <input type="checkbox" bind:checked={deleteWorktreeBranch} />
          <span>{t('worktree.deleteBranch', { name: modalStore.removeWorktree.branch })}</span>
        </label>
      </div>
    {/if}
    <div class="form-actions">
      <button onclick={() => { modalStore.closeRemoveWorktree(); }}>{t('common.cancel')}</button>
      <button class="danger-btn" onclick={() => { const { path, branch } = modalStore.removeWorktree; modalStore.closeRemoveWorktree(); vscode.postMessage({ type: 'worktreeRemove', payload: { path, deleteBranch: deleteWorktreeBranch ? branch : undefined } }); }}>{t('sidebar.delete')}</button>
    </div>
  </Modal>
{/if}

{#if modalStore.flowInit.show}
  <FlowInitModal
    onClose={() => { modalStore.closeFlowInit(); }}
    onInit={(options) => {
      modalStore.closeFlowInit();
      vscode.postMessage({ type: 'flowInit', payload: options });
    }}
  />
{/if}

{#if modalStore.flowStart.show && flowConfig}
  {@const flowType = modalStore.flowStart.flowType}
  {@const prefix = flowType === 'feature' ? flowConfig.featurePrefix : flowType === 'release' ? flowConfig.releasePrefix : flowConfig.hotfixPrefix}
  {@const baseBranch = flowType === 'hotfix' ? flowConfig.productionBranch : flowConfig.developBranch}
  <FlowStartModal
    {flowType}
    {prefix}
    {baseBranch}
    onClose={() => { modalStore.closeFlowStart(); }}
    onStart={(name) => {
      const ft = flowType;
      modalStore.closeFlowStart();
      vscode.postMessage({ type: 'flowAction', payload: { flowType: ft, action: 'start', name } });
    }}
  />
{/if}

{#if modalStore.fetch.show}
  <Modal title={t('fetch.title')} onClose={() => { modalStore.closeFetch(); }}>
    <p class="modal-desc">{t('fetch.desc')}</p>
    <div class="modal-form-group">
      <div class="modal-field-label">{t('fetch.remote')}</div>
      <ColorSelect
        options={branchStore.remotes.map(r => ({ value: r.name, label: r.name, color: '' }))}
        value={modalStore.fetch.remote}
        onChange={(v) => { modalStore.fetch.remote = v; }}
        showDot={false}
      />
    </div>
    <div class="modal-form-group">
      <label class="modal-checkbox">
        <input type="checkbox" bind:checked={modalStore.fetch.allRemotes} />
        <span>{t('fetch.allRemotes')}</span>
      </label>
    </div>
    <div class="form-actions">
      <button onclick={() => { modalStore.closeFetch(); }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => {
        const { allRemotes, remote } = modalStore.fetch;
        modalStore.closeFetch();
        uiStore.operating = 'fetch';
        vscode.postMessage({ type: 'fetch', payload: { remote: allRemotes ? undefined : remote, prune: true } });
      }}>{t('fetch.fetch')}</button>
    </div>
  </Modal>
{/if}

{#if modalStore.pull.show}
  <Modal title={t('pull.title')} onClose={() => { modalStore.closePull(); }}>
    <p class="modal-desc">{t('pull.desc')}</p>
    <div class="modal-context-card">
      <span class="modal-pill modal-pill--source"><i class="codicon codicon-cloud"></i><span class="modal-pill-text">{branchStore.currentBranch?.upstream ?? 'origin'}</span></span>
      <i class="codicon codicon-arrow-right" style="color: var(--text-secondary);"></i>
      <span class="modal-pill modal-pill--target"><i class="codicon codicon-git-branch"></i><span class="modal-pill-text">{branchStore.currentBranch?.name ?? 'current branch'}</span></span>
    </div>
    <div class="modal-form-group">
      <label class="modal-checkbox">
        <input type="checkbox" bind:checked={modalStore.pull.rebase} />
        <span>{t('pull.rebase')}</span>
        <span class="modal-flag-badge">--rebase</span>
      </label>
    </div>
    <div class="modal-form-group">
      <label class="modal-checkbox">
        <input type="checkbox" bind:checked={modalStore.pull.stash} />
        <span>{t('pull.stash')}</span>
        <span class="modal-flag-badge">--autostash</span>
      </label>
    </div>
    <div class="form-actions">
      <button onclick={() => { modalStore.closePull(); }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => {
        const { rebase, stash } = modalStore.pull;
        modalStore.closePull();
        uiStore.operating = 'pull';
        vscode.postMessage({ type: 'pull', payload: { rebase, stash } });
      }}>{t('pull.pull')}</button>
    </div>
  </Modal>
{/if}

{#if modalStore.push.show}
  {@const hasUpstream = !!branchStore.currentBranch?.upstream}
  {@const pushBranchName = branchStore.currentBranch?.name ?? 'branch'}
  {@const pushTarget = branchStore.currentBranch?.upstream ?? `${modalStore.push.remote}/${pushBranchName}`}
  <Modal title={t('push.title')} onClose={() => { modalStore.closePush(); }}>
    <p class="modal-desc">{t('push.desc')}</p>
    <div class="modal-context-card">
      <span class="modal-pill modal-pill--source"><i class="codicon codicon-git-branch"></i><span class="modal-pill-text">{pushBranchName}</span></span>
      <i class="codicon codicon-arrow-right" style="color: var(--text-secondary);"></i>
      {#if hasUpstream}
        <span class="modal-pill modal-pill--target"><i class="codicon codicon-cloud"></i><span class="modal-pill-text">{pushTarget}</span></span>
      {:else if branchStore.remotes.length > 1}
        <i class="codicon codicon-cloud" style="color: var(--text-secondary);"></i>
        <ColorSelect
          options={branchStore.remotes.map(r => ({ value: r.name, label: `new (${r.name}/${pushBranchName})`, color: '' }))}
          value={modalStore.push.remote}
          onChange={(v) => { modalStore.push.remote = v; }}
          showDot={false}
        />
      {:else}
        <span class="modal-pill modal-pill--target"><i class="codicon codicon-cloud"></i><span class="modal-pill-text">{t('push.new', { target: pushTarget })}</span></span>
      {/if}
    </div>
    {#if !hasUpstream}
      <div class="modal-form-group">
        <label class="modal-checkbox">
          <input type="checkbox" bind:checked={modalStore.push.setUpstream} />
          <span>{t('push.createTracking')}</span>
        </label>
      </div>
    {/if}
    <div class="modal-form-group">
      <label class="modal-checkbox">
        <input type="checkbox" bind:checked={modalStore.push.allTags} />
        <span>{t('push.pushAllTags')}</span>
      </label>
    </div>
    <div class="modal-form-group">
      <label class="modal-checkbox">
        <input type="checkbox"
          checked={modalStore.push.forceMode === 'with-lease'}
          onchange={() => { modalStore.push.forceMode = modalStore.push.forceMode === 'with-lease' ? 'none' : 'with-lease'; }} />
        <span>{t('push.forceWithLease')}</span>
        <span class="modal-flag-badge">--force-with-lease</span>
      </label>
    </div>
    <div class="modal-form-group">
      <label class="modal-checkbox modal-checkbox--danger">
        <input type="checkbox"
          checked={modalStore.push.forceMode === 'force'}
          onchange={() => { modalStore.push.forceMode = modalStore.push.forceMode === 'force' ? 'none' : 'force'; }} />
        <span>{t('push.force')}</span>
        <span class="modal-flag-badge">--force</span>
      </label>
    </div>
    {#if modalStore.push.forceMode === 'with-lease'}
      <p class="modal-warning" role="alert"><i class="codicon codicon-warning"></i><span>{@html t('push.forceWithLeaseWarning')}</span></p>
    {:else if modalStore.push.forceMode === 'force'}
      <p class="modal-warning" role="alert"><i class="codicon codicon-warning"></i><span>{@html t('push.forceWarning')}</span></p>
    {/if}
    <div class="form-actions">
      <button onclick={() => { modalStore.closePush(); }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => {
        const { forceMode, setUpstream, remote, allTags } = modalStore.push;
        const force = forceMode === 'none' ? undefined : forceMode;
        const remoteArg = hasUpstream ? undefined : remote;
        const branchArg = hasUpstream ? undefined : pushBranchName;
        modalStore.closePush();
        uiStore.operating = 'push';
        vscode.postMessage({ type: 'push', payload: { remote: remoteArg, branch: branchArg, force, setUpstream: !hasUpstream && setUpstream } });
        if (allTags) vscode.postMessage({ type: 'pushAllTags', payload: { remote } });
      }}>{t('push.push')}</button>
    </div>
  </Modal>
{/if}

{#if modalStore.flowFinish.show && flowConfig}
  <FlowFinishModal
    flowType={modalStore.flowFinish.flowType}
    branchName={modalStore.flowFinish.branchName}
    config={flowConfig}
    onClose={() => { modalStore.closeFlowFinish(); }}
    onFinish={() => {
      const ft = modalStore.flowFinish.flowType;
      const bn = modalStore.flowFinish.branchName;
      const prefix = ft === 'feature' ? flowConfig!.featurePrefix : ft === 'release' ? flowConfig!.releasePrefix : flowConfig!.hotfixPrefix;
      const name = bn.replace(prefix, '');
      modalStore.closeFlowFinish();
      vscode.postMessage({ type: 'flowAction', payload: { flowType: ft, action: 'finish', name } });
    }}
  />
{/if}

<style>

  .app-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
  }

  .app-container.resizing {
    cursor: ns-resize;
    user-select: none;
  }

  .tag-details {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px 12px;
    padding: 4px 0 8px;
    align-items: center;
  }

  .tag-details-row {
    display: contents;
  }

  .tag-details-message-row .tag-details-label {
    align-self: start;
    padding-top: 6px;
  }

  .tag-details-label {
    font-size: 13px;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .tag-details-value {
    display: flex;
    align-items: center;
    min-width: 0;
    font-size: 13px;
  }

  .tag-details-message {
    width: 100%;
    box-sizing: border-box;
    resize: none;
    background: var(--vscode-input-background, var(--bg-secondary));
    border: 1px solid var(--vscode-input-border, var(--border-color));
    border-radius: 3px;
    color: var(--text-primary);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 13px;
    padding: 6px 8px;
    line-height: 1.5;
    outline: none;
  }

  .error-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px;
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    border-bottom: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
    font-size: 12px;
    gap: 12px;
  }

  .error-text {
    flex: 1;
    min-width: 0;
  }

  .error-dismiss {
    flex-shrink: 0;
    font-size: 11px;
    padding: 2px 8px;
  }

  /* ---- Conflict banner ---- */
  .conflict-banner {
    background: rgba(240, 160, 32, 0.06);
    border-bottom: 1px solid rgba(240, 160, 32, 0.25);
    font-size: 12px;
  }

  .conflict-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
  }

  .conflict-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .conflict-icon {
    color: #f0a020;
    font-size: 14px;
  }

  .conflict-title {
    color: var(--text-primary);
    font-size: 13px;
  }

  .conflict-title strong {
    text-transform: capitalize;
  }

  .conflict-count {
    color: var(--text-secondary);
    font-size: 12px;
    background: rgba(240, 160, 32, 0.15);
    padding: 1px 6px;
    border-radius: 8px;
    color: #f0a020;
  }

  .conflict-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .conflict-btn {
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .conflict-btn--abort {
    background: transparent;
    color: #f44336;
    border: 1px solid rgba(244, 67, 54, 0.3);
  }

  .conflict-btn--abort:hover {
    background: rgba(244, 67, 54, 0.1);
  }

  .conflict-btn--continue {
    background: var(--vscode-button-background, #0078d4);
    color: var(--vscode-button-foreground, #fff);
    border: none;
  }

  .conflict-btn--continue:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .conflict-files {
    display: flex;
    flex-direction: column;
    padding: 0 14px 8px;
    gap: 1px;
    max-height: 220px;
    overflow-y: auto;
  }

  .conflict-file {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    flex: 1;
    min-width: 0;
    text-align: left;
  }

  .conflict-file:hover {
    background: rgba(240, 160, 32, 0.08);
  }

  .conflict-file-status {
    font-size: 10px;
    font-weight: 700;
    color: #f0a020;
    background: rgba(240, 160, 32, 0.15);
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .conflict-file-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .conflict-file-row.resolved {
    opacity: 0.6;
  }

  .conflict-stage-hint {
    display: inline-flex;
    opacity: 0;
    padding: 1px 4px;
    border-radius: 3px;
    color: #4caf50;
    cursor: pointer;
    flex-shrink: 0;
    font-size: 12px;
  }

  .conflict-file:hover .conflict-stage-hint {
    opacity: 1;
  }

  .conflict-stage-hint:hover {
    background: rgba(76, 175, 80, 0.2);
  }

  .resolved-icon {
    color: #4caf50;
    background: rgba(76, 175, 80, 0.15);
  }

  .conflict-file-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conflict-file-dir {
    color: var(--text-secondary);
  }

  .conflict-open-icon {
    opacity: 0;
    font-size: 14px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .conflict-file:hover .conflict-open-icon {
    opacity: 1;
  }

  .content-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .graph-area {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .log-container, .stats-container {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .resize-handle-h {
    height: 12px;
    cursor: ns-resize;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  .resize-handle-line {
    width: 80px;
    height: 4px;
    border-radius: 2px;
    background: var(--border-color);
    transition: background 0.15s, width 0.15s;
  }

  .resize-handle-h:hover .resize-handle-line {
    background: var(--vscode-focusBorder, #007fd4);
    width: 120px;
  }

  /* ---- Light theme overrides ---- */
  :global(body.vscode-light) .conflict-icon {
    color: #9a6700;
  }

  :global(body.vscode-light) .conflict-count {
    color: #9a6700;
    background: rgba(200, 120, 0, 0.12);
  }

  :global(body.vscode-light) .conflict-btn--abort {
    color: #b71c1c;
    border-color: rgba(183, 28, 28, 0.3);
  }

  :global(body.vscode-light) .conflict-btn--abort:hover {
    background: rgba(183, 28, 28, 0.06);
  }

  :global(body.vscode-light) .conflict-file-status {
    color: #9a6700;
    background: rgba(200, 120, 0, 0.12);
  }

  :global(body.vscode-light) .conflict-stage-hint {
    color: #2e7d32;
  }

  :global(body.vscode-light) .resolved-icon {
    color: #2e7d32;
    background: rgba(46, 125, 50, 0.12);
  }

  .bottom-area {
    overflow: hidden;
    flex-shrink: 0;
    border-top: 1px solid var(--border-color);
  }
</style>
