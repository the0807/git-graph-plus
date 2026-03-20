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
  checkoutRemote = $state({ show: false, remoteName: '', localName: '' });
  openCheckoutRemote(remoteName: string, localName: string) { this.checkoutRemote = { show: true, remoteName, localName }; }
  closeCheckoutRemote() { this.checkoutRemote = { show: false, remoteName: '', localName: '' }; }

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

  // ── Stash Save ──
  stashSave = $state({ show: false });
  openStashSave() { this.stashSave = { show: true }; }
  closeStashSave() { this.stashSave = { show: false }; }
}

export const modalStore = new ModalStore();
