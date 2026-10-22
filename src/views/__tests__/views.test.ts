import { describe, it, expect, vi, beforeEach } from 'vitest';

// The sidebar TreeDataProviders are vscode-bound but their real work — mapping
// git data into a sorted/grouped tree of TreeItems — is plain logic. A small
// vscode mock (TreeItem/ThemeIcon/EventEmitter/enums) lets us test it.
vi.mock('vscode', () => {
  class TreeItem {
    contextValue?: string;
    iconPath?: unknown;
    description?: string | boolean;
    tooltip?: string;
    command?: { command: string; title: string; arguments?: unknown[] };
    constructor(public label: string, public collapsibleState: number) {}
  }
  class ThemeIcon { constructor(public id: string) {} }
  class EventEmitter {
    private listeners: Array<(arg: unknown) => void> = [];
    event = (cb: (arg: unknown) => void) => { this.listeners.push(cb); return { dispose: () => {} }; };
    fire = (arg?: unknown) => { this.listeners.forEach(l => l(arg)); };
    dispose = () => { this.listeners = []; };
  }
  return {
    TreeItem,
    ThemeIcon,
    EventEmitter,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    commands: { executeCommand: vi.fn() },
    StatusBarAlignment: { Left: 1, Right: 2 },
    l10n: { t: (s: string) => s },
    window: {
      createStatusBarItem: vi.fn(() => ({
        text: '', command: '', tooltip: '', show: vi.fn(), dispose: vi.fn(),
      })),
    },
  };
});

import * as vscode from 'vscode';
import { BranchesViewProvider } from '../branches-view';
import { RemotesViewProvider } from '../remotes-view';
import { TagsViewProvider } from '../tags-view';
import { StashesViewProvider } from '../stashes-view';
import { WorktreesViewProvider } from '../worktrees-view';
import { StatusBarManager } from '../status-bar';
import type { GitService } from '../../git/git-service';
import type { BranchInfo, RemoteInfo, TagInfo, StashEntry, WorktreeInfo } from '../../git/types';

function branch(name: string, over: Partial<BranchInfo> = {}): BranchInfo {
  return { name, current: false, ahead: 0, behind: 0, hash: 'h'.repeat(40), ...over };
}

function mockSvc(over: Partial<Record<keyof GitService, unknown>> & { rootPath?: string } = {}): GitService {
  return {
    rootPath: over.rootPath ?? '/repo',
    branches: vi.fn(async () => (over.branches as BranchInfo[]) ?? []),
    defaultBranch: vi.fn(async () => over.defaultBranch === undefined ? 'main' : over.defaultBranch),
    fullyMergedBranches: vi.fn(async () => new Set((over.fullyMergedBranches as string[]) ?? [])),
    remotes: vi.fn(async () => (over.remotes as RemoteInfo[]) ?? []),
    tags: vi.fn(async () => (over.tags as TagInfo[]) ?? []),
    stashList: vi.fn(async () => (over.stashList as StashEntry[]) ?? []),
    worktreeList: vi.fn(async () => (over.worktreeList as WorktreeInfo[]) ?? []),
  } as unknown as GitService;
}

const themeId = (i: { iconPath?: unknown }) => (i.iconPath as { id: string }).id;

describe('BranchesViewProvider', () => {
  it('groups slashed branches into folders and sorts primary branches first', async () => {
    const svc = mockSvc({ branches: [
      branch('feature/login'),
      branch('zeta'),
      branch('main'),
    ] });
    const p = new BranchesViewProvider(svc);
    const roots = await p.getChildren();
    // Order: primary 'main', then 'zeta', then the 'feature' folder.
    expect(roots.map(r => r.label)).toEqual(['main', 'zeta', 'feature']);
    // The folder expands to its leaf.
    const folder = roots.find(r => r.label === 'feature')!;
    const children = await p.getChildren(folder);
    expect(children.map(c => c.label)).toEqual(['login']);
    expect(folder.contextValue).toBe('branch-folder');
    expect(themeId(folder)).toBe('folder');
  });

  it('marks the current branch and renders ahead/behind badges', async () => {
    const svc = mockSvc({ branches: [branch('main', { current: true, ahead: 2, behind: 1, upstream: 'origin/main' })] });
    const p = new BranchesViewProvider(svc);
    // refresh() goes through doFetch, which also pushes the setContext key.
    p.refresh();
    await (p as unknown as { pending: Promise<void> }).pending;
    const [item] = await p.getChildren();
    expect(item.contextValue).toBe('branch-current');
    expect(themeId(item)).toBe('check');
    expect(item.description).toBe('current ↑2 ↓1');
    expect(p.getCurrentItem()?.label).toBe('main');
    // setContext is pushed so the sidebar shows Push vs Publish correctly.
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', 'gitGraphPlus.currentBranchHasUpstream', true);
  });

  it('marks branches fully merged into the default branch', async () => {
    const svc = mockSvc({
      branches: [branch('main'), branch('feature/squashed')],
      fullyMergedBranches: ['feature/squashed'],
    });
    const p = new BranchesViewProvider(svc);
    await p.prefetch();
    const folder = (await p.getChildren()).find(item => item.label === 'feature')!;
    const [feature] = await p.getChildren(folder);
    expect(feature.description).toBe('merged');
    expect(feature.tooltip).toContain('Fully merged into main');
  });

  it('excludes remote branches and returns [] on error', async () => {
    const svc = mockSvc({ branches: [branch('local'), branch('origin/x', { remote: 'origin' })] });
    expect((await new BranchesViewProvider(svc).getChildren()).map(i => i.label)).toEqual(['local']);

    const failing = mockSvc();
    (failing.branches as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    expect(await new BranchesViewProvider(failing).getChildren()).toEqual([]);
  });

  it('refresh fires onDidChangeTreeData once the fetch settles', async () => {
    const p = new BranchesViewProvider(mockSvc({ branches: [branch('main')] }));
    const spy = vi.fn();
    p.onDidChangeTreeData(spy);
    p.refresh();
    await (p as unknown as { pending: Promise<void> }).pending;
    expect(spy).toHaveBeenCalled();
  });
});

describe('RemotesViewProvider', () => {
  it('lists remotes, then their branches sorted with main/master first', async () => {
    const svc = mockSvc({
      remotes: [{ name: 'origin', fetchUrl: 'f', pushUrl: 'p' }],
      branches: [
        branch('origin/zeta', { remote: 'origin' }),
        branch('origin/main', { remote: 'origin' }),
      ],
    });
    const p = new RemotesViewProvider(svc);
    const [remote] = await p.getChildren();
    expect(remote.label).toBe('origin');
    expect(remote.contextValue).toBe('remote');
    const branches = await p.getChildren(remote);
    expect(branches.map(b => b.label)).toEqual(['main', 'zeta']);
    expect(branches[0].contextValue).toBe('remote-branch');
  });

  it('caches per-remote branch lookups', async () => {
    const svc = mockSvc({
      remotes: [{ name: 'origin', fetchUrl: 'f', pushUrl: 'p' }],
      branches: [branch('origin/main', { remote: 'origin' })],
    });
    const p = new RemotesViewProvider(svc);
    const [remote] = await p.getChildren();
    await p.getChildren(remote);
    await p.getChildren(remote);
    // branches() called once for the first expansion, then served from cache.
    expect(svc.branches).toHaveBeenCalledTimes(1);
  });
});

describe('TagsViewProvider', () => {
  it('maps tags to items with short-hash description and a menu command', async () => {
    const tags: TagInfo[] = [{ name: 'v1.0', hash: 'abcdef1234567890', isAnnotated: true, message: 'release' }];
    const items = await new TagsViewProvider(mockSvc({ tags })).getChildren();
    expect(items[0].label).toBe('v1.0');
    expect(items[0].description).toBe('abcdef1');
    expect(items[0].command?.command).toBe('gitGraphPlus.showTagMenu');
    expect(themeId(items[0])).toBe('tag');
  });
});

describe('StashesViewProvider', () => {
  it('labels stashes by index and carries the message', async () => {
    const stashList: StashEntry[] = [{ index: 0, message: 'WIP', date: '2024-01-01' }];
    const items = await new StashesViewProvider(mockSvc({ stashList })).getChildren();
    expect(items[0].label).toBe('stash@{0}');
    expect(items[0].description).toBe('WIP');
    expect(items[0].command?.command).toBe('gitGraphPlus.showStashMenu');
  });
});

describe('WorktreesViewProvider', () => {
  it('labels the main worktree and shows a repo-relative path for linked ones', async () => {
    const worktreeList: WorktreeInfo[] = [
      { path: '/repo', branch: 'main', isMain: true, detached: false, locked: false, prunable: false, hash: 'h' },
      { path: '/repo/wt-feature', branch: 'feature', isMain: false, detached: false, locked: false, prunable: false, hash: 'h' },
    ];
    const items = await new WorktreesViewProvider(mockSvc({ worktreeList, rootPath: '/repo' })).getChildren();
    expect(items[0].label).toBe('main (main)');
    expect(themeId(items[0])).toBe('home');
    expect(items[1].label).toBe('feature');
    expect(items[1].description).toBe('./wt-feature');
  });

  it('shows a lock icon for a locked worktree', async () => {
    const worktreeList: WorktreeInfo[] = [
      { path: '/repo/wt', branch: 'x', isMain: false, detached: false, locked: true, prunable: false, hash: 'h' },
    ];
    const items = await new WorktreesViewProvider(mockSvc({ worktreeList })).getChildren();
    expect(themeId(items[0])).toBe('lock');
  });
});

// The five tree providers share an identical lifecycle (refresh → fetchId-
// guarded doFetch → fire event; prefetch reuse; setGitService reset; dispose;
// getChildren error fallback). One parametrised suite exercises all of them.
const DATA_METHODS = ['branches', 'remotes', 'tags', 'stashList', 'worktreeList'] as const;
const lifecycleCases = [
  { name: 'branches', make: (s: GitService) => new BranchesViewProvider(s), data: { branches: [branch('main')] } },
  { name: 'remotes', make: (s: GitService) => new RemotesViewProvider(s), data: { remotes: [{ name: 'origin', fetchUrl: 'f', pushUrl: 'p' }] } },
  { name: 'tags', make: (s: GitService) => new TagsViewProvider(s), data: { tags: [{ name: 'v1', hash: 'a'.repeat(40), isAnnotated: false }] } },
  { name: 'stashes', make: (s: GitService) => new StashesViewProvider(s), data: { stashList: [{ index: 0, message: 'm', date: 'd' }] } },
  { name: 'worktrees', make: (s: GitService) => new WorktreesViewProvider(s), data: { worktreeList: [{ path: '/repo', branch: 'main', isMain: true, detached: false, locked: false, prunable: false, hash: 'h' }] } },
];

describe.each(lifecycleCases)('$name provider lifecycle', ({ make, data }) => {
  type Provider = ReturnType<typeof make> & {
    refresh(): void;
    prefetch(): Promise<void>;
    setGitService(s: GitService): void;
    dispose(): void;
    onDidChangeTreeData(cb: () => void): unknown;
    getChildren(): Promise<unknown[]>;
  };

  it('refresh runs doFetch and fires the change event', async () => {
    const p = make(mockSvc(data)) as Provider;
    const spy = vi.fn();
    p.onDidChangeTreeData(spy);
    p.refresh();
    await p.prefetch(); // returns the in-flight refresh
    expect(spy).toHaveBeenCalled();
  });

  it('prefetch starts a fetch when none is pending', async () => {
    const p = make(mockSvc(data)) as Provider;
    await p.prefetch();
    expect((await p.getChildren()).length).toBeGreaterThan(0);
  });

  it('setGitService swaps the service and refetches', async () => {
    const p = make(mockSvc(data)) as Provider;
    await p.getChildren();
    p.setGitService(mockSvc(data));
    await p.prefetch();
    expect((await p.getChildren()).length).toBeGreaterThan(0);
  });

  it('dispose does not throw', () => {
    expect(() => (make(mockSvc(data)) as Provider).dispose()).not.toThrow();
  });

  it('getChildren returns [] when the service throws', async () => {
    const svc = mockSvc();
    for (const m of DATA_METHODS) (svc[m] as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    expect(await (make(svc) as Provider).getChildren()).toEqual([]);
  });
});

describe('StatusBarManager', () => {
  it('creates a right-aligned status item wired to the open command, and disposes it', () => {
    const createFn = vscode.window.createStatusBarItem as unknown as ReturnType<typeof vi.fn>;
    const mgr = new StatusBarManager();
    expect(createFn).toHaveBeenCalledWith(2 /* Right */, 0);
    const item = createFn.mock.results.at(-1)!.value;
    expect(item.text).toBe('$(git-merge)');
    expect(item.command).toBe('gitGraphPlus.open');
    expect(item.tooltip).toContain('Git Graph+');
    expect(item.show).toHaveBeenCalled();
    mgr.dispose();
    expect(item.dispose).toHaveBeenCalled();
  });
});
