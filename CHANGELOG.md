# Changelog

## 0.1.6 (2026-03-21)

### New Features
- **Git Flow UI**: Toolbar dropdown with Initialize, Feature/Release/Hotfix Start and Finish modals
- **Git Bisect UI**: Visual bisect with compare-style commit selection, status banner, and good/bad/skip/reset controls
- **LFS file indicators**: LFS-tracked file badges in commit details with lock/unlock management
- **Search by file**: Find all commits affecting a specific file via context menu "File History"
- **Set upstream**: Set upstream tracking branch from branch context menu
- **maxCommits setting**: Configurable maximum number of commits to load (default 1000)
- **autoRefresh setting**: Toggle auto-refresh on repository file changes
- **Stash graph display**: Stash entries now appear as separate rows in the commit graph, positioned above their parent commit
- **Multiple stash support**: All stashes are displayed individually with `stash@{0}`, `stash@{1}`, etc. labels

### Improvements
- **Image diff**: Improved swipe comparison layout and added image metadata display (dimensions, file size)
- **Stash sidebar redesign**: Stash index shown as label, message as description in lighter text
- **Stash context menu**: Uses actual stash index instead of hardcoded index 0
- **README overhaul**: Updated highlights, added 7 feature screenshots with side-by-side layout
- Remove unused settings (`graphRowHeight`, `defaultView`, `showRemoteBranches`, `confirmForcePush`)

### Bug Fixes
- Fix `git log --all` exposing stash internal commits (`index on main`) in the graph
- Fix stash context menu always operating on `stash@{0}` regardless of which stash was clicked

## 0.1.5 (2026-03-20)

### New Features
- **Dim unmerged branch commits**: Commits not on the current branch are visually dimmed for clarity
- **Search redesign**: Local filtering with result highlighting and Enter/Shift+Enter navigation
- **Toolbar UI overhaul**: Compact repo selector, refined icon sizing, and improved refresh behavior
- **Stash button**: Quick stash save from toolbar with SCM integration

### UI/UX Improvements
- **Centralized modal system**: All modals managed via modalStore for consistent behavior
- **Tree view caching and prefetch**: Sidebar tree views load instantly on first expand
- **Row height and badge styling**: Refined graph row height, remote cloud badges, and fast-forward modal
- **Modal icon consistency**: Unified icon usage across all modal dialogs
- **Unified text styling**: Consistent text rendering across graph and log views

### Bug Fixes
- Fix remote-ahead branches not connecting in graph
- Fix race conditions in data loading and tree view reliability
- Fix search debounce causing missed keystrokes
- Fix checkout flow: simplified logic for local, remote, and detached HEAD cases
- Fix delete branch from stash button and SCM integration issues

### Docs
- Improve README with missing features (3 views, interactive rebase UI, reset modes, diff viewer, image diff, patch export, theme support)
- Update CLAUDE.md with additional architecture details

## 0.1.4 (2026-03-20)

### New Features
- **Activity Bar modal unification**: All Activity Bar actions now route through webview modals instead of native dialogs, with auto-open and modal queueing
- **Worktree support**: Add worktree badge on branch refs, AddWorktreeModal with auto-path, and linked branch delete/cleanup
- **Remote branch management**: Delete remote branches from commit graph context menu and Activity Bar, with confirmation modal
- **Conflict resolution UX**: Per-file "Mark as Resolved", abort confirmation modal, auto-refresh via file watcher, 3-way merge editor default
- **Compare highlights**: Blue left bar on base commit, both commits highlighted during comparison, compareRef tracking in uiStore

### UI/UX Improvements
- **Interactive rebase redesign**: Dropdown action selector with icons/descriptions, context card, move up/down buttons on hover, drop warning banner
- **Toolbar compact mode**: Icon-only Fetch/Pull/Push/Refresh buttons, pull/push badge overlay (yellow behind, green ahead), height 40px → 36px
- **Modal consistency**: 7-char short SHA pill badges, modal-context-card in Reset/CherryPick/Revert, unified Rename Branch modal
- **Smart checkout**: Local branch → confirm modal, remote only → CheckoutRemoteModal, no branch → detached HEAD warning
- **Context menu icons**: git-branch, cloud, tag, archive, folder-opened icons with alphabetical sort within ref types
- **Custom checkbox style**: Transparent unchecked, theme-aware checked (blue/red)
- **Local-only dot filtering**: Blue dot shown only on current branch first-parent line, gray dot only for current branch upstream ahead commits

### Bug Fixes
- Switch from `--date-order` to `--topo-order` for correct graph rendering (like Fork)
- Remove post-parse commit sorting that broke topological order
- Add `--track` to `createAndCheckoutBranch` for automatic upstream setup
- Show remote badge only when upstream is explicitly tracked
- Reduce local/remote dot indicator size (7px → 5px)
- Brighten tag (#f0c040) and stash (#c24de0) badge colors

### Refactoring
- Remove unused `Sidebar.svelte`
- Use single `fullRefresh` message for atomic branchData + logData updates
- Add 60+ i18n keys for new modal and conflict resolution strings
- Add CI concurrency control and improved dependency caching
- Add CHANGELOG link to README (English and Korean)

## 0.1.3 (2026-03-19)

### New Features
- **Commit comparison**: Select a base commit, then click another to see the diff between them
- **Compare to local changes**: Compare any commit against current working tree
- **Conflict resolution UI**: Conflict banner with file list, open in editor, Continue/Abort buttons
- **Local-only commit indicators**: Blue dot for unpushed commits
- **Remote-only commit indicators**: Gray dot for commits only on remote (branch behind)
- **Pull-after-checkout prompt**: Offers to pull when checking out a branch that is behind remote
- **Delete tag from remote**: Option to also delete tag from remote when deleting locally
- **Chronological commit ordering**: Committer date-based sorting like Fork

### UI/UX Improvements
- **Modal redesign**: All 21 modals restyled with Hybrid design (pill badges, arrow indicators, context cards)
- **9 shared modal components**: Extracted duplicated modals into reusable components
- **Custom checkbox styling**: Theme-aware checkboxes (transparent unchecked, blue/red checked)
- **Activity log filtering**: Show user actions only by default, toggle to see all internal commands
- **Stats Gravatar avatars**: Profile images in contributor statistics
- **Stats heatmap improvements**: Larger cells, center alignment, hover effects, legend
- **Compare indicator**: Blue themed floating bar with click-to-compare mode
- **Refresh spinner**: Loading indicator on refresh button
- **Context menu positioning**: Uses actual rendered size for viewport boundary detection
- **Escape to close**: Press Escape to close bottom panel
- **Double-click fix**: Click/double-click discrimination prevents panel flicker
- **Text selection prevention**: Disable text selection on commit rows

### Bug Fixes
- Fix codicon font not loading in packaged extension (.vscodeignore allowlist)
- Fix duplicated "Git Graph+" prefix in status bar tooltip
- Fix merge `ffOnly` option not being passed to git
- Fix rename branch from context menu sending empty name (now opens modal)
- Fix compare feature: add missing `compareCommits` message handler
- Fix `compareToWorking`: use correct response format
- Fix file status detection: use `git diff --name-status` instead of guessing from additions/deletions
- Fix remote-only detection when commits are reachable from other merged branches (per-branch ancestor BFS)
- Fix modal options not resetting when reopening (reset, cherry-pick, revert)
- Fix shared modal button alignment (global CSS for `form-actions` and `danger-btn`)
- Fix error messages: show stderr only instead of full git command string

### Refactoring
- Extract 9 shared modal components to `webview-ui/src/components/modals/`
- Add 36+ i18n keys for previously hardcoded modal strings
- Remove unused features: blame view, reflog viewer, file history, PR creation (backend only, no UI)
- Upstream tracking-based local/remote branch matching (with name fallback)
- Separate `GraphDot` localOnly/remoteTip flags from type for correct combined states
- Auto-stage resolved files before continue operation (`git add -A`)
- Clean up unused state variables, functions, imports, and CSS

## 0.1.2 (2026-03-18)

### Bug Fixes
- Fix context menu "Create Tag" sending empty tag name (exit 128 error)
- Fix context menu "Create Branch" sending empty branch name

### Improvements
- Add Fork-style Create Tag modal with commit info, textarea message, and "Push to all remotes" option
- Add Fork-style Create Branch modal with commit info, and "Check out after create" option
- Dynamic button labels: "Create and Push" / "Create and Checkout" based on options

## 0.1.1 (2026-03-17)

### Changes
- Rename display name to "Git Graph Plus"
- Add marketplace categories and keywords
- Add .vscodeignore for optimized package size
- Add CI/CD workflows (build/test on push, release on tag)
- Add demo GIF and marketplace badge to README
- Restrict release workflow to main branch only

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
