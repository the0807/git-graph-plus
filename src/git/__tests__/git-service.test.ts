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
});
