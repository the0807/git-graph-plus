import * as vscode from 'vscode';
import { GitService } from '../git/git-service';
import type { RemoteInfo, BranchInfo } from '../git/types';

type RemoteTreeItem = RemoteItem | RemoteBranchItem;

export class RemotesViewProvider implements vscode.TreeDataProvider<RemoteTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RemoteTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private rootCache: RemoteTreeItem[] | null = null;
  private branchCache: Map<string, RemoteTreeItem[]> = new Map();
  private pending: Promise<void> | null = null;

  constructor(private gitService: GitService) {}

  refresh(): void {
    this.branchCache.clear();
    this.pending = null;
    this.prefetch();
  }

  prefetch(): Promise<void> {
    if (!this.pending) this.pending = this.doFetch();
    return this.pending;
  }

  private async doFetch(): Promise<void> {
    const thisRequest = this.pending;
    try { this.rootCache = (await this.gitService.remotes()).map(r => new RemoteItem(r)); }
    catch { /* keep old cache */ }
    if (this.pending === thisRequest) { this.pending = null; this._onDidChangeTreeData.fire(); }
  }

  getTreeItem(element: RemoteTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RemoteTreeItem): Promise<RemoteTreeItem[]> {
    if (!element) {
      if (this.rootCache) return this.rootCache;
      try { this.rootCache = (await this.gitService.remotes()).map(r => new RemoteItem(r)); }
      catch { /* ignore */ }
      return this.rootCache ?? [];
    }

    if (element instanceof RemoteItem) {
      const remoteName = element.remote.name;
      const cached = this.branchCache.get(remoteName);
      if (cached) return cached;

      try {
        const branches = await this.gitService.branches();
        const remoteBranches = branches.filter(b =>
          b.remote === remoteName || (b.name.startsWith(`${remoteName}/`) && b.name !== remoteName)
        );
        const PRIMARY = ['main', 'master'];
        remoteBranches.sort((a, b) => {
          const nameA = a.name.includes('/') ? a.name.substring(a.name.indexOf('/') + 1) : a.name;
          const nameB = b.name.includes('/') ? b.name.substring(b.name.indexOf('/') + 1) : b.name;
          const lowerA = nameA.toLowerCase();
          const lowerB = nameB.toLowerCase();
          const orderA = PRIMARY.includes(lowerA) ? 0 : 1;
          const orderB = PRIMARY.includes(lowerB) ? 0 : 1;
          if (orderA !== orderB) { return orderA - orderB; }
          return lowerA.localeCompare(lowerB);
        });
        const items = remoteBranches.map(b => new RemoteBranchItem(b));
        this.branchCache.set(remoteName, items);
        return items;
      } catch {
        return [];
      }
    }

    return [];
  }
}

class RemoteItem extends vscode.TreeItem {
  constructor(public readonly remote: RemoteInfo) {
    super(remote.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'remote';
    this.iconPath = new vscode.ThemeIcon('cloud');
    this.tooltip = `Fetch: ${remote.fetchUrl}\nPush: ${remote.pushUrl}`;
  }
}

class RemoteBranchItem extends vscode.TreeItem {
  constructor(public readonly branch: BranchInfo) {
    const displayName = branch.name.includes('/')
      ? branch.name.substring(branch.name.indexOf('/') + 1)
      : branch.name;
    super(displayName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'remote-branch';
    this.iconPath = new vscode.ThemeIcon('git-branch');
    this.tooltip = branch.name;

    this.command = {
      command: 'gitGraphPlus.showRemoteBranchMenu',
      title: 'Show Remote Branch Menu',
      arguments: [this],
    };
  }
}
