import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitService } from '../../git-service';
import { TempRepo, commit, createTempRepo, runGit, seedBranches, currentBranch } from './helpers';

describe('GitService integration — basic queries', () => {
  let repo: TempRepo;
  let svc: GitService;

  beforeEach(() => {
    repo = createTempRepo();
    svc = new GitService(repo.path);
  });
  afterEach(() => repo.cleanup());

  describe('log', () => {
    it('returns commits in reverse chronological order', async () => {
      commit(repo.path, 'first', { 'a.txt': '1\n' });
      commit(repo.path, 'second', { 'a.txt': '2\n' });
      const tip = commit(repo.path, 'third', { 'a.txt': '3\n' });

      const commits = await svc.log();
      expect(commits.length).toBeGreaterThanOrEqual(3);
      expect(commits[0].hash).toBe(tip);
      expect(commits[0].subject).toBe('third');
      expect(commits[1].subject).toBe('second');
      expect(commits[2].subject).toBe('first');
    });

    it('respects limit option', async () => {
      for (let i = 0; i < 5; i++) commit(repo.path, `c${i}`);
      const commits = await svc.log({ limit: 2 });
      expect(commits.length).toBeLessThanOrEqual(2);
    });

    it('does not prepend the UNCOMMITTED row on paginated (skip>0) pages', async () => {
      for (let i = 0; i < 5; i++) commit(repo.path, `c${i}`, { 'a.txt': `${i}\n` });
      // Dirty working tree so the first page would carry an UNCOMMITTED row.
      runGit(repo.path, ['rm', 'a.txt']);

      const firstPage = await svc.log({ limit: 2 });
      expect(firstPage[0].hash).toBe('UNCOMMITTED');

      const secondPage = await svc.log({ limit: 2, skip: 2 });
      expect(secondPage.some(c => c.hash === 'UNCOMMITTED')).toBe(false);
    });

    it('captures parent relationships across merges', async () => {
      const { mainTip, featureTip } = seedBranches(repo.path);
      runGit(repo.path, ['merge', '--no-ff', '-m', 'merge feature', 'feature']);

      const commits = await svc.log();
      const mergeCommit = commits[0];
      // Merge commit has two parents (main tip + feature tip)
      expect(mergeCommit.parents.length).toBe(2);
      expect(mergeCommit.parents).toContain(mainTip);
      expect(mergeCommit.parents).toContain(featureTip);
    });

    it('prepends an UNCOMMITTED row carrying the staged/unstaged counts', async () => {
      commit(repo.path, 'init', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
      const { writeFileSync } = await import('fs');
      writeFileSync(`${repo.path}/a.txt`, 'staged\n');
      runGit(repo.path, ['add', 'a.txt']);     // 1 staged
      writeFileSync(`${repo.path}/b.txt`, 'unstaged\n'); // 1 unstaged

      const commits = await svc.log();
      expect(commits[0].hash).toBe('UNCOMMITTED');
      expect(commits[0].subject).toBe('Uncommitted changes (2)');
      expect(JSON.parse(commits[0].body)).toEqual({ staged: 1, unstaged: 1 });
    });

    it('scopes history to the given branches filter', async () => {
      // main: init -> m2 ; feature (from init): f1
      const init = commit(repo.path, 'init', { 'a.txt': 'a\n' });
      commit(repo.path, 'm2', { 'm.txt': 'm\n' });
      runGit(repo.path, ['checkout', '-b', 'feature', init]);
      commit(repo.path, 'f1', { 'f.txt': 'f\n' });
      runGit(repo.path, ['checkout', 'main']);

      const subjects = (await svc.log({ branches: ['feature'] })).map(c => c.subject);
      // feature reaches init + f1, but not main-only m2.
      expect(subjects).toContain('f1');
      expect(subjects).toContain('init');
      expect(subjects).not.toContain('m2');
    });

    it('includes a commit reachable only from a detached HEAD', async () => {
      const base = commit(repo.path, 'base', { 'a.txt': '1\n' });
      runGit(repo.path, ['checkout', '--detach', base]);
      const detached = commit(repo.path, 'detached', { 'a.txt': '2\n' });

      const commits = await svc.log();
      expect(commits.map((c) => c.hash)).toContain(detached);
    });
  });

  describe('branches', () => {
    it('reports the initial branch with HEAD marker', async () => {
      commit(repo.path, 'init');
      const branches = await svc.branches();
      const current = branches.find(b => b.current);
      expect(current).toBeDefined();
      expect(current?.name).toBe('main');
    });

    it('lists multiple local branches', async () => {
      commit(repo.path, 'init');
      runGit(repo.path, ['branch', 'feature-a']);
      runGit(repo.path, ['branch', 'feature-b']);
      const branches = await svc.branches();
      const names = branches.map(b => b.name);
      expect(names).toContain('main');
      expect(names).toContain('feature-a');
      expect(names).toContain('feature-b');
    });
  });

  describe('tags', () => {
    it('lists lightweight and annotated tags', async () => {
      commit(repo.path, 'init');
      runGit(repo.path, ['tag', 'v1.0.0']);
      runGit(repo.path, ['tag', '-a', 'v1.1.0', '-m', 'annotated tag']);
      const tags = await svc.tags();
      const names = tags.map(t => t.name);
      expect(names).toContain('v1.0.0');
      expect(names).toContain('v1.1.0');
    });

    it('returns empty array when no tags', async () => {
      commit(repo.path, 'init');
      const tags = await svc.tags();
      expect(tags).toEqual([]);
    });
  });

  describe('remotes', () => {
    it('returns empty array when no remotes', async () => {
      commit(repo.path, 'init');
      const remotes = await svc.remotes();
      expect(remotes).toEqual([]);
    });

    it('lists configured remotes with URLs', async () => {
      commit(repo.path, 'init');
      runGit(repo.path, ['remote', 'add', 'origin', 'https://example.com/r.git']);
      runGit(repo.path, ['remote', 'add', 'upstream', 'https://example.com/u.git']);
      const remotes = await svc.remotes();
      expect(remotes.find(r => r.name === 'origin')?.fetchUrl).toContain('example.com/r.git');
      expect(remotes.find(r => r.name === 'upstream')?.fetchUrl).toContain('example.com/u.git');
    });
  });

  describe('isDirty / status', () => {
    it('false when working tree clean', async () => {
      commit(repo.path, 'init');
      expect(await svc.isDirty()).toBe(false);
    });

    it('true when unstaged changes exist', async () => {
      commit(repo.path, 'init', { 'a.txt': 'a\n' });
      // mutate working tree
      const { writeFileSync } = await import('fs');
      writeFileSync(`${repo.path}/a.txt`, 'mutated\n');
      expect(await svc.isDirty()).toBe(true);
    });

    it('ignores untracked files (matches git status -uno semantics)', async () => {
      commit(repo.path, 'init');
      const { writeFileSync } = await import('fs');
      writeFileSync(`${repo.path}/new.txt`, 'new\n');
      // isDirty is used to block checkout, which git itself permits when only
      // untracked files exist (they don't conflict with switching refs).
      expect(await svc.isDirty()).toBe(false);
    });
  });

  describe('getUncommittedDiff', () => {
    it('separates staged from unstaged changes', async () => {
      commit(repo.path, 'init', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
      const { writeFileSync } = await import('fs');
      writeFileSync(`${repo.path}/a.txt`, 'staged change\n');
      runGit(repo.path, ['add', 'a.txt']);
      writeFileSync(`${repo.path}/b.txt`, 'unstaged change\n');

      const result = await svc.getUncommittedDiff();
      expect(result.staged.map(s => s.path)).toContain('a.txt');
      expect(result.unstaged.map(s => s.path)).toContain('b.txt');
    });

    it('returns non-ASCII paths literally (core.quotePath=false)', async () => {
      // With git's default core.quotePath=true the path would come back
      // dquote-escaped ("\355\225\234...") and never match the literal name
      // the diff view resolves, so the file would be unclickable.
      commit(repo.path, 'init', { 'a.txt': 'a\n' });
      const { writeFileSync } = await import('fs');
      writeFileSync(`${repo.path}/한글.txt`, 'korean\n');

      const result = await svc.getUncommittedDiff();
      const paths = [...result.staged, ...result.unstaged].map(s => s.path);
      expect(paths).toContain('한글.txt');
    });

    it('marks an untracked nested git repo with status N (not a plain untracked)', async () => {
      commit(repo.path, 'init', { 'a.txt': 'a\n' });
      // A nested repo git refuses to descend into surfaces as one dir entry
      // with a trailing slash in porcelain output.
      const nested = `${repo.path}/sub`;
      runGit(repo.path, ['init', nested]);
      const { writeFileSync } = await import('fs');
      writeFileSync(`${nested}/x.txt`, 'x\n');

      const result = await svc.getUncommittedDiff();
      const sub = result.unstaged.find(e => e.path === 'sub');
      expect(sub).toBeDefined();
      expect(sub!.status).toBe('N');
    });

    it('reports the new path of a staged rename', async () => {
      commit(repo.path, 'init', { 'old.txt': 'content\n' });
      runGit(repo.path, ['mv', 'old.txt', 'new.txt']);

      const result = await svc.getUncommittedDiff();
      // Staged rename → the new path appears in the staged list.
      expect(result.staged.map(s => s.path)).toContain('new.txt');
    });
  });

  describe('getReflog', () => {
    it('returns reflog entries with hashes and messages', async () => {
      commit(repo.path, 'first');
      commit(repo.path, 'second');
      runGit(repo.path, ['checkout', '-b', 'feature']);
      commit(repo.path, 'on feature');
      runGit(repo.path, ['checkout', 'main']);

      const { entries } = await svc.getReflog(10);
      expect(entries.length).toBeGreaterThan(0);
      // Most recent should be the checkout back to main
      expect(entries[0].message).toMatch(/checkout|moving from feature/i);
      // Each entry should have a non-empty hash
      for (const e of entries) {
        expect(e.hash).toMatch(/^[0-9a-f]{40}$/);
        expect(e.shortHash.length).toBeGreaterThan(0);
      }
    });

    it('respects the limit parameter', async () => {
      for (let i = 0; i < 10; i++) commit(repo.path, `c${i}`);
      const { entries } = await svc.getReflog(3);
      expect(entries.length).toBeLessThanOrEqual(3);
    });
  });

  describe('diffFiles', () => {
    it('lists files changed between two commits', async () => {
      const c1 = commit(repo.path, 'first', { 'a.txt': 'a\n' });
      commit(repo.path, 'add b', { 'b.txt': 'b\n' });

      const files = await svc.diffFiles(c1, 'HEAD');
      const paths = files.map(f => f.path);
      expect(paths).toContain('b.txt');
    });

    it('reports a rename with its old path and R status', async () => {
      const c1 = commit(repo.path, 'init', { 'old.txt': 'shared content here\n' });
      runGit(repo.path, ['mv', 'old.txt', 'new.txt']);
      commit(repo.path, 'rename');

      const files = await svc.diffFiles(c1, 'HEAD');
      const renamed = files.find(f => f.path === 'new.txt');
      expect(renamed).toBeDefined();
      expect(renamed!.status).toBe('R');
      expect(renamed!.oldPath).toBe('old.txt');
    });
  });

  describe('showCommitFiles', () => {
    it('lists files changed in a single commit', async () => {
      commit(repo.path, 'init', { 'a.txt': 'a\n' });
      const target = commit(repo.path, 'add two', { 'b.txt': 'b\n', 'c.txt': 'c\n' });
      const files = await svc.showCommitFiles(target);
      const paths = files.map(f => f.path);
      expect(paths).toContain('b.txt');
      expect(paths).toContain('c.txt');
    });

    it('falls back to --root for the initial commit (no parent)', async () => {
      // The default `hash^..hash` form fails on a root commit because it has
      // no parent. The diff-tree --root fallback path is what makes the first
      // commit's file list show up in the UI.
      const root = commit(repo.path, 'genesis', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
      const files = await svc.showCommitFiles(root);
      const paths = files.map(f => f.path);
      expect(paths).toContain('a.txt');
      expect(paths).toContain('b.txt');
    });

    it('reports a rename within a commit with R status and old path', async () => {
      commit(repo.path, 'init', { 'old.txt': 'shared content here\n' });
      runGit(repo.path, ['mv', 'old.txt', 'new.txt']);
      const target = commit(repo.path, 'rename');

      const renamed = (await svc.showCommitFiles(target)).find(f => f.path === 'new.txt');
      expect(renamed).toBeDefined();
      expect(renamed!.status).toBe('R');
      expect(renamed!.oldPath).toBe('old.txt');
    });

    it('unions files across all parents of an octopus (3-parent) merge', async () => {
      // hash^..hash only diffs against the first parent, so an octopus merge
      // would hide everything from parents 2..N. showCommitFiles must diff
      // against every parent and union the results.
      const { runGit, head } = await import('./helpers');
      commit(repo.path, 'init', { 'shared.txt': 'one\n' });
      runGit(repo.path, ['checkout', '-b', 'side1']);
      commit(repo.path, 'side1 change', { 'from-side1.txt': 's1\n' });
      runGit(repo.path, ['checkout', 'main']);
      runGit(repo.path, ['checkout', '-b', 'side2']);
      commit(repo.path, 'side2 change', { 'from-side2.txt': 's2\n' });
      runGit(repo.path, ['checkout', 'main']);
      commit(repo.path, 'main change', { 'from-main.txt': 'm\n' });
      // Octopus merge of both side branches at once → a 3-parent commit.
      runGit(repo.path, ['merge', '--no-ff', '-m', 'octopus', 'side1', 'side2']);
      const mergeHash = head(repo.path);

      const paths = (await svc.showCommitFiles(mergeHash)).map(f => f.path);
      // Files introduced via the 2nd and 3rd parents must both appear.
      expect(paths).toContain('from-side1.txt');
      expect(paths).toContain('from-side2.txt');
    });
  });

  describe('showCommitDiff', () => {
    it('returns diff hunks for a commit', async () => {
      commit(repo.path, 'init', { 'a.txt': 'one\n' });
      const target = commit(repo.path, 'modify', { 'a.txt': 'two\n' });

      const diffs = await svc.showCommitDiff(target);
      expect(diffs.length).toBeGreaterThan(0);
      const aDiff = diffs.find(d => d.file === 'a.txt');
      expect(aDiff).toBeDefined();
    });

    it('falls back to git show for the initial commit (no parent)', async () => {
      // Same fallback motivation as showCommitFiles above — `hash^..hash`
      // requires a parent. The git-show form handles the root case.
      const root = commit(repo.path, 'genesis', { 'a.txt': 'one\n' });
      const diffs = await svc.showCommitDiff(root);
      expect(diffs.length).toBeGreaterThan(0);
      expect(diffs[0].file).toBe('a.txt');
    });

    it('filters to a single file when `file` argument given', async () => {
      commit(repo.path, 'init', { 'a.txt': 'one\n', 'b.txt': 'one\n' });
      const target = commit(repo.path, 'modify both', { 'a.txt': 'two\n', 'b.txt': 'two\n' });

      const diffs = await svc.showCommitDiff(target, 'a.txt');
      // Filter to only a.txt; b.txt's change must be absent.
      expect(diffs).toHaveLength(1);
      expect(diffs[0].file).toBe('a.txt');
    });

    it('filters to a single file on a root commit (show fallback path)', async () => {
      const root = commit(repo.path, 'genesis', { 'a.txt': 'one\n', 'b.txt': 'one\n' });
      const diffs = await svc.showCommitDiff(root, 'a.txt');
      expect(diffs).toHaveLength(1);
      expect(diffs[0].file).toBe('a.txt');
    });

    it('surfaces files from non-first parents on a merge commit', async () => {
      // Build a Y-shaped history:
      //   main: init -> only-on-main
      //   side: side-only (forked from init)
      // Then merge side into main. The merge commit's first parent is the
      // tip of main, so `hash^..hash` only shows changes from `side-only`
      // (which came in via the second parent). The fix must surface them.
      commit(repo.path, 'init', { 'shared.txt': 'one\n' });
      const { runGit } = await import('./helpers');
      runGit(repo.path, ['checkout', '-b', 'side']);
      commit(repo.path, 'side-only', { 'from-side.txt': 'side\n' });
      runGit(repo.path, ['checkout', 'main']);
      commit(repo.path, 'only-on-main', { 'from-main.txt': 'main\n' });
      runGit(repo.path, ['merge', '--no-ff', '-m', 'merge side', 'side']);
      const mergeHash = (await import('./helpers')).head(repo.path);

      const files = await svc.showCommitFiles(mergeHash);
      const paths = files.map(f => f.path);
      expect(paths).toContain('from-side.txt');

      const diffs = await svc.showCommitDiff(mergeHash, 'from-side.txt');
      expect(diffs.length).toBeGreaterThan(0);
      expect(diffs[0].hunks.length).toBeGreaterThan(0);
    });

    it('flags a binary file with isBinary and no hunks', async () => {
      commit(repo.path, 'init', { 'readme.txt': 'text\n' });
      const { writeFileSync } = await import('fs');
      const { head } = await import('./helpers');
      // NUL bytes make git treat the blob as binary ("Binary files differ").
      // Written + committed by hand because the helper only writes text.
      writeFileSync(`${repo.path}/blob.bin`, Buffer.from([0, 1, 2, 0, 255, 0, 10]));
      runGit(repo.path, ['add', '-A']);
      runGit(repo.path, ['commit', '-m', 'add binary']);
      const target = head(repo.path);

      const diff = (await svc.showCommitDiff(target)).find(d => d.file === 'blob.bin');
      expect(diff).toBeDefined();
      expect(diff!.isBinary).toBe(true);
      expect(diff!.hunks).toHaveLength(0);
    });
  });

  describe('diff (working tree)', () => {
    it('returns empty array when clean', async () => {
      commit(repo.path, 'init', { 'a.txt': 'a\n' });
      const diffs = await svc.diff();
      expect(diffs).toEqual([]);
    });

    it('reports unstaged file changes', async () => {
      commit(repo.path, 'init', { 'a.txt': 'one\n' });
      const { writeFileSync } = await import('fs');
      writeFileSync(`${repo.path}/a.txt`, 'two\n');
      const diffs = await svc.diff();
      expect(diffs.length).toBeGreaterThan(0);
      expect(diffs[0].file).toBe('a.txt');
    });

    it('filters by file path', async () => {
      commit(repo.path, 'init', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
      const { writeFileSync } = await import('fs');
      writeFileSync(`${repo.path}/a.txt`, 'changed\n');
      writeFileSync(`${repo.path}/b.txt`, 'changed\n');
      const diffs = await svc.diff({ file: 'a.txt' });
      expect(diffs.length).toBe(1);
      expect(diffs[0].file).toBe('a.txt');
    });
  });

  describe('diffCommits', () => {
    it('returns diff between two commits', async () => {
      const c1 = commit(repo.path, 'first', { 'a.txt': 'one\n' });
      const c2 = commit(repo.path, 'second', { 'a.txt': 'two\n' });
      const diffs = await svc.diffCommits(c1, c2);
      expect(diffs.length).toBeGreaterThan(0);
      expect(diffs[0].file).toBe('a.txt');
    });
  });

  describe('diffCommitToWorking', () => {
    it('returns diff between a past commit and current working tree', async () => {
      const c1 = commit(repo.path, 'first', { 'a.txt': 'one\n' });
      commit(repo.path, 'second', { 'a.txt': 'two\n' });
      const { writeFileSync } = await import('fs');
      writeFileSync(`${repo.path}/a.txt`, 'three\n');

      const diffs = await svc.diffCommitToWorking(c1);
      // Should reflect both the c2 change and the unstaged change vs c1.
      expect(diffs.length).toBeGreaterThan(0);
      expect(diffs[0].file).toBe('a.txt');
    });
  });

  describe('getUncommittedFileDiff', () => {
    it('returns staged diff when staged=true', async () => {
      commit(repo.path, 'init', { 'a.txt': 'one\n' });
      const { writeFileSync } = await import('fs');
      writeFileSync(`${repo.path}/a.txt`, 'two\n');
      runGit(repo.path, ['add', 'a.txt']);

      const staged = await svc.getUncommittedFileDiff('a.txt', true);
      expect(staged).not.toBeNull();
      expect(staged?.file).toBe('a.txt');

      // unstaged view should be empty since we already staged
      const unstaged = await svc.getUncommittedFileDiff('a.txt', false);
      expect(unstaged?.hunks.length ?? 0).toBe(0);
    });

    it('returns full diff for new untracked file', async () => {
      commit(repo.path, 'init');
      const { writeFileSync } = await import('fs');
      writeFileSync(`${repo.path}/new.txt`, 'hello\n');
      const diff = await svc.getUncommittedFileDiff('new.txt', false);
      expect(diff).not.toBeNull();
      expect(diff?.file).toContain('new.txt');
    });
  });

  describe('isRemoteBranch', () => {
    it('returns true for refs prefixed with a known remote', async () => {
      commit(repo.path, 'init');
      runGit(repo.path, ['remote', 'add', 'origin', 'https://example.com/r.git']);
      // Manually create a fake remote tracking ref
      runGit(repo.path, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
      expect(await svc.isRemoteBranch('origin/main')).toBe(true);
    });

    it('returns false for plain branch names', async () => {
      commit(repo.path, 'init');
      expect(await svc.isRemoteBranch('main')).toBe(false);
    });

    it('returns false when no slash', async () => {
      commit(repo.path, 'init');
      expect(await svc.isRemoteBranch('anything')).toBe(false);
    });
  });

  describe('getRemoteUrl', () => {
    it('returns the configured fetch URL', async () => {
      commit(repo.path, 'init');
      runGit(repo.path, ['remote', 'add', 'origin', 'https://example.com/r.git']);
      const url = await svc.getRemoteUrl('origin');
      expect(url).toBe('https://example.com/r.git');
    });

    it('throws for an unknown remote', async () => {
      commit(repo.path, 'init');
      await expect(svc.getRemoteUrl('nope')).rejects.toThrow();
    });
  });

  describe('formatPatch', () => {
    it('returns a unified patch for a commit', async () => {
      commit(repo.path, 'init');
      const target = commit(repo.path, 'add file', { 'a.txt': 'a\n' });
      const patch = await svc.formatPatch(target);
      expect(patch).toContain('From ' + target);
      expect(patch).toContain('Subject: [PATCH] add file');
      expect(patch).toContain('+a');
    });

    it('restricts the patch to the given paths', async () => {
      commit(repo.path, 'init');
      const target = commit(repo.path, 'change two files', {
        'a.txt': 'a\n',
        'b.txt': 'b\n',
      });
      const patch = await svc.formatPatch(target, ['a.txt']);
      expect(patch).toContain('a/a.txt');
      expect(patch).not.toContain('a/b.txt');
    });
  });

  describe('getImageBase64', () => {
    it('round-trips a binary file through git show', async () => {
      // A small PNG-shaped byte buffer is enough; we only care about
      // base64 round-trip integrity, not image validity.
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]);
      const { writeFileSync } = await import('fs');
      writeFileSync(`${repo.path}/icon.png`, bytes);
      runGit(repo.path, ['add', 'icon.png']);
      runGit(repo.path, ['commit', '-m', 'add icon']);

      const b64 = await svc.getImageBase64('HEAD', 'icon.png');
      expect(Buffer.from(b64, 'base64').equals(bytes)).toBe(true);
    });

    it('throws GitError when file does not exist at the ref', async () => {
      commit(repo.path, 'init');
      await expect(svc.getImageBase64('HEAD', 'missing.png')).rejects.toThrow();
    });
  });

  describe('lsTree', () => {
    it('lists top-level entries at a ref', async () => {
      commit(repo.path, 'init', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
      const entries = await svc.lsTree('HEAD');
      const names = entries.map(e => e.name);
      expect(names).toContain('a.txt');
      expect(names).toContain('b.txt');
      expect(entries.every(e => e.type === 'blob' || e.type === 'tree')).toBe(true);
    });

    it('descends into subdirectories', async () => {
      commit(repo.path, 'init', { 'src/x.ts': 'x\n', 'src/y.ts': 'y\n' });
      const entries = await svc.lsTree('HEAD');
      const src = entries.find(e => e.name === 'src');
      expect(src?.type).toBe('tree');
    });
  });

  describe('signature status', () => {
    // Generating a real GPG/SSH key in CI is impractical, so these cover the
    // unsigned ("none") path against real git; the G/unverified mapping is
    // exercised by the git-parser unit tests.
    it('getCommitSignature reports "none" for an unsigned commit', async () => {
      const tip = commit(repo.path, 'unsigned', { 'a.txt': '1\n' });
      const sig = await svc.getCommitSignature(tip);
      expect(sig.status).toBe('none');
    });

    it('log without includeSignature omits signatureStatus', async () => {
      commit(repo.path, 'c', { 'a.txt': '1\n' });
      const commits = await svc.log();
      expect(commits[0].signatureStatus).toBeUndefined();
    });

    it('log with includeSignature populates "none" for unsigned commits', async () => {
      commit(repo.path, 'c', { 'a.txt': '1\n' });
      const commits = await svc.log({ includeSignature: true });
      const real = commits.find(c => c.hash !== 'UNCOMMITTED');
      expect(real?.signatureStatus).toBe('none');
    });
  });

  describe('defaultBranch', () => {
    it('resolves origin/HEAD to its local branch name', async () => {
      commit(repo.path, 'init', { 'a.txt': '1\n' });
      // 별도 bare 원격을 만들고 origin/HEAD를 설정
      const remote = createTempRepo({ bare: true });
      runGit(repo.path, ['remote', 'add', 'origin', remote.path]);
      runGit(repo.path, ['push', '-u', 'origin', currentBranch(repo.path)]);
      runGit(repo.path, ['remote', 'set-head', 'origin', '-a']);

      const result = await svc.defaultBranch();
      expect(result).toBe(currentBranch(repo.path));
      remote.cleanup();
    });

    it('falls back to local main/master/develop when no origin/HEAD', async () => {
      commit(repo.path, 'init', { 'a.txt': '1\n' });
      // 현재 브랜치를 master로, 그리고 develop 생성. main 없음.
      runGit(repo.path, ['branch', '-m', 'master']);
      runGit(repo.path, ['branch', 'develop']);

      const result = await svc.defaultBranch();
      expect(result).toBe('master'); // main 없음 → master 우선
    });

    it('returns null when no candidate exists', async () => {
      commit(repo.path, 'init', { 'a.txt': '1\n' });
      runGit(repo.path, ['branch', '-m', 'work']); // main/master/develop 모두 아님, 원격 없음
      const result = await svc.defaultBranch();
      expect(result).toBeNull();
    });
  });
});
