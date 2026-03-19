# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Git Graph+ is a VS Code extension providing an interactive Git commit graph UI. It uses a **two-tier architecture**: a Node.js extension backend (`src/`) communicating via JSON messages with a Svelte 5 webview frontend (`webview-ui/`).

## Build & Development Commands

```bash
# Install dependencies (both root and webview)
npm install && cd webview-ui && npm install && cd ..

# Full build (extension + webview)
npm run build

# Development with hot reload
npm run dev                    # Watches both extension and webview concurrently
npm run watch:extension        # Extension only (esbuild)
npm run watch:webview          # Webview only (Vite)

# Type checking (serves as lint)
npm run lint                   # tsc --noEmit on extension
cd webview-ui && npm run check # svelte-check on webview

# Tests
npm test                       # vitest run (all tests)
npx vitest run src/git/__tests__/git-parser.test.ts  # Single test file

# Package for distribution
npm run package                # vsce package
```

## Architecture

### Communication Flow

Extension and webview communicate exclusively via `postMessage()`. All message types are defined in `src/utils/message-bus.ts` as TypeScript union types (`WebviewMessage` for webview→extension, `ExtensionMessage` for extension→webview).

### Extension Side (`src/`)

- **`extension.ts`**: Activation entry point. Registers 40+ commands, creates MainPanel, initializes tree view providers, sets up file watcher and background fetch.
- **`panels/MainPanel.ts`**: Singleton webview panel manager. Routes all incoming webview messages via `handleMessage()` (50+ message types). Sends data back via `postMessage()`.
- **`git/git-service.ts`**: All git operations via `child_process.spawn`. 80+ methods. Maintains activity log (last 200 commands). Caches remote names for 30s.
- **`git/git-graph-builder.ts`**: Computes graph layout (paths, links, dots) from commit data for canvas rendering.
- **`git/git-parser.ts`**: Parses raw git log output into structured commit objects.
- **`services/file-watcher.ts`**: Watches `.git/HEAD`, `.git/refs/**`, `.git/index`. Debounces at 500ms with 1s cooldown.
- **`views/`**: Five `TreeDataProvider` implementations for Activity Bar sidebar (branches, remotes, tags, stashes, worktrees).

### Webview Side (`webview-ui/`)

- **Framework**: Svelte 5 with `$state`/`$derived` runes, built with Vite 6.
- **`App.svelte`**: Root component. Handles all extension messages, keyboard shortcuts, layout.
- **Stores** (`lib/stores/`): `commits.svelte.ts` (graph data), `branches.svelte.ts` (refs), `ui.svelte.ts` (selection, view mode, panel height). All use Svelte 5 class-based `$state`.
- **`components/graph/CommitGraph.svelte`**: Canvas-based commit graph with interactive selection and context menus.
- **`lib/i18n/`**: Custom store-based i18n. English (`en.ts`) and Korean (`ko.ts`). Git terms (commit, merge, rebase, push, pull, fetch, stash, tag, checkout, cherry-pick, revert, blame, reflog, bisect) stay untranslated in both languages.

### Build Tooling

- **Extension**: esbuild (`esbuild.config.mjs`) → `dist/extension.js` (CommonJS, Node platform, `vscode` externalized).
- **Webview**: Vite (`webview-ui/vite.config.ts`) → `webview-ui/dist/main.{js,css}` (single bundle, no chunking, assets inlined up to 100KB).

### Data Flow: Git Log → Canvas

1. `GitService.log()` spawns git with `\x01`/`\x00` delimiters (handles newlines in commit bodies)
2. `git-parser.ts` `parseLog()` splits on those delimiters → `Commit[]`
3. `git-graph-builder.ts` computes layout (paths, links, dots, column assignments) → `CommitGraphData`
4. MainPanel sends `CommitGraphData` via `postMessage()` → `commitStore.setData()`
5. `CommitGraph.svelte` renders from store onto `<canvas>`

## Key Conventions

- **i18n**: Extension side uses `vscode.l10n.t()` with bundles in `l10n/`. Webview side uses custom `t()` from `lib/i18n/index.svelte.ts`. When adding UI strings, update both `en.ts` and `ko.ts`. Command names go in `package.nls.json` / `package.nls.ko.json`.
- **Message types**: When adding new extension↔webview communication, define the type in `src/utils/message-bus.ts`, handle in `MainPanel.handleMessage()`, and dispatch in `App.svelte`. Types are duplicated between extension and webview (no shared code package).
- **Git operations**: Always go through `GitService` methods, never spawn git directly elsewhere. GitService throws `GitError` with stderr, exit code, and command args. All spawned processes use `LC_ALL=C` (consistent output) and `GIT_TERMINAL_PROMPT=0` (no interactive prompts), with a 30-second default timeout.
- **Error → conflict flow**: When a git operation fails, MainPanel checks for conflict files. If conflicts exist, it sends `conflictData` instead of a plain error message.
- **MainPanel singleton**: One instance per workspace. Uses `pendingModal` pattern to queue modals triggered before the panel is created.
- **Activity log**: GitService logs every command (args, timestamp, success, duration) in a 200-entry ring buffer, viewable in the webview.
- **No linter/formatter config**: No eslint or prettier. `npm run lint` runs `tsc --noEmit` only. Webview type checking: `cd webview-ui && npm run check` (runs `svelte-check`).
- **Tests**: Only parser and graph builder have unit tests (`src/git/__tests__/`). Run with vitest.
