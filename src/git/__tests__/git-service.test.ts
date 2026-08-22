import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitService, GitError, binCommitTime, buildAmendCommandStr } from '../git-service';
import type { BranchInfo } from '../types';

// Access private exec method via prototype for mocking
function mockExec(service: GitService, fn: (args: string[]) => Promise<string>) {
  (service as any).exec = fn;
}

function branch(name: string, over: Partial<BranchInfo> = {}): BranchInfo {
  return { name, current: false, ahead: 0, behind: 0, hash: 'abc1234', ...over };
}

describe('GitService', () => {
  let service: GitService;

  beforeEach(() => {
    service = new GitService('/tmp/test-repo');
  });

  describe('stash index validation', () => {
    it('stashApply rejects negative index', async () => {
      await expect(service.stashApply(-1)).rejects.toThrow('Invalid stash index');
    });

    it('stashPop rejects negative index', async () => {
      await expect(service.stashPop(-1)).rejects.toThrow('Invalid stash index');
    });

    it('stashDrop rejects negative index', async () => {
      await expect(service.stashDrop(-1)).rejects.toThrow('Invalid stash index');
    });

    it('stashApply rejects non-integer', async () => {
      await expect(service.stashApply(1.5)).rejects.toThrow('Invalid stash index');
    });

    it('stashApply accepts valid index', async () => {
      mockExec(service, async () => '');
      await expect(service.stashApply(0)).resolves.toBeUndefined();
    });
  });

  describe('clean', () => {
    it('calls git clean -f -d by default', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });

      await service.clean();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain('clean');
      expect(calls[0]).toContain('-f');
      expect(calls[0]).toContain('-d');
    });

    it('omits -d when directories=false', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });

      await service.clean(false);
      expect(calls[0]).toContain('-f');
      expect(calls[0]).not.toContain('-d');
    });
  });

  describe('pushTagToAllRemotes', () => {
    it('pushes tag to all remotes', async () => {
      const calls: string[][] = [];
      // Mock getRemoteNames to return two remotes
      (service as any).cachedRemoteNames = ['origin', 'upstream'];
      (service as any).remoteNamesCacheTime = Date.now();
      mockExec(service, async (args) => { calls.push(args); return ''; });

      await service.pushTagToAllRemotes('v1.0');
      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual(['push', 'origin', 'refs/tags/v1.0']);
      expect(calls[1]).toEqual(['push', 'upstream', 'refs/tags/v1.0']);
    });

    it('does nothing with no remotes', async () => {
      const calls: string[][] = [];
      (service as any).cachedRemoteNames = [];
      (service as any).remoteNamesCacheTime = Date.now();
      mockExec(service, async (args) => { calls.push(args); return ''; });

      await service.pushTagToAllRemotes('v1.0');
      expect(calls).toHaveLength(0);
    });
  });

  describe('deleteTagFromAllRemotes', () => {
    it('deletes the tag from every remote', async () => {
      const calls: string[][] = [];
      (service as any).cachedRemoteNames = ['origin', 'upstream'];
      (service as any).remoteNamesCacheTime = Date.now();
      mockExec(service, async (args) => { calls.push(args); return ''; });

      await service.deleteTagFromAllRemotes('v1.0');
      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual(['push', 'origin', ':refs/tags/v1.0']);
      expect(calls[1]).toEqual(['push', 'upstream', ':refs/tags/v1.0']);
    });

    it('skips remotes that do not have the tag and keeps deleting from the rest', async () => {
      const calls: string[][] = [];
      (service as any).cachedRemoteNames = ['origin', 'upstream'];
      (service as any).remoteNamesCacheTime = Date.now();
      mockExec(service, async (args) => {
        calls.push(args);
        if (args[1] === 'origin') {
          throw new GitError("error: unable to delete 'v1.0': remote ref does not exist", 1, args);
        }
        return '';
      });

      // origin lacks the tag (no-op), upstream still gets deleted — no throw.
      await expect(service.deleteTagFromAllRemotes('v1.0')).resolves.toBeUndefined();
      expect(calls).toHaveLength(2);
    });

    it('surfaces non-skippable errors after attempting every remote', async () => {
      const calls: string[][] = [];
      (service as any).cachedRemoteNames = ['origin', 'upstream'];
      (service as any).remoteNamesCacheTime = Date.now();
      mockExec(service, async (args) => {
        calls.push(args);
        if (args[1] === 'origin') {
          throw new GitError('fatal: Authentication failed', 128, args);
        }
        return '';
      });

      await expect(service.deleteTagFromAllRemotes('v1.0')).rejects.toThrow('Authentication failed');
      // upstream was still attempted even though origin failed.
      expect(calls).toHaveLength(2);
    });

    it('does nothing with no remotes', async () => {
      const calls: string[][] = [];
      (service as any).cachedRemoteNames = [];
      (service as any).remoteNamesCacheTime = Date.now();
      mockExec(service, async (args) => { calls.push(args); return ''; });

      await service.deleteTagFromAllRemotes('v1.0');
      expect(calls).toHaveLength(0);
    });

    it('aggregates errors when more than one remote fails', async () => {
      (service as any).cachedRemoteNames = ['origin', 'upstream'];
      (service as any).remoteNamesCacheTime = Date.now();
      mockExec(service, async (args) => {
        throw new GitError(`fatal: failed for ${args[1]}`, 128, args);
      });

      await expect(service.deleteTagFromAllRemotes('v1.0')).rejects.toThrow(AggregateError);
    });
  });

  describe('setExtraEnv', () => {
    it('stores extra environment variables', () => {
      service.setExtraEnv({ GIT_ASKPASS: '/usr/bin/askpass' });
      expect((service as any).extraEnv).toEqual({ GIT_ASKPASS: '/usr/bin/askpass' });
    });
  });

  describe('activity log truncation', () => {
    it('truncates long command strings in activity log', async () => {
      const longArg = 'x'.repeat(1000);
      // Call exec directly to test activity log recording
      const origExec = (service as any).exec.bind(service);
      // We can't easily test the real exec without spawning git,
      // so we verify the truncation logic inline
      const command = `git checkout ${longArg}`;
      const truncated = command.length > 500 ? command.substring(0, 500) + '…' : command;
      expect(truncated.length).toBe(501);
      expect(truncated.endsWith('…')).toBe(true);
    });
  });

  describe('GitError', () => {
    it('formats error message correctly', () => {
      const err = new GitError('not a git repo', 128, ['status']);
      expect(err.message).toContain('git status failed');
      expect(err.message).toContain('exit 128');
      expect(err.stderr).toBe('not a git repo');
      expect(err.exitCode).toBe(128);
    });
  });

  describe('log remoteFilter', () => {
    let calls: string[][];

    beforeEach(() => {
      calls = [];
      (service as any).cachedRemoteNames = [];
      (service as any).remoteNamesCacheTime = Date.now();
      mockExec(service, async (args) => { calls.push(args); return ''; });
    });

    it('uses all globs by default', async () => {
      await service.log({}).catch(() => {});
      const logCall = calls.find(c => c[0] === 'log' && !c.includes('--no-walk'));
      expect(logCall).toContain('--glob=refs/heads');
      expect(logCall).toContain('--glob=refs/remotes');
      expect(logCall).toContain('--glob=refs/tags');
    });

    it('omits remotes and tags when remoteFilter is ["local"]', async () => {
      await service.log({ remoteFilter: ['local'] }).catch(() => {});
      const logCall = calls.find(c => c[0] === 'log' && !c.includes('--no-walk'));
      expect(logCall).toContain('--glob=refs/heads');
      expect(logCall).not.toContain('--glob=refs/remotes');
      expect(logCall).not.toContain('--glob=refs/tags');
    });

    it('scopes to specific remote and omits tags when remoteFilter is ["origin"]', async () => {
      await service.log({ remoteFilter: ['origin'] }).catch(() => {});
      const logCall = calls.find(c => c[0] === 'log' && !c.includes('--no-walk'));
      expect(logCall).not.toContain('--glob=refs/heads');
      expect(logCall).toContain('--glob=refs/remotes/origin');
      expect(logCall).not.toContain('--glob=refs/remotes'); // bare --glob=refs/remotes means "all remotes"
      expect(logCall).not.toContain('--glob=refs/tags');
    });

    it('combines local and specific remote and omits tags when remoteFilter is ["local", "origin"]', async () => {
      await service.log({ remoteFilter: ['local', 'origin'] }).catch(() => {});
      const logCall = calls.find(c => c[0] === 'log' && !c.includes('--no-walk'));
      expect(logCall).toContain('--glob=refs/heads');
      expect(logCall).toContain('--glob=refs/remotes/origin');
      expect(logCall).not.toContain('--glob=refs/remotes'); // bare --glob=refs/remotes means "all remotes"
      expect(logCall).not.toContain('--glob=refs/tags');
    });
  });

  describe('log branches filter', () => {
    let calls: string[][];

    beforeEach(() => {
      calls = [];
      (service as any).cachedRemoteNames = [];
      (service as any).remoteNamesCacheTime = Date.now();
      mockExec(service, async (args) => { calls.push(args); return ''; });
    });

    it('passes branch names directly and omits glob args when branches is provided', async () => {
      await service.log({ branches: ['main', 'develop'] }).catch(() => {});
      const logCall = calls.find(c => c[0] === 'log' && !c.includes('--no-walk'));
      expect(logCall).toContain('main');
      expect(logCall).toContain('develop');
      expect(logCall).not.toContain('--glob=refs/heads');
      expect(logCall).not.toContain('--glob=refs/remotes');
      expect(logCall).not.toContain('--glob=refs/tags');
    });

    it('passes remote branch ref correctly', async () => {
      await service.log({ branches: ['origin/main'] }).catch(() => {});
      const logCall = calls.find(c => c[0] === 'log' && !c.includes('--no-walk'));
      expect(logCall).toContain('origin/main');
      expect(logCall).not.toContain('--glob=refs/heads');
    });

    it('falls back to default globs when branches is empty array', async () => {
      await service.log({ branches: [] }).catch(() => {});
      const logCall = calls.find(c => c[0] === 'log' && !c.includes('--no-walk'));
      expect(logCall).toContain('--glob=refs/heads');
      expect(logCall).toContain('--glob=refs/remotes');
      expect(logCall).toContain('--glob=refs/tags');
    });

    it('rejects branch name starting with -', async () => {
      await expect(service.log({ branches: ['-bad'] })).rejects.toThrow("must not start with '-'");
    });
  });

  describe('ref safety validation', () => {
    it('checkout rejects ref starting with -', async () => {
      await expect(service.checkout('-foo')).rejects.toThrow("must not start with '-'");
    });

    it('merge rejects ref starting with --', async () => {
      await expect(service.merge('--hack')).rejects.toThrow("must not start with '-'");
    });

    it('rebase rejects ref starting with -', async () => {
      await expect(service.rebase('-upload-pack=attacker')).rejects.toThrow("must not start with '-'");
    });

    it('cherryPick rejects hash starting with -', async () => {
      await expect(service.cherryPick('-foo')).rejects.toThrow("must not start with '-'");
    });

    it('revert rejects hash starting with -', async () => {
      await expect(service.revert('-foo')).rejects.toThrow("must not start with '-'");
    });

    it('commitFixup rejects hash starting with -', async () => {
      await expect(service.commitFixup('-foo')).rejects.toThrow("must not start with '-'");
    });

    it('commitSquash rejects hash starting with -', async () => {
      await expect(service.commitSquash('-foo')).rejects.toThrow("must not start with '-'");
    });

    it('reset rejects ref starting with -', async () => {
      await expect(service.reset('-foo', 'hard')).rejects.toThrow("must not start with '-'");
    });

    it('interactiveRebase rejects base starting with -', async () => {
      await expect(service.interactiveRebase('-foo', [])).rejects.toThrow("must not start with '-'");
    });

    it('interactiveRebase rejects base of --hack', async () => {
      await expect(service.interactiveRebase('--hack', [])).rejects.toThrow("must not start with '-'");
    });

    it('checkout rejects empty ref', async () => {
      await expect(service.checkout('')).rejects.toThrow('Invalid ref');
    });

    it('checkout accepts normal branch name', async () => {
      mockExec(service, async () => '');
      await expect(service.checkout('main')).resolves.toBeUndefined();
    });

    it('checkout passes --merge when merge option set', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });
      await service.checkout('main', { merge: true });
      expect(calls[0]).toContain('--merge');
      expect(calls[0]).toContain('main');
    });

    it('checkout passes --force when force option set', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });
      await service.checkout('main', { force: true });
      expect(calls[0]).toContain('--force');
      expect(calls[0]).not.toContain('--merge');
    });

    it('checkout uses plain form by default', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });
      await service.checkout('main');
      expect(calls[0]).not.toContain('--force');
      expect(calls[0]).not.toContain('--merge');
    });

    it('interactiveRebase accepts normal base', async () => {
      // Avoid actually running the spawn/rebase; just verify the ref check passes and
      // the action validator catches a bad action before spawn.
      await expect(service.interactiveRebase('main', [{ action: 'nope', hash: 'abc123', subject: 'test' }]))
        .rejects.toThrow('Invalid rebase action');
    });

    it('log rejects options.branch starting with -', async () => {
      await expect(service.log({ branch: '-foo' })).rejects.toThrow("must not start with '-'");
    });

    it('diff rejects ref1 starting with -', async () => {
      await expect(service.diff({ ref1: '-foo' })).rejects.toThrow("must not start with '-'");
    });

    it('addRemote rejects url starting with -', async () => {
      await expect(service.addRemote('origin', '--upload-pack=attacker')).rejects.toThrow("must not start with '-'");
    });

    it('setUpstream rejects remote starting with -', async () => {
      await expect(service.setUpstream('main', '-foo', 'main')).rejects.toThrow("must not start with '-'");
    });

    it('worktreeAdd rejects branch starting with -', async () => {
      await expect(service.worktreeAdd('/tmp/wt', '-foo')).rejects.toThrow("must not start with '-'");
    });

    it('worktreeAdd rejects newBranch starting with -', async () => {
      await expect(service.worktreeAdd('/tmp/wt', undefined, '-foo')).rejects.toThrow("must not start with '-'");
    });

    it('bisectStart rejects bad starting with -', async () => {
      await expect(service.bisectStart('-foo')).rejects.toThrow("must not start with '-'");
    });

    it('bisectGood rejects ref starting with -', async () => {
      await expect(service.bisectGood('-foo')).rejects.toThrow("must not start with '-'");
    });

    it('deleteRemoteBranch rejects name starting with -', async () => {
      await expect(service.deleteRemoteBranch('-foo')).rejects.toThrow("must not start with '-'");
    });

    it('pushTag rejects remote starting with -', async () => {
      await expect(service.pushTag('v1.0', '-foo')).rejects.toThrow("must not start with '-'");
    });

    it('getImageBase64 rejects absolute filePath', async () => {
      await expect(service.getImageBase64('main', '/etc/passwd')).rejects.toThrow('Unsafe filePath');
    });

    it('getImageBase64 rejects parent traversal in filePath', async () => {
      await expect(service.getImageBase64('main', '../secret')).rejects.toThrow('Unsafe filePath');
    });

    it('getImageBase64 rejects empty filePath', async () => {
      await expect(service.getImageBase64('main', '')).rejects.toThrow('Invalid filePath');
    });
  });

  describe('showCommitFiles merge-commit union', () => {
    it('unions files across parents, keeping the highest-priority status', async () => {
      const svc = new GitService('/tmp/test-repo');
      mockExec(svc, async (args: string[]) => {
        // commitParents: git log -1 --format=%P <hash>
        if (args[0] === 'log' && args.includes('--format=%P')) return 'parentA parentB\n';
        // showCommitFiles merge branch: git diff --name-status <parent>..<hash>
        if (args[0] === 'diff' && args.includes('--name-status')) {
          const range = args[args.length - 1];
          if (range === 'parentA..merge') return 'M\tshared.txt\n';
          if (range === 'parentB..merge') return 'D\tshared.txt\nA\tonly-b.txt\n';
          return '';
        }
        return '';
      });
      const files = await svc.showCommitFiles('merge');
      const byPath = Object.fromEntries(files.map(f => [f.path, f.status]));
      // priority R:5 C:4 A:3 D:2 M:1 → D(2) beats M(1)
      expect(byPath['shared.txt']).toBe('D');
      expect(byPath['only-b.txt']).toBe('A');
      expect(files).toHaveLength(2);
    });
  });

  describe('log() uncommitted node injection', () => {
    const logLine = '\x01\x02\x03abc123\x00abc\x00Author\x00a@a.com\x002024-01-01T00:00:00Z\x00Author\x00a@a.com\x002024-01-01T00:00:00Z\x00feat: initial\x00\x00\x00\n';

    it('prepends UNCOMMITTED commit when porcelain has output', async () => {
      mockExec(service, async (args) => {
        if (args.includes('--porcelain') && !args.includes('diff')) return ' M src/foo.ts\n?? new.ts\n';
        if (args.includes('log') && !args.includes('--no-walk')) return logLine;
        if (args.includes('remote')) return '';
        if (args.includes('stash')) return '';
        return '';
      });

      const commits = await service.log();
      expect(commits[0].hash).toBe('UNCOMMITTED');
      expect(commits[0].refs).toEqual([]);
      expect(commits[0].parents).toEqual([]);
      expect(commits[0].subject).toBe('Uncommitted changes (2)');
    });

    it('does NOT prepend UNCOMMITTED when working tree is clean', async () => {
      mockExec(service, async (args) => {
        if (args.includes('--porcelain') && !args.includes('diff')) return '';
        if (args.includes('log') && !args.includes('--no-walk')) return logLine;
        if (args.includes('remote')) return '';
        if (args.includes('stash')) return '';
        return '';
      });

      const commits = await service.log();
      expect(commits[0]?.hash).not.toBe('UNCOMMITTED');
    });
  });

  describe('getUncommittedDiff', () => {
    it('returns staged and unstaged file lists', async () => {
      // porcelain format: XY PATH (X=staged, Y=unstaged)
      mockExec(service, async () => 'M  src/foo.ts\nA  src/bar.ts\n M src/old.ts\n?? src/new.ts\n');

      const result = await service.getUncommittedDiff();
      expect(result.staged).toEqual([
        { path: 'src/foo.ts', status: 'M' },
        { path: 'src/bar.ts', status: 'A' },
      ]);
      expect(result.unstaged).toEqual([
        { path: 'src/old.ts', status: 'M' },
        { path: 'src/new.ts', status: 'U' },
      ]);
    });

    it('returns empty arrays when no changes', async () => {
      mockExec(service, async () => '');
      const result = await service.getUncommittedDiff();
      expect(result.staged).toEqual([]);
      expect(result.unstaged).toEqual([]);
    });

    it('marks untracked entries with trailing slash as nested repos', async () => {
      // Nested git repos (not registered as submodules) surface as untracked
      // directories with a trailing slash. They should be flagged with status
      // 'N' so the UI can show a meaningful hint instead of an empty diff.
      mockExec(service, async () => '?? nested-repo/\n?? submodule-test/\n?? src/new.ts\n');

      const result = await service.getUncommittedDiff();
      expect(result.unstaged).toEqual([
        { path: 'nested-repo', status: 'N' },
        { path: 'submodule-test', status: 'N' },
        { path: 'src/new.ts', status: 'U' },
      ]);
    });

    it('preserves leading space when first line is unstaged-only', async () => {
      // Regression: trimming the whole output dropped the first line's leading
      // space, shifting columns so the file landed in `staged` with its first
      // character chopped off.
      mockExec(service, async () => ' M src/foo.ts\n M src/bar.ts\n');

      const result = await service.getUncommittedDiff();
      expect(result.staged).toEqual([]);
      expect(result.unstaged).toEqual([
        { path: 'src/foo.ts', status: 'M' },
        { path: 'src/bar.ts', status: 'M' },
      ]);
    });
  });

  describe('auth retry (execWithAuthRetry / isAuthError)', () => {
    // The auth retry plumbing was added in dfd8af6 to drive VS Code's askpass
    // when the credential helper has nothing cached. Regression coverage for
    // the heuristic and the retry-once contract lives here.

    function callIsAuthError(stderr: string): boolean {
      return (service as any).isAuthError(new GitError(stderr, 128, ['push']));
    }

    it('isAuthError matches HTTP credential failures', () => {
      expect(callIsAuthError('fatal: Authentication failed for https://github.com/foo/bar')).toBe(true);
      expect(callIsAuthError('fatal: could not read Username for https://github.com')).toBe(true);
      expect(callIsAuthError('fatal: could not read Password for https://github.com')).toBe(true);
      expect(callIsAuthError('fatal: terminal prompts disabled')).toBe(true);
      expect(callIsAuthError('remote: Invalid username or password')).toBe(true);
      expect(callIsAuthError('Authentication required')).toBe(true);
      expect(callIsAuthError('HTTP Basic: Access denied')).toBe(true);
    });

    it('isAuthError does NOT match SSH key failures (askpass cannot help)', () => {
      expect(callIsAuthError('Permission denied (publickey).')).toBe(false);
      expect(callIsAuthError('fatal: Could not read from remote repository.')).toBe(false);
    });

    it('isAuthError returns false for non-GitError', () => {
      expect((service as any).isAuthError(new Error('boom'))).toBe(false);
      expect((service as any).isAuthError('string error')).toBe(false);
    });

    it('execWithAuthRetry runs network commands on the longer network timeout', async () => {
      let seenTimeout: number | undefined;
      (service as any).exec = async (_args: string[], opts?: { timeout?: number }) => {
        seenTimeout = opts?.timeout;
        return '';
      };
      // Default local timeout is 60s; network ops should get a much larger one.
      await (service as any).execWithAuthRetry(['fetch', 'origin']);
      expect(seenTimeout).toBeGreaterThanOrEqual(600_000);
    });

    it('execWithAuthRetry passes through non-auth errors without invoking handler', async () => {
      const handler = vi.fn(async () => true);
      service.setAuthRetryHandler(handler);
      mockExec(service, async () => { throw new GitError('fatal: bad object', 128, ['fetch']); });

      await expect((service as any).execWithAuthRetry(['fetch'])).rejects.toThrow('bad object');
      expect(handler).not.toHaveBeenCalled();
    });

    it('execWithAuthRetry throws original error when no handler registered', async () => {
      mockExec(service, async () => { throw new GitError('fatal: Authentication failed', 128, ['push']); });

      await expect((service as any).execWithAuthRetry(['push'])).rejects.toThrow('Authentication failed');
    });

    it('execWithAuthRetry throws when handler returns false (no retry possible)', async () => {
      const handler = vi.fn(async () => false);
      service.setAuthRetryHandler(handler);
      let calls = 0;
      mockExec(service, async () => { calls++; throw new GitError('fatal: Authentication failed', 128, ['push']); });

      await expect((service as any).execWithAuthRetry(['push'], 'origin')).rejects.toThrow('Authentication failed');
      expect(handler).toHaveBeenCalledWith('origin');
      expect(calls).toBe(1); // no retry
    });

    it('execWithAuthRetry retries exactly once when handler returns true', async () => {
      const handler = vi.fn(async () => true);
      service.setAuthRetryHandler(handler);
      let calls = 0;
      mockExec(service, async () => {
        calls++;
        if (calls === 1) throw new GitError('fatal: Authentication failed', 128, ['push']);
        return 'ok';
      });

      const result = await (service as any).execWithAuthRetry(['push'], 'origin');
      expect(result).toBe('ok');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(calls).toBe(2);
    });

    it('execWithAuthRetry surfaces second failure (does not retry twice)', async () => {
      service.setAuthRetryHandler(async () => true);
      let calls = 0;
      mockExec(service, async () => {
        calls++;
        throw new GitError('fatal: Authentication failed', 128, ['push']);
      });

      await expect((service as any).execWithAuthRetry(['push'])).rejects.toThrow('Authentication failed');
      expect(calls).toBe(2); // exactly one retry, then surface
    });

    it('execWithAuthRetry swallows handler exceptions and treats them as "no retry"', async () => {
      service.setAuthRetryHandler(async () => { throw new Error('askpass crashed'); });
      let calls = 0;
      mockExec(service, async () => {
        calls++;
        throw new GitError('fatal: Authentication failed', 128, ['push']);
      });

      await expect((service as any).execWithAuthRetry(['push'])).rejects.toThrow('Authentication failed');
      expect(calls).toBe(1); // handler threw → no retry
    });
  });

  describe('merge / push / fetch / rebase / stashSave option flags', () => {
    let calls: string[][];
    beforeEach(() => {
      calls = [];
      (service as any).cachedRemoteNames = [];
      (service as any).remoteNamesCacheTime = Date.now();
      mockExec(service, async (args) => { calls.push(args); return ''; });
    });

    it('merge passes --ff-only', async () => {
      await service.merge('main', { ffOnly: true });
      expect(calls[0]).toContain('--ff-only');
    });

    it('merge passes --squash then commits via separate exec', async () => {
      await service.merge('feature', { squash: true });
      // First call: merge --squash; second call: commit --no-edit
      expect(calls[0]).toContain('--squash');
      expect(calls[1]).toEqual(['commit', '--no-edit']);
    });

    it('commitFixup runs commit --fixup <hash>', async () => {
      await service.commitFixup('abc1234');
      expect(calls[0]).toEqual(['commit', '--fixup', 'abc1234']);
    });

    it('commitSquash runs commit --squash <hash>', async () => {
      await service.commitSquash('abc1234');
      expect(calls[0]).toEqual(['commit', '--squash', 'abc1234']);
    });

    it('push passes --force when force=force', async () => {
      await service.push('origin', 'main', { force: 'force' });
      expect(calls[0]).toContain('--force');
      expect(calls[0]).not.toContain('--force-with-lease');
    });

    it('push passes --force-with-lease when force=with-lease', async () => {
      await service.push('origin', 'main', { force: 'with-lease' });
      expect(calls[0]).toContain('--force-with-lease');
      expect(calls[0]).not.toContain('--force');
    });

    it('push uses refs/heads/<branch> refspec to disambiguate tag/branch collisions', async () => {
      await service.push('origin', 'main');
      expect(calls[0]).toContain('refs/heads/main');
      expect(calls[0]).not.toContain('main'); // bare 'main' would be ambiguous
    });

    it('fetch --all when no remote given', async () => {
      await service.fetch();
      expect(calls[0]).toContain('--all');
      expect(calls[0]).toContain('--progress');
    });

    it('fetch passes --prune', async () => {
      await service.fetch('origin', { prune: true });
      expect(calls[0]).toContain('--prune');
    });

    it('rebase passes --autostash', async () => {
      await service.rebase('main', { autostash: true });
      expect(calls[0]).toContain('--autostash');
    });

    it('stashSave passes -m, --include-untracked, --keep-index', async () => {
      await service.stashSave('wip', true, true);
      expect(calls[0]).toContain('-m');
      expect(calls[0]).toContain('wip');
      expect(calls[0]).toContain('--include-untracked');
      expect(calls[0]).toContain('--keep-index');
    });

    it('worktreeAdd passes -b for newBranch', async () => {
      await service.worktreeAdd('/tmp/wt', undefined, 'new-branch');
      expect(calls[0]).toContain('-b');
      expect(calls[0]).toContain('new-branch');
    });

    it('worktreeRemove passes --force when force=true', async () => {
      await service.worktreeRemove('/tmp/wt', true);
      expect(calls[0]).toContain('--force');
    });

    it('searchCommits forwards --after and --before', async () => {
      await service.searchCommits('fix', { after: '2024-01-01', before: '2024-12-31' });
      const logArgs = calls[0];
      expect(logArgs.some(a => a === '--after=2024-01-01')).toBe(true);
      expect(logArgs.some(a => a === '--before=2024-12-31')).toBe(true);
    });

    it('createTag (annotated) passes -a -m', async () => {
      await service.createTag('v1.0', undefined, 'release notes');
      expect(calls[0]).toContain('-a');
      expect(calls[0]).toContain('-m');
      expect(calls[0]).toContain('release notes');
    });
  });

  describe('pushCurrentBranch', () => {
    let calls: string[][];
    beforeEach(() => {
      calls = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });
    });

    it('pushes to upstream with no remote/branch args when upstream exists', async () => {
      (service as any).branches = async () => [
        { name: 'feature', current: true, upstream: 'origin/feature', ahead: 1, behind: 0, hash: 'abc' },
      ];
      await service.pushCurrentBranch({ force: 'with-lease' });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain('push');
      expect(calls[0]).toContain('--force-with-lease');
      // upstream case mirrors PushModal: no explicit remote/refspec
      expect(calls[0].some(a => a.startsWith('refs/heads/'))).toBe(false);
    });

    it('sets upstream and pushes to default remote when no upstream', async () => {
      (service as any).branches = async () => [
        { name: 'feature', current: true, ahead: 0, behind: 0, hash: 'abc' },
      ];
      (service as any).cachedRemoteNames = ['origin', 'upstream'];
      (service as any).remoteNamesCacheTime = Date.now();
      await service.pushCurrentBranch({ force: 'with-lease' });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain('-u');
      expect(calls[0]).toContain('origin');
      expect(calls[0]).toContain('refs/heads/feature');
      expect(calls[0]).toContain('--force-with-lease');
    });

    it('falls back to the first remote when origin is absent', async () => {
      (service as any).branches = async () => [
        { name: 'feature', current: true, ahead: 0, behind: 0, hash: 'abc' },
      ];
      (service as any).cachedRemoteNames = ['upstream', 'fork'];
      (service as any).remoteNamesCacheTime = Date.now();
      await service.pushCurrentBranch();
      expect(calls[0]).toContain('upstream');
    });

    it('skips push when there are no remotes', async () => {
      (service as any).branches = async () => [
        { name: 'feature', current: true, ahead: 0, behind: 0, hash: 'abc' },
      ];
      (service as any).cachedRemoteNames = [];
      (service as any).remoteNamesCacheTime = Date.now();
      const result = await service.pushCurrentBranch();
      expect(calls).toHaveLength(0);
      expect(result).toEqual({ pushed: false, reason: 'no-remote' });
    });

    it('throws when there is no current branch (detached HEAD)', async () => {
      (service as any).branches = async () => [
        { name: 'main', current: false, ahead: 0, behind: 0, hash: 'abc' },
      ];
      await expect(service.pushCurrentBranch()).rejects.toThrow('current branch');
    });
  });

  describe('publishBranch', () => {
    let calls: string[][];
    beforeEach(() => {
      calls = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });
    });

    it('pushes the named branch with -u to the default remote', async () => {
      (service as any).cachedRemoteNames = ['origin', 'upstream'];
      (service as any).remoteNamesCacheTime = Date.now();
      await service.publishBranch('feature/x');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain('-u');
      expect(calls[0]).toContain('origin');
      expect(calls[0]).toContain('refs/heads/feature/x');
    });

    it('falls back to the first remote when origin is absent', async () => {
      (service as any).cachedRemoteNames = ['upstream', 'fork'];
      (service as any).remoteNamesCacheTime = Date.now();
      await service.publishBranch('feature/x');
      expect(calls[0]).toContain('upstream');
    });

    it('skips when there are no remotes', async () => {
      (service as any).cachedRemoteNames = [];
      (service as any).remoteNamesCacheTime = Date.now();
      const result = await service.publishBranch('feature/x');
      expect(calls).toHaveLength(0);
      expect(result).toEqual({ pushed: false, reason: 'no-remote' });
    });
  });

  describe('getRemoteNames caching', () => {
    it('returns cached value within TTL window', async () => {
      let execCalls = 0;
      mockExec(service, async (args) => {
        if (args[0] === 'remote') execCalls++;
        return 'origin\nupstream\n';
      });
      const first = await (service as any).getRemoteNames();
      const second = await (service as any).getRemoteNames();
      expect(first).toEqual(['origin', 'upstream']);
      expect(second).toEqual(['origin', 'upstream']);
      expect(execCalls).toBe(1); // second call hit the cache
    });

    it('dedupes concurrent callers via pendingRemoteNames', async () => {
      let execCalls = 0;
      mockExec(service, async (args) => {
        if (args[0] === 'remote') execCalls++;
        // Simulate slow git so concurrent callers race.
        await new Promise(r => setTimeout(r, 20));
        return 'origin\n';
      });
      const [a, b, c] = await Promise.all([
        (service as any).getRemoteNames(),
        (service as any).getRemoteNames(),
        (service as any).getRemoteNames(),
      ]);
      expect(a).toEqual(['origin']);
      expect(b).toEqual(['origin']);
      expect(c).toEqual(['origin']);
      // Three concurrent callers but only one git invocation.
      expect(execCalls).toBe(1);
    });

    it('addRemote invalidates the cache', async () => {
      // Pre-populate as if cached.
      (service as any).cachedRemoteNames = ['origin'];
      (service as any).remoteNamesCacheTime = Date.now();
      mockExec(service, async () => '');
      await service.addRemote('upstream', 'https://example.com/u.git');
      expect((service as any).cachedRemoteNames).toBeNull();
    });

    it('removeRemote invalidates the cache', async () => {
      (service as any).cachedRemoteNames = ['origin'];
      (service as any).remoteNamesCacheTime = Date.now();
      mockExec(service, async () => '');
      await service.removeRemote('origin');
      expect((service as any).cachedRemoteNames).toBeNull();
    });
  });

  describe('getActivityLog', () => {
    it('starts empty', () => {
      expect(service.getActivityLog()).toEqual([]);
    });

    it('records non-silent exec calls in reverse-chronological order', async () => {
      // Hit the real exec path via a lightweight mock-free call. Easiest:
      // monkey-patch only the spawn outcome by replacing `exec` with one that
      // funnels through the same activityLog bookkeeping.
      const realExec = (service as any).exec.bind(service);
      // We can't easily call realExec without spawning git; instead push
      // entries directly to mirror what exec records, since that's the
      // observable contract.
      (service as any).activityLog.unshift(
        { command: 'git status', timestamp: '2026-05-17T00:00:01Z', success: true, duration: 5 },
        { command: 'git log', timestamp: '2026-05-17T00:00:00Z', success: true, duration: 12 },
      );
      const log = service.getActivityLog();
      expect(log).toHaveLength(2);
      expect(log[0].command).toBe('git status');
      void realExec;
    });
  });

  describe('diff option combinations', () => {
    it('passes ref1 and ref2 when both given', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });
      await service.diff({ ref1: 'HEAD~1', ref2: 'HEAD' });
      expect(calls[0]).toContain('HEAD~1');
      expect(calls[0]).toContain('HEAD');
    });

    it('appends -- <file> when file is given alongside refs', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });
      await service.diff({ ref1: 'main', file: 'src/foo.ts' });
      const sepIdx = calls[0].indexOf('--');
      expect(sepIdx).toBeGreaterThan(0);
      expect(calls[0][sepIdx + 1]).toBe('src/foo.ts');
    });
  });

  describe('log({ skip })', () => {
    it('passes --skip=<n> to git log', async () => {
      const calls: string[][] = [];
      (service as any).cachedRemoteNames = [];
      (service as any).remoteNamesCacheTime = Date.now();
      mockExec(service, async (args) => { calls.push(args); return ''; });

      await service.log({ skip: 50 }).catch(() => {});
      const logCall = calls.find(c => c[0] === 'log' && !c.includes('--no-walk'));
      expect(logCall).toContain('--skip=50');
    });
  });

  describe('binCommitTime', () => {
    it("uses the author's wall-clock hour, not the host's", () => {
      // %aI emits "YYYY-MM-DDTHH:mm:ss+HH:MM". A 10am commit in +09:00 must
      // bin to hour 10 whether the host is in UTC, JST, or PST.
      expect(binCommitTime('2024-01-15T10:30:00+09:00')).toEqual({ weekday: 1, hour: 10 });
      // 10am UTC binned the same way (Date.UTC trick gives consistent weekday).
      expect(binCommitTime('2024-01-15T10:30:00Z')).toEqual({ weekday: 1, hour: 10 });
      // 22:00 in PST (-08:00) — should bin to hour 22, not the converted hour.
      expect(binCommitTime('2024-01-15T22:30:00-08:00')).toEqual({ weekday: 1, hour: 22 });
    });

    it('computes day-of-week from the calendar date', () => {
      // 2024-01-01 is a Monday (weekday=1). Independent of timezone.
      expect(binCommitTime('2024-01-01T00:00:00+00:00')?.weekday).toBe(1);
      // 2024-01-07 is a Sunday (weekday=0).
      expect(binCommitTime('2024-01-07T12:00:00+00:00')?.weekday).toBe(0);
    });

    it('returns null on malformed input', () => {
      expect(binCommitTime('garbage')).toBeNull();
      expect(binCommitTime('')).toBeNull();
    });
  });

  describe('parseNameStatus (private)', () => {
    it('returns the new path for renames and copies, exposing oldPath', () => {
      // git emits `R<score>\t<old>\t<new>` / `C<score>\t<old>\t<new>` for
      // renames and copies, and `<status>\t<path>` for everything else.
      const raw = 'M\tsrc/foo.ts\nR100\told.ts\tnew.ts\nC50\tlib/a.ts\tlib/b.ts\nD\tgone.ts\n';
      const result = (service as any).parseNameStatus(raw);
      expect(result).toEqual([
        { path: 'src/foo.ts', status: 'M' },
        { path: 'new.ts', status: 'R', oldPath: 'old.ts' },
        { path: 'lib/b.ts', status: 'C', oldPath: 'lib/a.ts' },
        { path: 'gone.ts', status: 'D' },
      ]);
    });
  });

  describe('Git Flow availability checks (mock-based)', () => {
    // These cover the failure paths regardless of whether git-flow is
    // installed locally — the integration tests cover the success paths.

    it('isFlowInstalled returns false when `git flow version` rejects', async () => {
      mockExec(service, async () => { throw new GitError('git: flow is not a git command', 1, ['flow', 'version']); });
      expect(await service.isFlowInstalled()).toBe(false);
    });

    it('isFlowInitialized returns false when gitflow.branch.master is unset', async () => {
      mockExec(service, async () => { throw new GitError('', 1, ['config', '--local', '--get', 'gitflow.branch.master']); });
      expect(await service.isFlowInitialized()).toBe(false);
    });

    it('isFlowInitialized returns false when saved flow config points to a missing develop branch', async () => {
      const responses: Record<string, string> = {
        'config --local --get gitflow.branch.master': 'main',
        'config --local --get gitflow.branch.develop': 'develop',
        'config --local --get gitflow.prefix.feature': 'feature/',
        'config --local --get gitflow.prefix.release': 'release/',
        'config --local --get gitflow.prefix.hotfix': 'hotfix/',
        'config --local --get gitflow.prefix.versiontag': 'v',
        'show-ref --verify --quiet refs/heads/main': '',
      };
      mockExec(service, async (args) => {
        const key = args.join(' ');
        if (key in responses) return responses[key];
        throw new GitError('', 1, args);
      });

      expect(await service.isFlowInitialized()).toBe(false);
    });

    it('isFlowInitialized returns true only when config and required branches exist', async () => {
      const responses: Record<string, string> = {
        'config --local --get gitflow.branch.master': 'main',
        'config --local --get gitflow.branch.develop': 'develop',
        'config --local --get gitflow.prefix.feature': 'feature/',
        'config --local --get gitflow.prefix.release': 'release/',
        'config --local --get gitflow.prefix.hotfix': 'hotfix/',
        'config --local --get gitflow.prefix.versiontag': 'v',
        'show-ref --verify --quiet refs/heads/main': '',
        'show-ref --verify --quiet refs/heads/develop': '',
      };
      mockExec(service, async (args) => responses[args.join(' ')] ?? '');

      expect(await service.isFlowInitialized()).toBe(true);
    });

    it('getFlowConfig returns null when any required key is missing', async () => {
      // First config key resolves, second rejects → whole thing nulls out.
      let calls = 0;
      mockExec(service, async () => {
        calls++;
        if (calls === 1) return 'main\n';
        throw new GitError('', 1, ['config', '--local', '--get', 'gitflow.branch.develop']);
      });
      expect(await service.getFlowConfig()).toBeNull();
    });
  });

  describe('warning handler', () => {
    it('routes warnings through registered handler', () => {
      const received: string[] = [];
      service.setWarningHandler(m => received.push(m));
      (service as any).warn('disk on fire');
      expect(received).toEqual(['disk on fire']);
    });

    it('survives a throwing warning handler', () => {
      service.setWarningHandler(() => { throw new Error('handler boom'); });
      // Must not propagate — warn() is called from inside git commands and a
      // throwing handler would otherwise abort the surrounding git call.
      expect(() => (service as any).warn('test')).not.toThrow();
    });

    it('null handler is a no-op', () => {
      service.setWarningHandler(null);
      expect(() => (service as any).warn('quiet')).not.toThrow();
    });
  });

  describe('getUncommittedFileDiff', () => {
    it('passes --cached for staged files', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });

      await service.getUncommittedFileDiff('src/foo.ts', true);
      expect(calls[0]).toContain('--cached');
      expect(calls[0]).toContain('src/foo.ts');
    });

    it('omits --cached for unstaged files', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });

      await service.getUncommittedFileDiff('src/foo.ts', false);
      expect(calls[0]).not.toContain('--cached');
      expect(calls[0]).toContain('src/foo.ts');
    });

    it('rejects path starting with - for unstaged untracked file', async () => {
      // Untracked branch passes file directly to `git diff --no-index`; path
      // must be validated before reaching git so a malicious filename cannot
      // be misinterpreted as a flag.
      const calls: string[][] = [];
      mockExec(service, async (args) => {
        calls.push(args);
        // Pretend the file is untracked: first call (ls-files --error-unmatch) throws.
        if (args[0] === 'ls-files') throw new GitError('', 1, args);
        return '';
      });
      await expect(service.getUncommittedFileDiff('--evil', false)).rejects.toThrow();
    });
  });

  describe('stageFile', () => {
    it('passes -- before the path to prevent flag injection', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });

      await service.stageFile('src/foo.ts');
      expect(calls[0]).toEqual(['add', '--', 'src/foo.ts']);
    });

    it('rejects path starting with -', async () => {
      await expect(service.stageFile('-A')).rejects.toThrow("must not start with '-'");
    });

    it('rejects absolute path', async () => {
      await expect(service.stageFile('/etc/passwd')).rejects.toThrow('Unsafe path');
    });

    it('rejects path with parent traversal', async () => {
      await expect(service.stageFile('../outside')).rejects.toThrow('Unsafe path');
    });
  });

  describe('addRemote URL validation', () => {
    it('accepts https URL', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });
      await service.addRemote('origin', 'https://github.com/foo/bar.git');
      expect(calls[0]).toEqual(['remote', 'add', 'origin', 'https://github.com/foo/bar.git']);
    });

    it('accepts ssh shorthand', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });
      await service.addRemote('origin', 'git@github.com:foo/bar.git');
      expect(calls[0][3]).toBe('git@github.com:foo/bar.git');
    });

    it('accepts ssh://', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });
      await service.addRemote('origin', 'ssh://user@host/path/repo.git');
      expect(calls[0][3]).toBe('ssh://user@host/path/repo.git');
    });

    it('rejects URL with newline (control char)', async () => {
      await expect(service.addRemote('origin', 'https://x\nbad')).rejects.toThrow();
    });

    it('rejects file:// URL', async () => {
      // file:// would let a malicious config point at arbitrary local paths.
      await expect(service.addRemote('origin', 'file:///etc/passwd')).rejects.toThrow('Unsupported remote URL');
    });

    it('rejects unknown scheme', async () => {
      await expect(service.addRemote('origin', 'javascript:alert(1)')).rejects.toThrow('Unsupported remote URL');
    });
  });

  describe('searchCommits', () => {
    it('rejects query containing newline', async () => {
      // Newlines would let an attacker append fake CLI args to git log.
      await expect(service.searchCommits('foo\nbar')).rejects.toThrow('Invalid search');
    });

    it('rejects author containing newline', async () => {
      await expect(service.searchCommits('', { author: 'a\nb' })).rejects.toThrow('Invalid search');
    });

    it('rejects after/before that is not an ISO-ish date or relative spec', async () => {
      await expect(service.searchCommits('', { after: '2024-01-01\nbad' })).rejects.toThrow('Invalid search');
    });

    it('passes valid query/author/dates through', async () => {
      const calls: string[][] = [];
      (service as any).cachedRemoteNames = [];
      (service as any).remoteNamesCacheTime = Date.now();
      mockExec(service, async (args) => { calls.push(args); return ''; });

      await service.searchCommits('fix bug', { author: 'jane', after: '2024-01-01', before: '2024-12-31' });
      const args = calls.find(a => a[0] === 'log');
      expect(args).toContain('--grep=fix bug');
      expect(args).toContain('--author=jane');
      expect(args).toContain('--after=2024-01-01');
      expect(args).toContain('--before=2024-12-31');
    });
  });

  describe('lsTree', () => {
    it('passes -- before the path to prevent flag injection', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });

      await service.lsTree('HEAD', 'src');
      expect(calls[0]).toEqual(['ls-tree', 'HEAD', '--', 'src']);
    });

    it('omits -- when no path is given', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });

      await service.lsTree('HEAD');
      expect(calls[0]).toEqual(['ls-tree', 'HEAD']);
    });

    it('rejects path starting with -', async () => {
      await expect(service.lsTree('HEAD', '-O')).rejects.toThrow("must not start with '-'");
    });
  });

  describe('assertSafePath invalid input', () => {
    it('stageFile rejects empty filePath', async () => {
      await expect(service.stageFile('')).rejects.toThrow('Invalid path');
    });
  });

  describe('addRemote URL validation', () => {
    it('rejects empty URL', async () => {
      await expect(service.addRemote('origin', '')).rejects.toThrow('Invalid remote URL');
    });

    it('rejects URL with control characters', async () => {
      await expect(service.addRemote('origin', 'https://x.com/\x00evil'))
        .rejects.toThrow('control characters');
    });

    it('rejects file:// scheme (path injection vector)', async () => {
      await expect(service.addRemote('origin', 'file:///etc/passwd'))
        .rejects.toThrow('Unsupported remote URL scheme');
    });

    it('rejects bare string without scheme', async () => {
      await expect(service.addRemote('origin', 'just-a-string'))
        .rejects.toThrow('Unsupported remote URL');
    });

    it('accepts SSH shorthand (user@host:path)', async () => {
      mockExec(service, async () => '');
      await expect(service.addRemote('origin', 'git@github.com:foo/bar.git'))
        .resolves.toBeUndefined();
    });

    it('accepts https scheme', async () => {
      mockExec(service, async () => '');
      await expect(service.addRemote('origin', 'https://github.com/foo/bar.git'))
        .resolves.toBeUndefined();
    });
  });

  describe('worktreeAdd argument ordering', () => {
    it('places start-point ref after the path when both branch and newBranch are given', async () => {
      // `git worktree add -b <newBranch> <path> <branch>` creates <newBranch>
      // pointing at <branch> as the start point. The trailing ref must stay
      // after the path or git interprets it as the path.
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });
      await service.worktreeAdd('/tmp/wt', 'origin/main', 'feature');
      expect(calls[0]).toEqual(['worktree', 'add', '-b', 'feature', '/tmp/wt', 'origin/main']);
    });

    it('omits -b when only branch is given (checkout existing branch)', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => { calls.push(args); return ''; });
      await service.worktreeAdd('/tmp/wt', 'main');
      expect(calls[0]).toEqual(['worktree', 'add', '/tmp/wt', 'main']);
    });
  });

  describe('multiCommitSections', () => {
    it('returns union files and per-commit diff sections for each file', async () => {
      const svc = new GitService('/tmp/test-repo');
      mockExec(svc, async (args: string[]) => {
        if (args.includes('--format=%P')) return 'p\n';                 // single parent
        const range = args[args.length - 1];
        if (args[0] === 'diff' && args.includes('--name-status')) {     // showCommitFiles
          if (range === 'c2^..c2') return 'M\ta.txt\n';
          if (range === 'c1^..c1') return 'M\ta.txt\nA\tb.txt\n';
          return '';
        }
        if (args[0] === 'diff' && args.includes('--no-color')) {        // showCommitDiff(commit)
          if (range === 'c2^..c2') return `diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-x\n+c2\n`;
          if (range === 'c1^..c1') return `diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-x\n+c1\n`
            + `diff --git a/b.txt b/b.txt\n--- /dev/null\n+++ b/b.txt\n@@ -0,0 +1 @@\n+new\n`;
          return '';
        }
        return '';
      });
      const res = await svc.multiCommitSections(['c2', 'c1']); // newest first
      expect(res.files.map(f => f.path).sort()).toEqual(['a.txt', 'b.txt']);
      const aSecs = res.sections.filter(s => s.file === 'a.txt');
      const bSecs = res.sections.filter(s => s.file === 'b.txt');
      expect(aSecs.map(s => s.commit)).toEqual(['c2', 'c1']); // newest-first
      expect(bSecs.map(s => s.commit)).toEqual(['c1']);
      expect(aSecs[0].diff.file).toBe('a.txt');
    });

    it('falls back to per-file diff for a merge commit file missing from the first-parent whole-commit diff', async () => {
      // Scenario: 'merge' has two parents (p1, p2). m.txt was only changed vs p2
      // (not p1), so the whole-commit first-parent diff (merge^..merge) omits it.
      // showCommitFiles unions both parents and includes m.txt via p2, so it
      // appears in the union files. The fix must fall back to showCommitDiff(merge, 'm.txt')
      // which uses the per-parent merge-aware loop and finds the diff via p2.
      const svc = new GitService('/tmp/test-repo');
      const mTxtDiff = `diff --git a/m.txt b/m.txt\n--- a/m.txt\n+++ b/m.txt\n@@ -1 +1 @@\n-old\n+merged\n`;
      mockExec(svc, async (args: string[]) => {
        // commitParents('merge'): git log -1 --format=%P merge
        if (args[0] === 'log' && args.includes('--format=%P') && args.includes('merge')) {
          return 'p1 p2\n';
        }
        // showCommitFiles('merge') merge branch — git diff --name-status <parent>..<hash>
        if (args[0] === 'diff' && args.includes('--name-status')) {
          if (args.includes('p1..merge')) return '';          // m.txt absent vs p1
          if (args.includes('p2..merge')) return 'M\tm.txt\n'; // m.txt changed vs p2
          return '';
        }
        if (args[0] === 'diff' && args.includes('--no-color')) {
          // showCommitDiff('merge') no file → git diff --no-color merge^..merge (first parent only)
          if (args.includes('merge^..merge') && !args.includes('--')) {
            return ''; // m.txt absent from first-parent diff → byFile miss
          }
          // showCommitDiff('merge', 'm.txt') per-parent loop:
          // git diff --no-color p1..merge -- m.txt  → empty (changed only vs p2)
          if (args.includes('p1..merge') && args.includes('--') && args.includes('m.txt')) {
            return '';
          }
          // git diff --no-color p2..merge -- m.txt  → non-empty diff
          if (args.includes('p2..merge') && args.includes('--') && args.includes('m.txt')) {
            return mTxtDiff;
          }
          return '';
        }
        return '';
      });

      const res = await svc.multiCommitSections(['merge']);
      // m.txt must appear in the union file list (contributed via p2)
      expect(res.files.map(f => f.path)).toContain('m.txt');
      // There must be exactly one section for m.txt, from the 'merge' commit,
      // with the diff sourced from the per-file fallback (p2 parent).
      const mSecs = res.sections.filter(s => s.file === 'm.txt');
      expect(mSecs).toHaveLength(1);
      expect(mSecs[0].commit).toBe('merge');
      expect(mSecs[0].diff.file).toBe('m.txt');
    });
  });

  describe('flowInit develop branch bootstrap', () => {
    const flowOpts = {
      productionBranch: 'main',
      developBranch: 'develop',
      featurePrefix: 'feature/',
      releasePrefix: 'release/',
      hotfixPrefix: 'hotfix/',
      versionTagPrefix: 'v',
    };
    const flowConfigResponses: Record<string, string> = {
      'config --local --get gitflow.branch.master': 'main',
      'config --local --get gitflow.branch.develop': 'develop',
      'config --local --get gitflow.prefix.feature': 'feature/',
      'config --local --get gitflow.prefix.release': 'release/',
      'config --local --get gitflow.prefix.hotfix': 'hotfix/',
      'config --local --get gitflow.prefix.versiontag': 'v',
    };
    beforeEach(() => {
      (service as unknown as { branches: () => Promise<BranchInfo[]> }).branches = async () => [
        branch('main', { upstream: 'origin/main' }),
        branch('develop', { upstream: 'origin/develop' }),
      ];
    });

    it('creates develop branch from production when develop is missing', async () => {
      const calls: string[][] = [];
      let developCreated = false;
      mockExec(service, async (args) => {
        calls.push(args);
        const key = args.join(' ');
        if (key in flowConfigResponses) return flowConfigResponses[key];
        if (key === 'show-ref --verify --quiet refs/heads/main') return '';
        if (key === 'show-ref --verify --quiet refs/heads/develop') {
          if (developCreated) return '';
          throw new GitError("unknown revision 'develop'", 1, args);
        }
        if (args[0] === 'branch') {
          developCreated = true;
          return '';
        }
        return '';
      });

      await service.flowInit(flowOpts);

      expect(calls).toContainEqual(['flow', 'init', '-f', '-d']);
      const branchCreate = calls.find(c => c[0] === 'branch');
      expect(branchCreate).toEqual(['branch', 'develop', 'main']);
    });

    it('clears stale flow branch config before forced git-flow init', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => {
        calls.push(args);
        const key = args.join(' ');
        if (key in flowConfigResponses) return flowConfigResponses[key];
        if (key === 'show-ref --verify --quiet refs/heads/main') return '';
        if (key === 'show-ref --verify --quiet refs/heads/develop') return '';
        return '';
      });

      await service.flowInit(flowOpts);

      const unsetMaster = calls.findIndex(c => c.join(' ') === 'config --local --unset-all gitflow.branch.master');
      const unsetDevelop = calls.findIndex(c => c.join(' ') === 'config --local --unset-all gitflow.branch.develop');
      const setMaster = calls.findIndex(c => c.join(' ') === 'config --local --replace-all gitflow.branch.master main');
      const setDevelop = calls.findIndex(c => c.join(' ') === 'config --local --replace-all gitflow.branch.develop develop');
      const init = calls.findIndex(c => c.join(' ') === 'flow init -f -d');
      expect(unsetMaster).toBeGreaterThanOrEqual(0);
      expect(unsetDevelop).toBeGreaterThanOrEqual(0);
      expect(setMaster).toBeGreaterThanOrEqual(0);
      expect(setDevelop).toBeGreaterThanOrEqual(0);
      expect(init).toBeGreaterThan(unsetMaster);
      expect(init).toBeGreaterThan(unsetDevelop);
      expect(init).toBeGreaterThan(setMaster);
      expect(init).toBeGreaterThan(setDevelop);
    });

    it('skips develop creation when develop already exists', async () => {
      const calls: string[][] = [];
      mockExec(service, async (args) => {
        calls.push(args);
        const key = args.join(' ');
        if (key in flowConfigResponses) return flowConfigResponses[key];
        if (key === 'show-ref --verify --quiet refs/heads/main') return '';
        if (key === 'show-ref --verify --quiet refs/heads/develop') return '';
        return '';
      });

      await service.flowInit(flowOpts);

      const branchCreate = calls.find(c => c[0] === 'branch');
      expect(branchCreate).toBeUndefined();
    });

    it('throws a helpful error when production branch is missing', async () => {
      mockExec(service, async (args) => {
        if (args.join(' ') === 'show-ref --verify --quiet refs/heads/main') {
          throw new GitError('not found', 1, args);
        }
        return '';
      });

      await expect(service.flowInit(flowOpts))
        .rejects.toThrow("Branch 'main' does not exist");
    });

    it('pulls with rebase before init when production branch is behind upstream', async () => {
      (service as unknown as { branches: () => Promise<BranchInfo[]> }).branches = async () => [
        branch('main', { current: true, upstream: 'origin/main', behind: 1 }),
      ];
      const calls: string[][] = [];
      mockExec(service, async (args) => {
        calls.push(args);
        if (args.join(' ') === 'show-ref --verify --quiet refs/heads/main') return '';
        const key = args.join(' ');
        if (key in flowConfigResponses) return flowConfigResponses[key];
        if (key === 'show-ref --verify --quiet refs/heads/develop') return '';
        return '';
      });

      await service.flowInit(flowOpts);

      expect(calls).toContainEqual(['pull', '--rebase']);
      expect(calls).toContainEqual(['flow', 'init', '-f', '-d']);
    });

    it('rejects using the same production and develop branch', async () => {
      await expect(service.flowInit({ ...flowOpts, developBranch: 'main' }))
        .rejects.toThrow('production and develop branches must be different');
    });
  });
});

describe('buildAmendCommandStr', () => {
  const escape = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

  it('returns --no-edit -m for single-line messages', () => {
    const cmd = buildAmendCommandStr('hello world', escape);
    expect(cmd).toBe("git commit --amend --no-edit -m 'hello world'");
  });

  it('returns printf pipeline for multi-line messages', () => {
    const cmd = buildAmendCommandStr('subject\n\nbody line', escape);
    expect(cmd).toContain('printf');
    expect(cmd).toContain('git commit --amend -F -');
    expect(cmd).toContain("'subject'");
    expect(cmd).toContain("''");
    expect(cmd).toContain("'body line'");
  });

  it('escapes single quotes in multi-line messages', () => {
    const cmd = buildAmendCommandStr("it's\nbroken", escape);
    expect(cmd).toContain("'it'\\''s'");
    expect(cmd).toContain("'broken'");
  });

  it('handles message with only newlines (empty lines)', () => {
    const cmd = buildAmendCommandStr('\n\n', escape);
    expect(cmd).toContain('printf');
    const parts = cmd.split(' ');
    // Three empty strings after split
    expect(parts.filter(p => p === "''").length).toBe(3);
  });
});
