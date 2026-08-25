import * as vscode from 'vscode';
import * as path from 'path';
import { resolveGitDirs, classifyPath } from './file-watcher-helpers';

export class FileWatcher implements vscode.Disposable {
  private watchers: vscode.FileSystemWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 500;
  private refreshing = false;
  private disposed = false;
  public enabled = true;
  private gitDir: string;
  private commonDir: string;

  constructor(
    private repoPath: string,
    private onChange: (what: string) => void
  ) {
    const resolved = resolveGitDirs(repoPath);
    this.gitDir = resolved.gitDir;
    this.commonDir = resolved.commonDir;

    // Per-worktree paths (gitDir):
    //   HEAD, index, MERGE_HEAD, REBASE_HEAD live in the per-worktree gitdir
    //   for linked worktrees, and in `.git` for regular repos (gitDir==commonDir).
    this.addWatcher(new vscode.RelativePattern(this.gitDir, 'HEAD'));
    this.addWatcher(new vscode.RelativePattern(this.gitDir, 'index'));
    this.addWatcher(new vscode.RelativePattern(this.gitDir, 'MERGE_HEAD'));
    this.addWatcher(new vscode.RelativePattern(this.gitDir, 'REBASE_HEAD'));

    // Shared paths (commonDir):
    //   refs/, packed-refs, config, worktrees/ are shared across all worktrees
    //   so we watch them at the main gitdir.
    this.addWatcher(new vscode.RelativePattern(this.commonDir, 'refs/**'));
    this.addWatcher(new vscode.RelativePattern(this.commonDir, 'refs/stash'));
    this.addWatcher(new vscode.RelativePattern(this.commonDir, 'packed-refs'));
    this.addWatcher(new vscode.RelativePattern(this.commonDir, 'config'));
    // Only the registry entries `git worktree list` reports: the admin dir
    // appearing/disappearing (gitdir), where each worktree points (HEAD), and
    // its lock state. NOT `worktrees/**` — that also matched every worktree's
    // private runtime state (index, index.lock, FETCH_HEAD, COMMIT_EDITMSG,
    // logs/**). For a linked worktree that state IS our own gitdir, so the
    // panel's own `git status` retriggered its own watcher: a refresh loop
    // that also restarted any in-flight history search. For a main repo it
    // meant every git command in a sibling worktree forced a full refresh.
    this.addWatcher(new vscode.RelativePattern(this.commonDir, 'worktrees/*/{HEAD,gitdir,locked}'));

    // Watch working tree for file changes (exclude heavy dirs via specific patterns)
    // Using {src,lib,app,...}/** would be too restrictive, so we watch ** but filter
    this.addWatcher(new vscode.RelativePattern(repoPath, '**'), true);
  }

  // Directories to ignore for working tree changes (Set for O(1) lookup)
  private static readonly IGNORE_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'out', '.next',
    '.nuxt', '__pycache__', '.venv', 'vendor', 'target',
    '.gradle', '.idea', '.vs', 'coverage', '.nyc_output',
  ]);

  private addWatcher(pattern: vscode.RelativePattern, workingTree = false): void {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const handler = (uri: vscode.Uri) => {
      if (workingTree) {
        // Skip .git and common heavy directories
        const normalizedPath = uri.fsPath.split(path.sep);
        if (normalizedPath.some(seg => FileWatcher.IGNORE_DIRS.has(seg))) {
          return;
        }
      }
      this.scheduleRefresh(workingTree ? 'status' : this.classifyChange(uri));
    };

    watcher.onDidChange(handler);
    watcher.onDidCreate(handler);
    watcher.onDidDelete(handler);
    this.watchers.push(watcher);
  }

  private classifyChange(uri: vscode.Uri): string {
    return classifyPath(uri.fsPath, this.gitDir, this.commonDir);
  }

  private pendingChanges = new Set<string>();
  private pendingWhileRefreshing = false;

  private scheduleRefresh(what: string): void {
    // Guard against post-dispose calls or disabled state
    if (this.disposed || !this.enabled) {
      return;
    }

    // If currently in the refresh cooldown, flag for re-trigger instead of dropping
    if (this.refreshing) {
      this.pendingWhileRefreshing = true;
      this.pendingChanges.add(what);
      return;
    }

    this.pendingChanges.add(what);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.refreshing = true;
      // Pick the most significant change type
      const changeType = this.pendingChanges.has('refs') ? 'refs'
        : this.pendingChanges.has('operation') ? 'operation'
        : this.pendingChanges.has('status') ? 'status'
        : 'unknown';
      this.pendingChanges.clear();

      try {
        this.onChange(changeType);
      } finally {
        // Prevent re-triggering for 1 second after refresh
        this.cooldownTimer = setTimeout(() => {
          this.cooldownTimer = null;
          this.refreshing = false;
          if (this.disposed) return;
          // Re-trigger if changes came in during refresh cooldown
          if (this.pendingWhileRefreshing) {
            this.pendingWhileRefreshing = false;
            if (this.pendingChanges.size > 0) {
              this.scheduleRefresh('unknown');
            }
          }
        }, 1000);
      }
    }, this.DEBOUNCE_MS);
  }

  /** Absorb watcher events for `durationMs` ms. Call this immediately after the
   *  extension performs its own git operation + explicit refresh, so the
   *  filesystem changes caused by that operation don't trigger a redundant
   *  second refresh. Any events arriving during the window are coalesced into
   *  a single re-trigger after it expires (same path as pendingWhileRefreshing). */
  public suppress(durationMs = 1000): void {
    if (this.disposed) { return; }
    this.refreshing = true;
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
    }
    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = null;
      this.refreshing = false;
      if (this.disposed) { return; }
      if (this.pendingWhileRefreshing) {
        this.pendingWhileRefreshing = false;
        if (this.pendingChanges.size > 0) {
          this.scheduleRefresh('unknown');
        }
      }
    }, durationMs);
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
    }
    this.watchers.forEach(w => w.dispose());
  }
}
