import type { BranchInfo, TagInfo, RemoteInfo, StashEntry, WorktreeInfo, BranchData } from '../types';

class BranchStore {
  branches = $state<BranchInfo[]>([]);
  tags = $state<TagInfo[]>([]);
  remotes = $state<RemoteInfo[]>([]);
  stashes = $state<StashEntry[]>([]);
  worktrees = $state<WorktreeInfo[]>([]);

  get localBranches(): BranchInfo[] {
    return this.branches.filter((b) => !b.remote);
  }

  get remoteBranches(): BranchInfo[] {
    return this.branches.filter((b) => !!b.remote);
  }

  get currentBranch(): BranchInfo | undefined {
    return this.branches.find((b) => b.current);
  }

  setData(data: BranchData) {
    this.branches = data.branches;
    this.tags = data.tags;
    this.remotes = data.remotes;
    this.stashes = data.stashes;
    this.worktrees = data.worktrees ?? [];
  }
}

export const branchStore = new BranchStore();
