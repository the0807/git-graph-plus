# Changelog

## 0.2.6 (2026-04-23)

### New Features
- **Graph sort order setting**: Added `gitGraphPlus.graphSortOrder` configuration (`date` / `topological`). Default is `date` (`--date-order`) so commits are sorted chronologically across branches

### Bug Fixes
- **Conflict UI dismissal**: Conflict resolution banner now disappears automatically when a conflict is resolved and committed from the terminal or another UI
- **Root commit diff**: First commit in the repository now correctly shows all added files in the file list
- **Toolbar separators**: Fetch, pull, and push buttons now have separators between them, consistent with the rest of the toolbar

## 0.2.5 (2026-04-22)

### New Features
- **Publish branch button**: Branches with no upstream now show a `cloud-upload` icon (green) in the webview toolbar; clicking it opens the push modal with upstream setup
- **Sidebar buttons open webview modals**: Fetch, pull, and push buttons in the branches view toolbar now open the same confirmation modals as the webview toolbar

### Improvements
- **External conflict detection**: Merge/rebase conflicts triggered from the terminal are now automatically detected and show the conflict resolution UI in the webview
- **Push modal label**: "Create tracking reference" renamed to "Upstream 설정 / Set upstream"
- **Stash badge color**: Stash ref badges in the commit graph changed from purple to gray

## 0.2.4 (2026-04-20)

### New Features
- **Simplified Chinese (zh-cn) localization**: Full UI translation contributed by @baiyibs

### Improvements
- **Diff toolbar fixed on scroll**: File name and inline/side-by-side toggle stay visible when scrolling horizontally
- **Diff horizontal scroll**: Entire diff scrolls as one unit instead of per-line scrollbars
- **Side-by-side diff**: Long lines no longer overlap adjacent panel
- **Bottom panel height**: Now scales with window size (default 35%, min 20%, max 70%)
- **Commit diff load time**: Diff and file list requests run in parallel, reducing latency by ~50%

### Bug Fixes
- **Auth error infinite spinner**: Loading indicator now clears immediately when authentication fails
- **Auth error messaging**: SSH vs HTTPS failures show distinct messages with actionable hints; "Show Error" button exposes raw git output

## 0.2.3 (2026-04-19)

### New Features
- **Checkout keep-changes uses 3-way merge**: "Keep changes and checkout" option now runs `git checkout --merge` so dirty working tree is carried across branch switches via 3-way merge instead of being refused by git

### Improvements
- **Checkout dirty options simplified**: 4 radio options reduced to 3 — "Keep changes and checkout" (merge), "Stash and checkout" (always `-u`), "Discard all changes". Removed the separate tracked-only stash variant to reduce decision fatigue
- **SCM sidebar polish**: Branches view opens expanded by default; pull/push title actions added next to fetch using webview-matching arrow icons; all 5 views (branches, remotes, tags, stashes, worktrees) now declare icons so they render correctly when moved between containers

### Bug Fixes
- **Side-by-side diff syntax highlighting**: Both panes now run through Shiki highlighting (previously only inline mode was highlighted — side-by-side rendered raw text)
- **Hunk headers removed**: Raw unified-diff headers (`@@ -0,0 +1,37 @@`) removed from diff view; replaced with a thin dashed separator between hunks. Line number columns provide position without the visual noise

### Tests
- Added `checkout` option tests covering `--merge`, `--force`, and default invocations (97 tests total)

## 0.2.2 (2026-04-19)

### Security
- **Ref injection hardening**: `GitService.assertSafeRef` rejects empty refs and refs starting with `-` across all methods that forward user input to `git` (checkout, branch ops, merge, rebase, interactiveRebase, cherry-pick, revert, reset, diff, show, tag, ls-tree, format-patch, log, addRemote, setUpstream, bisect, worktreeAdd, pushTag, deleteRemoteBranch/Tag)
- **Path traversal guard**: `getImageBase64` rejects absolute paths and `..` segments
- **Webview HTML escape**: i18n `t()` now escapes parameter values before placeholder substitution; pill markup moved into translation templates. Function replacer avoids `$&`/`$1` pattern interpretation in `replaceAll`

### Bug Fixes
- **View provider dispose leak**: TreeView providers now registered in `context.subscriptions` so their `dispose()` runs on deactivation
- **FileWatcher leak on repo switch**: `MainPanel.switchRepo` removes the stale `FileWatcher` from the disposables array before pushing the replacement
- **Package hygiene**: `.claude/` excluded from `.vsix` so local Claude Code settings no longer ship to the marketplace

### UI/UX
- **Modal text readability**: `.modal-desc` uses `word-break: keep-all` + `overflow-wrap: anywhere` + tighter line-height for natural Korean line wrapping; emphasized phrases no longer break mid-syllable
- **Emphasis class refactor**: Inline `style="color: ..."` replaced with `.modal-emph--danger` / `.modal-emph--info` utility classes across all translations
- **Submenu position fix**: Context submenu wrapped in `position: relative` container so `top: 0` aligns with the trigger row regardless of separators or preceding item count

### Tests
- Added 24 new `GitService` validation tests covering ref rejection (`-foo`, `--hack`, empty) and filePath traversal (94 tests total)

## 0.2.1 (2026-03-24)

### New Features
- **Open worktree in new window**: Checkout blocked modal now offers to open the worktree path in a new VS Code window
- **Checkout stash options**: Added "Stash modified files", "Stash modified + new files", and "Discard all changes" options
- **Remote branch dirty handling**: Remote branch checkout modal includes dirty state options
- **Fast-forward on commit row**: Behind branches show fast-forward modal when checking out from commit row
- **Tag merge**: Tags now have merge option in context menu
- **Diff from compare/working tree**: Double-click files in compare or working tree view to open VS Code diff
- **Push tags to all remotes**: Tag creation pushes to all configured remotes by default

### Improvements
- **Context menu refinement**: Merge only on branch/tag commits, rebase only on non-current-branch, interactive rebase on all
- **Sidebar auto-refresh**: Sidebar tree views update after all git operations
- **Light theme readability**: Darker text colors for warnings, errors, status indicators, pills, and badges
- **Worktree icon**: Updated to codicon-worktree
- **Bottom panel height**: Max height now 70% of viewport (was 600px)

### Bug Fixes
- **Sidebar refresh race condition**: Fixed superseded doFetch preventing tree view updates (fetchId-based check)
- **FileWatcher timer leak**: Cooldown timer now tracked and cleared on dispose
- **Memory: exec() buffer**: Replaced O(n²) string concatenation with Buffer array collection
- **Memory: resize listener**: Fixed potential leak when component unmounts during drag
- **Memory: EventEmitter**: Added dispose() to all view providers
- **Theme detection**: Fixed non-reactive isLight in CommitDetails
- **Process safety**: Added timeouts to predictConflicts (15s) and getImageBase64 (30s/50MB limit)
- **Process safety**: SIGKILL fallback after SIGTERM timeout in exec()
- **Input validation**: Stash index rejects negative/non-integer values
- **Rebase temp file**: Unique filename prevents concurrent rebase collision

### Tests
- Added git-service unit tests (12 tests): stash validation, clean, pushTagToAllRemotes, setExtraEnv, activity log truncation, GitError

## 0.2.0 (2026-03-23)

### New Features
- **Nested git repo discovery**: Auto-detect independent git repos in workspace subfolders (depth 1)
- **Conflict prediction**: Merge/rebase modals show conflict file list via `git merge-tree` before execution
- **Checkout dirty handling**: Unified checkout modal with keep/stash/discard options when uncommitted changes exist
- **Push modal redesign**: Branch → remote pill layout with tracking reference and push-all-tags options
- **Pull modal redesign**: Remote → local branch pill layout with rebase default
- **Stash apply/pop modal**: Shows stash → current branch with kept/deleted highlighting
- **Set upstream modal**: ColorSelect dropdowns for remote and branch selection
- **Worktree checkout guard**: Block checkout on branches used by other worktrees with info modal
- **Open VSX support**: Added Open VSX publishing to release workflow

### Improvements
- **Modal UI unification**: All modals use consistent pill + arrow + codicon layout
- **Color-highlighted warnings**: Destructive action keywords highlighted in red across all modals
- **Radio button options**: Checkout dirty state uses radio buttons instead of multiple buttons
- **Detached HEAD display**: Toolbar shows "(Detached HEAD)" instead of raw ref
- **No-remotes handling**: Push/fetch show error modal with add-remote option when no remotes configured
- **Interactive rebase pill style**: Unified with other modal context cards
- **Branch/tag creation validation**: Block creation when name conflicts with existing branch or tag
- **Bottom panel font sizes**: Increased for better readability, commit body no longer dimmed
- **Graph rail spacing**: Reduced from 14.4px to 12.6px for tighter layout
- **Fetch defaults**: Remote defaults to first remote, prune always on
- **ColorSelect showDot option**: Support dot-free dropdowns for non-color selections
- **Codicon arrows**: Replace HTML arrow entities with codicon icons across all modals
- Remove CLI option names from UI labels

### Bug Fixes
- Fix blue dot (local-only) detection using current branch upstream instead of all remote refs
- Fix remote-ahead BFS to include merged branch commits for gray dot display
- Fix createBranch callback arg order causing `fatal: 'true' is not a commit`
- Fix `--track` only applied for remote branch startPoints, not commit hashes
- Fix `heads/` prefix in branch names when tag/branch names collide
- Fix push using `refs/heads/` refspec to avoid ambiguous ref errors
- Fix merge lines disconnected at remote-tip merge commits
- Fix disabled button appearing active on hover
- Fix secondary button hover using primary button color
- Fix stash with no changes showing no feedback
- Fix clipboard copy showing no feedback
- Fix pull stash-pop failure silently ignored
- Fix auto-open source control sidebar on conflict
- Fix event listener leak in CommitGraph with timed auto-cleanup
- Fix concurrent refreshAll calls with queuing guard
- Fix file watcher losing changes during refresh cooldown
- Fix isDirty detecting untracked files unnecessarily
- Fix hardcoded 'origin' fallback in extension commands
- Add console.warn to empty catch blocks in git-service

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
