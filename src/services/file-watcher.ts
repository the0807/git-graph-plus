import * as vscode from 'vscode';
import * as path from 'path';

export class FileWatcher implements vscode.Disposable {
  private watchers: vscode.FileSystemWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 500;
  private refreshing = false;
  private disposed = false;
  public enabled = true;

  constructor(
    private repoPath: string,
    private onChange: (what: string) => void
  ) {
    const gitDir = path.join(repoPath, '.git');

    // Only watch specific files that indicate meaningful state changes
    // HEAD — branch switch, commit
    this.addWatcher(new vscode.RelativePattern(gitDir, 'HEAD'));
    // refs — branch/tag create/delete/update
    this.addWatcher(new vscode.RelativePattern(gitDir, 'refs/**'));
    // index — staging changes
    this.addWatcher(new vscode.RelativePattern(gitDir, 'index'));
    // MERGE_HEAD, REBASE_HEAD — operation status
    this.addWatcher(new vscode.RelativePattern(gitDir, 'MERGE_HEAD'));
    this.addWatcher(new vscode.RelativePattern(gitDir, 'REBASE_HEAD'));
    // stash ref
    this.addWatcher(new vscode.RelativePattern(gitDir, 'refs/stash'));

    // Watch working tree for file changes (exclude heavy dirs via specific patterns)
    // Using {src,lib,app,...}/** would be too restrictive, so we watch ** but filter
    this.addWatcher(new vscode.RelativePattern(repoPath, '**'), true);
  }

  // Directories to ignore for working tree changes
  private static readonly IGNORE_DIRS = [
    'node_modules', '.git', 'dist', 'build', 'out', '.next',
    '.nuxt', '__pycache__', '.venv', 'vendor', 'target',
    '.gradle', '.idea', '.vs', 'coverage', '.nyc_output',
  ];

  private addWatcher(pattern: vscode.RelativePattern, workingTree = false): void {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const handler = (uri: vscode.Uri) => {
      if (workingTree) {
        // Skip .git and common heavy directories
        const normalizedPath = uri.fsPath.split(path.sep);
        for (const dir of FileWatcher.IGNORE_DIRS) {
          if (normalizedPath.includes(dir)) {
            return;
          }
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
    const gitDir = path.join(this.repoPath, '.git');
    const relativePath = path.relative(gitDir, uri.fsPath);

    if (relativePath === 'HEAD' || relativePath.startsWith('refs')) {
      return 'refs';
    }
    if (relativePath === 'index') {
      return 'status';
    }
    if (relativePath === 'MERGE_HEAD' || relativePath === 'REBASE_HEAD') {
      return 'operation';
    }
    return 'unknown';
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
        setTimeout(() => {
          this.refreshing = false;
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

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.watchers.forEach(w => w.dispose());
  }
}
