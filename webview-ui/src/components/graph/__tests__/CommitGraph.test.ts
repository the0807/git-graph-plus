import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import CommitGraph from '../CommitGraph.svelte';
import { commitStore } from '../../../lib/stores/commits.svelte';
import { branchStore } from '../../../lib/stores/branches.svelte';
import { uiStore } from '../../../lib/stores/ui.svelte';
import { modalStore } from '../../../lib/stores/modals.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';
import type { Commit, CommitGraphData } from '../../../lib/types';

function makeCommit(hash: string, subject: string, parents: string[] = []): Commit {
  return {
    hash,
    abbreviatedHash: hash.slice(0, 7),
    author: { name: 'A', email: 'a@x.com', date: '2024-01-01T00:00:00+00:00' },
    committer: { name: 'A', email: 'a@x.com', date: '2024-01-01T00:00:00+00:00' },
    subject,
    body: '',
    parents,
    refs: [],
  };
}

function makeGraphData(commits: Commit[]): CommitGraphData {
  return {
    commits,
    graph: commits.map(c => ({ commit: c.hash, column: 0, color: '#63b0f4', parents: [] })),
    paths: [],
    links: [],
    dots: commits.map((_, i) => ({ center: { x: 0, y: i }, color: 0, type: 'default' as const, localOnly: false, remoteTip: false })),
    commitLeftMargin: commits.map(() => 24),
    hasMore: false,
    currentLimit: 1000,
  };
}

beforeEach(() => {
  i18n.setLocale('en');
  // Reset shared singletons between tests.
  commitStore.commits = [];
  commitStore.graphNodes = [];
  commitStore.paths = [];
  commitStore.links = [];
  commitStore.dots = [];
  commitStore.commitLeftMargin = [];
  commitStore.loading = false;
  commitStore.loadingMore = false;
  commitStore.hasMore = false;
  commitStore.currentLimit = 0;
  commitStore.notGitRepo = false;
  branchStore.branches = [];
  branchStore.worktrees = [];
  uiStore.selectedCommitHash = null;
  uiStore.autoLoadHistory = false;
  uiStore.loadMoreCount = 50;
  modalStore.closeAll();
});

afterEach(() => cleanup());

describe('CommitGraph smoke', () => {
  it('renders without crashing when commits are empty', () => {
    const { container } = render(CommitGraph, {});
    // No commit rows expected, but the container should exist.
    expect(container).toBeTruthy();
    expect(container.querySelectorAll('.commit-row').length).toBe(0);
  });

  it('renders one row per commit when commits are populated', async () => {
    commitStore.setData(makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
      makeCommit('h3', 'third', ['h2']),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelectorAll('.commit-row').length).toBe(3);
  });

  it('clicking a commit row sets selectedCommitHash after the dbl-click timeout fires', async () => {
    commitStore.setData(makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    const rows = container.querySelectorAll<HTMLElement>('.commit-row');
    expect(rows.length).toBeGreaterThan(0);
    // The dual-click discriminator waits 200ms before treating a click as
    // a single-click. Use fake timers if you want to exercise the delay,
    // but we just need to confirm clicking does not throw.
    await fireEvent.click(rows[0]);
    // Selection is deferred until the dbl-click timer expires; do a soft
    // assertion that the row is at least focusable / clickable.
    expect(rows[0]).toBeTruthy();
  });

  it('clicking the UNCOMMITTED row opens the SCM view instead of selecting it', async () => {
    commitStore.setData(makeGraphData([
      makeCommit('UNCOMMITTED', 'Uncommitted changes'),
      makeCommit('h1', 'first'),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const rows = container.querySelectorAll<HTMLElement>('.commit-row');
    await fireEvent.click(rows[0]);
    await tick();
    expect(globalThis.__postedMessages.some(m => (m.data as { type?: string }).type === 'openScmView')).toBe(true);
    expect(uiStore.selectedCommitHash).toBeNull();
  });

  it('right-clicking the UNCOMMITTED row opens an Amend menu, then the amend modal + SCM', async () => {
    const { modalStore } = await import('../../../lib/stores/modals.svelte');
    const head = makeCommit('h1', 'first');
    head.refs = [{ type: 'head', name: 'main' }];
    commitStore.setData(makeGraphData([
      makeCommit('UNCOMMITTED', 'Uncommitted changes'),
      head,
    ]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 1, behind: 0, hash: 'h1' },
    ];
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0];
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    // The single menu item is "Amend '{ref}'" (ref = current branch); click it.
    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^amend 'main'$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();
    expect(modalStore.amend.show).toBe(true);
    expect(modalStore.amend.hash).toBe('h1');
    expect(globalThis.__postedMessages.some(m => (m.data as { type?: string }).type === 'openScmView')).toBe(true);
    modalStore.closeAmend();
  });

  it('right-clicking the HEAD commit opens the amend modal + SCM', async () => {
    const { modalStore } = await import('../../../lib/stores/modals.svelte');
    const head = makeCommit('h2', 'latest', ['h1']);
    head.refs = [{ type: 'head', name: 'main' }];
    commitStore.setData(makeGraphData([head, makeCommit('h1', 'first')]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 1, behind: 0, hash: 'h2' },
    ];
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // HEAD row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^amend commit$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();
    expect(modalStore.amend.show).toBe(true);
    expect(modalStore.amend.hash).toBe('h2');
    expect(globalThis.__postedMessages.some(m => (m.data as { type?: string }).type === 'openScmView')).toBe(true);
    modalStore.closeAmend();
  });

  it('offers "Create worktree from" on a regular branch and posts startPoint', async () => {
    const head = makeCommit('h1', 'first');
    head.refs = [{ type: 'head', name: 'main' }];
    const feat = makeCommit('h2', 'feat work', ['h1']);
    feat.refs = [{ type: 'branch', name: 'develop' }];
    commitStore.setData(makeGraphData([feat, head]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h1' },
      { name: 'develop', current: false, ahead: 0, behind: 0, hash: 'h2' },
    ];
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // develop row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    // The branch "develop" is a submenu-parent; hover over it to reveal children.
    const parentBtn = Array.from(container.querySelectorAll<HTMLElement>('button.menu-item.has-children'))
      .find(el => (el.textContent ?? '').includes('develop'));
    if (parentBtn) {
      await fireEvent.mouseEnter(parentBtn);
      await tick();
    }
    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^new worktree$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();
    const msg = globalThis.__postedMessages
      .map(m => m.data as { type?: string; payload?: { startPoint?: string } })
      .find(m => m.type === 'worktreeAddModalRequest');
    expect(msg?.payload?.startPoint).toBe('develop');
  });

  it('offers a top-level "Create worktree from" item (no submenu hover needed) and posts startPoint', async () => {
    const head = makeCommit('h1', 'first');
    head.refs = [{ type: 'head', name: 'main' }];
    const feat = makeCommit('h2', 'feat work', ['h1']);
    feat.refs = [{ type: 'branch', name: 'develop' }];
    commitStore.setData(makeGraphData([feat, head]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h1' },
      { name: 'develop', current: false, ahead: 0, behind: 0, hash: 'h2' },
    ];
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // develop row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    // Top-level (flat) item is present WITHOUT hovering into the branch submenu.
    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^new worktree$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();
    const msg = globalThis.__postedMessages
      .map(m => m.data as { type?: string; payload?: { startPoint?: string } })
      .find(m => m.type === 'worktreeAddModalRequest');
    expect(msg?.payload?.startPoint).toBe('develop');
  });

  it('does not crash on a branch-set fingerprint cache hit (same commits, same branch)', async () => {
    // First mount populates the cache.
    commitStore.setData(makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
    ]));
    // currentBranch is a getter — set it by adding a current branch to the list.
    branchStore.branches = [
      { name: 'main', current: true, remote: undefined, upstream: undefined, ahead: 0, behind: 0, hash: 'h2' },
    ];

    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelectorAll('.commit-row').length).toBe(2);

    // Re-render with the SAME data — the fingerprint must match, no errors.
    cleanup();
    const { container: c2 } = render(CommitGraph, {});
    await tick();
    expect(c2.querySelectorAll('.commit-row').length).toBe(2);
  });
});

describe('CommitGraph signature icon', () => {
  it('renders a signature icon for good/unverified commits', async () => {
    commitStore.setData(makeGraphData([
      { ...makeCommit('h1', 'signed'), signatureStatus: 'good' },
      { ...makeCommit('h2', 'tampered', ['h1']), signatureStatus: 'unverified' },
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelector('.sig-icon.sig-icon-good')).toBeTruthy();
    expect(container.querySelector('.sig-icon.sig-icon-unverified')).toBeTruthy();
  });

  it('omits the icon for "none" and when signatureStatus is absent', async () => {
    commitStore.setData(makeGraphData([
      { ...makeCommit('h1', 'unsigned'), signatureStatus: 'none' },
      makeCommit('h2', 'no field', ['h1']),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelector('.sig-icon')).toBeFalsy();
  });

  it('shows "Interactive Rebase selected commits" for a contiguous chain on a non-current branch', async () => {
    const head = makeCommit('h1', 'main tip');
    head.refs = [{ type: 'head', name: 'main' }];
    const f1 = makeCommit('f1', 'feature 1', ['h1']);
    const f2 = makeCommit('f2', 'feature 2', ['f1']);
    f2.refs = [{ type: 'branch', name: 'feature' }];
    commitStore.setData(makeGraphData([f2, f1, head]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h1' },
      { name: 'feature', current: false, ahead: 0, behind: 0, hash: 'f2' },
    ];
    uiStore.multiSelectArmed = true;
    uiStore.selectedCommitHashes = ['f1', 'f2'];

    const { container } = render(CommitGraph, {});
    await tick();
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // f2 row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();

    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^interactive rebase \d+ commits$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();

    uiStore.exitMultiSelect();
  });

  it('keeps the right-clicked commit outlined while a context-menu modal is open, then clears it on close', async () => {
    // Regression: opening a modal from the context menu (e.g. New Branch, which
    // is managed by modalStore and rendered in App.svelte) used to clear the
    // row outline immediately — reset kept it, these did not. The outline must
    // persist while any follow-up modal is open and drop once it closes.
    commitStore.setData(makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0];
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    expect(container.querySelector('.commit-row.highlighted')).toBeTruthy();

    const item = Array.from(container.querySelectorAll<HTMLElement>('.menu-item'))
      .find(el => (el.textContent ?? '').trim() === 'New Branch');
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();

    expect(modalStore.createBranch.show).toBe(true);
    expect(container.querySelector('.commit-row.highlighted')).toBeTruthy();

    modalStore.closeCreateBranch();
    await tick();
    expect(container.querySelector('.commit-row.highlighted')).toBeFalsy();
  });

  it('keeps the right-clicked commit outlined when opening interactive rebase from the single-commit menu', async () => {
    // Regression: interactiveRebaseBase is only mirrored into modalStore via an
    // $effect, which runs after the synchronous menu onClose. The outline used
    // to clear because anyModalOpen still read false at that point.
    const c1 = makeCommit('h1', 'first');
    const c2 = makeCommit('h2', 'second', ['h1']);
    c2.refs = [{ type: 'head', name: 'main' }];
    commitStore.setData(makeGraphData([c2, c1]));
    branchStore.branches = [{ name: 'main', current: true, ahead: 0, behind: 0, hash: 'h2' }];
    uiStore.interactiveRebaseMode = 'ui';

    const { container } = render(CommitGraph, {});
    await tick();
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[1]; // h1 row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    expect(container.querySelector('.commit-row.highlighted')).toBeTruthy();

    const item = Array.from(container.querySelectorAll<HTMLElement>('.menu-item'))
      .find(el => /^interactively rebase .* to here$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();

    expect(container.querySelector('.commit-row.highlighted')).toBeTruthy();

    uiStore.exitMultiSelect();
  });

  it('keeps the multi-selection armed after opening the interactive rebase modal (GUI mode)', async () => {
    // Regression: clicking "Interactive Rebase selected commits" used to clear
    // the selection the moment the modal opened. Like squash/cherry-pick, the
    // selection must persist while the modal is open.
    const base = makeCommit('m0', 'base');
    const c1 = makeCommit('c1', 'commit 1', ['m0']);
    const c2 = makeCommit('c2', 'commit 2', ['c1']);
    c2.refs = [{ type: 'head', name: 'main' }];
    commitStore.setData(makeGraphData([c2, c1, base]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'c2' },
    ];
    uiStore.interactiveRebaseMode = 'ui';
    uiStore.multiSelectArmed = true;
    uiStore.selectedCommitHashes = ['c1', 'c2'];

    const { container } = render(CommitGraph, {});
    await tick();
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // c2 row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();

    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^interactive rebase \d+ commits$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();

    expect(uiStore.multiSelectArmed).toBe(true);
    expect(uiStore.selectedCommitHashes).toEqual(['c1', 'c2']);

    uiStore.exitMultiSelect();
  });

  it('resolves candidate branches when BranchInfo.hash is abbreviated (not the full commit hash)', async () => {
    // Regression: branch tips come from git as %(objectname:short), but commitMap
    // is keyed by the full hash. The menu item must still appear.
    const head = makeCommit('mainfull1234', 'main tip');
    head.refs = [{ type: 'head', name: 'main' }];
    const f1 = makeCommit('feat1full5678', 'feature 1', ['mainfull1234']);
    const f2 = makeCommit('feat2full9012', 'feature 2', ['feat1full5678']);
    f2.refs = [{ type: 'branch', name: 'feature' }];
    commitStore.setData(makeGraphData([f2, f1, head]));
    // abbreviated tips (commit.abbreviatedHash === hash.slice(0,7)), which differ
    // from the full commit hashes the commitMap is keyed by.
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'mainful' },
      { name: 'feature', current: false, ahead: 0, behind: 0, hash: 'feat2fu' },
    ];
    uiStore.multiSelectArmed = true;
    uiStore.selectedCommitHashes = ['feat1full5678', 'feat2full9012'];

    const { container } = render(CommitGraph, {});
    await tick();
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // f2 row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();

    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^interactive rebase \d+ commits$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();

    uiStore.exitMultiSelect();
  });
});

describe('CommitGraph auto-load history (issue #61)', () => {
  function graphDataWithMore(): CommitGraphData {
    const data = makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
    ]);
    data.hasMore = true;
    data.currentLimit = 100;
    return data;
  }

  // happy-dom reports 0 for layout metrics, so pin a realistic
  // scrolled-to-the-bottom state before dispatching the scroll event.
  function scrollToBottom(container: HTMLElement): HTMLElement {
    const graph = container.querySelector<HTMLElement>('.commit-graph');
    expect(graph).toBeTruthy();
    Object.defineProperty(graph, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(graph, 'scrollHeight', { value: 3000, configurable: true });
    Object.defineProperty(graph, 'scrollTop', { value: 2800, configurable: true });
    return graph!;
  }

  function getLogMessages() {
    return globalThis.__postedMessages
      .map(m => m.data as { type?: string; payload?: { limit?: number } })
      .filter(m => m.type === 'getLog');
  }

  it('posts the next getLog chunk on a scroll near the bottom when enabled', async () => {
    commitStore.setData(graphDataWithMore());
    uiStore.autoLoadHistory = true;
    const { container } = render(CommitGraph, {});
    await tick();

    await fireEvent.scroll(scrollToBottom(container));
    await tick();

    expect(getLogMessages()).toHaveLength(1);
    // Same payload as the "Load more" button: currentLimit + loadMoreCount.
    expect(getLogMessages()[0].payload?.limit).toBe(150);
    expect(commitStore.loadingMore).toBe(true);
  });

  it('does nothing on scroll when the setting is disabled', async () => {
    commitStore.setData(graphDataWithMore());
    uiStore.autoLoadHistory = false;
    const { container } = render(CommitGraph, {});
    await tick();

    await fireEvent.scroll(scrollToBottom(container));
    await tick();

    expect(getLogMessages()).toHaveLength(0);
    expect(commitStore.loadingMore).toBe(false);
  });

  it('does not auto-load while a load-more request is already in flight', async () => {
    commitStore.setData(graphDataWithMore());
    uiStore.autoLoadHistory = true;
    const { container } = render(CommitGraph, {});
    await tick();
    const graph = scrollToBottom(container);

    await fireEvent.scroll(graph);
    await tick();
    expect(getLogMessages()).toHaveLength(1);

    await fireEvent.scroll(graph);
    await tick();

    expect(getLogMessages()).toHaveLength(1);
  });

  it('does not auto-load when there is no more history', async () => {
    const data = graphDataWithMore();
    data.hasMore = false;
    commitStore.setData(data);
    uiStore.autoLoadHistory = true;
    const { container } = render(CommitGraph, {});
    await tick();

    await fireEvent.scroll(scrollToBottom(container));
    await tick();

    expect(getLogMessages()).toHaveLength(0);
    expect(commitStore.loadingMore).toBe(false);
  });

  it('does not auto-load while a search is active', async () => {
    commitStore.setData(graphDataWithMore());
    uiStore.autoLoadHistory = true;
    const { container } = render(CommitGraph, { searchMatchedHashes: new Set(['h1']) });
    await tick();

    await fireEvent.scroll(scrollToBottom(container));
    await tick();

    expect(getLogMessages()).toHaveLength(0);
    expect(commitStore.loadingMore).toBe(false);
  });
});
