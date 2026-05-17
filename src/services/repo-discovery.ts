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

const MAX_DEPTH = 3;
const DEFAULT_EXEC_TIMEOUT_MS = 15_000;
const FORCE_KILL_DELAY_MS = 2_000;

export class RepoDiscoveryService {
  private static cache: { repos: RepoInfo[]; cacheKey: string } | null = null;

  /**
   * Discover all git repositories within the given workspace folders.
   * Finds the workspace root repo, its submodules, and independent nested repos.
   * Results are cached until clearCache() is called.
   */
  static async discoverRepos(folderPaths: string[]): Promise<RepoInfo[]> {
    const cacheKey = [...folderPaths].sort().join(';');
    if (this.cache && this.cache.cacheKey === cacheKey) {
      return this.cache.repos;
    }

    const repos: RepoInfo[] = [];
    const seen = new Set<string>();
    const normalize = (p: string) => path.resolve(p).toLowerCase();

    for (const folderPath of folderPaths) {
      try {
        const repoRoot = await this.execGit(['rev-parse', '--show-toplevel'], folderPath);
        const normRoot = normalize(repoRoot);
        if (repoRoot && !seen.has(normRoot)) {
          seen.add(normRoot);
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

    // Discover independent nested git repos in workspace folders
    // We do this before submodules to ensure we catch all independent repos first
    for (const folderPath of folderPaths) {
      await this.discoverNestedRepos(folderPath, seen, repos, 0, normalize);
    }

    // Discover submodules recursively from each repo found (both root and nested)
    const reposToScan = [...repos];
    for (const repo of reposToScan) {
      try {
        const subs = await this.getSubmodules(repo.path);
        for (const sub of subs) {
          const normSub = normalize(sub.path);
          if (!seen.has(normSub)) {
            seen.add(normSub);
            repos.push(sub);
          }
        }
      } catch {
        // No submodules or error, skip
      }
    }


    const typeOrder: Record<RepoType, number> = { root: 0, nested: 1, submodule: 2 };
    repos.sort((a, b) => typeOrder[a.type] - typeOrder[b.type] || a.name.localeCompare(b.name));

    // De-duplicate names by prepending path segments until unique
    const nameToRepos = new Map<string, RepoInfo[]>();
    for (const repo of repos) {
      const list = nameToRepos.get(repo.name) || [];
      list.push(repo);
      nameToRepos.set(repo.name, list);
    }

    for (const [name, duplicates] of nameToRepos.entries()) {
      if (duplicates.length > 1) {
        // For each duplicate, try to make it unique by adding parent directories
        for (const repo of duplicates) {
          let currentPath = repo.path;
          let newName = repo.name;
          let partsAdded = 0;
          
          // Keep adding parent dirs until this specific repo name is unique among all repos
          while (partsAdded < 3) {
            const parent = path.dirname(currentPath);
            if (parent === currentPath) break; // Reached root
            const parentName = path.basename(parent);
            if (!parentName) break;

            newName = `${parentName}/${newName}`;
            currentPath = parent;
            partsAdded++;

            // Check if this newName is now unique
            const isUnique = !repos.some(r => r !== repo && r.name === newName);
            if (isUnique) {
              repo.name = newName;
              break;
            }
          }
        }
      }
    }

    this.cache = { repos, cacheKey };
    return repos;
  }

  static clearCache(): void {
    this.cache = null;
  }

  private static async discoverNestedRepos(
    dir: string, seen: Set<string>, repos: RepoInfo[], depth: number, normalize: (p: string) => string
  ): Promise<void> {
    if (depth >= MAX_DEPTH) { return; }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const dirs = entries.filter(e => e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith('.'));

    // Check all children in parallel - detect repos by .git presence, then verify with git rev-parse
    const results = await Promise.all(dirs.map(async (entry) => {
      const childPath = path.join(dir, entry.name);
      const hasGit = await this.hasGitDir(childPath);
      if (hasGit) {
        try {
          // Verify it's a real git repo and get its canonical root path
          const realRoot = await this.execGit(['rev-parse', '--show-toplevel'], childPath);
          return { childPath: realRoot, hasGit: true };
        } catch {
          // False positive .git folder
          return { childPath, hasGit: false };
        }
      }
      return { childPath, hasGit: false };
    }));

    const toRecurse: string[] = [];
    for (const { childPath, hasGit } of results) {
      const normPath = normalize(childPath);
      if (hasGit && !seen.has(normPath)) {
        seen.add(normPath);
        repos.push({ path: childPath, name: path.basename(childPath), type: 'nested' });
        // Don't recurse into discovered repos
      } else if (!hasGit) {
        toRecurse.push(childPath);
      }
    }

    // Recurse into non-repo directories in parallel
    await Promise.all(toRecurse.map(p => this.discoverNestedRepos(p, seen, repos, depth + 1, normalize)));
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
   * Uses `git submodule status --recursive` to find all submodules.
   * Works for both initialized and uninitialized submodules, cross-platform.
   */
  private static async getSubmodules(repoPath: string): Promise<RepoInfo[]> {
    try {
      const raw = await this.execGit(['submodule', 'status', '--recursive'], repoPath);
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
    } catch {
      return [];
    }
  }

  private static execGit(args: string[], cwd: string, timeoutMs = DEFAULT_EXEC_TIMEOUT_MS): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* already dead */ } }, FORCE_KILL_DELAY_MS);
        reject(new Error(`git ${args[0]} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      let stdout = '';
      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`git ${args[0]} failed`));
        }
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}
