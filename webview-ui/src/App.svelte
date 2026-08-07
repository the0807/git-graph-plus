<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import { getVsCodeApi } from './lib/vscode-api';
  import { commitStore } from './lib/stores/commits.svelte';
  import { branchStore } from './lib/stores/branches.svelte';
  import { uiStore, BOTTOM_PANEL_DEFAULT_RATIO, BOTTOM_PANEL_MIN_RATIO, BOTTOM_PANEL_MAX_RATIO } from './lib/stores/ui.svelte';
  import { i18n, t } from './lib/i18n/index.svelte';
  import CommitGraph from './components/graph/CommitGraph.svelte';
  import BottomPanel from './components/layout/BottomPanel.svelte';
  import Toolbar from './components/layout/Toolbar.svelte';
  import SearchBar from './components/common/SearchBar.svelte';
  import Reflog from './components/common/Reflog.svelte';
  import StatsView from './components/common/StatsView.svelte';
  import DeleteBranchModal from './components/modals/DeleteBranchModal.svelte';
  import DeleteTagModal from './components/modals/DeleteTagModal.svelte';
  import CreateBranchModal from './components/modals/CreateBranchModal.svelte';
  import CreateTagModal from './components/modals/CreateTagModal.svelte';
  import MergeBranchModal from './components/modals/MergeBranchModal.svelte';
  import CheckoutRemoteModal from './components/modals/CheckoutRemoteModal.svelte';
  import AddWorktreeModal from './components/modals/AddWorktreeModal.svelte';
  import AbortConfirmModal from './components/modals/AbortConfirmModal.svelte';
  import StashDropModal from './components/modals/StashDropModal.svelte';
  import StashApplyModal from './components/modals/StashApplyModal.svelte';
  import StashRestoreModal from './components/modals/StashRestoreModal.svelte';
  import StashRenameModal from './components/modals/StashRenameModal.svelte';
  import StashSaveModal from './components/modals/StashSaveModal.svelte';
import AmendModal from './components/modals/AmendModal.svelte';
  import RenameBranchModal from './components/modals/RenameBranchModal.svelte';
  import DeleteRemoteBranchModal from './components/modals/DeleteRemoteBranchModal.svelte';
  import DeleteRemoteTagModal from './components/modals/DeleteRemoteTagModal.svelte';
  import RemoveWorktreeModal from './components/modals/RemoveWorktreeModal.svelte';
  import PushTagModal from './components/modals/PushTagModal.svelte';
  import TagDetailsModal from './components/modals/TagDetailsModal.svelte';
  import FetchModal from './components/modals/FetchModal.svelte';
  import PullModal from './components/modals/PullModal.svelte';
  import PushModal from './components/modals/PushModal.svelte';
  import { modalStore } from './lib/stores/modals.svelte';
  import { defaultsStore } from './lib/stores/defaults.svelte';
  import { graphColorsStore } from './lib/stores/graph-colors.svelte';
  import { commitLinkRulesStore } from './lib/stores/commit-link-rules.svelte';
  import { avatarStore } from './lib/stores/avatars.svelte';
  import SetUpstreamModal from './components/modals/SetUpstreamModal.svelte';
  import FlowInitModal from './components/modals/FlowInitModal.svelte';
  import FlowStartModal from './components/modals/FlowStartModal.svelte';
  import FlowFinishModal from './components/modals/FlowFinishModal.svelte';
  import BisectBanner from './components/common/BisectBanner.svelte';
  import type { FlowConfig } from './lib/types';
  import { tooltip } from './lib/actions/tooltip';
  import DirtyActionModal from './components/modals/DirtyActionModal.svelte';
  import { dragRebaseMessage, dragMergeMessage } from './lib/utils/dragDrop';

  const vscode = getVsCodeApi();

  let flowConfig = $state<FlowConfig | null>(null);
  let bisectMessage = $state<string | null>(null);
  let searchMatchedHashes = $state<Set<string> | null>(null);
  let searchNavigateHash = $state<string | null>(null);
  let headOffscreen = $state(false);
  let headJumpNonce = $state(0);
  let remoteFilter = $state<string[]>([]);
  let branchFilter = $state<string[]>([]);
  let resizing = $state(false);
  let conflict = $state<{ operation: string; files: Array<{ path: string; resolved: boolean }> } | null>(null);
  let rebasePaused = $state(false);
  let showAbortConfirmModal = $state(false);

  // Non-shared modals (unique to Activity Bar)
  let showStashDropModal = $state(false);
  let stashDropIndex = $state(0);
  let stashDropMessage = $state('');
  let showDeleteRemoteTagModal = $state(false);
  let deleteRemoteTagName = $state('');
  let showAddWorktreeModal = $state(false);
  let addWorktreeDefaultPath = $state('');
  let addWorktreeStartPoint = $state<string | undefined>(undefined);
  let tagDetails = $state<{ name: string; hash: string; message?: string; isAnnotated: boolean } | null>(null);

  // Expose the branch-badge bar thickness globally so every badge surface
  // (graph, commit details, modal pills) scales with the setting consistently.
  $effect(() => {
    document.documentElement.style.setProperty('--badge-bar-width', `${uiStore.badgeBarWidth}px`);
  });

  onMount(() => {
    uiStore.bottomPanelHeight = Math.round(window.innerHeight * BOTTOM_PANEL_DEFAULT_RATIO);

    function handleMessage(event: MessageEvent) {
      const msg = event.data;
      switch (msg.type) {
        case 'logData':
          if (msg.payload.remoteFilter !== undefined) remoteFilter = msg.payload.remoteFilter;
          if (msg.payload.branches !== undefined) branchFilter = msg.payload.branches;
          commitStore.setData(msg.payload);
          break;
        case 'branchData':
          branchStore.setData(msg.payload);
          break;
        case 'fullRefresh':
          remoteFilter = msg.payload.logData.remoteFilter ?? [];
          branchFilter = msg.payload.logData.branches ?? [];
          branchStore.setData(msg.payload.branchData);
          commitStore.setData(msg.payload.logData);
          break;
        case 'setLocale':
          i18n.setLocale(msg.payload.locale);
          if (msg.payload.homeDir) uiStore.homeDir = msg.payload.homeDir;
          break;
        case 'setDefaults':
          defaultsStore.set(msg.payload);
          break;
        case 'setBadgeBarThickness':
          uiStore.badgeBarWidth = msg.payload.width;
          break;
        case 'setLoadMoreCount':
          uiStore.loadMoreCount = msg.payload.count;
          break;
        case 'setInteractiveRebaseMode':
          uiStore.interactiveRebaseMode = msg.payload.mode;
          break;
        case 'setGraphColors':
          graphColorsStore.set(msg.payload.colors);
          break;
        case 'setCommitLinkRules':
          commitLinkRulesStore.set(msg.payload.rules);
          break;
        case 'avatarData':
          avatarStore.receive(
            msg.payload.email,
            msg.payload.size,
            msg.payload.dataUri,
            msg.payload.generation,
          );
          break;
        case 'resetAvatars':
          avatarStore.reset();
          break;
        case 'repoList':
          uiStore.repos = msg.payload.repos;
          uiStore.activeRepo = msg.payload.active;
          commitStore.notGitRepo = false;
          break;
        case 'tagDetailsData':
          tagDetails = msg.payload;
          break;
        case 'conflictData':
          conflict = msg.payload;
          break;
        case 'notGitRepo':
          commitStore.notGitRepo = true;
          commitStore.setLoading(false);
          break;
        case 'error':
          uiStore.setError(msg.payload.message);
          commitStore.setLoading(false);
          // Close only the modal that originated the failing operation. An
          // unrelated background failure (e.g. a getStats refresh) used to
          // close any in-progress modal — including one the user was
          // composing form data into — which silently destroyed their input.
          modalStore.closeForSource(msg.payload.source);
          break;
        case 'flowStatus':
          flowConfig = msg.payload.config;
          break;
        case 'bisectResult':
          bisectMessage = msg.payload.message;
          break;
        case 'operationPaused':
          if (msg.payload.operation === 'rebase') rebasePaused = true;
          break;
        case 'operationComplete':
          if (msg.payload.operation === 'bisectReset') {
            bisectMessage = null;
          }
          if (msg.payload.operation === 'copied') {
            vscode.postMessage({ type: 'showNotification', payload: { message: t('copiedToClipboard') } });
          }
          rebasePaused = false;
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
            modalStore.openRenameBranch(msg.payload.branchName);
          } else if (msg.payload.modal === 'mergeBranch') {
            modalStore.openMerge(msg.payload.branchName, branchStore.currentBranch?.name ?? 'HEAD');
          } else if (msg.payload.modal === 'createBranch') {
            modalStore.openCreateBranch('HEAD');
          } else if (msg.payload.modal === 'createTag') {
            modalStore.openCreateTag('HEAD');
          } else if (msg.payload.modal === 'stashSave') {
            modalStore.openStashSave();
          } else if (msg.payload.modal === 'checkoutRemote') {
            modalStore.openCheckoutRemote(msg.payload.remoteName, msg.payload.localName);
          } else if (msg.payload.modal === 'deleteRemoteTag') {
            deleteRemoteTagName = msg.payload.tagName;
            showDeleteRemoteTagModal = true;
          } else if (msg.payload.modal === 'deleteRemoteBranch') {
            modalStore.openDeleteRemoteBranch(msg.payload.remote, msg.payload.name);
          } else if (msg.payload.modal === 'removeWorktree') {
            modalStore.openRemoveWorktree(msg.payload.path, msg.payload.branch);
          } else if (msg.payload.modal === 'addWorktree') {
            addWorktreeDefaultPath = msg.payload.defaultPath;
            addWorktreeStartPoint = msg.payload.startPoint;
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
      commitStore.setLoading(true);
      vscode.postMessage({ type: 'getLog', payload: {
        limit: commitStore.currentLimit || undefined,
        branches: branchFilter.length > 0 ? [...branchFilter] : undefined,
        remoteFilter: remoteFilter.length > 0 ? [...remoteFilter] : undefined,
      }});
      vscode.postMessage({ type: 'getBranches' });
    }

    // A file selected in the commit-details panel takes the first Esc: deselect
    // it and leave the panel open. The next Esc (no file selected) closes it.
    if (e.key === 'Escape' && !modalStore.anyOpen && !uiStore.multiSelectArmed && uiStore.showBottomPanel && uiStore.commitFileSelected) {
      e.preventDefault();
      uiStore.requestClearCommitFileSelection();
      return;
    }

    // Multi-select Esc is handled in CommitGraph (1st Esc closes the panel, 2nd clears the selection).
    if (e.key === 'Escape' && !modalStore.anyOpen && !uiStore.multiSelectArmed && uiStore.showBottomPanel && (uiStore.selectedCommitHash || uiStore.comparing)) {
      e.preventDefault();
      if (uiStore.commitDetailFullscreen) {
        uiStore.commitDetailFullscreen = false;
      } else {
        // selectCommit(null) clears the whole selection (incl. selectedCommitHashes
        // and compare state) so the row highlight is fully removed.
        uiStore.selectCommit(null);
        uiStore.showBottomPanel = false;
      }
    }
  }

  function handleSearchResults(hashes: Set<string> | null) {
    searchMatchedHashes = hashes;
    searchNavigateHash = null;
  }

  function handleSearchNavigate(hash: string) {
    searchNavigateHash = hash;
  }

  function handleJumpToHead() {
    headJumpNonce++;
  }

  function handleFilterChange(filter: string[]) {
    remoteFilter = filter;
    if (filter.length > 0) {
      branchFilter = branchFilter.filter(name => {
        const b = branchStore.branches.find(b => b.name === name);
        if (!b) return false;
        return b.remote ? filter.includes(b.remote) : filter.includes('local');
      });
    }
    commitStore.setLoading(true);
    vscode.postMessage({
      type: 'getLog',
      payload: {
        limit: commitStore.currentLimit || undefined,
        branches: branchFilter.length > 0 ? [...branchFilter] : undefined,
        remoteFilter: filter.length > 0 ? [...filter] : undefined,
      },
    });
  }

  function handleBranchFilterChange(branches: string[]) {
    branchFilter = branches;
    commitStore.setLoading(true);
    vscode.postMessage({
      type: 'getLog',
      payload: {
        limit: commitStore.currentLimit || undefined,
        branches: branches.length > 0 ? [...branches] : undefined,
        remoteFilter: remoteFilter.length > 0 ? [...remoteFilter] : undefined,
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
  <Toolbar onRefresh={() => {
    commitStore.setLoading(true);
    vscode.postMessage({ type: 'getLog', payload: {
      limit: commitStore.currentLimit || undefined,
      branches: branchFilter.length > 0 ? [...branchFilter] : undefined,
      remoteFilter: remoteFilter.length > 0 ? [...remoteFilter] : undefined,
    }});
    vscode.postMessage({ type: 'getBranches' });
    vscode.postMessage({ type: 'getRepoList' });
  }} />

  {#if conflict}
    <div class="conflict-banner banner-card" transition:slide={{ duration: 150 }}>
      <div class="conflict-header">
        <div class="conflict-info">
          <i class="codicon codicon-warning conflict-icon"></i>
          <span class="conflict-title">
            <strong>{t('conflict.banner.title', { operation: t(`conflict.op.${conflict.operation}`) })}</strong>
          </span>
          <span class="conflict-count">{t('conflict.banner.resolved', { resolved: conflict.files.filter(f => f.resolved).length, total: conflict.files.length })}</span>
        </div>
        <div class="conflict-actions">
          <button class="banner-btn danger" onclick={() => { showAbortConfirmModal = true; }}>
            <i class="codicon codicon-discard"></i> {t('conflict.abort')}
          </button>
          <button class="banner-btn success" disabled={conflict.files.some(f => !f.resolved)} onclick={() => { const op = conflict?.operation ?? 'merge'; vscode.postMessage({ type: 'continueOperation' }); conflict = null; vscode.postMessage({ type: 'showNotification', payload: { message: t('conflict.resolveSuccess', { operation: t(`conflict.op.${op}`) }) } }); }}>
            <i class="codicon codicon-check"></i> {t('conflict.banner.resolve')}
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
                <i class="codicon codicon-warning conflict-file-status unresolved-icon"></i>
              {/if}
              <span class="conflict-file-path">
                {#if file.path.includes('/')}
                  <span class="conflict-file-dir">{file.path.substring(0, file.path.lastIndexOf('/') + 1)}</span>{file.path.substring(file.path.lastIndexOf('/') + 1)}
                {:else}
                  {file.path}
                {/if}
              </span>
              {#if !file.resolved}
                <span class="conflict-stage-hint" onclick={(e) => { e.stopPropagation(); vscode.postMessage({ type: 'stageFile', payload: { file: file.path } }); }} role="button" tabindex={0} onkeydown={(e) => { if (e.key === 'Enter') vscode.postMessage({ type: 'stageFile', payload: { file: file.path } }); }} use:tooltip={t('conflict.markResolved')}>
                  <i class="codicon codicon-check"></i>
                </span>
              {/if}
              <i class="codicon codicon-go-to-file conflict-open-icon" use:tooltip={t('conflict.openFile')}></i>
            </button>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if rebasePaused && !conflict}
    <div class="rebase-pause-banner banner-card" transition:slide={{ duration: 150 }}>
      <i class="codicon codicon-debug-pause"></i>
      <span>{t('rebase.pause.message')}</span>
      <div class="rebase-pause-actions">
        <button class="banner-btn" onclick={() => {
          vscode.postMessage({ type: 'continueOperation' });
          rebasePaused = false;
        }}>{t('rebase.pause.continue')}</button>
        <button class="banner-btn danger" onclick={() => {
          vscode.postMessage({ type: 'abortOperation' });
          rebasePaused = false;
        }}>{t('rebase.pause.abort')}</button>
      </div>
    </div>
  {/if}

  {#if showAbortConfirmModal}
    <AbortConfirmModal
      operation={conflict?.operation ?? 'merge'}
      onClose={() => { showAbortConfirmModal = false; }}
      onConfirm={() => { showAbortConfirmModal = false; vscode.postMessage({ type: 'abortOperation' }); conflict = null; }}
    />
  {/if}

  {#if uiStore.errorMessage}
    <div class="error-bar banner-card" transition:slide={{ duration: 150 }}>
      <i class="codicon codicon-error error-icon"></i>
      <span class="error-text">{uiStore.errorMessage ?? ''}</span>
      <button class="error-dismiss" onclick={() => uiStore.setError(null)} title={t('common.dismiss')}>
        <i class="codicon codicon-close"></i>
      </button>
    </div>
  {/if}

  <div class="content-area">
    {#if uiStore.viewMode === 'graph'}
      {#if !bisectMessage && !conflict && !rebasePaused}
        <SearchBar
          onResults={handleSearchResults}
          onNavigate={handleSearchNavigate}
          remotes={branchStore.remotes.map(r => r.name)}
          {remoteFilter}
          onFilterChange={handleFilterChange}
          branches={branchStore.branches}
          {branchFilter}
          onBranchFilterChange={handleBranchFilterChange}
          {headOffscreen}
          onJumpToHead={handleJumpToHead}
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
      {#if !uiStore.commitDetailFullscreen}
        <div class="graph-area">
          <CommitGraph {searchMatchedHashes} {searchNavigateHash} headJumpNonce={headJumpNonce} onHeadOffscreenChange={(v) => headOffscreen = v} bisectActive={bisectMessage !== null} bisectCulpritHash={bisectMessage?.includes('is the first bad commit') ? bisectMessage.match(/^([a-f0-9]{7,40})/)?.[1] ?? null : null} {remoteFilter} />
        </div>
      {/if}
      {#if uiStore.showBottomPanel && (uiStore.selectedCommitHash || uiStore.comparing)}
        {#if !uiStore.commitDetailFullscreen}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="resize-handle-h"
            role="separator"
            onmousedown={startResize}
          >
            <div class="resize-handle-line"></div>
          </div>
        {/if}
        <div class="bottom-area" class:fullscreen={uiStore.commitDetailFullscreen} style={uiStore.commitDetailFullscreen ? '' : `height: ${uiStore.bottomPanelHeight}px;`}>
          <BottomPanel />
        </div>
      {/if}
    {:else if uiStore.viewMode === 'log'}
      <div class="log-container">
        <Reflog active={uiStore.viewMode === 'log'} />
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
  <StashDropModal
    message={stashDropMessage}
    onClose={() => { showStashDropModal = false; }}
    onDrop={() => { showStashDropModal = false; vscode.postMessage({ type: 'stashDrop', payload: { index: stashDropIndex } }); }}
  />
{/if}

{#if modalStore.stashApply.show}
  <StashApplyModal
    index={modalStore.stashApply.index}
    message={modalStore.stashApply.message}
    drop={modalStore.stashApply.drop}
    targetBranch={branchStore.currentBranch?.name ?? 'current branch'}
    onClose={() => { modalStore.closeStashApply(); }}
    onApply={() => { const { index, drop } = modalStore.stashApply; modalStore.closeStashApply(); vscode.postMessage({ type: 'stashApply', payload: { index, drop } }); }}
  />
{/if}

{#if modalStore.stashRestore.show}
  <StashRestoreModal
    index={modalStore.stashRestore.index}
    message={modalStore.stashRestore.message}
    paths={modalStore.stashRestore.paths}
    onClose={() => { modalStore.closeStashRestore(); }}
    onRestore={() => { const { index, paths } = modalStore.stashRestore; const plainPaths = [...paths]; modalStore.closeStashRestore(); vscode.postMessage({ type: 'restoreStashFiles', payload: { index, paths: plainPaths } }); }}
  />
{/if}

{#if modalStore.renameBranch.show}
  <RenameBranchModal
    oldName={modalStore.renameBranch.oldName}
    onClose={() => { modalStore.closeRenameBranch(); }}
    onRename={(newName) => { const oldName = modalStore.renameBranch.oldName; modalStore.closeRenameBranch(); vscode.postMessage({ type: 'renameBranch', payload: { oldName, newName } }); }}
  />
{/if}

{#if modalStore.stashRename.show}
  <StashRenameModal
    index={modalStore.stashRename.index}
    initialMessage={modalStore.stashRename.message}
    onClose={() => { modalStore.closeStashRename(); }}
    onRename={(message) => { const index = modalStore.stashRename.index; modalStore.closeStashRename(); vscode.postMessage({ type: 'stashRename', payload: { index, message } }); }}
  />
{/if}

{#if modalStore.merge.show}
  <MergeBranchModal
    source={modalStore.merge.source}
    target={modalStore.merge.target}
    canDeleteSource={branchStore.localBranches.some(b => b.name === modalStore.merge.source) && modalStore.merge.source !== branchStore.currentBranch?.name}
    onClose={() => { modalStore.closeMerge(); }}
    onMerge={(options) => { const branch = modalStore.merge.source; modalStore.closeMerge(); vscode.postMessage({ type: 'merge', payload: { branch, ...options } }); }}
  />
{/if}

{#if modalStore.createBranch.show}
  <CreateBranchModal
    startPoint={modalStore.createBranch.startPoint}
    subject={modalStore.createBranch.subject}
    onClose={() => { modalStore.closeCreateBranch(); }}
    onCreate={(name, startPoint, checkout, publish) => { modalStore.closeCreateBranch(); vscode.postMessage({ type: 'createBranch', payload: { name, startPoint, checkout, publish } }); }}
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
  <StashSaveModal
    onClose={() => { modalStore.closeStashSave(); }}
    onSave={(message, includeUntracked, keepIndex) => { modalStore.closeStashSave(); vscode.postMessage({ type: 'stashSave', payload: { message: message || undefined, includeUntracked, keepIndex } }); }}
  />
{/if}

{#if modalStore.amend.show}
  <AmendModal
    hash={modalStore.amend.hash}
    subject={modalStore.amend.subject}
    message={modalStore.amend.message}
    isPushed={modalStore.amend.isPushed}
    onClose={() => { modalStore.closeAmend(); }}
    onAmend={(opts) => { modalStore.closeAmend(); vscode.postMessage({ type: 'amendCommit', payload: opts }); }}
  />
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
  <PushTagModal
    tagName={modalStore.pushTag.tagName}
    remotes={branchStore.remotes}
    initialRemote={modalStore.pushTag.remote}
    onClose={() => { modalStore.closePushTag(); }}
    onPush={(remote) => { const name = modalStore.pushTag.tagName; modalStore.closePushTag(); vscode.postMessage({ type: 'pushTag', payload: { name, remote } }); }}
  />
{/if}

{#if tagDetails}
  <TagDetailsModal
    name={tagDetails.name}
    message={tagDetails.message}
    onClose={() => { tagDetails = null; }}
  />
{/if}

{#if showDeleteRemoteTagModal}
  <DeleteRemoteTagModal
    tagName={deleteRemoteTagName}
    onClose={() => { showDeleteRemoteTagModal = false; }}
    onDelete={() => { showDeleteRemoteTagModal = false; vscode.postMessage({ type: 'deleteRemoteTag', payload: { name: deleteRemoteTagName } }); }}
  />
{/if}

{#if showAddWorktreeModal}
  <AddWorktreeModal
    defaultPath={addWorktreeDefaultPath}
    startPoint={addWorktreeStartPoint}
    onClose={() => { showAddWorktreeModal = false; }}
    onAdd={(path, branch, newBranch) => { showAddWorktreeModal = false; vscode.postMessage({ type: 'worktreeAdd', payload: { path, branch, newBranch } }); }}
  />
{/if}

{#if modalStore.dragAction}
  <DirtyActionModal
    title={t('dirtyAction.title')}
    confirmLabel={t('dirtyAction.continue')}
    onConfirm={(dirty) => {
      const d = modalStore.dragAction!;
      modalStore.closeDragAction();
      vscode.postMessage(d.op === 'rebase'
        ? dragRebaseMessage(d.source, d.target, dirty)
        : dragMergeMessage(d.source, d.target, dirty));
    }}
    onClose={() => { modalStore.closeDragAction(); }}
  />
{/if}

{#if modalStore.deleteRemoteBranch.show}
  <DeleteRemoteBranchModal
    remote={modalStore.deleteRemoteBranch.remote}
    branchName={modalStore.deleteRemoteBranch.name}
    onClose={() => { modalStore.closeDeleteRemoteBranch(); }}
    onDelete={() => { const { remote, name } = modalStore.deleteRemoteBranch; modalStore.closeDeleteRemoteBranch(); vscode.postMessage({ type: 'deleteRemoteBranch', payload: { remote, name } }); }}
  />
{/if}

{#if modalStore.removeWorktree.show}
  <RemoveWorktreeModal
    path={modalStore.removeWorktree.path}
    branch={modalStore.removeWorktree.branch}
    onClose={() => { modalStore.closeRemoveWorktree(); }}
    onRemove={(deleteBranch) => { const { path, branch } = modalStore.removeWorktree; modalStore.closeRemoveWorktree(); vscode.postMessage({ type: 'worktreeRemove', payload: { path, deleteBranch: deleteBranch ? branch : undefined } }); }}
  />
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
  <FetchModal
    remotes={branchStore.remotes}
    initialRemote={modalStore.fetch.remote}
    onClose={() => { modalStore.closeFetch(); }}
    onFetch={(remote) => {
      modalStore.closeFetch();
      uiStore.operating = 'fetch';
      vscode.postMessage({ type: 'fetch', payload: { remote, prune: true } });
    }}
  />
{/if}

{#if modalStore.pull.show}
  <PullModal
    upstream={branchStore.currentBranch?.upstream ?? 'origin'}
    currentBranch={branchStore.currentBranch?.name ?? 'current branch'}
    onClose={() => { modalStore.closePull(); }}
    onPull={({ rebase, stash }) => {
      modalStore.closePull();
      uiStore.operating = 'pull';
      vscode.postMessage({ type: 'pull', payload: { rebase, stash } });
    }}
  />
{/if}

{#if modalStore.push.show}
  {@const hasUpstream = !!branchStore.currentBranch?.upstream && !branchStore.currentBranch?.upstreamGone}
  {@const pushBranchName = branchStore.currentBranch?.name ?? 'branch'}
  <PushModal
    branchName={pushBranchName}
    {hasUpstream}
    upstream={branchStore.currentBranch?.upstream ?? ''}
    remotes={branchStore.remotes}
    initialRemote={modalStore.push.remote}
    onClose={() => { modalStore.closePush(); }}
    onPush={({ forceMode, setUpstream, remote, allTags }) => {
      const force = forceMode === 'none' ? undefined : forceMode;
      const remoteArg = hasUpstream ? undefined : remote;
      const branchArg = hasUpstream ? undefined : pushBranchName;
      modalStore.closePush();
      uiStore.operating = 'push';
      vscode.postMessage({ type: 'push', payload: { remote: remoteArg, branch: branchArg, force, setUpstream: !hasUpstream && setUpstream } });
      if (allTags) vscode.postMessage({ type: 'pushAllTags', payload: { remote } });
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

  .error-bar {
    display: flex;
    align-items: center;
    padding: 7px 8px 7px 12px;
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
    gap: 8px;
  }

  .error-icon {
    flex-shrink: 0;
    font-size: 14px;
    color: var(--vscode-errorForeground, #f48771);
  }

  .error-text {
    flex: 1;
    min-width: 0;
    word-break: break-word;
    white-space: pre-wrap;
    line-height: 1.5;
  }

  .error-dismiss {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
    opacity: 0.6;
    border-radius: 3px;
    font-size: 14px;
  }

  .error-dismiss:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1));
  }

  /* ---- Rebase pause banner ---- */
  .rebase-pause-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: rgba(156, 39, 176, 0.08);
    border: 1px solid rgba(156, 39, 176, 0.3);
    color: #9c27b0;
  }

  .rebase-pause-actions {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }

  /* ---- Light theme overrides (rebase pause) ---- */
  :global(body.vscode-light) .rebase-pause-banner {
    background: rgba(123, 31, 162, 0.07);
    border-color: rgba(123, 31, 162, 0.3);
    color: #7b1fa2;
  }

  /* ---- Conflict banner ---- */
  .conflict-banner {
    background: rgba(240, 160, 32, 0.06);
    border: 1px solid rgba(240, 160, 32, 0.25);
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
    font-size: 12px;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .unresolved-icon {
    color: #f0a020;
    background: rgba(240, 160, 32, 0.15);
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
    font-size: inherit;
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

  :global(body.vscode-light) .unresolved-icon {
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
    /* bottomPanelHeight is a fixed px value that isn't recomputed when the
       viewport shrinks (e.g. opening the terminal). Cap the panel to the
       available area so it can never overflow .content-area and get clipped;
       BottomPanel then scrolls internally instead of becoming unreachable. */
    max-height: 80%;
    border-top: 1px solid var(--border-color);
  }

  .bottom-area.fullscreen {
    flex: 1;
    max-height: none;
    border-top: none;
  }

  :global(.vsg-tooltip) {
    position: fixed;
    z-index: 9999;
    background: var(--vscode-editorHoverWidget-background, #252526);
    color: var(--vscode-editorHoverWidget-foreground, #cccccc);
    border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
    border-radius: 3px;
    padding: 3px 8px;
    font-size: calc(var(--vscode-font-size, 13px) - 2px);
    line-height: 1.5;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }
</style>
