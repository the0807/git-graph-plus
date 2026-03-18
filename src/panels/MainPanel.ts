import * as vscode from 'vscode';
import * as path from 'path';
import { readFile } from 'fs/promises';
import { GitService } from '../git/git-service';
import { buildGraph, buildGraphFromGitOutput, buildFullGraph } from '../git/git-graph-builder';
import { parseBlame, parseReflog } from '../git/git-parser';
import { FileWatcher } from '../services/file-watcher';
import { RepoDiscoveryService } from '../services/repo-discovery';
import type { WebviewMessage } from '../utils/message-bus';

export class MainPanel {
  public static currentPanel: MainPanel | undefined;
  private static readonly viewType = 'gitGraphPlus';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private repoPath: string;
  private gitService: GitService;
  private fileWatcher: FileWatcher;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    repoPath: string
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.repoPath = repoPath;
    this.gitService = new GitService(repoPath);

    this.fileWatcher = new FileWatcher(repoPath, (what) => {
      this.onRepoChanged(what);
    });
    this.disposables.push(this.fileWatcher);

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    // Send locale to webview
    const localeSetting = vscode.workspace.getConfiguration('gitGraphPlus').get<string>('locale', 'auto');
    const locale = localeSetting === 'auto' ? (vscode.env.language || 'en') : localeSetting;
    this.panel.webview.postMessage({ type: 'setLocale', payload: { locale } });

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Discover repos (including submodules) once on init
    this.sendRepoList();
  }

  public static createOrShow(extensionUri: vscode.Uri): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage('Git Graph+: No workspace folder open.');
      return;
    }

    const repoPath = workspaceFolder.uri.fsPath;

    if (MainPanel.currentPanel) {
      MainPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      MainPanel.viewType,
      'Git Graph+',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist'),
          vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'codicons', 'dist'),
        ],
      }
    );

    // Set tab icon (light bg → dark icon, dark bg → light icon)
    panel.iconPath = {
      light: vscode.Uri.joinPath(extensionUri, 'resources', 'icon-light.svg'),
      dark: vscode.Uri.joinPath(extensionUri, 'resources', 'icon-dark.svg'),
    };

    MainPanel.currentPanel = new MainPanel(panel, extensionUri, repoPath);
  }

  public async postRefresh(): Promise<void> {
    await this.refreshAll();
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'getLog': {
          const [commits, logBranches] = await Promise.all([
            this.gitService.log(message.payload),
            this.gitService.branches(),
          ]);
          const graph = buildGraph(commits, logBranches);
          const fullGraph = buildFullGraph(commits, logBranches);
          this.panel.webview.postMessage({
            type: 'logData',
            payload: {
              commits,
              graph,
              paths: fullGraph.paths,
              links: fullGraph.links,
              dots: fullGraph.dots,
              commitLeftMargin: fullGraph.commitLeftMargin,
            },
          });
          break;
        }
        case 'getBranches': {
          const [branches, tags, remotes, stashes] = await Promise.all([
            this.gitService.branches(),
            this.gitService.tags(),
            this.gitService.remotes(),
            this.gitService.stashList(),
          ]);
          this.panel.webview.postMessage({
            type: 'branchData',
            payload: { branches, tags, remotes, stashes },
          });
          break;
        }
        case 'getCommitDiff': {
          const commitDiffs = await this.gitService.showCommitDiff(message.payload.hash);
          const commitFiles = await this.gitService.showCommitFiles(message.payload.hash);
          this.panel.webview.postMessage({
            type: 'commitDiffData',
            payload: { diffs: commitDiffs, files: commitFiles },
          });
          break;
        }
        case 'checkout': {
          await this.gitService.checkout(message.payload.ref);
          if (message.payload.pullAfter) {
            await this.gitService.pull();
          }
          this.panel.webview.postMessage({
            type: 'operationComplete',
            payload: { operation: 'checkout', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'createBranch': {
          if (message.payload.checkout) {
            await this.gitService.createAndCheckoutBranch(message.payload.name, message.payload.startPoint);
          } else {
            await this.gitService.createBranch(message.payload.name, message.payload.startPoint);
          }
          this.panel.webview.postMessage({
            type: 'operationComplete',
            payload: { operation: 'createBranch', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'deleteBranch': {
          await this.gitService.deleteBranch(message.payload.name, message.payload.force);
          this.panel.webview.postMessage({
            type: 'operationComplete',
            payload: { operation: 'deleteBranch', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'renameBranch': {
          await this.gitService.renameBranch(message.payload.oldName, message.payload.newName);
          this.panel.webview.postMessage({
            type: 'operationComplete',
            payload: { operation: 'renameBranch', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'merge': {
          await this.gitService.merge(message.payload.branch, { noFf: message.payload.noFf, squash: message.payload.squash });
          this.panel.webview.postMessage({
            type: 'operationComplete',
            payload: { operation: 'merge', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'abortMerge': {
          await this.gitService.abortMerge();
          this.panel.webview.postMessage({
            type: 'operationComplete',
            payload: { operation: 'abortMerge', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'openDiff': {
          await this.openDiffInEditor(
            message.payload.file,
            false,
            message.payload.commitHash,
          );
          break;
        }
        case 'fetch': {
          await this.gitService.fetch(message.payload.remote, { prune: message.payload.prune });
          this.panel.webview.postMessage({
            type: 'operationComplete',
            payload: { operation: 'fetch', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'pull': {
          if (message.payload.stash) {
            await this.gitService.stashSave('Auto-stash before pull');
          }
          try {
            await this.gitService.pull(message.payload.remote, message.payload.branch, { rebase: message.payload.rebase });
          } finally {
            if (message.payload.stash) {
              try { await this.gitService.stashPop(0); } catch { /* stash pop may fail if no conflicts */ }
            }
          }
          this.panel.webview.postMessage({
            type: 'operationComplete',
            payload: { operation: 'pull', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'push': {
          await this.gitService.push(message.payload.remote, message.payload.branch, { force: message.payload.force, setUpstream: message.payload.setUpstream });
          this.panel.webview.postMessage({
            type: 'operationComplete',
            payload: { operation: 'push', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'addRemote': {
          await this.gitService.addRemote(message.payload.name, message.payload.url);
          this.panel.webview.postMessage({
            type: 'operationComplete',
            payload: { operation: 'addRemote', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'removeRemote': {
          await this.gitService.removeRemote(message.payload.name);
          this.panel.webview.postMessage({
            type: 'operationComplete',
            payload: { operation: 'removeRemote', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'rebase': {
          await this.gitService.rebase(message.payload.onto, { autostash: message.payload.autostash });
          this.panel.webview.postMessage({
            type: 'operationComplete',
            payload: { operation: 'rebase', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'abortRebase': {
          await this.gitService.abortRebase();
          this.panel.webview.postMessage({
            type: 'operationComplete',
            payload: { operation: 'abortRebase', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'continueRebase': {
          await this.gitService.continueRebase();
          this.panel.webview.postMessage({
            type: 'operationComplete',
            payload: { operation: 'continueRebase', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'skipRebase': {
          await this.gitService.skipRebase();
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'skipRebase', success: true } });
          await this.refreshAll();
          break;
        }
        case 'interactiveRebase': {
          await this.gitService.interactiveRebase(message.payload.base, message.payload.todos);
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'interactiveRebase', success: true } });
          await this.refreshAll();
          break;
        }
        case 'getRebaseCommits': {
          const rebaseCommits = await this.gitService.getRebaseCommits(message.payload.base);
          this.panel.webview.postMessage({ type: 'rebaseCommitsData', payload: { base: message.payload.base, commits: rebaseCommits } });
          break;
        }
        case 'reset': {
          await this.gitService.reset(message.payload.ref, message.payload.mode);
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'reset', success: true } });
          await this.refreshAll();
          break;
        }
        case 'stashSave': {
          await this.gitService.stashSave(message.payload.message, message.payload.includeUntracked, message.payload.keepIndex);
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'stashSave', success: true } });
          await this.refreshAll();
          break;
        }
        case 'stashApply': {
          if (message.payload.drop) {
            await this.gitService.stashPop(message.payload.index);
          } else {
            await this.gitService.stashApply(message.payload.index);
          }
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'stashApply', success: true } });
          await this.refreshAll();
          break;
        }
        case 'stashDrop': {
          await this.gitService.stashDrop(message.payload.index);
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'stashDrop', success: true } });
          await this.refreshAll();
          break;
        }
        case 'cherryPick': {
          await this.gitService.cherryPick(message.payload.commit, { noCommit: message.payload.noCommit });
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'cherryPick', success: true } });
          await this.refreshAll();
          break;
        }
        case 'revert': {
          await this.gitService.revert(message.payload.commit, { noCommit: message.payload.noCommit });
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'revert', success: true } });
          await this.refreshAll();
          break;
        }
        case 'getBlame': {
          const blameRaw = await this.gitService.blame(message.payload.file);
          const blameData = parseBlame(blameRaw, message.payload.file);
          this.panel.webview.postMessage({ type: 'blameData', payload: blameData });
          break;
        }
        case 'getReflog': {
          const reflogRaw = await this.gitService.reflog();
          const reflogData = parseReflog(reflogRaw);
          this.panel.webview.postMessage({ type: 'reflogData', payload: reflogData });
          break;
        }
        case 'getFileHistory': {
          const fileCommits = await this.gitService.fileHistory(message.payload.file);
          const fileGraph = buildGraph(fileCommits);
          this.panel.webview.postMessage({ type: 'fileHistoryData', payload: { commits: fileCommits, graph: fileGraph } });
          break;
        }
        case 'createTag': {
          await this.gitService.createTag(message.payload.name, message.payload.ref, message.payload.message);
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'createTag', success: true } });
          await this.refreshAll();
          break;
        }
        case 'deleteTag': {
          await this.gitService.deleteTag(message.payload.name);
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'deleteTag', success: true } });
          await this.refreshAll();
          break;
        }
        case 'searchCommits': {
          const results = await this.gitService.searchCommits(message.payload.query, {
            author: message.payload.author,
            after: message.payload.after,
            before: message.payload.before,
          });
          const searchGraph = buildGraph(results);
          this.panel.webview.postMessage({ type: 'searchResults', payload: { commits: results, graph: searchGraph } });
          break;
        }
        case 'searchByHash': {
          const found = await this.gitService.searchByHash(message.payload.hash);
          if (found) {
            const foundGraph = buildGraph([found]);
            this.panel.webview.postMessage({ type: 'searchResults', payload: { commits: [found], graph: foundGraph } });
          } else {
            this.panel.webview.postMessage({ type: 'searchResults', payload: { commits: [], graph: [] } });
          }
          break;
        }
        case 'getActivityLog': {
          this.panel.webview.postMessage({ type: 'activityLogData', payload: this.gitService.getActivityLog() });
          break;
        }
        // --- Bisect ---
        case 'bisectStart': {
          const result = await this.gitService.bisectStart(message.payload.bad, message.payload.good);
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'bisectStart', success: true } });
          this.panel.webview.postMessage({ type: 'bisectResult', payload: { message: result } });
          await this.refreshAll();
          break;
        }
        case 'bisectGood': {
          const result = await this.gitService.bisectGood(message.payload.ref);
          this.panel.webview.postMessage({ type: 'bisectResult', payload: { message: result } });
          await this.refreshAll();
          break;
        }
        case 'bisectBad': {
          const result = await this.gitService.bisectBad(message.payload.ref);
          this.panel.webview.postMessage({ type: 'bisectResult', payload: { message: result } });
          await this.refreshAll();
          break;
        }
        case 'bisectReset': {
          await this.gitService.bisectReset();
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'bisectReset', success: true } });
          await this.refreshAll();
          break;
        }
        // --- Statistics ---
        case 'getStats': {
          const [byAuthor, byWeekdayHour] = await Promise.all([
            this.gitService.statsCommitsByAuthor(),
            this.gitService.statsCommitsByWeekdayHour(),
          ]);
          this.panel.webview.postMessage({
            type: 'statsData',
            payload: { byAuthor, byWeekdayHour },
          });
          break;
        }
        case 'copyToClipboard': {
          await vscode.env.clipboard.writeText(message.payload.text);
          break;
        }
        case 'saveCommitPatch': {
          const patch = await this.gitService.formatPatch(message.payload.hash);
          const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`${message.payload.hash.substring(0, 7)}.patch`),
            filters: { 'Patch files': ['patch'] },
          });
          if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(patch));
          }
          break;
        }
        case 'compareToWorking': {
          const diffs = await this.gitService.diffCommitToWorking(message.payload.hash);
          this.panel.webview.postMessage({ type: 'diffData', payload: diffs });
          break;
        }
        // --- File tree at commit ---
        case 'lsTree': {
          const entries = await this.gitService.lsTree(message.payload.ref, message.payload.path);
          this.panel.webview.postMessage({ type: 'lsTreeData', payload: { ref: message.payload.ref, path: message.payload.path, entries } });
          break;
        }
        // --- Git Flow ---
        case 'flowInit': {
          await this.gitService.flowInit();
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'flowInit', success: true } });
          await this.refreshAll();
          break;
        }
        case 'flowAction': {
          const { flowType, action, name } = message.payload;
          if (action === 'start') {
            if (flowType === 'feature') await this.gitService.flowFeatureStart(name);
            else if (flowType === 'release') await this.gitService.flowReleaseStart(name);
            else if (flowType === 'hotfix') await this.gitService.flowHotfixStart(name);
          } else {
            if (flowType === 'feature') await this.gitService.flowFeatureFinish(name);
            else if (flowType === 'release') await this.gitService.flowReleaseFinish(name);
            else if (flowType === 'hotfix') await this.gitService.flowHotfixFinish(name);
          }
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: `flow-${action}`, success: true } });
          await this.refreshAll();
          break;
        }
        // --- PR Creation ---
        case 'createPR': {
          const prUrl = await this.gitService.createPullRequest(message.payload.title, message.payload.body, message.payload.base);
          this.panel.webview.postMessage({ type: 'prCreated', payload: { url: prUrl } });
          break;
        }
        // --- Submodule ---
        case 'getSubmodules': {
          const submodules = await this.gitService.submoduleStatus();
          this.panel.webview.postMessage({ type: 'submoduleData', payload: submodules });
          break;
        }
        case 'submoduleUpdate': {
          await this.gitService.submoduleUpdate(true);
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'submoduleUpdate', success: true } });
          break;
        }
        // --- LFS ---
        case 'getLfsFiles': {
          const lfsFiles = await this.gitService.lfsLsFiles();
          const lfsLocks = await this.gitService.lfsLocks();
          this.panel.webview.postMessage({ type: 'lfsData', payload: { files: lfsFiles, locks: lfsLocks } });
          break;
        }
        // --- Worktree ---
        case 'getWorktrees': {
          const worktrees = await this.gitService.worktreeList();
          this.panel.webview.postMessage({ type: 'worktreeData', payload: worktrees });
          break;
        }
        case 'addWorktree': {
          await this.gitService.worktreeAdd(message.payload.path, message.payload.branch, message.payload.newBranch);
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'addWorktree', success: true } });
          const wtAfterAdd = await this.gitService.worktreeList();
          this.panel.webview.postMessage({ type: 'worktreeData', payload: wtAfterAdd });
          break;
        }
        case 'removeWorktree': {
          await this.gitService.worktreeRemove(message.payload.path, message.payload.force);
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'removeWorktree', success: true } });
          const wtAfterRemove = await this.gitService.worktreeList();
          this.panel.webview.postMessage({ type: 'worktreeData', payload: wtAfterRemove });
          break;
        }
        case 'pruneWorktrees': {
          await this.gitService.worktreePrune();
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'pruneWorktrees', success: true } });
          const wtAfterPrune = await this.gitService.worktreeList();
          this.panel.webview.postMessage({ type: 'worktreeData', payload: wtAfterPrune });
          break;
        }
        // --- Tag Push ---
        case 'pushTag': {
          await this.gitService.pushTag(message.payload.name, message.payload.remote);
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'pushTag', success: true } });
          break;
        }
        case 'pushAllTags': {
          await this.gitService.pushAllTags(message.payload.remote);
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'pushAllTags', success: true } });
          break;
        }
        case 'deleteRemoteTag': {
          await this.gitService.deleteRemoteTag(message.payload.name, message.payload.remote);
          this.panel.webview.postMessage({ type: 'operationComplete', payload: { operation: 'deleteRemoteTag', success: true } });
          await this.refreshAll();
          break;
        }
        // --- Image Diff ---
        case 'getImageAtRef': {
          const { ref, path: filePath } = message.payload;
          const mimeMap: Record<string, string> = {
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
            '.webp': 'image/webp', '.ico': 'image/x-icon',
          };
          const ext = '.' + filePath.split('.').pop()?.toLowerCase();
          const mimeType = mimeMap[ext] || 'image/png';

          try {
            let base64: string;
            if (ref === 'working') {
              // Read from working tree
              const fullPath = path.join(this.repoPath, filePath);
              const relative = path.relative(this.repoPath, fullPath);
              if (relative.startsWith('..') || path.isAbsolute(relative)) {
                throw new Error('Invalid file path');
              }
              const buffer = await readFile(fullPath);
              base64 = buffer.toString('base64');
            } else {
              base64 = await this.gitService.getImageBase64(ref, filePath);
            }
            this.panel.webview.postMessage({
              type: 'imageData',
              payload: { ref, path: filePath, base64, mimeType },
            });
          } catch {
            this.panel.webview.postMessage({
              type: 'imageData',
              payload: { ref, path: filePath, base64: '', mimeType },
            });
          }
          break;
        }
        // --- Repo Switch ---
        case 'switchRepo': {
          const newPath = message.payload.path;
          this.repoPath = newPath;
          this.gitService = new GitService(newPath);
          this.fileWatcher.dispose();
          this.fileWatcher = new FileWatcher(newPath, (what) => {
            this.onRepoChanged(what);
          });
          this.disposables.push(this.fileWatcher);
          await this.refreshAll();
          // Re-send cached repo list with updated active path
          await this.sendRepoList();
          break;
        }
        default:
          break;
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.panel.webview.postMessage({
        type: 'error',
        payload: { message: errorMessage },
      });
    }
  }

  private async openDiffInEditor(
    file: string,
    staged?: boolean,
    commitHash?: string,
  ): Promise<void> {
    const fileUri = vscode.Uri.file(path.join(this.repoPath, file));

    if (commitHash) {
      // Commit diff: parent vs commit
      const parentRef = commitHash + '~1';
      const leftUri = vscode.Uri.parse(`git-graph-plus://show/${parentRef}/${file}`).with({
        query: JSON.stringify({ ref: parentRef, path: file, repoPath: this.repoPath }),
      });
      const rightUri = vscode.Uri.parse(`git-graph-plus://show/${commitHash}/${file}`).with({
        query: JSON.stringify({ ref: commitHash, path: file, repoPath: this.repoPath }),
      });
      const title = `${file} (${commitHash.substring(0, 7)})`;
      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    } else if (staged) {
      // Staged diff: HEAD vs index
      const headUri = vscode.Uri.parse(`git-graph-plus://show/HEAD/${file}`).with({
        query: JSON.stringify({ ref: 'HEAD', path: file, repoPath: this.repoPath }),
      });
      const indexUri = vscode.Uri.parse(`git-graph-plus://show/:0/${file}`).with({
        query: JSON.stringify({ ref: ':0', path: file, repoPath: this.repoPath }),
      });
      await vscode.commands.executeCommand('vscode.diff', headUri, indexUri, `${file} (Staged)`);
    } else {
      // Unstaged diff: index vs working tree
      const indexUri = vscode.Uri.parse(`git-graph-plus://show/:0/${file}`).with({
        query: JSON.stringify({ ref: ':0', path: file, repoPath: this.repoPath }),
      });
      await vscode.commands.executeCommand('vscode.diff', indexUri, fileUri, `${file} (Working Tree)`);
    }
  }

  private async refreshAll(): Promise<void> {
    try {
      const [allCommits, branches, tags, remotes, stashes] = await Promise.all([
        this.gitService.log({ limit: 1000 }),
        this.gitService.branches(),
        this.gitService.tags(),
        this.gitService.remotes(),
        this.gitService.stashList(),
      ]);
      const graph = buildGraph(allCommits, branches);
      const fg = buildFullGraph(allCommits, branches);
      this.panel.webview.postMessage({ type: 'logData', payload: { commits: allCommits, graph, paths: fg.paths, links: fg.links, dots: fg.dots, commitLeftMargin: fg.commitLeftMargin } });
      this.panel.webview.postMessage({ type: 'branchData', payload: { branches, tags, remotes, stashes } });
    } catch (err) {
      console.warn('Git Graph+: refresh failed:', err instanceof Error ? err.message : err);
    }
  }

  private async sendRepoList(): Promise<void> {
    try {
      const workspacePaths = new Set<string>();
      for (const f of vscode.workspace.workspaceFolders ?? []) {
        workspacePaths.add(f.uri.fsPath);
      }
      workspacePaths.add(this.repoPath);
      const repos = await RepoDiscoveryService.discoverRepos([...workspacePaths]);
      this.panel.webview.postMessage({
        type: 'repoList',
        payload: { repos, active: this.repoPath },
      });
    } catch {
      // ignore
    }
  }

  private async onRepoChanged(what: string): Promise<void> {
    this.panel.webview.postMessage({
      type: 'repoChanged',
      payload: { what },
    });

    if (what === 'refs' || what === 'unknown') {
      try {
        const [repoCommits, repoBranches] = await Promise.all([
          this.gitService.log({ limit: 1000 }),
          this.gitService.branches(),
        ]);
        const graph = buildGraph(repoCommits, repoBranches);
        const fg = buildFullGraph(repoCommits, repoBranches);
        this.panel.webview.postMessage({
          type: 'logData',
          payload: { commits: repoCommits, graph, paths: fg.paths, links: fg.links, dots: fg.dots, commitLeftMargin: fg.commitLeftMargin },
        });

        const [branches, tags, remotes, stashes] = await Promise.all([
          this.gitService.branches(),
          this.gitService.tags(),
          this.gitService.remotes(),
          this.gitService.stashList(),
        ]);
        this.panel.webview.postMessage({
          type: 'branchData',
          payload: { branches, tags, remotes, stashes },
        });
      } catch (err) {
        console.warn('Git Graph+: auto-refresh failed:', err instanceof Error ? err.message : err);
      }
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const distUri = vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'main.css'));
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https://www.gravatar.com; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${codiconUri}">
  <link rel="stylesheet" href="${styleUri}">
  <title>Git Graph+</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    MainPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
