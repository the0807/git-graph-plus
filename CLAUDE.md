# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Git Graph Plus is a VS Code extension that provides a full-featured Git GUI — commit graph visualization, branch/tag/stash/worktree management, diff viewer, and more. It uses a **two-process architecture**: a Node.js extension host (backend) and a Svelte 5 webview (frontend).

## Build & Development Commands

```bash
# Install dependencies (both root and webview-ui)
npm install && cd webview-ui && npm install && cd ..

# Build everything (extension + webview)
npm run build

# Development mode (watches both extension and webview)
npm run dev

# Build individually
npm run build:extension    # esbuild bundles src/extension.ts → dist/extension.js
npm run build:webview      # vite builds webview-ui → webview-ui/dist

# Type checking (no emit)
npm run lint               # runs tsc --noEmit on the extension

# Webview type checking
cd webview-ui && npm run check   # runs svelte-check

# Tests
npm test                   # vitest run (all tests)
npm run test:watch         # vitest in watch mode
npx vitest run src/git/__tests__/specific-file.test.ts  # single test file

# Package for marketplace
npm run package            # vsce package → .vsix file
```

## Architecture

### Extension Host (Backend) — `src/`
- **`extension.ts`** — Entry point. Registers commands, tree views, file watcher, auto-fetch timer.
- **`git/git-service.ts`** — Core Git operations (wraps `git` CLI via child_process). All git commands go through this.
- **`git/git-parser.ts`** — Parses raw git output (log, diff, branch list, etc.) into typed structures.
- **`git/git-graph-builder.ts`** — Builds the visual graph layout (rail assignment, merge lines) from parsed commits.
- **`git/types.ts`** — Shared TypeScript types for git data structures.
- **`panels/MainPanel.ts`** — VS Code WebviewPanel host. Handles message routing between the webview and GitService.
- **`utils/message-bus.ts`** — Typed message definitions for Extension ↔ Webview communication (discriminated union types).
- **`services/file-watcher.ts`** — Watches `.git/` directory for changes and triggers auto-refresh.
- **`services/repo-discovery.ts`** — Discovers git repos and submodules in the workspace.
- **`views/`** — TreeDataProviders for the Activity Bar sidebar (branches, remotes, tags, stashes, worktrees).

### Webview (Frontend) — `webview-ui/`
- **Svelte 5** with Vite, outputs to `webview-ui/dist/`.
- **`src/App.svelte`** — Root component; routes between Graph, Log, and Stats views.
- **`src/components/graph/`** — CommitGraph, CommitNode, BranchLine — canvas-based graph rendering.
- **`src/components/commit/`** — CommitDetails panel with diff viewer (uses Shiki for syntax highlighting).
- **`src/components/modals/`** — Modal dialogs for git operations (create branch, merge, rebase, etc.).
- **`src/components/layout/`** — Toolbar and BottomPanel layout components.
- **`src/components/common/`** — Shared UI: context menus, search bar, image diff, stats view, bisect banner.
- **`src/components/rebase/`** — Interactive rebase UI with drag-to-reorder.
- **`src/lib/stores/`** — Svelte stores for shared state management.
- **`src/lib/i18n/`** — Frontend internationalization (English/Korean/Chinese Simplified).
- **`src/lib/vscode-api.ts`** — Typed wrapper for `acquireVsCodeApi()` messaging.

### Extension ↔ Webview Communication
All communication is via `postMessage` / `onDidReceiveMessage`. Message types are defined in `src/utils/message-bus.ts` (`WebviewMessage` for webview→extension, `ExtensionMessage` for extension→webview). `MainPanel.ts` is the message router that dispatches webview requests to `GitService`.

### Internationalization
- Extension strings: `l10n/bundle.l10n.json` (English), `l10n/bundle.l10n.ko.json` (Korean), `l10n/bundle.l10n.zh-cn.json` (Chinese Simplified), using VS Code's `vscode.l10n.t()`.
- Webview strings: `webview-ui/src/lib/i18n/` — `en.ts`, `ko.ts`, `zh.ts`.
- Git terms (commit, merge, rebase, push, pull, fetch) are intentionally left untranslated.

## Key Conventions

- Extension is bundled with **esbuild** (CJS, Node target). Webview is bundled with **Vite** (ESM, browser target).
- Tests use **Vitest** and live in `src/git/__tests__/`.
- The extension activates when a `.git` folder is detected (`workspaceContains:.git`).
- `vscode` is an external dependency (not bundled) — provided by the VS Code runtime.
