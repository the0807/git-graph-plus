import { describe, it, expect } from 'vitest';
import { parseLog, parseRefs, parseBranches, parseTags, parseRemotes, parseStashList, parseDiff, parseWorktreeList, parseLfsFiles, parseLfsLocks } from '../git-parser';

describe('parseLog', () => {
  it('should return empty array for empty input', () => {
    expect(parseLog('')).toEqual([]);
    expect(parseLog('   ')).toEqual([]);
  });

  it('should parse a single commit', () => {
    const raw = '\x01abc123def456\x00abc123d\x00Alice\x00alice@example.com\x002024-01-15T10:30:00+09:00\x00Alice\x00alice@example.com\x002024-01-15T10:30:00+09:00\x00Initial commit\x00\x00';
    const result = parseLog(raw);

    expect(result).toHaveLength(1);
    expect(result[0].hash).toBe('abc123def456');
    expect(result[0].abbreviatedHash).toBe('abc123d');
    expect(result[0].author.name).toBe('Alice');
    expect(result[0].author.email).toBe('alice@example.com');
    expect(result[0].subject).toBe('Initial commit');
    expect(result[0].parents).toEqual([]);
  });

  it('should parse multiple commits', () => {
    const raw =
      '\x01aaa111\x00aaa\x00Alice\x00a@x.com\x002024-01-02\x00Alice\x00a@x.com\x002024-01-02\x00Second commit\x00bbb222\x00' +
      '\x01bbb222\x00bbb\x00Bob\x00b@x.com\x002024-01-01\x00Bob\x00b@x.com\x002024-01-01\x00First commit\x00\x00';
    const result = parseLog(raw);

    expect(result).toHaveLength(2);
    expect(result[0].hash).toBe('aaa111');
    expect(result[0].parents).toEqual(['bbb222']);
    expect(result[1].hash).toBe('bbb222');
    expect(result[1].parents).toEqual([]);
  });

  it('should parse merge commit with multiple parents', () => {
    const raw = '\x01merge1\x00mer\x00Alice\x00a@x.com\x002024-01-03\x00Alice\x00a@x.com\x002024-01-03\x00Merge branch\x00parent1 parent2\x00';
    const result = parseLog(raw);

    expect(result).toHaveLength(1);
    expect(result[0].parents).toEqual(['parent1', 'parent2']);
  });

  it('should parse refs with known remotes', () => {
    const raw = '\x01abc123\x00abc\x00Alice\x00a@x.com\x002024-01-01\x00Alice\x00a@x.com\x002024-01-01\x00Commit\x00\x00HEAD -> main, origin/main, tag: v1.0';
    const result = parseLog(raw, ['origin']);

    expect(result[0].refs).toHaveLength(3);
    expect(result[0].refs[0]).toEqual({ type: 'head', name: 'main' });
    expect(result[0].refs[1]).toEqual({ type: 'remote-branch', name: 'main', remote: 'origin' });
    expect(result[0].refs[2]).toEqual({ type: 'tag', name: 'v1.0' });
  });
});

describe('parseRefs', () => {
  it('should return empty array for empty input', () => {
    expect(parseRefs('')).toEqual([]);
  });

  it('should parse HEAD pointer', () => {
    const result = parseRefs('HEAD -> main');
    expect(result).toEqual([{ type: 'head', name: 'main' }]);
  });

  it('should parse detached HEAD', () => {
    const result = parseRefs('HEAD');
    expect(result).toEqual([{ type: 'head', name: 'HEAD' }]);
  });

  it('should parse tag', () => {
    const result = parseRefs('tag: v1.0.0');
    expect(result).toEqual([{ type: 'tag', name: 'v1.0.0' }]);
  });

  it('should parse remote branch with known remotes', () => {
    const result = parseRefs('origin/main', ['origin']);
    expect(result).toEqual([{ type: 'remote-branch', name: 'main', remote: 'origin' }]);
  });

  it('should parse slash branch as local without known remotes', () => {
    const result = parseRefs('feature/login');
    expect(result).toEqual([{ type: 'branch', name: 'feature/login' }]);
  });

  it('should parse local branch', () => {
    const result = parseRefs('feature-x');
    expect(result).toEqual([{ type: 'branch', name: 'feature-x' }]);
  });

  it('should parse mixed refs with known remotes', () => {
    const result = parseRefs('HEAD -> main, origin/main, tag: v2.0, feature/test', ['origin']);
    expect(result).toHaveLength(4);
    expect(result[0].type).toBe('head');
    expect(result[1].type).toBe('remote-branch');
    expect(result[2].type).toBe('tag');
    expect(result[3].type).toBe('branch'); // feature/test is local (feature is not a remote)
  });
});

describe('parseBranches', () => {
  it('should return empty array for empty input', () => {
    expect(parseBranches('')).toEqual([]);
  });

  it('should parse current branch', () => {
    const raw = '*main\x00abc1234\x00origin/main\x00ahead 2, behind 1';
    const result = parseBranches(raw);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('main');
    expect(result[0].current).toBe(true);
    expect(result[0].hash).toBe('abc1234');
    expect(result[0].upstream).toBe('origin/main');
    expect(result[0].ahead).toBe(2);
    expect(result[0].behind).toBe(1);
  });

  it('should parse non-current branch', () => {
    const raw = ' feature\x00def5678\x00\x00';
    const result = parseBranches(raw);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('feature');
    expect(result[0].current).toBe(false);
    expect(result[0].ahead).toBe(0);
    expect(result[0].behind).toBe(0);
  });
});

describe('parseTags', () => {
  it('should return empty array for empty input', () => {
    expect(parseTags('')).toEqual([]);
  });

  it('should parse lightweight tag', () => {
    const raw = 'v1.0\x00abc1234\x00commit\x00';
    const result = parseTags(raw);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('v1.0');
    expect(result[0].isAnnotated).toBe(false);
  });

  it('should parse annotated tag', () => {
    const raw = 'v2.0\x00def5678\x00tag\x00Release 2.0';
    const result = parseTags(raw);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('v2.0');
    expect(result[0].isAnnotated).toBe(true);
    expect(result[0].message).toBe('Release 2.0');
  });
});

describe('parseRemotes', () => {
  it('should return empty array for empty input', () => {
    expect(parseRemotes('')).toEqual([]);
  });

  it('should parse remote with fetch and push', () => {
    const raw = 'origin\thttps://github.com/user/repo.git (fetch)\norigin\thttps://github.com/user/repo.git (push)';
    const result = parseRemotes(raw);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('origin');
    expect(result[0].fetchUrl).toBe('https://github.com/user/repo.git');
    expect(result[0].pushUrl).toBe('https://github.com/user/repo.git');
  });

  it('should parse multiple remotes', () => {
    const raw = [
      'origin\thttps://github.com/user/repo.git (fetch)',
      'origin\thttps://github.com/user/repo.git (push)',
      'upstream\thttps://github.com/org/repo.git (fetch)',
      'upstream\thttps://github.com/org/repo.git (push)',
    ].join('\n');
    const result = parseRemotes(raw);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('origin');
    expect(result[1].name).toBe('upstream');
  });
});

describe('parseStashList', () => {
  it('should return empty array for empty input', () => {
    expect(parseStashList('')).toEqual([]);
  });

  it('should parse stash entries with parent hash and hash', () => {
    const raw = 'stash@{0}\x00WIP on main: abc1234 Fix bug\x002024-01-15T10:00:00+09:00\x00aaa111 bbb222\x00fff000\nstash@{1}\x00On feature: save work\x002024-01-14T09:00:00+09:00\x00ccc333 ddd444\x00fff111';
    const result = parseStashList(raw);

    expect(result).toHaveLength(2);
    expect(result[0].index).toBe(0);
    expect(result[0].message).toBe('WIP on main: abc1234 Fix bug');
    expect(result[0].parentHash).toBe('aaa111');
    expect(result[0].hash).toBe('fff000');
    expect(result[1].index).toBe(1);
    expect(result[1].parentHash).toBe('ccc333');
    expect(result[1].hash).toBe('fff111');
  });
});

describe('parseDiff', () => {
  it('should return empty array for empty input', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('should parse a simple diff', () => {
    const raw = `diff --git a/src/app.ts b/src/app.ts
index abc123..def456 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 line1
-old line
+new line
+added line
 line3`;

    const result = parseDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('src/app.ts');
    expect(result[0].isBinary).toBe(false);
    expect(result[0].hunks).toHaveLength(1);
    expect(result[0].hunks[0].lines).toHaveLength(5);

    const lines = result[0].hunks[0].lines;
    expect(lines[0].type).toBe('context');
    expect(lines[1].type).toBe('delete');
    expect(lines[2].type).toBe('add');
    expect(lines[3].type).toBe('add');
    expect(lines[4].type).toBe('context');
  });

  it('should parse binary file diff', () => {
    const raw = `diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ`;

    const result = parseDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].isBinary).toBe(true);
    expect(result[0].isImage).toBe(true);
  });

  it('should parse multiple file diffs', () => {
    const raw = `diff --git a/file1.ts b/file1.ts
--- a/file1.ts
+++ b/file1.ts
@@ -1,2 +1,2 @@
-old
+new
diff --git a/file2.ts b/file2.ts
--- a/file2.ts
+++ b/file2.ts
@@ -1,2 +1,2 @@
-foo
+bar`;

    const result = parseDiff(raw);
    expect(result).toHaveLength(2);
    expect(result[0].file).toBe('file1.ts');
    expect(result[1].file).toBe('file2.ts');
  });
});

describe('parseWorktreeList', () => {
  it('should return empty array for empty input', () => {
    expect(parseWorktreeList('')).toEqual([]);
    expect(parseWorktreeList('   ')).toEqual([]);
  });

  it('should parse a main worktree', () => {
    const raw = 'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n';
    const result = parseWorktreeList(raw);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/home/user/project');
    expect(result[0].hash).toBe('abc123');
    expect(result[0].branch).toBe('main');
    expect(result[0].isMain).toBe(true);
    expect(result[0].detached).toBe(false);
    expect(result[0].locked).toBe(false);
  });

  it('should parse multiple worktrees', () => {
    const raw =
      'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n' +
      'worktree /home/user/project-feat\nHEAD def456\nbranch refs/heads/feat/login\n';
    const result = parseWorktreeList(raw);
    expect(result).toHaveLength(2);
    expect(result[0].isMain).toBe(true);
    expect(result[0].branch).toBe('main');
    expect(result[1].isMain).toBe(false);
    expect(result[1].branch).toBe('feat/login');
  });

  it('should parse detached worktree', () => {
    const raw = 'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n' +
      'worktree /tmp/wt\nHEAD 789abc\ndetached\n';
    const result = parseWorktreeList(raw);
    expect(result[1].detached).toBe(true);
    expect(result[1].branch).toBe('');
  });

  it('should parse locked and prunable states', () => {
    const raw = 'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n' +
      'worktree /tmp/wt\nHEAD 789abc\nbranch refs/heads/test\nlocked\nprunable\n';
    const result = parseWorktreeList(raw);
    expect(result[1].locked).toBe(true);
    expect(result[1].prunable).toBe(true);
  });
});

describe('parseLfsFiles', () => {
  it('should return empty array for empty input', () => {
    expect(parseLfsFiles('')).toEqual([]);
    expect(parseLfsFiles('   ')).toEqual([]);
  });

  it('should parse files with * delimiter (downloaded)', () => {
    const raw = '7fa22a8f5f * banner.png\n5f70bf18a0 * data.bin\n';
    const result = parseLfsFiles(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ oid: '7fa22a8f5f', path: 'banner.png' });
    expect(result[1]).toEqual({ oid: '5f70bf18a0', path: 'data.bin' });
  });

  it('should parse files with - delimiter (not downloaded)', () => {
    const raw = '7fa22a8f5f - banner.png\n5f70bf18a0 - data.bin\n';
    const result = parseLfsFiles(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ oid: '7fa22a8f5f', path: 'banner.png' });
    expect(result[1]).toEqual({ oid: '5f70bf18a0', path: 'data.bin' });
  });

  it('should parse files with mixed delimiters', () => {
    const raw = '7fa22a8f5f * banner.png\n5f70bf18a0 - data.bin\n';
    const result = parseLfsFiles(raw);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('banner.png');
    expect(result[1].path).toBe('data.bin');
  });

  it('should parse files in subdirectories', () => {
    const raw = 'abc123 * assets/images/logo.png\n';
    const result = parseLfsFiles(raw);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('assets/images/logo.png');
  });

  it('should handle file names with spaces', () => {
    const raw = 'abc123 * my file.png\n';
    const result = parseLfsFiles(raw);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('my file.png');
  });
});

describe('parseLfsLocks', () => {
  it('should return empty array for empty input', () => {
    expect(parseLfsLocks('')).toEqual([]);
    expect(parseLfsLocks('   ')).toEqual([]);
  });

  it('should parse a single lock', () => {
    const raw = 'assets/logo.png\tuser1\tID:12345\n';
    const result = parseLfsLocks(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ path: 'assets/logo.png', owner: 'user1', id: 'ID:12345' });
  });

  it('should parse multiple locks', () => {
    const raw = 'logo.png\talice\tID:1\nbanner.png\tbob\tID:2\n';
    const result = parseLfsLocks(raw);
    expect(result).toHaveLength(2);
    expect(result[0].owner).toBe('alice');
    expect(result[1].owner).toBe('bob');
  });
});

