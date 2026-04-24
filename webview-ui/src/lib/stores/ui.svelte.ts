export const BOTTOM_PANEL_DEFAULT_RATIO = 0.35;
export const BOTTOM_PANEL_MIN_RATIO = 0.2;
export const BOTTOM_PANEL_MAX_RATIO = 0.7;

class UiStore {
  selectedCommitHash = $state<string | null>(null);
  comparing = $state(false);
  compareRef1 = $state<string | null>(null);
  compareRef2 = $state<string | null>(null);
  viewMode = $state<'graph' | 'log' | 'stats'>('graph');
  bottomPanelHeight = $state(250);
  showBottomPanel = $state(true);
  sidebarWidth = $state(220);
  errorMessage = $state<string | null>(null);
  repos = $state<Array<{ path: string; name: string; type: 'root' | 'submodule' | 'nested' }>>([]);
  activeRepo = $state('');
  homeDir = $state('');
  operating = $state<string | null>(null);
  private errorTimer: ReturnType<typeof setTimeout> | null = null;

  selectCommit(hash: string | null) {
    this.selectedCommitHash = hash;
    this.comparing = false;
    this.compareRef1 = null;
    this.compareRef2 = null;
    if (hash) {
      this.showBottomPanel = true;
    }
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
