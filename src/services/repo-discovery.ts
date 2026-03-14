import { spawn } from 'child_process';
import * as path from 'path';

export interface RepoInfo {
  path: string;
  name: string;
}

export class RepoDiscoveryService {
  private static cache: { repos: RepoInfo[]; rootPath: string } | null = null;

  /**
   * Discover all git repositories within the given workspace folders.
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
          });
        }
      } catch {
        // Not a git repo, skip
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

    this.cache = { repos, rootPath };
    return repos;
  }

  static clearCache(): void {
    this.cache = null;
  }

  /**
   * Uses `git submodule status` to find submodules.
   * Works for both initialized and uninitialized submodules, cross-platform.
   */
  private static async getSubmodules(repoPath: string): Promise<RepoInfo[]> {
    const raw = await this.execGit(['submodule', 'status'], repoPath);
    if (!raw.trim()) { return []; }

    // Format: " <hash> <path> (<ref>)" or "-<hash> <path>" (uninitialized) or "+<hash> <path> (<ref>)" (modified)
    return raw.trim().split('\n').filter(Boolean).map(line => {
      // Strip leading status char (+, -, space) and hash, then extract path
      const match = line.match(/^[\s+-]?[0-9a-f]+\s+(\S+)/);
      if (!match) { return null; }
      const smPath = match[1];
      return {
        path: path.resolve(repoPath, smPath),
        name: path.basename(smPath),
      };
    }).filter((s): s is RepoInfo => s !== null);
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
