import * as vscode from 'vscode';
import { GitService } from '../git/git-service';
import type { TagInfo } from '../git/types';

export class TagsViewProvider implements vscode.TreeDataProvider<TagItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TagItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private gitService: GitService) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TagItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TagItem): Promise<TagItem[]> {
    if (element) {
      return [];
    }

    try {
      const tags = await this.gitService.tags();
      return tags.map(t => new TagItem(t));
    } catch {
      return [];
    }
  }
}

class TagItem extends vscode.TreeItem {
  constructor(public readonly tag: TagInfo) {
    super(tag.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'tag';
    this.iconPath = new vscode.ThemeIcon('tag');
    this.description = tag.hash.substring(0, 7);
    this.tooltip = tag.message ? `${tag.name}: ${tag.message}` : tag.name;

    this.command = {
      command: 'gitGraphPlus.showTagMenu',
      title: 'Show Tag Menu',
      arguments: [this],
    };
  }
}
