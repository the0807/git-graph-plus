import type { CommitGraphData, BranchData, DiffData, Commit, WorktreeInfo } from '../git/types';

// Messages from Webview → Extension
export type WebviewMessage =
  | { type: 'getLog'; payload: { branch?: string; limit?: number } }
  | { type: 'getBranches' }
  | { type: 'getRepoList' }
  | { type: 'checkDirty' }
  | { type: 'predictConflicts'; payload: { ours: string; theirs: string } }
  | { type: 'checkout'; payload: { ref: string; pullAfter?: boolean; force?: boolean; merge?: boolean; stash?: boolean; stashUntracked?: boolean; clean?: boolean } }
  | { type: 'getCommitDiff'; payload: { hash: string } }
  | { type: 'createBranch'; payload: { name: string; startPoint?: string; checkout?: boolean; stash?: boolean; stashUntracked?: boolean; force?: boolean; clean?: boolean; merge?: boolean } }
  | { type: 'deleteBranch'; payload: { name: string; force?: boolean; worktreePath?: string; deleteRemote?: boolean } }
  | { type: 'deleteRemoteBranch'; payload: { remote: string; name: string } }
  | { type: 'renameBranch'; payload: { oldName: string; newName: string } }
  | { type: 'merge'; payload: { branch: string; noFf?: boolean; ffOnly?: boolean; squash?: boolean } }
  | { type: 'abortMerge' }
  | { type: 'rebase'; payload: { onto: string; autostash?: boolean } }
  | { type: 'abortRebase' }
  | { type: 'continueRebase' }
  | { type: 'skipRebase' }
  | { type: 'interactiveRebase'; payload: { base: string; todos: Array<{ action: string; hash: string }> } }
  | { type: 'getRebaseCommits'; payload: { base: string } }
  | { type: 'reset'; payload: { ref: string; mode: 'soft' | 'mixed' | 'hard' } }
  | { type: 'push'; payload: { remote?: string; branch?: string; force?: 'with-lease' | 'force'; setUpstream?: boolean } }
  | { type: 'pull'; payload: { remote?: string; branch?: string; rebase?: boolean; stash?: boolean } }
  | { type: 'fetch'; payload: { remote?: string; prune?: boolean } }
  | { type: 'stashSave'; payload: { message?: string; includeUntracked?: boolean; keepIndex?: boolean } }
  | { type: 'stashApply'; payload: { index: number; drop?: boolean } }
  | { type: 'cherryPick'; payload: { commit: string; noCommit?: boolean } }
  | { type: 'revert'; payload: { commit: string; noCommit?: boolean } }
  | { type: 'addRemote'; payload: { name: string; url: string } }
  | { type: 'removeRemote'; payload: { name: string } }
  | { type: 'openDiff'; payload: { file: string; commitHash?: string; ref1?: string; ref2?: string } }
  | { type: 'stashDrop'; payload: { index: number } }
  | { type: 'stashRename'; payload: { index: number; message: string } }
  | { type: 'worktreeAdd'; payload: { path: string; branch?: string; newBranch?: string } }
  | { type: 'worktreeRemove'; payload: { path: string; deleteBranch?: string } }
  | { type: 'createTag'; payload: { name: string; ref?: string; message?: string } }
  | { type: 'deleteTag'; payload: { name: string } }
  | { type: 'searchCommits'; payload: { query: string; author?: string; after?: string; before?: string } }
  | { type: 'searchByHash'; payload: { hash: string } }
  | { type: 'searchByFile'; payload: { file: string } }
  | { type: 'getActivityLog' }
  | { type: 'bisectStart'; payload: { bad?: string; good?: string } }
  | { type: 'bisectGood'; payload: { ref?: string } }
  | { type: 'bisectBad'; payload: { ref?: string } }
  | { type: 'bisectSkip' }
  | { type: 'bisectReset' }
  | { type: 'getStats' }
  | { type: 'lsTree'; payload: { ref: string; path?: string } }
  | { type: 'checkFlowStatus' }
  | { type: 'flowInit'; payload: { productionBranch: string; developBranch: string; featurePrefix: string; releasePrefix: string; hotfixPrefix: string; versionTagPrefix: string } }
  | { type: 'flowAction'; payload: { flowType: string; action: string; name: string } }
  | { type: 'getFlowBranches' }
  | { type: 'getSubmodules' }
  | { type: 'submoduleUpdate' }
  | { type: 'getLfsFiles' }
  | { type: 'lfsLock'; payload: { file: string } }
  | { type: 'lfsUnlock'; payload: { file: string; force?: boolean } }
  | { type: 'switchRepo'; payload: { path: string } }
  | { type: 'getWorktrees' }
  | { type: 'pruneWorktrees' }
  | { type: 'pushTag'; payload: { name: string; remote?: string } }
  | { type: 'pushAllTags'; payload: { remote?: string } }
  | { type: 'deleteRemoteTag'; payload: { name: string; remote?: string } }
  | { type: 'copyToClipboard'; payload: { text: string } }
  | { type: 'saveCommitPatch'; payload: { hash: string } }
  | { type: 'compareToWorking'; payload: { hash: string } }
  | { type: 'compareCommits'; payload: { ref1: string; ref2: string } }
  | { type: 'getImageAtRef'; payload: { ref: string; path: string } }
  | { type: 'continueOperation' }
  | { type: 'refreshConflicts' }
  | { type: 'stageFile'; payload: { file: string } }
  | { type: 'abortOperation' }
  | { type: 'openConflictFile'; payload: { file: string } }
  | { type: 'setUpstream'; payload: { branch: string; remote: string; remoteBranch: string } }
  | { type: 'openWorktreeInNewWindow'; payload: { path: string } }
  | { type: 'showNotification'; payload: { message: string } }
  | { type: 'showTagDetails'; payload: { name: string } };

// Messages from Extension → Webview
export type ExtensionMessage =
  | { type: 'logData'; payload: CommitGraphData }
  | { type: 'branchData'; payload: BranchData }
  | { type: 'fullRefresh'; payload: { logData: CommitGraphData; branchData: BranchData } }
  | { type: 'commitDiffData'; payload: { diffs: DiffData[]; files: Array<{ path: string; status: string }> } }
  | { type: 'rebaseCommitsData'; payload: { base: string; commits: Commit[] } }
  | { type: 'searchResults'; payload: CommitGraphData }
  | { type: 'activityLogData'; payload: Array<{ command: string; timestamp: string; success: boolean; duration: number }> }
  | { type: 'repoChanged'; payload: { what: string } }
  | { type: 'error'; payload: { message: string; command?: string } }
  | { type: 'operationComplete'; payload: { operation: string; success: boolean } }
  | { type: 'checkoutBlocked'; payload: { ref: string; pullAfter?: boolean } }
  | { type: 'dirtyState'; payload: { dirty: boolean } }
  | { type: 'conflictPrediction'; payload: { hasConflict: boolean; files: string[] } }
  | { type: 'bisectResult'; payload: { message: string } }
  | { type: 'statsData'; payload: { byAuthor: Array<{ author: string; email: string; count: number }>; byWeekdayHour: Array<{ weekday: number; hour: number; count: number }> } }
  | { type: 'lsTreeData'; payload: { ref: string; path?: string; entries: Array<{ mode: string; type: 'blob' | 'tree'; hash: string; name: string }> } }
  | { type: 'submoduleData'; payload: Array<{ hash: string; path: string; status: string }> }
  | { type: 'lfsData'; payload: { files: Array<{ oid: string; path: string }>; locks: Array<{ path: string; owner: string; id: string }> } }
  | { type: 'tagDetailsData'; payload: { name: string; hash: string; message?: string; isAnnotated: boolean } }
  | { type: 'setLocale'; payload: { locale: string; homeDir?: string } }
  | { type: 'repoList'; payload: { repos: Array<{ path: string; name: string; type: 'root' | 'submodule' | 'nested' }>; active: string } }
  | { type: 'worktreeData'; payload: WorktreeInfo[] }
  | { type: 'imageData'; payload: { ref: string; path: string; base64: string; mimeType: string } }
  | { type: 'conflictData'; payload: { operation: string; files: Array<{ path: string; resolved: boolean }> } }
  | { type: 'flowStatus'; payload: { installed: boolean; initialized: boolean; config: { productionBranch: string; developBranch: string; featurePrefix: string; releasePrefix: string; hotfixPrefix: string; versionTagPrefix: string } | null } }
  | { type: 'flowBranches'; payload: { features: string[]; releases: string[]; hotfixes: string[] } }
  | { type: 'showModal'; payload:
    | { modal: 'deleteBranch'; branchName: string }
    | { modal: 'deleteTag'; tagName: string }
    | { modal: 'stashDrop'; index: number; message: string }
    | { modal: 'stashPop'; index: number; message: string }
    | { modal: 'renameBranch'; branchName: string }
    | { modal: 'mergeBranch'; branchName: string }
    | { modal: 'createBranch' }
    | { modal: 'createTag' }
    | { modal: 'stashSave' }
    | { modal: 'checkoutRemote'; remoteName: string; localName: string }
    | { modal: 'deleteRemoteTag'; tagName: string }
    | { modal: 'removeWorktree'; path: string; branch: string }
    | { modal: 'deleteRemoteBranch'; remote: string; name: string }
    | { modal: 'addWorktree'; defaultPath: string }
  };
