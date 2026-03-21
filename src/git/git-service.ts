import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { parseLog, parseBranches, parseTags, parseRemotes, parseStashList, parseDiff, parseWorktreeList, parseLfsFiles, parseLfsLocks } from './git-parser';
import type { Commit, BranchInfo, TagInfo, RemoteInfo, StashEntry, LogOptions, DiffData, WorktreeInfo } from './types';

export class GitError extends Error {
  constructor(
    public stderr: string,
    public exitCode: number | null,
    public args: string[]
  ) {
    super(`git ${args.join(' ')} failed (exit ${exitCode}): ${stderr.trim()}`);
    this.name = 'GitError';
  }
}

export class GitService {
  private activityLog: Array<{ command: string; timestamp: string; success: boolean; duration: number }> = [];
  private cachedRemoteNames: string[] | null = null;
  private remoteNamesCacheTime = 0;

  constructor(private repoPath: string) {}

  get rootPath(): string { return this.repoPath; }

  getActivityLog() {
    return this.activityLog;
  }

  private exec(args: string[], options?: { stdin?: string; timeout?: number }): Promise<string> {
    const startTime = Date.now();
    const command = `git ${args.join(' ')}`;
    const timeoutMs = options?.timeout ?? 30000;

    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, {
        cwd: this.repoPath,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GIT_MERGE_AUTOEDIT: 'no', GIT_EDITOR: 'true', EDITOR: 'true' },
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new GitError(`Command timed out after ${timeoutMs}ms`, null, args));
      }, timeoutMs);

      let stdout = '';
      let stderr = '';

      if (options?.stdin) {
        proc.stdin.write(options.stdin);
        proc.stdin.end();
      }

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        const duration = Date.now() - startTime;
        this.activityLog.unshift({
          command,
          timestamp: new Date().toISOString(),
          success: code === 0,
          duration,
        });
        // Keep last 200 entries
        if (this.activityLog.length > 200) {
          this.activityLog.length = 200;
        }

        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new GitError(stderr, code, args));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.activityLog.unshift({
          command,
          timestamp: new Date().toISOString(),
          success: false,
          duration: Date.now() - startTime,
        });
        reject(new GitError(err.message, null, args));
      });
    });
  }

  async log(options?: LogOptions): Promise<Commit[]> {
    const args = [
      'log',
      '--format=%x01%H%x00%h%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%P%x00%D%x00%b',
    ];

    if (options?.all !== false) {
      args.push('--all');
    }

    args.push('--topo-order');

    if (options?.limit) {
      args.push(`--max-count=${options.limit}`);
    }

    if (options?.skip) {
      args.push(`--skip=${options.skip}`);
    }

    if (options?.branch) {
      args.push(options.branch);
    }

    const [raw, remoteNames] = await Promise.all([
      this.exec(args),
      this.getRemoteNames(),
    ]);
    const commits = parseLog(raw, remoteNames);
    return commits;
  }

  private async getRemoteNames(): Promise<string[]> {
    const now = Date.now();
    if (this.cachedRemoteNames && now - this.remoteNamesCacheTime < 30000) {
      return this.cachedRemoteNames;
    }
    try {
      const raw = await this.exec(['remote']);
      this.cachedRemoteNames = raw.trim().split('\n').filter(Boolean);
      this.remoteNamesCacheTime = now;
      return this.cachedRemoteNames;
    } catch {
      return [];
    }
  }

  /**
   * Returns raw `git log --graph` output alongside structured commit data.
   * The graph characters are parsed to determine exact column positions.
   */
  async branches(): Promise<BranchInfo[]> {
    const raw = await this.exec([
      'branch', '-a', '--format=%(HEAD)%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(refname)',
    ]);
    return parseBranches(raw);
  }

  async tags(): Promise<TagInfo[]> {
    const raw = await this.exec([
      'tag', '-l', '--sort=-creatordate', '--format=%(refname:short)%00%(if)%(*objectname:short)%(then)%(*objectname:short)%(else)%(objectname:short)%(end)%00%(objecttype)%00%(contents:subject)',
    ]);
    return parseTags(raw);
  }

  async remotes(): Promise<RemoteInfo[]> {
    const raw = await this.exec(['remote', '-v']);
    return parseRemotes(raw);
  }

  async stashList(): Promise<StashEntry[]> {
    try {
      const raw = await this.exec([
        'stash', 'list', '--format=%gd%x00%gs%x00%aI',
      ]);
      return parseStashList(raw);
    } catch {
      return [];
    }
  }

  // --- Diff ---

  async diff(options?: { file?: string; ref1?: string; ref2?: string }): Promise<DiffData[]> {
    const args = ['diff', '--no-color'];

    if (options?.ref1) {
      args.push(options.ref1);
      if (options?.ref2) {
        args.push(options.ref2);
      }
    }

    if (options?.file) {
      args.push('--', options.file);
    }

    const raw = await this.exec(args);
    return parseDiff(raw, options?.file);
  }

  // --- Branch Management ---

  async checkout(ref: string): Promise<void> {
    await this.exec(['checkout', ref]);
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
    const args = ['branch', name];
    if (startPoint) {
      args.push(startPoint);
    }
    await this.exec(args);
  }

  async createAndCheckoutBranch(name: string, startPoint?: string): Promise<void> {
    const args = ['checkout', '-b', name, '--track'];
    if (startPoint) {
      args.push(startPoint);
    }
    await this.exec(args);
  }

  async deleteBranch(name: string, force?: boolean): Promise<void> {
    await this.exec(['branch', force ? '-D' : '-d', name]);
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    await this.exec(['branch', '-m', oldName, newName]);
  }

  async merge(branch: string, options?: { noFf?: boolean; ffOnly?: boolean; squash?: boolean }): Promise<void> {
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
  }

  async abortMerge(): Promise<void> {
    await this.exec(['merge', '--abort']);
  }

  async diffCommits(ref1: string, ref2: string): Promise<DiffData[]> {
    const raw = await this.exec(['diff', '--no-color', ref1, ref2]);
    return parseDiff(raw);
  }

  async diffFiles(ref1: string, ref2?: string): Promise<Array<{ path: string; status: string }>> {
    const args = ['diff', '--name-status'];
    args.push(ref1);
    if (ref2) args.push(ref2);
    const raw = await this.exec(args);
    return raw.trim().split('\n').filter(Boolean).map(line => {
      const [status, ...rest] = line.split('\t');
      return { path: rest.join('\t'), status: status[0] };
    });
  }

  async showCommitFiles(hash: string): Promise<Array<{ path: string; status: string }>> {
    try {
      const raw = await this.exec(['diff', '--name-status', `${hash}^..${hash}`]);
      return raw.trim().split('\n').filter(Boolean).map(line => {
        const [status, ...rest] = line.split('\t');
        return { path: rest.join('\t'), status: status[0] }; // R100 → R
      });
    } catch {
      const raw = await this.exec(['diff-tree', '--no-commit-id', '--name-status', '-r', hash]);
      return raw.trim().split('\n').filter(Boolean).map(line => {
        const [status, ...rest] = line.split('\t');
        return { path: rest.join('\t'), status: status[0] };
      });
    }
  }

  async showCommitDiff(hash: string): Promise<DiffData[]> {
    // For merge commits, diff against first parent (hash^1..hash)
    // For regular commits, git show works fine
    try {
      const raw = await this.exec(['diff', '--no-color', `${hash}^..${hash}`]);
      return parseDiff(raw);
    } catch {
      // Fallback for root commits (no parent)
      const raw = await this.exec(['show', '--no-color', '--format=', hash]);
      return parseDiff(raw);
    }
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
    return this.exec(args);
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
    return this.exec(args);
  }

  async push(remote?: string, branch?: string, options?: { force?: boolean; setUpstream?: boolean }): Promise<string> {
    const args = ['push'];
    if (options?.force) {
      args.push('--force-with-lease');
    }
    if (options?.setUpstream) {
      args.push('-u');
    }
    if (remote) {
      args.push(remote);
      if (branch) {
        args.push(branch);
      }
    }
    return this.exec(args);
  }

  async addRemote(name: string, url: string): Promise<void> {
    await this.exec(['remote', 'add', name, url]);
  }

  async removeRemote(name: string): Promise<void> {
    await this.exec(['remote', 'remove', name]);
  }

  async setUpstream(remote: string, branch: string): Promise<void> {
    await this.exec(['branch', '--set-upstream-to', `${remote}/${branch}`]);
  }

  async rebase(onto: string, options?: { autostash?: boolean }): Promise<void> {
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

  /**
   * Interactive rebase: takes a list of todo entries and applies them.
   * Each entry: { action: 'pick'|'squash'|'fixup'|'edit'|'reword'|'drop', hash: string }
   */
  async interactiveRebase(
    base: string,
    todos: Array<{ action: string; hash: string }>
  ): Promise<void> {
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

    // Write todo list to a temp file (avoids shell injection)
    const todoContent = todos.map(t => `${t.action} ${t.hash}`).join('\n') + '\n';
    const todoFile = join(this.repoPath, '.git', 'ghg-rebase-todo');

    try {
      await writeFile(todoFile, todoContent, 'utf-8');

      // Use cp command to copy the temp file as the sequence editor
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('git', ['rebase', '-i', base], {
          cwd: this.repoPath,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            LC_ALL: 'C',
            GIT_MERGE_AUTOEDIT: 'no',
            GIT_EDITOR: 'true',
            EDITOR: 'true',
            GIT_SEQUENCE_EDITOR: process.platform === 'win32'
              ? `copy "${todoFile.replace(/"/g, '""')}"`
              : `cp '${todoFile.replace(/'/g, "'\\''")}'`,
          },
        });

        let stderr = '';
        proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
        proc.on('close', (code) => {
          if (code === 0) { resolve(); }
          else { reject(new GitError(stderr, code, ['rebase', '-i', base])); }
        });
        proc.on('error', (err) => {
          reject(new GitError(err.message, null, ['rebase', '-i', base]));
        });
      });
    } finally {
      // Clean up temp file
      await unlink(todoFile).catch(() => {});
    }
  }

  /**
   * Get commits between base and HEAD for interactive rebase preview.
   */
  async getRebaseCommits(base: string): Promise<Commit[]> {
    const args = [
      'log',
      '--format=%x01%H%x00%h%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%P%x00%D%x00%b',
      '--topo-order',
      '--reverse',
      `${base}..HEAD`,
    ];
    const [raw, remoteNames] = await Promise.all([this.exec(args), this.getRemoteNames()]);
    return parseLog(raw, remoteNames);
  }

  // --- Reset & Discard ---

  async reset(ref: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    await this.exec(['reset', `--${mode}`, ref]);
  }

  async stageFile(filePath: string): Promise<void> {
    await this.exec(['add', filePath]);
  }

  async getConflictFiles(): Promise<string[]> {
    try {
      const raw = await this.exec(['diff', '--name-only', '--diff-filter=U']);
      return raw.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  async getOperationState(): Promise<{ type: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null }> {
    try {
      await this.exec(['rev-parse', '--verify', 'MERGE_HEAD']);
      return { type: 'merge' };
    } catch { /* not merging */ }
    try {
      await this.exec(['rev-parse', '--verify', 'REBASE_HEAD']);
      return { type: 'rebase' };
    } catch { /* not rebasing */ }
    try {
      await this.exec(['rev-parse', '--verify', 'CHERRY_PICK_HEAD']);
      return { type: 'cherry-pick' };
    } catch { /* not cherry-picking */ }
    try {
      await this.exec(['rev-parse', '--verify', 'REVERT_HEAD']);
      return { type: 'revert' };
    } catch { /* not reverting */ }
    return { type: null };
  }

  async continueOperation(): Promise<void> {
    // Stage all resolved conflict files before continuing
    await this.exec(['add', '-A']);
    const state = await this.getOperationState();
    switch (state.type) {
      case 'merge': await this.exec(['commit', '--no-edit']); break;
      case 'rebase': await this.exec(['rebase', '--continue']); break;
      case 'cherry-pick': await this.exec(['cherry-pick', '--continue']); break;
      case 'revert': await this.exec(['revert', '--continue']); break;
    }
  }

  async abortOperation(): Promise<void> {
    const state = await this.getOperationState();
    switch (state.type) {
      case 'merge': await this.abortMerge(); break;
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
    await this.exec(['stash', 'apply', `stash@{${index}}`]);
  }

  async stashPop(index: number): Promise<void> {
    await this.exec(['stash', 'pop', `stash@{${index}}`]);
  }

  async stashDrop(index: number): Promise<void> {
    await this.exec(['stash', 'drop', `stash@{${index}}`]);
  }

  async cherryPick(hash: string, options?: { noCommit?: boolean }): Promise<void> {
    const args = ['cherry-pick'];
    if (options?.noCommit) {
      args.push('--no-commit');
    }
    args.push(hash);
    await this.exec(args);
  }

  async revert(hash: string, options?: { noCommit?: boolean }): Promise<void> {
    const args = ['revert'];
    if (options?.noCommit) {
      args.push('--no-commit');
    }
    args.push(hash);
    await this.exec(args);
  }

  async createTag(name: string, ref?: string, message?: string): Promise<void> {
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
    await this.exec(['tag', '-d', name]);
  }

  // --- Phase 6: Search, Commit Template ---

  async searchCommits(query: string, options?: { author?: string; after?: string; before?: string; limit?: number }): Promise<Commit[]> {
    const args = [
      'log',
      '--format=%x01%H%x00%h%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%P%x00%D%x00%b',
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
    const args = [
      'log',
      '--format=%x01%H%x00%h%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%P%x00%D%x00%b',
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
      const args = [
        'log',
        '--format=%x01%H%x00%h%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%P%x00%D%x00%b',
        '-1',
        hash,
      ];
      const [raw, remoteNames] = await Promise.all([this.exec(args), this.getRemoteNames()]);
      const commits = parseLog(raw, remoteNames);
      return commits[0] ?? null;
    } catch {
      return null;
    }
  }

  // --- Bisect ---

  async bisectStart(bad?: string, good?: string): Promise<string> {
    const args = ['bisect', 'start'];
    if (bad) { args.push(bad); }
    if (good) { args.push(good); }
    return this.exec(args);
  }

  async bisectGood(ref?: string): Promise<string> {
    const args = ['bisect', 'good'];
    if (ref) { args.push(ref); }
    return this.exec(args);
  }

  async bisectBad(ref?: string): Promise<string> {
    const args = ['bisect', 'bad'];
    if (ref) { args.push(ref); }
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

  async lfsLsFiles(): Promise<Array<{ oid: string; path: string }>> {
    try {
      const raw = await this.exec(['lfs', 'ls-files']);
      return parseLfsFiles(raw);
    } catch { return []; }
  }

  async lfsLock(file: string): Promise<string> {
    return this.exec(['lfs', 'lock', file]);
  }

  async lfsUnlock(file: string, force?: boolean): Promise<string> {
    const args = ['lfs', 'unlock', file];
    if (force) { args.push('--force'); }
    return this.exec(args);
  }

  async lfsLocks(): Promise<Array<{ path: string; owner: string; id: string }>> {
    try {
      const raw = await this.exec(['lfs', 'locks']);
      return parseLfsLocks(raw);
    } catch { return []; }
  }

  // --- File tree at commit ---

  async lsTree(ref: string, path?: string): Promise<Array<{ mode: string; type: 'blob' | 'tree'; hash: string; name: string }>> {
    const args = ['ls-tree', ref];
    if (path) { args.push(path); }
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
      const d = new Date(line.trim());
      const key = `${d.getDay()}-${d.getHours()}`;
      grid.set(key, (grid.get(key) ?? 0) + 1);
    }
    return Array.from(grid.entries()).map(([key, count]) => {
      const [weekday, hour] = key.split('-').map(Number);
      return { weekday, hour, count };
    });
  }

  // --- Patch ---

  async formatPatch(hash: string): Promise<string> {
    return this.exec(['format-patch', '-1', hash, '--stdout']);
  }

  async diffCommitToWorking(hash: string): Promise<DiffData[]> {
    const raw = await this.exec(['diff', hash]);
    return parseDiff(raw);
  }

  // --- Git Flow ---

  async flowInit(options: {
    productionBranch: string;
    developBranch: string;
    featurePrefix: string;
    releasePrefix: string;
    hotfixPrefix: string;
    versionTagPrefix: string;
  }): Promise<string> {
    // production 브랜치 존재 여부 검증
    try {
      await this.exec(['rev-parse', '--verify', options.productionBranch]);
    } catch {
      throw new GitError(
        `Branch '${options.productionBranch}' does not exist. Create the production branch first or ensure at least one commit exists.`,
        1,
        ['flow', 'init']
      );
    }

    // git flow init -d로 기본 초기화 후 커스텀 설정 덮어쓰기
    await this.exec(['flow', 'init', '-d']);
    await this.exec(['config', 'gitflow.branch.master', options.productionBranch]);
    await this.exec(['config', 'gitflow.branch.develop', options.developBranch]);
    await this.exec(['config', 'gitflow.prefix.feature', options.featurePrefix]);
    await this.exec(['config', 'gitflow.prefix.release', options.releasePrefix]);
    await this.exec(['config', 'gitflow.prefix.hotfix', options.hotfixPrefix]);
    await this.exec(['config', 'gitflow.prefix.versiontag', options.versionTagPrefix]);

    // develop 브랜치가 없으면 생성
    try {
      await this.exec(['rev-parse', '--verify', options.developBranch]);
    } catch {
      await this.exec(['branch', options.developBranch, options.productionBranch]);
    }

    return 'Git Flow initialized';
  }

  async flowFeatureStart(name: string): Promise<string> {
    return this.exec(['flow', 'feature', 'start', name]);
  }

  async flowFeatureFinish(name: string): Promise<string> {
    return this.exec(['flow', 'feature', 'finish', name]);
  }

  async flowReleaseStart(version: string): Promise<string> {
    return this.exec(['flow', 'release', 'start', version]);
  }

  async flowReleaseFinish(version: string): Promise<string> {
    return this.exec(['flow', 'release', 'finish', '-m', version, version]);
  }

  async flowHotfixStart(version: string): Promise<string> {
    return this.exec(['flow', 'hotfix', 'start', version]);
  }

  async flowHotfixFinish(version: string): Promise<string> {
    return this.exec(['flow', 'hotfix', 'finish', '-m', version, version]);
  }

  async getFlowConfig(): Promise<{
    productionBranch: string;
    developBranch: string;
    featurePrefix: string;
    releasePrefix: string;
    hotfixPrefix: string;
    versionTagPrefix: string;
  } | null> {
    try {
      const [production, develop, feature, release, hotfix, versionTag] = await Promise.all([
        this.exec(['config', '--get', 'gitflow.branch.master']).then(s => s.trim()),
        this.exec(['config', '--get', 'gitflow.branch.develop']).then(s => s.trim()),
        this.exec(['config', '--get', 'gitflow.prefix.feature']).then(s => s.trim()),
        this.exec(['config', '--get', 'gitflow.prefix.release']).then(s => s.trim()),
        this.exec(['config', '--get', 'gitflow.prefix.hotfix']).then(s => s.trim()),
        this.exec(['config', '--get', 'gitflow.prefix.versiontag']).then(s => s.trim()).catch(() => ''),
      ]);
      return {
        productionBranch: production,
        developBranch: develop,
        featurePrefix: feature,
        releasePrefix: release,
        hotfixPrefix: hotfix,
        versionTagPrefix: versionTag,
      };
    } catch { return null; }
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
    const raw = await this.exec(['worktree', 'list', '--porcelain']);
    return parseWorktreeList(raw);
  }

  async worktreeAdd(worktreePath: string, branch?: string, newBranch?: string): Promise<void> {
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
    const r = remote || 'origin';
    return this.exec(['push', r, `refs/tags/${name}`]);
  }

  async pushAllTags(remote?: string): Promise<string> {
    const r = remote || 'origin';
    return this.exec(['push', r, '--tags']);
  }

  async deleteRemoteBranch(name: string, remote?: string): Promise<string> {
    const r = remote || 'origin';
    return this.exec(['push', r, '--delete', name]);
  }

  async deleteRemoteTag(name: string, remote?: string): Promise<string> {
    const r = remote || 'origin';
    return this.exec(['push', r, `:refs/tags/${name}`]);
  }

  // --- Image at ref (binary-safe) ---

  async getImageBase64(ref: string, filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', ['show', `${ref}:${filePath}`], {
        cwd: this.repoPath,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GIT_MERGE_AUTOEDIT: 'no', GIT_EDITOR: 'true', EDITOR: 'true' },
      });

      const chunks: Buffer[] = [];
      proc.stdout.on('data', (data: Buffer) => { chunks.push(data); });

      let stderr = '';
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          const buffer = Buffer.concat(chunks);
          resolve(buffer.toString('base64'));
        } else {
          reject(new GitError(stderr, code, ['show', `${ref}:${filePath}`]));
        }
      });
      proc.on('error', (err) => {
        reject(new GitError(err.message, null, ['show', `${ref}:${filePath}`]));
      });
    });
  }

  async isFlowInstalled(): Promise<boolean> {
    try {
      await this.exec(['flow', 'version']);
      return true;
    } catch { return false; }
  }

  async isFlowInitialized(): Promise<boolean> {
    try {
      await this.exec(['config', '--get', 'gitflow.branch.master']);
      return true;
    } catch { return false; }
  }

}
