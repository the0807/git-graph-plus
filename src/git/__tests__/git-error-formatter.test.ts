import { describe, it, expect } from 'vitest';
import { formatGitError, isAuthFailure, transportFromRemoteUrl } from '../git-error-formatter';

describe('formatGitError', () => {
  describe('prefix stripping', () => {
    it('strips fatal: prefix', () => {
      expect(formatGitError("fatal: A branch named 'main' already exists."))
        .toBe("A branch named 'main' already exists.");
    });

    it('strips error: prefix', () => {
      expect(formatGitError("error: failed to push some refs to 'origin'"))
        .toBe("failed to push some refs to 'origin'");
    });

    it('strips warning: prefix', () => {
      expect(formatGitError('warning: LF will be replaced by CRLF in file.ts.'))
        .toBe('LF will be replaced by CRLF in file.ts.');
    });
  });

  describe('hint filtering', () => {
    it('drops hint lines, keeps error line', () => {
      const stderr = [
        "error: failed to push some refs to 'origin'",
        "hint: Updates were rejected because the remote contains work that you do not",
        "hint: have locally. Integrate the remote changes before pushing again.",
      ].join('\n');
      expect(formatGitError(stderr)).toBe("failed to push some refs to 'origin'");
    });

    it('drops git-flow default-branch notice when a real error follows', () => {
      const stderr = [
        'Using default branch names.',
        'fatal: Not a gitflow-enabled repo yet. Please run "git flow init" first.',
      ].join('\n');
      expect(formatGitError(stderr)).toBe('Not a gitflow-enabled repo yet. Please run "git flow init" first.');
    });
  });

  describe('file list after error', () => {
    it('appends single file on next line', () => {
      const stderr = [
        'error: Your local changes to the following files would be overwritten by checkout:',
        '\tsrc/extension.ts',
        'Please commit your changes or stash them before you switch branches.',
        'Aborting',
      ].join('\n');
      expect(formatGitError(stderr)).toBe(
        'Your local changes to the following files would be overwritten by checkout:\nsrc/extension.ts'
      );
    });

    it('joins multiple files on one line', () => {
      const stderr = [
        'error: Your local changes to the following files would be overwritten by merge:',
        '\tsrc/a.ts',
        '\tsrc/b.ts',
        '\tsrc/c.ts',
        'Please commit your changes or stash them.',
      ].join('\n');
      expect(formatGitError(stderr)).toBe(
        'Your local changes to the following files would be overwritten by merge:\nsrc/a.ts, src/b.ts, src/c.ts'
      );
    });

    it('truncates beyond 3 files with count', () => {
      const stderr = [
        'error: Your local changes to the following files would be overwritten by checkout:',
        '\tsrc/a.ts',
        '\tsrc/b.ts',
        '\tsrc/c.ts',
        '\tsrc/d.ts',
        '\tsrc/e.ts',
        'Aborting',
      ].join('\n');
      expect(formatGitError(stderr)).toBe(
        'Your local changes to the following files would be overwritten by checkout:\nsrc/a.ts, src/b.ts, src/c.ts (+2 more)'
      );
    });
  });

  describe('remote errors', () => {
    it('prefers remote error over generic error line', () => {
      const stderr = [
        'remote: error: GH013: Repository rule violations found for refs/heads/main.',
        'remote: ',
        "error: failed to push some refs to 'origin'",
      ].join('\n');
      expect(formatGitError(stderr))
        .toBe('GH013: Repository rule violations found for refs/heads/main.');
    });

    it('strips remote: fatal: prefix', () => {
      const stderr = [
        'remote: fatal: pack exceeds maximum allowed size',
        "error: failed to push some refs to 'origin'",
      ].join('\n');
      expect(formatGitError(stderr)).toBe('pack exceeds maximum allowed size');
    });

    it('joins multiple remote error lines so the actionable cause is not hidden', () => {
      const stderr = [
        'remote: error: GH006: Protected branch update failed for refs/heads/main.',
        'remote: error: At least 1 approving review is required by reviewers with write access.',
        'To github.com:o/r.git',
        ' ! [remote rejected] main -> main (protected branch hook declined)',
        "error: failed to push some refs to 'github.com:o/r.git'",
      ].join('\n');
      expect(formatGitError(stderr)).toBe(
        'GH006: Protected branch update failed for refs/heads/main. At least 1 approving review is required by reviewers with write access.'
      );
    });
  });

  // Regression: the remote's stated cause used to be discarded, leaving only the
  // generic "failed to push some refs" line (see real `git push` output).
  describe('remote rejection cause', () => {
    it('surfaces the rejection reason for a non-fast-forward push', () => {
      const stderr = [
        'To /srv/bare.git',
        ' ! [rejected]        main -> main (fetch first)',
        "error: failed to push some refs to '/srv/bare.git'",
        'hint: Updates were rejected because the remote contains work that you do not',
        'hint: have locally. Integrate the remote changes before pushing again.',
      ].join('\n');
      expect(formatGitError(stderr)).toBe('[rejected] main -> main (fetch first)');
    });

    it('surfaces plain remote: server messages from a pre-receive hook decline', () => {
      const stderr = [
        'remote: You are not allowed to push to the protected branch.        ',
        'remote: Please open a pull request instead.        ',
        'To /srv/bare.git',
        ' ! [remote rejected] main -> main (pre-receive hook declined)',
        "error: failed to push some refs to '/srv/bare.git'",
      ].join('\n');
      expect(formatGitError(stderr)).toBe(
        'You are not allowed to push to the protected branch. Please open a pull request instead. (pre-receive hook declined)'
      );
    });

    it('caps a chatty hook message at three lines', () => {
      const stderr = [
        'remote: line one',
        'remote: line two',
        'remote: line three',
        'remote: line four',
        'remote: line five',
        ' ! [remote rejected] main -> main (pre-receive hook declined)',
        "error: failed to push some refs to 'origin'",
      ].join('\n');
      expect(formatGitError(stderr)).toBe(
        'line one line two line three (+2 more) (pre-receive hook declined)'
      );
    });
  });

  describe('no recognised prefix', () => {
    it('returns first non-empty line as-is when no prefix matches', () => {
      expect(formatGitError('Could not apply abc1234... some commit message'))
        .toBe('Could not apply abc1234... some commit message');
    });
  });
});

describe('isAuthFailure', () => {
  it.each([
    'fatal: Authentication failed for \'https://github.com/x/y.git/\'',
    'fatal: could not read Username for \'https://github.com\': terminal prompts disabled',
    'git@github.com: Permission denied (publickey).',
    'Host key verification failed.',
    'fatal: Could not read from remote repository.',
  ])('flags credential/auth failures: %s', (stderr) => {
    expect(isAuthFailure(stderr)).toBe(true);
  });

  it.each([
    'fatal: not a git repository',
    'error: failed to push some refs',
    'CONFLICT (content): Merge conflict in a.txt',
  ])('does not flag unrelated errors: %s', (stderr) => {
    expect(isAuthFailure(stderr)).toBe(false);
  });
});

describe('transportFromRemoteUrl', () => {
  it('classifies SSH urls', () => {
    expect(transportFromRemoteUrl('git@github.com:org/repo.git')).toBe('ssh');
    expect(transportFromRemoteUrl('ssh://git@host/repo.git')).toBe('ssh');
  });

  it('classifies HTTP(S) urls', () => {
    expect(transportFromRemoteUrl('https://github.com/org/repo.git')).toBe('https');
    expect(transportFromRemoteUrl('http://host/repo.git')).toBe('https');
  });

  it('returns unknown for anything else (incl. empty)', () => {
    expect(transportFromRemoteUrl('')).toBe('unknown');
    expect(transportFromRemoteUrl('file:///srv/repo.git')).toBe('unknown');
  });
});
