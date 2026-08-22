import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import Toolbar from '../Toolbar.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';
import { branchStore } from '../../../lib/stores/branches.svelte';
import { uiStore } from '../../../lib/stores/ui.svelte';
import { modalStore } from '../../../lib/stores/modals.svelte';

// Toolbar buttons are located by their codicon (or wrapper) instead of by
// position, so reordering the toolbar doesn't break these tests.
const toolbarBtns = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLButtonElement>('.toolbar-btn'));
const iconBtn = (c: HTMLElement, icon: string) =>
  toolbarBtns(c).find(b => b.querySelector(`.codicon-${icon}`))!;
const getFetch = (c: HTMLElement) => iconBtn(c, 'cloud-download');
const getPull = (c: HTMLElement) => iconBtn(c, 'arrow-down');
const getPush = (c: HTMLElement) => iconBtn(c, 'arrow-up');
const getOpenRemote = (c: HTMLElement) => iconBtn(c, 'globe');
const getRefresh = (c: HTMLElement) => iconBtn(c, 'refresh');
const getStash = (c: HTMLElement) => iconBtn(c, 'archive');
const getFlow = (c: HTMLElement) =>
  c.querySelector<HTMLButtonElement>('.flow-wrapper .split-chevron')!;

function resetStores() {
  branchStore.branches = [];
  branchStore.tags = [];
  branchStore.remotes = [];
  branchStore.stashes = [];
  branchStore.worktrees = [];
  uiStore.viewMode = 'graph';
  uiStore.operating = null;
  uiStore.repos = [];
  uiStore.activeRepo = '';
  modalStore.closeFetch?.();
  modalStore.closePull?.();
  modalStore.closePush?.();
}

beforeEach(() => {
  i18n.setLocale('en');
  resetStores();
  globalThis.__postedMessages = [];
});

describe('Toolbar — view tabs', () => {
  it('renders the three view-mode tabs and graph is active by default', () => {
    const { container } = render(Toolbar);
    const tabs = container.querySelectorAll<HTMLButtonElement>('.view-tab');
    expect(tabs.length).toBe(3);
    expect(tabs[0].classList.contains('active')).toBe(true);
  });

  it('clicking a tab switches the uiStore.viewMode', async () => {
    const { container } = render(Toolbar);
    const tabs = container.querySelectorAll<HTMLButtonElement>('.view-tab');
    await fireEvent.click(tabs[1]); // log
    expect(uiStore.viewMode).toBe('log');
    await fireEvent.click(tabs[2]); // stats
    expect(uiStore.viewMode).toBe('stats');
    await fireEvent.click(tabs[0]); // back to graph
    expect(uiStore.viewMode).toBe('graph');
  });
});

describe('Toolbar — fetch / pull / push', () => {
  it('fetch button with no remotes opens NoRemotesErrorModal', async () => {
    const { container } = render(Toolbar);
    await fireEvent.click(getFetch(container));
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/no remotes|add remote/i);
    });
  });

  it('fetch button with multiple remotes opens the fetch modal via modalStore', async () => {
    branchStore.remotes = [
      { name: 'origin', fetchUrl: '', pushUrl: '' },
      { name: 'upstream', fetchUrl: '', pushUrl: '' },
    ];
    const openFetch = vi.spyOn(modalStore, 'openFetch');
    const { container } = render(Toolbar);
    await fireEvent.click(getFetch(container));
    expect(openFetch).toHaveBeenCalledWith('origin');
  });

  it('fetch button with a single remote fetches directly without opening the modal', async () => {
    branchStore.remotes = [{ name: 'origin', fetchUrl: '', pushUrl: '' }];
    const openFetch = vi.spyOn(modalStore, 'openFetch');
    const { container } = render(Toolbar);
    globalThis.__postedMessages = [];
    await fireEvent.click(getFetch(container));
    expect(openFetch).not.toHaveBeenCalled();
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'fetch'
    );
    expect(req).toBeDefined();
    expect((req!.data as { payload: { remote: string; prune: boolean } }).payload).toEqual({
      remote: 'origin', prune: true,
    });
    expect(uiStore.operating).toBe('fetch');
  });

  it('pull button calls modalStore.openPull', async () => {
    const openPull = vi.spyOn(modalStore, 'openPull');
    const { container } = render(Toolbar);
    await fireEvent.click(getPull(container));
    expect(openPull).toHaveBeenCalled();
  });

  it('push button with no remotes opens the no-remotes modal', async () => {
    const { container } = render(Toolbar);
    await fireEvent.click(getPush(container));
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/no remotes|add remote/i);
    });
  });

  it('push button with remotes calls modalStore.openPush', async () => {
    branchStore.remotes = [{ name: 'origin', fetchUrl: '', pushUrl: '' }];
    const openPush = vi.spyOn(modalStore, 'openPush');
    const { container } = render(Toolbar);
    await fireEvent.click(getPush(container));
    expect(openPush).toHaveBeenCalledWith('origin');
  });
});

describe('Toolbar — open remote repository', () => {
  it('open remote button with no remotes opens NoRemotesErrorModal', async () => {
    const { container } = render(Toolbar);
    await fireEvent.click(getOpenRemote(container));
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/no remotes|add remote/i);
    });
  });

  it('open remote button prefers origin when available', async () => {
    branchStore.remotes = [
      { name: 'upstream', fetchUrl: '', pushUrl: '' },
      { name: 'origin', fetchUrl: '', pushUrl: '' },
    ];
    const { container } = render(Toolbar);
    globalThis.__postedMessages = [];
    await fireEvent.click(getOpenRemote(container));
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'openRemoteRepository'
    );
    expect(req).toBeDefined();
    expect((req!.data as { payload: { remote: string } }).payload).toEqual({
      remote: 'origin',
    });
  });

  it('open remote button falls back to the first remote', async () => {
    branchStore.remotes = [
      { name: 'upstream', fetchUrl: '', pushUrl: '' },
      { name: 'fork', fetchUrl: '', pushUrl: '' },
    ];
    const { container } = render(Toolbar);
    globalThis.__postedMessages = [];
    await fireEvent.click(getOpenRemote(container));
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'openRemoteRepository'
    );
    expect(req).toBeDefined();
    expect((req!.data as { payload: { remote: string } }).payload).toEqual({
      remote: 'upstream',
    });
  });
});

describe('Toolbar — refresh', () => {
  it('refresh button calls onRefresh and flips operating to "refresh"', async () => {
    const onRefresh = vi.fn();
    const { container } = render(Toolbar, { onRefresh });
    await fireEvent.click(getRefresh(container));
    expect(onRefresh).toHaveBeenCalled();
    expect(uiStore.operating).toBe('refresh');
  });

  it('disables toolbar buttons while operating', async () => {
    uiStore.operating = 'refresh';
    const { container } = render(Toolbar);
    // The settings gear is always enabled; every operation button is disabled.
    toolbarBtns(container).forEach(b => {
      if (b.querySelector('.codicon-gear')) return;
      expect(b.disabled).toBe(true);
    });
  });

  it('logData message clears operating=refresh', async () => {
    uiStore.operating = 'refresh';
    render(Toolbar);
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'logData' } }));
    await waitFor(() => {
      expect(uiStore.operating).toBeNull();
    });
  });

  it('operationComplete clears any operating state', async () => {
    uiStore.operating = 'fetch';
    render(Toolbar);
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'operationComplete' } }));
    await waitFor(() => {
      expect(uiStore.operating).toBeNull();
    });
  });
});

describe('Toolbar — settings', () => {
  it('settings gear posts openExtensionSettings and stays enabled while operating', async () => {
    uiStore.operating = 'fetch';
    const { container } = render(Toolbar);
    const gear = iconBtn(container, 'gear');
    expect(gear.disabled).toBe(false);
    globalThis.__postedMessages = [];
    await fireEvent.click(gear);
    const types = globalThis.__postedMessages.map(m => (m.data as { type?: string }).type);
    expect(types).toContain('openExtensionSettings');
  });
});

describe('Toolbar — branch badges', () => {
  it('pull badge shows the behind count when current branch is behind', () => {
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 3, hash: 'h', upstream: 'origin/main' },
    ];
    const { container } = render(Toolbar);
    expect(container.querySelector('.pull-badge')?.textContent).toBe('3');
  });

  it('push badge shows the ahead count when current branch is ahead', () => {
    branchStore.branches = [
      { name: 'main', current: true, ahead: 5, behind: 0, hash: 'h', upstream: 'origin/main' },
    ];
    const { container } = render(Toolbar);
    expect(container.querySelector('.push-badge')?.textContent).toBe('5');
  });

  it('renders the unpublished icon when current branch has no upstream', () => {
    branchStore.branches = [
      { name: 'feat', current: true, ahead: 0, behind: 0, hash: 'h' },
    ];
    const { container } = render(Toolbar);
    expect(container.querySelector('.unpublished-icon')).not.toBeNull();
  });

  it('renders the unpublished icon when the upstream is gone (remote branch deleted)', () => {
    branchStore.branches = [
      { name: 'feat', current: true, ahead: 0, behind: 0, hash: 'h', upstream: 'origin/feat', upstreamGone: true },
    ];
    const { container } = render(Toolbar);
    expect(container.querySelector('.unpublished-icon')).not.toBeNull();
  });

  it('shows only the short SHA with a commit icon when HEAD is detached', () => {
    branchStore.branches = [
      { name: '(HEAD detached at abc1234)', current: true, ahead: 0, behind: 0, hash: 'abc1234def567' },
    ];
    const { container } = render(Toolbar);
    const text = container.querySelector('.branch-name')?.textContent?.trim() ?? '';
    expect(text).toBe('abc1234');
    expect(container.querySelector('.branch-icon')?.classList).toContain('codicon-git-commit');
  });

  it('shows only the short SHA for non-branch HEAD states (rebasing, bisect)', () => {
    for (const name of ['(no branch, rebasing main)', '(no branch, bisect started on main)']) {
      branchStore.branches = [{ name, current: true, ahead: 0, behind: 0, hash: 'abc1234def567' }];
      const { container, unmount } = render(Toolbar);
      const text = container.querySelector('.branch-name')?.textContent?.trim() ?? '';
      expect(text).toBe('abc1234');
      expect(text).not.toContain('no branch');
      unmount();
    }
  });
});

describe('Toolbar — repo dropdown', () => {
  it('shows the active repo name', () => {
    uiStore.repos = [{ path: '/repo/main', name: 'main-repo', type: 'root' }];
    uiStore.activeRepo = '/repo/main';
    const { container } = render(Toolbar);
    expect(container.querySelector('.repo-name')?.textContent?.trim()).toBe('main-repo');
  });

  it('chevron and dropdown appear only with multiple repos', async () => {
    uiStore.repos = [
      { path: '/r/a', name: 'a', type: 'root' },
      { path: '/r/b', name: 'b', type: 'submodule' },
    ];
    uiStore.activeRepo = '/r/a';
    const { container } = render(Toolbar);
    expect(container.querySelector('.repo-chevron')).not.toBeNull();
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.repo-pill')!);
    expect(container.querySelector('.repo-dropdown')).not.toBeNull();
  });

  it('selecting a repo from the dropdown posts a switchRepo message', async () => {
    uiStore.repos = [
      { path: '/r/a', name: 'a', type: 'root' },
      { path: '/r/b', name: 'b', type: 'submodule' },
    ];
    uiStore.activeRepo = '/r/a';
    const { container } = render(Toolbar);
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.repo-pill')!);
    const items = container.querySelectorAll<HTMLButtonElement>('.repo-dropdown-item');
    globalThis.__postedMessages = [];
    await fireEvent.click(items[1]);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'switchRepo'
    );
    expect((req!.data as { payload: { path: string } }).payload.path).toBe('/r/b');
  });
});

describe('Toolbar — flow dropdown', () => {
  it('opening the flow dropdown posts checkFlowStatus and getFlowBranches', async () => {
    const { container } = render(Toolbar);
    globalThis.__postedMessages = [];
    await fireEvent.click(getFlow(container));
    const types = globalThis.__postedMessages.map(m => (m.data as { type?: string }).type);
    expect(types).toContain('checkFlowStatus');
    expect(types).toContain('getFlowBranches');
  });

  it('flow not initialized renders an "Initialize" button', async () => {
    const { container } = render(Toolbar);
    await fireEvent.click(getFlow(container));
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'flowStatus', payload: { installed: true, initialized: false } },
    }));
    await waitFor(() => {
      expect(container.querySelector('.flow-dropdown')?.textContent?.toLowerCase()).toContain('initialize');
    });
  });

  it('flow initialized renders feature/release/hotfix start buttons', async () => {
    const { container } = render(Toolbar);
    await fireEvent.click(getFlow(container));
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'flowStatus', payload: { installed: true, initialized: true } },
    }));
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'flowBranches', payload: { features: [], releases: [], hotfixes: [] } },
    }));
    await waitFor(() => {
      const text = container.querySelector('.flow-dropdown')?.textContent ?? '';
      expect(text.toLowerCase()).toMatch(/feature|release|hotfix/);
    });
  });
});

describe('Toolbar — repo dropdown backdrop and flow buttons', () => {
  it('repo dropdown backdrop click closes the dropdown', async () => {
    uiStore.repos = [
      { path: '/r/a', name: 'a', type: 'root' },
      { path: '/r/b', name: 'b', type: 'submodule' },
    ];
    uiStore.activeRepo = '/r/a';
    const { container } = render(Toolbar);
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.repo-pill')!);
    expect(container.querySelector('.repo-dropdown')).not.toBeNull();
    await fireEvent.click(container.querySelector<HTMLDivElement>('.repo-dropdown-backdrop')!);
    expect(container.querySelector('.repo-dropdown')).toBeNull();
  });

  it('flow dropdown backdrop click closes the dropdown', async () => {
    const { container } = render(Toolbar);
    await fireEvent.click(getFlow(container)); // flow button
    expect(container.querySelector('.flow-dropdown')).not.toBeNull();
    await fireEvent.click(container.querySelector<HTMLDivElement>('.flow-dropdown-backdrop')!);
    expect(container.querySelector('.flow-dropdown')).toBeNull();
  });

  it('"Initialize" button in flow dropdown opens FlowInit modal', async () => {
    const openFlowInit = vi.spyOn(modalStore, 'openFlowInit');
    const { container } = render(Toolbar);
    await fireEvent.click(getFlow(container));
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'flowStatus', payload: { installed: true, initialized: false } },
    }));
    await waitFor(() => {
      const init = Array.from(container.querySelectorAll<HTMLButtonElement>('.flow-dropdown-item'))
        .find(b => /initialize/i.test(b.textContent ?? ''));
      expect(init).not.toBeUndefined();
    });
    const initBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.flow-dropdown-item'))
      .find(b => /initialize/i.test(b.textContent ?? ''))!;
    await fireEvent.click(initBtn);
    expect(openFlowInit).toHaveBeenCalled();
  });

  it('clicking "Start Feature/Release/Hotfix" opens the FlowStart modal', async () => {
    const openFlowStart = vi.spyOn(modalStore, 'openFlowStart');
    const { container } = render(Toolbar);

    async function clickItem(matcher: (text: string) => boolean) {
      await fireEvent.click(getFlow(container)); // open dropdown
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'flowStatus', payload: { installed: true, initialized: true } },
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'flowBranches', payload: { features: [], releases: [], hotfixes: [] } },
      }));
      await waitFor(() => {
        expect(container.querySelectorAll('.flow-dropdown-item').length).toBeGreaterThan(0);
      });
      const target = Array.from(container.querySelectorAll<HTMLButtonElement>('.flow-dropdown-item'))
        .find(i => matcher(i.textContent ?? ''));
      expect(target).not.toBeUndefined();
      await fireEvent.click(target!);
    }

    await clickItem(t => /feature/i.test(t) && !/finish/i.test(t));
    expect(openFlowStart).toHaveBeenLastCalledWith('feature');
    await clickItem(t => /release/i.test(t) && !/finish/i.test(t));
    expect(openFlowStart).toHaveBeenLastCalledWith('release');
    await clickItem(t => /hotfix/i.test(t) && !/finish/i.test(t));
    expect(openFlowStart).toHaveBeenLastCalledWith('hotfix');
  });

  it('FlowFinish submenu items open the FlowFinish modal with branch name', async () => {
    const openFlowFinish = vi.spyOn(modalStore, 'openFlowFinish');
    const { container } = render(Toolbar);

    async function clickBranchItem(branchName: string) {
      await fireEvent.click(getFlow(container));
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'flowStatus', payload: { installed: true, initialized: true } },
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'flowBranches', payload: {
          features: ['feature/login'],
          releases: ['release/1.0'],
          hotfixes: ['hotfix/2.1'],
        } },
      }));
      await waitFor(() => {
        expect(container.querySelector('.flow-dropdown')?.textContent ?? '').toContain(branchName);
      });
      const target = Array.from(container.querySelectorAll<HTMLButtonElement>('.flow-dropdown-item'))
        .find(i => i.textContent?.trim() === branchName)!;
      await fireEvent.click(target);
    }

    await clickBranchItem('feature/login');
    expect(openFlowFinish).toHaveBeenLastCalledWith('feature', 'feature/login');
    await clickBranchItem('release/1.0');
    expect(openFlowFinish).toHaveBeenLastCalledWith('release', 'release/1.0');
    await clickBranchItem('hotfix/2.1');
    expect(openFlowFinish).toHaveBeenLastCalledWith('hotfix', 'hotfix/2.1');
  });
});

describe('Toolbar — no-remotes error modal', () => {
  it('Add Remote button in the error modal closes the error and opens AddRemoteModal', async () => {
    const { container } = render(Toolbar);
    // Fetch with no remotes opens the no-remotes error modal
    await fireEvent.click(getFetch(container));
    await waitFor(() => {
      const text = document.body.textContent ?? '';
      expect(text).toMatch(/add remote/i);
    });
    // Click the primary (Add Remote) button in the modal
    const primary = container.querySelector<HTMLButtonElement>('button.primary');
    expect(primary).not.toBeNull();
    await fireEvent.click(primary!);
    await waitFor(() => {
      // AddRemoteModal renders inputs labelled "name" and "url"
      const inputs = container.querySelectorAll('input.modal-input');
      expect(inputs.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('cancel on the error modal closes it without opening AddRemote', async () => {
    const { container } = render(Toolbar);
    await fireEvent.click(getFetch(container));
    await waitFor(() => container.querySelector('button.primary'));
    // The first non-X button in the form-actions is cancel
    const actionBtns = container.querySelectorAll<HTMLButtonElement>('.form-actions button');
    await fireEvent.click(actionBtns[0]);
    await waitFor(() => {
      expect(container.querySelector('button.primary')).toBeNull();
    });
  });
});

describe('Toolbar — AddRemote modal flow', () => {
  it('submitting AddRemote modal closes it and posts addRemote', async () => {
    const { container } = render(Toolbar);
    // Trigger the no-remotes error path
    await fireEvent.click(getFetch(container));
    await waitFor(() => container.querySelector('button.primary'));
    // Click "Add Remote" in the error modal
    await fireEvent.click(container.querySelector<HTMLButtonElement>('button.primary')!);
    await waitFor(() => {
      const inputs = container.querySelectorAll('input.modal-input');
      expect(inputs.length).toBeGreaterThanOrEqual(2);
    });
    const inputs = container.querySelectorAll<HTMLInputElement>('input.modal-input');
    await fireEvent.input(inputs[0], { target: { value: 'upstream' } });
    await fireEvent.input(inputs[1], { target: { value: 'https://github.com/x/y.git' } });
    globalThis.__postedMessages = [];
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.modal button.primary')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'addRemote'
    );
    expect(req).toBeDefined();
    expect((req!.data as { payload: { name: string; url: string } }).payload).toEqual({
      name: 'upstream', url: 'https://github.com/x/y.git',
    });
    // Modal should close after submit
    await waitFor(() => {
      expect(container.querySelector('input.modal-input')).toBeNull();
    });
  });

  it('AddRemote modal X button closes the modal without posting', async () => {
    const { container } = render(Toolbar);
    await fireEvent.click(getFetch(container));
    await waitFor(() => container.querySelector('button.primary'));
    await fireEvent.click(container.querySelector<HTMLButtonElement>('button.primary')!);
    await waitFor(() => container.querySelector('input.modal-input'));
    globalThis.__postedMessages = [];
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.modal .modal-close')!);
    await waitFor(() => {
      expect(container.querySelector('input.modal-input')).toBeNull();
    });
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'addRemote'
    )).toBe(false);
  });
});

describe('Toolbar — stash', () => {
  it('stash button calls modalStore.openStashSave', async () => {
    const openStashSave = vi.spyOn(modalStore, 'openStashSave');
    const { container } = render(Toolbar);
    await fireEvent.click(getStash(container));
    expect(openStashSave).toHaveBeenCalled();
  });
});

describe('Toolbar — repository dropdown path matching (issue #30)', () => {
  it('shows the active repo when its path format differs from the list (Windows)', () => {
    // List paths come from `git rev-parse --show-toplevel` (forward slashes);
    // the active path comes from VS Code fsPath (backslashes). They must still match.
    uiStore.repos = [
      { path: 'c:/Users/me/alpha', name: 'alpha', type: 'root' },
      { path: 'c:/Users/me/projB', name: 'projB', type: 'root' },
    ];
    uiStore.activeRepo = 'c:\\Users\\me\\projB';

    const { container } = render(Toolbar);
    const name = container.querySelector('.repo-name')?.textContent?.trim();
    // Before the fix this fell back to repos[0] ('alpha').
    expect(name).toBe('projB');
  });

  it('marks the matching dropdown item active despite separator differences', async () => {
    uiStore.repos = [
      { path: 'c:/Users/me/alpha', name: 'alpha', type: 'root' },
      { path: 'c:/Users/me/projB', name: 'projB', type: 'root' },
    ];
    uiStore.activeRepo = 'c:\\Users\\me\\projB';

    const { container } = render(Toolbar);
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.repo-pill')!);
    const activeItem = container.querySelector('.repo-dropdown-item.active .repo-dropdown-item-name');
    expect(activeItem?.textContent?.trim()).toBe('projB');
  });
});
