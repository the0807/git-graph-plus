export const en: Record<string, string> = {
  // Toolbar
  'toolbar.history': 'History',
  'toolbar.log': 'Log',
  'toolbar.stats': 'Stats',
  'toolbar.fetch': 'Fetch',
  'toolbar.pull': 'Pull',
  'toolbar.push': 'Push',
  'toolbar.refresh': 'Refresh',
  'toolbar.stashDesc': 'Stash (save uncommitted changes)',
  'toolbar.fetchAll': 'Fetch All (download remote changes)',
  'toolbar.pullDesc': 'Pull (fetch + merge)',
  'toolbar.pushDesc': 'Push (upload local commits)',
  'toolbar.refreshDesc': 'Refresh (Ctrl+R)',

  // Push modal
  'push.title': 'Push',
  'push.confirm': 'Push {branch} to remote?',
  'push.forcePush': 'Force push (--force-with-lease)',
  'push.forceWarning': 'Force push may overwrite remote changes. Use with caution.',
  'push.cancel': 'Cancel',
  'push.push': 'Push',
  'push.forcePushBtn': 'Force Push',

  // Sidebar sections
  'sidebar.local': 'Local',
  'sidebar.remotes': 'Remotes',
  'sidebar.tags': 'Tags',
  'sidebar.stashes': 'Stashes',
  'sidebar.worktrees': 'Worktrees',

  // Sidebar context menu
  'sidebar.checkout': 'Checkout',
  'sidebar.mergeInto': 'Merge into current branch',
  'sidebar.rebaseOnto': 'Rebase current branch onto this',
  'sidebar.rename': 'Rename',
  'sidebar.delete': 'Delete',
  'sidebar.fetchRemote': 'Fetch {name}',
  'sidebar.removeRemote': 'Remove {name}',
  'sidebar.apply': 'Apply',
  'sidebar.pop': 'Pop (Apply & Drop)',
  'sidebar.drop': 'Drop',
  'sidebar.deleteTag': 'Delete Tag',
  'sidebar.pushTag': 'Push to Remote',
  'sidebar.pushAllTags': 'Push All Tags',
  'sidebar.deleteRemoteTag': 'Delete from Remote',

  // Create branch modal
  'createBranch.title': 'Create Branch',
  'createBranch.desc': 'Create new branch',
  'createBranch.createAt': 'Create branch at:',
  'createBranch.name': 'Branch name:',
  'createBranch.namePlaceholder': 'Enter Branch Name',
  'createBranch.startPoint': 'Start point (optional)',
  'createBranch.checkout': 'Check out after create',
  'createBranch.create': 'Create',
  'createBranch.createAndCheckout': 'Create and Checkout',

  // Rename branch modal
  'renameBranch.title': 'Rename Branch',
  'renameBranch.desc': 'Rename branch {name}',
  'renameBranch.newName': 'New name',
  'renameBranch.rename': 'Rename',

  // Add remote modal
  'addRemote.title': 'Add Remote',
  'addRemote.name': 'Name',
  'addRemote.url': 'URL',
  'addRemote.add': 'Add',

  // Stash modal
  'stash.title': 'Stash Changes',
  'stash.message': 'Message (optional)',
  'stash.includeUntracked': 'Include untracked files',
  'stash.keepIndex': 'Keep staged changes (--keep-index)',
  'stash.stash': 'Stash',

  // Create tag modal
  'createTag.title': 'Create Tag',
  'createTag.desc': 'Create annotated tag',
  'createTag.createAt': 'Create tag at:',
  'createTag.name': 'Tag name:',
  'createTag.namePlaceholder': 'Enter Tag Name',
  'createTag.message': 'Message:',
  'createTag.messagePlaceholder': 'optional',
  'createTag.target': 'Target (optional, defaults to HEAD)',
  'createTag.pushToRemotes': 'Push to all remotes',
  'createTag.create': 'Create',
  'createTag.createAndPush': 'Create and Push',

  // Graph
  'graph.loading': 'Loading commits',
  'graph.noCommits': 'No commits found',
  'graph.noResults': 'No matching commits',
  'graph.searchResults': 'Showing {count} search result{plural}',
  'graph.description': 'Description',
  'graph.author': 'Author',
  'graph.date': 'Date',
  'graph.sha': 'SHA',

  // Graph context menu
  'graph.checkoutHash': 'Checkout {hash}',
  'graph.createBranchHere': 'Create Branch Here',
  'graph.cherryPick': 'Cherry-pick',
  'graph.revert': 'Revert',
  'graph.interactiveRebase': 'Interactive Rebase from here',
  'graph.resetToHere': 'Reset current branch to here',
  'graph.compareWith': 'Compare with {hash}',
  'graph.cancelCompare': 'Cancel Compare',
  'graph.selectForCompare': 'Select for Compare',
  'graph.comparingFrom': 'Click a commit to compare with',
  'graph.newTag': 'New Tag',
  'graph.mergeInto': "Merge into '{branch}'",
  'graph.rebaseTo': "Rebase '{branch}' to Here",
  'graph.interactiveRebaseTo': "Interactively Rebase '{branch}' to Here",
  'graph.resetBranchToHere': "Reset '{branch}' to Here",
  'graph.checkoutCommit': 'Checkout Commit',
  'graph.cherryPickCommit': 'Cherry-pick Commit',
  'graph.revertCommit': 'Revert Commit',
  'graph.savePatch': 'Save as Patch',
  'graph.compareToLocal': 'Compare to Local Changes',
  'graph.copySHA': 'Copy Commit SHA',
  'graph.copyBranchName': 'Copy Branch Name',
  'graph.copyTagName': 'Copy Tag Name',
  'graph.deleteTag': 'Delete Tag',
  'graph.rename': 'Rename Branch',
  'graph.deleteBranch': 'Delete Branch',
  'graph.deleteRemoteBranch': 'Delete Remote Branch',
  'graph.removeWorktree': 'Remove Worktree',

  // Reset modal
  'reset.title': 'Reset to {hash}',
  'reset.confirm': 'Reset current branch to {hash}',
  'reset.soft': 'Soft',
  'reset.softDesc': 'keep all changes staged',
  'reset.mixed': 'Mixed',
  'reset.mixedDesc': 'keep changes but unstaged',
  'reset.hard': 'Hard',
  'reset.hardDesc': 'discard all changes',
  'reset.reset': 'Reset {mode}',

  // Interactive rebase
  'rebase.title': 'Interactive Rebase',
  'rebase.loading': 'Loading commits',
  'rebase.noCommits': 'No commits to rebase',
  'rebase.instructions': 'Drag or use arrows to reorder. Click action to change.',
  'rebase.start': 'Start Rebase',
  'rebase.dropWarning': '{count} commit(s) will be dropped.',
  'rebase.action.pick': 'Use commit',
  'rebase.action.reword': 'Edit message',
  'rebase.action.edit': 'Stop to amend',
  'rebase.action.squash': 'Meld into previous',
  'rebase.action.fixup': 'Meld, discard message',
  'rebase.action.drop': 'Remove commit',

  // Commit details
  'details.commit': 'Commit',
  'details.author': 'Author',
  'details.date': 'Date',
  'details.parents': 'Parents',
  'details.refs': 'Refs',
  'details.changes': 'Changes',
  'details.browseFiles': 'Browse Files',
  'details.inline': 'Inline',
  'details.sideBySide': 'Side by Side',
  'details.binaryFile': 'Binary file',
  'details.selectCommit': 'Select a commit to view details',

  // Search bar
  'search.placeholder': 'Search commits (message, author, hash)',
  'search.search': 'Search',
  'search.clear': 'Clear',
  'search.noResults': 'No results',
  'search.prev': 'Previous match (Shift+Enter)',
  'search.next': 'Next match (Enter)',
  'search.filters': 'Filters',
  'search.authorFilter': 'Author filter',

  // Activity log
  'activityLog.title': 'Activity Log',
  'activityLog.auto': 'Auto',
  'activityLog.showAll': 'All',
  'activityLog.refresh': 'Refresh',
  'activityLog.empty': 'No commands executed yet',

  // Stats
  'stats.contributors': 'Contributors ({count})',
  'stats.commitsByDayHour': 'Commits by Day & Hour ({count} total)',
  'stats.loading': 'Loading statistics',
  'stats.less': 'Less',
  'stats.more': 'More',

  // Checkout remote branch modal
  'checkoutRemote.title': 'Checkout Remote Branch',
  'checkoutRemote.desc': 'Create a local branch tracking "{remote}" and switch to it.',
  'checkoutRemote.remote': 'Remote',
  'checkoutRemote.localName': 'Local branch',
  'checkoutRemote.checkout': 'Checkout',

  // Checkout commit modal
  'checkoutCommit.title': 'Checkout',
  'checkoutCommit.desc': 'Checkout commit',
  'checkoutCommit.branchDesc': 'Switch to this branch.',
  'checkoutCommit.checkout': 'Checkout',
  'checkoutCommit.checkoutBranch': 'Checkout {name}',
  'checkoutCommit.checkoutRemote': 'Checkout {name}',
  'checkoutCommit.detachedWarning': 'No branch at this commit. You will be in detached HEAD state.',

  // Checkout and Fast-Forward modal
  'fastForward.title': 'Checkout and Fast-Forward',
  'fastForward.desc': 'Checkout local branch and fast-forward it to remote branch.',
  'fastForward.switchTo': 'Switch to:',
  'fastForward.fastForwardTo': 'Fast-Forward to:',

  // Checkout branch modal (pull after checkout)
  'checkoutBranch.title': 'Checkout Branch',
  'checkoutBranch.desc': 'This branch is {count} commit(s) behind the remote. Pull after checkout?',
  'checkoutBranch.behind': '{count} behind',
  'checkoutBranch.checkoutOnly': 'Checkout Only',
  'checkoutBranch.checkoutAndPull': 'Checkout & Pull',

  // Fetch modal
  'fetch.title': 'Fetch',
  'fetch.desc': 'Fetch latest changes from remote repository.',
  'fetch.remote': 'Remote',
  'fetch.allRemotes': 'All remotes',
  'fetch.prune': 'Prune deleted remote branches (--prune)',
  'fetch.fetch': 'Fetch',

  // Push modal (inline)
  'push.desc': 'Push local commits to the remote repository.',
  'push.forcePushOption': 'Force push (--force-with-lease)',

  // Pull modal
  'pull.title': 'Pull',
  'pull.desc': 'Pull changes from the remote repository.',
  'pull.rebase': 'Rebase instead of merge',
  'pull.stash': 'Stash and reapply local changes',
  'pull.pull': 'Pull',

  // Cherry-pick modal
  'cherryPick.title': 'Cherry-pick Commit',
  'cherryPick.desc': 'Apply the selected commit onto the current branch.',
  'cherryPick.noCommit': 'Apply changes without committing (--no-commit)',
  'cherryPick.cherryPick': 'Cherry-pick',

  // Revert modal
  'revert.title': 'Revert Commit',
  'revert.desc': 'Create a new commit that undoes the changes of the selected commit.',
  'revert.noCommit': 'Apply changes without committing (--no-commit)',
  'revert.revert': 'Revert',

  // Merge modal
  'merge.title': 'Merge Branch',
  'merge.desc': 'Merge the selected branch into the current branch.',
  'merge.mergeType': 'Merge Type:',
  'merge.default': 'Default — Fast-forward if possible',
  'merge.noFf': 'No Fast-forward — Always create merge commit',
  'merge.ffOnly': 'Fast-forward Only — Fail if not possible',
  'merge.squash': 'Squash — Combine all commits into one',
  'merge.squashWarning': 'Original commits will not be preserved in the history.',
  'merge.merge': 'Merge',

  // Rebase modal
  'rebaseBranch.title': 'Rebase Branch',
  'rebaseBranch.desc': 'Rebase the current branch onto the selected branch. This will rewrite commit history.',
  'rebaseBranch.rebase': 'Rebase',
  'rebase.autostash': 'Auto-stash before rebase (--autostash)',

  // Reset modal
  'reset.modalTitle': 'Reset Branch to Revision',
  'reset.desc': 'Move the branch head to the selected revision.',
  'reset.branch': 'Branch:',
  'reset.moveTo': 'Move to:',
  'reset.resetType': 'Reset Type:',
  'reset.softOption': 'Soft — Keep all changes staged',
  'reset.mixedOption': 'Mixed — Keep all changes unstaged',
  'reset.hardOption': 'Hard — Discard all changes',
  'reset.hardWarning': 'All uncommitted changes will be permanently lost.',
  'reset.resetBtn': 'Reset',

  // Common labels
  'common.commit': 'Commit:',
  'common.onto': 'Onto:',
  'common.branch': 'Branch:',
  'common.options': 'Options:',

  // Delete branch confirmation
  'deleteBranch.title': 'Delete Branch',
  'deleteBranch.confirm': 'Are you sure you want to delete branch "{name}"?',
  'deleteBranch.force': 'Force delete even if not fully merged (-D)',
  'deleteBranch.deleteRemote': 'Also delete remote branch',
  'deleteBranch.worktreeWarning': 'Linked worktree "{name}" will also be removed.',

  // Delete tag confirmation
  'deleteTag.title': 'Delete Tag',
  'deleteTag.confirm': 'Are you sure you want to delete tag "{name}"?',
  'deleteTag.deleteRemote': 'Also delete from remote',

  // Delete remote tag confirmation
  'deleteRemoteTag.title': 'Delete Remote Tag',
  'deleteRemoteTag.confirm': 'Are you sure you want to delete tag "{name}" from the remote? This cannot be undone.',

  // Delete remote branch
  'deleteRemoteBranch.title': 'Delete Remote Branch',
  'deleteRemoteBranch.confirm': 'Are you sure you want to delete branch {name} from the remote? This cannot be undone.',

  // Stash drop confirmation
  'stashDrop.title': 'Drop Stash',
  'stashDrop.confirm': 'Are you sure you want to drop stash "{message}"? This cannot be undone.',

  // Stash pop confirmation
  'stashPop.title': 'Pop Stash',
  'stashPop.confirm': 'Apply and remove stash "{message}"? The stash entry will be deleted after applying.',
  'stashPop.pop': 'Pop',

  // Stash save modal
  'stashSave.title': 'Stash Changes',
  'stashSave.message': 'Message (optional)',
  'stashSave.placeholder': 'Stash message',
  'stashSave.save': 'Stash',

  // Worktree modals
  'worktree.addTitle': 'Add Worktree',
  'worktree.startAt': 'Start at:',
  'worktree.branchName': 'Branch name:',
  'worktree.branchPlaceholder': 'Enter Branch Name',
  'worktree.location': 'Location:',
  'worktree.add': 'Add Worktree',
  'worktree.removeTitle': 'Remove Worktree',
  'worktree.removeConfirm': 'Are you sure you want to remove the worktree at "{path}"?',
  'worktree.deleteBranch': 'Also delete branch "{name}"',

  // Conflict resolution
  'conflict.abortTitle': 'Abort Operation',
  'conflict.abortConfirm': 'Abort the current {operation}? The operation will be cancelled and changes will be reverted.',
  'conflict.abort': 'Abort',
  'conflict.resolveSuccess': '{operation} completed successfully.',

  // Common
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.dismiss': 'Dismiss',

  // Repo selector
  'repo.switchRepo': 'Switch Repository',

  // Git Flow
  'flow.button': 'Git Flow',
  'flow.notInstalled': 'git-flow is not installed.',
  'flow.initialize': 'Initialize Git Flow',
  'flow.startFeature': 'Start Feature',
  'flow.startRelease': 'Start Release',
  'flow.startHotfix': 'Start Hotfix',
  'flow.finish': 'Finish {name}',
  'flow.init.title': 'Initialize Git Flow',
  'flow.init.desc': 'Start using Git Flow by initializing it inside an existing git repository.',
  'flow.init.productionBranch': 'Production Branch',
  'flow.init.developBranch': 'Development Branch',
  'flow.init.featurePrefix': 'Feature Prefix',
  'flow.init.releasePrefix': 'Release Prefix',
  'flow.init.hotfixPrefix': 'Hotfix Prefix',
  'flow.init.versionTagPrefix': 'Version Tag Prefix',
  'flow.init.submit': 'Initialize',
  'flow.start.feature.title': 'Start Feature',
  'flow.start.feature.desc': "Create a new feature branch based on '{developBranch}' and switch to it.",
  'flow.start.release.title': 'Start Release',
  'flow.start.release.desc': "Create a new release branch based on '{developBranch}' and switch to it.",
  'flow.start.hotfix.title': 'Start Hotfix',
  'flow.start.hotfix.desc': "Create a new hotfix branch based on '{productionBranch}' and switch to it.",
  'flow.start.name': 'Name',
  'flow.start.submit': 'Start {type}',
  'flow.finish.feature.title': 'Finish Feature',
  'flow.finish.release.title': 'Finish Release',
  'flow.finish.hotfix.title': 'Finish Hotfix',
  'flow.finish.confirm': 'Finish {name}. The following actions will be performed:',
  'flow.finish.feature.step1': '{name} → merge into {developBranch}',
  'flow.finish.feature.step2': 'Delete {name} branch',
  'flow.finish.feature.step3': 'Checkout {developBranch}',
  'flow.finish.release.step1': '{name} → merge into {productionBranch}',
  'flow.finish.release.step2': 'Create {tag} tag',
  'flow.finish.release.step3': '{productionBranch} → merge into {developBranch} (sync)',
  'flow.finish.release.step4': 'Delete {name} branch',
  'flow.finish.hotfix.step1': '{name} → merge into {productionBranch}',
  'flow.finish.hotfix.step2': 'Create {tag} tag',
  'flow.finish.hotfix.step3': '{productionBranch} → merge into {developBranch} (sync)',
  'flow.finish.hotfix.step4': 'Delete {name} branch',
  'flow.finish.submit': 'Finish',
};
