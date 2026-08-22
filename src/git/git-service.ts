import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { bufferStream, BufferOverflowError } from '../utils/buffer-stream';
import { getGitBinaryPath } from './git-binary';
import { resolveGitDirs } from '../services/file-watcher-helpers';

/** Default max bytes per stdout/stderr stream for a single git invocation.
 *  Picked to comfortably hold large log/diff output (e.g. `git log --all`
 *  over a 100k-commit repo with --format flags is ~tens of MB) while still
 *  preventing a pathological --no-pager binary blob from eating the whole
 *  extension host. Callers can override per-invocation via `maxBufferBytes`. */
const DEFAULT_MAX_BUFFER_BYTES = 256 * 1024 * 1024;
import { parseLog, parseBranches, parseTags, parseRemotes, parseStashList, parseDiff, parseWorktreeList, parseLfsFiles, parseLfsLocks, mapSignatureStatus } from './git-parser';
import { buildReversePatch } from './patch-builder';
import type { Commit, BranchInfo, TagInfo, RemoteInfo, StashEntry, LogOptions, DiffData, WorktreeInfo, CommitSignature } from './types';

type GitFlowConfig = {
  productionBranch: string;
  developBranch: string;
  featurePrefix: string;
  releasePrefix: string;
  hotfixPrefix: string;
  versionTagPrefix: string;
};

type FileContentSource =
  | { kind: 'empty' }
  | { kind: 'ref'; ref: string }
  | { kind: 'index' }
  | { kind: 'working' };

type CommitFileDiffResult = {
  raw: string;
  parsed: DiffData[];
  oldSource: FileContentSource;
  newSource: FileContentSource;
};

export class GitError extends Error {
  constructor(
    public stderr: string,
    public exitCode: number | null,
    public args: string[],
    public stdout: string = ''
  ) {
    super(`git ${args.join(' ')} failed (exit ${exitCode}): ${stderr.trim()}`);
    this.name = 'GitError';
  }
}

/**
 * Bin an ISO-8601 timestamp (`%aI` from `git log`) by the *author's* local
 * weekday and hour, not the host's. `new Date(iso).getDay()/getHours()` would
 * convert into the machine's timezone — a 10am Seoul commit would land in
 * "evening" for someone running the extension in San Francisco. The ISO string
 * already encodes the wall-clock time and offset, so the easy fix is to parse
 * the date components directly.
 */
export function binCommitTime(iso: string): { weekday: number; hour: number } | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, day, h] = m;
  const year = parseInt(y, 10);
  const month = parseInt(mo, 10);
  const date = parseInt(day, 10);
  const hour = parseInt(h, 10);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(date) || Number.isNaN(hour)) return null;
  // Day-of-week is independent of timezone if we treat the components as UTC,
  // because the same calendar date (Y/M/D in the author's zone) always has the
  // same day-of-week regardless of the offset.
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  return { weekday, hour };
}

export class GitService {
  private activityLog: Array<{ command: string; timestamp: string; success: boolean; duration: number }> = [];
  private cachedRemoteNames: string[] | null = null;
  private remoteNamesCacheTime = 0;
  private pendingRemoteNames: Promise<string[]> | null = null;
  private extraEnv: Record<string, string> = {};
  // Default per-command timeout (ms). Callers can override per call via the
  // `timeout` option; this is the fallback used when they don't. Configurable
  // via the `gitGraphPlus.timeout` setting so large repos can extend it.
  private defaultTimeoutMs = 60000;
  private warningHandler: ((message: string) => void) | null = null;
  private authRetryHandler: ((remote?: string) => Promise<boolean>) | null = null;
  // In-flight read-only operations, keyed by op name. Lets two callers (e.g.
  // a tree-view sidebar refresh and the webview panel refresh kicked off in
  // the same tick during repo switch) collapse onto a single git subprocess.
  private inflight = new Map<string, Promise<unknown>>();

  private dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const p = fn().finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, p);
    return p;
  }

  constructor(private repoPath: string) {}

  /**
   * Override the default per-command timeout (in milliseconds). Non-positive
   * or non-finite values are ignored, keeping the built-in fallback. Wired to
   * the `gitGraphPlus.timeout` setting so users with large repos can extend it.
   */
  setDefaultTimeout(ms: number): void {
    if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) {
      this.defaultTimeoutMs = ms;
    }
  }

  /** Register a callback for non-fatal warnings (e.g., auxiliary git command failures). */
  setWarningHandler(handler: ((message: string) => void) | null): void {
    this.warningHandler = handler;
  }

  /**
   * Register a callback invoked when a remote git command (fetch/pull/push)
   * fails for authentication reasons. The handler is expected to surface
   * VS Code's credential prompt (e.g., by routing through the built-in
   * `vscode.git` extension). Returning `true` means "auth flow ran; please
   * retry"; `false` means "no retry possible".
   */
  setAuthRetryHandler(handler: ((remote?: string) => Promise<boolean>) | null): void {
    this.authRetryHandler = handler;
  }

  private warn(message: string): void {
    console.warn(`Git Graph+: ${message}`);
    try { this.warningHandler?.(message); } catch { /* never let a handler break a git call */ }
  }

  /**
   * Heuristic match against stderr fragments git emits when credentials are
   * missing or wrong. SSH-key failures (`Permission denied (publickey)`) are
   * intentionally excluded — VS Code's askpass can't resolve those, so a
   * retry would just fail again.
   */
  private isAuthError(err: unknown): boolean {
    if (!(err instanceof GitError)) return false;
    const text = `${err.stderr ?? ''}\n${err.message ?? ''}`.toLowerCase();
    return (
      text.includes('authentication failed') ||
      text.includes('could not read username') ||
      text.includes('could not read password') ||
      text.includes('terminal prompts disabled') ||
      text.includes('invalid username or password') ||
      text.includes('authentication required') ||
      text.includes('http basic: access denied')
    );
  }

  /**
   * Runs a git command; on an authentication failure, asks the registered
   * auth retry handler to drive VS Code's credential prompt (same flow the
   * SCM panel uses), then retries the command once.
   */
  // Network operations (fetch/pull/push) run on a much longer timeout than the
  // local-command default: a first clone-sized fetch or a slow link routinely
  // exceeds 60s, and killing it with SIGTERM mid-transfer is worse than waiting.
  private static readonly NETWORK_TIMEOUT_MS = 600_000; // 10 minutes

  private async execWithAuthRetry(args: string[], remote?: string): Promise<string> {
    // Honour a user-raised default if it's larger, but never go below the
    // network floor.
    const timeout = Math.max(this.defaultTimeoutMs, GitService.NETWORK_TIMEOUT_MS);
    try {
      return await this.exec(args, { timeout });
    } catch (err) {
      if (!this.isAuthError(err) || !this.authRetryHandler) throw err;
      const retried = await this.authRetryHandler(remote).catch(() => false);
      if (!retried) throw err;
      return this.exec(args, { timeout });
    }
  }

  private assertSafeRef(ref: string, context: string): void {
    if (typeof ref !== 'string' || ref.length === 0) {
      throw new GitError(`Invalid ref for ${context}`, null, []);
    }
    if (ref.startsWith('-')) {
      throw new GitError(`Ref must not start with '-': ${ref}`, null, []);
    }
  }

  /** Reject paths that escape the repo (absolute, parent traversal) or that git
   * could misinterpret as a flag. Paired with `--` in the actual command. */
  private assertSafePath(filePath: string, context: string): void {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new GitError(`Invalid path for ${context}`, null, []);
    }
    if (filePath.startsWith('-')) {
      throw new GitError(`Path must not start with '-': ${filePath}`, null, []);
    }
    // Reject absolute paths (POSIX `/...` and Windows `C:\...` / `C:/...`) and
    // any `..` traversal so a path can't escape the repo root.
    if (filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.split(/[\\/]/).includes('..')) {
      throw new GitError(`Unsafe path for ${context}: ${filePath}`, null, []);
    }
  }

  setExtraEnv(env: Record<string, string>): void {
    this.extraEnv = env;
  }

  get rootPath(): string { return this.repoPath; }

  // The empty tree object, keyed by the repo's hash algorithm. Used as the diff
  // base for root commits (no parent) so the diff renders the file as fully added.
  private static readonly EMPTY_TREE: Record<string, string> = {
    sha1: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
    sha256: '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321',
  };

  /**
   * Resolves the base revision a single-commit diff compares against — the
   * commit's first parent — to a full SHA. Markdown-diff tooling (mddiff and
   * similar) can't parse the `<sha>~1` shorthand and so can't tell which
   * revisions a diff compares (#51); it needs a plain object name. Root commits
   * have no parent, so we return the empty tree object instead.
   */
  async resolveDiffBaseRef(commitHash: string): Promise<string> {
    this.assertSafeRef(commitHash, 'resolveDiffBaseRef');
    try {
      const parent = (await this.exec(['rev-parse', '--verify', '--quiet', `${commitHash}~1`], { silent: true })).trim();
      if (parent) return parent;
    } catch {
      // `--quiet` exits non-zero with no output when the parent doesn't exist
      // (root commit) — fall through to the empty tree.
    }
    return this.getEmptyTreeRef();
  }

  /**
   * The empty tree object name for this repo's hash algorithm. Diffing against
   * it renders a file as fully added — the only ref the built-in git content
   * provider treats as "missing file ⇒ empty content" instead of throwing
   * `FileNotFound`. Used as the base side when opening a new file's changes in
   * the editor (a brand-new file has no HEAD/index version to diff against).
   */
  async getEmptyTreeRef(): Promise<string> {
    const format = (await this.exec(['rev-parse', '--show-object-format'], { silent: true })).trim();
    return GitService.EMPTY_TREE[format] ?? GitService.EMPTY_TREE.sha1;
  }

  /**
   * Whether `file` exists at `ref` (`ref === ''` checks the index, `:<path>`).
   * Used to pick a diff side's base: a file that's absent at a ref — added or
   * deleted across the diff — must fall back to the empty tree, the only ref
   * the built-in git content provider renders as empty content instead of
   * throwing `FileNotFound` (which surfaces as "cannot open editor, file not
   * found").
   */
  async fileExistsAtRef(ref: string, file: string): Promise<boolean> {
    if (ref !== '') this.assertSafeRef(ref, 'fileExistsAtRef');
    this.assertSafePath(file, 'fileExistsAtRef');
    try {
      await this.exec(['cat-file', '-e', `${ref}:${file}`], { silent: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The real gitdir. In a submodule or linked worktree `.git` is a file
   * pointing at it, so build gitdir paths from here, not by joining `'.git'`.
   */
  private gitDir(): string {
    return resolveGitDirs(this.repoPath).gitDir;
  }

  getActivityLog() {
    return this.activityLog;
  }

  async getReflog(limit = 200, ref = 'HEAD'): Promise<{ entries: Array<{
    hash: string;
    shortHash: string;
    selector: string;
    message: string;
    date: string;
    dangling: boolean;
  }>; hasMore: boolean }> {
    const SEP = '\x1f';
    try {
      const out = await this.exec([
        'reflog', 'show', ref,
        `--format=%H${SEP}%h${SEP}%gd${SEP}%gs`,
        `--date=iso`,
        `-n`, String(limit + 1),
      ], { silent: true });

      const refName = ref === 'HEAD' ? 'HEAD' : ref.replace(/^refs\/(heads|remotes)\//, '');
      const allLines = out.trim().split('\n').filter(Boolean);
      const hasMore = allLines.length > limit;
      const lines = hasMore ? allLines.slice(0, limit) : allLines;

      const entries = lines.map((line, i) => {
        const parts = line.split(SEP);
        // %gd with --date=iso gives "HEAD@{2026-05-02 10:00:00 +0900}" — extract the date inside {}
        const rawSelector = parts[2] ?? '';
        const dateMatch = rawSelector.match(/\{([^}]+)\}/);
        return {
          hash:      parts[0] ?? '',
          shortHash: parts[1] ?? '',
          selector:  `${refName}@{${i}}`,
          message:   parts[3] ?? '',
          date:      dateMatch ? dateMatch[1] : '',
          dangling:  false,
        };
      });

      if (entries.length > 0) {
        // Probe the exact reflog hashes with `cat-file --batch-check` instead
        // of walking the 5000 newest reachable commits. The old cap caused
        // false-positive dangling flags on any repo larger than 5000 commits.
        // cat-file emits "<hash> missing" for objects that no longer exist
        // and "<hash> <type> <size>" for ones that do, so we treat the
        // entry as dangling only when explicitly reported missing.
        const uniqueHashes = Array.from(new Set(entries.map(e => e.hash).filter(Boolean)));
        if (uniqueHashes.length > 0) {
          try {
            const out = await this.exec(['cat-file', '--batch-check'], {
              silent: true,
              stdin: uniqueHashes.join('\n') + '\n',
            });
            const missing = new Set<string>();
            for (const line of out.split('\n')) {
              const m = line.match(/^([0-9a-f]+)\s+missing\b/);
              if (m) missing.add(m[1]);
            }
            for (const entry of entries) {
              entry.dangling = missing.has(entry.hash);
            }
          } catch (err) {
            this.warn(`reflog dangling detection failed: ${err instanceof Error ? err.message : err}`);
          }
        }
      }

      return { entries, hasMore };
    } catch (err) {
      // Surface real failures so the user sees that the reflog tab didn't load
      // for a reason (bad ref, permission, missing HEAD), not just an empty list.
      this.warn(`failed to get reflog: ${err instanceof Error ? err.message : err}`);
      return { entries: [], hasMore: false };
    }
  }

  /**
   * Verify a single commit's signature on demand (for the Commit Details
   * panel). Unlike the graph-wide setting, this only verifies one commit so it
   * is cheap regardless of repo size. Failures degrade to "no signature" rather
   * than throwing, so the panel never breaks on an unverifiable commit.
   */
  async getCommitSignature(hash: string): Promise<CommitSignature> {
    this.assertSafeRef(hash, 'getCommitSignature');
    try {
      const out = await this.exec(
        ['show', '--no-patch', '--format=%G?%x00%GS%x00%GK', hash],
        { silent: true },
      );
      const [code = '', signer = '', keyId = ''] = out.split('\x00');
      const sig: CommitSignature = { status: mapSignatureStatus(code) ?? 'none' };
      const signerTrimmed = signer.trim();
      const keyIdTrimmed = keyId.trim();
      if (signerTrimmed) sig.signer = signerTrimmed;
      if (keyIdTrimmed) sig.keyId = keyIdTrimmed;
      return sig;
    } catch (err) {
      this.warn(`failed to get commit signature: ${err instanceof Error ? err.message : err}`);
      return { status: 'none' };
    }
  }

  private exec(args: string[], options?: { stdin?: string; timeout?: number; silent?: boolean; maxBufferBytes?: number }): Promise<string> {
    const startTime = Date.now();
    const command = `git ${args.join(' ')}`;
    const timeoutMs = options?.timeout ?? this.defaultTimeoutMs;
    const maxBytes = options?.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

    // Force literal UTF-8 pathnames in every command's output. With the
    // default core.quotePath=true, git dquote-escapes non-ASCII paths (e.g.
    // "\355\225\234.txt"), which left the file list (status/name-status/
    // ls-tree) showing escaped paths while the diff view unescaped them — so
    // clicking a non-ASCII (Korean, etc.) file opened no diff. Applied as a
    // `-c` override so it's global, but kept out of the activity-log command
    // string to avoid clutter.
    const spawnArgs = ['-c', 'core.quotePath=false', ...args];

    return new Promise((resolve, reject) => {
      const proc = spawn(getGitBinaryPath(), spawnArgs, {
        cwd: this.repoPath,
        env: { ...process.env, ...this.extraEnv, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GIT_MERGE_AUTOEDIT: 'no', GIT_EDITOR: 'true', EDITOR: 'true' },
      });

      const recordActivity = (success: boolean) => {
        if (options?.silent) return;
        const logCommand = command.length > 500 ? command.substring(0, 500) + '…' : command;
        this.activityLog.unshift({
          command: logCommand,
          timestamp: new Date().toISOString(),
          success,
          duration: Date.now() - startTime,
        });
        if (this.activityLog.length > 200) {
          this.activityLog.length = 200;
        }
      };

      const killHard = () => {
        try { proc.kill('SIGTERM'); } catch { /* already dead */ }
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* already dead */ } }, 5000);
      };

      // Several exit paths can race (timeout, buffer overflow, close, spawn
      // error). Guard so only the first settles the promise and writes one
      // activity-log entry — previously a timeout logged once, then the
      // subsequent process 'close' logged the same command a second time.
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        killHard();
        recordActivity(false);
        reject(new GitError(`Command timed out after ${timeoutMs}ms`, null, args));
      }, timeoutMs);

      if (options?.stdin) {
        // git may close stdin before consuming everything (e.g. it rejects a
        // patch early). The resulting EPIPE surfaces as a writable-stream
        // 'error' event; without a listener Node rethrows it as an
        // uncaughtException and takes down the extension host. The process
        // exit is handled by the 'close'/'error' handlers below, so swallow it.
        proc.stdin.on('error', () => { /* EPIPE on early git exit */ });
        proc.stdin.write(options.stdin);
        proc.stdin.end();
      }

      // Bound stdout/stderr to prevent a pathological git invocation from
      // exhausting the extension host's memory. Overflow rejects immediately
      // and signals the process to terminate.
      const stdoutP = bufferStream(proc.stdout, maxBytes);
      const stderrP = bufferStream(proc.stderr, maxBytes);
      const onOverflow = (label: 'stdout' | 'stderr') => (err: unknown) => {
        if (!(err instanceof BufferOverflowError)) return;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        killHard();
        recordActivity(false);
        reject(new GitError(
          `git ${args[0] ?? ''}: ${label} exceeded ${err.limitBytes} bytes`,
          null,
          args,
        ));
      };
      stdoutP.catch(onOverflow('stdout'));
      stderrP.catch(onOverflow('stderr'));

      proc.on('close', async (code) => {
        clearTimeout(timer);
        // If overflow already rejected, these awaits resolve to empty
        // buffers via the swallow below; the prior reject() wins.
        const [stdoutBuf, stderrBuf] = await Promise.all([
          stdoutP.catch(() => Buffer.alloc(0)),
          stderrP.catch(() => Buffer.alloc(0)),
        ]);
        // A timeout or overflow may have already settled while we awaited the
        // buffers; if so, don't log or resolve a second time.
        if (settled) return;
        settled = true;
        const stdout = stdoutBuf.toString();
        const stderr = stderrBuf.toString();
        recordActivity(code === 0);
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new GitError(stderr, code, args, stdout));
        }
      });

      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        recordActivity(false);
        reject(new GitError(err.message, null, args));
      });
    });
  }

  async log(options?: LogOptions): Promise<Commit[]> {
    // %G? is appended after %b only when signature verification is requested,
    // since it forces GPG verification of every commit in the log (slow on
    // large repos). %b never contains a NUL so the trailing column is unambiguous.
    const format = '%x01%x02%x03%H%x00%h%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%P%x00%D%x00%b'
      + (options?.includeSignature ? '%x00%G?' : '');
    const args = [
      'log',
      `--format=${format}`,
    ];

    if (options?.branches && options.branches.length > 0) {
      for (const branch of options.branches) {
        this.assertSafeRef(branch, 'log');
        args.push(branch);
      }
    } else if (!options?.remoteFilter || options.remoteFilter.length === 0) {
      args.push('--glob=refs/heads', '--glob=refs/remotes', '--glob=refs/tags');
    } else {
      for (const source of options.remoteFilter) {
        if (source === 'local') {
          args.push('--glob=refs/heads');
        } else {
          args.push(`--glob=refs/remotes/${source}`);
        }
      }
      // Omit --glob=refs/tags when filtering: tags on reachable commits still appear via %D,
      // but tag-only commits outside the selected scope are correctly excluded.
    }

    args.push(
      options?.sortOrder === 'topological' ? '--topo-order' :
      options?.sortOrder === 'date' ? '--date-order' :
      '--author-date-order'
    );

    if (options?.limit) {
      args.push(`--max-count=${options.limit}`);
    }

    if (options?.skip) {
      args.push(`--skip=${options.skip}`);
    }

    if (options?.branch) {
      this.assertSafeRef(options.branch, 'log');
      args.push(options.branch);
    }

    // Resolve stashes before running the log: their base commits may need to be
    // added as extra walk start points (below). stashList() is deduped/cached,
    // so awaiting it here doesn't add a round-trip versus the old Promise.all.
    const stashes = await this.stashList();

    // Include each stash's base commit as an extra rev-list start point so git
    // walks the stash's ancestry down to where it rejoins the main history.
    // Without this, a stash whose original branch was rebased or deleted has a
    // base commit that's unreachable from any branch/tag, so it floats orphaned
    // instead of attaching to the tree (#52). Restrict this to the unfiltered
    // first page: with branch/remote filters or pagination the extra ancestry
    // would leak commits outside the requested scope.
    if (
      !options?.skip &&
      !options?.branch &&
      (!options?.branches || options.branches.length === 0) &&
      (!options?.remoteFilter || options.remoteFilter.length === 0)
    ) {
      const seen = new Set<string>();
      for (const s of stashes) {
        const base = s.parentHash;
        if (base && /^[0-9a-f]{7,64}$/i.test(base) && !seen.has(base)) {
          seen.add(base);
          args.push(base);
        }
      }
    }

    const [raw, remoteNames] = await Promise.all([
      this.exec(args),
      this.getRemoteNames(),
    ]);
    const commits = parseLog(raw, remoteNames);

    // Insert stash commits into the graph as separate rows
    if (stashes.length > 0) {
      const stashHashes = stashes.map(s => s.hash).filter(Boolean) as string[];
      if (stashHashes.length > 0) {
        try {
          const stashRaw = await this.exec([
            'log', '--no-walk',
            '--format=%x01%x02%x03%H%x00%h%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%P%x00%D%x00%b',
            ...stashHashes,
          ]);
          const stashCommits = parseLog(stashRaw, remoteNames);
          const stashMap = new Map(stashes.map(s => [s.hash, s]));
          const commitHashIndex = new Map<string, number>();
          for (let i = 0; i < commits.length; i++) commitHashIndex.set(commits[i].hash, i);

          const insertions: Array<{ idx: number; commit: Commit }> = [];
          for (let i = 0; i < stashCommits.length; i++) {
            const sc = stashCommits[i];
            const stash = stashMap.get(sc.hash);
            // Keep only first parent (base commit), drop index/untracked parents
            sc.parents = sc.parents.length > 0 ? [sc.parents[0]] : [];
            // Replace refs with stash badge
            sc.refs = [{ type: 'stash' as const, name: `stash@{${stash?.index ?? i}}` }];
            // Use stash message as subject
            if (stash?.message) sc.subject = stash.message;
            // Insert the stash row directly above its base commit (the array is
            // newest-first, so splicing at the parent's index places the stash
            // just before — i.e. visually on top of — the commit it was created
            // from). If the base commit isn't in the loaded window yet, hide the
            // stash rather than pinning it to the top as an orphaned badge (#52):
            // `--max-count` truncates the date-ordered walk to the newest N
            // commits, so an old stash's base falls outside the window until the
            // user loads more. Once a bigger `limit` pulls the base into the
            // window, the stash reappears attached to the tree. Hidden stashes
            // stay accessible in the sidebar Stash view.
            const parentIdx = commitHashIndex.get(sc.parents[0]);
            if (parentIdx !== undefined) {
              insertions.push({ idx: parentIdx, commit: sc });
            }
          }
          // Sort descending so earlier splices don't shift later indices
          insertions.sort((a, b) => b.idx - a.idx);
          for (const { idx, commit } of insertions) {
            commits.splice(idx, 0, commit);
          }
        } catch (err) { this.warn(`stash log error: ${err instanceof Error ? err.message : err}`); }
      }
    }

    // The UNCOMMITTED summary row belongs only at the very top of the graph.
    // Skip it on paginated (skip>0) pages, otherwise every page would prepend
    // a duplicate row.
    if (commits.length > 0 && !options?.skip) {
      try {
        // `-uall` is intentional: it lists every untracked file individually
        // (instead of collapsing untracked directories like the default
        // `-unormal`) so the "Uncommitted changes (N)" summary row and the
        // staged/unstaged counts match what the detail panel shows file-for-file.
        // .gitignore is still honored, so on a normal repo this stays cheap; the
        // only pathological case is a large *non-ignored* untracked tree, which
        // is rare and which we accept in exchange for accurate counts.
        const porcelain = await this.exec(['status', '--porcelain', '-uall']);
        const lines = porcelain.split('\n').filter(Boolean);
        if (lines.length > 0) {
          let staged = 0, unstaged = 0;
          for (const line of lines) {
            const x = line[0], y = line[1];
            if (x !== ' ' && x !== '?') staged++;
            if (y !== ' ' && y !== '?') unstaged++;
            if (x === '?' && y === '?') unstaged++;
          }
          const parts: string[] = [];
          if (staged > 0) parts.push(`${staged} staged`);
          if (unstaged > 0) parts.push(`${unstaged} unstaged`);
          commits.unshift({
            hash: 'UNCOMMITTED',
            abbreviatedHash: 'UNCOMMITTED',
            parents: [],
            refs: [],
            subject: `Uncommitted changes (${lines.length})`,
            body: JSON.stringify({ staged, unstaged }),
            author: { name: '', email: '', date: '' },
            committer: { name: '', email: '', date: '' },
          });
        }
      } catch (err) {
        this.warn(`failed to check uncommitted status: ${err instanceof Error ? err.message : err}`);
      }
    }

    return commits;
  }

  private async getRemoteNames(): Promise<string[]> {
    const now = Date.now();
    if (this.cachedRemoteNames && now - this.remoteNamesCacheTime < 30000) {
      return this.cachedRemoteNames;
    }
    // Dedupe concurrent callers: if a request is already in flight, await it
    // instead of spawning a duplicate `git remote` process.
    if (this.pendingRemoteNames) {
      return this.pendingRemoteNames;
    }
    const inflight = (async () => {
      try {
        const raw = await this.exec(['remote']);
        const names = raw.trim().split('\n').filter(Boolean);
        this.cachedRemoteNames = names;
        this.remoteNamesCacheTime = Date.now();
        return names;
      } catch (err) {
        this.warn(`failed to get remote names: ${err instanceof Error ? err.message : err}`);
        return [];
      } finally {
        this.pendingRemoteNames = null;
      }
    })();
    this.pendingRemoteNames = inflight;
    return inflight;
  }

  /**
   * Returns raw `git log --graph` output alongside structured commit data.
   * The graph characters are parsed to determine exact column positions.
   */
  async branches(): Promise<BranchInfo[]> {
    return this.dedupe('branches', async () => {
      const raw = await this.exec([
        'branch', '-a', '--format=%(HEAD)%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(refname)',
      ]);
      return parseBranches(raw);
    });
  }

  /**
   * Resolve the repository's default ("main") branch as a local branch name.
   * Tries origin/HEAD first (e.g. refs/remotes/origin/main → "main") and only
   * accepts it if that local branch exists, then falls back to the first of
   * main / master / develop that exists locally. Returns null if none match.
   */
  async defaultBranch(): Promise<string | null> {
    const locals = new Set((await this.branches()).filter(b => !b.remote).map(b => b.name));
    try {
      const ref = (await this.exec(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
      // ref looks like "origin/main"; strip the remote prefix.
      const slash = ref.indexOf('/');
      const name = slash >= 0 ? ref.slice(slash + 1) : ref;
      if (name && locals.has(name)) return name;
    } catch {
      // No origin/HEAD configured — fall through to local fallback.
    }
    for (const candidate of ['main', 'master', 'develop']) {
      if (locals.has(candidate)) return candidate;
    }
    return null;
  }

  async tags(): Promise<TagInfo[]> {
    return this.dedupe('tags', async () => {
      const raw = await this.exec([
        'tag', '-l', '--sort=-creatordate', '--format=%(refname:short)%00%(if)%(*objectname:short)%(then)%(*objectname:short)%(else)%(objectname:short)%(end)%00%(objecttype)%00%(contents:subject)%00%(contents:body)%01%02%03',
      ]);
      return parseTags(raw);
    });
  }

  async remotes(): Promise<RemoteInfo[]> {
    return this.dedupe('remotes', async () => {
      const raw = await this.exec(['remote', '-v']);
      return parseRemotes(raw);
    });
  }

  async stashList(): Promise<StashEntry[]> {
    return this.dedupe('stashList', async () => {
      try {
        const raw = await this.exec([
          'stash', 'list', '--format=%gd%x00%gs%x00%aI%x00%P%x00%H',
        ]);
        return parseStashList(raw);
      } catch (err) {
        console.warn('Git Graph+: failed to list stashes:', err instanceof Error ? err.message : err);
        return [];
      }
    });
  }

  // --- Diff ---

  async diff(options?: { file?: string; ref1?: string; ref2?: string }): Promise<DiffData[]> {
    const args = ['diff', '--no-color'];

    if (options?.ref1) {
      this.assertSafeRef(options.ref1, 'diff');
      args.push(options.ref1);
      if (options?.ref2) {
        this.assertSafeRef(options.ref2, 'diff');
        args.push(options.ref2);
      }
    }

    if (options?.file) {
      this.assertSafePath(options.file, 'diff');
      args.push('--', options.file);
    }

    const raw = await this.exec(args);
    const parsed = parseDiff(raw, options?.file);
    if (options?.ref1 && options?.ref2) {
      return this.attachDiffContent(parsed, { kind: 'ref', ref: options.ref1 }, { kind: 'ref', ref: options.ref2 });
    }
    if (options?.ref1) {
      return this.attachDiffContent(parsed, { kind: 'ref', ref: options.ref1 }, { kind: 'working' });
    }
    return this.attachDiffContent(parsed, { kind: 'index' }, { kind: 'working' });
  }

  // --- Branch Management ---

  async isDirty(): Promise<boolean> {
    const raw = await this.exec(['status', '--porcelain', '-uno']);
    return raw.trim().length > 0;
  }

  async getUncommittedDiff(): Promise<{ staged: Array<{ path: string; status: string }>; unstaged: Array<{ path: string; status: string }> }> {
    const raw = await this.exec(['status', '--porcelain', '-uall']);
    const staged: Array<{ path: string; status: string }> = [];
    const unstaged: Array<{ path: string; status: string }> = [];
    // Do not trim the whole output: porcelain lines may start with a space
    // (e.g. " M file" for unstaged-only modifications), and a leading trim
    // would shift the first line's columns and chop the filename's first char.
    for (const line of raw.split('\n').filter(Boolean)) {
      const x = line[0];
      const y = line[1];
      let path = line.slice(3);
      if (path.includes(' -> ')) path = path.split(' -> ')[1];
      path = path.trim();
      // Untracked entries with a trailing slash are nested git repositories that
      // aren't registered as submodules — git refuses to descend into them, so
      // they surface as a single directory entry. Strip the slash and mark them
      // so the UI can show a meaningful label instead of an empty diff.
      const isNestedRepo = x === '?' && y === '?' && path.endsWith('/');
      if (isNestedRepo) path = path.slice(0, -1);
      if (x !== ' ' && x !== '?') staged.push({ path, status: x });
      if (y !== ' ' && y !== '?') unstaged.push({ path, status: y });
      if (x === '?' && y === '?') unstaged.push({ path, status: isNestedRepo ? 'N' : 'U' });
    }
    return { staged, unstaged };
  }

  async getUncommittedFileDiff(file: string, staged: boolean): Promise<DiffData | null> {
    this.assertSafePath(file, 'diff');
    if (staged) {
      const raw = await this.exec(['diff', '--no-color', '--cached', '--', file]).catch(() => '');
      const parsed = await this.attachDiffContent(parseDiff(raw, file), { kind: 'ref', ref: 'HEAD' }, { kind: 'index' });
      return parsed[0] ?? null;
    }
    const isTracked = await this.exec(['ls-files', '--error-unmatch', '--', file]).then(() => true).catch(() => false);
    if (!isTracked) {
      // --no-index exits with code 1 when differences found (normal); stdout has the diff
      const raw = await this.exec(['diff', '--no-color', '--no-index', '--', '/dev/null', file])
        .catch(err => (err instanceof GitError && err.exitCode === 1) ? err.stdout : '');
      const parsed = await this.attachDiffContent(parseDiff(raw, file), { kind: 'empty' }, { kind: 'working' });
      return parsed[0] ?? null;
    }
    const raw = await this.exec(['diff', '--no-color', '--', file]).catch(() => '');
    const parsed = await this.attachDiffContent(parseDiff(raw, file), { kind: 'index' }, { kind: 'working' });
    return parsed[0] ?? null;
  }

  private async readFileContent(source: FileContentSource, file: string): Promise<string> {
    this.assertSafePath(file, 'read file content');
    try {
      if (source.kind === 'empty') return '';
      if (source.kind === 'working') {
        return await readFile(join(this.repoPath, file), 'utf8');
      }
      if (source.kind === 'index') {
        return await this.exec(['show', `:${file}`], { silent: true });
      }
      this.assertSafeRef(source.ref, 'read file content');
      return await this.exec(['show', `${source.ref}:${file}`], { silent: true });
    } catch {
      // Added/deleted/renamed files may be absent on one side. Treat that side as
      // empty so full-file tokenization can still map the present side accurately.
      return '';
    }
  }

  private async attachDiffContent(
    diffs: DiffData[],
    oldSource: FileContentSource,
    newSource: FileContentSource,
  ): Promise<DiffData[]> {
    return Promise.all(diffs.map(async diff => {
      if (diff.isBinary) return diff;
      const oldPath = diff.oldFile ?? diff.file;
      const newPath = diff.newFile ?? diff.file;
      const [oldText, newText] = await Promise.all([
        this.readFileContent(oldSource, oldPath),
        this.readFileContent(newSource, newPath),
      ]);
      return {
        ...diff,
        content: { oldText, newText, oldPath, newPath },
      };
    }));
  }

  private parseNameStatus(raw: string): Array<{ path: string; status: string; oldPath?: string }> {
    return raw.trim().split('\n').filter(Boolean).map(line => {
      const parts = line.split('\t');
      const status = parts[0].charAt(0);
      // Renames/copies: `Rxxx\told\tnew` — expose the new path and old path.
      if ((status === 'R' || status === 'C') && parts.length >= 3) {
        return { path: parts[parts.length - 1], status, oldPath: parts[1] };
      }
      return { path: parts.slice(1).join('\t'), status };
    });
  }

  async checkout(ref: string, options?: { force?: boolean; merge?: boolean }): Promise<void> {
    this.assertSafeRef(ref, 'checkout');
    const args = ['checkout'];
    if (options?.force) { args.push('--force'); }
    if (options?.merge) { args.push('--merge'); }
    args.push(ref);
    await this.exec(args);
  }

  async clean(directories = true, force = true): Promise<void> {
    const args = ['clean'];
    if (force) { args.push('-f'); }
    if (directories) { args.push('-d'); }
    await this.exec(args);
  }

  /**
   * Check if a ref is a remote branch.
   */
  async isRemoteBranch(ref: string): Promise<boolean> {
    const slashIndex = ref.indexOf('/');
    if (slashIndex <= 0) { return false; }
    const prefix = ref.substring(0, slashIndex);
    const remoteNames = await this.getRemoteNames();
    return remoteNames.includes(prefix);
  }

  async createBranch(name: string, startPoint?: string): Promise<void> {
    this.assertSafeRef(name, 'branch');
    const args = ['branch', name];
    if (startPoint) {
      this.assertSafeRef(startPoint, 'branch');
      args.push(startPoint);
    }
    await this.exec(args);
  }

  async createAndCheckoutBranch(name: string, startPoint?: string, options?: { merge?: boolean }): Promise<void> {
    this.assertSafeRef(name, 'checkout -b');
    const args = ['checkout'];
    if (options?.merge) { args.push('--merge'); }
    args.push('-b', name);
    if (startPoint) {
      this.assertSafeRef(startPoint, 'checkout -b');
      if (await this.isRemoteBranch(startPoint)) {
        args.push('--track');
      }
      args.push(startPoint);
    }
    await this.exec(args);
  }

  async deleteBranch(name: string, force?: boolean): Promise<void> {
    this.assertSafeRef(name, 'branch -d');
    await this.exec(['branch', force ? '-D' : '-d', name]);
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    this.assertSafeRef(oldName, 'branch -m');
    this.assertSafeRef(newName, 'branch -m');
    await this.exec(['branch', '-m', oldName, newName]);
  }

  /** Tagged result so callers can distinguish "old git doesn't accept
   *  --merge-base" (one-time capability probe, permanent fallback) from
   *  "this particular call failed with a bad ref / missing object"
   *  (transient, must not poison the capability flag). */
  private async mergeTreeCheck(ours: string, theirs: string, mergeBase?: string): Promise<
    | { kind: 'ok'; value: { hasConflict: boolean; files: string[]; tree?: string } }
    | { kind: 'unknown-option' }
    | { kind: 'error' }
  > {
    const args = mergeBase
      ? ['merge-tree', '--write-tree', `--merge-base=${mergeBase}`, ours, theirs]
      : ['merge-tree', '--write-tree', ours, theirs];

    // Run through exec() rather than a hand-rolled spawn so we inherit its
    // Buffer.concat (no UTF-8 split across chunks when reading conflicted
    // non-ASCII paths), core.quotePath=false (literal paths), extraEnv (proxy/
    // SSH), and memory cap. merge-tree exits non-zero on conflict/error, which
    // exec surfaces as a GitError carrying stdout/stderr/exitCode.
    let stdout = '';
    let stderr = '';
    let code: number | null = 0;
    try {
      stdout = await this.exec(args, { silent: true, timeout: 15000 });
    } catch (err) {
      if (!(err instanceof GitError)) return { kind: 'error' };
      stdout = err.stdout;
      stderr = err.stderr;
      code = err.exitCode;
    }

    // merge-tree --write-tree output (no -z) is:
    //   <tree OID>
    //   <conflicted file info>   (one "<mode> <oid> <stage>\t<path>" per
    //                             conflicted index entry; empty when clean)
    //   <blank line>
    //   <informational messages> ("CONFLICT (...)" prose, "Auto-merging …")
    const lines = stdout.split('\n');
    const firstLine = lines[0]?.trim();
    // The first line is the merged tree OID (present on both clean and
    // conflicted merges). Callers chain it as the `ours` of the next probe
    // to simulate a sequential rebase.
    const tree = firstLine && /^[0-9a-f]{7,64}$/.test(firstLine) ? firstLine : undefined;
    if (code === 0) {
      return { kind: 'ok', value: { hasConflict: false, files: [], tree } };
    }
    if (stderr.includes('unknown option') || stderr.includes('unrecognized argument')) {
      return { kind: 'unknown-option' };
    }
    // git merge-tree exits 1 on a real conflict (with the file-info section
    // populated) and ~128 on an error like a bad ref / missing object.
    // Treating every non-zero exit as conflict produced phantom
    // "0 conflicting files" banners; gate on real conflict output.
    //
    // Read the conflicting paths from the structured file-info section
    // rather than the prose "CONFLICT (...)" lines: the prose wording
    // varies by conflict type (content / modify-delete / rename / …), so
    // scraping it mis-parsed everything except plain content conflicts
    // (e.g. a modify/delete line yielded the commit hash, not the path).
    const files: string[] = [];
    const seen = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '') break; // blank line terminates the file-info section
      const m = lines[i].match(/^[0-7]{6} [0-9a-f]+ [1-3]\t(.+)$/);
      if (m && !seen.has(m[1])) { seen.add(m[1]); files.push(m[1]); }
    }
    const hasConflictMsg = stdout.includes('CONFLICT');
    if (code === 1 && (files.length > 0 || hasConflictMsg)) {
      // files may be empty if a conflict was signaled but left no index
      // entries (unusual) — still surface the conflict.
      return { kind: 'ok', value: { hasConflict: true, files, tree } };
    }
    // Anything else is a transient error (invalid ref, missing object, OOM).
    return { kind: 'error' };
  }

  async predictConflicts(ours: string, theirs: string, mergeBase?: string): Promise<{ hasConflict: boolean; files: string[] }> {
    this.assertSafeRef(ours, 'merge-tree');
    this.assertSafeRef(theirs, 'merge-tree');
    if (mergeBase) this.assertSafeRef(mergeBase, 'merge-tree');

    if (mergeBase && this.mergeBaseSupported !== false) {
      const result = await this.mergeTreeCheck(ours, theirs, mergeBase);
      if (result.kind === 'ok') {
        this.mergeBaseSupported = true;
        return { hasConflict: result.value.hasConflict, files: result.value.files };
      }
      if (result.kind === 'unknown-option') {
        // Old git (<2.40) — permanently fall back to the no-mergeBase form
        // for the lifetime of this service.
        this.mergeBaseSupported = false;
      }
      // For 'error' (bad ref / missing object / timeout) leave the flag
      // alone and let the no-mergeBase fallback try; one transient failure
      // must not disable per-commit isolation forever.
    }
    const fallback = await this.mergeTreeCheck(ours, theirs);
    return fallback.kind === 'ok'
      ? { hasConflict: fallback.value.hasConflict, files: fallback.value.files }
      : { hasConflict: false, files: [] };
  }

  private mergeBaseSupported: boolean | null = null;

  async predictRebaseConflicts(branch: string, onto: string): Promise<{ hasConflict: boolean; files: string[]; truncated?: boolean }> {
    this.assertSafeRef(branch, 'merge-tree');
    this.assertSafeRef(onto, 'merge-tree');

    const noPrediction = { hasConflict: false, files: [] };

    let mergeBase: string;
    try {
      mergeBase = (await this.exec(['merge-base', onto, branch], { silent: true })).trim();
    } catch {
      const r = await this.mergeTreeCheck(onto, branch);
      return r.kind === 'ok' ? r.value : noPrediction;
    }

    let commitList: string[];
    try {
      commitList = (await this.exec(['log', '--format=%H', '--reverse', `${mergeBase}..${branch}`], { silent: true }))
        .split('\n').filter(Boolean);
    } catch {
      const r = await this.mergeTreeCheck(onto, branch);
      return r.kind === 'ok' ? r.value : noPrediction;
    }

    if (commitList.length === 0) return { hasConflict: false, files: [] };

    // Cap the per-commit conflict probe at 20 to keep the preview responsive.
    // Surface `truncated` so the UI can tell the user the prediction only
    // covers the first 20 commits instead of silently under-reporting.
    const PROBE_LIMIT = 20;
    const truncated = commitList.length > PROBE_LIMIT;
    const commits = commitList.slice(0, PROBE_LIMIT);

    // Replay each commit sequentially onto an accumulating tree, mirroring how
    // a real rebase applies commits one after another. The key is *chaining*:
    // merge-tree --write-tree prints the merged tree OID, which we feed as the
    // `ours` of the next probe. That lets a commit see the files introduced by
    // earlier commits on the same branch. Probing every commit against the
    // original `onto` (the previous implementation) produced phantom conflicts
    // for the common "add a file in one commit, edit it in the next" pattern —
    // the editing commit looked like a modify/delete against an `onto` that
    // never had the file. Like a real rebase, we stop at the first conflicting
    // commit: once a step conflicts there is no resolved tree to chain from, so
    // we report that commit's files and surface the conflict.
    let ours = onto;
    for (const commit of commits) {
      if (this.mergeBaseSupported !== false) {
        const result = await this.mergeTreeCheck(ours, commit, `${commit}^`);
        if (result.kind === 'unknown-option') {
          // Old git (<2.40): no --merge-base, so the isolation/chaining form
          // is unavailable. Switch to the cumulative fallback for good.
          this.mergeBaseSupported = false;
        } else if (result.kind === 'ok') {
          this.mergeBaseSupported = true;
          if (result.value.hasConflict) {
            return { hasConflict: true, files: result.value.files, truncated };
          }
          if (result.value.tree) {
            ours = result.value.tree;
            continue;
          }
          // No tree OID to chain (unexpected on 2.40+) — fall through to the
          // cumulative probe so we don't silently skip this commit.
        }
        // 'error': fall through to the cumulative fallback for this commit only.
      }
      // Old git / fallback: cumulative merge-base..commit diff against the
      // original `onto`. We can't chain trees here (a bare tree has no history
      // for git to derive a merge base from), so this keeps the legacy, over-
      // reporting behavior — acceptable for the rare pre-2.40 git.
      const result = await this.mergeTreeCheck(onto, commit);
      if (result.kind === 'ok' && result.value.hasConflict) {
        return { hasConflict: true, files: result.value.files, truncated };
      }
    }

    return { hasConflict: false, files: [], truncated };
  }

  async merge(branch: string, options?: { noFf?: boolean; ffOnly?: boolean; squash?: boolean }): Promise<void> {
    this.assertSafeRef(branch, 'merge');
    const args = ['merge', branch];
    if (options?.noFf) {
      args.push('--no-ff');
    }
    if (options?.ffOnly) {
      args.push('--ff-only');
    }
    if (options?.squash) {
      args.push('--squash');
    }
    await this.exec(args);
    if (options?.squash) {
      await this.exec(['commit', '--no-edit']);
    }
  }

  async abortMerge(): Promise<void> {
    await this.exec(['merge', '--abort']);
  }

  /** Fast-forward a local branch to a source ref WITHOUT checking it out, via a
   *  local refspec fetch (`git fetch . <src>:<local>`). Because no `+` is used,
   *  git rejects the update when it is not a fast-forward, so diverged local
   *  commits are never clobbered. Works offline against an already-fetched
   *  remote-tracking ref and leaves the working tree / current branch untouched. */
  async fastForwardRef(localBranch: string, sourceRef: string): Promise<void> {
    this.assertSafeRef(localBranch, 'fast-forward');
    this.assertSafeRef(sourceRef, 'fast-forward');
    await this.exec(['fetch', '.', `${sourceRef}:${localBranch}`]);
  }

  async diffCommits(ref1: string, ref2: string): Promise<DiffData[]> {
    this.assertSafeRef(ref1, 'diff');
    this.assertSafeRef(ref2, 'diff');
    const raw = await this.exec(['diff', '--no-color', ref1, ref2]);
    return this.attachDiffContent(parseDiff(raw), { kind: 'ref', ref: ref1 }, { kind: 'ref', ref: ref2 });
  }

  async diffFiles(ref1: string, ref2?: string): Promise<Array<{ path: string; status: string; oldPath?: string }>> {
    this.assertSafeRef(ref1, 'diff');
    if (ref2) this.assertSafeRef(ref2, 'diff');
    const args = ['diff', '--name-status'];
    args.push(ref1);
    if (ref2) args.push(ref2);
    const raw = await this.exec(args);
    return this.parseNameStatus(raw);
  }

  private async commitParents(hash: string): Promise<string[]> {
    try {
      const raw = await this.exec(['log', '-1', '--format=%P', hash], { silent: true });
      return raw.trim().split(/\s+/).filter(Boolean);
    } catch {
      return [];
    }
  }

  private mergeNameStatus(
    lists: Array<Array<{ path: string; status: string; oldPath?: string }>>,
  ): Array<{ path: string; status: string; oldPath?: string }> {
    const priority: Record<string, number> = { R: 5, C: 4, A: 3, D: 2, M: 1 };
    const merged = new Map<string, { path: string; status: string; oldPath?: string }>();
    for (const entries of lists) {
      for (const e of entries) {
        const existing = merged.get(e.path);
        if (!existing || (priority[e.status] ?? 0) > (priority[existing.status] ?? 0)) {
          merged.set(e.path, e);
        }
      }
    }
    return Array.from(merged.values());
  }

  /**
   * If `hash` is one of the repo's stashes, returns its parent hashes
   * (parent 1 = base commit, parent 2 = index snapshot, parent 3 = untracked
   * snapshot when the stash was created with --include-untracked). Returns
   * null for ordinary commits.
   *
   * A stash is internally a merge commit, so the generic merge-diff path would
   * union the diff against every parent — including the untracked snapshot,
   * which is a parentless commit holding only the untracked files. Diffing the
   * stash against that snapshot reports nearly every tracked file as "added"
   * and the untracked files as "deleted" (issue #45). Callers special-case
   * stashes so the changes view shows only what the stash actually changed.
   */
  private async stashParents(hash: string): Promise<string[] | null> {
    const stashes = await this.stashList();
    const isStash = stashes.some(s =>
      s.hash && (s.hash === hash || s.hash.startsWith(hash) || hash.startsWith(s.hash)),
    );
    if (!isStash) return null;
    return this.commitParents(hash);
  }

  async showCommitFiles(hash: string): Promise<Array<{ path: string; status: string; oldPath?: string }>> {
    this.assertSafeRef(hash, 'show');

    const stashParents = await this.stashParents(hash);
    if (stashParents) {
      return this.showStashFiles(hash, stashParents);
    }

    const parents = await this.commitParents(hash);

    if (parents.length === 0) {
      // Root commit has no parent - --root compares against empty tree
      const raw = await this.exec(['diff-tree', '--no-commit-id', '--name-status', '-r', '--root', hash]);
      return this.parseNameStatus(raw);
    }

    if (parents.length === 1) {
      const raw = await this.exec(['diff', '--name-status', `${hash}^..${hash}`]);
      return this.parseNameStatus(raw);
    }

    // Merge commit: union of files changed vs each parent. Using `hash^..hash`
    // would only show changes vs the first parent, hiding everything that
    // came in from parent 2..N (silent data loss for every octopus merge).
    const perParent = await Promise.all(parents.map(async parent => {
      this.assertSafeRef(parent, 'diff');
      const raw = await this.exec(['diff', '--name-status', `${parent}..${hash}`]);
      return this.parseNameStatus(raw);
    }));
    return this.mergeNameStatus(perParent);
  }

  /**
   * File list for a stash: tracked changes vs the base commit (first parent),
   * plus the untracked snapshot (third parent, when present) whose files are
   * all additions. See {@link stashParents} for why the generic path is wrong.
   */
  private async showStashFiles(
    hash: string,
    parents: string[],
  ): Promise<Array<{ path: string; status: string; oldPath?: string }>> {
    const lists: Array<Array<{ path: string; status: string; oldPath?: string }>> = [];

    this.assertSafeRef(parents[0], 'diff');
    const tracked = await this.exec(['diff', '--name-status', `${parents[0]}..${hash}`]);
    lists.push(this.parseNameStatus(tracked));

    if (parents.length >= 3) {
      this.assertSafeRef(parents[2], 'diff');
      const untracked = await this.exec(
        ['diff-tree', '--no-commit-id', '--name-status', '-r', '--root', parents[2]],
      );
      lists.push(this.parseNameStatus(untracked));
    }

    return this.mergeNameStatus(lists);
  }

  async showCommitDiff(hash: string, file?: string): Promise<DiffData[]> {
    this.assertSafeRef(hash, 'show');
    if (file) this.assertSafePath(file, 'show');

    const stashParents = await this.stashParents(hash);
    if (stashParents) {
      return this.showStashDiff(hash, stashParents, file);
    }

    if (file) {
      const result = await this.commitFileDiff(hash, file);
      return this.attachDiffContent(result.parsed, result.oldSource, result.newSource);
    }

    // Overview (no specific file).
    const parents = await this.commitParents(hash);
    if (parents.length === 0) {
      // Root commit: diff against empty tree.
      const parsed = parseDiff(await this.exec(['show', '--no-color', '--format=', hash]));
      return this.attachDiffContent(parsed, { kind: 'empty' }, { kind: 'ref', ref: hash });
    }
    // Single-parent commit, or merge overview (first-parent diff).
    const parsed = parseDiff(await this.exec(['diff', '--no-color', `${hash}^..${hash}`]));
    return this.attachDiffContent(parsed, { kind: 'ref', ref: parents[0] }, { kind: 'ref', ref: hash });
  }

  /**
   * Diff for a single file in a commit, against the appropriate parent, returned
   * as both the raw unified text and its parsed form. Centralising the parent
   * selection here guarantees the displayed diff ({@link showCommitDiff}) and the
   * patch we reverse ({@link reverseCommitChanges}) can never pick different
   * parents — see the merge-commit case below.
   */
  private async commitFileDiff(hash: string, file: string): Promise<CommitFileDiffResult> {
    this.assertSafeRef(hash, 'diff');
    this.assertSafePath(file, 'diff');
    const parents = await this.commitParents(hash);

    if (parents.length === 0) {
      // Root commit: diff against the empty tree.
      const raw = await this.exec(['show', '--no-color', '--format=', hash, '--', file]);
      return { raw, parsed: parseDiff(raw), oldSource: { kind: 'empty' }, newSource: { kind: 'ref', ref: hash } };
    }

    if (parents.length > 1) {
      // Octopus / regular merge: find the first parent whose diff for this file
      // carries real content hunks. The first-parent-only default hides changes
      // that came in from parent 2..N. We test on parsed hunks (not raw
      // non-emptiness) so a mode-only / rename-only diff from an earlier parent
      // doesn't shadow the later parent that actually holds the content.
      for (const parent of parents) {
        this.assertSafeRef(parent, 'diff');
        const raw = await this.exec(['diff', '--no-color', `${parent}..${hash}`, '--', file]);
        const parsed = parseDiff(raw);
        if (parsed.length > 0 && parsed[0].hunks.length > 0) {
          return { raw, parsed, oldSource: { kind: 'ref', ref: parent }, newSource: { kind: 'ref', ref: hash } };
        }
      }
      return { raw: '', parsed: [], oldSource: { kind: 'ref', ref: parents[0] }, newSource: { kind: 'ref', ref: hash } };
    }

    const raw = await this.exec(['diff', '--no-color', `${hash}^..${hash}`, '--', file]);
    return { raw, parsed: parseDiff(raw), oldSource: { kind: 'ref', ref: parents[0] }, newSource: { kind: 'ref', ref: hash } };
  }

  /**
   * Reverse-apply (undo) a commit's change to one file in the working tree.
   * With no selection, undoes the whole file's change; with a hunk index,
   * undoes that hunk; with line indices, undoes just those changed lines.
   * The result lands in the working tree (unstaged) so the user can review it.
   *
   * `hunkIndex`/`lineIndices` index the diff the way the webview rendered it
   * (see patch-builder / git-parser). Throws if there is nothing to reverse or
   * the patch doesn't apply cleanly (e.g. the working tree has diverged).
   */
  async reverseCommitChanges(
    hash: string,
    file: string,
    selection?: { hunkIndex?: number; lineIndices?: number[] },
  ): Promise<void> {
    this.assertSafeRef(hash, 'apply');
    this.assertSafePath(file, 'apply');

    const { raw } = await this.commitFileDiff(hash, file);
    if (!raw.trim()) {
      throw new GitError(`No changes to reverse for ${file} in ${hash.substring(0, 7)}`, null, []);
    }

    const patch = selection && selection.hunkIndex !== undefined
      ? buildReversePatch(raw, selection.hunkIndex, selection.lineIndices)
      : raw;

    // --recount lets git fix up the line counts of our reconstructed hunks;
    // applying without --cached touches only the working tree.
    await this.exec(['apply', '--reverse', '--recount'], { stdin: patch });
  }

  /**
   * Diff for a stash: tracked changes vs the base commit (first parent), plus
   * the untracked snapshot (third parent, when present) shown as additions.
   * See {@link stashParents} for why the generic path is wrong.
   */
  private async showStashDiff(hash: string, parents: string[], file?: string): Promise<DiffData[]> {
    this.assertSafeRef(parents[0], 'diff');
    const trackedArgs = ['diff', '--no-color', `${parents[0]}..${hash}`];
    if (file) trackedArgs.push('--', file);
    const tracked = await this.attachDiffContent(
      parseDiff(await this.exec(trackedArgs)),
      { kind: 'ref', ref: parents[0] },
      { kind: 'ref', ref: hash },
    );

    // A requested file that lives in the tracked diff needs no untracked lookup.
    if (file && tracked.length > 0) return tracked;

    let untracked: DiffData[] = [];
    if (parents.length >= 3) {
      this.assertSafeRef(parents[2], 'diff');
      const untrackedArgs = ['show', '--no-color', '--format=', parents[2]];
      if (file) untrackedArgs.push('--', file);
      untracked = await this.attachDiffContent(
        parseDiff(await this.exec(untrackedArgs)),
        { kind: 'empty' },
        { kind: 'ref', ref: parents[2] },
      );
    }

    if (file) return untracked;
    return [...tracked, ...untracked];
  }

  // 3+ multi-select: union file list + per-commit diff sections. Every union file
  // has ≥1 section (it's in the union because some selected commit changed it),
  // so no file is left without a diff. `hashes` is newest-first; sections preserve
  // that order per file.
  async multiCommitSections(hashes: string[]): Promise<{
    files: Array<{ path: string; status: string; oldPath?: string }>;
    sections: Array<{ file: string; commit: string; diff: DiffData }>;
  }> {
    if (hashes.length === 0) throw new GitError('multiCommitSections requires at least one commit', null, []);
    for (const h of hashes) this.assertSafeRef(h, 'diff');
    const perCommit = await Promise.all(
      hashes.map(async commit => ({ commit, files: await this.showCommitFiles(commit) })),
    );
    const files = this.mergeNameStatus(perCommit.map(p => p.files));
    const sections: Array<{ file: string; commit: string; diff: DiffData }> = [];
    for (const { commit, files: cf } of perCommit) {
      const allDiffs = await this.showCommitDiff(commit);          // whole-commit diff, 1 git call
      const byFile = new Map(allDiffs.map(d => [d.file, d]));
      for (const f of cf) {
        let d = byFile.get(f.path);
        if (!d) {
          // Merge commits: the whole-commit (first-parent) diff omits files changed
          // only vs a non-first parent. Fall back to the merge-aware per-file diff.
          const perFile = await this.showCommitDiff(commit, f.path);
          d = perFile[0];
        }
        if (d) sections.push({ file: f.path, commit, diff: d });
      }
    }
    return { files, sections };
  }

  // --- Phase 4: Remote Management, Rebase ---

  async fetch(remote?: string, options?: { prune?: boolean }): Promise<string> {
    const args = ['fetch'];
    if (remote) {
      args.push(remote);
    } else {
      args.push('--all');
    }
    if (options?.prune) {
      args.push('--prune');
    }
    args.push('--progress');
    return this.execWithAuthRetry(args, remote);
  }

  async pull(remote?: string, branch?: string, options?: { rebase?: boolean }): Promise<string> {
    const args = ['pull'];
    if (options?.rebase) {
      args.push('--rebase');
    }
    if (remote) {
      args.push(remote);
      if (branch) {
        args.push(branch);
      }
    }
    return this.execWithAuthRetry(args, remote);
  }

  async push(remote?: string, branch?: string, options?: { force?: 'with-lease' | 'force'; setUpstream?: boolean }): Promise<string> {
    const args = ['push'];
    if (options?.force === 'force') {
      args.push('--force');
    } else if (options?.force === 'with-lease') {
      args.push('--force-with-lease');
    }
    if (options?.setUpstream) {
      args.push('-u');
    }
    if (remote) {
      args.push(remote);
      if (branch) {
        // Use full refspec to avoid ambiguity when tag and branch names collide
        args.push(`refs/heads/${branch}`);
      }
    }
    return this.execWithAuthRetry(args, remote);
  }

  /**
   * Pushes the current branch, used by "push after rebase/merge/…" follow-up
   * actions. Mirrors the PushModal convention: when the branch has an upstream
   * we push with no remote/refspec (git resolves it from the upstream); when it
   * doesn't, we set upstream (-u) on the default remote (origin if present, else
   * the first remote). With no remotes configured the push is skipped.
   */
  async pushCurrentBranch(options?: { force?: 'with-lease' | 'force' }): Promise<{ pushed: boolean; reason?: 'no-remote' }> {
    const current = (await this.branches()).find(b => b.current);
    if (!current) {
      throw new GitError('No current branch to push (detached HEAD)', null, []);
    }
    if (current.upstream) {
      await this.push(undefined, undefined, { force: options?.force });
      return { pushed: true };
    }
    const remote = await this.defaultPushRemote();
    if (!remote) {
      return { pushed: false, reason: 'no-remote' };
    }
    await this.push(remote, current.name, { force: options?.force, setUpstream: true });
    return { pushed: true };
  }

  /**
   * Publishes a specific branch to the default remote with -u, used by the
   * "publish to remote" follow-up when creating a branch. Works whether or not
   * the branch is currently checked out. Skipped when no remotes are configured.
   */
  async publishBranch(name: string): Promise<{ pushed: boolean; reason?: 'no-remote' }> {
    this.assertSafeRef(name, 'push -u');
    const remote = await this.defaultPushRemote();
    if (!remote) {
      return { pushed: false, reason: 'no-remote' };
    }
    await this.push(remote, name, { setUpstream: true });
    return { pushed: true };
  }

  /** Resolves the default remote to push to: 'origin' when present, else the
   *  first configured remote, or null when none are configured. */
  private async defaultPushRemote(): Promise<string | null> {
    const remotes = await this.getRemoteNames();
    if (remotes.length === 0) {
      return null;
    }
    return remotes.includes('origin') ? 'origin' : remotes[0];
  }

  async addRemote(name: string, url: string): Promise<void> {
    this.assertSafeRef(name, 'remote add');
    this.assertSafeRemoteUrl(url);
    await this.exec(['remote', 'add', name, url]);
    this.cachedRemoteNames = null;
  }

  /** Allow only well-known git transports. file:// is rejected because a
   *  malicious value could point at arbitrary local paths; users who really
   *  need it can configure it via `git remote add` directly. */
  private assertSafeRemoteUrl(url: string): void {
    if (typeof url !== 'string' || url.length === 0) {
      throw new GitError('Invalid remote URL', null, []);
    }
    if (url.startsWith('-')) {
      throw new GitError(`Remote URL must not start with '-': ${url}`, null, []);
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(url)) {
      throw new GitError('Remote URL contains control characters', null, []);
    }
    // SSH shorthand: user@host:path (no scheme). Match before scheme parsing.
    const isSshShorthand = /^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:/.test(url);
    if (isSshShorthand) return;
    // Scheme-based URLs.
    const m = url.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    if (!m) {
      throw new GitError(`Unsupported remote URL: ${url}`, null, []);
    }
    const allowed = new Set(['http', 'https', 'git', 'ssh', 'git+ssh', 'git+https']);
    if (!allowed.has(m[1].toLowerCase())) {
      throw new GitError(`Unsupported remote URL scheme: ${m[1]}`, null, []);
    }
  }

  async getRemoteUrl(remote: string): Promise<string> {
    this.assertSafeRef(remote, 'remote get-url');
    const raw = await this.exec(['remote', 'get-url', remote]);
    return raw.trim();
  }

  async removeRemote(name: string): Promise<void> {
    this.assertSafeRef(name, 'remote remove');
    await this.exec(['remote', 'remove', name]);
    this.cachedRemoteNames = null;
  }

  async setUpstream(localBranch: string, remote: string, remoteBranch: string, options?: { createRemote?: boolean }): Promise<void> {
    this.assertSafeRef(localBranch, 'setUpstream');
    this.assertSafeRef(remote, 'setUpstream');
    this.assertSafeRef(remoteBranch, 'setUpstream');
    if (options?.createRemote) {
      await this.execWithAuthRetry(['push', '-u', remote, `${localBranch}:${remoteBranch}`], remote);
    } else {
      await this.exec(['branch', '--set-upstream-to', `${remote}/${remoteBranch}`, localBranch]);
    }
  }

  async rebase(onto: string, options?: { autostash?: boolean }): Promise<void> {
    this.assertSafeRef(onto, 'rebase');
    const args = ['rebase'];
    if (options?.autostash) {
      args.push('--autostash');
    }
    args.push(onto);
    await this.exec(args);
  }

  async abortRebase(): Promise<void> {
    await this.exec(['rebase', '--abort']);
  }

  async continueRebase(): Promise<void> {
    await this.exec(['rebase', '--continue']);
  }

  async skipRebase(): Promise<void> {
    await this.exec(['rebase', '--skip']);
  }

  private shellEscapeForExec(s: string): string {
    return `'${s.replace(/'/g, "'\\''")}'`;
  }
  /** Build amend command for interactive rebase exec lines.
   *  Single-line → `git commit --amend --no-edit -m 'msg'`.
   *  Multi-line → `printf '%s\n' ... | git commit --amend -F -` (POSIX, no temp files). */
  private buildAmendCommand(message: string): string {
    return buildAmendCommandStr(message, s => this.shellEscapeForExec(s));
  }

  /**
   * Interactive rebase: takes a list of todo entries and applies them.
   * Each entry: { action: 'pick'|'squash'|'fixup'|'edit'|'reword'|'drop', hash: string }
   */
  async interactiveRebase(
    base: string,
    todos: Array<{ action: string; hash: string; subject: string; message?: string }>
  ): Promise<void> {
    this.assertSafeRef(base, 'rebase -i');
    // Validate inputs to prevent injection
    const validActions = ['pick', 'squash', 'fixup', 'reword', 'edit', 'drop'];
    for (const todo of todos) {
      if (!validActions.includes(todo.action)) {
        throw new GitError(`Invalid rebase action: ${todo.action}`, null, ['rebase', '-i']);
      }
      if (!/^[0-9a-f]+$/i.test(todo.hash)) {
        throw new GitError(`Invalid commit hash: ${todo.hash}`, null, ['rebase', '-i']);
      }
    }

    if (todos.length > 0 && (todos[0].action === 'squash' || todos[0].action === 'fixup')) {
      throw new GitError(
        'First rebase entry cannot be squash or fixup',
        null,
        ['rebase', '-i']
      );
    }

    const isSquashLike = (a: string) => a === 'squash' || a === 'fixup';
    const lines: string[] = [];
    let i = 0;

    while (i < todos.length) {
      const todo = todos[i];

      // Squash group: a non-squash target followed by one or more squash/fixup members.
      // Checked before the standalone reword path so that "reword + squash" honors the
      // user's typed final message instead of letting git's default-editor combine messages.
      const isGroupTarget =
        !isSquashLike(todo.action) &&
        i + 1 < todos.length &&
        isSquashLike(todos[i + 1].action);

      if (isGroupTarget) {
        // reword as a group target is equivalent to pick + amend, which we already do via exec below.
        const targetAction = todo.action === 'reword' ? 'pick' : todo.action;
        lines.push(`${targetAction} ${todo.hash}`);

        const finalMessage = (todo.message ?? todo.subject).trim();
        const messageChanged = finalMessage !== todo.subject.trim();
        const userWantsReword = todo.action === 'reword';
        i++;
        while (i < todos.length && isSquashLike(todos[i].action)) {
          lines.push(`${todos[i].action} ${todos[i].hash}`);
          i++;
        }
        // Force the final message when the user changed it OR explicitly chose reword on the target.
        // Without this, fixup-only groups would silently discard the user's edited message, and
        // squash groups would inherit git's default-editor combined message.
        if (finalMessage && (messageChanged || userWantsReword)) {
          lines.push(`exec ${this.buildAmendCommand(finalMessage)}`);
        }
        continue;
      }

      // Standalone reword (no squash/fixup following).
      if (todo.action === 'reword') {
        const msg = (todo.message ?? todo.subject).trim();
        lines.push(`pick ${todo.hash}`);
        if (msg) {
          lines.push(`exec ${this.buildAmendCommand(msg)}`);
        }
        i++;
        continue;
      }
      lines.push(`${todo.action} ${todo.hash}`);
      i++;
    }

    const todoContent = lines.join('\n') + '\n';
    const todoFile = join(this.gitDir(), `ghg-rebase-todo-${randomUUID()}`);

    try {
      await writeFile(todoFile, todoContent, 'utf-8');

      // Use cp/copy to overlay the rebase-todo with our prebuilt one. The path
      // is passed via env var rather than spliced into the command string so
      // that cmd.exe / sh expansion handles repo paths containing &, |, (, ),
      // ^, etc. safely without manual escaping.
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(getGitBinaryPath(), ['rebase', '-i', base], {
          cwd: this.repoPath,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            LC_ALL: 'C',
            GIT_MERGE_AUTOEDIT: 'no',
            GIT_EDITOR: 'true',
            EDITOR: 'true',
            GHG_TODO_FILE: todoFile,
            GIT_SEQUENCE_EDITOR: `cp -- "$GHG_TODO_FILE"`,
          },
        });

        let stderr = '';
        proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
        proc.on('close', async (code) => {
          if (code === 0) { resolve(); return; }
          // git rebase -i exits non-zero when it intentionally pauses for an `edit`
          // step or a conflict. In both cases `.git/rebase-merge` (or rebase-apply)
          // remains on disk and the UI banner will guide the user to continue / abort.
          // Treat that as a successful "paused" outcome instead of throwing, which
          // would surface a redundant error dialog on top of the banner.
          const gitDir = this.gitDir();
          const paused =
            existsSync(join(gitDir, 'rebase-merge')) ||
            existsSync(join(gitDir, 'rebase-apply'));
          if (paused) { resolve(); return; }
          reject(new GitError(stderr, code, ['rebase', '-i', base]));
        });
        proc.on('error', (err) => {
          reject(new GitError(err.message, null, ['rebase', '-i', base]));
        });
      });
    } finally {
      await unlink(todoFile).catch(() => {});
    }
  }

  /**
   * Get commits between base and HEAD for interactive rebase preview.
   */
  async getRebaseCommits(base: string): Promise<Commit[]> {
    this.assertSafeRef(base, 'log');
    const args = [
      'log',
      '--format=%x01%x02%x03%H%x00%h%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%P%x00%D%x00%b',
      '--topo-order',
      '--reverse',
      `${base}..HEAD`,
    ];
    const [raw, remoteNames] = await Promise.all([this.exec(args), this.getRemoteNames()]);
    return parseLog(raw, remoteNames);
  }

  // --- Reset & Discard ---

  async reset(ref: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    this.assertSafeRef(ref, 'reset');
    await this.exec(['reset', `--${mode}`, ref]);
  }

  /**
   * Amend the last commit (HEAD). Folds whatever is currently staged into HEAD
   * (standard `git commit --amend`); unstaged changes are left untouched.
   * - keepMessage → `--no-edit` (reuse the existing message)
   * - otherwise the (required) message replaces it via `-m`
   * - resetDate → `--date=now` (author date to now)
   * - resetAuthor → `--reset-author` (author identity + date to the current user/now)
   * - only → `--only` (amend message/metadata only; do NOT fold staged changes in)
   */
  async amendCommit(options?: { message?: string; keepMessage?: boolean; resetDate?: boolean; resetAuthor?: boolean; only?: boolean }): Promise<void> {
    const args = ['commit', '--amend'];
    if (options?.only) {
      args.push('--only');
    }
    if (options?.keepMessage) {
      args.push('--no-edit');
    } else {
      const msg = (options?.message ?? '').trim();
      if (!msg) {
        throw new GitError('Commit message is required to amend', null, ['commit', '--amend']);
      }
      // A single -m value keeps embedded newlines verbatim (subject + body),
      // and spawn passes it as one argv entry so no shell escaping is needed.
      args.push('-m', msg);
    }
    if (options?.resetDate) {
      args.push('--date=now');
    }
    if (options?.resetAuthor) {
      args.push('--reset-author');
    }
    await this.exec(args);
  }

  async stageFile(filePath: string): Promise<void> {
    this.assertSafePath(filePath, 'add');
    await this.exec(['add', '--', filePath]);
  }

  async getConflictFiles(): Promise<string[]> {
    try {
      const raw = await this.exec(['diff', '--name-only', '--diff-filter=U']);
      return raw.trim().split('\n').filter(Boolean);
    } catch (err) {
      console.warn('Git Graph+: failed to get conflict files:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  async getOperationState(): Promise<{ type: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'squash' | null }> {
    const [merge, cherryPick, revert] = await Promise.allSettled([
      this.exec(['rev-parse', '--verify', 'MERGE_HEAD'], { silent: true }),
      this.exec(['rev-parse', '--verify', 'CHERRY_PICK_HEAD'], { silent: true }),
      this.exec(['rev-parse', '--verify', 'REVERT_HEAD'], { silent: true }),
    ]);
    if (merge.status === 'fulfilled') return { type: 'merge' };
    // Don't rely on REBASE_HEAD: git leaves it behind after `rebase --continue`
    // succeeds, which would falsely report a rebase as still in progress. The
    // canonical marker is the rebase state directory.
    const gitDir = this.gitDir();
    if (existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'))) {
      return { type: 'rebase' };
    }
    if (cherryPick.status === 'fulfilled') return { type: 'cherry-pick' };
    if (revert.status === 'fulfilled') return { type: 'revert' };
    if (existsSync(join(gitDir, 'SQUASH_MSG'))) return { type: 'squash' };
    return { type: null };
  }

  async continueOperation(): Promise<void> {
    // Stage all resolved conflict files before continuing
    await this.exec(['add', '-A']);
    const state = await this.getOperationState();
    switch (state.type) {
      case 'merge': await this.exec(['commit', '--no-edit']); break;
      case 'squash': await this.exec(['commit', '--no-edit']); break;
      case 'rebase': await this.exec(['rebase', '--continue']); break;
      case 'cherry-pick': await this.exec(['cherry-pick', '--continue']); break;
      case 'revert': await this.exec(['revert', '--continue']); break;
    }
  }

  async abortOperation(): Promise<void> {
    const state = await this.getOperationState();
    switch (state.type) {
      case 'merge': await this.abortMerge(); break;
      case 'squash': await this.exec(['reset', '--hard', 'HEAD']); break;
      case 'rebase': await this.abortRebase(); break;
      case 'cherry-pick': await this.exec(['cherry-pick', '--abort']); break;
      case 'revert': await this.exec(['revert', '--abort']); break;
    }
  }

  // --- Phase 5: Stash, Cherry-pick, Revert, Tags ---

  async stashSave(message?: string, includeUntracked?: boolean, keepIndex?: boolean): Promise<void> {
    const args = ['stash', 'push'];
    if (message) {
      args.push('-m', message);
    }
    if (includeUntracked) {
      args.push('--include-untracked');
    }
    if (keepIndex) {
      args.push('--keep-index');
    }
    await this.exec(args);
  }

  async stashApply(index: number): Promise<void> {
    if (!Number.isInteger(index) || index < 0) throw new Error('Invalid stash index');
    await this.exec(['stash', 'apply', `stash@{${index}}`]);
  }

  async stashPop(index: number): Promise<void> {
    if (!Number.isInteger(index) || index < 0) throw new Error('Invalid stash index');
    await this.exec(['stash', 'pop', `stash@{${index}}`]);
  }

  async stashDrop(index: number): Promise<void> {
    if (!Number.isInteger(index) || index < 0) throw new Error('Invalid stash index');
    await this.exec(['stash', 'drop', `stash@{${index}}`]);
  }

  async stashRename(index: number, newMessage: string): Promise<void> {
    if (!Number.isInteger(index) || index < 0) throw new Error('Invalid stash index');
    const ref = `stash@{${index}}`;
    const sha = (await this.exec(['rev-parse', ref])).trim();
    // Renaming a stash means re-storing the same commit under a new reflog
    // subject; `stash store` only prepends a fresh entry when the stored sha
    // differs from the current tip, so it must come *after* the drop (storing
    // the tip's own sha is a no-op and would leave the name unchanged).
    // Capture the original subject first so that if `store` fails after the
    // drop, we can put the stash back instead of stranding it as a dangling
    // commit (the data-loss window of an unguarded drop-then-store).
    const original = (await this.exec(['log', '-1', '--format=%s', sha])).trim();
    await this.exec(['stash', 'drop', ref]);
    try {
      await this.exec(['stash', 'store', '-m', newMessage, sha]);
    } catch (err) {
      await this.exec(['stash', 'store', '-m', original, sha]).catch(() => { /* best effort */ });
      throw err;
    }
  }

  async stashRestoreFiles(index: number, paths: string[]): Promise<void> {
    if (!Number.isInteger(index) || index < 0) throw new Error('Invalid stash index');
    if (!paths || paths.length === 0) throw new Error('No paths to restore');
    for (const p of paths) {
      this.assertSafePath(p, 'stash restore');
    }
    await this.exec(['restore', `--source=stash@{${index}}`, '--', ...paths]);
  }

  async cherryPick(hashes: string | string[], options?: { noCommit?: boolean }): Promise<void> {
    const list = Array.isArray(hashes) ? hashes : [hashes];
    for (const hash of list) {
      this.assertSafeRef(hash, 'cherry-pick');
    }
    const args = ['cherry-pick'];
    if (options?.noCommit) {
      args.push('--no-commit');
    }
    // git applies the listed commits in order, so callers pass them oldest→newest.
    args.push(...list);
    await this.exec(args);
  }

  async revert(hash: string, options?: { noCommit?: boolean }): Promise<void> {
    this.assertSafeRef(hash, 'revert');
    const args = ['revert'];
    if (options?.noCommit) {
      args.push('--no-commit');
    }
    args.push(hash);
    await this.exec(args);
  }

  async commitFixup(hash: string): Promise<void> {
    this.assertSafeRef(hash, 'commit');
    await this.exec(['commit', '--fixup', hash]);
  }

  async commitSquash(hash: string): Promise<void> {
    this.assertSafeRef(hash, 'commit');
    await this.exec(['commit', '--squash', hash]);
  }

  async createTag(name: string, ref?: string, message?: string): Promise<void> {
    this.assertSafeRef(name, 'tag');
    if (ref) this.assertSafeRef(ref, 'tag');
    const args = ['tag'];
    if (message) {
      args.push('-a', name, '-m', message);
    } else {
      args.push(name);
    }
    if (ref) {
      args.push(ref);
    }
    await this.exec(args);
  }

  async deleteTag(name: string): Promise<void> {
    this.assertSafeRef(name, 'tag -d');
    await this.exec(['tag', '-d', name]);
  }

  // --- Phase 6: Search, Commit Template ---

  async searchCommits(query: string, options?: { author?: string; after?: string; before?: string; limit?: number }): Promise<Commit[]> {
    // Defense-in-depth: reject control characters that could inject extra git
    // arguments. spawn() with explicit argv already prevents shell injection,
    // but a newline inside --grep=... lets a single user value carry multiple
    // tokens once git's own argv parser splits on whitespace in some configs.
    const reject = (v: string) => { throw new GitError(`Invalid search input: ${v}`, null, ['log']); };
    // Reject ASCII control chars (newline, CR, NUL, etc.). Spaces and printable
    // punctuation are legitimate in user queries.
    // eslint-disable-next-line no-control-regex
    const hasControl = (v: string) => /[\x00-\x1f\x7f]/.test(v);
    if (query && hasControl(query)) reject(query);
    if (options?.author && hasControl(options.author)) reject(options.author);
    if (options?.after && hasControl(options.after)) reject(options.after);
    if (options?.before && hasControl(options.before)) reject(options.before);

    const args = [
      'log',
      '--format=%x01%x02%x03%H%x00%h%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%P%x00%D%x00%b',
      '--all',
      '--topo-order',
      `--max-count=${options?.limit ?? 200}`,
    ];

    if (query) {
      args.push(`--grep=${query}`, '-i');
    }
    if (options?.author) {
      args.push(`--author=${options.author}`);
    }
    if (options?.after) {
      args.push(`--after=${options.after}`);
    }
    if (options?.before) {
      args.push(`--before=${options.before}`);
    }

    const [raw, remoteNames] = await Promise.all([this.exec(args), this.getRemoteNames()]);
    const commits = parseLog(raw, remoteNames);
    return commits;
  }

  async searchByFile(filePath: string, limit: number = 100): Promise<Commit[]> {
    this.assertSafePath(filePath, 'log');
    const args = [
      'log',
      '--format=%x01%x02%x03%H%x00%h%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%P%x00%D%x00%b',
      '--all',
      `--max-count=${limit}`,
      '--',
      filePath,
    ];
    const [raw, remoteNames] = await Promise.all([this.exec(args), this.getRemoteNames()]);
    const commits = parseLog(raw, remoteNames);
    return commits;
  }

  async searchByHash(hash: string): Promise<Commit | null> {
    try {
      this.assertSafeRef(hash, 'log');
      const args = [
        'log',
        '--format=%x01%x02%x03%H%x00%h%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%P%x00%D%x00%b',
        '-1',
        hash,
      ];
      const [raw, remoteNames] = await Promise.all([this.exec(args), this.getRemoteNames()]);
      const commits = parseLog(raw, remoteNames);
      return commits[0] ?? null;
    } catch (err) {
      console.warn('Git Graph+: failed to get commit by hash:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  // --- Bisect ---

  async bisectStart(bad?: string, good?: string): Promise<string> {
    const args = ['bisect', 'start'];
    if (bad) { this.assertSafeRef(bad, 'bisect start'); args.push(bad); }
    if (good) { this.assertSafeRef(good, 'bisect start'); args.push(good); }
    return this.exec(args);
  }

  async bisectGood(ref?: string): Promise<string> {
    const args = ['bisect', 'good'];
    if (ref) { this.assertSafeRef(ref, 'bisect good'); args.push(ref); }
    return this.exec(args);
  }

  async bisectBad(ref?: string): Promise<string> {
    const args = ['bisect', 'bad'];
    if (ref) { this.assertSafeRef(ref, 'bisect bad'); args.push(ref); }
    return this.exec(args);
  }

  async bisectSkip(): Promise<string> {
    return this.exec(['bisect', 'skip']);
  }

  async bisectReset(): Promise<string> {
    return this.exec(['bisect', 'reset']);
  }

  async bisectLog(): Promise<string> {
    return this.exec(['bisect', 'log']);
  }

  // --- Submodules ---

  async submoduleStatus(): Promise<Array<{ hash: string; path: string; status: string }>> {
    const raw = await this.exec(['submodule', 'status']);
    if (!raw.trim()) { return []; }
    return raw.trim().split('\n').filter(Boolean).map(line => {
      const match = line.match(/^([+ -U])([0-9a-f]+)\s+(\S+)/);
      if (!match) { return { hash: '', path: line.trim(), status: '?' }; }
      return { hash: match[2], path: match[3], status: match[1] === ' ' ? 'clean' : match[1] === '+' ? 'modified' : match[1] === '-' ? 'uninitialized' : 'conflict' };
    });
  }

  async submoduleUpdate(init?: boolean): Promise<string> {
    const args = ['submodule', 'update'];
    if (init) { args.push('--init', '--recursive'); }
    return this.exec(args);
  }

  // --- Git LFS ---

  /** True for LFS errors that are expected configuration limits (file:// or ssh:
   *  remote with no lock server, no remote configured, etc.) rather than real
   *  failures the user should be alerted about. */
  private isExpectedLfsFailure(stderr: string): boolean {
    const s = stderr.toLowerCase();
    return (
      s.includes('missing protocol') ||                  // file:// / unsupported remote
      s.includes('standalone transfer agent') ||          // file:// fallback hint
      s.includes('no such remote') ||
      s.includes("'origin' does not appear to be a git repository") ||
      s.includes('lfs.url') ||                            // unconfigured lock server
      s.includes('this operation requires existing locks') ||
      s.includes('is not a git command') ||              // git-lfs not installed
      s.includes('not a git repository')
    );
  }

  async lfsLsFiles(): Promise<Array<{ oid: string; path: string }>> {
    try {
      const raw = await this.exec(['lfs', 'ls-files']);
      return parseLfsFiles(raw);
    } catch (err) {
      // Stay silent when git-lfs is just not installed (exitCode null = spawn
      // ENOENT) or when the failure is a known configuration limit. Only
      // surface unexpected failures so the warning channel stays signal.
      if (err instanceof GitError && err.exitCode !== null && !this.isExpectedLfsFailure(err.stderr)) {
        this.warn(`LFS ls-files failed: ${err.stderr || err.message}`);
      }
      console.warn('Git Graph+: LFS ls-files failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  async lfsLock(file: string): Promise<string> {
    this.assertSafePath(file, 'lfs lock');
    return this.exec(['lfs', 'lock', '--', file]);
  }

  async lfsUnlock(file: string, force?: boolean): Promise<string> {
    this.assertSafePath(file, 'lfs unlock');
    const args = ['lfs', 'unlock'];
    if (force) { args.push('--force'); }
    args.push('--', file);
    return this.exec(args);
  }

  async lfsLocks(): Promise<Array<{ path: string; owner: string; id: string }>> {
    try {
      const raw = await this.exec(['lfs', 'locks']);
      return parseLfsLocks(raw);
    } catch (err) {
      if (err instanceof GitError && err.exitCode !== null && !this.isExpectedLfsFailure(err.stderr)) {
        this.warn(`LFS locks failed: ${err.stderr || err.message}`);
      }
      console.warn('Git Graph+: LFS locks failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  // --- File tree at commit ---

  async lsTree(ref: string, path?: string): Promise<Array<{ mode: string; type: 'blob' | 'tree'; hash: string; name: string }>> {
    this.assertSafeRef(ref, 'ls-tree');
    const args = ['ls-tree', ref];
    if (path) {
      this.assertSafePath(path, 'ls-tree');
      args.push('--', path);
    }
    const raw = await this.exec(args);
    if (!raw.trim()) { return []; }
    return raw.trim().split('\n').filter(Boolean).map(line => {
      const match = line.match(/^(\d+)\s+(blob|tree)\s+([0-9a-f]+)\s+(.+)$/);
      if (!match) { return { mode: '', type: 'blob' as const, hash: '', name: line }; }
      return { mode: match[1], type: match[2] as 'blob' | 'tree', hash: match[3], name: match[4] };
    });
  }

  // --- Statistics ---

  async statsCommitsByAuthor(): Promise<Array<{ author: string; email: string; count: number }>> {
    const raw = await this.exec(['shortlog', '-sne', '--all', '--no-merges']);
    if (!raw.trim()) { return []; }
    return raw.trim().split('\n').filter(Boolean).map(line => {
      const match = line.match(/^\s*(\d+)\s+(.+?)\s+<(.+?)>$/);
      if (!match) { return { author: line.trim(), email: '', count: 0 }; }
      return { author: match[2].trim(), email: match[3].trim(), count: parseInt(match[1], 10) };
    });
  }

  async statsCommitsByWeekdayHour(): Promise<Array<{ weekday: number; hour: number; count: number }>> {
    const raw = await this.exec(['log', '--all', '--format=%aI', '--no-merges']);
    if (!raw.trim()) { return []; }
    const grid = new Map<string, number>();
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      const bin = binCommitTime(line.trim());
      if (!bin) continue;
      const key = `${bin.weekday}-${bin.hour}`;
      grid.set(key, (grid.get(key) ?? 0) + 1);
    }
    return Array.from(grid.entries()).map(([key, count]) => {
      const [weekday, hour] = key.split('-').map(Number);
      return { weekday, hour, count };
    });
  }

  // --- Patch ---

  async formatPatch(hash: string, paths?: string[]): Promise<string> {
    this.assertSafeRef(hash, 'format-patch');
    const args = ['format-patch', '-1', hash, '--stdout'];
    if (paths && paths.length > 0) {
      for (const p of paths) {
        this.assertSafePath(p, 'format-patch');
      }
      args.push('--', ...paths);
    }
    return this.exec(args);
  }

  async diffCommitToWorking(hash: string): Promise<DiffData[]> {
    this.assertSafeRef(hash, 'diff');
    const raw = await this.exec(['diff', hash]);
    return this.attachDiffContent(parseDiff(raw), { kind: 'ref', ref: hash }, { kind: 'working' });
  }

  // --- Git Flow ---

  private async localBranchExists(name: string): Promise<boolean> {
    this.assertSafeRef(name, 'branch exists');
    try {
      await this.exec(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], { silent: true });
      return true;
    } catch {
      return false;
    }
  }

  private async assertLocalBranchExists(name: string, operation: string): Promise<void> {
    if (await this.localBranchExists(name)) return;
    throw new GitError(`${operation} reported success, but branch '${name}' was not created.`, 1, []);
  }

  private async pullRebaseBranchesBehindUpstream(branchNames: string[]): Promise<void> {
    const names = Array.from(new Set(branchNames.filter(Boolean)));
    if (names.length === 0) return;
    const nameSet = new Set(names);
    const branches = await this.branches();
    const behindBranches = branches
      .filter(branch => !branch.remote && nameSet.has(branch.name) && !!branch.upstream && !branch.upstreamGone && branch.behind > 0);
    if (behindBranches.length === 0) return;

    const currentBranch = branches.find(branch => branch.current && !branch.remote)?.name;
    const originalRef = currentBranch
      ?? await this.exec(['rev-parse', '--verify', 'HEAD'], { silent: true }).then(s => s.trim()).catch(() => undefined);
    let checkedOutBranch = currentBranch;

    for (const branch of behindBranches) {
      if (checkedOutBranch !== branch.name) {
        await this.checkout(branch.name);
        checkedOutBranch = branch.name;
      }
      await this.pull(undefined, undefined, { rebase: true });
    }

    if (originalRef && checkedOutBranch !== originalRef) {
      await this.checkout(originalRef);
    }
  }

  private async requireFlowConfig(): Promise<GitFlowConfig> {
    const config = await this.getFlowConfig();
    if (!config) {
      throw new GitError('Git Flow is not initialized for this repository.', 1, ['flow']);
    }
    return config;
  }

  private flowConfigMatches(config: GitFlowConfig, options: GitFlowConfig): boolean {
    return config.productionBranch === options.productionBranch
      && config.developBranch === options.developBranch
      && config.featurePrefix === options.featurePrefix
      && config.releasePrefix === options.releasePrefix
      && config.hotfixPrefix === options.hotfixPrefix
      && config.versionTagPrefix === options.versionTagPrefix;
  }

  private async clearFlowBranchConfig(): Promise<void> {
    await Promise.all([
      this.exec(['config', '--local', '--unset-all', 'gitflow.branch.master'], { silent: true }).catch(() => undefined),
      this.exec(['config', '--local', '--unset-all', 'gitflow.branch.develop'], { silent: true }).catch(() => undefined),
    ]);
  }

  private async writeFlowConfig(options: GitFlowConfig): Promise<void> {
    await this.exec(['config', '--local', '--replace-all', 'gitflow.branch.master', options.productionBranch]);
    await this.exec(['config', '--local', '--replace-all', 'gitflow.branch.develop', options.developBranch]);
    await this.exec(['config', '--local', '--replace-all', 'gitflow.prefix.feature', options.featurePrefix]);
    await this.exec(['config', '--local', '--replace-all', 'gitflow.prefix.release', options.releasePrefix]);
    await this.exec(['config', '--local', '--replace-all', 'gitflow.prefix.hotfix', options.hotfixPrefix]);
    await this.exec(['config', '--local', '--replace-all', 'gitflow.prefix.versiontag', options.versionTagPrefix]);
  }

  async flowInit(options: {
    productionBranch: string;
    developBranch: string;
    featurePrefix: string;
    releasePrefix: string;
    hotfixPrefix: string;
    versionTagPrefix: string;
  }): Promise<string> {
    if (options.productionBranch === options.developBranch) {
      throw new GitError('Git Flow production and develop branches must be different.', 1, ['flow', 'init']);
    }

    if (!(await this.localBranchExists(options.productionBranch))) {
      throw new GitError(
        `Branch '${options.productionBranch}' does not exist. Create the production branch first or ensure at least one commit exists.`,
        1,
        ['flow', 'init']
      );
    }
    await this.pullRebaseBranchesBehindUpstream([options.productionBranch]);

    await this.clearFlowBranchConfig();
    await this.exec(['config', '--local', '--replace-all', 'gitflow.branch.master', options.productionBranch]);
    await this.exec(['config', '--local', '--replace-all', 'gitflow.branch.develop', options.developBranch]);
    await this.exec(['flow', 'init', '-f', '-d']);

    if (!(await this.localBranchExists(options.developBranch))) {
      await this.exec(['branch', options.developBranch, options.productionBranch]);
    }
    await this.assertLocalBranchExists(options.developBranch, 'Git Flow initialization');

    await this.writeFlowConfig(options);

    const persistedConfig = await this.getFlowConfig();
    if (!persistedConfig || !this.flowConfigMatches(persistedConfig, options)) {
      throw new GitError('Git Flow initialization did not persist the requested configuration.', 1, ['flow', 'init']);
    }

    return 'Git Flow initialized';
  }

  async flowFeatureStart(name: string): Promise<string> {
    this.assertSafeRef(name, 'flow feature start');
    const config = await this.requireFlowConfig();
    await this.pullRebaseBranchesBehindUpstream([config.developBranch]);
    const result = await this.exec(['flow', 'feature', 'start', name]);
    await this.assertLocalBranchExists(`${config.featurePrefix}${name}`, 'Git Flow feature start');
    return result;
  }

  async flowFeatureFinish(name: string): Promise<string> {
    this.assertSafeRef(name, 'flow feature finish');
    const config = await this.requireFlowConfig();
    await this.pullRebaseBranchesBehindUpstream([
      config.developBranch,
      `${config.featurePrefix}${name}`,
    ]);
    return this.exec(['flow', 'feature', 'finish', name]);
  }

  async flowReleaseStart(version: string): Promise<string> {
    this.assertSafeRef(version, 'flow release start');
    const config = await this.requireFlowConfig();
    await this.pullRebaseBranchesBehindUpstream([config.developBranch]);
    const result = await this.exec(['flow', 'release', 'start', version]);
    await this.assertLocalBranchExists(`${config.releasePrefix}${version}`, 'Git Flow release start');
    return result;
  }

  async flowReleaseFinish(version: string): Promise<string> {
    this.assertSafeRef(version, 'flow release finish');
    const config = await this.requireFlowConfig();
    await this.pullRebaseBranchesBehindUpstream([
      config.productionBranch,
      config.developBranch,
      `${config.releasePrefix}${version}`,
    ]);
    return this.exec(['flow', 'release', 'finish', '-m', version, version]);
  }

  async flowHotfixStart(version: string): Promise<string> {
    this.assertSafeRef(version, 'flow hotfix start');
    const config = await this.requireFlowConfig();
    await this.pullRebaseBranchesBehindUpstream([config.productionBranch]);
    const result = await this.exec(['flow', 'hotfix', 'start', version]);
    await this.assertLocalBranchExists(`${config.hotfixPrefix}${version}`, 'Git Flow hotfix start');
    return result;
  }

  async flowHotfixFinish(version: string): Promise<string> {
    this.assertSafeRef(version, 'flow hotfix finish');
    const config = await this.requireFlowConfig();
    await this.pullRebaseBranchesBehindUpstream([
      config.productionBranch,
      config.developBranch,
      `${config.hotfixPrefix}${version}`,
    ]);
    return this.exec(['flow', 'hotfix', 'finish', '-m', version, version]);
  }

  async getFlowConfig(): Promise<GitFlowConfig | null> {
    try {
      const [production, develop, feature, release, hotfix, versionTag] = await Promise.all([
        this.exec(['config', '--local', '--get', 'gitflow.branch.master']).then(s => s.trim()),
        this.exec(['config', '--local', '--get', 'gitflow.branch.develop']).then(s => s.trim()),
        this.exec(['config', '--local', '--get', 'gitflow.prefix.feature']).then(s => s.trim()),
        this.exec(['config', '--local', '--get', 'gitflow.prefix.release']).then(s => s.trim()),
        this.exec(['config', '--local', '--get', 'gitflow.prefix.hotfix']).then(s => s.trim()),
        this.exec(['config', '--local', '--get', 'gitflow.prefix.versiontag']).then(s => s.trim()).catch(() => ''),
      ]);
      return {
        productionBranch: production,
        developBranch: develop,
        featurePrefix: feature,
        releasePrefix: release,
        hotfixPrefix: hotfix,
        versionTagPrefix: versionTag,
      };
    } catch (err) {
      if (err instanceof GitError && err.exitCode === 1) return null;
      console.warn('Git Graph+: failed to get flow config:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  async getFlowBranches(): Promise<{ features: string[]; releases: string[]; hotfixes: string[] }> {
    const config = await this.getFlowConfig();
    if (!config) return { features: [], releases: [], hotfixes: [] };

    const raw = await this.exec(['branch', '--list']).then(s => s.trim());
    const branches = raw.split('\n').map(b => b.replace(/^\*?\s+/, '').trim()).filter(Boolean);

    return {
      features: branches.filter(b => b.startsWith(config.featurePrefix)),
      releases: branches.filter(b => b.startsWith(config.releasePrefix)),
      hotfixes: branches.filter(b => b.startsWith(config.hotfixPrefix)),
    };
  }

  // --- Worktree ---

  async worktreeList(): Promise<WorktreeInfo[]> {
    return this.dedupe('worktreeList', async () => {
      const raw = await this.exec(['worktree', 'list', '--porcelain']);
      return parseWorktreeList(raw);
    });
  }

  async worktreeAdd(worktreePath: string, branch?: string, newBranch?: string): Promise<void> {
    if (newBranch) { this.assertSafeRef(newBranch, 'worktree add'); }
    if (branch) { this.assertSafeRef(branch, 'worktree add'); }
    const args = ['worktree', 'add'];
    if (newBranch) {
      args.push('-b', newBranch);
    }
    args.push(worktreePath);
    if (branch) {
      args.push(branch);
    }
    await this.exec(args);
  }

  async worktreeRemove(worktreePath: string, force?: boolean): Promise<void> {
    const args = ['worktree', 'remove'];
    if (force) { args.push('--force'); }
    args.push(worktreePath);
    await this.exec(args);
  }

  async worktreePrune(): Promise<void> {
    await this.exec(['worktree', 'prune']);
  }

  // --- Tag Remote Operations ---

  async pushTag(name: string, remote?: string): Promise<string> {
    this.assertSafeRef(name, 'push refs/tags');
    if (remote) { this.assertSafeRef(remote, 'push refs/tags'); }
    const r = remote || 'origin';
    return this.execWithAuthRetry(['push', r, `refs/tags/${name}`], r);
  }

  async pushTagToAllRemotes(name: string): Promise<void> {
    this.assertSafeRef(name, 'push refs/tags');
    const remotes = await this.getRemoteNames();
    for (const r of remotes) {
      await this.execWithAuthRetry(['push', r, `refs/tags/${name}`], r);
    }
  }

  async pushAllTags(remote?: string): Promise<string> {
    if (remote) { this.assertSafeRef(remote, 'push --tags'); }
    const r = remote || 'origin';
    return this.execWithAuthRetry(['push', r, '--tags'], r);
  }

  async deleteRemoteBranch(name: string, remote?: string): Promise<string> {
    this.assertSafeRef(name, 'push --delete');
    if (remote) { this.assertSafeRef(remote, 'push --delete'); }
    const r = remote || 'origin';
    return this.execWithAuthRetry(['push', r, '--delete', name], r);
  }

  async deleteRemoteTag(name: string, remote?: string): Promise<string> {
    this.assertSafeRef(name, 'push :refs/tags');
    if (remote) { this.assertSafeRef(remote, 'push :refs/tags'); }
    const r = remote || 'origin';
    return this.execWithAuthRetry(['push', r, `:refs/tags/${name}`], r);
  }

  async deleteTagFromAllRemotes(name: string): Promise<void> {
    this.assertSafeRef(name, 'push :refs/tags');
    const remotes = await this.getRemoteNames();
    const errors: unknown[] = [];
    for (const r of remotes) {
      try {
        await this.execWithAuthRetry(['push', r, `:refs/tags/${name}`], r);
      } catch (err) {
        // A tag that was never pushed to this remote makes git fail with
        // "remote ref does not exist" — that's already the desired end state,
        // so skip it and keep deleting from the remaining remotes. Anything
        // else (auth, network) is collected and surfaced after every remote
        // has been attempted, so one bad remote can't block the others.
        if (err instanceof GitError && /remote ref does not exist/i.test(err.stderr)) {
          continue;
        }
        errors.push(err);
      }
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      // Surface every failing remote, not just the first, so one error doesn't
      // hide the others.
      throw new AggregateError(errors, `Failed to delete tag from ${errors.length} remotes`);
    }
  }

  // --- Image at ref (binary-safe) ---

  async getImageBase64(ref: string, filePath: string): Promise<string> {
    this.assertSafeRef(ref, 'show');
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new GitError('Invalid filePath for show', null, []);
    }
    // Reject absolute paths and any segment equal to '..' to keep reads within the repo tree.
    if (filePath.startsWith('/') || filePath.split(/[\\/]/).includes('..')) {
      throw new GitError(`Unsafe filePath: ${filePath}`, null, []);
    }
    const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50MB limit
    return new Promise((resolve, reject) => {
      const proc = spawn(getGitBinaryPath(), ['show', `${ref}:${filePath}`], {
        cwd: this.repoPath,
        env: { ...process.env, ...this.extraEnv, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GIT_MERGE_AUTOEDIT: 'no', GIT_EDITOR: 'true', EDITOR: 'true' },
      });

      const timer = setTimeout(() => { proc.kill('SIGTERM'); reject(new GitError('Image load timed out', null, ['show'])); }, 30000);
      const chunks: Buffer[] = [];
      let totalSize = 0;
      proc.stdout.on('data', (data: Buffer) => {
        totalSize += data.length;
        if (totalSize > MAX_IMAGE_SIZE) { proc.kill('SIGTERM'); return; }
        chunks.push(data);
      });

      let stderr = '';
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (totalSize > MAX_IMAGE_SIZE) {
          reject(new GitError('Image file too large', null, ['show', `${ref}:${filePath}`]));
        } else if (code === 0) {
          const buffer = Buffer.concat(chunks);
          resolve(buffer.toString('base64'));
        } else {
          reject(new GitError(stderr, code, ['show', `${ref}:${filePath}`]));
        }
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new GitError(err.message, null, ['show', `${ref}:${filePath}`]));
      });
    });
  }

  async isFlowInstalled(): Promise<boolean> {
    try {
      await this.exec(['flow', 'version']);
      return true;
    } catch (err) { console.warn('Git Graph+: flow version check failed:', err instanceof Error ? err.message : err); return false; }
  }

  async isFlowInitialized(): Promise<boolean> {
    try {
      const config = await this.getFlowConfig();
      if (!config) return false;
      const [productionExists, developExists] = await Promise.all([
        this.localBranchExists(config.productionBranch),
        this.localBranchExists(config.developBranch),
      ]);
      return productionExists && developExists;
    } catch (err) {
      if (err instanceof GitError && err.exitCode === 1) return false;
      console.warn('Git Graph+: flow init check failed:', err instanceof Error ? err.message : err);
      return false;
    }
  }

}

/**
 * Build a `git commit --amend` command for use in interactive rebase exec lines.
 * Single-line messages → `--no-edit -m 'msg'`.
 * Multi-line messages → POSIX printf pipeline to preserve newlines.
 */
export function buildAmendCommandStr(message: string, escape: (s: string) => string): string {
  if (!message.includes('\n')) {
    return `git commit --amend --no-edit -m ${escape(message)}`;
  }
  const parts = message.split('\n').map(l => escape(l));
  return `printf '%s\\n' ${parts.join(' ')} | git commit --amend -F -`;
}
