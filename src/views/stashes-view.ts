import * as vscode from 'vscode';
import { GitService } from '../git/git-service';
import type { StashEntry } from '../git/types';

export class StashesViewProvider implements vscode.TreeDataProvider<StashItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<StashItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private gitService: GitService) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: StashItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: StashItem): Promise<StashItem[]> {
    if (element) {
      return [];
    }

    try {
      const stashes = await this.gitService.stashList();
      return stashes.map(s => new StashItem(s));
    } catch {
      return [];
    }
  }
}

class StashItem extends vscode.TreeItem {
  constructor(public readonly stash: StashEntry) {
    super(stash.message || `stash@{${stash.index}}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'stash';
    this.iconPath = new vscode.ThemeIcon('archive');
    this.description = `stash@{${stash.index}}`;
    this.tooltip = `${stash.message}\n${stash.date}`;

    this.command = {
      command: 'gitGraphPlus.showStashMenu',
      title: 'Show Stash Menu',
      arguments: [this],
    };
  }
}
