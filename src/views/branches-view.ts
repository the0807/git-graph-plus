import * as vscode from 'vscode';
import { GitService } from '../git/git-service';
import type { BranchInfo } from '../git/types';

type BranchTreeItem = BranchFolderItem | BranchLeafItem;

export class BranchesViewProvider implements vscode.TreeDataProvider<BranchTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<BranchTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private cache: BranchTreeItem[] | null = null;
  private pending: Promise<void> | null = null;

  constructor(private gitService: GitService) {}

  refresh(): void {
    this.pending = null;
    this.prefetch();
  }

  prefetch(): Promise<void> {
    if (!this.pending) {
      this.pending = this.doFetch();
    }
    return this.pending;
  }

  private async doFetch(): Promise<void> {
    const thisRequest = this.pending;
    try {
      const branches = await this.gitService.branches();
      if (this.pending !== thisRequest) return;
      this.cache = buildBranchTree(branches.filter(b => !b.remote));
    } catch { /* keep old cache */ }
    if (this.pending === thisRequest) {
      this.pending = null;
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(element: BranchTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: BranchTreeItem): Promise<BranchTreeItem[]> {
    if (element instanceof BranchFolderItem) {
      return element.children;
    }

    if (this.cache) return this.cache;

    // Direct fetch as fallback — always returns data
    try {
      const branches = await this.gitService.branches();
      this.cache = buildBranchTree(branches.filter(b => !b.remote));
    } catch { /* ignore */ }
    return this.cache ?? [];
  }
}

/**
 * Builds a hierarchical folder tree from flat branch names.
 * e.g., feature/login, feature/signup → folder "feature" with children "login", "signup"
 */
function buildBranchTree(branches: BranchInfo[]): BranchTreeItem[] {
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
      // Store branch with display name as last part
      node.branches.push(branch);
    }
  }

  return renderNode(root);
}

const PRIMARY_BRANCHES = ['main', 'master', 'develop', 'dev', 'trunk'];

function branchSortKey(name: string): [number, string] {
  const lower = name.toLowerCase();
  if (PRIMARY_BRANCHES.includes(lower)) { return [0, lower]; }
  return [1, lower];
}

function renderNode(node: { branches: BranchInfo[]; subfolders: Map<string, any> }): BranchTreeItem[] {
  // Sort leaf branches: main/master first, develop/dev second, then alphabetical
  const sortedBranches = [...node.branches].sort((a, b) => {
    const nameA = a.name.includes('/') ? a.name.split('/').pop()! : a.name;
    const nameB = b.name.includes('/') ? b.name.split('/').pop()! : b.name;
    const [orderA, lowerA] = branchSortKey(nameA);
    const [orderB, lowerB] = branchSortKey(nameB);
    if (orderA !== orderB) { return orderA - orderB; }
    return lowerA.localeCompare(lowerB);
  });

  // Sort folders alphabetically
  const sortedFolders = [...node.subfolders.entries()].sort((a, b) =>
    a[0].toLowerCase().localeCompare(b[0].toLowerCase())
  );

  const items: BranchTreeItem[] = [];

  // Leaf branches first (so main/master appears at top)
  for (const branch of sortedBranches) {
    const displayName = branch.name.includes('/') ? branch.name.split('/').pop()! : branch.name;
    items.push(new BranchLeafItem(branch, displayName));
  }

  // Then folders
  for (const [name, sub] of sortedFolders) {
    const children = renderNode(sub);
    items.push(new BranchFolderItem(name, children));
  }

  return items;
}

class BranchFolderItem extends vscode.TreeItem {
  constructor(
    public readonly folderName: string,
    public readonly children: BranchTreeItem[]
  ) {
    super(folderName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'branch-folder';
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

class BranchLeafItem extends vscode.TreeItem {
  constructor(public readonly branch: BranchInfo, displayName: string) {
    super(displayName, vscode.TreeItemCollapsibleState.None);

    this.contextValue = branch.current ? 'branch-current' : 'branch';
    this.iconPath = new vscode.ThemeIcon(branch.current ? 'check' : 'git-branch');

    if (branch.current) {
      this.description = 'current';
    }

    const badges: string[] = [];
    if (branch.ahead > 0) { badges.push(`↑${branch.ahead}`); }
    if (branch.behind > 0) { badges.push(`↓${branch.behind}`); }
    if (badges.length > 0) {
      this.description = (this.description ? this.description + ' ' : '') + badges.join(' ');
    }

    this.tooltip = `${branch.name}${branch.upstream ? ` → ${branch.upstream}` : ''}`;

    this.command = {
      command: 'gitGraphPlus.showBranchMenu',
      title: 'Show Branch Menu',
      arguments: [this],
    };
  }
}
