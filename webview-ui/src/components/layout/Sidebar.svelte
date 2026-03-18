<script lang="ts">
  import { branchStore } from '../../lib/stores/branches.svelte';
  import { uiStore } from '../../lib/stores/ui.svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { t } from '../../lib/i18n/index.svelte';
  import ContextMenu from '../common/ContextMenu.svelte';
  import Modal from '../common/Modal.svelte';
  import ColorSelect from '../common/ColorSelect.svelte';
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
  let newBranchName = $state('');
  let newBranchCheckout = $state(true);
  let newBranchStartPoint = $state('');

  // Add Remote state
  let showAddRemote = $state(false);
  let newRemoteName = $state('');
  let newRemoteUrl = $state('');

  // Stash state
  let showStashSave = $state(false);
  let stashMessage = $state('');
  let stashIncludeUntracked = $state(true);
  let stashKeepIndex = $state(false);

  // Tag state
  let showCreateTag = $state(false);
  let newTagName = $state('');
  let newTagMessage = $state('');
  let newTagRef = $state('');

  // Rename state
  let showRenameBranch = $state(false);
  let renameBranchOld = $state('');
  let renameBranchNew = $state('');

  // Merge/Rebase confirmation
  let showMergeModal = $state(false);
  let mergeTarget = $state('');
  let mergeMode = $state<'default' | 'no-ff' | 'ff-only' | 'squash'>('default');
  let showRebaseModal = $state(false);
  let rebaseTarget = $state('');
  let rebaseAutostash = $state(false);

  // Delete confirmations
  let showDeleteBranchModal = $state(false);
  let deleteBranchName = $state('');
  let deleteBranchForce = $state(false);

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
          action: () => { mergeTarget = branchName; mergeMode = 'default'; showMergeModal = true; },
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
          action: () => { deleteBranchName = branchName; deleteBranchForce = false; showDeleteBranchModal = true; },
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

  function handleCreateBranch() {
    const name = newBranchName.trim();
    if (!name) return;
    vscode.postMessage({
      type: 'createBranch',
      payload: { name, startPoint: newBranchStartPoint || undefined, checkout: newBranchCheckout },
    });
    showCreateBranch = false;
    newBranchName = '';
    newBranchStartPoint = '';
  }

  function handleStashSave() {
    vscode.postMessage({ type: 'stashSave', payload: { message: stashMessage.trim() || undefined, includeUntracked: stashIncludeUntracked, keepIndex: stashKeepIndex } });
    showStashSave = false;
    stashMessage = '';
    stashKeepIndex = false;
  }

  function handleCreateTag() {
    const name = newTagName.trim();
    if (!name) return;
    vscode.postMessage({ type: 'createTag', payload: { name, ref: newTagRef.trim() || undefined, message: newTagMessage.trim() || undefined } });
    showCreateTag = false;
    newTagName = '';
    newTagMessage = '';
    newTagRef = '';
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

  function handleRenameBranch() {
    const newName = renameBranchNew.trim();
    if (!newName || newName === renameBranchOld) return;
    vscode.postMessage({
      type: 'renameBranch',
      payload: { oldName: renameBranchOld, newName },
    });
    showRenameBranch = false;
  }

  function handleCreateKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { handleCreateBranch(); }
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
                  { label: t('sidebar.mergeInto'), action: () => { mergeTarget = branch.name; mergeMode = 'default'; showMergeModal = true; } },
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

<!-- Create Branch Modal -->
{#if showCreateBranch}
  <Modal title={t('createBranch.title')} onClose={() => { showCreateBranch = false; }}>
    <div class="form-group">
      <label for="branch-name">{t('createBranch.name')}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="branch-name"
        type="text"
        bind:value={newBranchName}
        onkeydown={handleCreateKeydown}
        placeholder="feature/my-branch"
        autofocus
      />
    </div>
    <div class="form-group">
      <label for="start-point">{t('createBranch.startPoint')}</label>
      <input
        id="start-point"
        type="text"
        bind:value={newBranchStartPoint}
        onkeydown={handleCreateKeydown}
        placeholder="HEAD"
      />
    </div>
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={newBranchCheckout} />
        {t('createBranch.checkout')}
      </label>
    </div>
    <div class="form-actions">
      <button onclick={() => { showCreateBranch = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={handleCreateBranch} disabled={!newBranchName.trim()}>{t('createBranch.create')}</button>
    </div>
  </Modal>
{/if}

<!-- Rename Branch Modal -->
{#if showRenameBranch}
  <Modal title={t('renameBranch.title')} onClose={() => { showRenameBranch = false; }}>
    <div class="form-group">
      <label for="rename-input">{t('renameBranch.newName', { name: renameBranchOld })}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="rename-input"
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

<!-- Add Remote Modal -->
{#if showAddRemote}
  <Modal title={t('addRemote.title')} onClose={() => { showAddRemote = false; }}>
    <div class="form-group">
      <label for="remote-name">{t('addRemote.name')}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="remote-name" type="text" bind:value={newRemoteName} placeholder="upstream" autofocus />
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

<!-- Stash Save Modal -->
{#if showStashSave}
  <Modal title={t('stash.title')} onClose={() => { showStashSave = false; }}>
    <div class="form-group">
      <label for="stash-msg">{t('stash.message')}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="stash-msg" type="text" bind:value={stashMessage} placeholder="WIP" autofocus onkeydown={(e) => { if (e.key === 'Enter') handleStashSave(); }} />
    </div>
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={stashIncludeUntracked} />
        <span>{t('stash.includeUntracked')}</span>
      </label>
    </div>
    <div class="form-group">
      <label class="checkbox-label">
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

<!-- Create Tag Modal -->
{#if showCreateTag}
  <Modal title={t('createTag.title')} onClose={() => { showCreateTag = false; }}>
    <div class="form-group">
      <label for="tag-name">{t('createTag.name')}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="tag-name" type="text" bind:value={newTagName} placeholder="v1.0.0" autofocus />
    </div>
    <div class="form-group">
      <label for="tag-msg">{t('createTag.message')}</label>
      <input id="tag-msg" type="text" bind:value={newTagMessage} placeholder="Release 1.0.0" />
    </div>
    <div class="form-group">
      <label for="tag-ref">{t('createTag.target')}</label>
      <input id="tag-ref" type="text" bind:value={newTagRef} placeholder="HEAD" onkeydown={(e) => { if (e.key === 'Enter') handleCreateTag(); }} />
    </div>
    <div class="form-actions">
      <button onclick={() => { showCreateTag = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={handleCreateTag} disabled={!newTagName.trim()}>{t('createTag.create')}</button>
    </div>
  </Modal>
{/if}

{#if showMergeModal}
  <Modal title="Merge Branch" onClose={() => { showMergeModal = false; }}>
    <p class="modal-desc">Merge the selected branch into the current branch.</p>
    <div class="info-rows">
      <div class="info-row"><span class="info-label">Source:</span><span class="info-value"><i class="codicon codicon-git-branch"></i> {mergeTarget}</span></div>
      <div class="info-row"><span class="info-label">Into:</span><span class="info-value"><i class="codicon codicon-git-branch"></i> {branchStore.currentBranch?.name ?? 'current branch'}</span></div>
      <div class="info-row">
        <span class="info-label">Merge Type:</span>
        <span class="info-value">
          <ColorSelect
            options={[
              { value: 'default', label: 'Default — Fast-forward if possible', color: '#4caf50' },
              { value: 'no-ff', label: 'No Fast-forward — Always create merge commit', color: '#2196f3' },
              { value: 'ff-only', label: 'Fast-forward Only — Fail if not possible', color: '#ff9800' },
              { value: 'squash', label: 'Squash — Combine all commits into one', color: '#9c27b0', warning: 'Original commits will not be preserved in the history.' },
            ]}
            value={mergeMode}
            onChange={(v) => { mergeMode = v as typeof mergeMode; }}
          />
        </span>
      </div>
    </div>
    <div class="form-actions">
      <button onclick={() => { showMergeModal = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => { showMergeModal = false; vscode.postMessage({ type: 'merge', payload: { branch: mergeTarget, noFf: mergeMode === 'no-ff', ffOnly: mergeMode === 'ff-only', squash: mergeMode === 'squash' } }); }}>Merge</button>
    </div>
  </Modal>
{/if}

{#if showRebaseModal}
  <Modal title="Rebase Branch" onClose={() => { showRebaseModal = false; }}>
    <p class="modal-desc">Rebase the current branch onto the selected branch. This will rewrite commit history.</p>
    <div class="info-rows">
      <div class="info-row"><span class="info-label">Branch:</span><span class="info-value"><i class="codicon codicon-git-branch"></i> {branchStore.currentBranch?.name ?? 'current branch'}</span></div>
      <div class="info-row"><span class="info-label">Onto:</span><span class="info-value"><i class="codicon codicon-git-branch"></i> {rebaseTarget}</span></div>
      <div class="info-row">
        <span class="info-label">Options:</span>
        <span class="info-value">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={rebaseAutostash} />
            <span>{t('rebase.autostash')}</span>
          </label>
        </span>
      </div>
    </div>
    <div class="form-actions">
      <button onclick={() => { showRebaseModal = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => { showRebaseModal = false; vscode.postMessage({ type: 'rebase', payload: { onto: rebaseTarget, autostash: rebaseAutostash } }); }}>Rebase</button>
    </div>
  </Modal>
{/if}

<!-- Delete Branch Confirmation -->
{#if showDeleteBranchModal}
  <Modal title={t('deleteBranch.title')} onClose={() => { showDeleteBranchModal = false; }}>
    <p class="modal-desc">{t('deleteBranch.confirm', { name: deleteBranchName })}</p>
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={deleteBranchForce} />
        <span>{t('deleteBranch.force')}</span>
      </label>
    </div>
    <div class="form-actions">
      <button onclick={() => { showDeleteBranchModal = false; }}>{t('common.cancel')}</button>
      <button class="danger-btn" onclick={() => { showDeleteBranchModal = false; vscode.postMessage({ type: 'deleteBranch', payload: { name: deleteBranchName, force: deleteBranchForce } }); }}>{t('sidebar.delete')}</button>
    </div>
  </Modal>
{/if}

<!-- Delete Tag Confirmation -->
{#if showDeleteTagModal}
  <Modal title={t('deleteTag.title')} onClose={() => { showDeleteTagModal = false; }}>
    <p class="modal-desc">{t('deleteTag.confirm', { name: deleteTagName })}</p>
    <div class="form-actions">
      <button onclick={() => { showDeleteTagModal = false; }}>{t('common.cancel')}</button>
      <button class="danger-btn" onclick={() => { showDeleteTagModal = false; vscode.postMessage({ type: 'deleteTag', payload: { name: deleteTagName } }); }}>{t('sidebar.delete')}</button>
    </div>
  </Modal>
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
    <div class="form-actions">
      <button onclick={() => { showDeleteRemoteTagModal = false; }}>{t('common.cancel')}</button>
      <button class="danger-btn" onclick={() => { showDeleteRemoteTagModal = false; vscode.postMessage({ type: 'deleteRemoteTag', payload: { name: deleteRemoteTagName } }); }}>{t('sidebar.delete')}</button>
    </div>
  </Modal>
{/if}

<!-- Checkout Remote Branch -->
{#if showCheckoutRemoteModal}
  <Modal title={t('checkoutRemote.title')} onClose={() => { showCheckoutRemoteModal = false; }}>
    <p class="modal-desc">{t('checkoutRemote.desc', { remote: checkoutRemoteName })}</p>
    <div class="info-rows">
      <div class="info-row"><span class="info-label">{t('checkoutRemote.remote')}:</span><span class="info-value"><i class="codicon codicon-cloud"></i> {checkoutRemoteName}</span></div>
      <div class="info-row">
        <span class="info-label">{t('checkoutRemote.localName')}:</span>
        <span class="info-value" style="flex: 1;">
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="text"
            bind:value={checkoutRemoteLocalName}
            autofocus
            onkeydown={(e) => {
              if (e.key === 'Enter' && checkoutRemoteLocalName.trim()) {
                showCheckoutRemoteModal = false;
                vscode.postMessage({ type: 'createBranch', payload: { name: checkoutRemoteLocalName.trim(), startPoint: checkoutRemoteName, checkout: true } });
              }
            }}
          />
        </span>
      </div>
    </div>
    <div class="form-actions">
      <button onclick={() => { showCheckoutRemoteModal = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => {
        showCheckoutRemoteModal = false;
        vscode.postMessage({ type: 'createBranch', payload: { name: checkoutRemoteLocalName.trim(), startPoint: checkoutRemoteName, checkout: true } });
      }} disabled={!checkoutRemoteLocalName.trim()}>{t('checkoutRemote.checkout')}</button>
    </div>
  </Modal>
{/if}

{#if showPullAfterCheckoutModal}
  <Modal title="Checkout Branch" onClose={() => { showPullAfterCheckoutModal = false; }}>
    <p class="modal-desc">This branch is <strong>{pullAfterCheckoutBehind}</strong> commit{pullAfterCheckoutBehind > 1 ? 's' : ''} behind the remote. Pull after checkout?</p>
    <div class="info-rows">
      <div class="info-row"><span class="info-label">Branch:</span><span class="info-value"><i class="codicon codicon-git-branch"></i> {pullAfterCheckoutRef}</span></div>
    </div>
    <div class="form-actions">
      <button onclick={() => { showPullAfterCheckoutModal = false; }}>{t('common.cancel')}</button>
      <button onclick={() => {
        showPullAfterCheckoutModal = false;
        vscode.postMessage({ type: 'checkout', payload: { ref: pullAfterCheckoutRef } });
      }}>Checkout Only</button>
      <button class="primary" onclick={() => {
        showPullAfterCheckoutModal = false;
        vscode.postMessage({ type: 'checkout', payload: { ref: pullAfterCheckoutRef, pullAfter: true } });
      }}>Checkout & Pull</button>
    </div>
  </Modal>
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

  .form-group { margin-bottom: 12px; }
  .form-group label { display: block; font-size: 12px; margin-bottom: 4px; color: var(--text-secondary); }
  .form-group input[type="text"] {
    width: 100%; padding: 5px 8px; background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border, var(--border-color)); border-radius: 3px;
    font-size: 12px; font-family: inherit; outline: none;
  }
  .form-group input[type="text"]:focus { border-color: var(--vscode-focusBorder, #007fd4); }
  .checkbox-label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

  .modal-desc { font-size: 12px; color: var(--text-secondary); margin-bottom: 16px; }
  .info-rows { display: flex; flex-direction: column; gap: 10px; margin-bottom: 18px; }
  .info-row { display: flex; align-items: center; gap: 12px; font-size: 13px; }
  .info-label { width: 90px; flex-shrink: 0; font-weight: 600; color: var(--text-secondary); }
  .info-value { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .danger-btn { background: var(--vscode-errorForeground, #f44336) !important; color: #fff !important; }
</style>
