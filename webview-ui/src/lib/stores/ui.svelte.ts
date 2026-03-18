class UiStore {
  selectedCommitHash = $state<string | null>(null);
  comparing = $state(false);
  viewMode = $state<'graph' | 'log' | 'stats'>('graph');
  bottomPanelHeight = $state(250);
  showBottomPanel = $state(true);
  sidebarWidth = $state(220);
  errorMessage = $state<string | null>(null);
  repos = $state<Array<{ path: string; name: string }>>([]);
  activeRepo = $state('');
  private errorTimer: ReturnType<typeof setTimeout> | null = null;

  selectCommit(hash: string | null) {
    this.selectedCommitHash = hash;
    this.comparing = false;
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
