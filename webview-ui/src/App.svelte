<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from './lib/vscode-api';
  import { commitStore } from './lib/stores/commits.svelte';
  import { branchStore } from './lib/stores/branches.svelte';
  import { uiStore } from './lib/stores/ui.svelte';
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
  let stashSaveMessage = $state('');
  let stashSaveIncludeUntracked = $state(true);
  let stashSaveKeepIndex = $state(false);
  let deleteWorktreeBranch = $state(false);
  onMount(() => {
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
            uiStore.setSuccess(t('copiedToClipboard'));
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
          }
          break;
      }
    }

    window.addEventListener('message', handleMessage);

    // Request initial data
    commitStore.setLoading(true);
    vscode.postMessage({ type: 'getLog', payload: { limit: 1000 } });
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
      vscode.postMessage({ type: 'getLog', payload: { limit: 1000 } });
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

  // Draggable resize handle
  function startResize(e: MouseEvent) {
    e.preventDefault();
    resizing = true;
    const startY = e.clientY;
    const startHeight = uiStore.bottomPanelHeight;

    function onMouseMove(e: MouseEvent) {
      const delta = startY - e.clientY;
      uiStore.bottomPanelHeight = Math.max(100, Math.min(window.innerHeight * 0.7, startHeight + delta));
    }

    function onMouseUp() {
      resizing = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }
</script>

<div class="app-container" class:resizing>
  <Toolbar />

  {#if conflict}
    <div class="conflict-banner">
      <div class="conflict-header">
        <div class="conflict-info">
          <i class="codicon codicon-warning conflict-icon"></i>
          <span class="conflict-title">
            <strong>{conflict.operation}</strong> conflict
          </span>
          <span class="conflict-count">{conflict.files.filter(f => f.resolved).length}/{conflict.files.length} resolved</span>
        </div>
        <div class="conflict-actions">
          <button class="conflict-btn conflict-btn--abort" onclick={() => { showAbortConfirmModal = true; }}>
            <i class="codicon codicon-discard"></i> Abort
          </button>
          <button class="conflict-btn conflict-btn--continue" disabled={conflict.files.some(f => !f.resolved)} onclick={() => { const op = conflict?.operation ?? 'merge'; vscode.postMessage({ type: 'continueOperation' }); conflict = null; uiStore.setSuccess(t('conflict.resolveSuccess', { operation: op })); }}>
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
              <i class="codicon codicon-go-to-file conflict-open-icon"></i>
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

  {#if uiStore.successMessage}
    <div class="success-bar">
      <i class="codicon codicon-check"></i>
      <span class="success-text">{uiStore.successMessage}</span>
      <button class="success-dismiss" onclick={() => uiStore.setSuccess(null)} title="Dismiss"><i class="codicon codicon-close"></i></button>
    </div>
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
        <SearchBar onResults={handleSearchResults} onNavigate={handleSearchNavigate} />
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
        <CommitGraph {searchMatchedHashes} {searchNavigateHash} bisectActive={bisectMessage !== null} bisectCulpritHash={bisectMessage?.includes('is the first bad commit') ? bisectMessage.match(/^([a-f0-9]{7,40})/)?.[1] ?? null : null} />
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
      <i class="codicon codicon-archive" style="color: var(--text-secondary);"></i>
      <span class="modal-pill modal-pill--source">{modalStore.stashApply.message || `stash@{${modalStore.stashApply.index}}`}</span>
      <i class="codicon codicon-arrow-right" style="color: var(--text-secondary);"></i>
      <i class="codicon codicon-git-branch"></i>
      <span class="modal-pill modal-pill--target">{branchStore.currentBranch?.name ?? 'current branch'}</span>
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
      <i class="codicon codicon-git-branch"></i>
      <span class="modal-pill modal-pill--source">{modalStore.renameBranch.oldName}</span>
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
      </label>
    </div>
    <div class="modal-form-group">
      <label class="modal-checkbox">
        <input type="checkbox" bind:checked={stashSaveKeepIndex} />
        <span>{t('stash.keepIndex')}</span>
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
      modalStore.closeCheckoutRemote();
      const dp = Object.keys(existingPayload).length > 0 ? existingPayload
        : dirtyOption === 'stash' ? { stash: true }
        : dirtyOption === 'stashAll' ? { stash: true, stashUntracked: true }
        : dirtyOption === 'discard' ? { force: true, clean: true }
        : {};
      vscode.postMessage({ type: 'createBranch', payload: { name: localName, startPoint: remote, checkout: true, ...dp } });
    }}
  />
{/if}

{#if modalStore.setUpstream.show}
  <SetUpstreamModal
    branchName={modalStore.setUpstream.branchName}
    onClose={() => { modalStore.closeSetUpstream(); }}
    onSet={(remote, remoteBranch) => { const branch = modalStore.setUpstream.branchName; modalStore.closeSetUpstream(); vscode.postMessage({ type: 'setUpstream', payload: { branch, remote, remoteBranch } }); }}
  />
{/if}

{#if showDeleteRemoteTagModal}
  <Modal title={t('deleteRemoteTag.title')} onClose={() => { showDeleteRemoteTagModal = false; }}>
    <p class="modal-desc">{@html t('deleteRemoteTag.confirm', { name: `<span class="modal-pill modal-pill--danger">${deleteRemoteTagName}</span>` })}</p>
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
    <p class="modal-desc">{@html t('deleteRemoteBranch.confirm', { name: `<span class="modal-pill modal-pill--danger">${modalStore.deleteRemoteBranch.remote}/${modalStore.deleteRemoteBranch.name}</span>` })}</p>
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

  .success-bar {
    display: flex;
    align-items: center;
    padding: 6px 14px;
    background: rgba(76, 175, 80, 0.1);
    border-bottom: 1px solid rgba(76, 175, 80, 0.3);
    font-size: 12px;
    color: #4caf50;
    gap: 8px;
  }

  .success-text {
    flex: 1;
  }

  .success-dismiss {
    background: transparent;
    border: none;
    color: #4caf50;
    cursor: pointer;
    padding: 2px 4px;
    opacity: 0.7;
  }

  .success-dismiss:hover {
    opacity: 1;
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
    font-size: 12px;
  }

  .conflict-title strong {
    text-transform: capitalize;
  }

  .conflict-count {
    color: var(--text-secondary);
    font-size: 11px;
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
    max-height: 150px;
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
    font-size: 12px;
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
    display: none;
    padding: 1px 4px;
    border-radius: 3px;
    color: #4caf50;
    cursor: pointer;
    flex-shrink: 0;
    font-size: 12px;
  }

  .conflict-file:hover .conflict-stage-hint {
    display: inline-flex;
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
    font-size: 11px;
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
  :global(body.vscode-light) .success-bar {
    background: rgba(46, 125, 50, 0.06);
    border-bottom-color: rgba(46, 125, 50, 0.2);
    color: #2e7d32;
  }

  :global(body.vscode-light) .success-dismiss {
    color: #2e7d32;
  }

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
