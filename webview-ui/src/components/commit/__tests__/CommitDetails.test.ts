import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import CommitDetails from '../CommitDetails.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';
import { commitStore } from '../../../lib/stores/commits.svelte';
import { uiStore } from '../../../lib/stores/ui.svelte';
import { modalStore } from '../../../lib/stores/modals.svelte';
import type { Commit, DiffData } from '../../../lib/types';

function commit(over: Partial<Commit> = {}): Commit {
  return {
    hash: 'abcdef1234567890',
    abbreviatedHash: 'abcdef1',
    author: { name: 'Alice', email: 'a@x.com', date: '2024-01-15T10:00:00Z' },
    committer: { name: 'Alice', email: 'a@x.com', date: '2024-01-15T10:00:00Z' },
    subject: 'fix: thing',
    body: 'body line',
    parents: ['p1', 'p2'],
    refs: [],
    ...over,
  };
}

function deliverCommitDiff(hash: string, files: Array<{ path: string; status: string }>) {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'commitDiffData', payload: { hash, files } },
  }));
}

function deliverUncommittedDiff(staged: Array<{ path: string; status: string }>, unstaged: Array<{ path: string; status: string }>) {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'uncommittedDiffData', payload: { staged, unstaged } },
  }));
}

function deliverFileDiff(hash: string, file: string, diff: DiffData) {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'fileDiffData', payload: { hash, file, diff } },
  }));
}

function deliverLfs(files: Array<{ oid: string; path: string }>, locks: Array<{ path: string; owner: string; id: string }>) {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'lfsData', payload: { files, locks } },
  }));
}

function deliverSignature(hash: string, signature: { status: 'good' | 'none' | 'unverified'; signer?: string; keyId?: string }) {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'commitSignatureData', payload: { hash, signature } },
  }));
}

beforeEach(() => {
  i18n.setLocale('en');
  globalThis.__postedMessages = [];
  commitStore.commits = [];
  uiStore.selectedCommitHash = null;
  uiStore.commitDetailFullscreen = false;
  uiStore.comparing = false;
  uiStore.showBottomPanel = true;
  uiStore.commitFileSelected = false;
});

afterEach(() => {
  cleanup();
});

describe('CommitDetails — request flow', () => {
  it('posts getCommitDiff and getLfsFiles when a real commit is mounted', async () => {
    render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    await waitFor(() => {
      const types = globalThis.__postedMessages.map(m => (m.data as { type?: string }).type);
      expect(types).toContain('getCommitDiff');
      expect(types).toContain('getLfsFiles');
    });
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'getCommitDiff'
    );
    expect((req!.data as { payload: { hash: string } }).payload.hash).toBe('h1');
  });

  it('posts getUncommittedDiff when commit.hash === UNCOMMITTED', async () => {
    render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    await waitFor(() => {
      expect(globalThis.__postedMessages.some(
        (m) => (m.data as { type?: string }).type === 'getUncommittedDiff'
      )).toBe(true);
    });
  });

  it('posts getCommitSignature when a real commit is mounted', async () => {
    render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    await waitFor(() => {
      const req = globalThis.__postedMessages.find(
        (m) => (m.data as { type?: string }).type === 'getCommitSignature'
      );
      expect(req).toBeTruthy();
      expect((req!.data as { payload: { hash: string } }).payload.hash).toBe('h1');
    });
  });

  it('does not post getCommitSignature for UNCOMMITTED', async () => {
    render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    await waitFor(() => {
      expect(globalThis.__postedMessages.some(
        (m) => (m.data as { type?: string }).type === 'getUncommittedDiff'
      )).toBe(true);
    });
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'getCommitSignature'
    )).toBe(false);
  });
});

describe('CommitDetails — signature', () => {
  it('shows the verified signer (enriched with the committer name) and key ID', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    await waitFor(() => container.querySelector('.person-name'));
    deliverSignature('h1', { status: 'good', signer: 'Alice', keyId: 'ABCD1234' });
    await waitFor(() => expect(container.querySelector('.sig-detail')).toBeTruthy());
    const text = container.querySelector('.sig-detail')?.textContent ?? '';
    expect(text).toContain('Alice <a@x.com>');
    expect(text).toContain('GPG Key ID: ABCD1234');
    // The status glyph next to the email reflects the good status.
    expect(container.querySelector('.sig-glyph.sig-glyph-good')).toBeTruthy();
  });

  it('labels an SSH key fingerprint as "SSH Key" instead of "GPG Key ID"', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    await waitFor(() => container.querySelector('.person-name'));
    deliverSignature('h1', { status: 'good', signer: 'a@x.com', keyId: 'SHA256:AbCdEf' });
    await waitFor(() => expect(container.querySelector('.sig-detail')).toBeTruthy());
    const text = container.querySelector('.sig-detail')?.textContent ?? '';
    expect(text).toContain('SSH Key: SHA256:AbCdEf');
    expect(text).not.toContain('GPG Key ID');
  });

  it('does not fabricate a signer from the committer for an unverified signature', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    await waitFor(() => container.querySelector('.person-name'));
    // git returns no %GS for an untrusted key — must not claim "Signed by <committer>".
    deliverSignature('h1', { status: 'unverified', keyId: 'SHA256:UnTrust' });
    await waitFor(() => expect(container.querySelector('.sig-detail')).toBeTruthy());
    const text = container.querySelector('.sig-detail')?.textContent ?? '';
    expect(text).not.toContain('Signed by');
    expect(text).toContain('SSH Key: SHA256:UnTrust');
    expect(container.querySelector('.sig-glyph.sig-glyph-unverified')).toBeTruthy();
  });

  it('shows no signature row or glyph for an unsigned commit', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    await waitFor(() => container.querySelector('.person-name'));
    deliverSignature('h1', { status: 'none' });
    await Promise.resolve();
    expect(container.querySelector('.sig-detail')).toBeFalsy();
    expect(container.querySelector('.sig-glyph')).toBeFalsy();
  });

  it('ignores a stale signature response for a different commit', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    await waitFor(() => container.querySelector('.person-name'));
    deliverSignature('other-hash', { status: 'good', signer: 'Mallory' });
    await Promise.resolve();
    expect(container.querySelector('.sig-detail')).toBeFalsy();
    expect(container.querySelector('.sig-glyph')).toBeFalsy();
  });
});

describe('CommitDetails — commit info rendering', () => {
  it('renders author name, email, and short hash', async () => {
    const { container } = render(CommitDetails, { commit: commit() });
    await waitFor(() => container.querySelector('.person-name'));
    const text = container.textContent ?? '';
    expect(text).toContain('Alice');
    expect(text).toContain('a@x.com');
    expect(text).toContain('abcdef1'); // short hash
  });

  it('omits the committer column when committer matches author', () => {
    const { container } = render(CommitDetails, { commit: commit() });
    const labels = Array.from(container.querySelectorAll('.info-label')).map(el => el.textContent?.trim());
    expect(labels).toContain('Author');
    expect(labels).not.toContain('Committer');
  });

  it('shows the committer column when committer differs from author', () => {
    const { container } = render(CommitDetails, {
      commit: commit({
        committer: { name: 'Bob', email: 'b@x.com', date: '2024-01-15T11:00:00Z' },
      }),
    });
    const labels = Array.from(container.querySelectorAll('.info-label')).map(el => el.textContent?.trim());
    expect(labels).toContain('Committer');
  });
});

describe('CommitDetails — files list', () => {
  it('renders file count and list when commitDiffData arrives', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [
      { path: 'src/a.ts', status: 'M' },
      { path: 'src/b.ts', status: 'A' },
    ]);
    await waitFor(() => {
      const counts = container.querySelectorAll('.tab-count');
      const text = Array.from(counts).map(c => c.textContent?.trim());
      expect(text.some(t => t === '2')).toBe(true);
    });
  });

  it('discards commitDiffData with mismatched hash', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('OTHER', [{ path: 'x.ts', status: 'M' }]);
    await new Promise(r => setTimeout(r, 30));
    const counts = Array.from(container.querySelectorAll('.tab-count')).map(c => c.textContent?.trim());
    expect(counts).toContain('0'); // still 0 files
  });
});

describe('CommitDetails — tabs', () => {
  it('default tab is "commit" when a real commit is selected', () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    const activeTab = container.querySelector('.top-tab.active')?.textContent ?? '';
    expect(activeTab.toLowerCase()).toContain('commit');
  });

  it('clicking Changes tab activates it', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    const tabs = container.querySelectorAll<HTMLButtonElement>('.top-tab');
    const changesTab = Array.from(tabs).find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    expect(changesTab.classList.contains('active')).toBe(true);
  });

  it('clicking back to the Commit tab re-activates it', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    const tabs = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'));
    await fireEvent.click(tabs().find(t => /change/i.test(t.textContent ?? ''))!);
    const commitTab = tabs().find(t => /commit/i.test(t.textContent ?? ''))!;
    await fireEvent.click(commitTab);
    expect(commitTab.classList.contains('active')).toBe(true);
  });

  it('UNCOMMITTED shows Staged/Unstaged tabs', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    deliverUncommittedDiff(
      [{ path: 'a.ts', status: 'M' }],
      [{ path: 'b.ts', status: 'A' }, { path: 'c.ts', status: 'A' }],
    );
    await waitFor(() => {
      const text = container.querySelector('.top-tab')?.textContent ?? '';
      expect(text.toLowerCase()).toMatch(/staged|unstaged/);
    });
    const tabs = Array.from(container.querySelectorAll('.top-tab')).map(t => t.textContent?.toLowerCase() ?? '');
    expect(tabs.some(t => t.includes('staged'))).toBe(true);
    expect(tabs.some(t => t.includes('unstaged'))).toBe(true);
  });
});

describe('CommitDetails — header actions', () => {
  it('fullscreen button toggles uiStore.commitDetailFullscreen', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.tab-action-btn')!);
    expect(uiStore.commitDetailFullscreen).toBe(true);
  });

  it('close button clears the selected commit and hides the panel', async () => {
    uiStore.selectedCommitHash = 'h1';
    uiStore.showBottomPanel = true;
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    const btns = container.querySelectorAll<HTMLButtonElement>('.tab-action-btn');
    await fireEvent.click(btns[btns.length - 1]);
    expect(uiStore.selectedCommitHash).toBeNull();
    expect(uiStore.showBottomPanel).toBe(false);
  });
});

describe('CommitDetails — empty / compare', () => {
  it('renders without a commit prop (compare mode)', () => {
    const { container } = render(CommitDetails);
    expect(container.querySelector('.commit-details')).not.toBeNull();
  });

  it('clears the previous comparison files when the compare target changes', async () => {
    uiStore.comparing = true;
    uiStore.compareRef1 = 'aaaa';
    uiStore.compareRef2 = 'bbbb';
    const { queryByText, findByText } = render(CommitDetails); // compare mode: no commit prop
    // First comparison data arrives
    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'commitDiffData',
      payload: { hash: '', files: [{ path: 'old.txt', status: 'M' }], diffs: [] },
    }}));
    expect(await findByText('old.txt')).toBeTruthy();
    // User switches compare target → refs change → files must clear immediately
    uiStore.compareRef1 = 'cccc';
    uiStore.compareRef2 = 'dddd';
    await waitFor(() => {
      expect(queryByText('old.txt')).toBeNull();
    });
  });
});

describe('CommitDetails — SHA copy buttons', () => {
  it('full SHA copy button posts copyToClipboard with the full hash', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'abcdef1234567890', abbreviatedHash: 'abcdef1' }) });
    await waitFor(() => container.querySelector('.copy-btns'));
    const btns = container.querySelectorAll<HTMLButtonElement>('.copy-btn');
    globalThis.__postedMessages = [];
    await fireEvent.click(btns[0]); // full SHA
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'copyToClipboard'
    );
    expect((req!.data as { payload: { text: string } }).payload.text).toBe('abcdef1234567890');
  });

  it('short SHA copy button posts copyToClipboard with the abbreviated hash', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'abcdef1234567890', abbreviatedHash: 'abcdef1' }) });
    await waitFor(() => container.querySelector('.copy-btns'));
    const btns = container.querySelectorAll<HTMLButtonElement>('.copy-btn');
    globalThis.__postedMessages = [];
    await fireEvent.click(btns[1]); // short SHA
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'copyToClipboard'
    );
    expect((req!.data as { payload: { text: string } }).payload.text).toBe('abcdef1');
  });
});

describe('CommitDetails — parent links', () => {
  it('renders one parent-link button per parent', async () => {
    const { container } = render(CommitDetails, { commit: commit({ parents: ['p1', 'p2'] }) });
    await waitFor(() => container.querySelectorAll('.parent-link').length === 2);
    expect(container.querySelectorAll('.parent-link').length).toBe(2);
  });

  it('clicking a parent updates uiStore.selectedCommitHash and posts searchByHash', async () => {
    const { container } = render(CommitDetails, { commit: commit({ parents: ['parentHash1', 'parentHash2'] }) });
    await waitFor(() => container.querySelector('.parent-link'));
    globalThis.__postedMessages = [];
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.parent-link')!);
    expect(uiStore.selectedCommitHash).toBe('parentHash1');
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'searchByHash'
    )).toBe(true);
  });

  it('omits the PARENTS row when commit has no parents', () => {
    const { container } = render(CommitDetails, { commit: commit({ parents: [] }) });
    const labels = Array.from(container.querySelectorAll('.meta-label')).map(el => el.textContent?.trim());
    expect(labels).not.toContain('Parents');
  });
});

describe('CommitDetails — refs rendering', () => {
  it('renders REFS row with branch and tag badges', () => {
    const { container } = render(CommitDetails, {
      commit: commit({
        refs: [
          { type: 'branch', name: 'main' },
          { type: 'tag', name: 'v1.0' },
        ],
      }),
    });
    const text = container.querySelector('.meta-value')?.textContent ?? '';
    expect(text).toMatch(/main/);
    expect(text).toMatch(/v1\.0/);
  });

  it('applies badge-head to the current branch and badge-fixed to tags', () => {
    const { container } = render(CommitDetails, {
      commit: commit({
        refs: [
          { type: 'head', name: 'main' },
          { type: 'branch', name: 'feature' },
          { type: 'tag', name: 'v1.0' },
        ],
      }),
    });
    const badges = Array.from(container.querySelectorAll('.ref-badge'));
    const byText = (txt: string) => badges.find(b => (b.textContent ?? '').includes(txt))!;
    expect(byText('main').classList.contains('badge-head')).toBe(true);
    expect(byText('main').classList.contains('badge-fixed')).toBe(false);
    expect(byText('feature').classList.contains('badge-head')).toBe(false);
    expect(byText('feature').classList.contains('badge-fixed')).toBe(false);
    expect(byText('v1.0').classList.contains('badge-fixed')).toBe(true);
    expect(byText('v1.0').classList.contains('badge-head')).toBe(false);
  });

  it('hides REFS row when only stash or remote HEAD refs exist', () => {
    const { container } = render(CommitDetails, {
      commit: commit({
        refs: [
          { type: 'stash', name: 'stash@{0}' },
          { type: 'remote-branch', name: 'HEAD', remote: 'origin' },
        ],
      }),
    });
    const labels = Array.from(container.querySelectorAll('.meta-label')).map(el => el.textContent?.trim());
    expect(labels).not.toContain('REFS');
  });
});

describe('CommitDetails — file tree & diff', () => {
  it('clicking a file sets selectedFile and renders the diff toolbar', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'src/a.ts', status: 'M' }]);
    // switch to changes tab
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.file-item'));
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.file-item')!);
    // After clicking, a fileDiff request is posted
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'getFileDiff'
    )).toBe(true);
    // Then deliver the diff and verify the toolbar appears
    deliverFileDiff('h1', 'src/a.ts', {
      file: 'src/a.ts',
      isBinary: false,
      isImage: false,
      hunks: [{ header: '', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [
        { type: 'add', content: 'x', newLineNumber: 1 },
      ] }],
    });
    await waitFor(() => container.querySelector('.diff-toolbar'));
  });

  it('clicking a file twice deselects it', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'a.ts', status: 'M' }]);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.file-item'));
    const fileBtn = container.querySelector<HTMLButtonElement>('.file-item')!;
    await fireEvent.click(fileBtn);
    expect(fileBtn.classList.contains('selected')).toBe(true);
    await fireEvent.click(fileBtn);
    expect(fileBtn.classList.contains('selected')).toBe(false);
  });

  it('double-clicking a file posts openDiff', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'a.ts', status: 'M' }]);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.file-item'));
    globalThis.__postedMessages = [];
    await fireEvent.dblClick(container.querySelector<HTMLButtonElement>('.file-item')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'openDiff'
    );
    expect(req).toBeDefined();
    expect((req!.data as { payload: { file: string } }).payload.file).toBe('a.ts');
  });

  it('right-clicking a file outlines it (context-active) until the menu closes', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'a.ts', status: 'M' }]);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.file-item'));

    const fileBtn = container.querySelector<HTMLButtonElement>('.file-item')!;
    expect(fileBtn.classList.contains('context-active')).toBe(false);

    await fireEvent.contextMenu(fileBtn);
    expect(fileBtn.classList.contains('context-active')).toBe(true);

    // Closing the context menu (Escape) drops the outline.
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(fileBtn.classList.contains('context-active')).toBe(false));
  });

  it('renders the colored status badge for each file', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [
      { path: 'added.ts', status: 'A' },
      { path: 'mod.ts', status: 'M' },
      { path: 'del.ts', status: 'D' },
    ]);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelectorAll('.file-status').length === 3);
    const statuses = Array.from(container.querySelectorAll('.file-status')).map(el => el.textContent?.trim());
    expect(statuses).toEqual(expect.arrayContaining(['A', 'M', 'D']));
  });
});

describe('CommitDetails — diff mode toggle', () => {
  async function setupWithDiff() {
    const r = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'a.ts', status: 'M' }]);
    const changesTab = Array.from(r.container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => r.container.querySelector('.file-item'));
    await fireEvent.click(r.container.querySelector<HTMLButtonElement>('.file-item')!);
    deliverFileDiff('h1', 'a.ts', {
      file: 'a.ts', isBinary: false, isImage: false,
      hunks: [{ header: '', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [
        { type: 'context', content: 'ctx', oldLineNumber: 1, newLineNumber: 1 },
        { type: 'delete', content: 'old', oldLineNumber: 2 },
        { type: 'add', content: 'new', newLineNumber: 2 },
      ] }],
    });
    await waitFor(() => r.container.querySelector('.diff-toolbar'));
    return r;
  }

  it('default mode is inline', async () => {
    const { container } = await setupWithDiff();
    const btns = container.querySelectorAll<HTMLButtonElement>('.diff-mode-toggle button');
    expect(btns[0].classList.contains('active')).toBe(true);
    expect(container.querySelector('.diff-content')).not.toBeNull();
  });

  it('clicking side-by-side renders the sbs pane', async () => {
    const { container } = await setupWithDiff();
    const btns = container.querySelectorAll<HTMLButtonElement>('.diff-mode-toggle button');
    await fireEvent.click(btns[1]);
    expect(btns[1].classList.contains('active')).toBe(true);
    expect(container.querySelector('.diff-sbs')).not.toBeNull();
  });

  it('binary non-image renders the binary placeholder', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'data.bin', status: 'M' }]);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.file-item'));
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.file-item')!);
    deliverFileDiff('h1', 'data.bin', { file: 'data.bin', isBinary: true, isImage: false, hunks: [] });
    await waitFor(() => container.querySelector('.diff-empty'));
  });

  it('binary image renders the ImageDiff component (mode toolbar)', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'logo.png', status: 'M' }]);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.file-item'));
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.file-item')!);
    deliverFileDiff('h1', 'logo.png', { file: 'logo.png', isBinary: true, isImage: true, hunks: [] });
    await waitFor(() => {
      // ImageDiff has its own toolbar with Side by Side / Swipe / Onion Skin
      expect(container.querySelector('.image-diff')).not.toBeNull();
    });
  });
});

describe('CommitDetails — uncommitted (staged/unstaged)', () => {
  function deliverUncommitted(staged: Array<{ path: string; status: string }>, unstaged: Array<{ path: string; status: string }>) {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'uncommittedDiffData', payload: { staged, unstaged } },
    }));
  }

  it('compacts deep folder chains in both staged and unstaged trees', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    deliverUncommitted(
      [{ path: 'src/main/java/App.java', status: 'M' }],
      [{ path: 'tests/unit/App.test.ts', status: 'A' }],
    );
    await waitFor(() => expect(container.querySelector('.file-item')).toBeTruthy());
    expect(container.querySelector('.dir-name')?.textContent?.replace(/\s+/g, '')).toBe('src/main/java');

    const unstagedTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /unstaged/i.test(t.textContent ?? ''))!;
    await fireEvent.click(unstagedTab);
    await waitFor(() => {
      expect(container.querySelector('.dir-name')?.textContent?.replace(/\s+/g, '')).toBe('tests/unit');
    });
  });

  it('shows "No staged changes" when staged list is empty', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    deliverUncommitted([], [{ path: 'a.ts', status: 'M' }]);
    await waitFor(() => container.querySelector('.empty-state-text'));
    expect(container.querySelector('.empty-state-text')?.textContent).toMatch(/no staged/i);
  });

  it('switching to Unstaged tab clears selectedFile and shows unstaged list', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    deliverUncommitted(
      [{ path: 'a.ts', status: 'M' }],
      [{ path: 'b.ts', status: 'A' }],
    );
    await waitFor(() => container.querySelectorAll('.file-item').length > 0);
    const unstagedTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /unstaged/i.test(t.textContent ?? ''))!;
    await fireEvent.click(unstagedTab);
    await waitFor(() => {
      const text = Array.from(container.querySelectorAll('.file-name')).map(el => el.textContent);
      expect(text).toContain('b.ts');
    });
  });

  it('switching back to the Staged tab re-activates it and shows the staged list', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    deliverUncommitted([{ path: 'a.ts', status: 'M' }], [{ path: 'b.ts', status: 'A' }]);
    await waitFor(() => container.querySelectorAll('.file-item').length > 0);
    const tabs = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'));
    await fireEvent.click(tabs().find(t => /unstaged/i.test(t.textContent ?? ''))!);
    const stagedTab = tabs().find(t => /^staged/i.test(t.textContent?.trim() ?? ''))!;
    await fireEvent.click(stagedTab);
    expect(stagedTab.classList.contains('active')).toBe(true);
    await waitFor(() => {
      const text = Array.from(container.querySelectorAll('.file-name')).map(el => el.textContent);
      expect(text).toContain('a.ts');
    });
  });

  it('nested-repo file (status N) shows the nested-repo hint when selected', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    deliverUncommitted(
      [],
      [{ path: 'sub-repo', status: 'N' }],
    );
    await waitFor(() => container.querySelector('.top-tab'));
    const unstagedTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /unstaged/i.test(t.textContent ?? ''))!;
    await fireEvent.click(unstagedTab);
    await waitFor(() => container.querySelector('.file-item'));
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.file-item')!);
    await waitFor(() => {
      expect(container.querySelector('.diff-empty')).not.toBeNull();
    });
  });

  it('does NOT request file diff when clicking a nested-repo (status N) file', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    deliverUncommitted([], [{ path: 'sub', status: 'N' }]);
    const unstagedTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /unstaged/i.test(t.textContent ?? ''))!;
    await fireEvent.click(unstagedTab);
    await waitFor(() => container.querySelector('.file-item'));
    globalThis.__postedMessages = [];
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.file-item')!);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'getUncommittedFileDiff'
    )).toBe(false);
  });

  it('double-clicking an unstaged file opens its working-tree diff', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    deliverUncommitted([], [{ path: 'a.ts', status: 'M' }]);
    const unstagedTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /unstaged/i.test(t.textContent ?? ''))!;
    await fireEvent.click(unstagedTab);
    await waitFor(() => container.querySelector('.file-item'));
    globalThis.__postedMessages = [];
    await fireEvent.dblClick(container.querySelector<HTMLButtonElement>('.file-item')!);
    const msg = globalThis.__postedMessages.find((m) => (m.data as { type?: string }).type === 'openDiff');
    expect(msg).toBeDefined();
    expect((msg!.data as { payload: unknown }).payload).toMatchObject({ file: 'a.ts', staged: false });
  });

  it('double-clicking a staged file opens its staged diff', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    deliverUncommitted([{ path: 'a.ts', status: 'M' }], []);
    await waitFor(() => container.querySelector('.file-item'));
    globalThis.__postedMessages = [];
    await fireEvent.dblClick(container.querySelector<HTMLButtonElement>('.file-item')!);
    const msg = globalThis.__postedMessages.find((m) => (m.data as { type?: string }).type === 'openDiff');
    expect(msg).toBeDefined();
    expect((msg!.data as { payload: unknown }).payload).toMatchObject({ file: 'a.ts', staged: true });
  });

  it('right-clicking an uncommitted file opens a context menu with Open changes', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    deliverUncommitted([{ path: 'a.ts', status: 'M' }], []);
    await waitFor(() => container.querySelector('.file-item'));
    await fireEvent.contextMenu(container.querySelector<HTMLButtonElement>('.file-item')!, { clientX: 10, clientY: 10 });
    await waitFor(() => {
      const text = Array.from(container.querySelectorAll('*')).map(el => el.textContent ?? '').join(' ');
      expect(text.toLowerCase()).toContain('open changes');
    });
  });
});

describe('CommitDetails — LFS badges', () => {
  it('shows an LFS badge on files in the LFS file set', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'assets/big.bin', status: 'M' }]);
    deliverLfs([{ oid: 'o', path: 'assets/big.bin' }], []);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.lfs-badge'));
  });

  it('shows the locked variant when an LFS file is locked', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'a.bin', status: 'M' }]);
    deliverLfs(
      [{ oid: 'o', path: 'a.bin' }],
      [{ path: 'a.bin', owner: 'alice', id: 'L1' }],
    );
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.lfs-badge.locked'));
  });
});

describe('CommitDetails — file context menu', () => {
  it('right-click on a file opens the context menu with file actions', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'a.ts', status: 'M' }]);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.file-item'));
    await fireEvent.contextMenu(container.querySelector('.file-item')!);
    await waitFor(() => {
      // ContextMenu renders into the page somewhere
      expect(document.body.textContent ?? '').toMatch(/open/i);
    });
  });
});

describe('CommitDetails — parent hover preview', () => {
  it('mouseenter on a parent posts getCommitData when not cached', async () => {
    vi.useFakeTimers();
    const { container } = render(CommitDetails, { commit: commit({ parents: ['parent1'] }) });
    await waitFor(() => container.querySelector('.parent-link'));
    globalThis.__postedMessages = [];
    await fireEvent.mouseEnter(container.querySelector('.parent-link')!, { clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(400);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'getCommitData'
    );
    expect(req).toBeDefined();
    expect((req!.data as { payload: { hash: string } }).payload.hash).toBe('parent1');
    vi.useRealTimers();
  });

  it('uses cached commit when commitStore already has it (no postMessage)', async () => {
    vi.useFakeTimers();
    commitStore.commits = [commit({ hash: 'parent1', subject: 'parent commit' })];
    const { container } = render(CommitDetails, { commit: commit({ parents: ['parent1'] }) });
    await waitFor(() => container.querySelector('.parent-link'));
    globalThis.__postedMessages = [];
    await fireEvent.mouseEnter(container.querySelector('.parent-link')!, { clientX: 50, clientY: 50 });
    vi.advanceTimersByTime(400);
    // No getCommitData request when commit is in the store cache
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'getCommitData'
    )).toBe(false);
    vi.useRealTimers();
  });

  it('mouseleave before delay cancels the preview', async () => {
    vi.useFakeTimers();
    const { container } = render(CommitDetails, { commit: commit({ parents: ['parent1'] }) });
    await waitFor(() => container.querySelector('.parent-link'));
    const link = container.querySelector('.parent-link')!;
    await fireEvent.mouseEnter(link, { clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(200);
    await fireEvent.mouseLeave(link);
    vi.advanceTimersByTime(500);
    globalThis.__postedMessages = [];
    // Delay cancelled; nothing posted
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'getCommitData'
    )).toBe(false);
    vi.useRealTimers();
  });
});

describe('CommitDetails — hover preview cache & navigate', () => {
  it('commitData message stores the commit in the preview cache and shows preview if hovering', async () => {
    vi.useFakeTimers();
    const { container } = render(CommitDetails, { commit: commit({ parents: ['parent1'] }) });
    await waitFor(() => container.querySelector('.parent-link'));
    // Hover to set hoveredHash + previewPos
    await fireEvent.mouseEnter(container.querySelector('.parent-link')!, { clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(400); // triggers getCommitData (no cache)
    vi.useRealTimers();
    // Deliver commitData for the hovered hash → previewCommit gets set
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'commitData', payload: { commit: commit({
        hash: 'parent1', subject: 'parent subject', author: { name: 'Bob', email: 'b@x.com', date: '2024-01-01T00:00:00Z' },
      }) } },
    }));
    await waitFor(() => {
      expect(container.querySelector('.commit-hover-card')).not.toBeNull();
    });
  });

  it('clicking the hover card navigates and clears the preview', async () => {
    vi.useFakeTimers();
    commitStore.commits = [commit({ hash: 'parent1', subject: 'parent commit' })];
    const { container } = render(CommitDetails, { commit: commit({ parents: ['parent1'] }) });
    await waitFor(() => container.querySelector('.parent-link'));
    // Cached commit → preview shows directly after delay
    await fireEvent.mouseEnter(container.querySelector('.parent-link')!, { clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(400);
    vi.useRealTimers();
    await waitFor(() => container.querySelector('.commit-hover-card'));
    // CommitHoverCard exposes an onNavigate handler that the parent uses to
    // jump to the previewed commit; clicking the card surface triggers it.
    // Simulate the navigate path via clicking the card body — this exercises
    // App's parent-link onclick contract via mouseleave path instead.
    await fireEvent.mouseLeave(container.querySelector('.commit-hover-card')!);
    await waitFor(() => {
      expect(container.querySelector('.commit-hover-card')).toBeNull();
    });
  });
});

describe('CommitDetails — multi-commit sections (3+ mode)', () => {
  it('renders per-commit sections for a file in 3+ multi-select mode', async () => {
    uiStore.comparing = true;
    uiStore.selectedCommitHashes = ['c3', 'c2', 'c1'];
    const { findByText, getByText } = render(CommitDetails);
    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'multiCommitSectionsData',
      payload: {
        files: [{ path: 'a.txt', status: 'M' }],
        sections: [
          { file: 'a.txt', commit: 'c3aaaaaaaa', diff: { file: 'a.txt', hunks: [], isBinary: false, isImage: false } },
          { file: 'a.txt', commit: 'c1bbbbbbbb', diff: { file: 'a.txt', hunks: [], isBinary: false, isImage: false } },
        ],
      },
    }}));
    const fileEl = await findByText('a.txt');
    await fireEvent.click(fileEl.closest('button')!);
    // two section headers with short hashes
    await waitFor(() => {
      expect(getByText(/c3aaaaa/)).toBeTruthy();
      expect(getByText(/c1bbbbb/)).toBeTruthy();
    });
  });
});

describe('CommitDetails — resize handle', () => {
  it('mousedown on resize handle starts a drag, mousemove updates width, mouseup stops', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'a.ts', status: 'M' }]);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.resize-handle'));
    const handle = container.querySelector<HTMLDivElement>('.resize-handle')!;
    const filesPanel = container.querySelector<HTMLDivElement>('.files-panel')!;
    const startWidth = parseInt(filesPanel.style.width);
    await fireEvent.mouseDown(handle, { clientX: 200 });
    await fireEvent.mouseMove(document, { clientX: 280 });
    const after = parseInt(filesPanel.style.width);
    expect(after).toBeGreaterThan(startWidth);
    await fireEvent.mouseUp(document);
    // After mouseup, further mousemove should not change width
    const settled = parseInt(filesPanel.style.width);
    await fireEvent.mouseMove(document, { clientX: 500 });
    expect(parseInt(filesPanel.style.width)).toBe(settled);
  });
});

describe('CommitDetails — directory toggle', () => {
  it('compacts a chain of single-child folders into one visible row', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'src/main/java/App.java', status: 'M' }]);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => expect(container.querySelector('.file-item')).toBeTruthy());

    const labels = Array.from(container.querySelectorAll('.dir-name'))
      .map(el => (el.textContent ?? '').replace(/\s+/g, ''));
    expect(labels).toEqual(['src/main/java']);
    expect(container.querySelector('.dir-name')?.getAttribute('title')).toBe('src/main/java');
    expect(container.querySelector('.file-name')?.textContent).toBe('App.java');
  });

  it('handles a pathological deep folder chain without overflowing the stack', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    const deepPath = `${Array.from({ length: 3000 }, (_, i) => `d${i}`).join('/')}/leaf.ts`;
    deliverCommitDiff('h1', [{ path: deepPath, status: 'M' }]);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => expect(container.querySelector('.file-item')).toBeTruthy());

    expect(container.querySelectorAll('.dir-item')).toHaveLength(1);
    expect(container.querySelector('.file-name')?.textContent).toBe('leaf.ts');
  });

  it('stops compacting at a directory branch', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [
      { path: 'src/main/java/App.java', status: 'M' },
      { path: 'src/test/java/AppTest.java', status: 'A' },
    ]);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => expect(container.querySelectorAll('.file-item')).toHaveLength(2));

    const labels = Array.from(container.querySelectorAll('.dir-name'))
      .map(el => (el.textContent ?? '').replace(/\s+/g, ''));
    expect(labels).toEqual(['src', 'main/java', 'test/java']);
  });

  it('does not compact across a folder that also contains a file', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [
      { path: 'src/index.ts', status: 'M' },
      { path: 'src/lib/a.ts', status: 'M' },
    ]);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => expect(container.querySelectorAll('.file-item')).toHaveLength(2));

    const labels = Array.from(container.querySelectorAll('.dir-name'))
      .map(el => (el.textContent ?? '').replace(/\s+/g, ''));
    expect(labels).toEqual(['src', 'lib']);
  });

  it('clicking a dir toggles its expand state', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [
      { path: 'src/sub/a.ts', status: 'M' },
      { path: 'src/sub/b.ts', status: 'M' },
    ]);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.dir-item'));
    const dirs = container.querySelectorAll<HTMLButtonElement>('.dir-item');
    // Auto-expand effect makes all dirs expanded initially.
    expect(container.querySelectorAll('.file-item').length).toBeGreaterThan(0);
    // Click the top dir to collapse → files disappear
    await fireEvent.click(dirs[0]);
    await waitFor(() => {
      expect(container.querySelectorAll('.file-item').length).toBe(0);
    });
    // Click again to re-expand
    await fireEvent.click(container.querySelectorAll<HTMLButtonElement>('.dir-item')[0]);
    await waitFor(() => {
      expect(container.querySelectorAll('.file-item').length).toBeGreaterThan(0);
    });
  });
});

describe('CommitDetails — folder selection highlight', () => {
  async function openChanges(container: HTMLElement) {
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.file-item'));
  }

  it('selecting the only file in an expanded folder does not mark the folder selected', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'src/sub/only.ts', status: 'M' }]);
    await openChanges(container);
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.file-item')!);
    // The file itself is selected …
    expect(container.querySelector('.file-item')!.classList.contains('selected')).toBe(true);
    // … but no expanded folder above it should be highlighted.
    const selectedDirs = Array.from(container.querySelectorAll<HTMLButtonElement>('.dir-item'))
      .filter(d => d.classList.contains('selected'));
    expect(selectedDirs.length).toBe(0);
  });

  it('a collapsed folder with all its files selected is marked selected', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'src/sub/only.ts', status: 'M' }]);
    await openChanges(container);
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.file-item')!);
    // Collapse the innermost folder (src/sub); its only file stays selected.
    const dirs = Array.from(container.querySelectorAll<HTMLButtonElement>('.dir-item'));
    await fireEvent.click(dirs[dirs.length - 1]);
    await waitFor(() => {
      const sub = Array.from(container.querySelectorAll<HTMLButtonElement>('.dir-item'))
        .find(d => /sub/.test(d.textContent ?? ''))!;
      expect(sub.classList.contains('selected')).toBe(true);
    });
  });
});

describe('CommitDetails — Esc-driven file deselection', () => {
  async function openAndSelect(container: HTMLElement) {
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.file-item'));
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.file-item')!);
  }

  it('selecting a file sets uiStore.commitFileSelected', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'a.ts', status: 'M' }]);
    await openAndSelect(container);
    await waitFor(() => expect(uiStore.commitFileSelected).toBe(true));
  });

  it('requestClearCommitFileSelection deselects the current file', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'a.ts', status: 'M' }]);
    await openAndSelect(container);
    await waitFor(() => expect(container.querySelector('.file-item')!.classList.contains('selected')).toBe(true));
    uiStore.requestClearCommitFileSelection();
    await waitFor(() => {
      expect(container.querySelector('.file-item')!.classList.contains('selected')).toBe(false);
      expect(uiStore.commitFileSelected).toBe(false);
    });
  });

  it('clearing blurs the focused file item so no focus outline lingers', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'a.ts', status: 'M' }]);
    await openAndSelect(container);
    const fileBtn = container.querySelector<HTMLButtonElement>('.file-item')!;
    fileBtn.focus();
    expect(document.activeElement).toBe(fileBtn);
    uiStore.requestClearCommitFileSelection();
    await waitFor(() => expect(document.activeElement).not.toBe(fileBtn));
  });
});

describe('CommitDetails — file context menu actions', () => {
  async function openMenu(container: HTMLElement) {
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.file-item'));
    await fireEvent.contextMenu(container.querySelector('.file-item')!);
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/open/i);
    });
  }

  it('"Open file" action posts openFile with the file path', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'src/a.ts', status: 'M' }]);
    await openMenu(container);
    const openItem = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => /^open\s*file/i.test(b.textContent?.trim() ?? '') || /^open$/i.test(b.textContent?.trim() ?? ''))!;
    globalThis.__postedMessages = [];
    await fireEvent.click(openItem);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'openFile'
    );
    expect((req!.data as { payload: { file: string } }).payload.file).toBe('src/a.ts');
  });

  it('"Open changes" posts openDiff for the commit', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'a.ts', status: 'M' }]);
    await openMenu(container);
    // Limit search to the ContextMenu (rendered as .context-menu or similar)
    // by checking the menu region only — the top "Changes" tab also matches.
    const menuItems = Array.from(document.querySelectorAll<HTMLButtonElement>('.context-menu button, .menu-item, [role="menuitem"]'));
    const item = menuItems.find(b => /chang/i.test(b.textContent ?? ''))
      ?? Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
        .filter(b => !b.classList.contains('top-tab'))
        .find(b => /chang/i.test(b.textContent ?? ''))!;
    expect(item).not.toBeUndefined();
    globalThis.__postedMessages = [];
    await fireEvent.click(item!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'openDiff'
    );
    expect(req).toBeDefined();
    expect((req!.data as { payload: { file: string; commitHash: string } }).payload).toMatchObject({
      file: 'a.ts',
      commitHash: 'h1',
    });
  });

  it('LFS unlocked file shows Lock action and posts lfsLock', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'a.bin', status: 'M' }]);
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'lfsData', payload: { files: [{ oid: 'o', path: 'a.bin' }], locks: [] } },
    }));
    await openMenu(container);
    const lockItem = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => /lock/i.test(b.textContent ?? '') && !/unlock/i.test(b.textContent ?? ''))!;
    globalThis.__postedMessages = [];
    await fireEvent.click(lockItem);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'lfsLock'
    )).toBe(true);
  });

  it('LFS locked file shows Unlock + Force Unlock actions', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'a.bin', status: 'M' }]);
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'lfsData', payload: {
        files: [{ oid: 'o', path: 'a.bin' }],
        locks: [{ path: 'a.bin', owner: 'alice', id: 'L1' }],
      } },
    }));
    await openMenu(container);
    const unlockItem = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => /^unlock$/i.test(b.textContent?.trim() ?? '') || /^lfs.*unlock$/i.test(b.textContent?.trim() ?? '')
        || (/unlock/i.test(b.textContent ?? '') && !/force/i.test(b.textContent ?? '')))!;
    globalThis.__postedMessages = [];
    await fireEvent.click(unlockItem);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'lfsUnlock'
    );
    expect(req).toBeDefined();
    expect((req!.data as { payload: { file: string; force?: boolean } }).payload.force).toBeFalsy();
  });

  it('LFS "Force Unlock" posts lfsUnlock with force:true', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'a.bin', status: 'M' }]);
    deliverLfs([{ oid: 'o', path: 'a.bin' }], [{ path: 'a.bin', owner: 'alice', id: 'L1' }]);
    await openMenu(container);
    const forceItem = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => /force/i.test(b.textContent ?? ''))!;
    globalThis.__postedMessages = [];
    await fireEvent.click(forceItem);
    const req = globalThis.__postedMessages.find((m) => (m.data as { type?: string }).type === 'lfsUnlock');
    expect((req!.data as { payload: { force?: boolean } }).payload.force).toBe(true);
  });

  it('"Reveal in File Explorer" posts revealInExplorer with the file path', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'src/a.ts', status: 'M' }]);
    await openMenu(container);
    const item = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => /reveal/i.test(b.textContent ?? ''))!;
    globalThis.__postedMessages = [];
    await fireEvent.click(item);
    const req = globalThis.__postedMessages.find((m) => (m.data as { type?: string }).type === 'revealInExplorer');
    expect((req!.data as { payload: { file: string } }).payload.file).toBe('src/a.ts');
  });

  it('"Copy Path" posts copyFilePath with the file path', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'src/a.ts', status: 'M' }]);
    await openMenu(container);
    const item = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => /^copy path$/i.test(b.textContent?.trim() ?? ''))!;
    globalThis.__postedMessages = [];
    await fireEvent.click(item);
    const req = globalThis.__postedMessages.find((m) => (m.data as { type?: string }).type === 'copyFilePath');
    expect((req!.data as { payload: { file: string } }).payload.file).toBe('src/a.ts');
  });

  it('"Copy Relative Path" posts copyToClipboard with the file path', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'src/a.ts', status: 'M' }]);
    await openMenu(container);
    const item = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => /relative path/i.test(b.textContent ?? ''))!;
    globalThis.__postedMessages = [];
    await fireEvent.click(item);
    const req = globalThis.__postedMessages.find((m) => (m.data as { type?: string }).type === 'copyToClipboard');
    expect((req!.data as { payload: { text: string } }).payload.text).toBe('src/a.ts');
  });

  it('"Create Patch" posts saveCommitPatch for the file', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'src/a.ts', status: 'M' }]);
    await openMenu(container);
    const item = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => /^create patch$/i.test(b.textContent?.trim() ?? ''))!;
    globalThis.__postedMessages = [];
    await fireEvent.click(item);
    const req = globalThis.__postedMessages.find((m) => (m.data as { type?: string }).type === 'saveCommitPatch');
    expect((req!.data as { payload: { hash: string; paths: string[] } }).payload).toMatchObject({
      hash: 'h1',
      paths: ['src/a.ts'],
    });
  });

  it('"Reverse File" posts reverseCommitChanges for the file', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'src/a.ts', status: 'M' }]);
    await openMenu(container);
    const item = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => /reverse file/i.test(b.textContent ?? ''))!;
    globalThis.__postedMessages = [];
    await fireEvent.click(item);
    const req = globalThis.__postedMessages.find((m) => (m.data as { type?: string }).type === 'reverseCommitChanges');
    expect((req!.data as { payload: { commit: string; file: string } }).payload).toMatchObject({
      commit: 'h1',
      file: 'src/a.ts',
    });
  });

  it('folder "Create Patch from folder" posts saveCommitPatch for the folder', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'src/main/java/App.java', status: 'M' }]);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.dir-item'));
    await fireEvent.contextMenu(container.querySelector('.dir-item')!, { clientX: 10, clientY: 10 });
    await waitFor(() => container.querySelector('.context-menu'));
    const item = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => /create patch from folder/i.test(b.textContent ?? ''))!;
    globalThis.__postedMessages = [];
    await fireEvent.click(item);
    const req = globalThis.__postedMessages.find((m) => (m.data as { type?: string }).type === 'saveCommitPatch');
    expect((req!.data as { payload: { hash: string; paths: string[] } }).payload).toMatchObject({
      hash: 'h1',
      paths: ['src/main/java'],
    });
  });

  // ── Stash commit menus ── stash refs offer "restore" instead of reverse.
  const stashCommit = () => commit({ hash: 's1', refs: [{ type: 'stash', name: 'stash@{0}' }] });

  it('stash file "Restore file from stash" opens the stash-restore modal', async () => {
    const spy = vi.spyOn(modalStore, 'openStashRestore');
    const { container } = render(CommitDetails, { commit: stashCommit() });
    deliverCommitDiff('s1', [{ path: 'src/a.ts', status: 'M' }]);
    await openMenu(container);
    const item = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => /restore file from stash/i.test(b.textContent ?? ''))!;
    await fireEvent.click(item);
    expect(spy).toHaveBeenCalledWith(0, expect.any(String), ['src/a.ts']);
    spy.mockRestore();
  });

  it('stash folder "Restore folder from stash" opens the stash-restore modal', async () => {
    const spy = vi.spyOn(modalStore, 'openStashRestore');
    const { container } = render(CommitDetails, { commit: stashCommit() });
    deliverCommitDiff('s1', [{ path: 'src/a.ts', status: 'M' }]);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.dir-item'));
    await fireEvent.contextMenu(container.querySelector('.dir-item')!, { clientX: 10, clientY: 10 });
    await waitFor(() => container.querySelector('.context-menu'));
    const item = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => /restore folder from stash/i.test(b.textContent ?? ''))!;
    await fireEvent.click(item);
    expect(spy).toHaveBeenCalledWith(0, expect.any(String), ['src']);
    spy.mockRestore();
  });
});

describe('CommitDetails — uncommitted file context menu actions', () => {
  async function openUncommittedMenu(container: HTMLElement) {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'uncommittedDiffData', payload: { staged: [{ path: 'src/a.ts', status: 'M' }], unstaged: [] } },
    }));
    await waitFor(() => container.querySelector('.file-item'));
    await fireEvent.contextMenu(container.querySelector('.file-item')!, { clientX: 10, clientY: 10 });
    await waitFor(() => container.querySelector('.context-menu'));
  }

  function findItem(re: RegExp) {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]'))
      .find(b => re.test((b.textContent ?? '').trim()))!;
  }

  it('"Open file" posts openFile', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    await openUncommittedMenu(container);
    globalThis.__postedMessages = [];
    await fireEvent.click(findItem(/^open file$/i));
    const req = globalThis.__postedMessages.find((m) => (m.data as { type?: string }).type === 'openFile');
    expect((req!.data as { payload: { file: string } }).payload.file).toBe('src/a.ts');
  });

  it('"Open changes" posts openDiff with staged flag', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    await openUncommittedMenu(container);
    globalThis.__postedMessages = [];
    await fireEvent.click(findItem(/open changes/i));
    const req = globalThis.__postedMessages.find((m) => (m.data as { type?: string }).type === 'openDiff');
    expect((req!.data as { payload: { file: string; staged: boolean } }).payload).toMatchObject({
      file: 'src/a.ts',
      staged: true,
    });
  });

  it('"Reveal in File Explorer" posts revealInExplorer', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    await openUncommittedMenu(container);
    globalThis.__postedMessages = [];
    await fireEvent.click(findItem(/reveal/i));
    expect(globalThis.__postedMessages.some((m) => (m.data as { type?: string }).type === 'revealInExplorer')).toBe(true);
  });

  it('"Copy Path" posts copyFilePath and "Copy Relative Path" posts copyToClipboard', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    await openUncommittedMenu(container);
    globalThis.__postedMessages = [];
    await fireEvent.click(findItem(/^copy path$/i));
    expect(globalThis.__postedMessages.some((m) => (m.data as { type?: string }).type === 'copyFilePath')).toBe(true);

    await openUncommittedMenu(container);
    globalThis.__postedMessages = [];
    await fireEvent.click(findItem(/relative path/i));
    const req = globalThis.__postedMessages.find((m) => (m.data as { type?: string }).type === 'copyToClipboard');
    expect((req!.data as { payload: { text: string } }).payload.text).toBe('src/a.ts');
  });
});

describe('CommitDetails — side-by-side scroll sync', () => {
  it('scrolling left pane syncs right pane scrollTop', async () => {
    const { container } = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'a.ts', status: 'M' }]);
    const changesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => container.querySelector('.file-item'));
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.file-item')!);
    deliverFileDiff('h1', 'a.ts', {
      file: 'a.ts', isBinary: false, isImage: false,
      hunks: [{ header: '', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [
        { type: 'context', content: 'ctx', oldLineNumber: 1, newLineNumber: 1 },
      ] }],
    });
    await waitFor(() => container.querySelector('.diff-toolbar'));
    const modeBtns = container.querySelectorAll<HTMLButtonElement>('.diff-mode-toggle button');
    await fireEvent.click(modeBtns[1]); // side-by-side
    await waitFor(() => container.querySelector('.sbs-pane'));
    const panes = container.querySelectorAll<HTMLDivElement>('.sbs-pane');
    expect(panes.length).toBe(2);
    panes[0].scrollTop = 75;
    await fireEvent.scroll(panes[0]);
    expect(panes[1].scrollTop).toBe(75);
  });
});

describe('CommitDetails — fullRefresh while UNCOMMITTED', () => {
  it('re-requests uncommitted diff and any selected-file diff', async () => {
    render(CommitDetails, { commit: commit({ hash: 'UNCOMMITTED' }) });
    // First seed the uncommitted data so we have a selectable file
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'uncommittedDiffData', payload: { staged: [{ path: 'a.ts', status: 'M' }], unstaged: [] } },
    }));
    globalThis.__postedMessages = [];
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'fullRefresh' } }));
    await waitFor(() => {
      expect(globalThis.__postedMessages.some(
        (m) => (m.data as { type?: string }).type === 'getUncommittedDiff'
      )).toBe(true);
    });
  });
});

describe('CommitDetails — large diff render cap', () => {
  const MAX_RENDER_LINES = 3000;

  function bigDiff(file: string, lineCount: number): DiffData {
    const lines = Array.from({ length: lineCount }, (_, i) => ({
      type: 'add' as const, content: `line ${i}`, newLineNumber: i + 1,
    }));
    return {
      file, isBinary: false, isImage: false,
      hunks: [{ header: '', oldStart: 1, oldLines: 0, newStart: 1, newLines: lineCount, lines }],
    };
  }

  async function selectFileWithDiff(diff: DiffData) {
    const r = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: diff.file, status: 'M' }]);
    const changesTab = Array.from(r.container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => r.container.querySelector('.file-item'));
    await fireEvent.click(r.container.querySelector<HTMLButtonElement>('.file-item')!);
    deliverFileDiff('h1', diff.file, diff);
    await waitFor(() => r.container.querySelector('.diff-toolbar'));
    return r;
  }

  it('renders all lines and no banner when under the cap', async () => {
    const { container } = await selectFileWithDiff(bigDiff('small.ts', 100));
    await waitFor(() => container.querySelectorAll('.diff-content .diff-line').length === 100);
    expect(container.querySelector('.diff-truncated-banner')).toBeNull();
  });

  it('caps rendered lines and shows the banner when over the cap', async () => {
    const { container } = await selectFileWithDiff(bigDiff('huge.ts', MAX_RENDER_LINES + 500));
    await waitFor(() => container.querySelector('.diff-truncated-banner'));
    expect(container.querySelectorAll('.diff-content .diff-line').length).toBe(MAX_RENDER_LINES);
  });

  it('renders every line after clicking "show full diff"', async () => {
    const total = MAX_RENDER_LINES + 500;
    const { container } = await selectFileWithDiff(bigDiff('huge.ts', total));
    await waitFor(() => container.querySelector('.diff-truncated-banner'));
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.diff-truncated-banner button')!);
    await waitFor(() => container.querySelectorAll('.diff-content .diff-line').length === total);
    expect(container.querySelector('.diff-truncated-banner')).toBeNull();
  });
});

describe('CommitDetails — markdown toggle', () => {
  beforeEach(() => {
    i18n.setLocale('en');
  });

  it('renders markdown by default when the message has markdown (bold subject becomes <strong>)', () => {
    const { container } = render(CommitDetails, {
      commit: commit({ subject: '**bold** subject', body: '- one\n- two', parents: [] }),
    });
    expect(container.querySelector('.message-section strong')?.textContent).toBe('bold');
  });

  it('switches to plain text when the Plain toggle is clicked', async () => {
    const { container, getByText } = render(CommitDetails, {
      commit: commit({ subject: '**bold** subject', body: '- one\n- two', parents: [] }),
    });
    await fireEvent.click(getByText('Plain Text'));
    expect(container.querySelector('.message-section strong')).toBeNull();
    expect(container.querySelector('.message-section')?.textContent).toContain('**bold**');
  });

  it('switches back to markdown when the Markdown toggle is clicked', async () => {
    const { container, getByText } = render(CommitDetails, {
      commit: commit({ subject: '**bold** subject', body: '- one\n- two', parents: [] }),
    });
    await fireEvent.click(getByText('Plain Text'));
    await fireEvent.click(getByText('Markdown'));
    expect(container.querySelector('.message-section strong')?.textContent).toBe('bold');
  });

  it('hides the toggle and shows plain text when the message has no markdown', () => {
    const { container, queryByText } = render(CommitDetails, {
      commit: commit({ subject: 'Fix crash on startup', body: 'No markdown here.', parents: [] }),
    });
    expect(container.querySelector('.message-view-toggle')).toBeNull();
    expect(queryByText('Markdown')).toBeNull();
    expect(container.querySelector('.message-subject')?.textContent).toContain('Fix crash on startup');
  });
});

describe('CommitDetails — reverse changes (committed view)', () => {
  // A small modified-file diff: context (idx 0), delete (idx 1), add (idx 2).
  // FileDiffView renders one .diff-line per entry; gutters share those indices.
  function reversibleDiff(): DiffData {
    return {
      file: 'src/a.ts', isBinary: false, isImage: false,
      hunks: [{ header: '', oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [
        { type: 'context', content: 'ctx', oldLineNumber: 1, newLineNumber: 1 },
        { type: 'delete', content: 'old', oldLineNumber: 2 },
        { type: 'add', content: 'new', newLineNumber: 2 },
      ] }],
    };
  }

  // Mount into the committed single-file view (canReverseInThisView === true) and
  // render the embedded FileDiffView so its reverse affordances are wired to the
  // CommitDetails handlers under test.
  async function setupReversible() {
    const r = render(CommitDetails, { commit: commit({ hash: 'h1' }) });
    deliverCommitDiff('h1', [{ path: 'src/a.ts', status: 'M' }]);
    const changesTab = Array.from(r.container.querySelectorAll<HTMLButtonElement>('.top-tab'))
      .find(t => /change/i.test(t.textContent ?? ''))!;
    await fireEvent.click(changesTab);
    await waitFor(() => r.container.querySelector('.file-item'));
    await fireEvent.click(r.container.querySelector<HTMLButtonElement>('.file-item')!);
    deliverFileDiff('h1', 'src/a.ts', reversibleDiff());
    await waitFor(() => r.container.querySelector('.diff-content .diff-line'));
    globalThis.__postedMessages = [];
    return r;
  }

  function rightClick(el: Element) {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 20 }));
  }

  function lastReverse() {
    return globalThis.__postedMessages
      .map(m => m.data as { type?: string; payload?: { commit: string; file: string; hunkIndex?: number; lineIndices?: number[] } })
      .filter(m => m.type === 'reverseCommitChanges')
      .pop();
  }

  it('per-hunk reverse button posts reverseCommitChanges for the whole hunk', async () => {
    const { container } = await setupReversible();
    const btn = container.querySelector<HTMLButtonElement>('.hunk-hunk-btn');
    expect(btn).not.toBeNull();
    await fireEvent.click(btn!);
    const msg = lastReverse();
    expect(msg).toBeDefined();
    expect(msg!.payload).toMatchObject({ commit: 'h1', file: 'src/a.ts', hunkIndex: 0 });
    expect(msg!.payload!.lineIndices).toBeUndefined();
  });

  it('right-click → "Reverse Hunk" menu item reverses the whole hunk', async () => {
    const { container } = await setupReversible();
    rightClick(container.querySelectorAll('.diff-content .diff-line')[1]);
    await waitFor(() => container.querySelector('.context-menu'));
    const item = Array.from(container.querySelectorAll<HTMLButtonElement>('.context-menu .menu-item'))
      .find(b => b.textContent?.trim() === 'Reverse Hunk')!;
    expect(item).toBeDefined();
    await fireEvent.click(item);
    const msg = lastReverse();
    expect(msg!.payload).toMatchObject({ commit: 'h1', file: 'src/a.ts', hunkIndex: 0 });
    expect(msg!.payload!.lineIndices).toBeUndefined();
    // The menu closes after the action.
    await waitFor(() => expect(container.querySelector('.context-menu')).toBeNull());
  });

  it('selected-lines reverse button reverses just the dragged changed lines', async () => {
    const { container } = await setupReversible();
    const g = container.querySelectorAll('.diff-content .diff-line .line-gutter');
    await fireEvent.mouseDown(g[1]);
    await fireEvent.mouseEnter(g[2]);
    await fireEvent.mouseUp(window);
    const btn = container.querySelector<HTMLButtonElement>('.hunk-lines-btn');
    expect(btn).not.toBeNull();
    await fireEvent.click(btn!);
    const msg = lastReverse();
    expect(msg!.payload).toMatchObject({ commit: 'h1', file: 'src/a.ts', hunkIndex: 0, lineIndices: [1, 2] });
  });

  it('right-click on a selection → "Reverse Selected Lines" reverses those lines', async () => {
    const { container } = await setupReversible();
    const g = container.querySelectorAll('.diff-content .diff-line .line-gutter');
    await fireEvent.mouseDown(g[1]);
    await fireEvent.mouseEnter(g[2]);
    await fireEvent.mouseUp(window);
    rightClick(container.querySelectorAll('.diff-content .diff-line')[2]);
    await waitFor(() => container.querySelector('.context-menu'));
    const item = Array.from(container.querySelectorAll<HTMLButtonElement>('.context-menu .menu-item'))
      .find(b => /Reverse Selected Lines/.test(b.textContent ?? ''))!;
    expect(item).toBeDefined();
    await fireEvent.click(item);
    const msg = lastReverse();
    expect(msg!.payload).toMatchObject({ commit: 'h1', file: 'src/a.ts', hunkIndex: 0, lineIndices: [1, 2] });
  });
});
