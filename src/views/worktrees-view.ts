import * as vscode from 'vscode';
import { GitService } from '../git/git-service';
import type { WorktreeInfo } from '../git/types';

export class WorktreesViewProvider implements vscode.TreeDataProvider<WorktreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<WorktreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private gitService: GitService) {}

  setGitService(service: GitService) {
    this.gitService = service;
    this.refresh();
  }

  private cache: WorktreeItem[] | null = null;
  private pending: Promise<void> | null = null;

  refresh(): void { this.pending = this.doFetch(); }

  prefetch(): Promise<void> {
    if (!this.pending) this.pending = this.doFetch();
    return this.pending;
  }

  private async doFetch(): Promise<void> {
    try { this.cache = (await this.gitService.worktreeList()).map(w => new WorktreeItem(w, this.gitService.rootPath)); }
    catch { /* keep old cache */ }
    this.pending = null;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: WorktreeItem): vscode.TreeItem { return element; }

  async getChildren(element?: WorktreeItem): Promise<WorktreeItem[]> {
    if (element) return [];
    if (this.cache) return this.cache;
    try { this.cache = (await this.gitService.worktreeList()).map(w => new WorktreeItem(w, this.gitService.rootPath)); }
    catch { /* ignore */ }
    return this.cache ?? [];
  }
}

class WorktreeItem extends vscode.TreeItem {
  constructor(public readonly worktree: WorktreeInfo, repoPath: string) {
    const label = worktree.isMain
      ? `${worktree.branch} (main)`
      : worktree.branch || '(detached)';
    super(label, vscode.TreeItemCollapsibleState.None);

    this.contextValue = worktree.isMain ? 'worktree-main' : 'worktree';
    this.iconPath = new vscode.ThemeIcon(
      worktree.locked ? 'lock' : worktree.isMain ? 'home' : 'folder-opened'
    );
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const repoPathWithSlash = repoPath.endsWith('/') ? repoPath : repoPath + '/';
    let displayPath: string;
    if (worktree.path.startsWith(repoPathWithSlash)) {
      displayPath = './' + worktree.path.substring(repoPathWithSlash.length);
    } else if (homeDir) {
      displayPath = worktree.path.replace(homeDir, '~');
    } else {
      displayPath = worktree.path;
    }
    this.description = worktree.isMain ? '' : displayPath;
    this.tooltip = [
      `Path: ${worktree.path}`,
      `Branch: ${worktree.branch || '(detached)'}`,
      worktree.locked ? 'Locked' : '',
      worktree.prunable ? 'Prunable' : '',
    ].filter(Boolean).join('\n');
  }
}
