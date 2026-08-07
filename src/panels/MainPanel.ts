import * as vscode from 'vscode';
import * as path from 'path';
import { readFile, access } from 'fs/promises';
import { GitService, GitError } from '../git/git-service';
import { formatGitError, isAuthFailure, transportFromRemoteUrl } from '../git/git-error-formatter';
import { splitUpstreamRef } from '../git/git-parser';
import { samePath } from '../utils/path';
import { readTimeoutMs, readInitialCommitCount, readLoadMoreCommitCount, readInteractiveRebaseMode } from '../utils/config';
import { buildClassicRebaseCommand } from '../git/classic-rebase';
import { buildFullGraph } from '../git/git-graph-builder';
import { compileBranchColorRules, makeBranchColorResolver } from '../git/branch-color-resolver';
import { resolveGraphColors } from '../git/graph-colors';
import { triggerVSCodeGitAuth } from '../git/vscode-git-bridge';
import { FileWatcher } from '../services/file-watcher';
import { AvatarCache, type AvatarSource } from '../services/avatar-cache';
import { resolveGitDirs, shouldRefreshGraph } from '../services/file-watcher-helpers';
import { RepoDiscoveryService, RepoInfo } from '../services/repo-discovery';
import type { WebviewMessage, ModalDefaults } from '../utils/message-bus';
import { resolveCommitLinkRules, type LinkRule } from '../git/commit-link-rules';
import {
  resolveRepoRelativePath as resolveRepoRelativePathUtil,
  assertSafeArgPath as assertSafeArgPathUtil,
} from '../utils/path-validation';
import { SequenceGuard } from '../utils/sequence-guard';
import { resolveDefaultWorktreePath } from '../utils/worktree-path';

export class MainPanel {
  public static currentPanel: MainPanel | undefined;
  private static readonly viewType = 'gitGraphPlus';
  private static savedRemoteFilter: string[] | undefined = undefined;
  private static savedBranchFilter: string[] | undefined = undefined;
  private static extraEnv: Record<string, string> | undefined = undefined;
  // Shared across panels in this extension host. The on-disk cache lives under
  // globalStorage so every VS Code window reuses the same avatars instead of
  // each one re-fetching from gravatar.com (issue #38).
  private static avatarCacheDir: string | undefined = undefined;
  private static avatarCache: AvatarCache | undefined = undefined;
  private static avatarCacheSource: AvatarSource | undefined = undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private repoPath: string;
  private gitService: GitService;
  private fileWatcher: FileWatcher;
  private disposables: vscode.Disposable[] = [];
  private allConflictFiles: string[] = [];
  private currentLimit = 1000;
  private currentRemoteFilter: string[] | undefined = undefined;
  private currentBranchFilter: string[] | undefined = undefined;
  private isFirstGetLog = true;
  private logSequence = 0;
  private searchSequence = 0;
  // Two independent guards: selecting a commit (loads its file list) and
  // selecting a file (loads that file's diff) are different axes, so a file
  // request must not invalidate a pending commit-files request and vice versa.
  // getFileDiff and getUncommittedFileDiff share `fileDiffSequence` because
  // both deliver `fileDiffData` to the same panel — a newer file selection
  // should supersede an older one regardless of committed/uncommitted source.
  private commitFilesSequence = new SequenceGuard();
  private fileDiffSequence = new SequenceGuard();
  private multiCommitSectionsSequence = new SequenceGuard();
  private cachedRepos: RepoInfo[] = [];
  private disposed = false;
  public static onSidebarRefresh: (() => void) | null = null;
  public static onRepoChange: ((repoPath: string) => void) | null = null;

  /** Safe postMessage: drops messages after disposal and swallows the throw
   *  that VS Code raises if the underlying webview has gone away. Use this
   *  in every async path that may resolve after the user closes the panel. */
  private post(msg: unknown): void {
    if (this.disposed) return;
    try {
      this.panel.webview.postMessage(msg);
    } catch {
      // Webview was torn down between our check and the call (e.g., user
      // closed the panel mid-flight). Nothing to do.
    }
  }

  public static setExtraEnv(env: Record<string, string>): void {
    this.extraEnv = env;
    if (this.currentPanel) {
      this.currentPanel.gitService.setExtraEnv(env);
    }
  }

  /** Directory for the persistent avatar cache (typically under globalStorage). */
  public static setAvatarCacheDir(dir: string): void {
    this.avatarCacheDir = dir;
  }

  private static getAvatarCache(): AvatarCache {
    const configuredSource = vscode.workspace
      .getConfiguration('gitGraphPlus')
      .get<string>('avatarSource', 'gravatar');
    const source: AvatarSource = configuredSource === 'gravatar' ? 'gravatar' : 'retro';

    if (!this.avatarCache || this.avatarCacheSource !== source) {
      this.avatarCache = new AvatarCache(this.avatarCacheDir ?? null, undefined, { source });
      this.avatarCacheSource = source;
    }
    return this.avatarCache;
  }

  private resolveRepoRelativePath(rel: unknown, op: string): string {
    return resolveRepoRelativePathUtil(this.repoPath, rel, op);
  }

  private assertSafeArgPath(p: unknown, op: string): string {
    return assertSafeArgPathUtil(p, op);
  }

  private createGitService(repoPath: string): GitService {
    const svc = new GitService(repoPath);
    if (MainPanel.extraEnv) svc.setExtraEnv(MainPanel.extraEnv);
    svc.setWarningHandler(msg => {
      // Surface non-fatal git failures (e.g., stash log / uncommitted status / remote list
      // failures) to the webview so the user knows the displayed graph may be incomplete.
      this.post({ type: 'error', payload: { message: `Git Graph+: ${msg}` } });
    });
    // On auth failure (missing/invalid HTTPS credentials), route through the
    // built-in `vscode.git` extension so the user sees the same credential
    // prompt as the SCM panel. Once they sign in, the OS credential helper
    // caches it and our retried spawn-based command succeeds.
    svc.setAuthRetryHandler(remote => triggerVSCodeGitAuth(repoPath, remote));
    svc.setDefaultTimeout(readTimeoutMs());
    return svc;
  }

  private readModalDefaults(): ModalDefaults {
    const cfg = vscode.workspace.getConfiguration('gitGraphPlus');
    const g = <T>(key: string, fallback: T): T => cfg.get<T>(`defaults.${key}`, fallback);
    return {
      push: { force: g('push.force', 'none'), setUpstream: g('push.setUpstream', true), allTags: g('push.allTags', false) },
      pull: { rebase: g('pull.rebase', true), stash: g('pull.stash', false) },
      fetch: { allRemotes: g('fetch.allRemotes', false) },
      merge: { mode: g('merge.mode', 'default'), pushAfter: g('merge.pushAfter', false), deleteSource: g('merge.deleteSource', false) },
      rebase: { autostash: g('rebase.autostash', false), pushAfter: g('rebase.pushAfter', false) },
      amend: { keepMessage: g('amend.keepMessage', true), resetDate: g('amend.resetDate', false), resetAuthor: g('amend.resetAuthor', false), only: g('amend.only', false), pushAfter: g('amend.pushAfter', false) },
      checkout: { dirty: g('checkout.dirty', 'keep') },
      checkoutRemote: { dirty: g('checkoutRemote.dirty', 'keep') },
      createBranch: { checkout: g('createBranch.checkout', true), publish: g('createBranch.publish', false) },
      createTag: { push: g('createTag.push', true) },
      cherryPick: { noCommit: g('cherryPick.noCommit', false), pushAfter: g('cherryPick.pushAfter', false) },
      revert: { noCommit: g('revert.noCommit', false), pushAfter: g('revert.pushAfter', false) },
      reset: { mode: g('reset.mode', 'mixed') },
      stashSave: { includeUntracked: g('stashSave.includeUntracked', true), keepIndex: g('stashSave.keepIndex', false) },
      deleteBranch: { force: g('deleteBranch.force', false), deleteRemote: g('deleteBranch.deleteRemote', false) },
      deleteTag: { deleteRemote: g('deleteTag.deleteRemote', false) },
      removeWorktree: { deleteBranch: g('removeWorktree.deleteBranch', false) },
    } as ModalDefaults;
  }

  // Width (px) of the colored branch-badge bar, mapped from the user setting.
  private readBadgeBarWidth(): number {
    const level = vscode.workspace
      .getConfiguration('gitGraphPlus')
      .get<'thin' | 'medium' | 'thick'>('branchBadgeBarThickness', 'thin');
    return level === 'thick' ? 8 : level === 'medium' ? 6 : 4;
  }

  private makeBranchColorResolver(): (name: string) => string | undefined {
    const raw = vscode.workspace.getConfiguration('gitGraphPlus').get('branchColors');
    return makeBranchColorResolver(compileBranchColorRules(raw));
  }

  // Validated graph rail palette from the user setting (falls back to default).
  private readGraphColors(): string[] {
    const raw = vscode.workspace.getConfiguration('gitGraphPlus').get('graphColors');
    return resolveGraphColors(raw);
  }

  // Resolve commit-message link rules from settings + the origin remote URL.
  private async getCommitLinkRules(): Promise<LinkRule[]> {
    const cfg = vscode.workspace.getConfiguration('gitGraphPlus');
    const custom = cfg.get('commitMessageLinks');
    const autoDetect = cfg.get<boolean>('autoDetectRepoLinks', true);
    let remoteUrl: string | null = null;
    if (autoDetect) {
      try {
        remoteUrl = await this.gitService.getRemoteUrl('origin');
      } catch {
        // No origin (or no remote) — built-in detection simply yields nothing.
        remoteUrl = null;
      }
    }
    return resolveCommitLinkRules(custom, autoDetect, remoteUrl);
  }

  private async postCommitLinkRules(): Promise<void> {
    const rules = await this.getCommitLinkRules();
    this.post({ type: 'setCommitLinkRules', payload: { rules } });
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    repoPath: string
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.repoPath = repoPath;
    this.gitService = this.createGitService(repoPath);

    this.fileWatcher = new FileWatcher(repoPath, (what) => {
      this.onRepoChanged(what);
    });
    this.fileWatcher.enabled = vscode.workspace.getConfiguration('gitGraphPlus').get<boolean>('autoRefresh', true);
    this.disposables.push(this.fileWatcher);

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('gitGraphPlus.autoRefresh')) {
          this.fileWatcher.enabled = vscode.workspace.getConfiguration('gitGraphPlus').get<boolean>('autoRefresh', true);
        }
        if (e.affectsConfiguration('gitGraphPlus.graphSortOrder')) {
          this.refreshAll();
        }
        if (e.affectsConfiguration('gitGraphPlus.avatarSource')) {
          MainPanel.avatarCache = undefined;
          this.post({ type: 'resetAvatars' });
        }
        if (e.affectsConfiguration('gitGraphPlus.locale')) {
          const localeSetting = vscode.workspace.getConfiguration('gitGraphPlus').get<string>('locale', 'auto');
          const locale = localeSetting === 'auto' ? (vscode.env.language || 'en') : localeSetting;
          this.post({ type: 'setLocale', payload: { locale } });
        }
        if (e.affectsConfiguration('gitGraphPlus.interactiveRebase.mode')) {
          this.post({ type: 'setInteractiveRebaseMode', payload: { mode: readInteractiveRebaseMode() } });
        }
        if (e.affectsConfiguration('gitGraphPlus.defaults')) {
          this.post({ type: 'setDefaults', payload: this.readModalDefaults() });
        }
        if (e.affectsConfiguration('gitGraphPlus.branchBadgeBarThickness')) {
          this.post({ type: 'setBadgeBarThickness', payload: { width: this.readBadgeBarWidth() } });
        }
        if (e.affectsConfiguration('gitGraphPlus.loadMoreCommitCount')) {
          this.post({ type: 'setLoadMoreCount', payload: { count: readLoadMoreCommitCount() } });
        }
        if (e.affectsConfiguration('gitGraphPlus.branchColors')) {
          this.refreshAll();
        }
        if (e.affectsConfiguration('gitGraphPlus.graphColors')) {
          this.post({ type: 'setGraphColors', payload: { colors: this.readGraphColors() } });
        }
        if (
          e.affectsConfiguration('gitGraphPlus.commitMessageLinks') ||
          e.affectsConfiguration('gitGraphPlus.autoDetectRepoLinks')
        ) {
          void this.postCommitLinkRules();
        }
        if (e.affectsConfiguration('gitGraphPlus.timeout')) {
          this.gitService.setDefaultTimeout(readTimeoutMs());
        }
      })
    );

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    // Send locale to webview
    const localeSetting = vscode.workspace.getConfiguration('gitGraphPlus').get<string>('locale', 'auto');
    const locale = localeSetting === 'auto' ? (vscode.env.language || 'en') : localeSetting;
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    this.post({ type: 'setLocale', payload: { locale, homeDir } });
    this.post({ type: 'setDefaults', payload: this.readModalDefaults() });
    this.post({ type: 'setBadgeBarThickness', payload: { width: this.readBadgeBarWidth() } });
    this.post({ type: 'setGraphColors', payload: { colors: this.readGraphColors() } });
    this.post({ type: 'setLoadMoreCount', payload: { count: readLoadMoreCommitCount() } });
    this.post({ type: 'setInteractiveRebaseMode', payload: { mode: readInteractiveRebaseMode() } });
    void this.postCommitLinkRules();

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Discover repos (including submodules) once on init
    this.sendRepoList();
  }

  public static createOrShow(extensionUri: vscode.Uri, repoPathHint?: string): void {
    let repoPath: string | undefined = repoPathHint;

    if (!repoPath) {
      // Try to find the repo associated with the active editor
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
        if (workspaceFolder) {
          repoPath = workspaceFolder.uri.fsPath;
        }
      }
    }

    // Fallback to first workspace folder
    if (!repoPath) {
      repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    if (!repoPath) {
      vscode.window.showWarningMessage('Git Graph+: No workspace folder open.');
      return;
    }

    if (MainPanel.currentPanel) {
      // If a specific repo is requested, switch to it before revealing
      if (repoPathHint && MainPanel.currentPanel.repoPath !== repoPathHint) {
        MainPanel.currentPanel.switchRepo(repoPathHint);
      }
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

  /**
   * Point the panel at a different repo: rebuild the GitService, reset
   * repo-specific state, swap the file watcher, and notify the sidebar. Callers
   * still own posting the repo list and triggering the refresh.
   *
   * NOTE: the sequence guards (logSequence/searchSequence/*Sequence) are
   * intentionally NOT reset. They stay monotonic for the panel's lifetime so a
   * request still in flight against the old repo can never share a seq with a
   * fresh request against the new one — resetting reuses numbers and lets a
   * stale response paint the previous repo's graph over the current one.
   */
  private swapRepo(newPath: string): void {
    this.repoPath = newPath;
    this.gitService = this.createGitService(newPath);

    this.allConflictFiles = [];
    this.isFirstGetLog = true;
    this.currentRemoteFilter = undefined;
    this.currentBranchFilter = undefined;

    const oldWatcher = this.fileWatcher;
    oldWatcher.dispose();
    const oldIdx = this.disposables.indexOf(oldWatcher);
    if (oldIdx >= 0) { this.disposables.splice(oldIdx, 1); }
    this.fileWatcher = new FileWatcher(newPath, (what) => this.onRepoChanged(what));
    this.fileWatcher.enabled = vscode.workspace.getConfiguration('gitGraphPlus').get<boolean>('autoRefresh', true);
    this.disposables.push(this.fileWatcher);

    MainPanel.onRepoChange?.(newPath);
  }

  public async switchRepo(newPath: string): Promise<void> {
    if (samePath(newPath, this.repoPath)) { return; }
    this.swapRepo(newPath);

    this.post({
      type: 'repoList',
      payload: { repos: this.cachedRepos, active: this.repoPath },
    });

    await this.refreshAll();
  }

  public postShowModal(payload: { modal: string; [key: string]: any }): void {
    this.panel.reveal();
    this.post({ type: 'showModal', payload });
  }

  private static pendingModal: { modal: string; [key: string]: any } | null = null;

  public static showModalWithPanel(extensionUri: vscode.Uri, payload: { modal: string; [key: string]: any }): void {
    if (MainPanel.currentPanel) {
      MainPanel.currentPanel.postShowModal(payload);
    } else {
      MainPanel.pendingModal = payload;
      MainPanel.createOrShow(extensionUri);
    }
  }

  public processPendingModal(): void {
    if (MainPanel.pendingModal) {
      const payload = MainPanel.pendingModal;
      MainPanel.pendingModal = null;
      this.post({ type: 'showModal', payload });
    }
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'getLog': {
          const cfg = vscode.workspace.getConfiguration('gitGraphPlus');
          const sortOrder = cfg.get<'author-date' | 'date' | 'topological'>('graphSortOrder', 'topological');
          const includeSignature = cfg.get<boolean>('showSignatureStatus', true);
          const requestedLimit = message.payload.limit ?? readInitialCommitCount();
          this.currentLimit = requestedLimit;
          // On first load, apply saved filter if the webview didn't specify one.
          const effectiveFilter = this.isFirstGetLog && message.payload.remoteFilter === undefined
            ? MainPanel.savedRemoteFilter
            : message.payload.remoteFilter;
          const effectiveBranchFilter = this.isFirstGetLog && message.payload.branches === undefined
            ? MainPanel.savedBranchFilter
            : message.payload.branches;
          this.isFirstGetLog = false;
          this.currentRemoteFilter = effectiveFilter;
          this.currentBranchFilter = effectiveBranchFilter;
          const logPayload = { ...message.payload, remoteFilter: effectiveFilter, branches: effectiveBranchFilter, limit: requestedLimit + 1, sortOrder, includeSignature };
          const seq = ++this.logSequence;
          const [allFetched, logBranches] = await Promise.all([
            this.gitService.log(logPayload),
            this.gitService.branches(),
          ]);
          if (seq !== this.logSequence) break;
          const hasMore = allFetched.length > requestedLimit;
          const commits = hasMore ? allFetched.slice(0, requestedLimit) : allFetched;
          const branchColorResolver = this.makeBranchColorResolver();
          const fullGraph = commits.length > 0 ? buildFullGraph(commits, logBranches, branchColorResolver) : { paths: [], links: [], dots: [], commitLeftMargin: [] };
          this.post({
            type: 'logData',
            payload: {
              commits,
              hasMore,
              currentLimit: requestedLimit,
              // The webview renders from paths/links/dots; the legacy GraphNode[] is
              // unused, so we skip building and sending it (saves CPU + IPC payload).
              graph: [],
              paths: fullGraph.paths,
              links: fullGraph.links,
              dots: fullGraph.dots,
              commitLeftMargin: fullGraph.commitLeftMargin,
              remoteFilter: effectiveFilter,
              branches: effectiveBranchFilter,
            },
          });
          break;
        }
        case 'getBranches': {
          const [branches, tags, remotes, stashes, worktrees] = await Promise.all([
            this.gitService.branches(),
            this.gitService.tags(),
            this.gitService.remotes(),
            this.gitService.stashList(),
            this.gitService.worktreeList(),
          ]);
          this.post({
            type: 'branchData',
            payload: { branches, tags, remotes, stashes, worktrees },
          });
          this.processPendingModal();
          break;
        }
        case 'getRepoList': {
          await this.sendRepoList(true);
          break;
        }
        case 'getCommitDiff': {
          // Guard against rapid clicks on different commits: only the most
          // recently requested file list is delivered to the webview.
          const ticket = this.commitFilesSequence.issue();
          const commitFiles = await this.gitService.showCommitFiles(message.payload.hash);
          if (!this.commitFilesSequence.isCurrent(ticket)) break;
          this.post({
            type: 'commitDiffData',
            payload: { hash: message.payload.hash, files: commitFiles },
          });
          break;
        }
        case 'getFileDiff': {
          const ticket = this.fileDiffSequence.issue();
          const diffs = await this.gitService.showCommitDiff(message.payload.hash, message.payload.file);
          if (!this.fileDiffSequence.isCurrent(ticket)) break;
          this.post({
            type: 'fileDiffData',
            payload: { hash: message.payload.hash, file: message.payload.file, diff: diffs[0] || null },
          });
          break;
        }
        case 'getMultiCommitSections': {
          const ticket = this.multiCommitSectionsSequence.issue();
          const result = await this.gitService.multiCommitSections(message.payload.hashes);
          if (!this.multiCommitSectionsSequence.isCurrent(ticket)) break;
          this.post({
            type: 'multiCommitSectionsData',
            payload: {
              files: result.files.map(f => ({ path: f.path, status: f.status })),
              sections: result.sections,
            },
          });
          break;
        }
        case 'checkDirty': {
          const dirty = await this.gitService.isDirty();
          this.post({ type: 'dirtyState', payload: { dirty, requestId: message.payload?.requestId } });
          break;
        }
        case 'getUncommittedDiff': {
          const result = await this.gitService.getUncommittedDiff();
          this.post({ type: 'uncommittedDiffData', payload: result });
          break;
        }
        case 'getUncommittedFileDiff': {
          // Same guard as getFileDiff: rapid switching between uncommitted files
          // must not let a slow earlier diff overwrite the current selection.
          const ticket = this.fileDiffSequence.issue();
          const diff = await this.gitService.getUncommittedFileDiff(message.payload.file, message.payload.staged);
          if (!this.fileDiffSequence.isCurrent(ticket)) break;
          const key = (message.payload.staged ? 'staged' : 'unstaged') + ':' + message.payload.file;
          this.post({ type: 'fileDiffData', payload: { hash: 'UNCOMMITTED', file: message.payload.file, key, diff } });
          break;
        }
        case 'predictConflicts': {
          const result = message.payload.mode === 'rebase'
            ? await this.gitService.predictRebaseConflicts(message.payload.ours, message.payload.theirs)
            : await this.gitService.predictConflicts(message.payload.ours, message.payload.theirs, message.payload.mergeBase);
          this.post({
            type: 'conflictPrediction',
            payload: { ...result, requestId: message.payload.requestId },
          });
          break;
        }
        case 'checkout': {
          // "Stash and checkout" sets the local changes aside and leaves them
          // in the stash — it must not pop them back, which would carry them
          // onto the target branch (identical to "keep changes and checkout").
          if (message.payload.stash) {
            await this.gitService.stashSave('Auto-stash before checkout', message.payload.stashUntracked);
          }
          if (message.payload.clean) {
            await this.gitService.clean();
          }
          await this.gitService.checkout(message.payload.ref, { force: message.payload.force, merge: message.payload.merge });
          if (message.payload.pullAfter) {
            await this.gitService.pull();
          }
          this.post({
            type: 'operationComplete',
            payload: { operation: 'checkout', success: true },
          });
          const checkedOutRef = /^[0-9a-f]{40}$/i.test(message.payload.ref) ? message.payload.ref.substring(0, 7) : message.payload.ref;
          vscode.window.showInformationMessage(vscode.l10n.t('checkedOut', checkedOutRef));
          if (message.payload.stash) {
            vscode.window.showInformationMessage(vscode.l10n.t('changesStashed'));
          }
          await this.refreshAll();
          break;
        }
        case 'createBranch': {
          if (message.payload.checkout) {
            // Same as checkout: stashing sets changes aside; do not pop them back.
            if (message.payload.stash) {
              await this.gitService.stashSave('Auto-stash before checkout', message.payload.stashUntracked);
            }
            if (message.payload.clean) {
              await this.gitService.clean();
            }
            await this.gitService.createAndCheckoutBranch(message.payload.name, message.payload.startPoint, { merge: message.payload.merge });
          } else {
            await this.gitService.createBranch(message.payload.name, message.payload.startPoint);
          }
          // Optional follow-up: publish the new branch to the default remote
          // with -u. Non-fatal — the branch already exists locally.
          if (message.payload.publish) {
            try {
              await this.gitService.publishBranch(message.payload.name);
            } catch (err) {
              this.post({ type: 'error', payload: { message: vscode.l10n.t('publishBranchFailed', message.payload.name, err instanceof Error ? err.message : String(err)) } });
            }
          }
          this.post({
            type: 'operationComplete',
            payload: { operation: 'createBranch', success: true },
          });
          vscode.window.showInformationMessage(
            message.payload.checkout
              ? vscode.l10n.t('branchCreatedAndCheckedOut', message.payload.name)
              : vscode.l10n.t('branchCreated', message.payload.name)
          );
          if (message.payload.checkout && message.payload.stash) {
            vscode.window.showInformationMessage(vscode.l10n.t('changesStashed'));
          }
          await this.refreshAll();
          break;
        }
        case 'deleteBranch': {
          // Remove linked worktree first (branch can't be deleted while in use by a worktree)
          if (message.payload.worktreePath) {
            await this.gitService.worktreeRemove(message.payload.worktreePath, true);
          }
          await this.gitService.deleteBranch(message.payload.name, message.payload.force);
          // Delete remote branch if requested
          if (message.payload.deleteRemote) {
            const branches = await this.gitService.branches();
            const localInfo = branches.find(b => !b.remote && b.name === message.payload.name);
            if (localInfo?.upstream) {
              const { remote, branch } = splitUpstreamRef(localInfo.upstream);
              await this.gitService.deleteRemoteBranch(branch, remote);
            } else {
              // Fallback: try origin
              try { await this.gitService.deleteRemoteBranch(message.payload.name); } catch { /* ignore */ }
            }
          }
          this.post({
            type: 'operationComplete',
            payload: { operation: 'deleteBranch', success: true },
          });
          vscode.window.showInformationMessage(vscode.l10n.t('branchDeleted', message.payload.name));
          await this.refreshAll();
          break;
        }
        case 'deleteRemoteBranch': {
          await this.gitService.deleteRemoteBranch(message.payload.name, message.payload.remote);
          this.post({
            type: 'operationComplete',
            payload: { operation: 'deleteRemoteBranch', success: true },
          });
          vscode.window.showInformationMessage(vscode.l10n.t('remoteBranchDeleted', message.payload.remote, message.payload.name));
          await this.refreshAll();
          break;
        }
        case 'renameBranch': {
          await this.gitService.renameBranch(message.payload.oldName, message.payload.newName);
          this.post({
            type: 'operationComplete',
            payload: { operation: 'renameBranch', success: true },
          });
          vscode.window.showInformationMessage(vscode.l10n.t('branchRenamed', message.payload.newName));
          await this.refreshAll();
          break;
        }
        case 'setUpstream': {
          await this.gitService.setUpstream(message.payload.branch, message.payload.remote, message.payload.remoteBranch, { createRemote: message.payload.createRemote });
          this.post({ type: 'operationComplete', payload: { operation: 'setUpstream', success: true } });
          await this.refreshAll();
          break;
        }
        case 'fastForward': {
          if (message.payload.noCheckout) {
            // Update the (non-current) branch in place without switching to it.
            // Pure ref fast-forward — the working tree and current branch are
            // untouched, so no stash/clean dance is needed.
            await this.gitService.fastForwardRef(message.payload.local, message.payload.remote);
          } else {
            // Fast-forward is a sync (like pull, and git's `merge --autostash`):
            // stash so the working tree is clean for the ff-merge, then pop to
            // restore the changes — unlike a plain checkout, which sets them aside.
            if (message.payload.stash) {
              await this.gitService.stashSave('Auto-stash before fast-forward', message.payload.stashUntracked);
            }
            if (message.payload.clean) {
              await this.gitService.clean();
            }
            try {
              await this.gitService.checkout(message.payload.local, {});
              await this.gitService.merge(message.payload.remote, { ffOnly: true });
            } finally {
              if (message.payload.stash) {
                try {
                  await this.gitService.stashPop(0);
                } catch {
                  this.post({ type: 'error', payload: { message: vscode.l10n.t('stashPopAfterFastForwardFailed') } });
                }
              }
            }
          }
          this.post({
            type: 'operationComplete',
            payload: { operation: 'checkout', success: true },
          });
          vscode.window.showInformationMessage(vscode.l10n.t('fastForwarded', message.payload.local, message.payload.remote));
          await this.refreshAll();
          break;
        }
        case 'merge': {
          await this.gitService.merge(message.payload.branch, { noFf: message.payload.noFf, ffOnly: message.payload.ffOnly, squash: message.payload.squash });
          // Optional follow-ups. A merge creates a new commit (no history
          // rewrite) so the push needs no force. Both follow-ups are non-fatal:
          // the merge already succeeded, so surface failures separately.
          if (message.payload.deleteSource) {
            try {
              await this.gitService.deleteBranch(message.payload.branch);
            } catch (err) {
              this.post({ type: 'error', payload: { message: vscode.l10n.t('deleteSourceAfterMergeFailed', message.payload.branch, err instanceof Error ? err.message : String(err)) } });
            }
          }
          let pushFailed = false;
          if (message.payload.pushAfter) {
            try {
              await this.gitService.pushCurrentBranch();
            } catch (err) {
              pushFailed = true;
              this.post({ type: 'error', payload: { message: vscode.l10n.t('pushAfterMergeFailed', err instanceof Error ? err.message : String(err)) } });
            }
          }
          this.post({
            type: 'operationComplete',
            payload: { operation: 'merge', success: true },
          });
          if (message.payload.pushAfter && !pushFailed) {
            vscode.window.showInformationMessage(vscode.l10n.t('mergedAndPushed', message.payload.branch));
          } else {
            vscode.window.showInformationMessage(vscode.l10n.t('merged', message.payload.branch));
          }
          await this.refreshAll();
          break;
        }
        case 'abortMerge': {
          await this.gitService.abortMerge();
          this.post({
            type: 'operationComplete',
            payload: { operation: 'abortMerge', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'openDiff': {
          if (message.payload.ref1 && message.payload.ref2) {
            await this.openCompareDiffInEditor(message.payload.file, message.payload.ref1, message.payload.ref2);
          } else {
            await this.openDiffInEditor(
              message.payload.file,
              message.payload.staged ?? false,
              message.payload.commitHash,
            );
          }
          break;
        }
        case 'openFile': {
          const fullPath = this.resolveRepoRelativePath(message.payload.file, 'openFile');
          const fileUri = vscode.Uri.file(fullPath);
          await vscode.window.showTextDocument(fileUri, { preview: false });
          break;
        }
        case 'revealInExplorer': {
          const fullPath = this.resolveRepoRelativePath(message.payload.file, 'revealInExplorer');
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(fullPath));
          break;
        }
        case 'copyFilePath': {
          const fullPath = this.resolveRepoRelativePath(message.payload.file, 'copyFilePath');
          await vscode.env.clipboard.writeText(fullPath);
          this.post({ type: 'operationComplete', payload: { operation: 'copied', success: true } });
          break;
        }
        case 'openScmView': {
          await vscode.commands.executeCommand('workbench.view.scm');
          // When opened alongside the amend modal, return focus to the webview
          // so the modal stays keyboard-interactive (Escape to close, typing in
          // the message). Without this, focus stays in the SCM view.
          if (message.payload?.returnFocus) {
            this.panel.reveal(this.panel.viewColumn, false);
          }
          break;
        }
        case 'openExternalUrl': {
          const url = message.payload?.url;
          if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
            await vscode.env.openExternal(vscode.Uri.parse(url));
          }
          break;
        }
        case 'openExtensionSettings': {
          // Opens VS Code Settings pre-filtered to this extension's settings.
          await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:the0807.git-graph-plus');
          break;
        }
        case 'amendCommit': {
          await this.gitService.amendCommit(message.payload);
          // Optional follow-up: amend rewrites HEAD, so the push force-pushes
          // with --force-with-lease. Non-fatal — the amend already succeeded.
          let amendPushFailed = false;
          if (message.payload.pushAfter) {
            try {
              await this.gitService.pushCurrentBranch({ force: 'with-lease' });
            } catch (err) {
              amendPushFailed = true;
              this.post({ type: 'error', payload: { message: vscode.l10n.t('pushAfterAmendFailed', err instanceof Error ? err.message : String(err)) } });
            }
          }
          this.post({
            type: 'operationComplete',
            payload: { operation: 'amendCommit', success: true },
          });
          if (message.payload.pushAfter && !amendPushFailed) {
            vscode.window.showInformationMessage(vscode.l10n.t('commitAmendedAndPushed'));
          } else {
            vscode.window.showInformationMessage(vscode.l10n.t('commitAmended'));
          }
          await this.refreshAll();
          break;
        }
        case 'fetch': {
          await this.gitService.fetch(message.payload.remote, { prune: message.payload.prune });
          this.post({
            type: 'operationComplete',
            payload: { operation: 'fetch', success: true },
          });
          vscode.window.showInformationMessage(vscode.l10n.t('fetched'));
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
              try {
                await this.gitService.stashPop(0);
              } catch {
                this.post({ type: 'error', payload: { message: vscode.l10n.t('stashPopAfterPullFailed') } });
              }
            }
          }
          this.post({
            type: 'operationComplete',
            payload: { operation: 'pull', success: true },
          });
          vscode.window.showInformationMessage(vscode.l10n.t('pulled'));
          await this.refreshAll();
          break;
        }
        case 'push': {
          await this.gitService.push(message.payload.remote, message.payload.branch, { force: message.payload.force, setUpstream: message.payload.setUpstream });
          this.post({
            type: 'operationComplete',
            payload: { operation: 'push', success: true },
          });
          vscode.window.showInformationMessage(vscode.l10n.t('pushed'));
          await this.refreshAll();
          break;
        }
        case 'addRemote': {
          await this.gitService.addRemote(message.payload.name, message.payload.url);
          this.post({
            type: 'operationComplete',
            payload: { operation: 'addRemote', success: true },
          });
          vscode.window.showInformationMessage(vscode.l10n.t('remoteAdded', message.payload.name));
          await this.refreshAll();
          break;
        }
        case 'removeRemote': {
          await this.gitService.removeRemote(message.payload.name);
          this.post({
            type: 'operationComplete',
            payload: { operation: 'removeRemote', success: true },
          });
          vscode.window.showInformationMessage(vscode.l10n.t('remoteRemoved', message.payload.name));
          await this.refreshAll();
          break;
        }
        case 'rebase': {
          await this.gitService.rebase(message.payload.onto, { autostash: message.payload.autostash });
          // Optional follow-up: push the rebased branch. Rebase rewrites history,
          // so this force-pushes with --force-with-lease. A push failure here is
          // non-fatal — the rebase already succeeded — so surface it separately.
          let pushOutcome: 'pushed' | 'no-remote' | 'failed' | null = null;
          if (message.payload.pushAfter) {
            try {
              const result = await this.gitService.pushCurrentBranch({ force: 'with-lease' });
              pushOutcome = result.pushed ? 'pushed' : 'no-remote';
            } catch (err) {
              pushOutcome = 'failed';
              this.post({ type: 'error', payload: { message: vscode.l10n.t('pushAfterRebaseFailed', err instanceof Error ? err.message : String(err)) } });
            }
          }
          this.post({
            type: 'operationComplete',
            payload: { operation: 'rebase', success: true },
          });
          const onto = message.payload.onto.substring(0, 7);
          if (pushOutcome === 'pushed') {
            vscode.window.showInformationMessage(vscode.l10n.t('rebasedAndPushed', onto));
          } else if (pushOutcome === 'no-remote') {
            vscode.window.showInformationMessage(vscode.l10n.t('pushAfterRebaseNoRemote', onto));
          } else {
            vscode.window.showInformationMessage(vscode.l10n.t('rebased', onto));
          }
          await this.refreshAll();
          break;
        }
        case 'dragRebase': {
          // Drag A onto B = rebase A onto B, leaving A current. Check out the
          // source directly (not via the checkout message) so no "Checked out"
          // notification fires — only the rebase result is announced.
          if (message.payload.stash) {
            await this.gitService.stashSave('Auto-stash before checkout', message.payload.stashUntracked);
          }
          if (message.payload.clean) {
            await this.gitService.clean();
          }
          const dragCurrent = (await this.gitService.branches()).find(b => b.current)?.name;
          if (dragCurrent !== message.payload.source) {
            await this.gitService.checkout(message.payload.source, { force: message.payload.force, merge: message.payload.merge });
          }
          await this.gitService.rebase(message.payload.target);
          this.post({ type: 'operationComplete', payload: { operation: 'rebase', success: true } });
          vscode.window.showInformationMessage(
            vscode.l10n.t('rebasedBranchOnto', message.payload.source, message.payload.target),
          );
          await this.refreshAll();
          break;
        }
        case 'dragMerge': {
          // Drag A onto B = merge A into B (always --no-ff), leaving B current.
          // Check out the target directly so no "Checked out" notification fires.
          if (message.payload.stash) {
            await this.gitService.stashSave('Auto-stash before checkout', message.payload.stashUntracked);
          }
          if (message.payload.clean) {
            await this.gitService.clean();
          }
          const mergeCurrent = (await this.gitService.branches()).find(b => b.current)?.name;
          if (mergeCurrent !== message.payload.target) {
            await this.gitService.checkout(message.payload.target, { force: message.payload.force, merge: message.payload.merge });
          }
          await this.gitService.merge(message.payload.source, { noFf: true });
          this.post({ type: 'operationComplete', payload: { operation: 'merge', success: true } });
          vscode.window.showInformationMessage(
            vscode.l10n.t('mergedBranchInto', message.payload.source, message.payload.target),
          );
          await this.refreshAll();
          break;
        }
        case 'abortRebase': {
          await this.gitService.abortRebase();
          this.post({
            type: 'operationComplete',
            payload: { operation: 'abortRebase', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'continueRebase': {
          await this.gitService.continueRebase();
          this.post({
            type: 'operationComplete',
            payload: { operation: 'continueRebase', success: true },
          });
          await this.refreshAll();
          break;
        }
        case 'skipRebase': {
          await this.gitService.skipRebase();
          this.post({ type: 'operationComplete', payload: { operation: 'skipRebase', success: true } });
          await this.refreshAll();
          break;
        }
        case 'interactiveRebase': {
          await this.gitService.interactiveRebase(message.payload.base, message.payload.todos);
          this.post({ type: 'operationComplete', payload: { operation: 'interactiveRebase', success: true } });
          // A squash routes through this same backend; surface a dedicated
          // confirmation, otherwise a generic one so the rebase never completes
          // silently.
          if (message.payload.squashCount) {
            vscode.window.showInformationMessage(vscode.l10n.t('squashed', String(message.payload.squashCount)));
          } else {
            vscode.window.showInformationMessage(vscode.l10n.t('interactiveRebaseComplete'));
          }
          await this.refreshAll();
          break;
        }
        case 'runClassicRebase': {
          const command = buildClassicRebaseCommand(message.payload.base);
          if (!command) { break; }
          const name = 'Git Graph+ Rebase';
          const terminal =
            vscode.window.terminals.find(t => t.name === name && t.exitStatus === undefined)
            ?? vscode.window.createTerminal({ name, cwd: this.repoPath });
          terminal.show();
          terminal.sendText(command, true);
          break;
        }
        case 'getRebaseCommits': {
          const rebaseCommits = await this.gitService.getRebaseCommits(message.payload.base);
          this.post({ type: 'rebaseCommitsData', payload: { base: message.payload.base, commits: rebaseCommits } });
          break;
        }
        case 'reset': {
          await this.gitService.reset(message.payload.ref, message.payload.mode);
          this.post({ type: 'operationComplete', payload: { operation: 'reset', success: true } });
          vscode.window.showInformationMessage(vscode.l10n.t('resetComplete', message.payload.ref.substring(0, 7)));
          await this.refreshAll();
          break;
        }
        case 'stashSave': {
          const beforeCount = (await this.gitService.stashList()).length;
          await this.gitService.stashSave(message.payload.message, message.payload.includeUntracked, message.payload.keepIndex);
          const afterCount = (await this.gitService.stashList()).length;
          if (afterCount > beforeCount) {
            this.post({ type: 'operationComplete', payload: { operation: 'stashSave', success: true } });
            vscode.window.showInformationMessage(vscode.l10n.t('changesStashed'));
          } else {
            this.post({ type: 'error', payload: { message: vscode.l10n.t('noChangesToStash') } });
          }
          await this.refreshAll();
          break;
        }
        case 'stashApply': {
          if (message.payload.drop) {
            await this.gitService.stashPop(message.payload.index);
          } else {
            await this.gitService.stashApply(message.payload.index);
          }
          this.post({ type: 'operationComplete', payload: { operation: 'stashApply', success: true } });
          vscode.window.showInformationMessage(vscode.l10n.t(message.payload.drop ? 'stashPopped' : 'stashApplied'));
          await this.refreshAll();
          break;
        }
        case 'stashDrop': {
          await this.gitService.stashDrop(message.payload.index);
          this.post({ type: 'operationComplete', payload: { operation: 'stashDrop', success: true } });
          vscode.window.showInformationMessage(vscode.l10n.t('stashDropped'));
          await this.refreshAll();
          break;
        }
        case 'stashRename': {
          await this.gitService.stashRename(message.payload.index, message.payload.message);
          await this.refreshAll();
          break;
        }
        case 'worktreeAddModalRequest': {
          const defaultPath = await resolveDefaultWorktreePath(this.gitService, this.gitService.rootPath);
          this.postShowModal({ modal: 'addWorktree', defaultPath, startPoint: message.payload.startPoint });
          break;
        }
        case 'worktreeAdd': {
          const homeDir = process.env.HOME || process.env.USERPROFILE || '';
          const wtPath = this.assertSafeArgPath(
            message.payload.path.replace(/^~/, homeDir),
            'worktreeAdd',
          );
          await this.gitService.worktreeAdd(wtPath, message.payload.branch, message.payload.newBranch);
          this.post({ type: 'operationComplete', payload: { operation: 'worktreeAdd', success: true } });
          vscode.window.showInformationMessage(vscode.l10n.t('worktreeAdded', message.payload.path));
          await this.refreshAll();
          break;
        }
        case 'worktreeRemove': {
          await this.gitService.worktreeRemove(message.payload.path);
          // Delete linked branch after worktree is removed
          if (message.payload.deleteBranch) {
            await this.gitService.deleteBranch(message.payload.deleteBranch, true);
          }
          this.post({ type: 'operationComplete', payload: { operation: 'worktreeRemove', success: true } });
          vscode.window.showInformationMessage(vscode.l10n.t('worktreeRemoved'));
          await this.refreshAll();
          break;
        }
        case 'openWorktreeInNewWindow': {
          const resolved = this.assertSafeArgPath(
            message.payload.path.replace(/^~/, process.env.HOME || process.env.USERPROFILE || ''),
            'openWorktreeInNewWindow',
          );
          const wtUri = vscode.Uri.file(resolved);
          await vscode.commands.executeCommand('vscode.openFolder', wtUri, true);
          break;
        }
        case 'cherryPick': {
          // `commits` (oldest→newest) carries a multi-commit selection; fall back
          // to the single `commit` for the original single-commit flow.
          const picks = message.payload.commits ?? [message.payload.commit];
          await this.gitService.cherryPick(picks, { noCommit: message.payload.noCommit });
          // Optional follow-up push (only meaningful when a commit was created).
          // A cherry-pick adds a new commit, so the push needs no force.
          let cherryPushFailed = false;
          if (message.payload.pushAfter && !message.payload.noCommit) {
            try {
              await this.gitService.pushCurrentBranch();
            } catch (err) {
              cherryPushFailed = true;
              this.post({ type: 'error', payload: { message: vscode.l10n.t('pushAfterCherryPickFailed', err instanceof Error ? err.message : String(err)) } });
            }
          }
          this.post({ type: 'operationComplete', payload: { operation: 'cherryPick', success: true } });
          const cherryLabel = picks.length > 1
            ? vscode.l10n.t('nCommits', String(picks.length))
            : picks[0].substring(0, 7);
          if (message.payload.pushAfter && !message.payload.noCommit && !cherryPushFailed) {
            vscode.window.showInformationMessage(vscode.l10n.t('cherryPickedAndPushed', cherryLabel));
          } else {
            vscode.window.showInformationMessage(vscode.l10n.t('cherryPicked', cherryLabel));
          }
          await this.refreshAll();
          break;
        }
        case 'revert': {
          await this.gitService.revert(message.payload.commit, { noCommit: message.payload.noCommit });
          // Optional follow-up push (only meaningful when a commit was created).
          // A revert adds a new commit, so the push needs no force.
          let revertPushFailed = false;
          if (message.payload.pushAfter && !message.payload.noCommit) {
            try {
              await this.gitService.pushCurrentBranch();
            } catch (err) {
              revertPushFailed = true;
              this.post({ type: 'error', payload: { message: vscode.l10n.t('pushAfterRevertFailed', err instanceof Error ? err.message : String(err)) } });
            }
          }
          this.post({ type: 'operationComplete', payload: { operation: 'revert', success: true } });
          if (message.payload.pushAfter && !message.payload.noCommit && !revertPushFailed) {
            vscode.window.showInformationMessage(vscode.l10n.t('revertedAndPushed', message.payload.commit.substring(0, 7)));
          } else {
            vscode.window.showInformationMessage(vscode.l10n.t('reverted', message.payload.commit.substring(0, 7)));
          }
          await this.refreshAll();
          break;
        }
        case 'commitFixup': {
          await this.gitService.commitFixup(message.payload.commit);
          this.post({ type: 'operationComplete', payload: { operation: 'commitFixup', success: true } });
          vscode.window.showInformationMessage(vscode.l10n.t('committedFixup', message.payload.commit.substring(0, 7)));
          await this.refreshAll();
          break;
        }
        case 'commitSquash': {
          await this.gitService.commitSquash(message.payload.commit);
          this.post({ type: 'operationComplete', payload: { operation: 'commitSquash', success: true } });
          vscode.window.showInformationMessage(vscode.l10n.t('committedSquash', message.payload.commit.substring(0, 7)));
          await this.refreshAll();
          break;
        }
        case 'createTag': {
          await this.gitService.createTag(message.payload.name, message.payload.ref, message.payload.message);
          this.post({ type: 'operationComplete', payload: { operation: 'createTag', success: true } });
          vscode.window.showInformationMessage(vscode.l10n.t('tagCreated', message.payload.name));
          await this.refreshAll();
          break;
        }
        case 'deleteTag': {
          await this.gitService.deleteTag(message.payload.name);
          this.post({ type: 'operationComplete', payload: { operation: 'deleteTag', success: true } });
          vscode.window.showInformationMessage(vscode.l10n.t('tagDeleted', message.payload.name));
          await this.refreshAll();
          break;
        }
        case 'showTagDetails': {
          const tags = await this.gitService.tags();
          const tag = tags.find(t => t.name === message.payload.name);
          if (tag) {
            this.post({ type: 'tagDetailsData', payload: tag });
          }
          break;
        }
        case 'getCommitData': {
          const commit = await this.gitService.searchByHash(message.payload.hash);
          if (commit) {
            this.post({ type: 'commitData', payload: { commit } });
          }
          break;
        }
        case 'getCommitSignature': {
          const signature = await this.gitService.getCommitSignature(message.payload.hash);
          this.post({ type: 'commitSignatureData', payload: { hash: message.payload.hash, signature } });
          break;
        }
        case 'searchCommits': {
          // searchSequence guards against a stale response overwriting a
          // newer one when the user types fast. Same pattern as getLog.
          const seq = ++this.searchSequence;
          const results = await this.gitService.searchCommits(message.payload.query, {
            author: message.payload.author,
            after: message.payload.after,
            before: message.payload.before,
          });
          if (seq !== this.searchSequence) break;
          this.post({ type: 'searchResults', payload: { commits: results, graph: [] } });
          break;
        }
        case 'searchByHash': {
          const seq = ++this.searchSequence;
          const found = await this.gitService.searchByHash(message.payload.hash);
          if (seq !== this.searchSequence) break;
          this.post({ type: 'searchResults', payload: { commits: found ? [found] : [], graph: [] } });
          break;
        }
        case 'searchByFile': {
          const seq = ++this.searchSequence;
          const results = await this.gitService.searchByFile(message.payload.file);
          if (seq !== this.searchSequence) break;
          this.post({ type: 'searchResults', payload: { commits: results, graph: [] } });
          break;
        }
        case 'getActivityLog': {
          this.post({ type: 'activityLogData', payload: this.gitService.getActivityLog() });
          break;
        }
        case 'getReflog': {
          const result = await this.gitService.getReflog(message.payload?.limit ?? 200, message.payload?.ref ?? 'HEAD');
          this.post({ type: 'reflogData', payload: result });
          break;
        }
        // --- Bisect ---
        case 'bisectStart': {
          const result = await this.gitService.bisectStart(message.payload.bad, message.payload.good);
          this.post({ type: 'operationComplete', payload: { operation: 'bisectStart', success: true } });
          this.post({ type: 'bisectResult', payload: { message: result } });
          await this.refreshAll();
          break;
        }
        case 'bisectGood': {
          const result = await this.gitService.bisectGood(message.payload.ref);
          this.post({ type: 'bisectResult', payload: { message: result } });
          await this.refreshAll();
          break;
        }
        case 'bisectBad': {
          const result = await this.gitService.bisectBad(message.payload.ref);
          this.post({ type: 'bisectResult', payload: { message: result } });
          await this.refreshAll();
          break;
        }
        case 'bisectSkip': {
          const result = await this.gitService.bisectSkip();
          this.post({ type: 'bisectResult', payload: { message: result } });
          await this.refreshAll();
          break;
        }
        case 'bisectReset': {
          await this.gitService.bisectReset();
          this.post({ type: 'operationComplete', payload: { operation: 'bisectReset', success: true } });
          await this.refreshAll();
          break;
        }
        // --- Statistics ---
        case 'getStats': {
          const [byAuthor, byWeekdayHour] = await Promise.all([
            this.gitService.statsCommitsByAuthor(),
            this.gitService.statsCommitsByWeekdayHour(),
          ]);
          this.post({
            type: 'statsData',
            payload: { byAuthor, byWeekdayHour },
          });
          break;
        }
        case 'copyToClipboard': {
          await vscode.env.clipboard.writeText(message.payload.text);
          this.post({ type: 'operationComplete', payload: { operation: 'copied', success: true } });
          break;
        }
        case 'showNotification': {
          vscode.window.showInformationMessage(message.payload.message);
          break;
        }
        case 'saveCommitPatch': {
          const { hash, paths } = message.payload;
          const patch = await this.gitService.formatPatch(hash, paths);
          const isSubset = Array.isArray(paths) && paths.length > 0;
          const fileName = `${hash.substring(0, 7)}${isSubset ? '-partial' : ''}.patch`;
          const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(this.repoPath, fileName)),
            filters: { 'Patch files': ['patch'] },
          });
          if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(patch));
          }
          break;
        }
        case 'restoreStashFiles': {
          const { index, paths: stashPaths } = message.payload;
          await this.gitService.stashRestoreFiles(index, stashPaths);
          this.post({ type: 'operationComplete', payload: { operation: 'restoreStashFiles', success: true } });
          // List up to 3 file names; collapse the rest into a "+N more" suffix
          // so the toast stays a single readable line.
          const MAX_LISTED = 3;
          const names = stashPaths.map(p => path.basename(p));
          let fileList = names.slice(0, MAX_LISTED).join(', ');
          if (names.length > MAX_LISTED) {
            fileList += vscode.l10n.t('stashFilesRestoredMore', String(names.length - MAX_LISTED));
          }
          vscode.window.showInformationMessage(
            vscode.l10n.t('stashFilesRestored', String(stashPaths.length), `stash@{${index}}`, fileList),
          );
          await this.refreshAll();
          break;
        }
        case 'reverseCommitChanges': {
          const { commit, file, hunkIndex, lineIndices } = message.payload;
          await this.gitService.reverseCommitChanges(commit, file, { hunkIndex, lineIndices });
          this.post({ type: 'operationComplete', payload: { operation: 'reverseCommitChanges', success: true } });
          vscode.window.showInformationMessage(vscode.l10n.t('reversedFileChange', path.basename(file)));
          await this.refreshAll();
          break;
        }
        case 'compareToWorking': {
          const [workingDiffs, workingFiles] = await Promise.all([
            this.gitService.diffCommitToWorking(message.payload.hash),
            this.gitService.diffFiles(message.payload.hash),
          ]);
          this.post({ type: 'commitDiffData', payload: { hash: '', diffs: workingDiffs, files: workingFiles } });
          break;
        }
        case 'compareCommits': {
          const [compareDiffs, compareFiles] = await Promise.all([
            this.gitService.diffCommits(message.payload.ref1, message.payload.ref2),
            this.gitService.diffFiles(message.payload.ref1, message.payload.ref2),
          ]);
          this.post({ type: 'commitDiffData', payload: { hash: '', diffs: compareDiffs, files: compareFiles } });
          break;
        }
        // --- File tree at commit ---
        case 'lsTree': {
          const entries = await this.gitService.lsTree(message.payload.ref, message.payload.path);
          this.post({ type: 'lsTreeData', payload: { ref: message.payload.ref, path: message.payload.path, entries } });
          break;
        }
        // --- Git Flow ---
        case 'checkFlowStatus': {
          const installed = await this.gitService.isFlowInstalled();
          let initialized = false;
          let config = null;
          if (installed) {
            initialized = await this.gitService.isFlowInitialized();
            if (initialized) {
              config = await this.gitService.getFlowConfig();
            }
          }
          this.post({ type: 'flowStatus', payload: { installed, initialized, config } });
          break;
        }
        case 'flowInit': {
          await this.gitService.flowInit(message.payload);
          this.post({ type: 'operationComplete', payload: { operation: 'flowInit', success: true } });
          await this.refreshAll();
          break;
        }
        case 'flowAction': {
          const { flowType, action, name } = message.payload;
          if (action === 'start') {
            if (flowType === 'feature') await this.gitService.flowFeatureStart(name);
            else if (flowType === 'release') await this.gitService.flowReleaseStart(name);
            else if (flowType === 'hotfix') await this.gitService.flowHotfixStart(name);
            else throw new Error(`Unknown flow type: ${flowType}`);
          } else if (action === 'finish') {
            if (flowType === 'feature') await this.gitService.flowFeatureFinish(name);
            else if (flowType === 'release') await this.gitService.flowReleaseFinish(name);
            else if (flowType === 'hotfix') await this.gitService.flowHotfixFinish(name);
            else throw new Error(`Unknown flow type: ${flowType}`);
          } else {
            throw new Error(`Unknown flow action: ${action}`);
          }
          this.post({ type: 'operationComplete', payload: { operation: `flow-${action}`, success: true } });
          await this.refreshAll();
          break;
        }
        case 'getFlowBranches': {
          const branches = await this.gitService.getFlowBranches();
          this.post({ type: 'flowBranches', payload: branches });
          break;
        }
        case 'getDefaultBranch': {
          const name = await this.gitService.defaultBranch();
          this.post({ type: 'defaultBranch', payload: { name } });
          break;
        }
        // --- Submodule ---
        case 'getSubmodules': {
          const submodules = await this.gitService.submoduleStatus();
          this.post({ type: 'submoduleData', payload: submodules });
          break;
        }
        case 'submoduleUpdate': {
          await this.gitService.submoduleUpdate(true);
          this.post({ type: 'operationComplete', payload: { operation: 'submoduleUpdate', success: true } });
          break;
        }
        // --- LFS ---
        case 'getLfsFiles': {
          const lfsFiles = await this.gitService.lfsLsFiles();
          const lfsLocks = await this.gitService.lfsLocks();
          this.post({ type: 'lfsData', payload: { files: lfsFiles, locks: lfsLocks } });
          break;
        }
        case 'lfsLock': {
          await this.gitService.lfsLock(message.payload.file);
          this.post({ type: 'operationComplete', payload: { operation: 'lfsLock', success: true } });
          // Refresh LFS data
          const lfsFiles = await this.gitService.lfsLsFiles();
          const lfsLocks = await this.gitService.lfsLocks();
          this.post({ type: 'lfsData', payload: { files: lfsFiles, locks: lfsLocks } });
          break;
        }
        case 'lfsUnlock': {
          await this.gitService.lfsUnlock(message.payload.file, message.payload.force);
          this.post({ type: 'operationComplete', payload: { operation: 'lfsUnlock', success: true } });
          // Refresh LFS data
          const lfsFiles2 = await this.gitService.lfsLsFiles();
          const lfsLocks2 = await this.gitService.lfsLocks();
          this.post({ type: 'lfsData', payload: { files: lfsFiles2, locks: lfsLocks2 } });
          break;
        }
        // --- Worktree ---
        case 'getWorktrees': {
          const worktrees = await this.gitService.worktreeList();
          this.post({ type: 'worktreeData', payload: worktrees });
          break;
        }
        case 'pruneWorktrees': {
          await this.gitService.worktreePrune();
          this.post({ type: 'operationComplete', payload: { operation: 'pruneWorktrees', success: true } });
          await this.refreshAll();
          break;
        }
        // --- Tag Push ---
        case 'pushTag': {
          if (message.payload.remote) {
            await this.gitService.pushTag(message.payload.name, message.payload.remote);
          } else {
            await this.gitService.pushTagToAllRemotes(message.payload.name);
          }
          this.post({ type: 'operationComplete', payload: { operation: 'pushTag', success: true } });
          break;
        }
        case 'pushAllTags': {
          await this.gitService.pushAllTags(message.payload.remote);
          this.post({ type: 'operationComplete', payload: { operation: 'pushAllTags', success: true } });
          break;
        }
        case 'deleteRemoteTag': {
          if (message.payload.remote) {
            await this.gitService.deleteRemoteTag(message.payload.name, message.payload.remote);
          } else {
            await this.gitService.deleteTagFromAllRemotes(message.payload.name);
          }
          this.post({ type: 'operationComplete', payload: { operation: 'deleteRemoteTag', success: true } });
          await this.refreshAll();
          break;
        }
        // --- Avatar (cached in the extension host; see AvatarCache) ---
        case 'getAvatar': {
          const { email, size, generation } = message.payload;
          const dataUri = await MainPanel.getAvatarCache().get(email, size);
          this.post({ type: 'avatarData', payload: { email, size, dataUri, generation } });
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
            this.post({
              type: 'imageData',
              payload: { ref, path: filePath, base64, mimeType },
            });
          } catch {
            this.post({
              type: 'imageData',
              payload: { ref, path: filePath, base64: '', mimeType },
            });
          }
          break;
        }
        // --- Repo Switch ---
        case 'switchRepo': {
          const newPath = message.payload.path;
          // Constrain to repos we discovered for the workspace. Without this
          // guard the webview could point the extension at any directory on
          // disk and every subsequent git command would run there.
          if (typeof newPath !== 'string' || newPath.length === 0) {
            throw new Error('Invalid path for switchRepo');
          }
          const allowed = this.cachedRepos.some(r => r.path === newPath);
          if (!allowed) {
            throw new Error(`Repo not in discovered list: ${newPath}`);
          }
          this.swapRepo(newPath);

          // Update repo list in webview with cached repos but new active path.
          // Send this BEFORE refreshAll so the dropdown updates instantly.
          this.post({
            type: 'repoList',
            payload: { repos: this.cachedRepos, active: this.repoPath },
          });

          await this.refreshAll();
          break;
        }
        case 'stageFile': {
          await this.gitService.stageFile(message.payload.file);
          // Refresh conflict status after staging
          if (this.allConflictFiles.length > 0) {
            const [stillConflicting, opState] = await Promise.all([
              this.gitService.getConflictFiles(),
              this.gitService.getOperationState(),
            ]);
            const conflictSet = new Set(stillConflicting);
            if (opState.type) {
              this.post({
                type: 'conflictData',
                payload: {
                  operation: opState.type,
                  files: this.allConflictFiles.map(f => ({ path: f, resolved: !conflictSet.has(f) })),
                },
              });
            }
          }
          break;
        }
        case 'refreshConflicts': {
          if (this.allConflictFiles.length > 0) {
            const [stillConflicting, opState] = await Promise.all([
              this.gitService.getConflictFiles(),
              this.gitService.getOperationState(),
            ]);
            const conflictSet = new Set(stillConflicting);
            if (opState.type) {
              this.post({
                type: 'conflictData',
                payload: {
                  operation: opState.type,
                  files: this.allConflictFiles.map(f => ({ path: f, resolved: !conflictSet.has(f) })),
                },
              });
            }
          }
          break;
        }
        case 'continueOperation': {
          await this.gitService.continueOperation();
          this.post({ type: 'operationComplete', payload: { operation: 'continue', success: true } });
          await this.refreshAll();
          break;
        }
        case 'abortOperation': {
          await this.gitService.abortOperation();
          this.post({ type: 'operationComplete', payload: { operation: 'abort', success: true } });
          await this.refreshAll();
          break;
        }
        case 'openConflictFile': {
          const fullPath = this.resolveRepoRelativePath(message.payload.file, 'openConflictFile');
          const fileUri = vscode.Uri.file(fullPath);
          // Try to open in VS Code's 3-way merge editor, fallback to normal editor
          try {
            await vscode.commands.executeCommand('git.openMergeEditor', fileUri);
          } catch {
            await vscode.window.showTextDocument(fileUri);
          }
          break;
        }
        default:
          break;
      }
    } catch (err: unknown) {
      // Use stderr directly for GitError (cleaner than the full "git xxx failed (exit N): ..." message)
      const errorMessage = err instanceof GitError ? formatGitError(err.stderr) : err instanceof Error ? err.message : String(err);

      // Detect non-git-repo errors early to avoid unnecessary follow-up git calls
      if (err instanceof GitError && /not a git repository/.test(err.stderr)) {
        this.post({ type: 'notGitRepo' });
        return;
      }

      // Detect authentication errors and show a helpful message
      if (err instanceof GitError && isAuthFailure(err.stderr)) {
        let remoteUrl = '';
        try {
          remoteUrl = await this.gitService.getRemoteUrl('origin');
        } catch { /* ignore */ }

        const transport = transportFromRemoteUrl(remoteUrl);

        let msg: string;
        let hint: string;
        if (transport === 'ssh') {
          msg = vscode.l10n.t('SSH authentication failed. Check that your SSH key is configured correctly.');
          hint = 'ssh-add ~/.ssh/id_ed25519  (or your key path)';
        } else if (transport === 'https') {
          msg = vscode.l10n.t('HTTPS authentication failed. Your credentials may have expired.');
          hint = 'gh auth login  (or reconfigure your credential helper)';
        } else {
          msg = vscode.l10n.t('Authentication required. Please configure your Git credentials.');
          hint = '';
        }

        const detail = err.stderr.trim().split('\n')[0];
        this.post({ type: 'error', payload: { message: msg } });

        const action = await vscode.window.showErrorMessage(
          `${msg}${hint ? `\n→ ${hint}` : ''}`,
          { detail, modal: false },
          vscode.l10n.t('Open Terminal'),
          vscode.l10n.t('Show Error'),
        );
        if (action === vscode.l10n.t('Open Terminal')) {
          vscode.commands.executeCommand('workbench.action.terminal.new');
        } else if (action === vscode.l10n.t('Show Error')) {
          vscode.window.showErrorMessage(err.stderr.trim());
        }
        return;
      }

      // Check if this is a merge/rebase conflict
      const conflictFiles = await this.gitService.getConflictFiles();
      if (conflictFiles.length > 0) {
        this.allConflictFiles = conflictFiles;
        const opState = await this.gitService.getOperationState();
        this.post({
          type: 'conflictData',
          payload: { operation: (opState.type === 'squash' ? 'merge' : opState.type) ?? 'merge', files: conflictFiles.map(f => ({ path: f, resolved: false })) },
        });
        // If we entered the catch with an existing conflict (e.g. stageFile / refreshConflicts
        // failed while in a paused merge), still surface the underlying error — otherwise
        // the failure is invisible because the conflict UI just re-renders unchanged.
        if (message.type === 'stageFile' || message.type === 'refreshConflicts') {
          this.post({
            type: 'error',
            payload: { message: errorMessage, source: message.type },
          });
        }
        // Focus the Source Control sidebar so the user can resolve conflicts
        vscode.commands.executeCommand('workbench.view.scm');
        await this.refreshAll();
      } else {
        this.post({
          type: 'error',
          payload: { message: errorMessage, source: message.type },
        });
      }
    }
  }

  /**
   * Builds a `git:`-scheme URI in the exact format VS Code's built-in Git
   * extension understands (mirrors its internal `toGitUri`). Using the standard
   * scheme — rather than our own provider — lets the built-in content provider
   * serve the blob and, crucially, lets markdown-diff tooling recognise the
   * comparison: "Reopen editor with…" and extensions like `mddiff` only handle
   * the `git:` scheme. (#51)
   *
   * ref conventions match the built-in extension: '' → index (stage 0),
   * 'HEAD'/<sha>/<sha>~1 → that revision (`git show <ref>:<path>`). The query
   * `path` is the absolute fsPath; the URI path keeps the file extension so the
   * editor still infers the language.
   */
  private toGitUri(fullPath: string, ref: string): vscode.Uri {
    const fileUri = vscode.Uri.file(fullPath);
    return fileUri.with({
      scheme: 'git',
      query: JSON.stringify({ path: fileUri.fsPath, ref }),
    });
  }

  /**
   * Build a `git:` diff URI for `file` at `ref`, falling back to the empty tree
   * when the file doesn't exist there. A file added or deleted across a diff is
   * absent on one side; the built-in git content provider renders a missing
   * file as empty content *only* for the empty-tree ref and throws
   * `FileNotFound` (surfaced as "cannot open editor, file not found") for any
   * other ref. `ref === ''` is the index.
   */
  private async toGitDiffUri(fullPath: string, file: string, ref: string): Promise<vscode.Uri> {
    const usableRef = (await this.gitService.fileExistsAtRef(ref, file))
      ? ref
      : await this.gitService.getEmptyTreeRef();
    return this.toGitUri(fullPath, usableRef);
  }

  /** The working-tree file URI, or an empty `git:` URI when the file is gone
   *  from disk (e.g. an unstaged deletion) so the diff renders it as removed. */
  private async workingTreeDiffUri(fullPath: string): Promise<vscode.Uri> {
    try {
      await access(fullPath);
      return vscode.Uri.file(fullPath);
    } catch {
      return this.toGitUri(fullPath, await this.gitService.getEmptyTreeRef());
    }
  }

  private async openDiffInEditor(
    file: string,
    staged?: boolean,
    commitHash?: string,
  ): Promise<void> {
    // Validate that the webview-supplied path stays inside the repo before
    // we feed it to vscode.diff / build URIs. resolveRepoRelativePath throws
    // on traversal (`../etc/passwd`) and absolute paths.
    const fullPath = this.resolveRepoRelativePath(file, 'openDiff');

    if (commitHash) {
      // Commit diff: parent vs commit. Resolve the parent to a full SHA — the
      // `<sha>~1` shorthand isn't understood by markdown-diff tooling (#51).
      const parentRef = await this.gitService.resolveDiffBaseRef(commitHash);
      const leftUri = await this.toGitDiffUri(fullPath, file, parentRef);
      const rightUri = await this.toGitDiffUri(fullPath, file, commitHash);
      const title = `${file} (${commitHash.substring(0, 7)})`;
      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    } else if (staged) {
      // Staged diff: HEAD vs index.
      const leftUri = await this.toGitDiffUri(fullPath, file, 'HEAD');
      const rightUri = await this.toGitDiffUri(fullPath, file, '');
      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${file} (Staged)`);
    } else {
      // Unstaged diff: index vs working tree.
      const leftUri = await this.toGitDiffUri(fullPath, file, '');
      const rightUri = await this.workingTreeDiffUri(fullPath);
      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${file} (Working Tree)`);
    }
  }

  private async openCompareDiffInEditor(file: string, ref1: string, ref2: string): Promise<void> {
    // Same validation as openDiffInEditor — the path must stay inside the repo
    // before being embedded in the diff editor and the content-provider URI.
    const fullPath = this.resolveRepoRelativePath(file, 'openCompareDiff');
    // ref1 = 'working' means compare ref2 against working tree
    if (ref1 === 'working' || ref2 === 'working') {
      const commitRef = ref1 === 'working' ? ref2 : ref1;
      const commitUri = await this.toGitDiffUri(fullPath, file, commitRef);
      const workingUri = await this.workingTreeDiffUri(fullPath);
      await vscode.commands.executeCommand('vscode.diff', commitUri, workingUri, `${file} (${commitRef.substring(0, 7)} ↔ Working Tree)`);
    } else {
      const leftUri = await this.toGitDiffUri(fullPath, file, ref1);
      const rightUri = await this.toGitDiffUri(fullPath, file, ref2);
      const label1 = ref1.length > 10 ? ref1.substring(0, 7) : ref1;
      const label2 = ref2.length > 10 ? ref2.substring(0, 7) : ref2;
      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${file} (${label1} ↔ ${label2})`);
    }
  }

  private refreshing = false;
  private refreshQueued = false;
  // Scope of a refresh coalesced while another was in flight. 'full' wins over
  // 'status' so a branch/ref change never gets downgraded to a log-only update.
  private queuedScope: 'full' | 'status' = 'status';

  /**
   * @param scope 'full' (default) reloads the graph plus all ref data
   *   (branches/tags/remotes/stashes/worktrees) and the sidebar. 'status' is a
   *   working-tree/index edit: refs are unchanged, so it reloads only the log
   *   (for the uncommitted summary row) — skipping four git spawns and the
   *   sidebar refresh — and sends a logData message that leaves branchData as-is.
   */
  private async refreshAll(scope: 'full' | 'status' = 'full'): Promise<void> {
    if (this.refreshing) {
      this.refreshQueued = true;
      if (scope === 'full') this.queuedScope = 'full';
      return;
    }
    this.refreshing = true;
    this.refreshQueued = false;
    // Watcher events caused by the same git operation that triggered this refresh
    // would arrive ~immediately after; absorb them so they don't fire a second pass.
    this.fileWatcher.suppress();
    try {
      const refreshCfg = vscode.workspace.getConfiguration('gitGraphPlus');
      const sortOrder = refreshCfg.get<'author-date' | 'date' | 'topological'>('graphSortOrder', 'topological');
      const includeSignature = refreshCfg.get<boolean>('showSignatureStatus', true);
      const refreshLimit = this.currentLimit || readInitialCommitCount();
      // Until the webview's first getLog establishes this session's filter,
      // mirror the saved filter that getLog will apply (same logic as the
      // getLog handler). Otherwise an early refresh — triggered by the file
      // watcher, a repo auto-switch, or a config change before that first
      // getLog — renders the full *unfiltered* graph (all branches/remotes),
      // which the filtered getLog then corrects: a visible flash of a tangled,
      // repo-unrelated "demo"-looking graph.
      const remoteFilter = this.isFirstGetLog ? MainPanel.savedRemoteFilter : this.currentRemoteFilter;
      const branchFilter = this.isFirstGetLog ? MainPanel.savedBranchFilter : this.currentBranchFilter;
      const logArgs = { limit: refreshLimit + 1, sortOrder, remoteFilter, branches: branchFilter, includeSignature };

      const buildLogData = (allFetched: Awaited<ReturnType<typeof this.gitService.log>>, branches: Awaited<ReturnType<typeof this.gitService.branches>>) => {
        const hasMore = allFetched.length > refreshLimit;
        const allCommits = hasMore ? allFetched.slice(0, refreshLimit) : allFetched;
        // Handle empty repository (0 commits) gracefully. The webview renders from
        // paths/links/dots; the legacy GraphNode[] is unused so we don't build it.
        const fg = allCommits.length > 0 ? buildFullGraph(allCommits, branches, this.makeBranchColorResolver()) : { paths: [], links: [], dots: [], commitLeftMargin: [] };
        return { commits: allCommits, hasMore, currentLimit: this.currentLimit, graph: [], paths: fg.paths, links: fg.links, dots: fg.dots, commitLeftMargin: fg.commitLeftMargin, remoteFilter, branches: branchFilter };
      };

      if (scope === 'status') {
        // branches is still needed to colour the graph, but the rest of the ref
        // data and the sidebar can't have changed from a working-tree edit.
        const [allFetched, branches] = await Promise.all([
          this.gitService.log(logArgs),
          this.gitService.branches(),
        ]);
        this.post({ type: 'logData', payload: buildLogData(allFetched, branches) });
      } else {
        const [allFetched, branches, tags, remotes, stashes, worktrees] = await Promise.all([
          this.gitService.log(logArgs),
          this.gitService.branches(),
          this.gitService.tags(),
          this.gitService.remotes(),
          this.gitService.stashList(),
          this.gitService.worktreeList(),
        ]);
        // Send as single combined message to ensure atomic update
        this.post({
          type: 'fullRefresh',
          payload: {
            logData: buildLogData(allFetched, branches),
            branchData: { branches, tags, remotes, stashes, worktrees },
          },
        });
        MainPanel.onSidebarRefresh?.();
      }
    } catch (err) {
      console.warn('Git Graph+: refresh failed:', err instanceof Error ? err.message : err);
      if (err instanceof GitError && /not a git repository/.test(err.stderr)) {
        try { this.post({ type: 'notGitRepo' }); } catch { /* panel disposed */ }
      }
    } finally {
      this.refreshing = false;
      if (this.refreshQueued) {
        this.refreshQueued = false;
        const next = this.queuedScope;
        this.queuedScope = 'status';
        this.refreshAll(next);
      }
    }
  }

  private repoListPending: Promise<void> | null = null;

  public sendRepoList(forceDiscovery = false): Promise<void> {
    // Deduplicate concurrent calls
    if (!this.repoListPending) {
      this.repoListPending = this.doSendRepoList(forceDiscovery).finally(() => { this.repoListPending = null; });
    }
    return this.repoListPending;
  }

  private async doSendRepoList(forceDiscovery = false): Promise<void> {
    try {
      if (forceDiscovery) {
        RepoDiscoveryService.clearCache();
      }
      const workspacePaths = new Set<string>();
      for (const f of vscode.workspace.workspaceFolders ?? []) {
        workspacePaths.add(f.uri.fsPath);
      }
      workspacePaths.add(this.repoPath);
      const discovered = await RepoDiscoveryService.discoverRepos([...workspacePaths]);
      // Canonicalize every path to VS Code's fsPath so the repo list and the
      // active path share one format. `git rev-parse --show-toplevel` returns
      // forward slashes (and a lowercase drive on Windows) while VS Code paths
      // use backslashes; without this the membership check below — and the
      // webview's dropdown lookup — fail to match and fall back to repos[0].
      // See issue #30.
      const repos = discovered.map(r => ({ ...r, path: vscode.Uri.file(r.path).fsPath }));
      this.cachedRepos = repos;

      let active = vscode.Uri.file(this.repoPath).fsPath;
      this.repoPath = active;
      if (repos.length > 0 && !repos.some(r => r.path === active)) {
        // Current path is not a repo, switch to the first discovered one
        active = repos[0].path;
        this.swapRepo(active);

        // Full refresh of the graph
        this.refreshAll();
      }

      this.post({
        type: 'repoList',
        payload: { repos, active },
      });
    } catch {
      // ignore
    }
  }

  private async onRepoChanged(what: string): Promise<void> {
    this.post({
      type: 'repoChanged',
      payload: { what },
    });

    if (shouldRefreshGraph(what)) {
      // A pure working-tree/index edit ('status') only affects the log's
      // uncommitted row — refs, remotes and the sidebar are untouched — so do a
      // log-only partial refresh. 'unknown' stays full to be safe.
      await this.refreshAll(what === 'status' ? 'status' : 'full');
    }
    // Commit-link rules derive from the remote URL, which a working-tree edit
    // can't change; only re-derive on ref/config-level changes.
    if (what !== 'status') void this.postCommitLinkRules();

    // Skip the conflict + operation state probe (2 git subprocess spawns)
    // when we already know no operation is in progress: nothing in memory
    // says we have unresolved conflicts, and none of the on-disk markers
    // (MERGE_HEAD / REBASE_HEAD / CHERRY_PICK_HEAD / REVERT_HEAD) exist.
    // For pure working-tree edits the watcher fires often; this avoids
    // spawning two git processes for every keystroke.
    if (this.allConflictFiles.length === 0) {
      // For linked worktrees, `.git` is a *file* and these markers live in
      // the worktree's resolved gitdir. Using `<repo>/.git/MERGE_HEAD`
      // unconditionally would suppress the conflict UI inside a worktree
      // even when a real merge / rebase is in progress.
      const gitDir = resolveGitDirs(this.repoPath).gitDir;
      const markers = ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];
      const anyMarker = (await Promise.all(markers.map(m =>
        access(path.join(gitDir, m)).then(() => true).catch(() => false),
      ))).some(Boolean);
      if (!anyMarker) return;
    }

    // Detect conflict state (from external terminal operations or index changes)
    const conflictFiles = await this.gitService.getConflictFiles();
    const opState = await this.gitService.getOperationState();

    if (conflictFiles.length > 0 && opState.type) {
      // New or updated conflict (merge/rebase started externally or in-progress)
      if (this.allConflictFiles.length === 0) {
        this.allConflictFiles = conflictFiles;
      }
      const conflictSet = new Set(conflictFiles);
      this.post({
        type: 'conflictData',
        payload: {
          operation: opState.type,
          files: this.allConflictFiles.map(f => ({ path: f, resolved: !conflictSet.has(f) })),
        },
      });
    } else if (conflictFiles.length === 0 && opState.type === 'rebase') {
      // Same worktree concern as the marker check above — rebase-merge state
      // lives in the per-worktree gitdir.
      const gitDir = resolveGitDirs(this.repoPath).gitDir;
      const stoppedShaPath = path.join(gitDir, 'rebase-merge', 'stopped-sha');
      const editPaused = await access(stoppedShaPath).then(() => true).catch(() => false);
      if (editPaused) {
        this.post({
          type: 'operationPaused',
          payload: { operation: 'rebase' },
        });
      }
    } else if (this.allConflictFiles.length > 0 && !opState.type) {
      // Operation was completed or aborted externally - notify webview to dismiss conflict UI
      this.allConflictFiles = [];
      this.post({
        type: 'operationComplete',
        payload: { operation: 'merge', success: true },
      });
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
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
    this.disposed = true;
    MainPanel.savedRemoteFilter = this.currentRemoteFilter;
    MainPanel.savedBranchFilter = this.currentBranchFilter;
    // Drop any modal request that was queued for this panel but never delivered
    // (panel closed before the webview was ready). A fresh panel opened later
    // for an unrelated reason should not surface a stale modal.
    MainPanel.pendingModal = null;
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
