# Changelog

## 0.1.0 (2026-03-17)

### Features
- Interactive commit graph with branch/merge visualization and color-coded rails
- Commit details panel with changed files, diffs, and syntax highlighting
- Branch management: create, rename, delete, checkout, merge, rebase
- Tag management: create, push, delete (local and remote)
- Stash support with graph badges and context menu (apply, pop, drop)
- Remote operations: fetch, pull, push with remote selection
- Worktree management: list, add, remove, prune
- Git Flow, Bisect, LFS, and submodule support
- Multi-repository and submodule switching via toolbar dropdown
- Activity Bar sidebar with tree views (Branches, Remotes, Tags, Stashes, Worktrees)
- Commit search by message, author, date range, or hash
- Repository statistics with activity heatmap
- Gravatar avatars for commit authors
- Light/dark/high-contrast theme support
- English and Korean localization

### Settings
- `gitGraphPlus.autoFetch` — toggle periodic auto-fetch
- `gitGraphPlus.autoFetchInterval` — auto-fetch interval (1–60 minutes)
- `gitGraphPlus.locale` — UI language (auto, en, ko)
- `gitGraphPlus.maxCommits` — maximum commits to load
- `gitGraphPlus.graphRowHeight` — commit graph row height
- `gitGraphPlus.defaultView` — default view (graph or log)
- `gitGraphPlus.autoRefresh` — auto-refresh on repository changes
- `gitGraphPlus.showRemoteBranches` — show remote branches in sidebar
- `gitGraphPlus.confirmForcePush` — confirm before force push
