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
  successMessage = $state<string | null>(null);
  repos = $state<Array<{ path: string; name: string; type: 'root' | 'submodule' | 'nested' }>>([]);
  activeRepo = $state('');
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private successTimer: ReturnType<typeof setTimeout> | null = null;

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

  setSuccess(message: string | null) {
    if (this.successTimer) {
      clearTimeout(this.successTimer);
      this.successTimer = null;
    }
    this.successMessage = message;
    if (message) {
      this.successTimer = setTimeout(() => {
        this.successMessage = null;
        this.successTimer = null;
      }, 5000);
    }
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
