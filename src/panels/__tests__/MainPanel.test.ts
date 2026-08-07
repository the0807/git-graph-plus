import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// MainPanel hosts the webview and routes ~80 message types to GitService. We
// can't run a real WebviewPanel, but with a vscode mock (panel + webview) and a
// controllable GitService we can capture the onDidReceiveMessage handler and
// assert the routing, refresh, sequence-guard, and error-handling behaviour.
const H = vi.hoisted(() => {
  const git: Record<string, ReturnType<typeof vi.fn>> = {
    log: vi.fn(async () => []),
    branches: vi.fn(async () => []),
    tags: vi.fn(async () => []),
    remotes: vi.fn(async () => []),
    stashList: vi.fn(async () => []),
    worktreeList: vi.fn(async () => []),
    merge: vi.fn(async () => {}),
    fastForwardRef: vi.fn(async () => {}),
    stashPop: vi.fn(async () => {}),
    showCommitDiff: vi.fn(async () => []),
    showCommitFiles: vi.fn(async () => []),
    resolveDiffBaseRef: vi.fn(async () => 'parentsha'),
    getEmptyTreeRef: vi.fn(async () => '4b825dc642cb6eb9a060e54bf8d69288fbee4904'),
    fileExistsAtRef: vi.fn(async () => true),
    getConflictFiles: vi.fn(async () => []),
    getOperationState: vi.fn(async () => ({ type: null })),
    getRemoteUrl: vi.fn(async () => ''),
    stashSave: vi.fn(async () => {}),
    checkout: vi.fn(async () => {}),
    pull: vi.fn(async () => {}),
    clean: vi.fn(async () => {}),
    setWarningHandler: vi.fn(),
    setAuthRetryHandler: vi.fn(),
    setExtraEnv: vi.fn(),
    setDefaultTimeout: vi.fn(),
  };
  return {
    git,
    avatarGet: vi.fn(async () => 'data:image/png;base64,AAAA'),
    avatarOptions: undefined as { source?: string } | undefined,
    avatarSource: undefined as string | undefined,
    configurationHandler: null as null | ((event: { affectsConfiguration(section: string): boolean }) => void),
    messageHandler: null as null | ((m: unknown) => unknown),
    panel: null as null | { webview: { postMessage: ReturnType<typeof vi.fn> } },
    repos: [] as Array<{ path: string; name: string; type: string }>,
  };
});

vi.mock('vscode', () => {
  const makePanel = () => {
    const webview = {
      html: '',
      cspSource: 'vscode-webview:',
      asWebviewUri: (u: unknown) => u,
      postMessage: vi.fn(),
      onDidReceiveMessage: (cb: (m: unknown) => unknown) => { H.messageHandler = cb; return { dispose() {} }; },
    };
    const panel = {
      webview,
      onDidDispose: () => ({ dispose() {} }),
      reveal: vi.fn(),
      dispose: vi.fn(),
      iconPath: undefined as unknown,
      viewColumn: 1,
    };
    H.panel = panel;
    return panel;
  };
  return {
    window: {
      createWebviewPanel: vi.fn(makePanel),
      activeTextEditor: undefined,
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(async () => undefined),
      showSaveDialog: vi.fn(async () => undefined),
    },
    workspace: {
      getConfiguration: (section?: string) => ({
        get: (key: string, d?: unknown) => {
          if (section === 'gitGraphPlus' && key === 'avatarSource') return H.avatarSource ?? d;
          return d;
        },
      }),
      getWorkspaceFolder: () => ({ uri: { fsPath: '/repo' } }),
      workspaceFolders: [{ uri: { fsPath: '/repo' } }],
      onDidChangeConfiguration: (cb: (event: { affectsConfiguration(section: string): boolean }) => void) => {
        H.configurationHandler = cb;
        return { dispose() {} };
      },
      fs: { writeFile: vi.fn(async () => {}) },
    },
    commands: { executeCommand: vi.fn() },
    l10n: { t: (k: string) => k },
    env: { language: 'en', clipboard: { writeText: vi.fn() } },
    Uri: {
      joinPath: () => ({}),
      file: (p: string) => ({ fsPath: p, with(o: object) { return { ...this, ...o }; } }),
      parse: () => ({ with: () => ({}) }),
    },
    ViewColumn: { One: 1 },
  };
});

vi.mock('../../git/git-service', async (orig) => {
  const actual = await orig<typeof import('../../git/git-service')>();
  return { ...actual, GitService: vi.fn(() => H.git) };
});
vi.mock('../../services/file-watcher', () => ({ FileWatcher: class { enabled = true; suppress() {} dispose() {} } }));
vi.mock('../../services/repo-discovery', () => ({ RepoDiscoveryService: { discoverRepos: vi.fn(async () => H.repos), clearCache: vi.fn() } }));
vi.mock('../../git/vscode-git-bridge', () => ({ triggerVSCodeGitAuth: vi.fn(async () => false) }));
vi.mock('../../services/avatar-cache', () => ({
  AvatarCache: class {
    constructor(
      _cacheDir: string | null,
      _fetcher?: unknown,
      options?: { source?: string },
    ) {
      H.avatarOptions = options;
    }
    get = H.avatarGet;
  },
}));

import { MainPanel } from '../MainPanel';
import { GitError } from '../../git/git-service';

const extUri = { fsPath: '/ext' } as unknown as import('vscode').Uri;

function posted() {
  return (H.panel!.webview.postMessage.mock.calls.map(c => c[0])) as Array<{ type: string; payload?: Record<string, unknown> }>;
}
function postedOfType(type: string) {
  return posted().filter(m => m.type === type);
}
async function dispatch(msg: unknown) {
  await H.messageHandler!(msg);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset default git behaviour after clearAllMocks wiped implementations.
  for (const k of Object.keys(H.git)) H.git[k].mockReset();
  H.git.log.mockResolvedValue([]);
  H.git.branches.mockResolvedValue([]);
  H.git.tags.mockResolvedValue([]);
  H.git.remotes.mockResolvedValue([]);
  H.git.stashList.mockResolvedValue([]);
  H.git.worktreeList.mockResolvedValue([]);
  H.git.getOperationState.mockResolvedValue({ type: null });
  H.git.getConflictFiles.mockResolvedValue([]);
  H.git.getRemoteUrl.mockResolvedValue('');
  H.git.showCommitDiff.mockResolvedValue([]);
  H.git.fileExistsAtRef.mockResolvedValue(true);
  H.git.getEmptyTreeRef.mockResolvedValue('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  H.avatarGet.mockReset();
  H.avatarGet.mockResolvedValue('data:image/png;base64,AAAA');
  H.avatarOptions = undefined;
  H.avatarSource = undefined;
  H.repos = [{ path: '/repo', name: 'repo', type: 'root' }];
  (MainPanel as unknown as { currentPanel: unknown }).currentPanel = undefined;
  (MainPanel as unknown as { avatarCache: unknown }).avatarCache = undefined;
  MainPanel.createOrShow(extUri, '/repo');
});

afterEach(() => {
  (MainPanel.currentPanel as unknown as { dispose?: () => void } | undefined)?.dispose?.();
  (MainPanel as unknown as { currentPanel: unknown }).currentPanel = undefined;
});

const commit = (hash: string) => ({
  hash, abbreviatedHash: hash.slice(0, 7), subject: 's', body: '', parents: [], refs: [],
  author: { name: '', email: '', date: '' }, committer: { name: '', email: '', date: '' },
});

describe('MainPanel construction', () => {
  it('creates a webview panel, sets its html, and posts the locale', () => {
    expect(H.panel).not.toBeNull();
    expect(H.panel!.webview).toBeDefined();
    expect(postedOfType('setLocale').length).toBeGreaterThan(0);
  });
});

describe('MainPanel message routing', () => {
  it('getLog fetches log + branches and posts logData', async () => {
    H.git.log.mockResolvedValue([commit('aaaaaaa1'), commit('bbbbbbb2')]);
    await dispatch({ type: 'getLog', payload: {} });
    expect(H.git.log).toHaveBeenCalled();
    expect(H.git.branches).toHaveBeenCalled();
    const data = postedOfType('logData').at(-1)!;
    expect((data.payload!.commits as unknown[]).length).toBe(2);
    expect(data.payload!.hasMore).toBe(false);
  });

  it('getLog reports hasMore and trims to the requested limit', async () => {
    // Requesting limit 1 fetches limit+1; returning 2 means "there is more".
    H.git.log.mockResolvedValue([commit('a1'), commit('b2')]);
    await dispatch({ type: 'getLog', payload: { limit: 1 } });
    const data = postedOfType('logData').at(-1)!;
    expect(data.payload!.hasMore).toBe(true);
    expect((data.payload!.commits as unknown[]).length).toBe(1);
  });

  it('openDiff for a commit builds the left URI from the resolved parent SHA, not the ~1 shorthand', async () => {
    const vscode = await import('vscode');
    H.git.resolveDiffBaseRef.mockResolvedValue('1111111111111111111111111111111111111111');

    await dispatch({ type: 'openDiff', payload: { file: 'doc.md', commitHash: '2222222' } });

    expect(H.git.resolveDiffBaseRef).toHaveBeenCalledWith('2222222');
    const diffCall = (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(c => c[0] === 'vscode.diff')!;
    expect(diffCall).toBeDefined();
    const leftUri = diffCall[1] as { query: string };
    const leftRef = JSON.parse(leftUri.query).ref;
    expect(leftRef).toBe('1111111111111111111111111111111111111111');
    expect(leftRef).not.toContain('~1');
  });

  it('openDiff for a new staged file diffs the empty tree against the index (HEAD has no such file)', async () => {
    const vscode = await import('vscode');
    // HEAD lacks the new file, the index has it.
    H.git.fileExistsAtRef.mockImplementation(async (ref: string) => ref !== 'HEAD');

    await dispatch({ type: 'openDiff', payload: { file: 'added.txt', staged: true } });

    const diffCall = (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(c => c[0] === 'vscode.diff')!;
    expect(diffCall).toBeDefined();
    const leftRef = JSON.parse((diffCall[1] as { query: string }).query).ref;
    const rightRef = JSON.parse((diffCall[2] as { query: string }).query).ref;
    expect(leftRef).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904'); // empty tree
    expect(rightRef).toBe(''); // index
  });

  it('openDiff for a new untracked file diffs the empty tree as the base (index has no such file)', async () => {
    const vscode = await import('vscode');
    // The file is absent from the index (untracked).
    H.git.fileExistsAtRef.mockResolvedValue(false);

    await dispatch({ type: 'openDiff', payload: { file: 'untracked.txt', staged: false } });

    const diffCall = (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(c => c[0] === 'vscode.diff')!;
    expect(diffCall).toBeDefined();
    const leftRef = JSON.parse((diffCall[1] as { query: string }).query).ref;
    expect(leftRef).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904'); // empty tree base
  });

  it('openDiff for a file added in a commit diffs the empty tree against the commit (parent lacks it)', async () => {
    const vscode = await import('vscode');
    H.git.resolveDiffBaseRef.mockResolvedValue('1111111111111111111111111111111111111111');
    // The file exists at the commit but not at its parent (it was added there).
    H.git.fileExistsAtRef.mockImplementation(async (ref: string) => ref === '2222222');

    await dispatch({ type: 'openDiff', payload: { file: 'rebase-demo.txt', commitHash: '2222222' } });

    const diffCall = (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(c => c[0] === 'vscode.diff')!;
    expect(diffCall).toBeDefined();
    const leftRef = JSON.parse((diffCall[1] as { query: string }).query).ref;
    const rightRef = JSON.parse((diffCall[2] as { query: string }).query).ref;
    expect(leftRef).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904'); // empty tree (parent has no file)
    expect(rightRef).toBe('2222222');
  });

  it('revealInExplorer resolves the repo path and runs revealFileInOS', async () => {
    const vscode = await import('vscode');

    await dispatch({ type: 'revealInExplorer', payload: { file: 'src/app.ts' } });

    const call = (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(c => c[0] === 'revealFileInOS')!;
    expect(call).toBeDefined();
    expect((call[1] as { fsPath: string }).fsPath).toBe('/repo/src/app.ts');
  });

  it('copyFilePath copies the absolute path to the clipboard', async () => {
    const vscode = await import('vscode');

    await dispatch({ type: 'copyFilePath', payload: { file: 'src/app.ts' } });

    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('/repo/src/app.ts');
    expect(postedOfType('operationComplete').some(m => m.payload?.operation === 'copied')).toBe(true);
  });

  it('getBranches posts branchData with all the sidebar collections', async () => {
    await dispatch({ type: 'getBranches' });
    const data = postedOfType('branchData').at(-1)!;
    expect(data.payload).toHaveProperty('branches');
    expect(data.payload).toHaveProperty('tags');
    expect(data.payload).toHaveProperty('worktrees');
  });

  it('getCommitDiff posts the file list for the commit', async () => {
    H.git.showCommitFiles.mockResolvedValue([{ path: 'a.ts', status: 'M' }]);
    await dispatch({ type: 'getCommitDiff', payload: { hash: 'h1' } });
    expect(H.git.showCommitFiles).toHaveBeenCalledWith('h1');
    const data = postedOfType('commitDiffData').at(-1)!;
    expect(data.payload!.hash).toBe('h1');
  });

  it('getAvatar uses the selected source and posts the resolved image', async () => {
    await dispatch({
      type: 'getAvatar',
      payload: { email: 'author@example.com', size: 20, generation: 7 },
    });

    expect(H.avatarOptions).toEqual({ source: 'gravatar' });
    expect(H.avatarGet).toHaveBeenCalledWith('author@example.com', 20);
    expect(postedOfType('avatarData').at(-1)?.payload).toEqual({
      email: 'author@example.com',
      size: 20,
      dataUri: 'data:image/png;base64,AAAA',
      generation: 7,
    });
  });

  it('getAvatar uses the selected offline Retro source', async () => {
    H.avatarSource = 'retro';

    await dispatch({ type: 'getAvatar', payload: { email: 'author@example.com', size: 20 } });

    expect(H.avatarOptions).toEqual({ source: 'retro' });
  });

  it('getAvatar falls back to Retro for an invalid configured source', async () => {
    H.avatarSource = 'unexpected';

    await dispatch({ type: 'getAvatar', payload: { email: 'author@example.com', size: 20 } });

    expect(H.avatarOptions).toEqual({ source: 'retro' });
  });

  it('asks the webview to reset when the avatar source changes', () => {
    H.configurationHandler?.({
      affectsConfiguration: (section) => section === 'gitGraphPlus.avatarSource',
    });

    expect(postedOfType('resetAvatars')).toHaveLength(1);
  });

  it('merge calls GitService.merge then refreshes the whole view', async () => {
    await dispatch({ type: 'merge', payload: { branch: 'feature' } });
    expect(H.git.merge).toHaveBeenCalledWith('feature', expect.anything());
    expect(postedOfType('operationComplete').length).toBeGreaterThan(0);
    expect(postedOfType('fullRefresh').length).toBeGreaterThan(0);
  });

  it('checkout with stash stashes before checking out', async () => {
    await dispatch({ type: 'checkout', payload: { ref: 'main', stash: true } });
    expect(H.git.stashSave).toHaveBeenCalled();
    expect(H.git.checkout).toHaveBeenCalledWith('main', expect.anything());
  });

  it('rejects switchRepo to a path outside the discovered repo list', async () => {
    await new Promise(r => setTimeout(r, 0)); // let sendRepoList populate cachedRepos
    await dispatch({ type: 'switchRepo', payload: { path: '/somewhere/else' } });
    expect(postedOfType('error').length).toBeGreaterThan(0);
  });
});

describe('MainPanel error handling', () => {
  it('posts notGitRepo when git reports "not a git repository"', async () => {
    H.git.log.mockRejectedValue(new GitError('fatal: not a git repository', 128, ['log']));
    await dispatch({ type: 'getLog', payload: {} });
    expect(postedOfType('notGitRepo').length).toBeGreaterThan(0);
  });

  it('surfaces a plain error when a mutation fails without a conflict', async () => {
    H.git.merge.mockRejectedValue(new GitError('fatal: some failure', 1, ['merge']));
    H.git.getConflictFiles.mockResolvedValue([]);
    await dispatch({ type: 'merge', payload: { branch: 'x' } });
    expect(postedOfType('error').length).toBeGreaterThan(0);
  });

  it('posts conflictData when a failing mutation leaves conflicted files', async () => {
    H.git.merge.mockRejectedValue(new GitError('CONFLICT', 1, ['merge']));
    H.git.getConflictFiles.mockResolvedValue(['a.ts']);
    H.git.getOperationState.mockResolvedValue({ type: 'merge' });
    await dispatch({ type: 'merge', payload: { branch: 'x' } });
    const data = postedOfType('conflictData').at(-1)!;
    expect(data.payload!.operation).toBe('merge');
    expect((data.payload!.files as unknown[]).length).toBe(1);
  });
});

// These cover the non-trivial orchestration the simpler route+post+refresh
// cases don't: stash/pop recovery, no-op detection, and the stale-response
// sequence guard. The rest of the ~80 message cases mirror `merge` and aren't
// worth duplicating.
describe('MainPanel orchestration logic', () => {
  it('fastForward (checkout path) stashes, checks out, ff-merges, then pops', async () => {
    await dispatch({ type: 'fastForward', payload: { local: 'main', remote: 'origin/main', stash: true } });
    expect(H.git.stashSave).toHaveBeenCalled();
    expect(H.git.checkout).toHaveBeenCalledWith('main', {});
    expect(H.git.merge).toHaveBeenCalledWith('origin/main', { ffOnly: true });
    expect(H.git.stashPop).toHaveBeenCalledWith(0);
    expect(postedOfType('operationComplete').length).toBeGreaterThan(0);
  });

  it('fastForward surfaces an error when the post-merge stash pop fails', async () => {
    H.git.stashPop.mockRejectedValueOnce(new Error('pop conflict'));
    await dispatch({ type: 'fastForward', payload: { local: 'main', remote: 'origin/main', stash: true } });
    const err = postedOfType('error').at(-1)!;
    expect(err.payload!.message).toBe('stashPopAfterFastForwardFailed');
  });

  it('pull with stash pops afterwards and surfaces a failed pop', async () => {
    H.git.pull = vi.fn(async () => '');
    H.git.stashPop.mockRejectedValueOnce(new Error('pop conflict'));
    await dispatch({ type: 'pull', payload: { stash: true } });
    expect(H.git.stashSave).toHaveBeenCalled();
    expect(H.git.pull).toHaveBeenCalled();
    expect(postedOfType('error').at(-1)!.payload!.message).toBe('stashPopAfterPullFailed');
  });

  it('stashSave reports "no changes" when the stash count does not grow', async () => {
    H.git.stashList.mockResolvedValueOnce([]).mockResolvedValueOnce([]); // before == after
    await dispatch({ type: 'stashSave', payload: {} });
    expect(postedOfType('error').at(-1)!.payload!.message).toBe('noChangesToStash');
  });

  it('stashSave confirms success when a new stash entry appears', async () => {
    H.git.stashList
      .mockResolvedValueOnce([])                    // before
      .mockResolvedValueOnce([{ index: 0 }] as never); // after
    await dispatch({ type: 'stashSave', payload: { message: 'wip' } });
    expect(H.git.stashSave).toHaveBeenCalled();
    expect(postedOfType('operationComplete').some(m => m.payload!.operation === 'stashSave')).toBe(true);
  });

  it('drops a stale file-diff response so a slower earlier request cannot clobber a newer one', async () => {
    let resolveFirst!: (v: unknown) => void;
    H.git.showCommitDiff
      .mockImplementationOnce(() => new Promise(r => { resolveFirst = r as (v: unknown) => void; }))
      .mockResolvedValueOnce([{ file: 'b.ts', hunks: [] }] as never);

    const p1 = dispatch({ type: 'getFileDiff', payload: { hash: 'h', file: 'a.ts' } });
    const p2 = dispatch({ type: 'getFileDiff', payload: { hash: 'h', file: 'b.ts' } });
    await p2; // newest request resolves and is delivered
    resolveFirst([{ file: 'a.ts', hunks: [] }]); // older request resolves late
    await p1;

    const diffs = postedOfType('fileDiffData');
    expect(diffs).toHaveLength(1);
    expect(diffs[0].payload!.file).toBe('b.ts');
  });

  it('discards a stale getLog from the previous repo after switching repos', async () => {
    // Two repos so the switchRepo allow-list check passes.
    H.repos = [
      { path: '/repo', name: 'repo', type: 'root' },
      { path: '/repo-b', name: 'repo-b', type: 'nested' },
    ];
    await dispatch({ type: 'getRepoList' }); // populate cachedRepos

    // First getLog (against the old repo) is held in-flight; later log() calls
    // (the switch's refreshAll + the new repo's getLog) return the new commits.
    let resolveOld!: (v: unknown) => void;
    H.git.log
      .mockImplementationOnce(() => new Promise(r => { resolveOld = r as (v: unknown) => void; }))
      .mockResolvedValue([commit('bbbbbbb2')] as never);

    const pOld = dispatch({ type: 'getLog', payload: {} }); // old repo, in-flight

    // Switching must not reset the sequence counter, or the next getLog reuses
    // the same seq number and the stale in-flight response sneaks past the guard.
    await dispatch({ type: 'switchRepo', payload: { path: '/repo-b' } });
    await dispatch({ type: 'getLog', payload: {} }); // new repo

    // The old repo's log resolves late with its (foreign) commits.
    resolveOld([commit('aaaaaaa1')]);
    await pOld;

    const logs = postedOfType('logData');
    const lastCommits = logs.at(-1)!.payload!.commits as Array<{ hash: string }>;
    expect(lastCommits.map(c => c.hash)).toEqual(['bbbbbbb2']);
    // The foreign commit from the old repo must never reach the webview.
    expect(logs.some(l => (l.payload!.commits as Array<{ hash: string }>).some(c => c.hash === 'aaaaaaa1'))).toBe(false);
  });

  it('refreshAll applies the saved filter before the first getLog so it does not flash the full unfiltered graph', async () => {
    const M = MainPanel as unknown as { savedRemoteFilter?: string[]; savedBranchFilter?: string[] };
    const prevRemote = M.savedRemoteFilter;
    const prevBranch = M.savedBranchFilter;
    M.savedRemoteFilter = ['origin'];
    M.savedBranchFilter = ['main'];
    try {
      H.git.log.mockResolvedValue([commit('aaaaaaa1')] as never);

      // An early refresh (file watcher / repo auto-switch / config change) can
      // fire before the webview's first getLog establishes the session filter.
      await (MainPanel.currentPanel as unknown as { refreshAll(): Promise<void> }).refreshAll();

      const logArgs = H.git.log.mock.calls.at(-1)![0] as { remoteFilter?: unknown; branches?: unknown };
      expect(logArgs.remoteFilter).toEqual(['origin']);
      expect(logArgs.branches).toEqual(['main']);

      // The graph payload must carry the same filter the webview will keep.
      const refresh = postedOfType('fullRefresh').at(-1)!;
      const logData = (refresh.payload as { logData: { remoteFilter?: unknown; branches?: unknown } }).logData;
      expect(logData.remoteFilter).toEqual(['origin']);
      expect(logData.branches).toEqual(['main']);
    } finally {
      M.savedRemoteFilter = prevRemote;
      M.savedBranchFilter = prevBranch;
    }
  });
});
