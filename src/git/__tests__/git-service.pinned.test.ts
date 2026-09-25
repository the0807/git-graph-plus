import { describe, it, expect, beforeEach } from 'vitest';
import { GitService } from '../git-service';

// Access private exec method via prototype for mocking (same helper pattern as
// git-service.test.ts).
function mockExec(service: GitService, fn: (args: string[]) => Promise<string>) {
  (service as any).exec = fn;
}

const HASH = 'abcdef1234567890abcdef1234567890abcdef12';

// Mirrors the log format's field layout: record sentinel + NUL-separated
// fields (hash, short, author, author email, author date, committer,
// committer email, committer date, subject, parents, refs, body).
function record(over: Partial<Record<string, string>> = {}): string {
  const f = {
    hash: HASH,
    short: HASH.slice(0, 7),
    an: 'Ann',
    ae: 'ann@example.com',
    ad: '2024-01-02T03:04:05+00:00',
    cn: 'Committer',
    ce: 'c@example.com',
    cd: '2024-01-02T03:04:05+00:00',
    subject: 'pinned commit',
    parents: '1111111111111111111111111111111111111111',
    refs: '',
    body: '',
    ...over,
  };
  return '\x01\x02\x03' + [f.hash, f.short, f.an, f.ae, f.ad, f.cn, f.ce, f.cd, f.subject, f.parents, f.refs, f.body].join('\x00');
}

describe('GitService.logPinnedCommit', () => {
  let service: GitService;
  let calls: string[][];

  beforeEach(() => {
    service = new GitService('/tmp/test-repo');
    calls = [];
    (service as any).cachedRemoteNames = [];
    (service as any).remoteNamesCacheTime = Date.now();
  });

  it('rejects a hash starting with "-" (option injection)', async () => {
    mockExec(service, async (args) => { calls.push(args); return ''; });
    await expect(service.logPinnedCommit('-evil', 10)).rejects.toThrow("must not start with '-'");
    expect(calls).toEqual([]);
  });

  it('rejects a non-hex hash', async () => {
    mockExec(service, async (args) => { calls.push(args); return ''; });
    await expect(service.logPinnedCommit('not-a-sha', 10)).rejects.toThrow('Invalid commit hash');
    expect(calls).toEqual([]);
  });

  it('rejects an empty hash', async () => {
    mockExec(service, async (args) => { calls.push(args); return ''; });
    await expect(service.logPinnedCommit('', 10)).rejects.toThrow('Invalid ref');
    expect(calls).toEqual([]);
  });

  it('walks from the hash as the sole start point with --max-count and no globs/--all', async () => {
    mockExec(service, async (args) => { calls.push(args); return ''; });

    await service.logPinnedCommit(HASH, 25);

    const logCall = calls.find(c => c[0] === 'log')!;
    expect(logCall).toBeDefined();
    expect(logCall).toContain(HASH);
    expect(logCall).toContain('--max-count=25');
    expect(logCall).not.toContain('--all');
    expect(logCall).not.toContain('--no-walk');
    expect(logCall.some(a => a.startsWith('--glob='))).toBe(false);
    // Apart from the format/max-count options, the hash is the only revision.
    const revs = logCall.filter(a =>
      a !== 'log' && !a.startsWith('--format=') && !a.startsWith('--max-count='));
    expect(revs).toEqual([HASH]);
  });

  it('uses the same --format string as log()', async () => {
    mockExec(service, async (args) => { calls.push(args); return ''; });

    await service.log({ branch: 'main' });
    const normalFormat = calls.find(c => c[0] === 'log' && !c.includes('--no-walk'))!
      .find(a => a.startsWith('--format='));

    calls = [];
    await service.logPinnedCommit(HASH, 5);
    const pinnedFormat = calls.find(c => c[0] === 'log')!.find(a => a.startsWith('--format='));

    expect(normalFormat).toBeDefined();
    expect(pinnedFormat).toBe(normalFormat);
  });

  it('parses the pinned log output into commits', async () => {
    mockExec(service, async (args) => {
      calls.push(args);
      return record({ refs: 'HEAD -> main' });
    });

    const commits = await service.logPinnedCommit(HASH, 5);

    expect(commits).toHaveLength(1);
    expect(commits[0].hash).toBe(HASH);
    expect(commits[0].abbreviatedHash).toBe(HASH.slice(0, 7));
    expect(commits[0].subject).toBe('pinned commit');
    expect(commits[0].parents).toEqual(['1111111111111111111111111111111111111111']);
    expect(commits[0].refs).toEqual([{ type: 'head', name: 'main' }]);
  });

  it('returns an empty result when git produces no output', async () => {
    mockExec(service, async () => '');
    await expect(service.logPinnedCommit(HASH, 5)).resolves.toEqual([]);
  });
});
