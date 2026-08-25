import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared registry of the fake watchers created during a test, so we can fire
// filesystem events by hand. vi.hoisted keeps it available inside the hoisted
// vi.mock factory below.
const h = vi.hoisted(() => {
  interface FakeWatcher {
    pattern: { pattern: string };
    handlers: Record<'change' | 'create' | 'delete', Array<(uri: unknown) => void>>;
    dispose: ReturnType<typeof vi.fn>;
    fire(kind: 'change' | 'create' | 'delete', uri: unknown): void;
  }
  return { watchers: [] as FakeWatcher[] };
});

vi.mock('vscode', () => {
  class RelativePattern {
    constructor(public base: unknown, public pattern: string) {}
  }
  return {
    RelativePattern,
    Uri: { file: (p: string) => ({ fsPath: p }) },
    Disposable: class { dispose() {} },
    workspace: {
      createFileSystemWatcher: (pattern: { pattern: string }) => {
        const handlers = { change: [], create: [], delete: [] } as Record<'change' | 'create' | 'delete', Array<(uri: unknown) => void>>;
        const w = {
          pattern,
          handlers,
          onDidChange: (cb: (uri: unknown) => void) => { handlers.change.push(cb); return { dispose() {} }; },
          onDidCreate: (cb: (uri: unknown) => void) => { handlers.create.push(cb); return { dispose() {} }; },
          onDidDelete: (cb: (uri: unknown) => void) => { handlers.delete.push(cb); return { dispose() {} }; },
          dispose: vi.fn(),
          fire(kind: 'change' | 'create' | 'delete', uri: unknown) { handlers[kind].forEach(cb => cb(uri)); },
        };
        h.watchers.push(w);
        return w;
      },
    },
  };
});

import { FileWatcher } from '../file-watcher';

const REPO = '/tmp/ggp-fw-test';

function fireOn(patternStr: string, fsPath: string, kind: 'change' | 'create' | 'delete' = 'change') {
  const w = h.watchers.find(w => w.pattern.pattern === patternStr);
  if (!w) throw new Error(`no watcher for pattern ${patternStr}`);
  w.fire(kind, { fsPath });
}

describe('FileWatcher debounce / cooldown / suppress state machine', () => {
  let onChange: ReturnType<typeof vi.fn>;
  let fw: FileWatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    h.watchers.length = 0;
    onChange = vi.fn();
    fw = new FileWatcher(REPO, onChange);
  });

  afterEach(() => {
    fw.dispose();
    vi.useRealTimers();
  });

  it('coalesces a burst of events into one onChange after the debounce window', () => {
    fireOn('**', `${REPO}/src/a.ts`);
    fireOn('**', `${REPO}/src/b.ts`);
    fireOn('**', `${REPO}/src/c.ts`);
    vi.advanceTimersByTime(499);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('status');
  });

  it('picks the most significant change type (refs over status)', () => {
    fireOn('**', `${REPO}/src/a.ts`);                  // status
    fireOn('refs/**', `${REPO}/.git/refs/heads/main`); // refs
    vi.advanceTimersByTime(500);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('refs');
  });

  it('ignores working-tree changes inside IGNORE_DIRS (e.g. node_modules)', () => {
    fireOn('**', `${REPO}/node_modules/pkg/index.js`);
    vi.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('watches the worktree registry, not each worktree\'s private state', () => {
    // `worktrees/**` also matched every worktree's runtime files (index.lock,
    // FETCH_HEAD, COMMIT_EDITMSG, logs/**). In a linked worktree that set is
    // our OWN gitdir, so the panel's git commands fed its own watcher — an
    // endless refresh that restarted any in-flight history search. Only the
    // registry entries `worktree list` actually reports are worth watching.
    const patterns = h.watchers.map(w => w.pattern.pattern);
    expect(patterns).toContain('worktrees/*/{HEAD,gitdir,locked}');
    expect(patterns).not.toContain('worktrees/**');
  });

  it('does not fire when disabled', () => {
    fw.enabled = false;
    fireOn('**', `${REPO}/src/a.ts`);
    vi.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not fire after dispose, and disposes every underlying watcher', () => {
    const created = [...h.watchers];
    fw.dispose();
    fireOn('**', `${REPO}/src/a.ts`);
    vi.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
    for (const w of created) expect(w.dispose).toHaveBeenCalled();
  });

  it('suppress() absorbs events during the window, then re-triggers once afterwards', () => {
    fw.suppress(1000);
    fireOn('**', `${REPO}/src/a.ts`);
    // Still inside the suppression window → nothing yet.
    vi.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
    // Cooldown ends at 1000ms → a coalesced re-trigger is scheduled…
    vi.advanceTimersByTime(500);
    // …which then waits out its own debounce.
    vi.advanceTimersByTime(500);
    // Exactly one delivery, carrying the change type absorbed during the window
    // (the pending 'status' is retained and outranks the re-trigger's 'unknown').
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('status');
  });
});
