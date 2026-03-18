import type { CommitGraphData, BranchData, DiffData, BlameData, ReflogEntry, Commit, WorktreeInfo } from '../git/types';

// Messages from Webview → Extension
export type WebviewMessage =
  | { type: 'getLog'; payload: { branch?: string; limit?: number } }
  | { type: 'getBranches' }
  | { type: 'getBlame'; payload: { file: string } }
  | { type: 'getReflog' }
  | { type: 'getFileHistory'; payload: { file: string } }
  | { type: 'checkout'; payload: { ref: string; pullAfter?: boolean } }
  | { type: 'getCommitDiff'; payload: { hash: string } }
  | { type: 'createBranch'; payload: { name: string; startPoint?: string; checkout?: boolean } }
  | { type: 'deleteBranch'; payload: { name: string; force?: boolean } }
  | { type: 'renameBranch'; payload: { oldName: string; newName: string } }
  | { type: 'merge'; payload: { branch: string; noFf?: boolean; squash?: boolean } }
  | { type: 'abortMerge' }
  | { type: 'rebase'; payload: { onto: string; autostash?: boolean } }
  | { type: 'abortRebase' }
  | { type: 'continueRebase' }
  | { type: 'skipRebase' }
  | { type: 'interactiveRebase'; payload: { base: string; todos: Array<{ action: string; hash: string }> } }
  | { type: 'getRebaseCommits'; payload: { base: string } }
  | { type: 'reset'; payload: { ref: string; mode: 'soft' | 'mixed' | 'hard' } }
  | { type: 'push'; payload: { remote?: string; branch?: string; force?: boolean; setUpstream?: boolean } }
  | { type: 'pull'; payload: { remote?: string; branch?: string; rebase?: boolean; stash?: boolean } }
  | { type: 'fetch'; payload: { remote?: string; prune?: boolean } }
  | { type: 'stashSave'; payload: { message?: string; includeUntracked?: boolean; keepIndex?: boolean } }
  | { type: 'stashApply'; payload: { index: number; drop?: boolean } }
  | { type: 'cherryPick'; payload: { commit: string; noCommit?: boolean } }
  | { type: 'revert'; payload: { commit: string; noCommit?: boolean } }
  | { type: 'addRemote'; payload: { name: string; url: string } }
  | { type: 'removeRemote'; payload: { name: string } }
  | { type: 'openDiff'; payload: { file: string; commitHash?: string } }
  | { type: 'stashDrop'; payload: { index: number } }
  | { type: 'createTag'; payload: { name: string; ref?: string; message?: string } }
  | { type: 'deleteTag'; payload: { name: string } }
  | { type: 'searchCommits'; payload: { query: string; author?: string; after?: string; before?: string } }
  | { type: 'searchByHash'; payload: { hash: string } }
  | { type: 'getActivityLog' }
  | { type: 'bisectStart'; payload: { bad?: string; good?: string } }
  | { type: 'bisectGood'; payload: { ref?: string } }
  | { type: 'bisectBad'; payload: { ref?: string } }
  | { type: 'bisectReset' }
  | { type: 'getStats' }
  | { type: 'lsTree'; payload: { ref: string; path?: string } }
  | { type: 'flowInit' }
  | { type: 'flowAction'; payload: { flowType: string; action: string; name: string } }
  | { type: 'createPR'; payload: { title: string; body: string; base?: string } }
  | { type: 'getSubmodules' }
  | { type: 'submoduleUpdate' }
  | { type: 'getLfsFiles' }
  | { type: 'switchRepo'; payload: { path: string } }
  | { type: 'getWorktrees' }
  | { type: 'addWorktree'; payload: { path: string; branch?: string; newBranch?: string } }
  | { type: 'removeWorktree'; payload: { path: string; force?: boolean } }
  | { type: 'pruneWorktrees' }
  | { type: 'pushTag'; payload: { name: string; remote?: string } }
  | { type: 'pushAllTags'; payload: { remote?: string } }
  | { type: 'deleteRemoteTag'; payload: { name: string; remote?: string } }
  | { type: 'copyToClipboard'; payload: { text: string } }
  | { type: 'saveCommitPatch'; payload: { hash: string } }
  | { type: 'compareToWorking'; payload: { hash: string } }
  | { type: 'getImageAtRef'; payload: { ref: string; path: string } };

// Messages from Extension → Webview
export type ExtensionMessage =
  | { type: 'logData'; payload: CommitGraphData }
  | { type: 'branchData'; payload: BranchData }
  | { type: 'blameData'; payload: BlameData }
  | { type: 'reflogData'; payload: ReflogEntry[] }
  | { type: 'commitDiffData'; payload: { diffs: DiffData[]; files: Array<{ path: string; status: string }> } }
  | { type: 'fileHistoryData'; payload: CommitGraphData }
  | { type: 'rebaseCommitsData'; payload: { base: string; commits: Commit[] } }
  | { type: 'searchResults'; payload: CommitGraphData }
  | { type: 'activityLogData'; payload: Array<{ command: string; timestamp: string; success: boolean; duration: number }> }
  | { type: 'repoChanged'; payload: { what: string } }
  | { type: 'error'; payload: { message: string; command?: string } }
  | { type: 'operationComplete'; payload: { operation: string; success: boolean } }
  | { type: 'bisectResult'; payload: { message: string } }
  | { type: 'statsData'; payload: { byAuthor: Array<{ author: string; count: number }>; byWeekdayHour: Array<{ weekday: number; hour: number; count: number }> } }
  | { type: 'lsTreeData'; payload: { ref: string; path?: string; entries: Array<{ mode: string; type: 'blob' | 'tree'; hash: string; name: string }> } }
  | { type: 'prCreated'; payload: { url: string } }
  | { type: 'submoduleData'; payload: Array<{ hash: string; path: string; status: string }> }
  | { type: 'lfsData'; payload: { files: Array<{ oid: string; path: string }>; locks: Array<{ path: string; owner: string; id: string }> } }
  | { type: 'setLocale'; payload: { locale: string } }
  | { type: 'repoList'; payload: { repos: Array<{ path: string; name: string }>; active: string } }
  | { type: 'worktreeData'; payload: WorktreeInfo[] }
  | { type: 'imageData'; payload: { ref: string; path: string; base64: string; mimeType: string } };
