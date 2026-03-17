# Git Graph+

[![Install from VS Code Marketplace](https://img.shields.io/badge/Install-VS%20Code%20Marketplace-blue.svg)](https://marketplace.visualstudio.com/items?itemName=the0807.git-graph-plus)

[한국어](README.ko.md)

A modern, full-featured Git GUI for VS Code. Visualize your commit history, manage branches, and perform advanced git operations without leaving your editor.

> Staging and committing use VS Code's built-in Source Control. Git Graph+ focuses on everything else.

![Git Graph+ Demo](resources/git-graph-plus.gif)

## Features

### Commit Graph
- Interactive commit graph with branch/merge visualization and color-coded rails
- Click any commit to view details, changed files, and diffs
- Right-click context menus: checkout, cherry-pick, revert, reset, merge, rebase, and more
- Search by message, author, date range, or hash
- Gravatar avatars next to author names
- Resizable bottom panel for commit details

### Branch & Tag Management
- Create, rename, delete, and checkout branches
- Merge (default, no-ff, ff-only, squash) and rebase (including interactive)
- Cherry-pick and revert commits
- Create lightweight and annotated tags
- Push, delete, and manage remote tags

### Remote Operations
- Fetch, pull, and push with remote selection
- Add and remove remotes
- Force push with `--force-with-lease` safety
- Configurable auto-fetch interval
- Remote branch checkout with local tracking branch dialog

### Stash & Worktree
- Save, apply, pop, and drop stashes
- Stash badges in commit graph with dedicated context menu
- Worktree management (list, add, remove, prune)

### Advanced
- Git Flow support (feature, release, hotfix)
- Git Bisect (start, good, bad, reset)
- Git LFS file listing and lock management
- Submodule status, update, and graph switching
- Blame view, reflog viewer, file history
- Repository statistics (commits by author, activity heatmap)
- Pull request creation via GitHub CLI

### Multi-Repository & Submodules
- Auto-discovers submodules within workspace
- Switch between repositories via toolbar dropdown

### Activity Bar Sidebar
- Tree views: Branches, Remotes, Tags, Stashes, Worktrees
- Click to open action menu, right-click for context menu
- Branches sorted: main/master first, then alphabetical

### Internationalization
- English (default) and Korean
- Configurable via `gitGraphPlus.locale` setting
- Git terms (commit, merge, rebase, push, pull, fetch, etc.) remain untranslated

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Open a folder containing a git repository
3. Open Git Graph+:
   - **Command Palette**: `Git Graph+: Open`
   - **Activity Bar**: Click the Git Graph+ icon
   - **SCM title bar** or **Status bar**: Click the git-merge icon

## Settings

| Setting | Default | Description |
| ------- | ------- | ----------- |
| `gitGraphPlus.maxCommits` | `1000` | Maximum commits to load initially |
| `gitGraphPlus.defaultView` | `graph` | Default view (`graph` or `log`) |
| `gitGraphPlus.graphRowHeight` | `28` | Row height in commit graph (px) |
| `gitGraphPlus.autoRefresh` | `true` | Auto-refresh on repository changes |
| `gitGraphPlus.showRemoteBranches` | `true` | Show remote branches in sidebar |
| `gitGraphPlus.confirmForcePush` | `true` | Confirm before force pushing |
| `gitGraphPlus.autoFetch` | `true` | Periodically fetch from remotes |
| `gitGraphPlus.autoFetchInterval` | `10` | Auto-fetch interval (minutes, 1–60) |
| `gitGraphPlus.locale` | `auto` | UI language (`auto`, `en`, `ko`) |

## Requirements

- VS Code 1.85.0 or later
- Git installed and available in PATH
- [GitHub CLI](https://cli.github.com/) (optional, for PR creation)

## Acknowledgements

- Extension icon from [VS Code Codicons](https://github.com/microsoft/vscode-codicons) (`git-merge`), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

## License

[Apache-2.0](LICENSE)
