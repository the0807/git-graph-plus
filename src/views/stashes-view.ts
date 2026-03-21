import * as vscode from 'vscode';
import { GitService } from '../git/git-service';
import type { StashEntry } from '../git/types';

export class StashesViewProvider implements vscode.TreeDataProvider<StashItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<StashItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private cache: StashItem[] | null = null;
  private pending: Promise<void> | null = null;

  constructor(private gitService: GitService) {}

  refresh(): void { this.pending = null; this.prefetch(); }

  prefetch(): Promise<void> {
    if (!this.pending) this.pending = this.doFetch();
    return this.pending;
  }

  private async doFetch(): Promise<void> {
    const thisRequest = this.pending;
    try { this.cache = (await this.gitService.stashList()).map(s => new StashItem(s)); }
    catch { /* keep old cache */ }
    if (this.pending === thisRequest) { this.pending = null; this._onDidChangeTreeData.fire(); }
  }

  getTreeItem(element: StashItem): vscode.TreeItem { return element; }

  async getChildren(element?: StashItem): Promise<StashItem[]> {
    if (element) return [];
    if (this.cache) return this.cache;
    try { this.cache = (await this.gitService.stashList()).map(s => new StashItem(s)); }
    catch { /* ignore */ }
    return this.cache ?? [];
  }
}

class StashItem extends vscode.TreeItem {
  constructor(public readonly stash: StashEntry) {
    super(`stash@{${stash.index}}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'stash';
    this.iconPath = new vscode.ThemeIcon('archive');
    this.description = stash.message || '';
    this.tooltip = `${stash.message}\n${stash.date}`;

    this.command = {
      command: 'gitGraphPlus.showStashMenu',
      title: 'Show Stash Menu',
      arguments: [this],
    };
  }
}
