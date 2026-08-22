import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import Reflog from '../Reflog.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';
import { branchStore } from '../../../lib/stores/branches.svelte';

interface ReflogEntry {
  hash: string;
  shortHash: string;
  selector: string;
  message: string;
  date: string;
  dangling: boolean;
}

function entry(over: Partial<ReflogEntry> = {}): ReflogEntry {
  return {
    hash: 'aaaaaaaa1111',
    shortHash: 'aaaaaaa',
    selector: 'HEAD@{0}',
    message: 'commit: do thing',
    date: new Date(Date.now() - 60_000).toISOString(),
    dangling: false,
    ...over,
  };
}

function deliverReflog(entries: ReflogEntry[], hasMore = false) {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'reflogData', payload: { entries, hasMore } },
  }));
}

beforeEach(() => {
  i18n.setLocale('en');
  branchStore.branches = [];
  branchStore.remotes = [];
  branchStore.tags = [];
  branchStore.stashes = [];
  branchStore.worktrees = [];
  globalThis.__postedMessages = [];
});

import { afterEach as _afterEach } from 'vitest';
import { cleanup as _cleanup } from '@testing-library/svelte';
_afterEach(() => { _cleanup(); });

describe('Reflog — loading & data flow', () => {
  it('requests reflog on mount when active=true', () => {
    render(Reflog, { active: true });
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'getReflog'
    );
    expect(req).toBeDefined();
    const payload = (req!.data as { payload: { ref: string; limit: number } }).payload;
    expect(payload.ref).toBe('HEAD');
    expect(payload.limit).toBe(200);
  });

  it('does not double-fire getReflog when selectedRef changes', async () => {
    // Regression: $effect used to auto-track reads inside load(), so any
    // selectedRef/currentLimit mutation triggered an extra duplicate request.
    branchStore.branches = [
      { name: 'main', current: true, remote: undefined, upstream: undefined, ahead: 0, behind: 0, hash: 'h1' },
      { name: 'feat', current: false, remote: undefined, upstream: undefined, ahead: 0, behind: 0, hash: 'h2' },
    ];
    const { container } = render(Reflog, { active: true });
    deliverReflog([]); // settle initial load
    globalThis.__postedMessages = [];

    // Open the ref dropdown — it's a custom .filter-btn + .dropdown, not
    // a <select>. The first .filter-btn is the ref filter (git-branch icon).
    const filterBtns = container.querySelectorAll<HTMLButtonElement>('.filter-btn');
    expect(filterBtns.length).toBeGreaterThan(0);
    await fireEvent.click(filterBtns[0]);

    // Pick a non-HEAD entry — find the dd-item whose text is 'feat'.
    const items = container.querySelectorAll<HTMLButtonElement>('.dropdown .dd-item');
    const featItem = Array.from(items).find(b => b.textContent?.includes('feat'));
    expect(featItem).toBeDefined();
    await fireEvent.click(featItem!);

    await waitFor(() => {
      const reqs = globalThis.__postedMessages.filter(
        (m) => (m.data as { type?: string }).type === 'getReflog'
      );
      // Exactly one — pre-fix, the $effect auto-tracked selectedRef and
      // re-fired load() on top of changeRef's manual post.
      expect(reqs.length).toBe(1);
      expect((reqs[0].data as { payload: { ref: string } }).payload.ref).toBe('feat');
    });
  });

  it('renders entries when reflogData arrives', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([
      entry({ selector: 'HEAD@{0}', message: 'commit: first', shortHash: 'aaa1111' }),
      entry({ selector: 'HEAD@{1}', message: 'checkout: moving from main to feat', shortHash: 'bbb2222' }),
    ]);
    await waitFor(() => {
      expect(container.querySelectorAll('.reflog-row').length).toBe(2);
    });
  });

  it('shows the empty state when no entries arrive', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([]);
    await waitFor(() => {
      expect(container.querySelector('.reflog-empty')).not.toBeNull();
    });
  });

  it('Load more bumps the limit by 200', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry()], /* hasMore */ true);
    await waitFor(() => {
      expect(container.querySelector('.load-more-btn')).not.toBeNull();
    });
    globalThis.__postedMessages = [];
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.load-more-btn')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'getReflog'
    )!;
    expect((req.data as { payload: { limit: number } }).payload.limit).toBe(400);
  });

  it('repoChanged event re-requests when active', async () => {
    render(Reflog, { active: true });
    deliverReflog([entry()]);
    globalThis.__postedMessages = [];
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'repoChanged' } }));
    await waitFor(() => {
      expect(globalThis.__postedMessages.some(
        (m) => (m.data as { type?: string }).type === 'getReflog'
      )).toBe(true);
    });
  });

  it('repo switch resets the selected ref and clears stale entries before reloading', async () => {
    branchStore.branches = [
      { name: 'main', current: true, remote: undefined, upstream: undefined, ahead: 0, behind: 0, hash: 'h1' },
      { name: 'feat', current: false, remote: undefined, upstream: undefined, ahead: 0, behind: 0, hash: 'h2' },
    ];
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry({ message: 'commit: old repo' })]);

    const filterBtns = container.querySelectorAll<HTMLButtonElement>('.filter-btn');
    await fireEvent.click(filterBtns[0]);
    const items = container.querySelectorAll<HTMLButtonElement>('.dropdown .dd-item');
    await fireEvent.click(Array.from(items).find(b => b.textContent?.includes('feat'))!);
    globalThis.__postedMessages = [];

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'repoChanged', payload: { what: 'repo' } } }));

    await waitFor(() => {
      expect(container.querySelector('.spinner')).not.toBeNull();
      expect(container.textContent).not.toContain('old repo');
      const req = globalThis.__postedMessages.find(
        (m) => (m.data as { type?: string }).type === 'getReflog'
      )!;
      expect((req.data as { payload: { ref: string; limit: number } }).payload).toEqual({ ref: 'HEAD', limit: 200 });
    });
  });
});

describe('Reflog — search and filter', () => {
  it('typing in the search input narrows the list', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([
      entry({ selector: 'HEAD@{0}', message: 'commit: alpha', shortHash: 'aaa' }),
      entry({ selector: 'HEAD@{1}', message: 'commit: beta', shortHash: 'bbb' }),
    ]);
    await waitFor(() => container.querySelectorAll('.reflog-row').length === 2);
    const search = container.querySelector<HTMLInputElement>('.search-input')!;
    await fireEvent.input(search, { target: { value: 'alpha' } });
    await waitFor(() => {
      expect(container.querySelectorAll('.reflog-row').length).toBe(1);
    });
  });

  it('Escape clears a non-empty query', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry()]);
    await waitFor(() => container.querySelector('.reflog-row'));
    const search = container.querySelector<HTMLInputElement>('.search-input')!;
    await fireEvent.input(search, { target: { value: 'zzz' } });
    expect(search.value).toBe('zzz');
    await fireEvent.keyDown(container.querySelector('.search-bar')!, { key: 'Escape' });
    expect(search.value).toBe('');
  });

  it('action filter dropdown toggles open and filters by selected action', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([
      entry({ selector: 'HEAD@{0}', message: 'commit: x' }),
      entry({ selector: 'HEAD@{1}', message: 'checkout: y' }),
    ]);
    await waitFor(() => container.querySelectorAll('.reflog-row').length === 2);
    const filterBtns = container.querySelectorAll<HTMLButtonElement>('.filter-btn');
    // action dropdown is the second filter-btn
    await fireEvent.click(filterBtns[1]);
    const items = container.querySelectorAll<HTMLButtonElement>('.dd-item');
    const commitItem = Array.from(items).find(i => i.textContent?.trim().endsWith('commit'))!;
    await fireEvent.click(commitItem);
    await waitFor(() => {
      expect(container.querySelectorAll('.reflog-row').length).toBe(1);
    });
  });

  it('dangling-only toggle filters non-dangling entries', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([
      entry({ selector: 'HEAD@{0}', message: 'commit: a' }),
      entry({ selector: 'HEAD@{1}', message: 'commit: b', dangling: true }),
    ]);
    await waitFor(() => container.querySelectorAll('.reflog-row').length === 2);
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.toggle-btn')!);
    await waitFor(() => {
      expect(container.querySelectorAll('.reflog-row').length).toBe(1);
    });
  });

  it('ref dropdown lists HEAD and local branches; switching posts a new request', async () => {
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h' },
      { name: 'feat', current: false, ahead: 0, behind: 0, hash: 'h' },
    ];
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry()]);
    await waitFor(() => container.querySelector('.reflog-row'));
    const filterBtns = container.querySelectorAll<HTMLButtonElement>('.filter-btn');
    await fireEvent.click(filterBtns[0]);
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>('.dd-item'));
    const labels = items.map(i => i.textContent?.trim());
    expect(labels.some(l => l === 'HEAD')).toBe(true);
    expect(labels.some(l => l === 'main')).toBe(true);
    expect(labels.some(l => l === 'feat')).toBe(true);
    globalThis.__postedMessages = [];
    await fireEvent.click(items.find(i => i.textContent?.trim() === 'feat')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'getReflog'
    );
    expect(req).toBeDefined();
    expect((req!.data as { payload: { ref: string; limit: number } }).payload).toEqual({ ref: 'feat', limit: 200 });
  });
});

describe('Reflog — relativeTime branches', () => {
  function entryAt(date: Date) {
    return entry({ date: date.toISOString() });
  }
  function deliverAt(date: Date) {
    deliverReflog([entryAt(date)]);
  }

  it('formats minutes-old entries with the minute key', async () => {
    const { container } = render(Reflog, { active: true });
    deliverAt(new Date(Date.now() - 5 * 60 * 1000));
    await waitFor(() => container.querySelector('.reflog-row'));
    expect(container.querySelector('.reflog-row .col-date')?.textContent ?? '').toMatch(/5m/i);
  });

  it('formats hours-old entries with "hour" key', async () => {
    const { container } = render(Reflog, { active: true });
    deliverAt(new Date(Date.now() - 3 * 60 * 60 * 1000));
    await waitFor(() => container.querySelector('.reflog-row'));
    expect(container.querySelector('.reflog-row .col-date')?.textContent ?? '').toMatch(/hour|h/i);
  });

  it('formats days-old entries with "day" key', async () => {
    const { container } = render(Reflog, { active: true });
    deliverAt(new Date(Date.now() - 5 * 24 * 60 * 60 * 1000));
    await waitFor(() => container.querySelector('.reflog-row'));
    expect(container.querySelector('.reflog-row .col-date')?.textContent ?? '').toMatch(/day|d/i);
  });

  it('formats months-old entries with "month" key', async () => {
    const { container } = render(Reflog, { active: true });
    deliverAt(new Date(Date.now() - 100 * 24 * 60 * 60 * 1000));
    await waitFor(() => container.querySelector('.reflog-row'));
    expect(container.querySelector('.reflog-row .col-date')?.textContent ?? '').toMatch(/month|mo/i);
  });

  it('formats years-old entries with "year" key', async () => {
    const { container } = render(Reflog, { active: true });
    deliverAt(new Date(Date.now() - 400 * 24 * 60 * 60 * 1000));
    await waitFor(() => container.querySelector('.reflog-row'));
    expect(container.querySelector('.reflog-row .col-date')?.textContent ?? '').toMatch(/year|y/i);
  });

  it('returns the raw date string when the date is invalid', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry({ date: 'not a real date' })]);
    await waitFor(() => container.querySelector('.reflog-row'));
    expect(container.querySelector('.reflog-row .col-date')?.textContent).toContain('not a real date');
  });

  it('returns empty string when date is empty', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry({ date: '' })]);
    await waitFor(() => container.querySelector('.reflog-row'));
    expect(container.querySelector('.reflog-row .col-date')?.textContent?.trim()).toBe('');
  });

  it('Escape with nothing open and empty query blurs the input', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry()]);
    await waitFor(() => container.querySelector('.reflog-row'));
    const input = container.querySelector<HTMLInputElement>('.search-input')!;
    input.focus();
    expect(document.activeElement).toBe(input);
    await fireEvent.keyDown(container.querySelector('.search-bar')!, { key: 'Escape' });
    expect(document.activeElement).not.toBe(input);
  });
});

describe('Reflog — action parsing and display', () => {
  it('renders action type tag and sub-action for "commit (amend)"', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry({ message: 'commit (amend): tweak' })]);
    await waitFor(() => container.querySelector('.reflog-row'));
    expect(container.querySelector('.action-type')?.textContent?.trim()).toBe('commit');
    expect(container.querySelector('.sub-action-tag')?.textContent?.trim().toLowerCase()).toContain('amend');
  });

  it('shows dangling indicator and warning icon for dangling rows', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry({ dangling: true })]);
    await waitFor(() => container.querySelector('.reflog-row'));
    const row = container.querySelector('.reflog-row')!;
    expect(row.classList.contains('dangling')).toBe(true);
    expect(row.querySelector('.dangling-icon')).not.toBeNull();
  });

  it('uses the selector index as the # column label', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry({ selector: 'HEAD@{7}' })]);
    await waitFor(() => container.querySelector('.reflog-row'));
    const idxCells = container.querySelectorAll('.col-idx');
    // First .col-idx is the header ('#'); the next one is the row label.
    expect(idxCells[idxCells.length - 1].textContent?.trim()).toBe('7');
  });
});

describe('Reflog — context menu', () => {
  async function openContextMenu(container: HTMLElement) {
    const row = container.querySelector('.reflog-row')!;
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await waitFor(() => {
      const text = document.body.textContent ?? '';
      expect(text).toMatch(/reset|checkout|sha/i);
    });
  }

  it('right-click opens a context menu with copy/checkout/reset actions', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry()]);
    await waitFor(() => container.querySelector('.reflog-row'));
    await openContextMenu(container);
  });

  it('"Reset to..." action opens the ResetModal', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry()]);
    await waitFor(() => container.querySelector('.reflog-row'));
    await openContextMenu(container);
    const resetItem = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => /reset/i.test(b.textContent ?? ''))!;
    expect(resetItem).not.toBeUndefined();
    await fireEvent.click(resetItem);
    await waitFor(() => {
      // ResetModal renders a "Reset Type" label and the soft/mixed/hard select
      const text = document.body.textContent ?? '';
      expect(text.toLowerCase()).toMatch(/reset/i);
    });
  });

  it('"Checkout commit" action opens the CheckoutCommitModal', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry()]);
    await waitFor(() => container.querySelector('.reflog-row'));
    await openContextMenu(container);
    const checkoutItem = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => /checkout/i.test(b.textContent ?? ''))!;
    expect(checkoutItem).not.toBeUndefined();
    await fireEvent.click(checkoutItem);
    await waitFor(() => {
      // CheckoutCommitModal shows the commit hash somewhere
      expect(document.body.textContent ?? '').toContain('aaaaaaa');
    });
  });

  it('"Copy SHA" action posts copyToClipboard with the commit hash', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry({ hash: 'fullSha12345' })]);
    await waitFor(() => container.querySelector('.reflog-row'));
    await openContextMenu(container);
    const copyItem = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => /sha|copy/i.test(b.textContent ?? ''))!;
    globalThis.__postedMessages = [];
    await fireEvent.click(copyItem);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'copyToClipboard'
    );
    expect((req!.data as { payload: { text: string } }).payload.text).toBe('fullSha12345');
  });
});

describe('Reflog — modal action callbacks', () => {
  async function openContextMenuAndClick(container: HTMLElement, label: RegExp) {
    const row = container.querySelector('.reflog-row')!;
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/reset|checkout|sha/i);
    });
    const item = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => label.test(b.textContent ?? ''))!;
    await fireEvent.click(item);
  }

  it('ResetModal confirm (Reset) posts reset with the entry hash', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry({ hash: 'targetHash9' })]);
    await waitFor(() => container.querySelector('.reflog-row'));
    await openContextMenuAndClick(container, /reset/i);
    await waitFor(() => document.querySelector('.modal button.primary'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'reset'
    );
    expect(req).toBeDefined();
    expect((req!.data as { payload: { ref: string; mode: string } }).payload).toMatchObject({
      ref: 'targetHash9',
    });
  });

  it('ResetModal cancel (X) closes without posting reset', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry()]);
    await waitFor(() => container.querySelector('.reflog-row'));
    await openContextMenuAndClick(container, /reset/i);
    await waitFor(() => document.querySelector('.modal'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal .modal-close')!);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'reset'
    )).toBe(false);
  });

  it('CheckoutCommitModal confirm posts checkout', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry({ hash: 'fullHash7' })]);
    await waitFor(() => container.querySelector('.reflog-row'));
    await openContextMenuAndClick(container, /checkout/i);
    await waitFor(() => document.querySelector('.modal'));
    // CheckoutCommitModal fires checkDirty on mount; respond to it.
    const posted = globalThis.__postedMessages.map(m => m.data) as Array<{ type: string; payload?: Record<string, unknown> }>;
    const dirtyReq = posted.find(p => p.type === 'checkDirty');
    if (dirtyReq) {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'dirtyState', payload: { requestId: dirtyReq.payload!.requestId, dirty: false } },
      }));
    }
    await waitFor(() => document.querySelector('.modal button.primary'));
    globalThis.__postedMessages = [];
    await fireEvent.click(document.querySelector<HTMLButtonElement>('.modal button.primary')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'checkout'
    );
    expect(req).toBeDefined();
  });
});

describe('Reflog — dropdown backdrops and clear', () => {
  it('ref dropdown backdrop click closes the dropdown', async () => {
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h' },
    ];
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry()]);
    await waitFor(() => container.querySelector('.reflog-row'));
    const filterBtns = container.querySelectorAll<HTMLButtonElement>('.filter-btn');
    await fireEvent.click(filterBtns[0]);
    expect(container.querySelector('.dropdown')).not.toBeNull();
    await fireEvent.click(container.querySelector<HTMLDivElement>('.backdrop')!);
    await waitFor(() => {
      expect(container.querySelector('.dropdown')).toBeNull();
    });
  });

  it('action dropdown backdrop click closes the dropdown', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([entry()]);
    await waitFor(() => container.querySelector('.reflog-row'));
    const filterBtns = container.querySelectorAll<HTMLButtonElement>('.filter-btn');
    await fireEvent.click(filterBtns[1]);
    expect(container.querySelector('.dropdown')).not.toBeNull();
    await fireEvent.click(container.querySelector<HTMLDivElement>('.backdrop')!);
    await waitFor(() => {
      expect(container.querySelector('.dropdown')).toBeNull();
    });
  });

  it('"All" action clears the selected actions filter', async () => {
    const { container } = render(Reflog, { active: true });
    deliverReflog([
      entry({ selector: 'HEAD@{0}', message: 'commit: a' }),
      entry({ selector: 'HEAD@{1}', message: 'checkout: b' }),
    ]);
    await waitFor(() => container.querySelectorAll('.reflog-row').length === 2);
    const filterBtns = container.querySelectorAll<HTMLButtonElement>('.filter-btn');
    await fireEvent.click(filterBtns[1]);
    const items = container.querySelectorAll<HTMLButtonElement>('.dd-item');
    const commitItem = Array.from(items).find(i => i.textContent?.trim().endsWith('commit'))!;
    await fireEvent.click(commitItem);
    await waitFor(() => {
      expect(container.querySelectorAll('.reflog-row').length).toBe(1);
    });
    // Dropdown stays open after toggleAction; click the first dd-item ("All")
    const itemsStillOpen = container.querySelectorAll<HTMLButtonElement>('.dd-item');
    expect(itemsStillOpen.length).toBeGreaterThan(0);
    await fireEvent.click(itemsStillOpen[0]); // "All"
    await waitFor(() => {
      expect(container.querySelectorAll('.reflog-row').length).toBe(2);
    });
  });
});
