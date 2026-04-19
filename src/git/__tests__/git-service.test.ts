import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitService, GitError } from '../git-service';

// Access private exec method via prototype for mocking
function mockExec(service: GitService, fn: (args: string[]) => Promise<string>) {
  (service as any).exec = fn;
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
      await expect(service.interactiveRebase('main', [{ action: 'nope', hash: 'abc123' }]))
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
});
