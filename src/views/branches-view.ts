import * as vscode from 'vscode';
import { GitService } from '../git/git-service';
import type { BranchInfo } from '../git/types';

type BranchTreeItem = BranchFolderItem | BranchLeafItem;

export class BranchesViewProvider implements vscode.TreeDataProvider<BranchTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<BranchTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private cache: BranchTreeItem[] | null = null;
  private pending: Promise<void> | null = null;
  private currentItem: BranchLeafItem | null = null;

  constructor(private gitService: GitService) {}

  public setGitService(gitService: GitService): void {
    this.gitService = gitService;
    this.cache = null;
    this.refresh();
  }

  private fetchId = 0;

  refresh(): Promise<void> {
    this.pending = this.doFetch();
    return this.pending;
  }

  prefetch(): Promise<void> {
    if (!this.pending) {
      this.pending = this.doFetch();
    }
    return this.pending;
  }

  public getCurrentItem(): BranchLeafItem | null {
    return this.currentItem;
  }

  private async doFetch(): Promise<void> {
    const id = ++this.fetchId;
    try {
      const { branches, items, currentItem } = await this.fetchBranchTree();
      if (id !== this.fetchId) return; // superseded by newer request
      this.cache = items;
      this.currentItem = currentItem;
      const current = branches.find(b => b.current && !b.remote);
      // A "gone" upstream (remote branch deleted) counts as no upstream so the
      // sidebar shows Publish instead of Push, matching the toolbar button.
      vscode.commands.executeCommand('setContext', 'gitGraphPlus.currentBranchHasUpstream', current ? (!!current.upstream && !current.upstreamGone) : true);
    } catch { /* keep old cache */ }
    if (id === this.fetchId) {
      this.pending = null;
      this._onDidChangeTreeData.fire();
    }
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: BranchTreeItem): vscode.TreeItem {
    return element;
  }

  getParent(element: BranchTreeItem): BranchTreeItem | undefined {
    return element.parent;
  }

  async getChildren(element?: BranchTreeItem): Promise<BranchTreeItem[]> {
    if (element instanceof BranchFolderItem) {
      return element.children;
    }

    if (this.cache) return this.cache;

    // Direct fetch as fallback - always returns data
    try {
      const { items, currentItem } = await this.fetchBranchTree();
      this.cache = items;
      this.currentItem = currentItem;
    } catch { /* ignore */ }
    return this.cache ?? [];
  }

  private async fetchBranchTree(): Promise<{ branches: BranchInfo[]; items: BranchTreeItem[]; currentItem: BranchLeafItem | null }> {
    const branches = await this.gitService.branches();
    const localBranches = branches.filter(b => !b.remote);
    const defaultBranch = await this.gitService.defaultBranch();
    const fullyMerged = defaultBranch
      ? await this.gitService.fullyMergedBranches(localBranches.map(b => b.name), defaultBranch)
      : new Set<string>();
    const { items, currentItem } = buildBranchTree(localBranches, fullyMerged, defaultBranch);
    return { branches, items, currentItem };
  }
}

/**
 * Builds a hierarchical folder tree from flat branch names.
 */
function buildBranchTree(branches: BranchInfo[], fullyMerged: Set<string>, defaultBranch: string | null): { items: BranchTreeItem[]; currentItem: BranchLeafItem | null } {
  interface FolderNode {
    branches: BranchInfo[];
    subfolders: Map<string, FolderNode>;
  }

  const root: FolderNode = { branches: [], subfolders: new Map() };

  for (const branch of branches) {
    const parts = branch.name.split('/');
    if (parts.length === 1) {
      root.branches.push(branch);
    } else {
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node.subfolders.has(parts[i])) {
          node.subfolders.set(parts[i], { branches: [], subfolders: new Map() });
        }
        node = node.subfolders.get(parts[i])!;
      }
      node.branches.push(branch);
    }
  }

  let currentItem: BranchLeafItem | null = null;

  function render(node: FolderNode, parent?: BranchFolderItem): BranchTreeItem[] {
    const sortedBranches = [...node.branches].sort((a, b) => {
      const nameA = a.name.includes('/') ? a.name.split('/').pop()! : a.name;
      const nameB = b.name.includes('/') ? b.name.split('/').pop()! : b.name;
      const [orderA, lowerA] = branchSortKey(nameA);
      const [orderB, lowerB] = branchSortKey(nameB);
      if (orderA !== orderB) { return orderA - orderB; }
      return lowerA.localeCompare(lowerB);
    });

    const sortedFolders = [...node.subfolders.entries()].sort((a, b) =>
      a[0].toLowerCase().localeCompare(b[0].toLowerCase())
    );

    const items: BranchTreeItem[] = [];

    for (const branch of sortedBranches) {
      const displayName = branch.name.includes('/') ? branch.name.split('/').pop()! : branch.name;
      const item = new BranchLeafItem(branch, displayName, parent, fullyMerged.has(branch.name), defaultBranch);
      if (branch.current) { currentItem = item; }
      items.push(item);
    }

    for (const [name, sub] of sortedFolders) {
      const folderItem = new BranchFolderItem(name, parent);
      folderItem.children = render(sub, folderItem);
      items.push(folderItem);
    }

    return items;
  }

  const items = render(root);
  return { items, currentItem };
}

const PRIMARY_BRANCHES = ['main', 'master', 'develop', 'dev', 'trunk'];

function branchSortKey(name: string): [number, string] {
  const lower = name.toLowerCase();
  if (PRIMARY_BRANCHES.includes(lower)) { return [0, lower]; }
  return [1, lower];
}

class BranchFolderItem extends vscode.TreeItem {
  public children: BranchTreeItem[] = [];
  constructor(
    public readonly folderName: string,
    public readonly parent?: BranchFolderItem
  ) {
    super(folderName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'branch-folder';
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

class BranchLeafItem extends vscode.TreeItem {
  constructor(
    public readonly branch: BranchInfo,
    displayName: string,
    public readonly parent: BranchFolderItem | undefined,
    fullyMerged: boolean,
    defaultBranch: string | null,
  ) {
    super(displayName, vscode.TreeItemCollapsibleState.None);

    this.contextValue = branch.current ? 'branch-current' : 'branch';
    this.iconPath = new vscode.ThemeIcon(branch.current ? 'check' : 'git-branch');


    if (branch.current) {
      this.description = 'current';
    }

    const badges: string[] = [];
    if (branch.ahead > 0) { badges.push(`↑${branch.ahead}`); }
    if (branch.behind > 0) { badges.push(`↓${branch.behind}`); }
    if (fullyMerged) { badges.push('merged'); }
    if (badges.length > 0) {
      this.description = (this.description ? this.description + ' ' : '') + badges.join(' ');
    }

    this.tooltip = `${branch.name}${branch.upstream ? ` → ${branch.upstream}` : ''}${fullyMerged && defaultBranch ? `\nFully merged into ${defaultBranch}` : ''}`;

    this.command = {
      command: 'gitGraphPlus.showBranchMenu',
      title: 'Show Branch Menu',
      arguments: [{ branch: this.branch }],
    };
  }
}
