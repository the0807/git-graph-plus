<script lang="ts">
  import { branchStore } from '../../lib/stores/branches.svelte';
  import { uiStore } from '../../lib/stores/ui.svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { t } from '../../lib/i18n/index.svelte';
  import ContextMenu from '../common/ContextMenu.svelte';
  import Modal from '../common/Modal.svelte';
  import DeleteTagModal from '../modals/DeleteTagModal.svelte';
  import DeleteBranchModal from '../modals/DeleteBranchModal.svelte';
  import AddRemoteModal from '../modals/AddRemoteModal.svelte';
  import PullAfterCheckoutModal from '../modals/PullAfterCheckoutModal.svelte';
  import CheckoutRemoteModal from '../modals/CheckoutRemoteModal.svelte';
  import MergeBranchModal from '../modals/MergeBranchModal.svelte';
  import RebaseBranchModal from '../modals/RebaseBranchModal.svelte';
  import CreateBranchModal from '../modals/CreateBranchModal.svelte';
  import CreateTagModal from '../modals/CreateTagModal.svelte';
  import { onMount } from 'svelte';
  import type { WorktreeInfo } from '../../lib/types';

  const vscode = getVsCodeApi();

  let localExpanded = $state(true);
  let remoteExpanded = $state(true);
  let tagsExpanded = $state(false);
  let stashExpanded = $state(false);
  let worktreeExpanded = $state(false);

  // Context menu state
  let contextMenu = $state<{ x: number; y: number; items: any[] } | null>(null);

  // Modal state
  let showCreateBranch = $state(false);

  // Add Remote state
  let showAddRemote = $state(false);

  // Stash state
  let showStashSave = $state(false);
  let stashMessage = $state('');
  let stashIncludeUntracked = $state(true);
  let stashKeepIndex = $state(false);

  // Tag state
  let showCreateTag = $state(false);

  // Rename state
  let showRenameBranch = $state(false);
  let renameBranchOld = $state('');
  let renameBranchNew = $state('');

  // Merge/Rebase confirmation
  let showMergeModal = $state(false);
  let mergeTarget = $state('');
  let showRebaseModal = $state(false);
  let rebaseTarget = $state('');

  // Delete confirmations
  let showDeleteBranchModal = $state(false);
  let deleteBranchName = $state('');

  let showDeleteTagModal = $state(false);
  let deleteTagName = $state('');

  let showDeleteRemoteTagModal = $state(false);
  let deleteRemoteTagName = $state('');

  // Checkout remote branch
  let showCheckoutRemoteModal = $state(false);
  let checkoutRemoteName = $state('');
  let checkoutRemoteLocalName = $state('');

  // Pull after checkout
  let showPullAfterCheckoutModal = $state(false);
  let pullAfterCheckoutRef = $state('');
  let pullAfterCheckoutBehind = $state(0);

  function doCheckout(ref: string) {
    const branch = branchStore.branches.find(b => !b.remote && b.name === ref);
    if (branch && branch.behind > 0) {
      pullAfterCheckoutRef = ref;
      pullAfterCheckoutBehind = branch.behind;
      showPullAfterCheckoutModal = true;
      return;
    }
    vscode.postMessage({ type: 'checkout', payload: { ref } });
  }

  function doCheckoutRemote(remoteName: string, branchName: string) {
    const localBranch = branchStore.branches.find(b => !b.remote && (b.upstream === remoteName || b.name === branchName));
    if (localBranch) {
      doCheckout(localBranch.name);
    } else {
      checkoutRemoteName = remoteName;
      checkoutRemoteLocalName = branchName;
      showCheckoutRemoteModal = true;
    }
  }

  let showStashDropModal = $state(false);
  let stashDropIndex = $state(0);
  let stashDropMessage = $state('');

  // Worktree state
  let worktrees = $state<WorktreeInfo[]>([]);

  onMount(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data.type === 'worktreeData') {
        worktrees = event.data.payload;
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  });

  function loadWorktrees() {
    vscode.postMessage({ type: 'getWorktrees' });
  }

  function onBranchContextMenu(e: MouseEvent, branchName: string, isCurrent: boolean) {
    e.preventDefault();
    contextMenu = {
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: t('sidebar.checkout'),
          action: () => doCheckout(branchName),
          disabled: isCurrent,
        },
        {
          label: t('sidebar.mergeInto'),
          action: () => { mergeTarget = branchName; showMergeModal = true; },
          disabled: isCurrent,
        },
        {
          label: t('sidebar.rebaseOnto'),
          action: () => { rebaseTarget = branchName; showRebaseModal = true; },
          disabled: isCurrent,
        },
        { separator: true, label: '', action: () => {} },
        {
          label: t('sidebar.rename'),
          action: () => { renameBranchOld = branchName; renameBranchNew = branchName; showRenameBranch = true; },
        },
        {
          label: t('sidebar.delete'),
          action: () => { deleteBranchName = branchName; showDeleteBranchModal = true; },
          danger: true,
          disabled: isCurrent,
        },
      ],
    };
  }

  function onBranchDoubleClick(branchName: string, isCurrent: boolean) {
    if (!isCurrent) {
      doCheckout(branchName);
    }
  }

  function handleStashSave() {
    vscode.postMessage({ type: 'stashSave', payload: { message: stashMessage.trim() || undefined, includeUntracked: stashIncludeUntracked, keepIndex: stashKeepIndex } });
    showStashSave = false;
    stashMessage = '';
    stashKeepIndex = false;
  }

  function handleRenameBranch() {
    const newName = renameBranchNew.trim();
    if (!newName || newName === renameBranchOld) return;
    vscode.postMessage({
      type: 'renameBranch',
      payload: { oldName: renameBranchOld, newName },
    });
    showRenameBranch = false;
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { handleRenameBranch(); }
  }
</script>

<div class="sidebar" style="width: {uiStore.sidebarWidth}px;">
  <!-- Local Branches -->
  <div class="section">
    <div class="section-header" onclick={() => localExpanded = !localExpanded} role="button" tabindex={0} onkeydown={(e) => { if (e.key === 'Enter') localExpanded = !localExpanded; }}>
      <span class="chevron" class:expanded={localExpanded}><i class="codicon codicon-chevron-right"></i></span>
      <span>{t('sidebar.local')}</span>
      <span class="count">{branchStore.localBranches.length}</span>
      <button class="section-action" onclick={(e) => { e.stopPropagation(); showCreateBranch = true; }} title={t('createBranch.title')}><i class="codicon codicon-add"></i></button>
    </div>
    {#if localExpanded}
      <div class="section-content">
        {#each branchStore.localBranches as branch}
          <div
            class="item"
            class:current={branch.current}
            oncontextmenu={(e) => onBranchContextMenu(e, branch.name, branch.current)}
            ondblclick={() => onBranchDoubleClick(branch.name, branch.current)}
            role="treeitem"
            aria-selected={branch.current}
            tabindex={0}
          >
            <i class="codicon item-icon" class:codicon-check={branch.current} class:codicon-git-branch={!branch.current}></i>
            <span class="item-name truncate">{branch.name}</span>
            {#if branch.ahead > 0 || branch.behind > 0}
              <span class="item-badge">
                {#if branch.ahead > 0}<i class="codicon codicon-arrow-up"></i>{branch.ahead}{/if}
                {#if branch.behind > 0}<i class="codicon codicon-arrow-down"></i>{branch.behind}{/if}
              </span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Remotes -->
  <div class="section">
    <div class="section-header" onclick={() => remoteExpanded = !remoteExpanded} role="button" tabindex={0} onkeydown={(e) => { if (e.key === 'Enter') remoteExpanded = !remoteExpanded; }}>
      <span class="chevron" class:expanded={remoteExpanded}><i class="codicon codicon-chevron-right"></i></span>
      <span>{t('sidebar.remotes')}</span>
      <span class="count">{branchStore.remotes.length}</span>
      <button class="section-action" onclick={(e) => { e.stopPropagation(); showAddRemote = true; }} title={t('addRemote.title')}><i class="codicon codicon-add"></i></button>
    </div>
    {#if remoteExpanded}
      <div class="section-content">
        {#each branchStore.remotes as remote}
          <div
            class="item remote-item"
            role="treeitem"
            aria-selected={false}
            tabindex={0}
            oncontextmenu={(e) => {
              e.preventDefault();
              contextMenu = {
                x: e.clientX, y: e.clientY,
                items: [
                  { label: t('sidebar.fetchRemote', { name: remote.name }), action: () => vscode.postMessage({ type: 'fetch', payload: { remote: remote.name } }) },
                  { separator: true, label: '', action: () => {} },
                  { label: t('sidebar.removeRemote', { name: remote.name }), action: () => vscode.postMessage({ type: 'removeRemote', payload: { name: remote.name } }), danger: true },
                ],
              };
            }}
          >
            <i class="codicon codicon-cloud item-icon"></i>
            <span class="item-name truncate">{remote.name}</span>
          </div>
        {/each}
        {#each branchStore.remoteBranches as branch}
          {@const remoteBranchLocalName = branch.name.includes('/') ? branch.name.split('/').slice(1).join('/') : branch.name}
          <div
            class="item"
            style="padding-left: 28px;"
            ondblclick={() => doCheckoutRemote(branch.name, remoteBranchLocalName)}
            oncontextmenu={(e) => {
              e.preventDefault();
              contextMenu = {
                x: e.clientX, y: e.clientY,
                items: [
                  { label: t('sidebar.checkout'), action: () => doCheckoutRemote(branch.name, remoteBranchLocalName) },
                  { separator: true, label: '', action: () => {} },
                  { label: t('sidebar.mergeInto'), action: () => { mergeTarget = branch.name; showMergeModal = true; } },
                  { label: t('sidebar.rebaseOnto'), action: () => { rebaseTarget = branch.name; showRebaseModal = true; } },
                ],
              };
            }}
            role="treeitem"
            aria-selected={false}
            tabindex={0}
          >
            <span class="item-name truncate" style="opacity: 0.8;">{branch.name}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Tags -->
  <div class="section">
    <div class="section-header" onclick={() => tagsExpanded = !tagsExpanded} role="button" tabindex={0} onkeydown={(e) => { if (e.key === 'Enter') tagsExpanded = !tagsExpanded; }}>
      <span class="chevron" class:expanded={tagsExpanded}><i class="codicon codicon-chevron-right"></i></span>
      <span>{t('sidebar.tags')}</span>
      <span class="count">{branchStore.tags.length}</span>
      <button class="section-action" onclick={(e) => { e.stopPropagation(); showCreateTag = true; }} title={t('createTag.title')}><i class="codicon codicon-add"></i></button>
    </div>
    {#if tagsExpanded}
      <div class="section-content">
        {#each branchStore.tags as tag}
          <div
            class="item"
            ondblclick={() => vscode.postMessage({ type: 'checkout', payload: { ref: tag.name } })}
            oncontextmenu={(e) => {
              e.preventDefault();
              contextMenu = {
                x: e.clientX, y: e.clientY,
                items: [
                  { label: t('sidebar.checkout'), action: () => vscode.postMessage({ type: 'checkout', payload: { ref: tag.name } }) },
                  { separator: true, label: '', action: () => {} },
                  { label: t('sidebar.pushTag'), action: () => vscode.postMessage({ type: 'pushTag', payload: { name: tag.name } }) },
                  { label: t('sidebar.pushAllTags'), action: () => vscode.postMessage({ type: 'pushAllTags', payload: {} }) },
                  { label: t('sidebar.deleteRemoteTag'), action: () => { deleteRemoteTagName = tag.name; showDeleteRemoteTagModal = true; }, danger: true },
                  { separator: true, label: '', action: () => {} },
                  { label: t('sidebar.deleteTag'), action: () => { deleteTagName = tag.name; showDeleteTagModal = true; }, danger: true },
                ],
              };
            }}
            role="treeitem"
            aria-selected={false}
            tabindex={0}
          >
            <i class="codicon codicon-tag item-icon"></i>
            <span class="item-name truncate">{tag.name}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Stashes -->
  <div class="section">
    <div class="section-header" onclick={() => stashExpanded = !stashExpanded} role="button" tabindex={0} onkeydown={(e) => { if (e.key === 'Enter') stashExpanded = !stashExpanded; }}>
      <span class="chevron" class:expanded={stashExpanded}><i class="codicon codicon-chevron-right"></i></span>
      <span>{t('sidebar.stashes')}</span>
      <span class="count">{branchStore.stashes.length}</span>
      <button class="section-action" onclick={(e) => { e.stopPropagation(); showStashSave = true; }} title={t('stash.title')}><i class="codicon codicon-add"></i></button>
    </div>
    {#if stashExpanded}
      <div class="section-content">
        {#each branchStore.stashes as stash}
          <div
            class="item"
            oncontextmenu={(e) => {
              e.preventDefault();
              contextMenu = {
                x: e.clientX, y: e.clientY,
                items: [
                  { label: t('sidebar.apply'), action: () => vscode.postMessage({ type: 'stashApply', payload: { index: stash.index, drop: false } }) },
                  { label: t('sidebar.pop'), action: () => vscode.postMessage({ type: 'stashApply', payload: { index: stash.index, drop: true } }) },
                  { separator: true, label: '', action: () => {} },
                  { label: t('sidebar.drop'), action: () => { stashDropIndex = stash.index; stashDropMessage = stash.message; showStashDropModal = true; }, danger: true },
                ],
              };
            }}
            role="treeitem"
            aria-selected={false}
            tabindex={0}
          >
            <i class="codicon codicon-archive item-icon"></i>
            <span class="item-name truncate">{stash.message}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Worktrees -->
  <div class="section">
    <div class="section-header" onclick={() => { worktreeExpanded = !worktreeExpanded; if (worktreeExpanded) loadWorktrees(); }} role="button" tabindex={0} onkeydown={(e) => { if (e.key === 'Enter') { worktreeExpanded = !worktreeExpanded; if (worktreeExpanded) loadWorktrees(); } }}>
      <span class="chevron" class:expanded={worktreeExpanded}><i class="codicon codicon-chevron-right"></i></span>
      <span>{t('sidebar.worktrees')}</span>
      <span class="count">{worktrees.length}</span>
    </div>
    {#if worktreeExpanded}
      <div class="section-content">
        {#each worktrees as wt}
          <div
            class="item"
            class:current={wt.isMain}
            oncontextmenu={(e) => {
              e.preventDefault();
              if (!wt.isMain) {
                contextMenu = {
                  x: e.clientX, y: e.clientY,
                  items: [
                    { label: t('sidebar.delete'), action: () => vscode.postMessage({ type: 'removeWorktree', payload: { path: wt.path } }), danger: true },
                  ],
                };
              }
            }}
            role="treeitem"
            aria-selected={wt.isMain}
            tabindex={0}
          >
            <i class="codicon item-icon" class:codicon-home={wt.isMain} class:codicon-lock={!wt.isMain && wt.locked} class:codicon-folder={!wt.isMain && !wt.locked}></i>
            <span class="item-name truncate">{wt.branch || '(detached)'}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<!-- Context Menu -->
{#if contextMenu}
  <ContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={contextMenu.items}
    onClose={() => { contextMenu = null; }}
  />
{/if}

{#if showCreateBranch}
  <CreateBranchModal
    startPoint="HEAD"
    editableStartPoint={true}
    onClose={() => { showCreateBranch = false; }}
    onCreate={(name, startPoint, checkout) => { showCreateBranch = false; vscode.postMessage({ type: 'createBranch', payload: { name, startPoint: startPoint === 'HEAD' ? undefined : startPoint, checkout } }); }}
  />
{/if}

<!-- Rename Branch Modal -->
{#if showRenameBranch}
  <Modal title={t('renameBranch.title')} onClose={() => { showRenameBranch = false; }}>
    <div class="modal-context-card">
      <span class="modal-pill modal-pill--target">{renameBranchOld}</span>
    </div>
    <div class="modal-form-group">
      <label class="modal-field-label" for="rename-input">{t('renameBranch.newName', { name: renameBranchOld })}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="rename-input"
        class="modal-input"
        type="text"
        bind:value={renameBranchNew}
        onkeydown={handleRenameKeydown}
        autofocus
      />
    </div>
    <div class="form-actions">
      <button onclick={() => { showRenameBranch = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={handleRenameBranch} disabled={!renameBranchNew.trim() || renameBranchNew === renameBranchOld}>{t('renameBranch.rename')}</button>
    </div>
  </Modal>
{/if}

{#if showAddRemote}
  <AddRemoteModal
    onClose={() => { showAddRemote = false; }}
    onAdd={(name, url) => { showAddRemote = false; vscode.postMessage({ type: 'addRemote', payload: { name, url } }); }}
  />
{/if}

<!-- Stash Save Modal -->
{#if showStashSave}
  <Modal title={t('stash.title')} onClose={() => { showStashSave = false; }}>
    <div class="modal-form-group">
      <label class="modal-field-label" for="stash-msg">{t('stash.message')}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="stash-msg" class="modal-input" type="text" bind:value={stashMessage} placeholder="WIP" autofocus onkeydown={(e) => { if (e.key === 'Enter') handleStashSave(); }} />
    </div>
    <div class="modal-form-group">
      <label class="modal-checkbox">
        <input type="checkbox" bind:checked={stashIncludeUntracked} />
        <span>{t('stash.includeUntracked')}</span>
      </label>
    </div>
    <div class="modal-form-group">
      <label class="modal-checkbox">
        <input type="checkbox" bind:checked={stashKeepIndex} />
        <span>{t('stash.keepIndex')}</span>
      </label>
    </div>
    <div class="form-actions">
      <button onclick={() => { showStashSave = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={handleStashSave}>{t('stash.stash')}</button>
    </div>
  </Modal>
{/if}

{#if showCreateTag}
  <CreateTagModal
    startPoint="HEAD"
    editableStartPoint={true}
    onClose={() => { showCreateTag = false; }}
    onCreate={(name, message, startPoint, push) => { showCreateTag = false; vscode.postMessage({ type: 'createTag', payload: { name, ref: startPoint === 'HEAD' ? undefined : startPoint, message: message || undefined } }); if (push) vscode.postMessage({ type: 'pushTag', payload: { name } }); }}
  />
{/if}

{#if showMergeModal}
  <MergeBranchModal
    source={mergeTarget}
    target={branchStore.currentBranch?.name ?? 'current branch'}
    onClose={() => { showMergeModal = false; }}
    onMerge={(options) => { showMergeModal = false; vscode.postMessage({ type: 'merge', payload: { branch: mergeTarget, ...options } }); }}
  />
{/if}

{#if showRebaseModal}
  <RebaseBranchModal
    branch={branchStore.currentBranch?.name ?? 'current branch'}
    onto={rebaseTarget}
    onClose={() => { showRebaseModal = false; }}
    onRebase={(options) => { showRebaseModal = false; vscode.postMessage({ type: 'rebase', payload: { onto: rebaseTarget, autostash: options.autostash } }); }}
  />
{/if}

{#if showDeleteBranchModal}
  <DeleteBranchModal
    branchName={deleteBranchName}
    onClose={() => { showDeleteBranchModal = false; }}
    onDelete={(force) => { showDeleteBranchModal = false; vscode.postMessage({ type: 'deleteBranch', payload: { name: deleteBranchName, force } }); }}
  />
{/if}

{#if showDeleteTagModal}
  <DeleteTagModal
    tagName={deleteTagName}
    onClose={() => { showDeleteTagModal = false; }}
    onDelete={() => { showDeleteTagModal = false; vscode.postMessage({ type: 'deleteTag', payload: { name: deleteTagName } }); }}
  />
{/if}

<!-- Stash Drop Confirmation -->
{#if showStashDropModal}
  <Modal title={t('stashDrop.title')} onClose={() => { showStashDropModal = false; }}>
    <p class="modal-desc">{t('stashDrop.confirm', { message: stashDropMessage })}</p>
    <div class="form-actions">
      <button onclick={() => { showStashDropModal = false; }}>{t('common.cancel')}</button>
      <button class="danger-btn" onclick={() => { showStashDropModal = false; vscode.postMessage({ type: 'stashDrop', payload: { index: stashDropIndex } }); }}>{t('sidebar.drop')}</button>
    </div>
  </Modal>
{/if}

<!-- Delete Remote Tag Confirmation -->
{#if showDeleteRemoteTagModal}
  <Modal title={t('deleteRemoteTag.title')} onClose={() => { showDeleteRemoteTagModal = false; }}>
    <p class="modal-desc">{t('deleteRemoteTag.confirm', { name: deleteRemoteTagName })}</p>
    <div class="modal-context-card">
      <span class="modal-pill modal-pill--danger">{deleteRemoteTagName}</span>
    </div>
    <div class="form-actions">
      <button onclick={() => { showDeleteRemoteTagModal = false; }}>{t('common.cancel')}</button>
      <button class="danger-btn" onclick={() => { showDeleteRemoteTagModal = false; vscode.postMessage({ type: 'deleteRemoteTag', payload: { name: deleteRemoteTagName } }); }}>{t('sidebar.delete')}</button>
    </div>
  </Modal>
{/if}

{#if showCheckoutRemoteModal}
  <CheckoutRemoteModal
    remoteName={checkoutRemoteName}
    defaultLocalName={checkoutRemoteLocalName}
    onClose={() => { showCheckoutRemoteModal = false; }}
    onCheckout={(localName) => { showCheckoutRemoteModal = false; vscode.postMessage({ type: 'createBranch', payload: { name: localName, startPoint: checkoutRemoteName, checkout: true } }); }}
  />
{/if}

{#if showPullAfterCheckoutModal}
  <PullAfterCheckoutModal
    branchName={pullAfterCheckoutRef}
    behind={pullAfterCheckoutBehind}
    onClose={() => { showPullAfterCheckoutModal = false; }}
    onCheckoutOnly={() => { showPullAfterCheckoutModal = false; vscode.postMessage({ type: 'checkout', payload: { ref: pullAfterCheckoutRef } }); }}
    onCheckoutAndPull={() => { showPullAfterCheckoutModal = false; vscode.postMessage({ type: 'checkout', payload: { ref: pullAfterCheckoutRef, pullAfter: true } }); }}
  />
{/if}

<style>
  .sidebar {
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-color);
    overflow-y: auto;
    overflow-x: hidden;
    flex-shrink: 0;
    user-select: none;
  }

  .section { border-bottom: 1px solid var(--border-color); }

  .section-header {
    display: flex; align-items: center; gap: 6px; width: 100%;
    padding: 6px 10px; background: transparent; color: var(--text-primary);
    font-weight: 600; font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.5px; cursor: pointer; border: none; border-radius: 0; text-align: left;
  }

  .section-header:hover { background: var(--bg-hover); }

  .section-action {
    margin-left: auto; width: 18px; height: 18px; padding: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: bold; border-radius: 3px;
    background: transparent; color: var(--text-secondary); opacity: 0;
  }

  .section-header:hover .section-action { opacity: 1; }
  .section-action:hover { background: var(--button-bg); color: var(--button-fg); }

  .chevron { font-size: 8px; transition: transform 0.15s; display: inline-block; }
  .chevron.expanded { transform: rotate(90deg); }

  .count { margin-left: auto; opacity: 0.6; font-weight: normal; font-size: 10px; }
  .section-content { padding: 2px 0; }

  .item {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 10px 3px 20px; cursor: pointer; font-size: 12px;
  }
  .item:hover { background: var(--bg-hover); }
  .item.current { font-weight: 600; }
  .item-icon { font-size: 10px; flex-shrink: 0; width: 12px; text-align: center; }
  .item-name { flex: 1; min-width: 0; }
  .item-badge { font-size: 10px; opacity: 0.7; flex-shrink: 0; }
  .remote-item { opacity: 0.9; }

  .form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  .danger-btn { background: var(--vscode-errorForeground, #f44336) !important; color: #fff !important; }
</style>
