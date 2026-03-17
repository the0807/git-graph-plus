export const en: Record<string, string> = {
  // Toolbar
  'toolbar.history': 'History',
  'toolbar.log': 'Log',
  'toolbar.stats': 'Stats',
  'toolbar.fetch': 'Fetch',
  'toolbar.pull': 'Pull',
  'toolbar.push': 'Push',
  'toolbar.refresh': 'Refresh',
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
  'renameBranch.newName': 'New name for "{name}"',
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
  'graph.comparingFrom': 'Comparing from {hash} — right-click another commit',
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
  'graph.rename': 'Rename',
  'graph.deleteBranch': 'Delete',

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
  'rebase.title': 'Interactive Rebase onto {base}',
  'rebase.loading': 'Loading commits',
  'rebase.noCommits': 'No commits to rebase',
  'rebase.instructions': 'Drag to reorder. Click action to cycle: pick \u2192 squash \u2192 fixup \u2192 reword \u2192 edit \u2192 drop.',
  'rebase.start': 'Start Rebase',

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
  'search.placeholder': 'Search commits (message, hash)',
  'search.search': 'Search',
  'search.clear': 'Clear',
  'search.filters': 'Filters',
  'search.authorFilter': 'Author filter',

  // Activity log
  'activityLog.title': 'Activity Log',
  'activityLog.auto': 'Auto',
  'activityLog.refresh': 'Refresh',
  'activityLog.empty': 'No commands executed yet',

  // Stats
  'stats.contributors': 'Contributors ({count})',
  'stats.commitsByDayHour': 'Commits by Day & Hour ({count} total)',
  'stats.loading': 'Loading statistics',

  // Checkout remote branch modal
  'checkoutRemote.title': 'Checkout Remote Branch',
  'checkoutRemote.desc': 'Create a local branch tracking "{remote}" and switch to it.',
  'checkoutRemote.remote': 'Remote',
  'checkoutRemote.localName': 'Local branch',
  'checkoutRemote.checkout': 'Checkout',

  // Checkout commit modal
  'checkoutCommit.title': 'Checkout Commit',
  'checkoutCommit.desc': 'This will checkout commit {hash} in detached HEAD state. You will not be on any branch.',

  // Fetch modal
  'fetch.desc': 'Fetch latest changes from remote repository.',
  'fetch.allRemotes': 'All remotes',
  'fetch.prune': 'Prune deleted remote branches (--prune)',

  // Cherry-pick modal
  'cherryPick.noCommit': 'Apply changes without committing (--no-commit)',

  // Revert modal
  'revert.noCommit': 'Apply changes without committing (--no-commit)',

  // Rebase modal
  'rebase.autostash': 'Auto-stash before rebase (--autostash)',

  // Delete branch confirmation
  'deleteBranch.title': 'Delete Branch',
  'deleteBranch.confirm': 'Are you sure you want to delete branch "{name}"?',
  'deleteBranch.force': 'Force delete even if not fully merged (-D)',

  // Delete tag confirmation
  'deleteTag.title': 'Delete Tag',
  'deleteTag.confirm': 'Are you sure you want to delete tag "{name}"?',

  // Delete remote tag confirmation
  'deleteRemoteTag.title': 'Delete Remote Tag',
  'deleteRemoteTag.confirm': 'Are you sure you want to delete tag "{name}" from the remote? This cannot be undone.',

  // Stash drop confirmation
  'stashDrop.title': 'Drop Stash',
  'stashDrop.confirm': 'Are you sure you want to drop stash "{message}"? This cannot be undone.',

  // Common
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.dismiss': 'Dismiss',

  // Repo selector
  'repo.switchRepo': 'Switch Repository',
};
