import * as vscode from 'vscode';
import { spawn } from 'child_process';

export class GitContentProvider implements vscode.TextDocumentContentProvider {
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  onDidChange = this.onDidChangeEmitter.event;

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    let parsed: { ref: string; path: string; repoPath: string };
    try {
      parsed = JSON.parse(uri.query);
    } catch {
      return `// Error: Invalid URI query`;
    }

    const { ref, path: filePath, repoPath } = parsed;

    // Validate ref to prevent injection
    if (!ref || !filePath || !repoPath) {
      return `// Error: Missing ref, path, or repoPath`;
    }

    return new Promise((resolve) => {
      const proc = spawn('git', ['show', `${ref}:${filePath}`], {
        cwd: repoPath,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          // File might not exist in this ref (new/deleted file)
          // Return a comment so the user sees something meaningful
          if (stderr.includes('does not exist') || stderr.includes('bad revision') || stderr.includes('fatal:')) {
            resolve(`// File does not exist at ${ref}`);
          } else {
            resolve('');
          }
        }
      });

      proc.on('error', (err) => {
        resolve(`// Error: ${err.message}`);
      });
    });
  }
}
