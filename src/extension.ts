import * as vscode from 'vscode';
import { MainPanel } from './panels/MainPanel';
import { GitContentProvider } from './services/git-content-provider';
import { GitService } from './git/git-service';
import { FileWatcher } from './services/file-watcher';
import { BranchesViewProvider } from './views/branches-view';
import { RemotesViewProvider } from './views/remotes-view';
import { TagsViewProvider } from './views/tags-view';
import { StashesViewProvider } from './views/stashes-view';
import { WorktreesViewProvider } from './views/worktrees-view';
import { StatusBarManager } from './views/status-bar';
import { RepoDiscoveryService } from './services/repo-discovery';

export function activate(context: vscode.ExtensionContext) {
  // Status bar is always visible regardless of workspace state
  const statusBar = new StatusBarManager();
  context.subscriptions.push(statusBar);

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }

  const repoPath = workspaceFolder.uri.fsPath;
  const gitService = new GitService(repoPath);

  // Inject VS Code's built-in git extension askpass env so authentication prompts work
  const builtinGit = vscode.extensions.getExtension('vscode.git');
  if (builtinGit) {
    const waitForGit = builtinGit.isActive ? Promise.resolve(builtinGit.exports) : Promise.resolve(builtinGit.activate());
    waitForGit.then((ext: { getAPI(version: number): { git: { env?: Record<string, string> } } }) => {
      try {
        const env = ext.getAPI(1)?.git?.env;
        if (env) { gitService.setExtraEnv(env); }
      } catch { /* built-in git extension API unavailable */ }
    }).catch(() => {});
  }

  // --- Content Provider for diff URIs ---
  const contentProvider = new GitContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('git-graph-plus', contentProvider)
  );

  // --- Tree View Providers ---
  const branchesProvider = new BranchesViewProvider(gitService);
  const remotesProvider = new RemotesViewProvider(gitService);
  const tagsProvider = new TagsViewProvider(gitService);
  const stashesProvider = new StashesViewProvider(gitService);
  const worktreesProvider = new WorktreesViewProvider(gitService);

  context.subscriptions.push(
    branchesProvider,
    remotesProvider,
    tagsProvider,
    stashesProvider,
    worktreesProvider,
    vscode.window.createTreeView('gitGraphPlus.branches', { treeDataProvider: branchesProvider }),
    vscode.window.createTreeView('gitGraphPlus.remotes', { treeDataProvider: remotesProvider }),
    vscode.window.createTreeView('gitGraphPlus.tags', { treeDataProvider: tagsProvider }),
    vscode.window.createTreeView('gitGraphPlus.stashes', { treeDataProvider: stashesProvider }),
    vscode.window.createTreeView('gitGraphPlus.worktrees', { treeDataProvider: worktreesProvider }),
  );

  // Prefetch all tree view data in parallel so first expand is instant
  Promise.all([
    branchesProvider.prefetch(),
    remotesProvider.prefetch(),
    tagsProvider.prefetch(),
    stashesProvider.prefetch(),
    worktreesProvider.prefetch(),
  ]).catch(() => {});

  // --- File Watcher ---
  const fileWatcher = new FileWatcher(repoPath, () => {
    refreshAll();
  });
  fileWatcher.enabled = vscode.workspace.getConfiguration('gitGraphPlus').get<boolean>('autoRefresh', true);
  context.subscriptions.push(fileWatcher);

  let sidebarRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  function refreshAll() {
    if (sidebarRefreshTimer) { clearTimeout(sidebarRefreshTimer); }
    sidebarRefreshTimer = setTimeout(() => {
      sidebarRefreshTimer = null;
      branchesProvider.refresh();
      remotesProvider.refresh();
      tagsProvider.refresh();
      stashesProvider.refresh();
      worktreesProvider.refresh();
    }, 300);
  }

  MainPanel.onSidebarRefresh = refreshAll;

  // --- Auto Fetch ---
  let bgFetching = false;
  let bgFetchTimer: ReturnType<typeof setInterval> | null = null;

  function startAutoFetch() {
    stopAutoFetch();
    const config = vscode.workspace.getConfiguration('gitGraphPlus');
    const enabled = config.get<boolean>('autoFetch', true);
    if (!enabled) { return; }
    const minutes = config.get<number>('autoFetchInterval', 10);
    bgFetchTimer = setInterval(async () => {
      if (bgFetching) { return; }
      bgFetching = true;
      try {
        await gitService.fetch(undefined, { prune: true });
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
      } catch (err) {
        console.warn('Git Graph+: auto fetch failed:', err);
      } finally {
        bgFetching = false;
      }
    }, minutes * 60 * 1000);
  }

  function stopAutoFetch() {
    if (bgFetchTimer) { clearInterval(bgFetchTimer); bgFetchTimer = null; }
  }

  startAutoFetch();
  context.subscriptions.push(
    { dispose: () => stopAutoFetch() },
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('gitGraphPlus.autoFetch') || e.affectsConfiguration('gitGraphPlus.autoFetchInterval')) {
        startAutoFetch();
      }
      if (e.affectsConfiguration('gitGraphPlus.autoRefresh')) {
        fileWatcher.enabled = vscode.workspace.getConfiguration('gitGraphPlus').get<boolean>('autoRefresh', true);
      }
    }),
  );

  // --- Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand('gitGraphPlus.open', () => {
      MainPanel.createOrShow(context.extensionUri);
    }),

    vscode.commands.registerCommand('gitGraphPlus.refresh', () => {
      refreshAll();
      MainPanel.currentPanel?.postRefresh();
    }),

    vscode.commands.registerCommand('gitGraphPlus.fetch', () => {
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'fetch' });
    }),

    vscode.commands.registerCommand('gitGraphPlus.pull', () => {
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'pull' });
    }),

    vscode.commands.registerCommand('gitGraphPlus.push', () => {
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'push' });
    }),

    vscode.commands.registerCommand('gitGraphPlus.publishBranch', () => {
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'push' });
    }),

    vscode.commands.registerCommand('gitGraphPlus.checkoutBranch', async (refOrItem: string | any) => {
      const ref = typeof refOrItem === 'string' ? refOrItem : refOrItem?.branch?.name;
      if (!ref) { return; }
      try {
        const isRemote = await gitService.isRemoteBranch(ref);
        if (isRemote) {
          const slashIndex = ref.indexOf('/');
          const localName = ref.substring(slashIndex + 1);
          MainPanel.showModalWithPanel(context.extensionUri, { modal: 'checkoutRemote', remoteName: ref, localName });
        } else {
          await gitService.checkout(ref);
          refreshAll();
          MainPanel.currentPanel?.postRefresh();
        }
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('checkoutFailed', err instanceof Error ? err.message : String(err)));
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.mergeBranch', async (branchItem?: any) => {
      const branchName = branchItem?.branch?.name;
      if (!branchName) { return; }

      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'mergeBranch', branchName });
    }),

    vscode.commands.registerCommand('gitGraphPlus.stashPop', async (stashItem?: any) => {
      const index = stashItem?.stash?.index;
      if (index === undefined) { return; }

      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'stashPop', index, message: stashItem?.stash?.message ?? `stash@{${index}}` });
    }),

    vscode.commands.registerCommand('gitGraphPlus.createBranch', async () => {
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'createBranch' });
    }),

    vscode.commands.registerCommand('gitGraphPlus.stashSave', async () => {
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'stashSave' });
    }),

    vscode.commands.registerCommand('gitGraphPlus.createTag', async () => {
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'createTag' });
    }),

    // --- Tag Push Commands ---
    vscode.commands.registerCommand('gitGraphPlus.pushTag', async (tagItem?: any) => {
      const tagName = tagItem?.tag?.name;
      if (!tagName) { return; }

      try {
        const remotes = await gitService.remotes();
        if (remotes.length === 0) {
          vscode.window.showErrorMessage(vscode.l10n.t('noRemotes'));
          return;
        }
        let remote = remotes[0].name;
        if (remotes.length > 1) {
          const picked = await vscode.window.showQuickPick(
            remotes.map(r => r.name),
            { placeHolder: vscode.l10n.t('selectRemote') }
          );
          if (!picked) { return; }
          remote = picked;
        } else if (remotes.length === 1) {
          remote = remotes[0].name;
        }
        await gitService.pushTag(tagName, remote);
        vscode.window.showInformationMessage(vscode.l10n.t('tagPushed', tagName, remote));
        refreshAll();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('pushTagFailed', err instanceof Error ? err.message : String(err)));
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.pushAllTags', async () => {
      try {
        const remotes = await gitService.remotes();
        if (remotes.length === 0) {
          vscode.window.showErrorMessage(vscode.l10n.t('noRemotes'));
          return;
        }
        let remote = remotes[0].name;
        if (remotes.length > 1) {
          const picked = await vscode.window.showQuickPick(
            remotes.map(r => r.name),
            { placeHolder: vscode.l10n.t('selectRemoteForAllTags') }
          );
          if (!picked) { return; }
          remote = picked;
        } else if (remotes.length === 1) {
          remote = remotes[0].name;
        }
        await gitService.pushAllTags(remote);
        vscode.window.showInformationMessage(vscode.l10n.t('allTagsPushed', remote));
        refreshAll();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('pushAllTagsFailed', err instanceof Error ? err.message : String(err)));
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.deleteRemoteTag', async (tagItem?: any) => {
      const tagName = tagItem?.tag?.name;
      if (!tagName) { return; }

      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'deleteRemoteTag', tagName });
    }),

    vscode.commands.registerCommand('gitGraphPlus.deleteBranch', async (branchItem?: any) => {
      const branchName = branchItem?.branch?.name;
      if (!branchName) { return; }

      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'deleteBranch', branchName });
    }),

    vscode.commands.registerCommand('gitGraphPlus.renameBranch', async (branchItem?: any) => {
      const oldName = branchItem?.branch?.name;
      if (!oldName) { return; }

      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'renameBranch', branchName: oldName });
    }),

    vscode.commands.registerCommand('gitGraphPlus.deleteTag', async (tagItem?: any) => {
      const tagName = tagItem?.tag?.name;
      if (!tagName) { return; }

      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'deleteTag', tagName });
    }),

    vscode.commands.registerCommand('gitGraphPlus.stashApply', async (stashItem?: any) => {
      const index = stashItem?.stash?.index;
      if (index === undefined) { return; }

      try {
        await gitService.stashApply(index);
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('stashApplyFailed', err instanceof Error ? err.message : String(err)));
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.stashDrop', async (stashItem?: any) => {
      const index = stashItem?.stash?.index;
      if (index === undefined) { return; }

      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'stashDrop', index, message: stashItem?.stash?.message ?? `stash@{${index}}` });
    }),

    vscode.commands.registerCommand('gitGraphPlus.addWorktree', async () => {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      const defaultPath = `${repoPath}-worktrees/`.replace(homeDir, '~');
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'addWorktree', defaultPath });
    }),

    vscode.commands.registerCommand('gitGraphPlus.pruneWorktrees', async () => {
      try {
        await gitService.worktreePrune();
        worktreesProvider.refresh();
        vscode.window.showInformationMessage(vscode.l10n.t('worktreesPruned'));
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('pruneWorktreesFailed', err instanceof Error ? err.message : String(err)));
      }
    }),

    // --- Quick Menu Commands (triggered on tree item click) ---
    vscode.commands.registerCommand('gitGraphPlus.showBranchMenu', async (branchItem?: any) => {
      const branch = branchItem?.branch;
      if (!branch) { return; }
      const isCurrent = branch.current;

      const items: vscode.QuickPickItem[] = [
        { label: '$(git-branch) Checkout', description: branch.name },
        { label: '$(git-merge) Merge into current branch', description: branch.name },
        { label: '$(edit) Rename', description: branch.name },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(trash) Delete', description: branch.name },
      ];

      const pick = await vscode.window.showQuickPick(items, { placeHolder: branch.name });
      if (!pick) { return; }

      if (pick.label.includes('Checkout')) {
        if (!isCurrent) {
          await vscode.commands.executeCommand('gitGraphPlus.checkoutBranch', branch.name);
        }
      } else if (pick.label.includes('Merge')) {
        if (!isCurrent) {
          await vscode.commands.executeCommand('gitGraphPlus.mergeBranch', branchItem);
        }
      } else if (pick.label.includes('Rename')) {
        await vscode.commands.executeCommand('gitGraphPlus.renameBranch', branchItem);
      } else if (pick.label.includes('Delete')) {
        if (!isCurrent) {
          await vscode.commands.executeCommand('gitGraphPlus.deleteBranch', branchItem);
        }
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.showTagMenu', async (tagItem?: any) => {
      const tag = tagItem?.tag;
      if (!tag) { return; }

      const items: vscode.QuickPickItem[] = [
        { label: '$(git-branch) Checkout', description: tag.name },
        { label: '$(cloud-upload) Push tag', description: tag.name },
        { label: '$(cloud-upload) Push all tags' },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(trash) Delete remote tag', description: tag.name },
        { label: '$(trash) Delete tag', description: tag.name },
      ];

      const pick = await vscode.window.showQuickPick(items, { placeHolder: tag.name });
      if (!pick) { return; }

      if (pick.label.includes('Checkout')) {
        await vscode.commands.executeCommand('gitGraphPlus.checkoutBranch', tag.name);
      } else if (pick.label === '$(cloud-upload) Push tag') {
        await vscode.commands.executeCommand('gitGraphPlus.pushTag', tagItem);
      } else if (pick.label.includes('Push all')) {
        await vscode.commands.executeCommand('gitGraphPlus.pushAllTags');
      } else if (pick.label.includes('Delete remote')) {
        await vscode.commands.executeCommand('gitGraphPlus.deleteRemoteTag', tagItem);
      } else if (pick.label.includes('Delete tag')) {
        await vscode.commands.executeCommand('gitGraphPlus.deleteTag', tagItem);
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.deleteRemoteBranch', async (branchItem?: any) => {
      const branch = branchItem?.branch;
      if (!branch) { return; }
      const slashIndex = branch.name.indexOf('/');
      const remotes = await gitService.remotes();
      const defaultRemote = remotes[0]?.name ?? 'origin';
      const remote = slashIndex > 0 ? branch.name.substring(0, slashIndex) : defaultRemote;
      const branchName = slashIndex > 0 ? branch.name.substring(slashIndex + 1) : branch.name;
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'deleteRemoteBranch', remote, name: branchName });
    }),

    vscode.commands.registerCommand('gitGraphPlus.checkoutRemoteBranch', async (branchItem?: any) => {
      const branch = branchItem?.branch;
      if (!branch) { return; }
      const localName = branch.name.includes('/') ? branch.name.split('/').slice(1).join('/') : branch.name;
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'checkoutRemote', remoteName: branch.name, localName });
    }),

    vscode.commands.registerCommand('gitGraphPlus.showRemoteBranchMenu', async (branchItem?: any) => {
      const branch = branchItem?.branch;
      if (!branch) { return; }

      const items: vscode.QuickPickItem[] = [
        { label: '$(git-branch) Checkout as local branch', description: branch.name },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(trash) Delete remote branch', description: branch.name },
      ];

      const pick = await vscode.window.showQuickPick(items, { placeHolder: branch.name });
      if (!pick) { return; }

      if (pick.label.includes('Checkout')) {
        const localName = branch.name.includes('/') ? branch.name.split('/').slice(1).join('/') : branch.name;
        MainPanel.showModalWithPanel(context.extensionUri, { modal: 'checkoutRemote', remoteName: branch.name, localName });
      } else if (pick.label.includes('Delete')) {
        const slashIndex = branch.name.indexOf('/');
        const remotes = await gitService.remotes();
        const defaultRemote = remotes[0]?.name ?? 'origin';
        const remote = slashIndex > 0 ? branch.name.substring(0, slashIndex) : defaultRemote;
        const branchName = slashIndex > 0 ? branch.name.substring(slashIndex + 1) : branch.name;
        MainPanel.showModalWithPanel(context.extensionUri, { modal: 'deleteRemoteBranch', remote, name: branchName });
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.showStashMenu', async (stashItem?: any) => {
      const stash = stashItem?.stash;
      if (!stash) { return; }

      const items: vscode.QuickPickItem[] = [
        { label: '$(check) Apply', description: stash.message },
        { label: '$(check-all) Pop', description: stash.message },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(trash) Drop', description: stash.message },
      ];

      const pick = await vscode.window.showQuickPick(items, { placeHolder: stash.message || `stash@{${stash.index}}` });
      if (!pick) { return; }

      if (pick.label.includes('Apply')) {
        await vscode.commands.executeCommand('gitGraphPlus.stashApply', stashItem);
      } else if (pick.label.includes('Pop')) {
        await vscode.commands.executeCommand('gitGraphPlus.stashPop', stashItem);
      } else if (pick.label.includes('Drop')) {
        await vscode.commands.executeCommand('gitGraphPlus.stashDrop', stashItem);
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.removeWorktree', async (worktreeItem?: any) => {
      const wtPath = worktreeItem?.worktree?.path;
      if (!wtPath) { return; }
      const wtBranch = worktreeItem?.worktree?.branch ?? '';

      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'removeWorktree', path: wtPath, branch: wtBranch });
    }),
  );

}

export function deactivate() {
  MainPanel.onSidebarRefresh = null;
}
