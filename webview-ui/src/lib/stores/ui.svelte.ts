import type { InteractiveRebaseMode } from '../types';

export const BOTTOM_PANEL_DEFAULT_RATIO = 0.5;
export const BOTTOM_PANEL_MIN_RATIO = 0.2;
export const BOTTOM_PANEL_MAX_RATIO = 0.7;

class UiStore {
  selectedCommitHash = $state<string | null>(null);
  selectedCommitHashes = $state<string[]>([]);
  anchorHash = $state<string | null>(null);
  multiSelectArmed = $state(false);
  commitDetailFullscreen = $state(false);
  comparing = $state(false);
  compareRef1 = $state<string | null>(null);
  compareRef2 = $state<string | null>(null);
  viewMode = $state<'graph' | 'log' | 'stats'>('graph');
  bottomPanelRatio = $state(BOTTOM_PANEL_DEFAULT_RATIO);
  showBottomPanel = $state(true);
  sidebarWidth = $state(220);
  errorMessage = $state<string | null>(null);
  repos = $state<Array<{ path: string; name: string; type: 'root' | 'submodule' | 'nested' }>>([]);
  activeRepo = $state('');
  homeDir = $state('');
  operating = $state<string | null>(null);
  badgeBarWidth = $state(4);
  loadMoreCount = $state(50);
  interactiveRebaseMode = $state<InteractiveRebaseMode>('ui');
  // True while a file is selected in the commit-details panel. Owned (synced)
  // by CommitDetails; read by the global Esc handler so the first Esc deselects
  // the file instead of closing the whole panel.
  commitFileSelected = $state(false);
  // Bumped to ask CommitDetails to clear its current file selection. CommitDetails
  // watches this counter (it can't be cleared from here — the selection is its
  // local state).
  clearCommitFileSelectionSignal = $state(0);
  private errorTimer: ReturnType<typeof setTimeout> | null = null;

  requestClearCommitFileSelection() {
    this.clearCommitFileSelectionSignal++;
  }

  selectCommit(hash: string | null) {
    this.multiSelectArmed = false;
    this.selectedCommitHash = hash;
    this.selectedCommitHashes = hash ? [hash] : [];
    this.anchorHash = hash;
    this.comparing = false;
    this.compareRef1 = null;
    this.compareRef2 = null;
    if (hash) {
      this.showBottomPanel = true;
    }
  }

  // Plain click: single selection with toggle-off when re-clicking the sole selection.
  selectSingle(hash: string) {
    const toggleOff = this.selectedCommitHash === hash && this.selectedCommitHashes.length === 1;
    this.selectCommit(toggleOff ? null : hash);
  }

  // Ctrl/Cmd-click: add or remove a hash from the multi-selection.
  toggleHash(hash: string) {
    this.comparing = false;
    this.compareRef1 = null;
    this.compareRef2 = null;
    const arr = [...this.selectedCommitHashes];
    const i = arr.indexOf(hash);
    const removed = i >= 0;
    if (removed) arr.splice(i, 1); else arr.push(hash);
    this.selectedCommitHashes = arr;
    if (removed) {
      // Keep a valid anchor for the next Shift-click: stay if still selected,
      // else fall back to the last remaining element (or null if empty).
      if (this.anchorHash === null || !arr.includes(this.anchorHash)) {
        this.anchorHash = arr.length ? arr[arr.length - 1] : null;
      }
    } else {
      this.anchorHash = hash;
    }
    // In armed multi-select mode, selectedCommitHash is always null.
    this.selectedCommitHash = null;
    if (arr.length) this.showBottomPanel = true;
  }

  // Shift-click: select the inclusive range between the anchor and `toHash`,
  // ordered by `orderedHashes` (graph display order, newest first).
  selectRange(toHash: string, orderedHashes: string[]) {
    if (!this.anchorHash) { this.toggleHash(toHash); return; }
    const a = orderedHashes.indexOf(this.anchorHash);
    const b = orderedHashes.indexOf(toHash);
    if (a < 0 || b < 0) { this.toggleHash(toHash); return; }
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    this.comparing = false;
    this.compareRef1 = null;
    this.compareRef2 = null;
    this.selectedCommitHashes = orderedHashes.slice(lo, hi + 1);
    // In armed multi-select mode, selectedCommitHash is always null.
    this.selectedCommitHash = null;
    this.showBottomPanel = true;
  }

  // Modifier-click (Ctrl/Cmd toggle or Shift range) directly on a commit.
  // The first modifier-click promotes a plain single selection into armed
  // multi-select (seeding with the previously-selected commit), then defers to
  // the same toggle/range handlers used in armed mode. For a Shift-range with
  // nothing selected yet, `fallbackAnchor` (the current branch HEAD) seeds the
  // anchor so the range runs HEAD → clicked instead of selecting one commit.
  modifierSelect(
    hash: string,
    opts: { range: boolean; orderedHashes: string[]; fallbackAnchor?: string | null },
  ) {
    if (!this.multiSelectArmed) {
      const fallback =
        opts.range && opts.fallbackAnchor && opts.orderedHashes.includes(opts.fallbackAnchor)
          ? opts.fallbackAnchor
          : null;
      const seed = this.selectedCommitHash ?? fallback;
      this.multiSelectArmed = true;
      this.selectedCommitHashes = seed ? [seed] : [];
      this.anchorHash = seed;
      this.selectedCommitHash = null;
      this.comparing = false;
      this.compareRef1 = null;
      this.compareRef2 = null;
    }
    if (opts.range) {
      this.selectRange(hash, opts.orderedHashes);
    } else {
      this.toggleHash(hash);
    }
  }

  // Menu entry: arm selection mode, seed with one commit. No single-detail view.
  enterMultiSelect(hash: string) {
    this.multiSelectArmed = true;
    this.selectedCommitHash = null;
    this.selectedCommitHashes = [hash];
    this.anchorHash = hash;
    this.comparing = false;
    this.compareRef1 = null;
    this.compareRef2 = null;
    this.showBottomPanel = true;
  }

  // Esc / menu cancel: leave selection mode entirely.
  exitMultiSelect() {
    this.multiSelectArmed = false;
    this.selectedCommitHashes = [];
    this.anchorHash = null;
    this.selectedCommitHash = null;
    this.comparing = false;
    this.compareRef1 = null;
    this.compareRef2 = null;
  }

  setViewMode(mode: 'graph' | 'log' | 'stats') {
    this.viewMode = mode;
  }

  setError(message: string | null) {
    // Clear existing timer
    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
      this.errorTimer = null;
    }

    this.errorMessage = message;
    if (message) {
      this.errorTimer = setTimeout(() => {
        this.errorMessage = null;
        this.errorTimer = null;
      }, 8000);
    }
  }
}

export const uiStore = new UiStore();
