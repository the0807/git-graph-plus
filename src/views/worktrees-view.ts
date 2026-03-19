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

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: WorktreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: WorktreeItem): Promise<WorktreeItem[]> {
    if (element) {
      return [];
    }

    try {
      const worktrees = await this.gitService.worktreeList();
      return worktrees.map(w => new WorktreeItem(w, this.gitService.rootPath));
    } catch {
      return [];
    }
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
