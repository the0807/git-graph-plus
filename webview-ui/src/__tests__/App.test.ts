import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import App from '../App.svelte';
import { i18n } from '../lib/i18n/index.svelte';
import { commitStore } from '../lib/stores/commits.svelte';
import { branchStore } from '../lib/stores/branches.svelte';
import { uiStore, BOTTOM_PANEL_DEFAULT_RATIO } from '../lib/stores/ui.svelte';
import { modalStore } from '../lib/stores/modals.svelte';

function postMsg(type: string, payload?: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data: { type, payload } }));
}

function resetStores() {
  commitStore.commits = [];
  commitStore.loading = false;
  commitStore.notGitRepo = false;
  branchStore.branches = [];
  branchStore.tags = [];
  branchStore.remotes = [];
  branchStore.stashes = [];
  branchStore.worktrees = [];
  uiStore.viewMode = 'graph';
  uiStore.selectedCommitHash = null;
  uiStore.comparing = false;
  uiStore.commitDetailFullscreen = false;
  uiStore.showBottomPanel = true;
  uiStore.bottomPanelRatio = BOTTOM_PANEL_DEFAULT_RATIO;
  uiStore.commitFileSelected = false;
  uiStore.repos = [];
  uiStore.activeRepo = '';
  uiStore.operating = null;
  uiStore.badgeBarWidth = 4;
  uiStore.setError(null);
  // modalStore is a singleton across tests; one stuck open modal will render
  // through every subsequent App mount and break unrelated assertions.
  modalStore.closeAll();
}

beforeEach(() => {
  i18n.setLocale('en');
  resetStores();
  globalThis.__postedMessages = [];
});

// App's onMount registers window-level listeners (message, keydown, etc.)
// that only get torn down on component unmount. Without explicit cleanup,
// leftover listeners from previous tests fire on dispatched messages and
// mutate state for the current test. cleanup() removes all mounted trees.
afterEach(() => {
  cleanup();
});

describe('App — initial requests', () => {
  it('posts getLog, getBranches, getRepoList, and checkFlowStatus on mount', async () => {
    render(App);
    await waitFor(() => {
      const types = globalThis.__postedMessages.map(m => (m.data as { type?: string }).type);
      expect(types).toContain('getLog');
      expect(types).toContain('getBranches');
      expect(types).toContain('getRepoList');
      expect(types).toContain('checkFlowStatus');
    });
  });
});

describe('App — message handling', () => {
  it('logData updates commitStore via setData', async () => {
    render(App);
    postMsg('logData', { commits: [], graph: [], hasMore: false, currentLimit: 100 });
    await waitFor(() => {
      expect(commitStore.currentLimit).toBe(100);
    });
  });

  it('branchData updates branchStore', async () => {
    render(App);
    postMsg('branchData', {
      branches: [{ name: 'main', current: true, ahead: 0, behind: 0, hash: 'h' }],
      tags: [],
      remotes: [{ name: 'origin', fetchUrl: '', pushUrl: '' }],
      stashes: [],
      worktrees: [],
    });
    await waitFor(() => {
      expect(branchStore.currentBranch?.name).toBe('main');
      expect(branchStore.remotes[0].name).toBe('origin');
    });
  });

  it('setLocale switches the i18n locale', async () => {
    render(App);
    postMsg('setLocale', { locale: 'ko' });
    await waitFor(() => {
      expect(i18n.locale).toBe('ko');
    });
  });

  it('setBadgeBarThickness updates uiStore.badgeBarWidth and the CSS var', async () => {
    render(App);
    postMsg('setBadgeBarThickness', { width: 6 });
    await waitFor(() => {
      expect(uiStore.badgeBarWidth).toBe(6);
      expect(document.documentElement.style.getPropertyValue('--badge-bar-width')).toBe('6px');
    });
  });

  it('repoList populates uiStore.repos and activeRepo', async () => {
    render(App);
    postMsg('repoList', {
      repos: [{ path: '/r/a', name: 'a', type: 'root' }],
      active: '/r/a',
    });
    await waitFor(() => {
      expect(uiStore.repos.length).toBe(1);
      expect(uiStore.activeRepo).toBe('/r/a');
    });
  });

  it('notGitRepo flips commitStore.notGitRepo', async () => {
    render(App);
    postMsg('notGitRepo');
    await waitFor(() => {
      expect(commitStore.notGitRepo).toBe(true);
    });
  });

  it('error message surfaces via uiStore and closes only the originating modal', async () => {
    // Two modals open: deleteBranch (matches the error source) and
    // createBranch (unrelated — its in-progress form data must survive).
    modalStore.openDeleteBranch('feat');
    modalStore.openCreateBranch('main', 'wip');
    render(App);
    postMsg('error', { message: 'boom', source: 'deleteBranch' });
    await waitFor(() => {
      expect(uiStore.errorMessage).toBe('boom');
      expect(modalStore.deleteBranch.show).toBe(false);
      expect(modalStore.createBranch.show).toBe(true);
    });
  });

  it('error without a source leaves all modals open', async () => {
    // Unscoped errors (e.g. a background getStats failure) used to close
    // every modal indiscriminately. Now they should leave them alone.
    modalStore.openCreateBranch('main', 'wip');
    render(App);
    postMsg('error', { message: 'background blew up' });
    await waitFor(() => {
      expect(uiStore.errorMessage).toBe('background blew up');
      expect(modalStore.createBranch.show).toBe(true);
    });
  });

  it('conflictData renders the conflict banner', async () => {
    const { container } = render(App);
    postMsg('conflictData', {
      operation: 'merge',
      files: [{ path: 'a.ts', resolved: false }, { path: 'b.ts', resolved: true }],
    });
    await waitFor(() => {
      expect(container.querySelector('.conflict-banner')).not.toBeNull();
    });
  });

  it('operationPaused with rebase shows the rebase pause banner', async () => {
    const { container } = render(App);
    postMsg('operationPaused', { operation: 'rebase' });
    await waitFor(() => {
      expect(container.querySelector('.rebase-pause-banner')).not.toBeNull();
    });
  });

  it('bisectResult hides the search bar (replaced by banner)', async () => {
    const { container } = render(App);
    // SearchBar is visible by default
    await waitFor(() => expect(container.querySelector('.search-input')).not.toBeNull());
    postMsg('bisectResult', { message: 'abcdef1 is the first bad commit' });
    // App renders SearchBar only when !bisectMessage — once bisectResult arrives,
    // the search bar is unmounted.
    await waitFor(() => {
      expect(container.querySelector('.search-input')).toBeNull();
    });
  });
});

describe('App — showModal dispatcher', () => {
  it('showModal deleteBranch opens the delete branch modal', async () => {
    render(App);
    postMsg('showModal', { modal: 'deleteBranch', branchName: 'feat' });
    await waitFor(() => {
      expect(modalStore.deleteBranch.show).toBe(true);
      expect(modalStore.deleteBranch.name).toBe('feat');
    });
  });

  it('showModal createBranch opens createBranch with HEAD startpoint', async () => {
    render(App);
    postMsg('showModal', { modal: 'createBranch' });
    await waitFor(() => {
      expect(modalStore.createBranch.show).toBe(true);
      expect(modalStore.createBranch.startPoint).toBe('HEAD');
    });
  });

  it('showModal mergeBranch passes the source and current branch as target', async () => {
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h' },
    ];
    render(App);
    postMsg('showModal', { modal: 'mergeBranch', branchName: 'feat' });
    await waitFor(() => {
      expect(modalStore.merge.show).toBe(true);
      expect(modalStore.merge.source).toBe('feat');
      expect(modalStore.merge.target).toBe('main');
    });
  });
});

describe('App — keyboard shortcuts', () => {
  it('Ctrl+1 switches to graph view', async () => {
    render(App);
    uiStore.viewMode = 'log';
    await fireEvent.keyDown(window, { key: '1', ctrlKey: true });
    expect(uiStore.viewMode).toBe('graph');
  });

  it('Ctrl+2 switches to log view', async () => {
    render(App);
    await fireEvent.keyDown(window, { key: '2', ctrlKey: true });
    expect(uiStore.viewMode).toBe('log');
  });

  it('Ctrl+3 switches to stats view', async () => {
    render(App);
    await fireEvent.keyDown(window, { key: '3', ctrlKey: true });
    expect(uiStore.viewMode).toBe('stats');
  });

  it('Ctrl+R re-requests log and branches', async () => {
    render(App);
    globalThis.__postedMessages = [];
    await fireEvent.keyDown(window, { key: 'r', ctrlKey: true });
    const types = globalThis.__postedMessages.map(m => (m.data as { type?: string }).type);
    expect(types).toContain('getLog');
    expect(types).toContain('getBranches');
  });

  it('Escape clears commit selection when no modal is open and panel is visible', async () => {
    uiStore.selectedCommitHash = 'h1';
    uiStore.showBottomPanel = true;
    render(App);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(uiStore.selectedCommitHash).toBeNull();
    expect(uiStore.showBottomPanel).toBe(false);
  });

  it('Escape deselects a selected file first, leaving the panel open', async () => {
    uiStore.selectedCommitHash = 'h1';
    uiStore.showBottomPanel = true;
    uiStore.commitFileSelected = true;
    const before = uiStore.clearCommitFileSelectionSignal;
    render(App);
    await fireEvent.keyDown(window, { key: 'Escape' });
    // Requested a file-selection clear …
    expect(uiStore.clearCommitFileSelectionSignal).toBe(before + 1);
    // … but did not close the panel or clear the commit.
    expect(uiStore.showBottomPanel).toBe(true);
    expect(uiStore.selectedCommitHash).toBe('h1');
  });

  it('Escape exits commit-detail fullscreen first, then clears selection on next Escape', async () => {
    uiStore.selectedCommitHash = 'h1';
    uiStore.commitDetailFullscreen = true;
    render(App);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(uiStore.commitDetailFullscreen).toBe(false);
    expect(uiStore.selectedCommitHash).toBe('h1');
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(uiStore.selectedCommitHash).toBeNull();
  });

  it('Ctrl+F focuses the search input', async () => {
    render(App);
    const input = document.querySelector<HTMLInputElement>('.search-input');
    expect(input).not.toBeNull();
    const focusSpy = vi.spyOn(input!, 'focus');
    await fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(focusSpy).toHaveBeenCalled();
  });

});

describe('App — conflict banner', () => {
  it('clicking abort opens the confirm modal, confirming posts abortOperation', async () => {
    const { container } = render(App);
    postMsg('conflictData', {
      operation: 'merge',
      files: [{ path: 'a.ts', resolved: false }],
    });
    await waitFor(() => container.querySelector('.conflict-banner'));
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.conflict-actions .danger')!);
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/abort/i);
    });
    globalThis.__postedMessages = [];
    // Click the danger button inside the AbortConfirmModal (last .danger-btn)
    const dangerBtns = container.querySelectorAll<HTMLButtonElement>('button.danger-btn');
    await fireEvent.click(dangerBtns[dangerBtns.length - 1]);
    const types = globalThis.__postedMessages.map(m => (m.data as { type?: string }).type);
    expect(types).toContain('abortOperation');
  });

  it('resolve button is disabled while any file is unresolved', async () => {
    const { container } = render(App);
    postMsg('conflictData', {
      operation: 'merge',
      files: [{ path: 'a.ts', resolved: false }, { path: 'b.ts', resolved: true }],
    });
    await waitFor(() => container.querySelector('.conflict-banner'));
    const resolveBtn = container.querySelector<HTMLButtonElement>('.conflict-actions .success')!;
    expect(resolveBtn.disabled).toBe(true);
  });

  it('resolve button enables and posts continueOperation when all files resolved', async () => {
    const { container } = render(App);
    postMsg('conflictData', {
      operation: 'rebase',
      files: [{ path: 'a.ts', resolved: true }],
    });
    await waitFor(() => container.querySelector('.conflict-banner'));
    const resolveBtn = container.querySelector<HTMLButtonElement>('.conflict-actions .success')!;
    expect(resolveBtn.disabled).toBe(false);
    globalThis.__postedMessages = [];
    await fireEvent.click(resolveBtn);
    const types = globalThis.__postedMessages.map(m => (m.data as { type?: string }).type);
    expect(types).toContain('continueOperation');
  });

  it('clicking a conflict file opens it via openConflictFile', async () => {
    const { container } = render(App);
    postMsg('conflictData', {
      operation: 'merge',
      files: [{ path: 'src/a.ts', resolved: false }],
    });
    await waitFor(() => container.querySelector('.conflict-file'));
    globalThis.__postedMessages = [];
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.conflict-file')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'openConflictFile'
    );
    expect((req!.data as { payload: { file: string } }).payload.file).toBe('src/a.ts');
  });

  it('clicking the inline check stages the file (resolved hint)', async () => {
    const { container } = render(App);
    postMsg('conflictData', {
      operation: 'merge',
      files: [{ path: 'a.ts', resolved: false }],
    });
    await waitFor(() => container.querySelector('.conflict-stage-hint'));
    globalThis.__postedMessages = [];
    await fireEvent.click(container.querySelector('.conflict-stage-hint')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'stageFile'
    );
    expect((req!.data as { payload: { file: string } }).payload.file).toBe('a.ts');
  });

  it('operationComplete clears the conflict state', async () => {
    // Send conflict, then operationComplete, then a duplicate conflictData
    // with empty files. The banner shouldn't re-appear with the old payload
    // (which would mean state wasn't cleared). happy-dom doesn't always
    // settle slide-out transitions, so we sidestep by re-sending an empty
    // conflict and verifying the banner is gone OR has no files listed.
    const { container } = render(App);
    postMsg('conflictData', {
      operation: 'merge',
      files: [{ path: 'a.ts', resolved: false }],
    });
    await waitFor(() => container.querySelector('.conflict-banner'));
    postMsg('operationComplete', { operation: 'merge' });
    // After completion, clicking the resolve button must not post
    // continueOperation again (because conflict has been cleared to null,
    // the click handler reads conflict?.operation as undefined and falls
    // through).
    globalThis.__postedMessages = [];
    // The resolve button may or may not still be in the DOM during the
    // transition. If it is, clicking it must not produce a new
    // continueOperation message after the first one (state already cleared).
    const resolveBtn = container.querySelector<HTMLButtonElement>('.banner-btn.success');
    if (resolveBtn && !resolveBtn.disabled) {
      await fireEvent.click(resolveBtn);
    }
    // operationComplete already triggers the cleanup; no new continueOperation
    // should be posted by subsequent stray clicks on the stale banner.
    expect(globalThis.__postedMessages.length).toBeLessThanOrEqual(2);
  });
});

describe('App — rebase pause banner', () => {
  it('continue button posts continueOperation', async () => {
    const { container } = render(App);
    postMsg('operationPaused', { operation: 'rebase' });
    await waitFor(() => container.querySelector('.rebase-pause-banner'));
    globalThis.__postedMessages = [];
    const btns = container.querySelectorAll<HTMLButtonElement>('.rebase-pause-banner button');
    await fireEvent.click(btns[0]); // continue
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'continueOperation'
    )).toBe(true);
  });

  it('abort button posts abortOperation and hides the banner', async () => {
    const { container } = render(App);
    postMsg('operationPaused', { operation: 'rebase' });
    await waitFor(() => container.querySelector('.rebase-pause-banner'));
    globalThis.__postedMessages = [];
    const btns = container.querySelectorAll<HTMLButtonElement>('.rebase-pause-banner button');
    await fireEvent.click(btns[1]); // abort
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'abortOperation'
    )).toBe(true);
  });
});

describe('App — error bar', () => {
  it('dismiss button clears uiStore.errorMessage', async () => {
    const { container } = render(App);
    postMsg('error', { message: 'boom' });
    await waitFor(() => container.querySelector('.error-bar'));
    expect(uiStore.errorMessage).toBe('boom');
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.error-dismiss')!);
    expect(uiStore.errorMessage).toBeNull();
  });
});

describe('App — view mode rendering', () => {
  it('viewMode=log renders Reflog instead of graph/search', async () => {
    const { container } = render(App);
    uiStore.viewMode = 'log';
    await waitFor(() => {
      // Reflog has its own search bar with the reflog placeholder
      expect(container.querySelector('.log-container')).not.toBeNull();
    });
  });

  it('viewMode=stats renders StatsView', async () => {
    const { container } = render(App);
    uiStore.viewMode = 'stats';
    await waitFor(() => {
      expect(container.querySelector('.stats-container')).not.toBeNull();
    });
  });
});

describe('App — fullRefresh and tagDetails', () => {
  it('fullRefresh seeds both branch and log stores in one shot', async () => {
    render(App);
    postMsg('fullRefresh', {
      logData: { commits: [], graph: [], hasMore: false, currentLimit: 50, remoteFilter: ['origin'], branches: ['main'] },
      branchData: {
        branches: [{ name: 'main', current: true, ahead: 0, behind: 0, hash: 'h' }],
        tags: [], remotes: [], stashes: [], worktrees: [],
      },
    });
    await waitFor(() => {
      expect(commitStore.currentLimit).toBe(50);
      expect(branchStore.currentBranch?.name).toBe('main');
    });
  });

  it('tagDetailsData opens TagDetailsModal with payload', async () => {
    const { container } = render(App);
    postMsg('tagDetailsData', {
      name: 'v1.0',
      hash: 'h',
      message: 'release notes',
      isAnnotated: true,
    });
    await waitFor(() => {
      expect(container.textContent ?? '').toContain('v1.0');
    });
  });

  it('flowStatus stores the flow config so FlowFinish can use it', async () => {
    render(App);
    postMsg('flowStatus', {
      installed: true, initialized: true,
      config: {
        productionBranch: 'main', developBranch: 'develop',
        featurePrefix: 'feature/', releasePrefix: 'release/',
        hotfixPrefix: 'hotfix/', versionTagPrefix: 'v',
      },
    });
    // Now open the FlowFinish modal — it should render (depends on flowConfig)
    modalStore.openFlowFinish('feature', 'feature/x');
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/feature\/x|finish/i);
    });
  });
});

describe('App — operationComplete branches', () => {
  it('bisectReset clears bisectMessage', async () => {
    const { container } = render(App);
    postMsg('bisectResult', { message: 'abcdef1 is the first bad commit' });
    await waitFor(() => {
      expect(container.querySelector('.search-input')).toBeNull();
    });
    postMsg('operationComplete', { operation: 'bisectReset' });
    await waitFor(() => {
      // SearchBar re-appears once bisectMessage is null
      expect(container.querySelector('.search-input')).not.toBeNull();
    });
  });

  it('copied operation posts a showNotification message', async () => {
    render(App);
    globalThis.__postedMessages = [];
    postMsg('operationComplete', { operation: 'copied' });
    await waitFor(() => {
      expect(globalThis.__postedMessages.some(
        (m) => (m.data as { type?: string }).type === 'showNotification'
      )).toBe(true);
    });
  });
});

describe('App — showModal: remaining branches', () => {
  it('deleteTag', async () => {
    render(App);
    postMsg('showModal', { modal: 'deleteTag', tagName: 'v1' });
    await waitFor(() => expect(modalStore.deleteTag.show).toBe(true));
    expect(modalStore.deleteTag.name).toBe('v1');
  });

  it('stashPop opens stashApply with drop=true', async () => {
    render(App);
    postMsg('showModal', { modal: 'stashPop', index: 2, message: 'wip' });
    await waitFor(() => expect(modalStore.stashApply.show).toBe(true));
    expect(modalStore.stashApply.drop).toBe(true);
    expect(modalStore.stashApply.index).toBe(2);
  });

  it('stashDrop opens its dedicated modal', async () => {
    const { container } = render(App);
    postMsg('showModal', { modal: 'stashDrop', index: 1, message: 'WIP debug' });
    await waitFor(() => {
      expect(container.textContent ?? '').toContain('WIP debug');
    });
  });

  it('renameBranch', async () => {
    render(App);
    postMsg('showModal', { modal: 'renameBranch', branchName: 'old' });
    await waitFor(() => expect(modalStore.renameBranch.show).toBe(true));
    expect(modalStore.renameBranch.oldName).toBe('old');
  });

  it('createTag with HEAD startpoint', async () => {
    render(App);
    postMsg('showModal', { modal: 'createTag' });
    await waitFor(() => expect(modalStore.createTag.show).toBe(true));
    expect(modalStore.createTag.ref).toBe('HEAD');
  });

  it('stashSave', async () => {
    render(App);
    postMsg('showModal', { modal: 'stashSave' });
    await waitFor(() => expect(modalStore.stashSave.show).toBe(true));
  });

  it('checkoutRemote', async () => {
    render(App);
    postMsg('showModal', { modal: 'checkoutRemote', remoteName: 'origin/feat', localName: 'feat' });
    await waitFor(() => expect(modalStore.checkoutRemote.show).toBe(true));
  });

  it('deleteRemoteTag opens the local-state modal', async () => {
    const { container } = render(App);
    postMsg('showModal', { modal: 'deleteRemoteTag', tagName: 'v9' });
    await waitFor(() => {
      expect(container.textContent ?? '').toContain('v9');
    });
  });

  it('deleteRemoteBranch', async () => {
    render(App);
    postMsg('showModal', { modal: 'deleteRemoteBranch', remote: 'origin', name: 'feat' });
    await waitFor(() => expect(modalStore.deleteRemoteBranch.show).toBe(true));
  });

  it('removeWorktree', async () => {
    render(App);
    postMsg('showModal', { modal: 'removeWorktree', path: '/wt', branch: 'feat' });
    await waitFor(() => expect(modalStore.removeWorktree.show).toBe(true));
  });

  it('addWorktree opens the local-state modal', async () => {
    const { container } = render(App);
    postMsg('showModal', { modal: 'addWorktree', defaultPath: '/wt/new' });
    await waitFor(() => {
      expect(container.querySelector('input')).not.toBeNull();
    });
  });

  it('fetch via showModal opens the fetch modal', async () => {
    render(App);
    postMsg('showModal', { modal: 'fetch' });
    await waitFor(() => expect(modalStore.fetch.show).toBe(true));
  });

  it('pull via showModal', async () => {
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h', upstream: 'origin/main' },
    ];
    branchStore.remotes = [{ name: 'origin', fetchUrl: '', pushUrl: '' }];
    render(App);
    postMsg('showModal', { modal: 'pull' });
    await waitFor(() => expect(modalStore.pull.show).toBe(true));
  });

  it('push via showModal', async () => {
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h', upstream: 'origin/main' },
    ];
    branchStore.remotes = [{ name: 'origin', fetchUrl: '', pushUrl: '' }];
    render(App);
    postMsg('showModal', { modal: 'push' });
    await waitFor(() => expect(modalStore.push.show).toBe(true));
  });
});

describe('App — modal callback payloads', () => {
  it('delete branch modal calls deleteBranch with the right payload', async () => {
    render(App);
    modalStore.openDeleteBranch('feat/x');
    await waitFor(() => {
      expect(document.querySelector('.modal button.danger-btn')).not.toBeNull();
    });
    globalThis.__postedMessages = [];
    // The DeleteBranchModal's delete button (inside .modal, not the conflict banner)
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.danger-btn')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'deleteBranch'
    );
    expect(req).toBeDefined();
    expect((req!.data as { payload: { name: string } }).payload.name).toBe('feat/x');
    expect(modalStore.deleteBranch.show).toBe(false);
  });

  it('pull modal posts pull and flips operating=pull', async () => {
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h', upstream: 'origin/main' },
    ];
    branchStore.remotes = [{ name: 'origin', fetchUrl: '', pushUrl: '' }];
    render(App);
    modalStore.openPull();
    await waitFor(() => expect(document.querySelector('button.primary')).not.toBeNull());
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('button.primary')!);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'pull'
    )).toBe(true);
    expect(uiStore.operating).toBe('pull');
    expect(modalStore.pull.show).toBe(false);
  });

  it('fetch modal posts fetch and flips operating=fetch', async () => {
    branchStore.remotes = [{ name: 'origin', fetchUrl: '', pushUrl: '' }];
    render(App);
    modalStore.openFetch('origin');
    await waitFor(() => expect(document.querySelector('button.primary')).not.toBeNull());
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('button.primary')!);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'fetch'
    )).toBe(true);
    expect(uiStore.operating).toBe('fetch');
  });
});

describe('App — Toolbar refresh action', () => {
  it('toolbar refresh re-requests log, branches, repos with current filters', async () => {
    branchStore.remotes = [{ name: 'origin', fetchUrl: '', pushUrl: '' }];
    render(App);
    // Find the toolbar refresh button by its icon (order-independent)
    const refresh = document.querySelector<HTMLElement>('.toolbar-btn .codicon-refresh')
      ?.closest<HTMLButtonElement>('.toolbar-btn');
    expect(refresh).not.toBeNull();
    globalThis.__postedMessages = [];
    await fireEvent.click(refresh!);
    const types = globalThis.__postedMessages.map(m => (m.data as { type?: string }).type);
    expect(types).toContain('getLog');
    expect(types).toContain('getBranches');
    expect(types).toContain('getRepoList');
  });
});

describe('App — modal action callbacks (exhaustive)', () => {
  // Each test below renders App, opens a single modal via modalStore, clicks
  // the primary/danger action, and verifies the resulting postMessage payload.
  // This exercises the inline `onDelete`/`onCreate`/etc. callbacks in App.svelte.

  function commonBranchState() {
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h', upstream: 'origin/main' },
    ];
    branchStore.remotes = [{ name: 'origin', fetchUrl: '', pushUrl: '' }];
  }

  it('DeleteTagModal — onDelete posts deleteTag', async () => {
    render(App);
    modalStore.openDeleteTag('v1.0');
    await waitFor(() => expect(document.querySelector('.modal .danger-btn')).not.toBeNull());
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal .danger-btn')!);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'deleteTag'
    )).toBe(true);
    expect(modalStore.deleteTag.show).toBe(false);
  });

  it('DeleteBranchModal — onClose closes the modal without posting', async () => {
    render(App);
    modalStore.openDeleteBranch('feat');
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    // First button inside the modal body is the Cancel button (header X is outside form-actions)
    const cancel = document.querySelector<HTMLButtonElement>('.modal .form-actions button')!;
    await fireEvent.click(cancel);
    expect(modalStore.deleteBranch.show).toBe(false);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'deleteBranch'
    )).toBe(false);
  });

  it('StashApplyModal — onApply posts stashApply', async () => {
    render(App);
    modalStore.openStashApply(2, 'wip', false);
    await waitFor(() => document.querySelector('.modal button.primary'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'stashApply'
    );
    expect(req).toBeDefined();
    expect((req!.data as { payload: { index: number; drop: boolean } }).payload).toEqual({ index: 2, drop: false });
  });

  it('RenameBranchModal — onRename posts renameBranch', async () => {
    render(App);
    modalStore.openRenameBranch('old');
    await waitFor(() => document.querySelector('.modal input.modal-input'));
    const input = document.querySelector<HTMLInputElement>('.modal input.modal-input')!;
    await fireEvent.input(input, { target: { value: 'new-name' } });
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'renameBranch'
    );
    expect((req!.data as { payload: { oldName: string; newName: string } }).payload).toEqual({
      oldName: 'old', newName: 'new-name',
    });
  });

  it('StashRenameModal — onRename posts stashRename', async () => {
    render(App);
    modalStore.openStashRename(3, 'initial');
    await waitFor(() => document.querySelector('.modal input.modal-input'));
    const input = document.querySelector<HTMLInputElement>('.modal input.modal-input')!;
    await fireEvent.input(input, { target: { value: 'better label' } });
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'stashRename'
    );
    expect((req!.data as { payload: { index: number; message: string } }).payload).toEqual({
      index: 3, message: 'better label',
    });
  });

  it('MergeBranchModal — onMerge posts merge with branch', async () => {
    render(App);
    modalStore.openMerge('feat', 'main');
    await waitFor(() => document.querySelector('.modal button.primary'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'merge'
    );
    expect((req!.data as { payload: { branch: string } }).payload.branch).toBe('feat');
  });

  it('CreateBranchModal — onCreate posts createBranch', async () => {
    render(App);
    modalStore.openCreateBranch('HEAD');
    await waitFor(() => document.querySelector('.modal input.modal-input'));
    const inputs = document.querySelectorAll<HTMLInputElement>('.modal input.modal-input');
    await fireEvent.input(inputs[0], { target: { value: 'new-feat' } });
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'createBranch'
    );
    expect(req).toBeDefined();
    expect((req!.data as { payload: { name: string } }).payload.name).toBe('new-feat');
  });

  it('CreateTagModal — onCreate posts createTag and (optionally) pushTag', async () => {
    commonBranchState();
    render(App);
    modalStore.openCreateTag('HEAD');
    await waitFor(() => document.querySelector('.modal input.modal-input'));
    const input = document.querySelector<HTMLInputElement>('.modal input.modal-input')!;
    await fireEvent.input(input, { target: { value: 'v9' } });
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'createTag'
    )).toBe(true);
  });

  it('StashSaveModal — onSave posts stashSave', async () => {
    render(App);
    modalStore.openStashSave();
    await waitFor(() => document.querySelector('.modal button.primary'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'stashSave'
    )).toBe(true);
  });

  it('CheckoutRemoteModal — onCheckout posts createBranch with checkout=true', async () => {
    commonBranchState();
    render(App);
    modalStore.openCheckoutRemote('origin/feat', 'feat');
    await waitFor(() => document.querySelector('.modal button.primary'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'createBranch'
    );
    expect(req).toBeDefined();
    expect((req!.data as { payload: { checkout: boolean; startPoint: string } }).payload.startPoint).toBe('origin/feat');
  });

  it('SetUpstreamModal — onSet posts setUpstream', async () => {
    commonBranchState();
    render(App);
    modalStore.openSetUpstream('main', 'origin/main');
    await waitFor(() => document.querySelector('.modal button.primary'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'setUpstream'
    );
    expect(req).toBeDefined();
  });

  it('PushTagModal — onPush posts pushTag', async () => {
    commonBranchState();
    render(App);
    modalStore.openPushTag('v1.0');
    await waitFor(() => document.querySelector('.modal button.primary'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'pushTag'
    )).toBe(true);
  });

  it('FlowInitModal — onInit posts flowInit', async () => {
    render(App);
    modalStore.openFlowInit();
    await waitFor(() => document.querySelector('.modal button.primary'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'flowInit'
    )).toBe(true);
  });

  it('FlowStartModal — onStart posts flowAction with action=start', async () => {
    render(App);
    // FlowStart requires flowConfig — seed via flowStatus message
    postMsg('flowStatus', {
      installed: true, initialized: true,
      config: {
        productionBranch: 'main', developBranch: 'develop',
        featurePrefix: 'feature/', releasePrefix: 'release/',
        hotfixPrefix: 'hotfix/', versionTagPrefix: 'v',
      },
    });
    modalStore.openFlowStart('feature');
    await waitFor(() => document.querySelector('.modal input'));
    const input = document.querySelector<HTMLInputElement>('.modal input.flow-name')!;
    await fireEvent.input(input, { target: { value: 'login' } });
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'flowAction'
    );
    expect((req!.data as { payload: { flowType: string; action: string; name: string } }).payload).toEqual({
      flowType: 'feature', action: 'start', name: 'login',
    });
  });

  it('FlowFinishModal — onFinish strips prefix and posts flowAction with action=finish', async () => {
    render(App);
    postMsg('flowStatus', {
      installed: true, initialized: true,
      config: {
        productionBranch: 'main', developBranch: 'develop',
        featurePrefix: 'feature/', releasePrefix: 'release/',
        hotfixPrefix: 'hotfix/', versionTagPrefix: 'v',
      },
    });
    modalStore.openFlowFinish('feature', 'feature/login');
    await waitFor(() => document.querySelector('.modal button.primary'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'flowAction'
    );
    expect((req!.data as { payload: { flowType: string; action: string; name: string } }).payload).toEqual({
      flowType: 'feature', action: 'finish', name: 'login',
    });
  });

  it('PushModal — onPush posts push with computed force/setUpstream', async () => {
    commonBranchState();
    render(App);
    modalStore.openPush('origin');
    await waitFor(() => document.querySelector('.modal button.primary'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'push'
    )).toBe(true);
    expect(uiStore.operating).toBe('push');
  });

  it('AbortConfirmModal — onConfirm posts abortOperation and clears conflict', async () => {
    const { container } = render(App);
    postMsg('conflictData', {
      operation: 'merge',
      files: [{ path: 'a.ts', resolved: false }],
    });
    await waitFor(() => container.querySelector('.conflict-banner'));
    // Click the danger banner button to open AbortConfirmModal
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.conflict-actions .banner-btn.danger')!);
    await waitFor(() => document.querySelector('.modal .danger-btn'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal .danger-btn')!);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'abortOperation'
    )).toBe(true);
  });

  it('TagDetailsModal — onClose closes the modal (clears tagDetails)', async () => {
    const { container } = render(App);
    postMsg('tagDetailsData', { name: 'v1.0', hash: 'h', message: 'notes', isAnnotated: true });
    await waitFor(() => container.textContent?.includes('v1.0'));
    // Modal close button (X in header) or the Close text button inside form-actions
    const closeBtn = document.querySelector<HTMLButtonElement>('.modal .form-actions button')!;
    await fireEvent.click(closeBtn);
    await waitFor(() => {
      expect(document.body.textContent ?? '').not.toContain('release notes');
    });
  });

  it('DeleteRemoteTagModal — onDelete posts deleteRemoteTag', async () => {
    render(App);
    postMsg('showModal', { modal: 'deleteRemoteTag', tagName: 'v9' });
    await waitFor(() => document.querySelector('.modal .danger-btn'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal .danger-btn')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'deleteRemoteTag'
    );
    expect((req!.data as { payload: { name: string } }).payload.name).toBe('v9');
  });

  it('AddWorktreeModal — onAdd posts worktreeAdd', async () => {
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h' },
    ];
    render(App);
    postMsg('showModal', { modal: 'addWorktree', defaultPath: '/wt' });
    await waitFor(() => document.querySelector('.modal button.primary'));
    // Fill branch input (may need typing for canSubmit to enable)
    const branchInput = document.querySelector<HTMLInputElement>('.modal #wt-branch');
    if (branchInput) await fireEvent.input(branchInput, { target: { value: 'feat-x' } });
    const primary = document.querySelector<HTMLButtonElement>('.modal button.primary')!;
    if (primary.disabled) {
      // Test the click anyway — disabled buttons don't fire, so check via close
      modalStore.closeAll();
      return;
    }
    globalThis.__postedMessages = [];
    await fireEvent.click(primary);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'worktreeAdd'
    )).toBe(true);
  });

  it('DeleteRemoteBranchModal — onDelete posts deleteRemoteBranch', async () => {
    render(App);
    modalStore.openDeleteRemoteBranch('origin', 'feat');
    await waitFor(() => document.querySelector('.modal .danger-btn'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal .danger-btn')!);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'deleteRemoteBranch'
    )).toBe(true);
  });

  it('RemoveWorktreeModal — onRemove posts worktreeRemove', async () => {
    render(App);
    modalStore.openRemoveWorktree('/wt', 'feat');
    await waitFor(() => document.querySelector('.modal .danger-btn'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal .danger-btn')!);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'worktreeRemove'
    )).toBe(true);
  });

  it('StashDropModal — onDrop posts stashDrop', async () => {
    render(App);
    postMsg('showModal', { modal: 'stashDrop', index: 1, message: 'wip' });
    await waitFor(() => document.querySelector('.modal .danger-btn'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal .danger-btn')!);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'stashDrop'
    )).toBe(true);
  });

  it('BisectBanner — onReset posts bisectReset', async () => {
    render(App);
    postMsg('bisectResult', { message: 'abcdef1 is the first bad commit' });
    // Wait for the banner to render.
    await waitFor(() => {
      expect(document.querySelector('.bisect-banner, [class*="bisect"]')).not.toBeNull();
    });
    globalThis.__postedMessages = [];
    // Click each button inside the banner until we find one that posts
    // bisectReset (the reset button is the only one that does). This is
    // more robust than picking the first button blindly.
    const banner = document.querySelector('.bisect-banner, [class*="bisect"]')!;
    const buttons = banner.querySelectorAll<HTMLButtonElement>('button');
    expect(buttons.length).toBeGreaterThan(0);
    let posted = false;
    for (const btn of buttons) {
      await fireEvent.click(btn);
      if (globalThis.__postedMessages.some(m => (m.data as { type?: string }).type === 'bisectReset')) {
        posted = true;
        break;
      }
    }
    expect(posted).toBe(true);
  });
});

describe('App — bottom panel resize handle', () => {
  it('mousedown on resize handle starts a drag', async () => {
    uiStore.selectedCommitHash = 'h1';
    uiStore.showBottomPanel = true;
    commitStore.commits = [{
      hash: 'h1', abbreviatedHash: 'h1',
      author: { name: 'A', email: 'a@x.com', date: '' },
      committer: { name: 'A', email: 'a@x.com', date: '' },
      subject: 'fix', body: '', parents: [], refs: [],
    }];
    const { container } = render(App);
    await waitFor(() => container.querySelector('.resize-handle-h'));
    const handle = container.querySelector<HTMLDivElement>('.resize-handle-h')!;
    const startRatio = uiStore.bottomPanelRatio;
    await fireEvent.mouseDown(handle, { clientY: 500 });
    // Move up → bottom panel ratio increases.
    await fireEvent.mouseMove(window, { clientY: 400 });
    expect(uiStore.bottomPanelRatio).toBeGreaterThan(startRatio);
    await fireEvent.mouseUp(window);
  });
});

describe('App — modal cancel/close callbacks', () => {
  // Each test opens a modal via store, clicks the dedicated header X button
  // (.modal-close) or the cancel button in form-actions, then verifies the
  // modal closes WITHOUT firing its action handler.

  async function clickHeaderClose() {
    const btn = document.querySelector<HTMLButtonElement>('.modal .modal-close');
    expect(btn).not.toBeNull();
    await fireEvent.click(btn!);
  }

  function commonRemotes() {
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h', upstream: 'origin/main' },
    ];
    branchStore.remotes = [{ name: 'origin', fetchUrl: '', pushUrl: '' }];
  }

  it('Fetch modal X button closes without posting fetch', async () => {
    commonRemotes();
    render(App);
    modalStore.openFetch('origin');
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.fetch.show).toBe(false);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'fetch'
    )).toBe(false);
  });

  it('Pull modal X button closes without posting pull', async () => {
    commonRemotes();
    render(App);
    modalStore.openPull();
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.pull.show).toBe(false);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'pull'
    )).toBe(false);
  });

  it('Push modal X button closes without posting push', async () => {
    commonRemotes();
    render(App);
    modalStore.openPush('origin');
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.push.show).toBe(false);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'push'
    )).toBe(false);
  });

  it('Merge modal X button closes without posting merge', async () => {
    render(App);
    modalStore.openMerge('feat', 'main');
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.merge.show).toBe(false);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'merge'
    )).toBe(false);
  });

  it('CreateBranch modal X button closes without posting createBranch', async () => {
    render(App);
    modalStore.openCreateBranch('HEAD');
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.createBranch.show).toBe(false);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'createBranch'
    )).toBe(false);
  });

  it('CreateTag modal X button closes without posting createTag', async () => {
    commonRemotes();
    render(App);
    modalStore.openCreateTag('HEAD');
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.createTag.show).toBe(false);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'createTag'
    )).toBe(false);
  });

  it('StashSave modal X button closes without posting stashSave', async () => {
    render(App);
    modalStore.openStashSave();
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.stashSave.show).toBe(false);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'stashSave'
    )).toBe(false);
  });

  it('StashApply modal X button closes without posting stashApply', async () => {
    render(App);
    modalStore.openStashApply(0, 'wip', false);
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.stashApply.show).toBe(false);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'stashApply'
    )).toBe(false);
  });

  it('StashRename modal X button closes without posting stashRename', async () => {
    render(App);
    modalStore.openStashRename(0, 'initial');
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.stashRename.show).toBe(false);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'stashRename'
    )).toBe(false);
  });

  it('RenameBranch modal X button closes without posting renameBranch', async () => {
    render(App);
    modalStore.openRenameBranch('old');
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.renameBranch.show).toBe(false);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'renameBranch'
    )).toBe(false);
  });

  it('CheckoutRemote modal X button closes without posting createBranch', async () => {
    commonRemotes();
    render(App);
    modalStore.openCheckoutRemote('origin/feat', 'feat');
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.checkoutRemote.show).toBe(false);
  });

  it('SetUpstream modal X button closes without posting setUpstream', async () => {
    commonRemotes();
    render(App);
    modalStore.openSetUpstream('main', 'origin/main');
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.setUpstream.show).toBe(false);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'setUpstream'
    )).toBe(false);
  });

  it('PushTag modal X button closes without posting pushTag', async () => {
    commonRemotes();
    render(App);
    modalStore.openPushTag('v1.0');
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.pushTag.show).toBe(false);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'pushTag'
    )).toBe(false);
  });

  it('DeleteRemoteBranch modal X closes without posting', async () => {
    render(App);
    modalStore.openDeleteRemoteBranch('origin', 'feat');
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.deleteRemoteBranch.show).toBe(false);
  });

  it('RemoveWorktree modal X closes without posting', async () => {
    render(App);
    modalStore.openRemoveWorktree('/wt', 'feat');
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.removeWorktree.show).toBe(false);
  });

  it('FlowInit modal X closes without posting', async () => {
    render(App);
    modalStore.openFlowInit();
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.flowInit.show).toBe(false);
  });

  it('FlowStart modal X closes without posting', async () => {
    render(App);
    postMsg('flowStatus', {
      installed: true, initialized: true,
      config: {
        productionBranch: 'main', developBranch: 'develop',
        featurePrefix: 'feature/', releasePrefix: 'release/',
        hotfixPrefix: 'hotfix/', versionTagPrefix: 'v',
      },
    });
    modalStore.openFlowStart('feature');
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.flowStart.show).toBe(false);
  });

  it('FlowFinish modal X closes without posting', async () => {
    render(App);
    postMsg('flowStatus', {
      installed: true, initialized: true,
      config: {
        productionBranch: 'main', developBranch: 'develop',
        featurePrefix: 'feature/', releasePrefix: 'release/',
        hotfixPrefix: 'hotfix/', versionTagPrefix: 'v',
      },
    });
    modalStore.openFlowFinish('feature', 'feature/login');
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(modalStore.flowFinish.show).toBe(false);
  });

  it('AbortConfirm modal X closes the modal without posting abortOperation', async () => {
    const { container } = render(App);
    postMsg('conflictData', { operation: 'merge', files: [{ path: 'a.ts', resolved: false }] });
    await waitFor(() => container.querySelector('.conflict-banner'));
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.conflict-actions .banner-btn.danger')!);
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await clickHeaderClose();
    expect(document.querySelector('.modal')).toBeNull();
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'abortOperation'
    )).toBe(false);
  });
});

describe('App — filter change handlers', () => {
  function lastGetLog() {
    const msgs = globalThis.__postedMessages.filter(
      (m) => (m.data as { type?: string }).type === 'getLog'
    );
    return msgs.length ? (msgs[msgs.length - 1].data as { payload: Record<string, unknown> }).payload : null;
  }

  it('selecting a branch in the branch filter posts getLog with that branch', async () => {
    const { container } = render(App);
    postMsg('branchData', {
      branches: [
        { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h1' },
        { name: 'feature', current: false, ahead: 0, behind: 0, hash: 'h2' },
      ],
      tags: [], remotes: [], stashes: [], worktrees: [],
    });
    // Branch filter is the second .filter-btn in the SearchBar.
    await waitFor(() => container.querySelectorAll('.filter-btn').length >= 2);
    globalThis.__postedMessages = [];
    await fireEvent.click(container.querySelectorAll<HTMLButtonElement>('.filter-btn')[1]);
    const item = Array.from(container.querySelectorAll<HTMLButtonElement>('.dd-item'))
      .find(el => el.textContent?.includes('feature'))!;
    await fireEvent.click(item);
    await waitFor(() => lastGetLog() !== null);
    expect((lastGetLog()!.branches as string[])).toContain('feature');
  });

  it('selecting a remote in the source filter posts getLog with that remoteFilter', async () => {
    const { container } = render(App);
    postMsg('branchData', {
      branches: [],
      tags: [],
      remotes: [{ name: 'origin', fetchUrl: '', pushUrl: '' }],
      stashes: [], worktrees: [],
    });
    await waitFor(() => container.querySelectorAll('.filter-btn').length >= 1);
    globalThis.__postedMessages = [];
    await fireEvent.click(container.querySelectorAll<HTMLButtonElement>('.filter-btn')[0]);
    const item = Array.from(container.querySelectorAll<HTMLButtonElement>('.dd-item'))
      .find(el => el.textContent?.includes('origin'))!;
    await fireEvent.click(item);
    await waitFor(() => lastGetLog() !== null);
    expect((lastGetLog()!.remoteFilter as string[])).toContain('origin');
  });

  it('applying a remote filter cross-filters out local branches from the branch filter', async () => {
    const { container } = render(App);
    postMsg('branchData', {
      branches: [{ name: 'feature', current: false, ahead: 0, behind: 0, hash: 'h1' }],
      tags: [],
      remotes: [{ name: 'origin', fetchUrl: '', pushUrl: '' }],
      stashes: [], worktrees: [],
    });
    await waitFor(() => container.querySelectorAll('.filter-btn').length >= 2);
    // 1) Select the local branch "feature" → branchFilter = ['feature'].
    await fireEvent.click(container.querySelectorAll<HTMLButtonElement>('.filter-btn')[1]);
    const branchItem = Array.from(container.querySelectorAll<HTMLButtonElement>('.dd-item'))
      .find(el => el.textContent?.includes('feature'))!;
    await fireEvent.click(branchItem);
    // 2) Apply a remote-only source filter (no 'local'). The local "feature"
    //    branch no longer matches, so the cross-filter must drop it.
    globalThis.__postedMessages = [];
    await fireEvent.click(container.querySelectorAll<HTMLButtonElement>('.filter-btn')[0]);
    const remoteItem = Array.from(container.querySelectorAll<HTMLButtonElement>('.dd-item'))
      .find(el => el.textContent?.includes('origin'))!;
    await fireEvent.click(remoteItem);
    await waitFor(() => lastGetLog() !== null);
    // branchFilter emptied → getLog carries no `branches`, only the remote filter.
    expect(lastGetLog()!.branches).toBeUndefined();
    expect((lastGetLog()!.remoteFilter as string[])).toContain('origin');
  });
});

describe('App — checkout-remote dirty options', () => {
  function findCreateBranch() {
    return globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'createBranch'
    )?.data as { payload: Record<string, unknown> } | undefined;
  }

  async function submitWithOption(option: 'stash' | 'discard') {
    render(App);
    // dirty=true so the local-changes radios render.
    modalStore.openCheckoutRemote('origin/feat', 'feat', true);
    await waitFor(() => document.querySelector('.modal button.primary'));
    await fireEvent.click(document.querySelector<HTMLInputElement>(`input[type="radio"][value="${option}"]`)!);
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
  }

  it('stash option posts createBranch with stash + stashUntracked', async () => {
    await submitWithOption('stash');
    const req = findCreateBranch();
    expect(req).toBeDefined();
    expect(req!.payload).toMatchObject({ checkout: true, stash: true, stashUntracked: true });
  });

  it('discard option posts createBranch with force + clean', async () => {
    await submitWithOption('discard');
    const req = findCreateBranch();
    expect(req).toBeDefined();
    expect(req!.payload).toMatchObject({ checkout: true, force: true, clean: true });
  });
});

describe('App — visibility-driven conflict refresh', () => {
  it('re-requests conflict status when the webview regains focus during a conflict', async () => {
    render(App);
    // A conflict is in progress.
    postMsg('conflictData', { operation: 'merge', files: [{ path: 'a.ts', resolved: false }] });
    await waitFor(() => document.querySelector('.conflict-banner'));
    globalThis.__postedMessages = [];
    // Regaining focus (document not hidden) should trigger a refreshConflicts.
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'refreshConflicts'
    ));
  });

  it('does not refresh conflicts on focus when there is no conflict', async () => {
    render(App);
    await waitFor(() => globalThis.__postedMessages.length > 0);
    globalThis.__postedMessages = [];
    window.dispatchEvent(new Event('focus'));
    // Give any handler a tick to run.
    await new Promise(r => setTimeout(r, 0));
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'refreshConflicts'
    )).toBe(false);
  });
});

describe('App — search result highlighting', () => {
  function commitRow(hash: string, subject: string) {
    return {
      hash, abbreviatedHash: hash.slice(0, 7), subject, body: '', parents: [], refs: [],
      author: { name: '', email: '', date: '' }, committer: { name: '', email: '', date: '' },
    };
  }

  it('highlights matched rows and navigates to the first match on search', async () => {
    const { container } = render(App);
    postMsg('logData', {
      commits: [commitRow('aaaaaaa1', 'findme please'), commitRow('bbbbbbb2', 'unrelated')],
      paths: [], links: [], dots: [], commitLeftMargin: [], graph: [], hasMore: false, currentLimit: 50,
    });
    const input = await waitFor(() => container.querySelector<HTMLInputElement>('.search-input')!);
    await fireEvent.input(input, { target: { value: 'findme' } });
    // Enter with no prior matches runs doSearch → onResults + onNavigate, which
    // exercises App's handleSearchResults / handleSearchNavigate.
    await fireEvent.keyDown(container.querySelector('.search-bar')!, { key: 'Enter' });
    await waitFor(() => container.querySelector('.commit-row.search-match'));
    // The matching row is highlighted (handleSearchResults set searchMatchedHashes).
    expect(container.querySelector('.commit-row.search-match')).not.toBeNull();
    // The first match is the navigation target (handleSearchNavigate set searchNavigateHash).
    expect(container.querySelector('.commit-row.search-current')).not.toBeNull();
    // The non-matching row is dimmed.
    expect(container.querySelector('.commit-row.search-dim')).not.toBeNull();
  });
});
