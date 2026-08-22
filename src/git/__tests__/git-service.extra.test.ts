import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitService, GitError } from '../git-service';
import type { BranchInfo } from '../types';

function mockExec(service: GitService, fn: (args: string[]) => Promise<string>) {
  (service as unknown as { exec: (args: string[]) => Promise<string> }).exec = fn;
}

function branch(name: string, over: Partial<BranchInfo> = {}): BranchInfo {
  return { name, current: false, ahead: 0, behind: 0, hash: 'abc1234', ...over };
}

describe('GitService — rootPath', () => {
  it('returns the path passed to the constructor', () => {
    const s = new GitService('/some/path');
    expect(s.rootPath).toBe('/some/path');
  });
});

describe('GitService — submoduleStatus', () => {
  let service: GitService;
  beforeEach(() => { service = new GitService('/tmp/repo'); });

  it('returns [] for empty output', async () => {
    mockExec(service, async () => '');
    expect(await service.submoduleStatus()).toEqual([]);
  });

  it('parses clean status (leading space)', async () => {
    // The leading space is the status indicator for "clean"; include a second
    // line so .trim() doesn't strip the indicator on the only entry.
    mockExec(service, async () => '+modified1234 sub/m\n abcdef1234 sub/path (heads/main)');
    const result = await service.submoduleStatus();
    expect(result[1]).toEqual({ hash: 'abcdef1234', path: 'sub/path', status: 'clean' });
  });

  it('parses modified, uninitialized, and conflict states', async () => {
    mockExec(service, async () => [
      '+abcdef1234 sub/a',
      '-abcdef1234 sub/b',
      'Uabcdef1234 sub/c',
    ].join('\n'));
    const result = await service.submoduleStatus();
    expect(result.map(r => r.status)).toEqual(['modified', 'uninitialized', 'conflict']);
  });

  it('handles malformed lines (no match) with status "?"', async () => {
    mockExec(service, async () => 'garbage line\n abcdef1234 sub/valid');
    const result = await service.submoduleStatus();
    expect(result[0].status).toBe('?');
    expect(result[1].status).toBe('clean');
  });
});

describe('GitService — submoduleUpdate', () => {
  let service: GitService;
  beforeEach(() => { service = new GitService('/tmp/repo'); });

  it('runs without --init by default', async () => {
    const calls: string[][] = [];
    mockExec(service, async (args) => { calls.push(args); return 'ok'; });
    const out = await service.submoduleUpdate();
    expect(out).toBe('ok');
    expect(calls[0]).toEqual(['submodule', 'update']);
  });

  it('adds --init --recursive when init=true', async () => {
    const calls: string[][] = [];
    mockExec(service, async (args) => { calls.push(args); return 'ok'; });
    await service.submoduleUpdate(true);
    expect(calls[0]).toEqual(['submodule', 'update', '--init', '--recursive']);
  });
});

describe('GitService — LFS', () => {
  let service: GitService;
  beforeEach(() => { service = new GitService('/tmp/repo'); });

  it('lfsLsFiles returns parsed entries on success', async () => {
    mockExec(service, async () => '7fa22a8f5f * banner.png\n5f70bf18a0 - data.bin\n');
    const result = await service.lfsLsFiles();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ oid: '7fa22a8f5f', path: 'banner.png' });
  });

  it('lfsLsFiles returns [] when git-lfs is not installed (exitCode null)', async () => {
    mockExec(service, async (args) => { throw new GitError('command not found', null, args); });
    expect(await service.lfsLsFiles()).toEqual([]);
  });

  it('lfsLsFiles swallows expected configuration errors silently', async () => {
    const warn = vi.fn();
    service.setWarningHandler(warn);
    mockExec(service, async (args) => {
      throw new GitError('missing protocol: unsupported file:// remote', 2, args);
    });
    expect(await service.lfsLsFiles()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('lfsLsFiles warns on unexpected failures', async () => {
    const warn = vi.fn();
    service.setWarningHandler(warn);
    mockExec(service, async (args) => { throw new GitError('catastrophic boom', 1, args); });
    expect(await service.lfsLsFiles()).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('lfsLock posts the file via git lfs lock with -- separator', async () => {
    const calls: string[][] = [];
    mockExec(service, async (args) => { calls.push(args); return 'locked'; });
    await service.lfsLock('assets/big.bin');
    expect(calls[0]).toEqual(['lfs', 'lock', '--', 'assets/big.bin']);
  });

  it('lfsUnlock posts the file via git lfs unlock with -- separator', async () => {
    const calls: string[][] = [];
    mockExec(service, async (args) => { calls.push(args); return ''; });
    await service.lfsUnlock('a.bin');
    expect(calls[0]).toEqual(['lfs', 'unlock', '--', 'a.bin']);
  });

  it('lfsUnlock prepends --force before the -- separator when force=true', async () => {
    const calls: string[][] = [];
    mockExec(service, async (args) => { calls.push(args); return ''; });
    await service.lfsUnlock('a.bin', true);
    expect(calls[0]).toEqual(['lfs', 'unlock', '--force', '--', 'a.bin']);
  });

  it('lfsLock rejects an option-like file name', async () => {
    await expect(service.lfsLock('-evil')).rejects.toThrow();
  });

  it('lfsUnlock rejects an option-like file name', async () => {
    await expect(service.lfsUnlock('-evil')).rejects.toThrow();
  });

  it('lfsLocks returns parsed locks on success', async () => {
    mockExec(service, async () => 'logo.png\talice\tID:1\n');
    const result = await service.lfsLocks();
    expect(result).toEqual([{ path: 'logo.png', owner: 'alice', id: 'ID:1' }]);
  });

  it('lfsLocks returns [] when git-lfs not installed', async () => {
    mockExec(service, async (args) => { throw new GitError('spawn failed', null, args); });
    expect(await service.lfsLocks()).toEqual([]);
  });

  it('lfsLocks stays silent when git-lfs is not a git command (exit 1)', async () => {
    const warn = vi.fn();
    service.setWarningHandler(warn);
    mockExec(service, async (args) => { throw new GitError("git: 'lfs' is not a git command. See 'git --help'.", 1, args); });
    expect(await service.lfsLocks()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('lfsLocks swallows known expected errors and surfaces unexpected ones', async () => {
    const warn = vi.fn();
    service.setWarningHandler(warn);
    mockExec(service, async (args) => { throw new GitError('lfs.url not configured', 1, args); });
    expect(await service.lfsLocks()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();

    mockExec(service, async (args) => { throw new GitError('unexpected error condition', 1, args); });
    expect(await service.lfsLocks()).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('lfsLsFiles recognises additional expected error patterns', async () => {
    const warn = vi.fn();
    service.setWarningHandler(warn);
    const expected = [
      'standalone transfer agent required',
      'no such remote',
      "'origin' does not appear to be a git repository",
      'this operation requires existing locks',
      "git: 'lfs' is not a git command. See 'git --help'.",
      'not a git repository',
    ];
    for (const msg of expected) {
      warn.mockClear();
      mockExec(service, async (args) => { throw new GitError(msg, 1, args); });
      await service.lfsLsFiles();
      expect(warn).not.toHaveBeenCalled();
    }
  });
});

describe('GitService — git-flow shortcuts', () => {
  let service: GitService;
  beforeEach(() => {
    service = new GitService('/tmp/repo');
    (service as unknown as { branches: () => Promise<BranchInfo[]> }).branches = async () => [
      branch('main', { upstream: 'origin/main' }),
      branch('develop', { upstream: 'origin/develop' }),
      branch('feature/login', { upstream: 'origin/feature/login' }),
      branch('release/1.0', { upstream: 'origin/release/1.0' }),
      branch('hotfix/1.0.1', { upstream: 'origin/hotfix/1.0.1' }),
    ];
  });

  const flowConfigResponses: Record<string, string> = {
    'config --local --get gitflow.branch.master': 'main',
    'config --local --get gitflow.branch.develop': 'develop',
    'config --local --get gitflow.prefix.feature': 'feature/',
    'config --local --get gitflow.prefix.release': 'release/',
    'config --local --get gitflow.prefix.hotfix': 'hotfix/',
    'config --local --get gitflow.prefix.versiontag': 'v',
  };

  it('flowFeatureStart runs git flow feature start <name>', async () => {
    const calls: string[][] = [];
    mockExec(service, async (args) => {
      calls.push(args);
      const key = args.join(' ');
      if (key in flowConfigResponses) return flowConfigResponses[key];
      if (key === 'show-ref --verify --quiet refs/heads/feature/login') return '';
      return 'ok';
    });
    await service.flowFeatureStart('login');
    expect(calls).toContainEqual(['flow', 'feature', 'start', 'login']);
  });

  it('flowFeatureFinish runs git flow feature finish <name>', async () => {
    const calls: string[][] = [];
    mockExec(service, async (args) => {
      calls.push(args);
      const key = args.join(' ');
      if (key in flowConfigResponses) return flowConfigResponses[key];
      return '';
    });
    await service.flowFeatureFinish('login');
    expect(calls).toContainEqual(['flow', 'feature', 'finish', 'login']);
  });

  it('flowReleaseStart and flowReleaseFinish include -m message for finish', async () => {
    const calls: string[][] = [];
    mockExec(service, async (args) => {
      calls.push(args);
      const key = args.join(' ');
      if (key in flowConfigResponses) return flowConfigResponses[key];
      return '';
    });
    await service.flowReleaseStart('1.0');
    await service.flowReleaseFinish('1.0');
    expect(calls).toContainEqual(['flow', 'release', 'start', '1.0']);
    expect(calls).toContainEqual(['flow', 'release', 'finish', '-m', '1.0', '1.0']);
  });

  it('flowHotfixStart and flowHotfixFinish behave the same way', async () => {
    const calls: string[][] = [];
    mockExec(service, async (args) => {
      calls.push(args);
      const key = args.join(' ');
      if (key in flowConfigResponses) return flowConfigResponses[key];
      return '';
    });
    await service.flowHotfixStart('1.0.1');
    await service.flowHotfixFinish('1.0.1');
    expect(calls).toContainEqual(['flow', 'hotfix', 'start', '1.0.1']);
    expect(calls).toContainEqual(['flow', 'hotfix', 'finish', '-m', '1.0.1', '1.0.1']);
  });

  it('flowFeatureStart rejects when git-flow reports success but the branch is missing', async () => {
    mockExec(service, async (args) => {
      const key = args.join(' ');
      if (key in flowConfigResponses) return flowConfigResponses[key];
      if (key === 'flow feature start login') return 'ok';
      if (key === 'show-ref --verify --quiet refs/heads/feature/login') {
        throw new GitError('', 1, args);
      }
      return '';
    });

    await expect(service.flowFeatureStart('login'))
      .rejects.toThrow("branch 'feature/login' was not created");
  });

  it('flowHotfixStart pulls with rebase when the production branch is behind upstream', async () => {
    (service as unknown as { branches: () => Promise<BranchInfo[]> }).branches = async () => [
      branch('main', { upstream: 'origin/main', behind: 2 }),
      branch('develop', { current: true, upstream: 'origin/develop' }),
    ];
    const calls: string[][] = [];
    mockExec(service, async (args) => {
      calls.push(args);
      const key = args.join(' ');
      if (key in flowConfigResponses) return flowConfigResponses[key];
      if (key === 'show-ref --verify --quiet refs/heads/hotfix/1.0.1') return '';
      return '';
    });

    await service.flowHotfixStart('1.0.1');

    expect(calls).toContainEqual(['checkout', 'main']);
    expect(calls).toContainEqual(['pull', '--rebase']);
    expect(calls).toContainEqual(['checkout', 'develop']);
    expect(calls).toContainEqual(['flow', 'hotfix', 'start', '1.0.1']);
  });

  it('flowReleaseFinish pulls with rebase when a related branch is behind upstream', async () => {
    (service as unknown as { branches: () => Promise<BranchInfo[]> }).branches = async () => [
      branch('main', { current: true, upstream: 'origin/main' }),
      branch('develop', { upstream: 'origin/develop', behind: 1 }),
      branch('release/1.0', { upstream: 'origin/release/1.0' }),
    ];
    const calls: string[][] = [];
    mockExec(service, async (args) => {
      calls.push(args);
      const key = args.join(' ');
      if (key in flowConfigResponses) return flowConfigResponses[key];
      return '';
    });

    await service.flowReleaseFinish('1.0');

    expect(calls).toContainEqual(['checkout', 'develop']);
    expect(calls).toContainEqual(['pull', '--rebase']);
    expect(calls).toContainEqual(['checkout', 'main']);
    expect(calls).toContainEqual(['flow', 'release', 'finish', '-m', '1.0', '1.0']);
  });

  it('flowHotfixStart stops before git-flow when pull --rebase fails', async () => {
    (service as unknown as { branches: () => Promise<BranchInfo[]> }).branches = async () => [
      branch('main', { current: true, upstream: 'origin/main', behind: 1 }),
    ];
    const calls: string[][] = [];
    mockExec(service, async (args) => {
      calls.push(args);
      const key = args.join(' ');
      if (key in flowConfigResponses) return flowConfigResponses[key];
      if (key === 'pull --rebase') throw new GitError('rebase conflict', 1, args);
      return '';
    });

    await expect(service.flowHotfixStart('1.0.1')).rejects.toThrow('rebase conflict');
    expect(calls).not.toContainEqual(['flow', 'hotfix', 'start', '1.0.1']);
  });

  it('rejects flow names that start with "-" (CLI option injection)', async () => {
    const calls: string[][] = [];
    mockExec(service, async (args) => { calls.push(args); return ''; });
    await expect(service.flowFeatureStart('--upload-pack=evil')).rejects.toThrow();
    await expect(service.flowFeatureFinish('-x')).rejects.toThrow();
    await expect(service.flowReleaseStart('-rf')).rejects.toThrow();
    await expect(service.flowReleaseFinish('--force')).rejects.toThrow();
    await expect(service.flowHotfixStart('-d')).rejects.toThrow();
    await expect(service.flowHotfixFinish('--help')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('rejects empty / non-string flow names', async () => {
    const calls: string[][] = [];
    mockExec(service, async (args) => { calls.push(args); return ''; });
    await expect(service.flowFeatureStart('')).rejects.toThrow();
    // @ts-expect-error - exercising runtime guard
    await expect(service.flowReleaseStart(undefined)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('GitService — getFlowBranches', () => {
  let service: GitService;
  beforeEach(() => { service = new GitService('/tmp/repo'); });

  it('returns empty groups when flow config is not set', async () => {
    mockExec(service, async () => { throw new GitError('not set', 1, []); });
    const result = await service.getFlowBranches();
    expect(result).toEqual({ features: [], releases: [], hotfixes: [] });
  });

  it('groups branches by configured prefixes', async () => {
    const responses: Record<string, string> = {
      'config --local --get gitflow.branch.master': 'main',
      'config --local --get gitflow.branch.develop': 'develop',
      'config --local --get gitflow.prefix.feature': 'feature/',
      'config --local --get gitflow.prefix.release': 'release/',
      'config --local --get gitflow.prefix.hotfix': 'hotfix/',
      'config --local --get gitflow.prefix.versiontag': 'v',
      'branch --list': [
        '* develop',
        '  feature/login',
        '  feature/signup',
        '  release/1.0',
        '  hotfix/1.0.1',
        '  main',
      ].join('\n'),
    };
    mockExec(service, async (args) => {
      const key = args.join(' ');
      if (key in responses) return responses[key];
      return '';
    });
    const result = await service.getFlowBranches();
    expect(result.features).toEqual(['feature/login', 'feature/signup']);
    expect(result.releases).toEqual(['release/1.0']);
    expect(result.hotfixes).toEqual(['hotfix/1.0.1']);
  });
});

describe('GitService — argument validation', () => {
  let service: GitService;
  beforeEach(() => { service = new GitService('/tmp/repo'); });

  it('rejects refs that start with a dash (looks like a CLI flag)', async () => {
    await expect(service.checkout('--upload-pack=foo')).rejects.toThrow();
  });

  it('rejects paths that start with a dash', async () => {
    await expect(service.lsTree('HEAD', '--bad-flag')).rejects.toThrow();
  });

  it('assertSafeRef rejects empty refs', async () => {
    await expect(service.checkout('')).rejects.toThrow(/Invalid ref/);
  });

  it('assertSafePath rejects absolute paths', async () => {
    await expect(service.lsTree('HEAD', '/etc/passwd')).rejects.toThrow(/Unsafe path/);
  });

  it('assertSafePath rejects parent-traversal paths', async () => {
    await expect(service.lsTree('HEAD', '../../../etc/passwd')).rejects.toThrow(/Unsafe path/);
    await expect(service.lsTree('HEAD', 'src/../../../etc')).rejects.toThrow(/Unsafe path/);
  });

  it('assertSafePath rejects empty paths', async () => {
    await expect(service.lsTree('HEAD', '')).rejects.toThrow();
  });

  it('assertSafePath accepts normal relative paths', async () => {
    mockExec(service, async () => '');
    await expect(service.lsTree('HEAD', 'src/app.ts')).resolves.toEqual([]);
  });

  it('assertSafePath accepts paths with dots that are not traversal', async () => {
    mockExec(service, async () => '');
    await expect(service.lsTree('HEAD', 'src/file.name.ts')).resolves.toEqual([]);
  });
});

describe('GitService — auth error detection (via push/pull/fetch)', () => {
  let service: GitService;
  beforeEach(() => { service = new GitService('/tmp/repo'); });

  const authPatterns = [
    'authentication failed',
    'could not read Username for https://github.com',
    'Could not read Password for https://github.com',
    'terminal prompts disabled',
    'Invalid username or password',
    'authentication required',
    'HTTP Basic: Access denied',
  ];

  for (const pattern of authPatterns) {
    it(`fetch retries once on auth pattern: "${pattern.slice(0, 30)}..."`, async () => {
      let attempts = 0;
      mockExec(service, async (args) => {
        attempts++;
        if (attempts === 1) throw new GitError(pattern, 128, args);
        return '';
      });
      let handlerCalled = false;
      service.setAuthRetryHandler(async () => { handlerCalled = true; return true; });
      await service.fetch('origin');
      expect(handlerCalled).toBe(true);
      expect(attempts).toBe(2);
    });
  }

  it('fetch does NOT retry on non-auth errors (e.g., network)', async () => {
    let attempts = 0;
    mockExec(service, async (args) => {
      attempts++;
      throw new GitError('Could not resolve host: github.com', 128, args);
    });
    service.setAuthRetryHandler(async () => true);
    await expect(service.fetch('origin')).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it('fetch propagates auth error when no handler is registered', async () => {
    mockExec(service, async (args) => { throw new GitError('Authentication failed', 128, args); });
    await expect(service.fetch('origin')).rejects.toThrow(/Authentication failed/);
  });

  it('fetch propagates auth error when handler returns false (user cancelled)', async () => {
    let attempts = 0;
    mockExec(service, async (args) => {
      attempts++;
      throw new GitError('Authentication failed', 128, args);
    });
    service.setAuthRetryHandler(async () => false);
    await expect(service.fetch('origin')).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it('fetch propagates auth error when handler itself throws', async () => {
    let attempts = 0;
    mockExec(service, async (args) => {
      attempts++;
      throw new GitError('Authentication failed', 128, args);
    });
    service.setAuthRetryHandler(async () => { throw new Error('handler boom'); });
    await expect(service.fetch('origin')).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it('SSH key failures are NOT treated as auth errors (no retry)', async () => {
    let attempts = 0;
    mockExec(service, async (args) => {
      attempts++;
      throw new GitError('Permission denied (publickey)', 128, args);
    });
    let handlerCalled = false;
    service.setAuthRetryHandler(async () => { handlerCalled = true; return true; });
    await expect(service.fetch('origin')).rejects.toThrow();
    expect(handlerCalled).toBe(false);
    expect(attempts).toBe(1);
  });

  it('non-GitError instances are not treated as auth errors', async () => {
    let attempts = 0;
    mockExec(service, async () => {
      attempts++;
      throw new Error('plain error');
    });
    service.setAuthRetryHandler(async () => true);
    await expect(service.fetch('origin')).rejects.toThrow('plain error');
    expect(attempts).toBe(1);
  });

  it('setAuthRetryHandler(null) clears a previously registered handler', async () => {
    let attempts = 0;
    mockExec(service, async (args) => {
      attempts++;
      throw new GitError('Authentication failed', 128, args);
    });
    service.setAuthRetryHandler(async () => true);
    service.setAuthRetryHandler(null);
    await expect(service.fetch('origin')).rejects.toThrow();
    expect(attempts).toBe(1); // no retry
  });
});

describe('GitService — warning handler', () => {
  let service: GitService;
  beforeEach(() => { service = new GitService('/tmp/repo'); });

  it('setWarningHandler(null) silences future warnings', async () => {
    let calls = 0;
    service.setWarningHandler(() => { calls++; });
    mockExec(service, async (args) => { throw new GitError('catastrophic', 1, args); });
    await service.lfsLsFiles();
    expect(calls).toBe(1);
    service.setWarningHandler(null);
    await service.lfsLsFiles();
    expect(calls).toBe(1); // no additional call
  });
});

describe('GitService — setExtraEnv', () => {
  it('does not throw when given an empty map', () => {
    const s = new GitService('/tmp');
    expect(() => s.setExtraEnv({})).not.toThrow();
    expect(() => s.setExtraEnv({ FOO: 'bar' })).not.toThrow();
  });
});

describe('GitService — getActivityLog', () => {
  it('returns the internal activity log array', () => {
    const s = new GitService('/tmp');
    const log = s.getActivityLog();
    expect(Array.isArray(log)).toBe(true);
  });
});

describe('GitService — stashList error handling', () => {
  it('returns [] when stash list fails', async () => {
    const s = new GitService('/tmp');
    mockExec(s, async (args) => { throw new GitError('cannot list', 1, args); });
    expect(await s.stashList()).toEqual([]);
  });
});

describe('GitService — log() with stashes', () => {
  let service: GitService;
  beforeEach(() => {
    service = new GitService('/tmp/repo');
    // bypass getRemoteNames network — set cache directly
    (service as unknown as { cachedRemoteNames: string[]; remoteNamesCacheTime: number })
      .cachedRemoteNames = [];
    (service as unknown as { cachedRemoteNames: string[]; remoteNamesCacheTime: number })
      .remoteNamesCacheTime = Date.now();
  });

  // Build a single log record using the GitService format separators.
  function logRecord(
    hash: string, abbr: string, subject: string, parents: string,
  ): string {
    const F = '\x00';
    return `\x01\x02\x03${hash}${F}${abbr}${F}A${F}a@x.com${F}2024-01-01${F}A${F}a@x.com${F}2024-01-01${F}${subject}${F}${parents}${F}${F}`;
  }

  // Stash list format: %gd %x00 %gs %x00 %aI %x00 %P %x00 %H
  function stashRecord(idx: number, message: string, parent: string, hash: string): string {
    return `stash@{${idx}}\x00${message}\x002024-01-01\x00${parent}\x00${hash}`;
  }

  it('inserts stash commit after its parent when parent is in the visible scope', async () => {
    const calls: string[][] = [];
    mockExec(service, async (args) => {
      calls.push(args);
      if (args[0] === 'log' && !args.includes('--no-walk')) {
        // Main log: 2 commits
        return logRecord('p1', 'p1', 'parent', '') + logRecord('c1', 'c1', 'child', 'p1');
      }
      if (args[0] === 'stash' && args[1] === 'list') {
        return stashRecord(0, 'WIP', 'p1', 'sHash');
      }
      if (args[0] === 'log' && args.includes('--no-walk')) {
        return logRecord('sHash', 'sHash', 'wip', 'p1');
      }
      if (args[0] === 'status') return '';
      return '';
    });

    const commits = await service.log();
    // Stash inserted alongside p1's index
    expect(commits.some(c => c.hash === 'sHash')).toBe(true);
    const stash = commits.find(c => c.hash === 'sHash')!;
    expect(stash.refs[0]).toEqual({ type: 'stash', name: 'stash@{0}' });
    expect(stash.subject).toBe('WIP');
  });

  it('hides a stash whose base is not in the loaded window (no filter active)', async () => {
    mockExec(service, async (args) => {
      if (args[0] === 'log' && !args.includes('--no-walk')) {
        // Only c1 visible; the stash's base commit is not in the window
        return logRecord('c1', 'c1', 'only', '');
      }
      if (args[0] === 'stash' && args[1] === 'list') {
        return stashRecord(0, 'WIP', 'outside', 'sHash');
      }
      if (args[0] === 'log' && args.includes('--no-walk')) {
        return logRecord('sHash', 'sHash', 'wip', 'outside');
      }
      if (args[0] === 'status') return '';
      return '';
    });

    const commits = await service.log();
    // Stash is hidden until its base is loaded (rather than orphaned at the top)
    expect(commits.some(c => c.hash === 'sHash')).toBe(false);
  });

  it('drops a stash whose parent is out of scope when branches filter is active', async () => {
    mockExec(service, async (args) => {
      if (args[0] === 'log' && !args.includes('--no-walk')) {
        return logRecord('c1', 'c1', 'only', '');
      }
      if (args[0] === 'stash' && args[1] === 'list') {
        return stashRecord(0, 'WIP', 'outside', 'sHash');
      }
      if (args[0] === 'log' && args.includes('--no-walk')) {
        return logRecord('sHash', 'sHash', 'wip', 'outside');
      }
      if (args[0] === 'status') return '';
      return '';
    });

    const commits = await service.log({ branches: ['main'] });
    expect(commits.some(c => c.hash === 'sHash')).toBe(false);
  });

  it('warns and continues when the stash log exec fails', async () => {
    const warn = vi.fn();
    service.setWarningHandler(warn);
    mockExec(service, async (args) => {
      if (args[0] === 'log' && !args.includes('--no-walk')) {
        return logRecord('c1', 'c1', 'only', '');
      }
      if (args[0] === 'stash' && args[1] === 'list') {
        return stashRecord(0, 'WIP', 'p1', 'sHash');
      }
      if (args[0] === 'log' && args.includes('--no-walk')) {
        throw new GitError('stash log boom', 128, args);
      }
      if (args[0] === 'status') return '';
      return '';
    });
    const commits = await service.log();
    // Commits still returned; stash skipped
    expect(commits.some(c => c.hash === 'c1')).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});

describe('GitService — log() uncommitted porcelain branches', () => {
  let service: GitService;
  beforeEach(() => {
    service = new GitService('/tmp/repo');
    (service as unknown as { cachedRemoteNames: string[]; remoteNamesCacheTime: number })
      .cachedRemoteNames = [];
    (service as unknown as { cachedRemoteNames: string[]; remoteNamesCacheTime: number })
      .remoteNamesCacheTime = Date.now();
  });

  function record() {
    const F = '\x00';
    return `\x01\x02\x03c1${F}c1${F}A${F}a@x.com${F}2024-01-01${F}A${F}a@x.com${F}2024-01-01${F}only${F}${F}${F}`;
  }

  it('prepends an UNCOMMITTED entry when porcelain shows staged and unstaged changes', async () => {
    mockExec(service, async (args) => {
      if (args[0] === 'log') return record();
      if (args[0] === 'stash') return '';
      if (args[0] === 'status') {
        return 'M  staged.ts\n M unstaged.ts\n?? untracked.ts\n';
      }
      return '';
    });
    const commits = await service.log();
    expect(commits[0].hash).toBe('UNCOMMITTED');
    expect(commits[0].subject).toContain('3');
    const body = JSON.parse(commits[0].body);
    expect(body.staged).toBe(1);
    expect(body.unstaged).toBe(2); // 1 unstaged + 1 untracked
  });

  it('omits the UNCOMMITTED entry when porcelain is empty', async () => {
    mockExec(service, async (args) => {
      if (args[0] === 'log') return record();
      if (args[0] === 'stash') return '';
      if (args[0] === 'status') return '';
      return '';
    });
    const commits = await service.log();
    expect(commits[0].hash).toBe('c1');
  });

  it('warns when porcelain exec fails (and still returns commits)', async () => {
    const warn = vi.fn();
    service.setWarningHandler(warn);
    mockExec(service, async (args) => {
      if (args[0] === 'log') return record();
      if (args[0] === 'stash') return '';
      if (args[0] === 'status') throw new GitError('porcelain boom', 1, args);
      return '';
    });
    const commits = await service.log();
    expect(commits.some(c => c.hash === 'c1')).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});

describe('GitService — log() arg construction', () => {
  let service: GitService;
  beforeEach(() => {
    service = new GitService('/tmp/repo');
    (service as unknown as { cachedRemoteNames: string[]; remoteNamesCacheTime: number })
      .cachedRemoteNames = [];
    (service as unknown as { cachedRemoteNames: string[]; remoteNamesCacheTime: number })
      .remoteNamesCacheTime = Date.now();
  });

  it('uses --topo-order when sortOrder=topological', async () => {
    let captured: string[] = [];
    mockExec(service, async (args) => {
      if (args[0] === 'log' && !args.includes('--no-walk')) { captured = args; return ''; }
      return '';
    });
    await service.log({ sortOrder: 'topological' });
    expect(captured).toContain('--topo-order');
  });

  it('uses --date-order when sortOrder=date', async () => {
    let captured: string[] = [];
    mockExec(service, async (args) => {
      if (args[0] === 'log' && !args.includes('--no-walk')) { captured = args; return ''; }
      return '';
    });
    await service.log({ sortOrder: 'date' });
    expect(captured).toContain('--date-order');
  });

  it('uses --author-date-order by default', async () => {
    let captured: string[] = [];
    mockExec(service, async (args) => {
      if (args[0] === 'log' && !args.includes('--no-walk')) { captured = args; return ''; }
      return '';
    });
    await service.log();
    expect(captured).toContain('--author-date-order');
  });

  it('passes --max-count when limit option is provided', async () => {
    let captured: string[] = [];
    mockExec(service, async (args) => {
      if (args[0] === 'log' && !args.includes('--no-walk')) { captured = args; return ''; }
      return '';
    });
    await service.log({ limit: 100 });
    expect(captured).toContain('--max-count=100');
  });

  it('passes --skip when skip option is provided', async () => {
    let captured: string[] = [];
    mockExec(service, async (args) => {
      if (args[0] === 'log' && !args.includes('--no-walk')) { captured = args; return ''; }
      return '';
    });
    await service.log({ skip: 50 });
    expect(captured).toContain('--skip=50');
  });

  it('builds remote-filter --glob list for each selected source', async () => {
    let captured: string[] = [];
    mockExec(service, async (args) => {
      if (args[0] === 'log' && !args.includes('--no-walk')) { captured = args; return ''; }
      return '';
    });
    await service.log({ remoteFilter: ['local', 'origin', 'upstream'] });
    expect(captured).toContain('--glob=refs/heads');
    expect(captured).toContain('--glob=refs/remotes/origin');
    expect(captured).toContain('--glob=refs/remotes/upstream');
  });

  it('passes branch positional arg when options.branch is set', async () => {
    let captured: string[] = [];
    mockExec(service, async (args) => {
      if (args[0] === 'log' && !args.includes('--no-walk')) { captured = args; return ''; }
      return '';
    });
    await service.log({ branch: 'feature/x' });
    expect(captured).toContain('feature/x');
  });

  it('rejects an unsafe branch in options.branches', async () => {
    mockExec(service, async () => '');
    await expect(service.log({ branches: ['--injected'] })).rejects.toThrow();
  });
});

describe('GitService — stashRestoreFiles', () => {
  let svc: GitService;
  beforeEach(() => { svc = new GitService('/tmp/repo'); });

  it('runs git restore with the stash source and paths', async () => {
    const exec = vi.spyOn(svc as any, 'exec').mockResolvedValue('');
    await svc.stashRestoreFiles(0, ['src/a.ts', 'src/b.ts']);
    expect(exec).toHaveBeenCalledWith([
      'restore', '--source=stash@{0}', '--', 'src/a.ts', 'src/b.ts',
    ]);
  });

  it('rejects a negative index', async () => {
    await expect(svc.stashRestoreFiles(-1, ['a.ts'])).rejects.toThrow('Invalid stash index');
  });

  it('rejects a non-integer index', async () => {
    await expect(svc.stashRestoreFiles(1.5, ['a.ts'])).rejects.toThrow('Invalid stash index');
  });

  it('rejects an empty paths array', async () => {
    await expect(svc.stashRestoreFiles(0, [])).rejects.toThrow('No paths');
  });

  it('rejects an unsafe path', async () => {
    await expect(svc.stashRestoreFiles(0, ['../escape'])).rejects.toThrow('Unsafe path');
  });
});
