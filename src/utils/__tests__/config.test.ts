import { describe, it, expect, vi, beforeEach } from 'vitest';

// The config helpers read `gitGraphPlus.*` settings via the VS Code config API.
// The mock lets each test control what a given key returns; `undefined` means
// "not set", so the getter hands back the caller-supplied default.
const h = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, def: number) => (h.values[key] === undefined ? def : h.values[key]),
    }),
  },
}));

import { readTimeoutMs, readInitialCommitCount, readLoadMoreCommitCount, readLfsLocksEnabled } from '../config';

describe('readTimeoutMs', () => {
  // Back-compat alias so the existing timeout cases below read naturally.
  const setTimeout = (v: unknown) => { h.values.timeout = v; };

  beforeEach(() => {
    h.values = {};
  });

  it('converts a positive seconds value to milliseconds', () => {
    setTimeout(30);
    expect(readTimeoutMs()).toBe(30_000);
  });

  it('falls back to 60s when the setting is unset (uses the default of 60)', () => {
    setTimeout(undefined);
    expect(readTimeoutMs()).toBe(60_000);
  });

  it('falls back to 60s for a zero or negative value', () => {
    setTimeout(0);
    expect(readTimeoutMs()).toBe(60_000);
    setTimeout(-5);
    expect(readTimeoutMs()).toBe(60_000);
  });

  it('falls back to 60s for a non-finite value', () => {
    setTimeout(Infinity);
    expect(readTimeoutMs()).toBe(60_000);
    setTimeout(NaN);
    expect(readTimeoutMs()).toBe(60_000);
  });

  it('falls back to 60s for a non-number value', () => {
    setTimeout('soon');
    expect(readTimeoutMs()).toBe(60_000);
  });
});

describe('readInitialCommitCount', () => {
  beforeEach(() => { h.values = {}; });

  it('defaults to 200 when unset', () => {
    expect(readInitialCommitCount()).toBe(200);
  });

  it('returns a positive integer value as-is', () => {
    h.values.initialCommitCount = 500;
    expect(readInitialCommitCount()).toBe(500);
  });

  it('floors a fractional value', () => {
    h.values.initialCommitCount = 99.9;
    expect(readInitialCommitCount()).toBe(99);
  });

  it('falls back to 200 for zero, negative, or non-number values', () => {
    h.values.initialCommitCount = 0;
    expect(readInitialCommitCount()).toBe(200);
    h.values.initialCommitCount = -10;
    expect(readInitialCommitCount()).toBe(200);
    h.values.initialCommitCount = 'lots';
    expect(readInitialCommitCount()).toBe(200);
  });
});

describe('readLoadMoreCommitCount', () => {
  beforeEach(() => { h.values = {}; });

  it('defaults to 50 when unset', () => {
    expect(readLoadMoreCommitCount()).toBe(50);
  });

  it('returns a positive integer value as-is', () => {
    h.values.loadMoreCommitCount = 25;
    expect(readLoadMoreCommitCount()).toBe(25);
  });

  it('falls back to 50 for zero, negative, or non-finite values', () => {
    h.values.loadMoreCommitCount = 0;
    expect(readLoadMoreCommitCount()).toBe(50);
    h.values.loadMoreCommitCount = -1;
    expect(readLoadMoreCommitCount()).toBe(50);
    h.values.loadMoreCommitCount = Infinity;
    expect(readLoadMoreCommitCount()).toBe(50);
  });
});

describe('readLfsLocksEnabled', () => {
  beforeEach(() => { h.values = {}; });

  it('defaults to true when unset', () => {
    expect(readLfsLocksEnabled()).toBe(true);
  });

  it('returns the configured boolean as-is', () => {
    h.values.lfsLocks = true;
    expect(readLfsLocksEnabled()).toBe(true);
    h.values.lfsLocks = false;
    expect(readLfsLocksEnabled()).toBe(false);
  });

  it('falls back to true for non-boolean values', () => {
    h.values.lfsLocks = 'no';
    expect(readLfsLocksEnabled()).toBe(true);
    h.values.lfsLocks = 0;
    expect(readLfsLocksEnabled()).toBe(true);
  });
});
