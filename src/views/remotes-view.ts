import * as vscode from 'vscode';
import { GitService } from '../git/git-service';
import type { RemoteInfo, BranchInfo } from '../git/types';

type RemoteTreeItem = RemoteItem | RemoteBranchItem;

export class RemotesViewProvider implements vscode.TreeDataProvider<RemoteTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RemoteTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private gitService: GitService) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: RemoteTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RemoteTreeItem): Promise<RemoteTreeItem[]> {
    if (!element) {
      try {
        const remotes = await this.gitService.remotes();
        return remotes.map(r => new RemoteItem(r));
      } catch {
        return [];
      }
    }

    if (element instanceof RemoteItem) {
      try {
        const branches = await this.gitService.branches();
        const remoteName = element.remote.name;
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
        return remoteBranches.map(b => new RemoteBranchItem(b));
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
