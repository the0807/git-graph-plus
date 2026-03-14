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
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }

  const repoPath = workspaceFolder.uri.fsPath;
  const gitService = new GitService(repoPath);

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
    vscode.window.registerTreeDataProvider('gitGraphPlus.branches', branchesProvider),
    vscode.window.registerTreeDataProvider('gitGraphPlus.remotes', remotesProvider),
    vscode.window.registerTreeDataProvider('gitGraphPlus.tags', tagsProvider),
    vscode.window.registerTreeDataProvider('gitGraphPlus.stashes', stashesProvider),
    vscode.window.registerTreeDataProvider('gitGraphPlus.worktrees', worktreesProvider),
  );

  // --- Status Bar ---
  const statusBar = new StatusBarManager();
  context.subscriptions.push(statusBar);

  // --- File Watcher ---
  const fileWatcher = new FileWatcher(repoPath, () => {
    refreshAll();
  });
  context.subscriptions.push(fileWatcher);

  function refreshAll() {
    branchesProvider.refresh();
    remotesProvider.refresh();
    tagsProvider.refresh();
    stashesProvider.refresh();
    worktreesProvider.refresh();
  }

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

    vscode.commands.registerCommand('gitGraphPlus.fetch', async () => {
      try {
        const remotes = await gitService.remotes();
        let remote: string | undefined;

        if (remotes.length > 1) {
          const fetchAll = vscode.l10n.t('fetchAllRemotes');
          const items = [fetchAll, ...remotes.map(r => r.name)];
          const picked = await vscode.window.showQuickPick(items, {
            placeHolder: vscode.l10n.t('selectRemoteToFetch'),
          });
          if (!picked) { return; }
          if (picked !== fetchAll) { remote = picked; }
        }

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('fetching') },
          async () => { await gitService.fetch(remote, { prune: true }); }
        );
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('fetchFailed', err instanceof Error ? err.message : String(err)));
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.pull', async () => {
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('pulling') },
          async () => { await gitService.pull(); }
        );
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('pullFailed', err instanceof Error ? err.message : String(err)));
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.push', async () => {
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('pushing') },
          async () => { await gitService.push(undefined, undefined, { setUpstream: true }); }
        );
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('pushFailed', err instanceof Error ? err.message : String(err)));
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.checkoutBranch', async (ref: string) => {
      try {
        const isRemote = await gitService.isRemoteBranch(ref);
        if (isRemote) {
          const slashIndex = ref.indexOf('/');
          const localName = ref.substring(slashIndex + 1);
          const name = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('enterNewBranchName', ref),
            value: localName,
          });
          if (!name) { return; }
          await gitService.createAndCheckoutBranch(name, ref);
        } else {
          await gitService.checkout(ref);
        }
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
        vscode.window.showInformationMessage(vscode.l10n.t('checkedOut', ref));
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('checkoutFailed', err instanceof Error ? err.message : String(err)));
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.mergeBranch', async (branchItem?: any) => {
      const branchName = branchItem?.branch?.name;
      if (!branchName) { return; }

      try {
        await gitService.merge(branchName);
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
        vscode.window.showInformationMessage(`Merged '${branchName}' into current branch.`);
      } catch (err: unknown) {
        vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.stashPop', async (stashItem?: any) => {
      const index = stashItem?.stash?.index;
      if (index === undefined) { return; }

      try {
        await gitService.stashPop(index);
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.createBranch', async () => {
      const name = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('enterBranchName'),
        placeHolder: vscode.l10n.t('branchPlaceholder'),
      });
      if (!name) { return; }

      if (/[\s~^:?*\[\\]/.test(name) || name.startsWith('-') || name.endsWith('.lock') || name.includes('..')) {
        vscode.window.showErrorMessage('Invalid branch name');
        return;
      }

      try {
        await gitService.createAndCheckoutBranch(name);
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('createBranchFailed', err instanceof Error ? err.message : String(err)));
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.stashSave', async () => {
      const message = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('stashMessage'),
        placeHolder: vscode.l10n.t('stashPlaceholder'),
      });

      try {
        await gitService.stashSave(message || undefined, true);
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
        vscode.window.showInformationMessage(vscode.l10n.t('changesStashed'));
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('stashFailed', err instanceof Error ? err.message : String(err)));
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.createTag', async () => {
      const name = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('enterTagName'),
        placeHolder: vscode.l10n.t('tagPlaceholder'),
      });
      if (!name) { return; }

      const message = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('tagMessage'),
        placeHolder: vscode.l10n.t('tagReleasePlaceholder'),
      });

      try {
        await gitService.createTag(name, undefined, message || undefined);
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('createTagFailed', err instanceof Error ? err.message : String(err)));
      }
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
            { placeHolder: vscode.l10n.t('selectRemoteToDelete') }
          );
          if (!picked) { return; }
          remote = picked;
        } else if (remotes.length === 1) {
          remote = remotes[0].name;
        }
        await gitService.deleteRemoteTag(tagName, remote);
        vscode.window.showInformationMessage(vscode.l10n.t('remoteTagDeleted', tagName, remote));
        refreshAll();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('deleteRemoteTagFailed', err instanceof Error ? err.message : String(err)));
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.deleteBranch', async (branchItem?: any) => {
      const branchName = branchItem?.branch?.name;
      if (!branchName) { return; }

      const confirm = await vscode.window.showWarningMessage(
        vscode.l10n.t('deleteBranchConfirm', branchName),
        { modal: true },
        vscode.l10n.t('yes'),
      );
      if (!confirm) { return; }

      try {
        await gitService.deleteBranch(branchName, false);
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
      } catch (err: unknown) {
        // If normal delete fails (unmerged branch), offer force delete
        const forceConfirm = await vscode.window.showWarningMessage(
          vscode.l10n.t('deleteBranchForcedConfirm', branchName),
          { modal: true },
          vscode.l10n.t('yes'),
        );
        if (!forceConfirm) { return; }
        try {
          await gitService.deleteBranch(branchName, true);
          refreshAll();
          MainPanel.currentPanel?.postRefresh();
        } catch (err2: unknown) {
          vscode.window.showErrorMessage(vscode.l10n.t('deleteBranchFailed', err2 instanceof Error ? err2.message : String(err2)));
        }
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.renameBranch', async (branchItem?: any) => {
      const oldName = branchItem?.branch?.name;
      if (!oldName) { return; }

      const newName = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('enterNewBranchName', oldName),
        value: oldName,
      });
      if (!newName || newName === oldName) { return; }

      try {
        await gitService.renameBranch(oldName, newName);
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('renameBranchFailed', err instanceof Error ? err.message : String(err)));
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.deleteTag', async (tagItem?: any) => {
      const tagName = tagItem?.tag?.name;
      if (!tagName) { return; }

      const confirm = await vscode.window.showWarningMessage(
        vscode.l10n.t('deleteTagConfirm', tagName),
        { modal: true },
        vscode.l10n.t('yes'),
      );
      if (!confirm) { return; }

      try {
        await gitService.deleteTag(tagName);
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('deleteTagFailed', err instanceof Error ? err.message : String(err)));
      }
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

      const confirm = await vscode.window.showWarningMessage(
        vscode.l10n.t('stashDropConfirm', stashItem?.stash?.message ?? `stash@{${index}}`),
        { modal: true },
        vscode.l10n.t('yes'),
      );
      if (!confirm) { return; }

      try {
        await gitService.stashDrop(index);
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('stashDropFailed', err instanceof Error ? err.message : String(err)));
      }
    }),

    vscode.commands.registerCommand('gitGraphPlus.addWorktree', async () => {
      const wtPath = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('enterWorktreePath'),
        placeHolder: '../my-worktree',
      });
      if (!wtPath) { return; }

      const branchChoice = await vscode.window.showQuickPick(
        [vscode.l10n.t('newBranch'), vscode.l10n.t('existingBranch')],
        { placeHolder: vscode.l10n.t('worktreeBranchChoice') },
      );
      if (!branchChoice) { return; }

      let branch: string | undefined;
      let newBranch: string | undefined;

      if (branchChoice === vscode.l10n.t('newBranch')) {
        newBranch = await vscode.window.showInputBox({
          prompt: vscode.l10n.t('enterNewBranchNameForWorktree'),
          placeHolder: 'feature/my-branch',
        });
        if (!newBranch) { return; }
      } else {
        const branches = await gitService.branches();
        const localBranches = branches.filter(b => !b.remote).map(b => b.name);
        branch = await vscode.window.showQuickPick(localBranches, {
          placeHolder: vscode.l10n.t('selectBranchForWorktree'),
        });
        if (!branch) { return; }
      }

      try {
        await gitService.worktreeAdd(wtPath, branch, newBranch);
        worktreesProvider.refresh();
        vscode.window.showInformationMessage(vscode.l10n.t('worktreeAdded', wtPath));
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('addWorktreeFailed', err instanceof Error ? err.message : String(err)));
      }
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

    vscode.commands.registerCommand('gitGraphPlus.showRemoteBranchMenu', async (branchItem?: any) => {
      const branch = branchItem?.branch;
      if (!branch) { return; }

      const items: vscode.QuickPickItem[] = [
        { label: '$(git-branch) Checkout as local branch', description: branch.name },
      ];

      const pick = await vscode.window.showQuickPick(items, { placeHolder: branch.name });
      if (!pick) { return; }

      if (pick.label.includes('Checkout')) {
        const localName = branch.name.includes('/') ? branch.name.split('/').slice(1).join('/') : branch.name;
        const name = await vscode.window.showInputBox({
          prompt: vscode.l10n.t('enterNewBranchName', branch.name),
          value: localName,
        });
        if (!name) { return; }
        try {
          await gitService.createAndCheckoutBranch(name, branch.name);
          refreshAll();
          MainPanel.currentPanel?.postRefresh();
        } catch (err: unknown) {
          vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
        }
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

      const confirm = await vscode.window.showWarningMessage(
        vscode.l10n.t('removeWorktreeConfirm', wtPath),
        { modal: true },
        vscode.l10n.t('yes'),
      );
      if (!confirm) { return; }

      try {
        await gitService.worktreeRemove(wtPath);
        refreshAll();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(vscode.l10n.t('removeWorktreeFailed', err instanceof Error ? err.message : String(err)));
      }
    }),
  );

}

export function deactivate() {}
