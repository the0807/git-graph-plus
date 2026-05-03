import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type RepoType = 'root' | 'submodule' | 'nested';

export interface RepoInfo {
  path: string;
  name: string;
  type: RepoType;
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'vendor', 'dist', 'build',
  '.next', '.nuxt', '__pycache__', '.venv', 'venv', '.tox',
]);

const MAX_DEPTH = 1;

export class RepoDiscoveryService {
  private static cache: { repos: RepoInfo[]; rootPath: string } | null = null;

  /**
   * Discover all git repositories within the given workspace folders.
   * Finds the workspace root repo, its submodules, and independent nested repos.
   * Results are cached until clearCache() is called.
   */
  static async discoverRepos(folderPaths: string[]): Promise<RepoInfo[]> {
    const rootPath = folderPaths[0] ?? '';
    if (this.cache && this.cache.rootPath === rootPath) {
      return this.cache.repos;
    }

    const repos: RepoInfo[] = [];
    const seen = new Set<string>();

    for (const folderPath of folderPaths) {
      try {
        const repoRoot = await this.execGit(['rev-parse', '--show-toplevel'], folderPath);
        if (repoRoot && !seen.has(repoRoot)) {
          seen.add(repoRoot);
          repos.push({
            path: repoRoot,
            name: path.basename(repoRoot),
            type: 'root',
          });
        }
      } catch {
        // Not a git repo - still scan children for nested repos
      }
    }

    // Discover submodules from each repo found
    for (const repo of [...repos]) {
      try {
        const subs = await this.getSubmodules(repo.path);
        for (const sub of subs) {
          if (!seen.has(sub.path)) {
            seen.add(sub.path);
            repos.push(sub);
          }
        }
      } catch {
        // No submodules or error, skip
      }
    }

    // Discover independent nested git repos in workspace folders
    for (const folderPath of folderPaths) {
      await this.discoverNestedRepos(folderPath, seen, repos, 0);
    }

    const typeOrder: Record<RepoType, number> = { root: 0, nested: 1, submodule: 2 };
    repos.sort((a, b) => typeOrder[a.type] - typeOrder[b.type] || a.name.localeCompare(b.name));

    this.cache = { repos, rootPath };
    return repos;
  }

  static clearCache(): void {
    this.cache = null;
  }

  private static async discoverNestedRepos(
    dir: string, seen: Set<string>, repos: RepoInfo[], depth: number
  ): Promise<void> {
    if (depth >= MAX_DEPTH) { return; }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const dirs = entries.filter(e => e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith('.'));

    // Check all children in parallel - detect repos by .git presence, not rev-parse
    const results = await Promise.all(dirs.map(async (entry) => {
      const childPath = path.join(dir, entry.name);
      const hasGit = await this.hasGitDir(childPath);
      return { childPath, hasGit };
    }));

    const toRecurse: string[] = [];
    for (const { childPath, hasGit } of results) {
      if (hasGit && !seen.has(childPath)) {
        seen.add(childPath);
        repos.push({ path: childPath, name: path.basename(childPath), type: 'nested' });
        // Don't recurse into discovered repos
      } else if (!hasGit) {
        toRecurse.push(childPath);
      }
    }

    // Recurse into non-repo directories in parallel
    await Promise.all(toRecurse.map(p => this.discoverNestedRepos(p, seen, repos, depth + 1)));
  }

  private static async hasGitDir(dir: string): Promise<boolean> {
    try {
      await fs.promises.access(path.join(dir, '.git'));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Uses `git submodule status` to find submodules.
   * Works for both initialized and uninitialized submodules, cross-platform.
   */
  private static async getSubmodules(repoPath: string): Promise<RepoInfo[]> {
    const raw = await this.execGit(['submodule', 'status'], repoPath);
    if (!raw.trim()) { return []; }

    // Format: " <hash> <path> (<ref>)" or "-<hash> <path>" (uninitialized) or "+<hash> <path> (<ref>)" (modified)
    const results: RepoInfo[] = [];
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      const match = line.match(/^[\s+-]?[0-9a-f]+\s+(\S+)/);
      if (!match) { continue; }
      const smPath = match[1];
      results.push({
        path: path.resolve(repoPath, smPath),
        name: path.basename(smPath),
        type: 'submodule',
      });
    }
    return results;
  }

  private static execGit(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      });

      let stdout = '';
      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`git ${args[0]} failed`));
        }
      });
      proc.on('error', reject);
    });
  }
}
