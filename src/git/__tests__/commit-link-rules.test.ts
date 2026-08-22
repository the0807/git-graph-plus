import { describe, it, expect } from 'vitest';
import {
  parseRemoteHost,
  remoteUrlToRepositoryWebUrl,
  buildBuiltinRules,
  resolveCommitLinkRules,
  type LinkRule,
} from '../commit-link-rules';

describe('parseRemoteHost', () => {
  it('parses ssh shorthand', () => {
    expect(parseRemoteHost('git@github.com:owner/repo.git')).toEqual({
      host: 'github.com', owner: 'owner', repo: 'repo',
    });
  });
  it('parses https with .git', () => {
    expect(parseRemoteHost('https://github.com/owner/repo.git')).toEqual({
      host: 'github.com', owner: 'owner', repo: 'repo',
    });
  });
  it('parses https without .git', () => {
    expect(parseRemoteHost('https://gitlab.com/grp/proj')).toEqual({
      host: 'gitlab.com', owner: 'grp', repo: 'proj',
    });
  });
  it('parses ssh:// url form', () => {
    expect(parseRemoteHost('ssh://git@github.com/owner/repo.git')).toEqual({
      host: 'github.com', owner: 'owner', repo: 'repo',
    });
  });
  it('returns null for malformed url', () => {
    expect(parseRemoteHost('not a url')).toBeNull();
    expect(parseRemoteHost('')).toBeNull();
  });
});

describe('remoteUrlToRepositoryWebUrl', () => {
  it('converts ssh shorthand to an https repository URL', () => {
    expect(remoteUrlToRepositoryWebUrl('git@github.com:owner/repo.git')).toBe('https://github.com/owner/repo');
  });

  it('converts https remote URLs and strips the trailing .git suffix', () => {
    expect(remoteUrlToRepositoryWebUrl('https://github.com/owner/repo.git')).toBe('https://github.com/owner/repo');
  });

  it('keeps nested owner/group paths', () => {
    expect(remoteUrlToRepositoryWebUrl('ssh://git@gitlab.com/group/subgroup/repo.git')).toBe('https://gitlab.com/group/subgroup/repo');
  });

  it('returns null for an unparseable remote URL', () => {
    expect(remoteUrlToRepositoryWebUrl('not a url')).toBeNull();
    expect(remoteUrlToRepositoryWebUrl(null)).toBeNull();
  });
});

describe('buildBuiltinRules', () => {
  it('builds github issue rule plus the always-on MR rule', () => {
    expect(buildBuiltinRules('git@github.com:owner/repo.git')).toEqual<LinkRule[]>([
      { pattern: '!(\\d+)', url: 'https://github.com/owner/repo/-/merge_requests/$1' },
      { pattern: '#(\\d+)', url: 'https://github.com/owner/repo/issues/$1' },
    ]);
  });
  it('builds gitlab issue + MR rules', () => {
    expect(buildBuiltinRules('https://gitlab.com/grp/proj.git')).toEqual<LinkRule[]>([
      { pattern: '!(\\d+)', url: 'https://gitlab.com/grp/proj/-/merge_requests/$1' },
      { pattern: '#(\\d+)', url: 'https://gitlab.com/grp/proj/-/issues/$1' },
    ]);
  });
  it('builds only the MR rule for a self-hosted host (! is GitLab-only)', () => {
    expect(buildBuiltinRules('git@git.company.com:owner/repo.git')).toEqual<LinkRule[]>([
      { pattern: '!(\\d+)', url: 'https://git.company.com/owner/repo/-/merge_requests/$1' },
    ]);
  });
  it('returns empty for an unparseable remote', () => {
    expect(buildBuiltinRules('not a url')).toEqual([]);
  });
  it('returns empty for null remote', () => {
    expect(buildBuiltinRules(null)).toEqual([]);
  });
});

describe('resolveCommitLinkRules', () => {
  const custom = [{ pattern: '([A-Z]+-\\d+)', url: 'https://jira/browse/$1' }];

  it('puts custom rules before built-in rules', () => {
    const rules = resolveCommitLinkRules(custom, true, 'git@github.com:o/r.git');
    expect(rules).toEqual<LinkRule[]>([
      { pattern: '([A-Z]+-\\d+)', url: 'https://jira/browse/$1' },
      { pattern: '!(\\d+)', url: 'https://github.com/o/r/-/merge_requests/$1' },
      { pattern: '#(\\d+)', url: 'https://github.com/o/r/issues/$1' },
    ]);
  });
  it('omits built-in rules when autoDetect is false', () => {
    expect(resolveCommitLinkRules(custom, false, 'git@github.com:o/r.git')).toEqual(custom);
  });
  it('skips invalid custom entries', () => {
    const raw = [
      { pattern: '#(\\d+)', url: 'https://x/$1' },
      { pattern: '(', url: 'https://bad' },        // invalid regex
      { pattern: 123, url: 'https://y' },           // non-string pattern
      { nope: true },                               // wrong shape
    ];
    expect(resolveCommitLinkRules(raw, false, null)).toEqual([
      { pattern: '#(\\d+)', url: 'https://x/$1' },
    ]);
  });
  it('returns empty for empty config and no remote', () => {
    expect(resolveCommitLinkRules([], true, null)).toEqual([]);
    expect(resolveCommitLinkRules(undefined, true, null)).toEqual([]);
  });
});
