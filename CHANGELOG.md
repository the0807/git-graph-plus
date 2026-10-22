# Changelog

## 0.7.5 (2026-10-21)

### Bug Fixes
- **Fully Merged Branch Detection** - Stream patches directly into `git patch-id` instead of buffering complete history and diffs, avoiding the 256 MiB output-limit warning on large repositories while preserving squash-merge and cherry-pick detection.

## 0.7.3 (2026-06-30)

### Bug Fixes
- **Graph Lane Colors** - When a graph has more concurrent lanes than the 12-color palette, the overflow lanes now keep cycling through the palette instead of all collapsing to the same blue.

## 0.7.2 (2026-06-30)

### New Features
- **Branch Toolbar** - A Fork-style split button on the toolbar creates a branch (or worktree) seeded from the current branch, with Lean Sync (rebase the current branch onto the default branch), Lean Finish (merge it into the default branch), and a nested Git Flow menu.
- **File Path Actions** - Right-click a changed file to reveal it in the OS file explorer, copy its absolute path, or copy its repo-relative path.
- **Classic Interactive Rebase** - A new `gitGraphPlus.interactiveRebase.mode` setting can run `git rebase -i` in an integrated terminal using your own Git editor, instead of the visual modal.
- **Keyboard-Driven Rebase Modal** - The interactive rebase modal is now keyboard-navigable and wider for easier editing.
- **Smarter Range Selection** - Shift-clicking in the graph seeds the range from the current branch tip when nothing is selected yet.

### Bug Fixes
- **Detached HEAD Display** - While detached, rebasing, or bisecting, the toolbar badge and commit-row menus now show the short HEAD SHA (with a commit icon) and the full SHA in the tooltip, instead of git's raw "(no branch, ...)" label.
- **Fixup / Squash Scope** - Fixup and squash actions are now hidden for commits that aren't on the current branch, where they wouldn't apply.
- **Added / Deleted File Diffs** - Opening changes for an added or deleted file now works via an empty-tree fallback instead of failing.
- **Selection Persistence** - The commit selection and row outline are kept while context-menu modals are open.

## 0.7.1 (2026-06-27)

### Performance
- **Leaner Refreshes** - Editing files now triggers a log-only partial refresh instead of reloading branches, tags, remotes, stashes, and worktrees, and the sidebar watcher no longer duplicates the graph panel's refresh work. A redundant full refresh on every file save was also removed (the file watcher already covers it, and refreshing now respects the `autoRefresh` setting).
- **Smoother Graph Scrolling** - Scroll handling is coalesced to one update per frame, removing jank when scrolling large graphs on high-refresh displays.
- **Faster Search** - Search precomputes per-commit text once, so each keystroke no longer rebuilds the entire search haystack.
- **Lighter Diff & Stats Rendering** - The uncommitted staged/unstaged file trees are memoized instead of rebuilt on every interaction, syntax highlighting is bounded to the visible diff, the commit-activity heatmap uses O(1) cell lookups, and HEAD/branch lookups are memoized.

### Bug Fixes
- **Non-ASCII Filenames** - Files with Korean or other non-ASCII names now open their diff correctly instead of showing escaped, unclickable paths, and they are reported correctly in merge/rebase conflict prediction.
- **Uncommitted Image Diff** - Images with uncommitted changes now show a proper before/after comparison instead of "No image".
- **Stash Rename Safety** - If renaming a stash fails partway through, the stash is restored instead of being lost as a dangling commit.
- **Multi-Commit Cherry-Pick** - Cherry-picking three or more selected commits no longer silently fails to dispatch.
- **Interactive Rebase Squash Messages** - Reordering a squash group no longer discards a manually edited combined commit message.
- **Amend Modal Escape** - Pressing Esc to close the Amend modal no longer also clears the current commit/file selection.
- **Reset Modal** - A settings change while the Reset modal is open no longer resets the mode you just selected.
- **Network Timeouts** - Fetch, pull, and push now run on a 10-minute timeout, so a large first fetch or a slow connection is no longer terminated at 60 seconds.
- **Extension Stability** - A patch operation that git rejected early could crash the extension host (EPIPE); this is now handled safely. Diff-panel hover timers and a stale image-decode race when switching files quickly were also cleaned up.
- **File Watcher Accuracy** - Sibling paths like `refspec` or `worktrees-backup` no longer trigger spurious graph refreshes.
- **Sidebar Current Branch** - The sidebar reliably reveals the current branch after a refresh instead of occasionally acting on stale data.
- **File Tree Icons** - Folder and file icons in the file-tree browser render as icons rather than literal text.
- **Markdown Link Safety** - Non-http(s) link schemes in commit messages are no longer placed in the DOM, hardening middle-click and keyboard "open in new tab".
- **Path & Error Handling** - File operations reject Windows absolute paths, deleting a tag reports every failing remote (not just the first), and a timed-out command is no longer double-logged.
- **Graph Rendering** - Trailing branch lines at the bottom of the graph end straight down on their own lane instead of bending sideways.

## 0.7.0 (2026-06-27)

### New Features
- **Markdown Commit Messages** - Commit messages containing Markdown now render formatted in the Commit Details panel. Messages with Markdown default to the rendered view and offer a Markdown/Plain toggle (applied per commit); plain messages stay as-is. Rendering is token-based for XSS safety, and links/images open externally through an http(s) scheme guard.
- **Create Fixup Commit** - A "Create Fixup Commit" context-menu action commits your staged changes as a `fixup!` of the selected commit - no more copying a hash and running `git commit --fixup` by hand. Like Amend, it opens the SCM view to stage first and confirms with a live staged-file count.
- **Create Squash Commit** - A companion "Create Squash Commit" action commits staged changes as a `squash!` of the selected commit, with the generated commit message previewed in the modal.
- **Interactive Rebase Autosquash** - The interactive rebase modal gained an Autosquash toggle. When `fixup!`/`squash!` commits are present it is on by default and arranges them under their targets; turning it off restores the loaded order. The modal stays a preview until "Start Rebase".
- **Multi-Select Interactive Rebase** - Select a contiguous range of commits in the graph and start an interactive rebase straight from the selection menu. It resolves the containing branch, checks it out (offering stash/discard for a dirty tree, or a branch picker when several qualify), then opens the rebase editor.
- **Multi-Commit Comparison Panel** - The multi-select menu now has a "View Changes" / "Hide Changes" toggle that opens a combined diff panel for the selected commits, with Esc closing the panel before clearing the selection.
- **Jump to HEAD** - A location button beside the search box scrolls the graph to the current HEAD commit (emphasized only when HEAD is off-screen), and typing `HEAD` in search now navigates to it.
- **Configurable Commit Counts** - New `gitGraphPlus.initialCommitCount` (default 200) and `gitGraphPlus.loadMoreCommitCount` (default 50) settings control how many commits load on first render and per "Load more commits" click - lower the initial count for faster loads in huge repositories.
- **Open Settings Button** - A gear button at the far right of the toolbar opens VS Code Settings pre-filtered to this extension.

### Improvements
- **Commit Context Menu Regrouped** - Amend and Create Fixup/Squash Commit are now grouped as staged-change edits, Save Patch moved into the Export/Copy group, and Bisect actions merged into the compare/inspect group. The toolbar's right-side icons were also reordered for a clearer layout.

### Bug Fixes
- **Stash Connection** - Stashes whose original branch was rebased or deleted no longer float orphaned in the graph; their base commit is walked back into the main tree so the badge reconnects to history (#52).
- **Markdown-Diff Tools** - The commit parent is now resolved to a full SHA before launching external diff tools, fixing diffs for Markdown-based tools (#51).
- **Commit Details Scrolling** - Commit details stay scrollable on short viewports instead of clipping content.
- **Esc in Diff View** - Pressing Esc now unhighlights expanded folders and deselects the active file as expected.
- **Tooltip Stacking** - Only one tooltip shows when hovering nested elements.

## 0.6.0 (2026-06-25)

### New Features
- **Reverse Changes** - Undo a commit's changes against your working tree straight from the diff viewer: reverse a whole file, a single hunk, or just gutter-selected lines - added and deleted files included - and copy selected diff lines.
- **Commit Message Links** - Issue, PR, and merge-request references in commit messages become clickable links across the Graph, Commit Details, and Reflog views. GitHub/GitLab references are auto-detected from the `origin` remote (`gitGraphPlus.autoDetectRepoLinks`), and you can add your own regex rules (`gitGraphPlus.commitMessageLinks`). Links open in your browser.
- **Commit Graph Keyboard Navigation** - Move the graph selection with the arrow keys; Ctrl/Cmd jumps to the first parent (down) or newest child (up) and remembers the path, so reversing a jump returns you to where you came from.
- **Stash Uncommitted Changes** - The uncommitted-changes node now offers a stash option in its context menu, so you can stash your working changes without leaving the graph.
- **Single-Remote Auto Fetch** - When a repository has only one remote, fetching skips the remote-selection dialog and fetches (with prune) directly, since there is nothing to choose.

### Bug Fixes
- **Markdown & Custom Diff Tools** - The diff viewer now uses the standard `git:` URI scheme, so markdown and other custom diff tools render the diff correctly instead of showing raw content.
- **Reflog SHA Overflow** - A long SHA in the Reflog view is now clipped instead of overflowing and overlapping the adjacent column.
- **Tooltip on Drag** - Tooltips are now dismissed when a native drag starts, instead of lingering over the item being dragged.

## 0.5.5 (2026-06-25)

### New Features
- **Drag to Rebase & Merge** - Drag one branch onto another directly in the graph to rebase it onto, or merge it into, the target branch - no commands or dialogs needed.
- **Configurable Git Command Timeout** - A new `gitGraphPlus.timeout` setting controls how long to wait for a Git command before it is aborted (default 60s). Raise it if the graph times out while loading in a very large repository.

### Bug Fixes
- **Stash Diff Scope** - The diff view for a stash entry now shows only that stash's own changes, instead of also including unrelated changes from the working tree.
- **Rebase & Squash Notification** - You are now notified after squashing commits or completing an interactive rebase, instead of the operation finishing silently.

## 0.5.4 (2026-06-23)

### New Features
- **Squash & Cherry-pick Multiple Commits** - Select consecutive commits directly in the graph (Shift-click for a range, Ctrl/Cmd-click to toggle), then right-click the selection to squash them into one or cherry-pick them all at once. Squashing opens a dialog to edit the combined commit message and warns when a force push will be required.

### Bug Fixes
- **Chrome Network Stall Fix** - Commit author avatars are now fetched and cached in the extension host and shared across windows, instead of loading from gravatar.com in each webview. This prevents the socket exhaustion that could leave Chrome unable to load pages after extended use with multiple windows.

## 0.5.3 (2026-06-21)

### New Features
- **Branch Colors by Pattern** - Assign fixed colors to branches by name pattern (`gitGraphPlus.branchColors`), so important branches always stand out in the graph. The first matching rule wins; branches matching no rule keep an automatic color.
- **Commit Signature Status** - Show GPG/SSH signature verification status next to each commit in the graph (`gitGraphPlus.showSignatureStatus`). The Commit Details panel always shows it on demand regardless of the setting.
- **Custom Graph Color Palette** - Customize the colors auto-assigned to graph rails with your own list of hex colors (`gitGraphPlus.graphColors`), defaulting to the built-in 12-color palette.

### Bug Fixes
- **Branch Color on All Nodes** - A pattern-colored branch now recolors every commit node on its rail, not just the rail line. Previously, commit nodes above the matching branch tip kept the default color while the line was recolored.

## 0.5.2 (2026-06-15)

### New Features
- **New Worktree from the Graph** - Create a worktree straight from the commit graph: a "New Worktree" entry on a branch's context menu and in the commit's "Create" group opens the Add Worktree dialog with the picked branch pre-filled as the start point (which you can still change before confirming).
- **Worktree from an Existing Branch** - When adding a worktree you can now check out an existing branch instead of always creating a new one. Branches already checked out in another worktree are filtered out, and default worktree paths are cleaner.

## 0.5.1 (2026-06-14)

### New Features
- **Worktree Open & Reveal** - Open a worktree in a new VS Code window (or just click it in the sidebar), and reveal it in the file explorer, from the Worktrees view's context menu.

### Improvements
- **Localized Worktree Commands** - The "Open Worktree" and "Open in File Explorer" actions are now translated for Korean and Chinese.
- **Consistent Graph Fonts** - Unified the monospace and header fonts in the commit graph so the SHA column and column headers render consistently.

### Bug Fixes
- **Interactive Rebase in Submodules** - Interactive rebase no longer fails with an ENOTDIR error in submodules and linked worktrees, and the paused-state banner now appears correctly.
- **Branch Badge Icons** - Only the current-branch check mark stays bold; the cloud and other badge icons now render at their normal weight.

## 0.5.0 (2026-06-10)

### New Features
- **Accessible Branch Badges** - Branch badges now carry their color in a solid left accent bar over a neutral fill, with a configurable thickness (`gitGraphPlus.branchBadgeBarThickness`), keeping branch colors legible for color vision deficiency.
- **Partial Stash Restore** - Restore only selected files or folders from a stash instead of the whole stash.
- **Folder Multi-Select** - Ctrl/Cmd-click a folder in a commit's file list to select every file within it.
- **Create Patch from Selection** - Generate a patch file from the selected commit files or folders.
- **Multi-Commit Selection & Compare** - Unified multi-commit selection with compare and per-commit diffs.
- **Configurable Modal Defaults** - Set default options for operation dialogs (push, pull, merge, rebase, and more), including optional follow-up push or cleanup after the operation.
- **Push After Rebase** - Optionally push the branch automatically after a successful rebase.

### Performance
- **Faster Commit Selection** - Reduced the click debounce to 150ms so commit details load more quickly.

### Bug Fixes
- **Multi-Line Rebase Messages** - Interactive rebase reword and squash now preserve the full multi-line commit message instead of just the subject.
- **Repository Dropdown** - Canonicalized repository paths so the dropdown stays in sync, and widened it to fit long names without wrapping.
- **Graph Isolation** - Unrelated commit graphs no longer paint over the active repository.
- **Rebase Conflict Prediction** - More accurate conflict prediction by chaining commits.
- **Delete Remote Tags** - Tags are now deleted from all remotes, not just origin.
- **Interactive Rebase on Windows** - Fixed a failure caused by cmd-shell syntax.
- **Ref Badge Focus Outline** - Removed an unwanted focus outline on ref badges after pressing Esc.

## 0.4.3 (2026-05-31)

### New Features
- **Conflict File Preview** - Merge and rebase modals now list the files predicted to conflict when you hover over the action, so you can spot trouble before running the operation.

### Bug Fixes
- **Git Error Messages** - Failed git operations now surface the remote-provided cause, explaining what actually went wrong.
- **Hover Tooltips** - Tooltips no longer cover the context menu or the color-select dropdown while either is open.

## 0.4.2 (2026-05-24)

### New Features
- **Fast-Forward Without Checkout** - You can now fast-forward a non-current branch up to its upstream without switching to it.
- **Wide Graph Horizontal Scrolling** - Commit graphs with many concurrent branches now scroll horizontally, with the author, SHA, and date columns pinned to the right.
- **Graph Auto-Pan** - As you scroll vertically, the graph pans horizontally to keep the start of the commit message in view.

### Improvements
- **Diff Syntax Highlighting** - Highlighting now follows your VS Code light/dark theme and covers many more languages (Svelte, Vue, Ruby, PHP, SCSS, Kotlin, Swift, C#, TOML, XML, and more) instead of falling back to plain text.
- **Loading Feedback** - Changing filters, refreshing, and pressing Ctrl+R now show a loading state while the graph reloads.

### Performance
- **Faster Rebase Conflict Preview** - The rebase conflict predictor now probes commits in parallel, cutting preview latency on multi-commit branches.
- **Large Diffs** - Very large diffs are now capped with an opt-in "show full diff" button so opening them no longer freezes the panel.
- **Large Repositories** - Faster commit graph rendering and initial load.
- **On-Demand Syntax Grammars** - Diff highlighting grammars load only when a file needs them, keeping the panel light.

### Bug Fixes
- **Load More Button** - Stays in view while the graph is scrolled horizontally.
- **Auto-Refresh** - The graph now refreshes on working-tree changes, and rapid file selections no longer overwrite each other's diffs.

## 0.4.1 (2026-05-21)

### Improvements
- **Modal Polish** - Spaced out the amend modal's option checkboxes, kept the message field scrollable when keeping a long message, centered the checkbox tick, and made the "no conflict" / "staged" status checkmarks a touch bolder.

### Bug Fixes
- **Large Repository Rendering** - The commit graph no longer pushes commit messages off screen or overlaps the SHA and date columns in repositories with many concurrent branches.
- **Custom Git Path** - The extension now honors the VS Code `git.path` setting, so it works when Git is not on the system `PATH` (e.g. portable or MSYS2 installs).
- **Compare View Diffs** - Clicking a file while comparing two commits (or comparing to the working tree) now shows its diff again.
- **Git LFS Warning** - Stopped showing a spurious warning when Git LFS is not installed.

## 0.4.0 (2026-05-20)

### New Features
- **Amend from Graph** - You can now amend the last commit directly from the graph's context menu or keyboard shortcuts.
- **SCM Integration for Uncommitted Changes** - Clicking the uncommitted-changes row (or the new tooltip) now automatically opens the VS Code Source Control view.
- **Rebase Conflict Prediction Limits** - The rebase conflict predictor now surfaces a 20-commit cap when the topic branch has deep history, keeping the UI responsive while providing useful feedback.

### Improvements
- **Fast-Forward Autostash** - Automatic stash popping now works correctly for fast-forward merges, matching standard pull semantics.
- **Stash and Checkout Behavior** - The 'stash and checkout' flow now correctly sets changes aside instead of carrying them over to the target branch.
- **Interactive SCM State** - Double-clicking and using the context menu on uncommitted change files is now supported.
- **Enhanced i18n** - Routed remaining hardcoded English tooltips, modal labels, and CommitDetails labels through the translation system.

### Performance
- **Unified Graph Layout** - Graph layout is now computed once per refresh, significantly reducing CPU usage on large repositories.
- **Shared Reachability Index** - Hash indices are now shared across graph reachability passes, speeding up branch/tag/stash association by up to 30%.
- **Deduplicated Data Fetching** - In-flight fetches for branches, tags, remotes, and worktrees are now deduplicated, preventing redundant git calls during rapid UI interaction.
- **Optimized Highlighting** - Large file diffs are now highlighted in chunks to maintain UI responsiveness during scroll.

### Bug Fixes
- **Improved Diff Parsing** - Diff headers and path resolution are now more robust, correctly handling `+++`/`---` lines and trailing newlines.
- **Pagination Reliability** - Fixed duplication of the UNCOMMITTED and stash rows when navigating paginated log pages.
- **Git-Flow Stability** - Hardened git-flow inputs and guarded against race conditions during diff generation.
- **Worktree Support** - Fixed conflict marker probing and gitdir resolution when working inside linked git worktrees.
- **Search Robustness** - Search handlers are now guarded with sequence counters to prevent stale results from overwriting newer queries.
- **Commit Stats Alignment** - Commit stats are now binned by the author's local time instead of the host's time.
- **Security Hardening** - Improved validation for webview-supplied paths and git payloads.
- (Plus over 20 other stability and correctness improvements)

## 0.3.12 (2026-05-17)

### Improvements
- **Stricter Git Input Validation** - File paths and search inputs are now validated against git's own rules before being passed to the CLI, preventing malformed names (paths starting with `-`, control characters in search queries, file:// remote URLs without scheme allowlist) from being misinterpreted
- **Branch/Tag Name Checks** - Names are now rejected if any slash-separated component is empty, starts with `.`, or ends with `.lock` — matching `git check-ref-format` more closely

### Bug Fixes
- **Interactive Rebase: Reword in Squash Groups** - A reword target followed by squash/fixup now honors the typed final message instead of git's combined-message default
- **Interactive Rebase: Fixup-only Group Message** - Edited target message is no longer silently dropped in fixup-only groups
- **Interactive Rebase: Order-only Changes** - The "Start Rebase" button is now enabled when only commit order has changed
- **Rebase Pause No Longer Shows Error Dialog** - When `edit` step or a conflict pauses the rebase, the redundant error dialog on top of the banner is gone — the banner alone guides next steps
- **Modals Stay Open After Operation Fails** - Failed operations now close the modal that triggered them instead of leaving it sitting open in a stale state
- **Tooltip Escape Inside Modals** - The Escape key now dismisses tooltips even when focus is trapped inside a modal
- **Closing the Panel During a Long Operation** - Closing the Git Graph+ panel while a long git operation is in flight no longer triggers errors when the result tries to post back to the (now-gone) webview
- **Sidebar Auto-refresh Overlap** - Rapid file watcher events can no longer trigger overlapping refreshes that produced inconsistent sidebar state
- **LFS Warning Noise** - Warnings for known-harmless LFS configurations (file:// remote, missing lock server) are suppressed while real failures are still surfaced
- **Windows Repo Paths with Special Characters** - Interactive rebase now works correctly when the repository path contains `&`, `|`, `%`, parentheses, etc.
- **Conflict Banner Localization** - "Merge/Rebase/Revert/Cherry-Pick Conflict" labels and the "Abort" button are now translated in Korean and Chinese

## 0.3.11 (2026-05-17)

### New Features
- **VS Code Credential Prompt on Remote Auth Failure** - When fetch/pull/push fails due to missing or invalid HTTP credentials, Git Graph+ now drives VS Code's built-in credential prompt and retries the command once

### Performance
- **Graph Rendering** - Additional speedups in commit graph rendering hot paths

### Bug Fixes
- **Phantom Rebase State** - Status banner no longer falsely reports a rebase as in progress when `REBASE_HEAD` is left behind after `rebase --continue` succeeds; the rebase state directory is now the canonical marker
- **Nested Git Repositories** - Untracked entries that are nested git repos (not registered as submodules) are now expanded and labeled distinctly instead of showing as an empty diff

## 0.3.10 (2026-05-17)

### New Features
- **Uncommitted Changes Node** - Shows pending uncommitted changes as a virtual node at the top of the commit graph; click to view staged and unstaged diffs in the details panel
- **Copy Short SHA** - New "Copy Short SHA" context menu item on the commit graph

### Improvements
- **Operation Notifications** - Added completion notifications for Delete Remote Branch, Add/Remove Remote, Drop Stash, and Add/Remove Worktree
- **Short SHA in Messages** - Notification messages for rebase, reset, and detached HEAD checkout now show the short (7-char) SHA

### Performance
- **Graph Traversal Speed** - Replaced O(n²) BFS queue with an O(n) index-pointer approach in hot paths, significantly improving rendering on large repositories
- **Diff Syntax Highlighting** - Switched to synchronous highlighting after init, capped at 5,000 lines, and guarded against stale renders when the selected diff changes mid-render
- **Repo Discovery Timeout** - Added 15-second timeout guard to prevent hangs during repository discovery on slow disks

### Bug Fixes
- **Branch Selection Modal** - Fixed missing modal when double-clicking a commit shared by multiple local branches; now shows a dropdown to select the target branch

## 0.3.9 (2026-05-13)

### Bug Fixes
- **Conflict Prediction Accuracy** - Improved conflict prediction for rebase, cherry-pick, and revert operations
- **Fast-forward Notification Order** - Fixed notification order bug in fast-forward that could cause inconsistent state

## 0.3.8 (2026-05-13)

### New Features
- **Resizable File List Panel** - Drag the divider between the file list and diff viewer in the commit details panel to adjust their relative widths (min 120px, max 480px)

### Improvements
- **Ref Badge Icon Alignment** - Fixed vertical alignment of cloud and tag icons in REFS badges in the commit details panel

### Bug Fixes
- **Filter Preservation on Refresh** - Branch and author filters are now correctly preserved across both manual and auto refresh
- **Filter Persistence on Reopen** - Branch and author filters are now correctly restored when the webview panel is closed and reopened

## 0.3.7 (2026-05-12)

### New Features
- **Commit Preview Hover Card** - View commit details by hovering over parent links in the commit details panel
- **Synchronized Diff Scrolling** - Side-by-side diff panes now scroll together for easier comparison

### Improvements
- **Refined Commit Details UI** - Modernized layout with a dedicated card for the commit message, circular avatars, and cleaner metadata display
- **SHA Copy Shortcuts** - Added dedicated buttons to copy both full and short (7-char) SHA hashes in the commit details panel
- **Enhanced Ref Badges** - Consistent badge styling across all reference types for better visual unity
- **Relative UI Scaling** - Switched to relative units (em) for panel buttons to improve theme and font-size compatibility

### Performance
- **Lazy Loading Diffs** - Improved popup responsiveness by implementing lazy loading for commit diff data

### Bug Fixes
- **Type Safety** - Fixed latent TypeScript errors in the message bus and main panel message routing
- **Fullscreen Reset** - Fullscreen state now correctly resets when closing the bottom panel via the Escape key
- **Tooltip Reliability** - Fixed an issue where tooltips could get stuck when a button becomes disabled
- **UI Layout Fixes** - Widen date column, fixed i18n filter tooltips, and moved status bar for better visibility

## 0.3.6 (2026-05-10)

### New Features
- **Branch Filter Dropdown** - Filter the commit graph to show only commits reachable from a selected branch
- **Editor Title Bar Icon** - "Open Git Graph" icon added to the editor title bar for quick access
- **Open File / Open Changes** - Right-click any file in the commit diff viewer to open it or view its changes directly in VS Code

### Improvements
- **Squash Merge** - Auto-commits on success; shows conflict resolution UI when conflicts are detected
- **Graph Rail Colors** - Rail colors assigned by lowest available index (Fork-style) for consistent branch coloring
- **VS Code Notifications** - Success toasts for git operations use native VS Code notifications
- **Toolbar Badge Visibility** - Improved contrast for ahead/behind badges and the unpublished branch icon
- **CommitDetails Font Sizes** - Relative font sizes in the commit details panel for better theme compatibility
- **Search Label** - "All branches" filter label shortened to "All"

### Bug Fixes
- **Git Flow Button** - Git Flow toolbar button is now disabled during loading/operating state, consistent with other toolbar buttons
- **Fast-forward Modal** - Skip the fast-forward confirmation when double-clicking the local branch badge on the current branch
- **Checkout Modal** - Show branch pill only (no commit pill) when checking out a branch with no upstream
- **Modal Input Reset** - Branch rename and stash save modals now reset their input fields when reopened
- **Sidebar JSON Error** - Fixed circular structure to JSON error in sidebar; added missing message handlers

## 0.3.5 (2026-05-07)

### Improvements
- **Banner UI** - Unified all status banners (error, conflict, rebase-pause, bisect) to a consistent card style with rounded corners, margin, and smooth slide-in transitions
- **Conflict Banner** - Replaced the "C" text badge on unresolved files with a proper warning icon; action buttons now use a shared global style
- **Rebase Pause Banner** - Localized the hardcoded English message and buttons (Korean, Chinese Simplified)
- **Error Display** - Error messages now render newlines correctly when multiple conflict files are listed

### Bug Fixes
- **Multi-repo Workspace** - Fixed sidebar and webview falling out of sync when switching repositories in a multi-repo workspace
- **Non-Git Folder** - Opening Git Graph+ in a folder without a Git repository now shows a clear "not a Git repository" message instead of a raw fatal error
- **Error Bar** - Loading spinner no longer stays active after an error occurs; error messages from git are now cleaned up (prefix stripping, hint line filtering, remote error priority)
- **Webview Startup** - Fixed "command not found" error when opening the extension with no workspace folder open

## 0.3.4 (2026-05-06)

### Improvements
- **Tooltip System** — Replaced unreliable native `title=` tooltips with a custom JS-based tooltip action across all UI elements (toolbar, graph, modals, reflog, search, and more)
- **Tooltip UX** — Tooltips now follow the mouse cursor, appear after a short delay, and automatically flip position when near viewport edges to avoid clipping
- **Modal Pill Truncation** — Branch name pills in modal dialogs now truncate with ellipsis when names are too long, with equal max-width distribution between source and target
- **Context Menu** — Submenus now adjust vertical position automatically when they would overflow the bottom of the viewport

### Bug Fixes
- **Multi-repo in Non-Git Root** — Fixed extension not activating correctly when the workspace root is not a Git repository; now auto-discovers and switches to the first valid Git repo on startup (closes #9)
- **Reflog Dangling Icon** — Fixed vertical alignment of the warning icon in Reflog dangling commit rows
- **Reflog Tooltip Overlap** — Dangling tooltip moved from the entire row to the warning icon to prevent double tooltip when hovering the message column
- **Interactive Rebase Pills** — Fixed missing ellipsis truncation on branch name pills in the Interactive Rebase modal
- **worktreePrune** — Fixed incorrect method name call in the worktree prune command handler

## 0.3.3 (2026-05-05)

### New Features
- **Reflog Sub-action Column** — Added a dedicated column for detailed Git operations like `amend`, `squash`, `cherry-pick`, and `rebase` stages
- **Semantic Color Grouping** — Reflog sub-actions are now color-coded by intent (Edit: Orange, Combine: Purple, Integrate: Cyan, Flow: Grey, Abort: Red)
- **Recursive Submodule Discovery** — Auto-detect submodules recursively using `git submodule status --recursive` for better workspace coverage
- **Precision Repo Verification** — Improved nested repository detection using `git rev-parse` to accurately identify independent Git roots

### Improvements
- **Responsive Typography** — Reflog and Graph views now adapt to VS Code's global font size and family settings
- **Multi-repo Sync** — Sidebar views and commands now automatically synchronize when switching between repositories via the toolbar
- **Contextual Initialization** — Automatically opens the repository associated with the active text editor on startup
- **Reflog Layout** — Headers are now sticky and aligned perfectly with rows regardless of scrollbar visibility
- **Repository Naming** — Improved de-duplication for repositories with the same folder name by prepending parent path segments
- **Action Filters** — Added `revert` to the Reflog action filter and fixed various truncation issues for long action names
- **Repository Icons** — Distinct icons added for Root, Nested, and Submodule repository types in the selector
- **Sidebar UX** — Branch folders now automatically expand to reveal the currently checked-out branch

### Bug Fixes
- **Row Alignment** — Fixed an issue where dangling commit indicators would shift row content or appear clipped at the bottom
- **Svelte Reactivity** — Fixed a reactivity warning in the Reset Modal when using Svelte 5 runes

## 0.3.2 (2026-05-03)

### New Features
- **Reflog Pagination** — Added "Load more" button to the Reflog tab (200 entries per page) to improve performance
- **Reflog Reset Default** — Default reset mode in Reflog context menu set to "Hard" for faster recovery

### Improvements
- **UI Consistency** — Unified filter dropdown styles between SearchBar and Reflog

### Bug Fixes
- **Comparison Data** — Fixed missing commit hash in `compareToWorking` and `compareCommits` responses

## 0.3.1 (2026-05-03)

### New Features
- **Reflog search** — Real-time filtering by message or hash directly in the Reflog tab
- **Reflog filter dropdowns** — Separate dropdowns for Ref (HEAD or any branch) and Action type (commit, checkout, reset, rebase, merge, etc.)
- **Per-branch reflog** — Switch the Reflog view to any local branch to see only that branch's ref movements
- **Dangling commit detection** — Reflog entries unreachable from any branch are highlighted with a warning icon and tooltip; recoverable via Reset

### Improvements
- Reflog dangling-only toggle button filters to only dangling entries at a glance
- Match count shown in search bar when filters are active (even without a text query)
- Reflog list scrolling fixed — wrapper layout now correctly constrains the scrollable area
- Various UI polish across Modal, Toolbar, CommitGraph, SearchBar, BisectBanner, and other components

## 0.3.0 (2026-05-02)

### New Features
- **Reflog tab** — Browse the full git reference log with action type (colored dot + label), description, SHA, and elapsed time columns
- **Reflog context menu** — Reset to `HEAD@{N}`, Checkout Commit, Copy SHA directly from any reflog entry
- **Shared modals** — Reset and Checkout Commit modals are now shared between the Graph and Reflog tabs

### Improvements
- Interactive rebase: squash and fixup now prompt for a final commit message inline; edit-pause mode pauses rebase for amending
- Search now matches branch names and tag names in addition to commit messages, authors, and hashes
- Column header font sizes unified across Graph and Reflog (header 11px, row 13px)

### Performance
- CommitGraph: SVG paths, links, and dots now filtered to the visible scroll range — avoids rendering thousands of off-screen elements
- CommitGraph: timed message handlers now tracked with a type-safe `Map` instead of property injection on function objects
- MainPanel: `getLog` requests are now sequenced — stale responses from rapid filter changes are discarded
- git-service: remote name cache is immediately invalidated after `addRemote`/`removeRemote`

### Bug Fixes
- Modal: guard against duplicate `onClose` calls from rapid Escape keypresses
- Suppress expected `rev-parse` failures (MERGE_HEAD, REBASE_HEAD probes) from the activity log on clean repos

## 0.2.11 (2026-04-29)

### New Features
- Copy Commit Info menu item — copies short hash and subject (e.g. `c2e5e67 - fix: some message`)
- Fullscreen expand and close buttons in the commit details panel
- Git Flow finish items now grouped into submenus by type (Feature / Release / Hotfix)

### Improvements
- Commit graph tab renamed from "History" to "Graph"
- Context menu labels corrected: "Checkout Commit", "Cherry-Pick Commit", "Revert Commit"
- "Create Branch Here" renamed to "New Branch"
- Context submenus now flip left automatically when near the right edge of the viewport
- Tab buttons in commit details panel are now flat (no rounded corners)

### Bug Fixes
- Pill badges in modals no longer truncate from the wrong side — switched from `direction: rtl` to standard LTR ellipsis
- Full name tooltip added to all pill badges on hover
- Toolbar project and branch name labels now truncate correctly

## 0.2.10 (2026-04-28)

### Bug Fixes
- Tag body text now displays correctly in the tag details modal
- Search bar no longer triggers double execution on Enter key press
- Submenu alignment and chevron positioning corrected
- Checkbox, filter button, pill truncation, and conflict banner UI polished

## 0.2.9 (2026-04-26)

### New Features
- **Remote source filter**: Filter the commit graph by remote source (closes #5)
- **Conflict prediction for cherry-pick and revert**: Modals now check for conflicts before executing, matching the existing merge/rebase behavior
- **Tag duplicate warning**: Creating a tag with an already-existing name now shows a warning and disables the create button

### Improvements
- **Set upstream modal UX**: Improved layout and interaction flow for the set upstream modal
- **Conflict status labels**: Merge, rebase, cherry-pick, and revert conflict status messages now include the operation name for clarity
- **Conflict status font size**: Conflict status text in action modals aligned to 12px to match button text
- **Remote-ahead commits**: Commits that exist only on the remote are now visually dimmed to distinguish them from local commits

### Performance
- Replace `Array.includes()` with `Set.has()` in graph color recycling (O(n) → O(1))
- Replace `indexOf`+`splice` with single-pass in-place filter in graph builder (O(n²) → O(n))
- Parallelize `getOperationState()` git calls with `Promise.allSettled()` (4 sequential → 1 batch)
- Avoid calling `buildFullGraph()` twice on log refresh

### Bug Fixes
- Set upstream now creates the remote branch when it does not exist yet (closes #3)
- Settings and external git changes are now applied immediately without requiring a restart

## 0.2.8 (2026-04-25)

### Improvements
- **Modal pill icons**: Type icons (branch, commit, tag, cloud, stash) moved inside pill badges across all modals for consistent styling
- **Stash pill color**: Stash pills now use gray to match the graph badge color
- **Flow finish modal**: Branch and tag names in step descriptions are now shown as pill badges

## 0.2.7 (2026-04-25)

### New Features
- **Stash rename**: Stash entries can now be renamed via context menu
- **Tag details modal**: Click "Show details" on a tag to view its name and annotation message
- **Push tag modal**: Push individual tags to a remote directly from the tag context menu
- **Force push modes**: Push modal now offers `--force-with-lease` (safe, default) and `--force` (override) as distinct options
- **Git flag badges**: Modal option labels show the underlying git flag (e.g. `--no-ff`, `--squash`) for transparency

### Improvements
- **Live settings refresh**: `graphSortOrder` and `maxCommits` changes apply immediately without reloading the panel
- **VS Code notifications**: Operation success/failure toasts now use native VS Code notifications instead of in-webview banners
- **Stash ref hidden in commit details**: REFS row is no longer shown for stash commits in the bottom panel (redundant with graph badge)

### Bug Fixes
- **Checkout stash restore**: If checkout or create-branch fails after auto-stash, the stash is now always popped back (previously changes could be left stuck in stash)
- **Flow action validation**: Invalid `flowType` or `action` values now surface as errors instead of silently reporting success
- **Conflict operation type**: `refreshConflicts` no longer defaults to `merge` when no operation is active, preventing a stale conflict banner
- **Interactive rebase dropdown opacity**: Fixed visual regression where action dropdowns appeared faded
- **Load more scroll position**: Scroll position is now preserved when loading additional commits
- **Status bar visibility**: Status bar item is now correctly shown/hidden based on panel state

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
- **Checkout dirty options simplified**: 4 radio options reduced to 3 - "Keep changes and checkout" (merge), "Stash and checkout" (always `-u`), "Discard all changes". Removed the separate tracked-only stash variant to reduce decision fatigue
- **SCM sidebar polish**: Branches view opens expanded by default; pull/push title actions added next to fetch using webview-matching arrow icons; all 5 views (branches, remotes, tags, stashes, worktrees) now declare icons so they render correctly when moved between containers

### Bug Fixes
- **Side-by-side diff syntax highlighting**: Both panes now run through Shiki highlighting (previously only inline mode was highlighted - side-by-side rendered raw text)
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
- `gitGraphPlus.autoFetch` - toggle periodic auto-fetch
- `gitGraphPlus.autoFetchInterval` - auto-fetch interval (1–60 minutes)
- `gitGraphPlus.locale` - UI language (auto, en, ko)
- `gitGraphPlus.maxCommits` - maximum commits to load
- `gitGraphPlus.graphRowHeight` - commit graph row height
- `gitGraphPlus.defaultView` - default view (graph or log)
- `gitGraphPlus.autoRefresh` - auto-refresh on repository changes
- `gitGraphPlus.showRemoteBranches` - show remote branches in sidebar
- `gitGraphPlus.confirmForcePush` - confirm before force push
