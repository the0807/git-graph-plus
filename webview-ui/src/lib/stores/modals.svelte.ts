/**
 * Centralized modal state store.
 * Any component can call modalStore.openXxx() to show a modal.
 * Only App.svelte renders the modals, preventing duplication.
 */

class ModalStore {
  // ── Delete Branch ──
  deleteBranch = $state({ show: false, name: '' });
  openDeleteBranch(name: string) { this.deleteBranch = { show: true, name }; }
  closeDeleteBranch() { this.deleteBranch = { show: false, name: '' }; }

  // ── Delete Tag ──
  deleteTag = $state({ show: false, name: '' });
  openDeleteTag(name: string) { this.deleteTag = { show: true, name }; }
  closeDeleteTag() { this.deleteTag = { show: false, name: '' }; }

  // ── Create Branch ──
  createBranch = $state({ show: false, startPoint: '', subject: '' });
  openCreateBranch(startPoint: string, subject = '') { this.createBranch = { show: true, startPoint, subject }; }
  closeCreateBranch() { this.createBranch = { show: false, startPoint: '', subject: '' }; }

  // ── Create Tag ──
  createTag = $state({ show: false, ref: '', subject: '' });
  openCreateTag(ref: string, subject = '') { this.createTag = { show: true, ref, subject }; }
  closeCreateTag() { this.createTag = { show: false, ref: '', subject: '' }; }

  // ── Merge Branch ──
  merge = $state({ show: false, source: '', target: '' });
  openMerge(source: string, target: string) { this.merge = { show: true, source, target }; }
  closeMerge() { this.merge = { show: false, source: '', target: '' }; }

  // ── Checkout Remote ──
  checkoutRemote = $state<{ show: boolean; remoteName: string; localName: string; dirty: boolean; dirtyPayload: Record<string, boolean> }>({ show: false, remoteName: '', localName: '', dirty: false, dirtyPayload: {} });
  openCheckoutRemote(remoteName: string, localName: string, dirty = false, dirtyPayload: Record<string, boolean> = {}) { this.checkoutRemote = { show: true, remoteName, localName, dirty, dirtyPayload }; }
  closeCheckoutRemote() { this.checkoutRemote = { show: false, remoteName: '', localName: '', dirty: false, dirtyPayload: {} }; }

  // ── Rename Branch ──
  renameBranch = $state({ show: false, oldName: '' });
  openRenameBranch(oldName: string) { this.renameBranch = { show: true, oldName }; }
  closeRenameBranch() { this.renameBranch = { show: false, oldName: '' }; }

  // ── Delete Remote Branch ──
  deleteRemoteBranch = $state({ show: false, remote: '', name: '' });
  openDeleteRemoteBranch(remote: string, name: string) { this.deleteRemoteBranch = { show: true, remote, name }; }
  closeDeleteRemoteBranch() { this.deleteRemoteBranch = { show: false, remote: '', name: '' }; }

  // ── Remove Worktree ──
  removeWorktree = $state({ show: false, path: '', branch: '' });
  openRemoveWorktree(path: string, branch: string) { this.removeWorktree = { show: true, path, branch }; }
  closeRemoveWorktree() { this.removeWorktree = { show: false, path: '', branch: '' }; }

  // ── Stash Apply/Pop ──
  stashApply = $state({ show: false, index: 0, message: '', drop: false });
  openStashApply(index: number, message: string, drop: boolean) { this.stashApply = { show: true, index, message, drop }; }
  closeStashApply() { this.stashApply = { show: false, index: 0, message: '', drop: false }; }

  // ── Stash Save ──
  stashSave = $state({ show: false });
  openStashSave() { this.stashSave = { show: true }; }
  closeStashSave() { this.stashSave = { show: false }; }

  // ── Set Upstream ──
  setUpstream = $state({ show: false, branchName: '' });
  openSetUpstream(branchName: string) { this.setUpstream = { show: true, branchName }; }
  closeSetUpstream() { this.setUpstream = { show: false, branchName: '' }; }

  // ── Fetch ──
  fetch = $state({ show: false, allRemotes: false, remote: 'origin' });
  openFetch(remote = 'origin') { this.fetch = { show: true, allRemotes: false, remote }; }
  closeFetch() { this.fetch = { show: false, allRemotes: false, remote: 'origin' }; }

  // ── Pull ──
  pull = $state({ show: false, rebase: true, stash: false });
  openPull() { this.pull = { show: true, rebase: true, stash: false }; }
  closePull() { this.pull = { show: false, rebase: true, stash: false }; }

  // ── Push ──
  push = $state({ show: false, forceMode: 'none' as 'none' | 'with-lease' | 'force', setUpstream: true, remote: 'origin', allTags: false });
  openPush(remote = 'origin') { this.push = { show: true, forceMode: 'none', setUpstream: true, remote, allTags: false }; }
  closePush() { this.push = { show: false, forceMode: 'none', setUpstream: true, remote: 'origin', allTags: false }; }

  // ── Flow Init ──
  flowInit = $state({ show: false });
  openFlowInit() { this.flowInit = { show: true }; }
  closeFlowInit() { this.flowInit = { show: false }; }

  // ── Flow Start ──
  flowStart = $state({ show: false, flowType: '' as string });
  openFlowStart(flowType: string) { this.flowStart = { show: true, flowType }; }
  closeFlowStart() { this.flowStart = { show: false, flowType: '' }; }

  // ── Flow Finish ──
  flowFinish = $state({ show: false, flowType: '' as string, branchName: '' });
  openFlowFinish(flowType: string, branchName: string) { this.flowFinish = { show: true, flowType, branchName }; }
  closeFlowFinish() { this.flowFinish = { show: false, flowType: '', branchName: '' }; }

  // ── Push Tag ──
  pushTag = $state({ show: false, tagName: '', remote: 'origin' });
  openPushTag(tagName: string, remote = 'origin') { this.pushTag = { show: true, tagName, remote }; }
  closePushTag() { this.pushTag = { show: false, tagName: '', remote: 'origin' }; }
}

export const modalStore = new ModalStore();
