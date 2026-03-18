<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { t } from '../../lib/i18n/index.svelte';

  interface LogEntry {
    command: string;
    timestamp: string;
    success: boolean;
    duration: number;
  }

  const vscode = getVsCodeApi();

  // User-facing git actions (filter out internal queries)
  const ACTION_PATTERNS = [
    'merge', 'rebase', 'cherry-pick', 'revert', 'reset',
    'checkout', 'branch -', 'tag ', 'push', 'pull', 'fetch',
    'stash', 'commit', 'remote add', 'remote remove',
  ];

  let allEntries = $state<LogEntry[]>([]);
  let showAll = $state(false);
  let autoRefresh = $state(true);

  function isUserAction(cmd: string): boolean {
    return ACTION_PATTERNS.some(p => cmd.includes(p));
  }

  let displayEntries = $derived(
    showAll ? allEntries : allEntries.filter(e => isUserAction(e.command))
  );

  function refresh() {
    vscode.postMessage({ type: 'getActivityLog' });
  }

  function formatTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function friendlyCommand(cmd: string): string {
    // Strip "git " prefix and long format strings
    let friendly = cmd.replace(/^git\s+/, '');
    // Truncate --format=... args
    friendly = friendly.replace(/--format=[^\s]+/g, '--format=…');
    return friendly;
  }

  onMount(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data.type === 'activityLogData') {
        allEntries = event.data.payload;
      }
    }
    window.addEventListener('message', handleMessage);
    refresh();

    const interval = setInterval(() => {
      if (autoRefresh) { refresh(); }
    }, 2000);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearInterval(interval);
    };
  });
</script>

<div class="activity-log">
  <div class="log-header">
    <span>{t('activityLog.title')}</span>
    <div class="log-actions">
      <label class="log-toggle">
        <input type="checkbox" bind:checked={showAll} />
        <span>{t('activityLog.showAll')}</span>
      </label>
      <label class="log-toggle">
        <input type="checkbox" bind:checked={autoRefresh} />
        <span>{t('activityLog.auto')}</span>
      </label>
      <button class="log-refresh" onclick={refresh} title={t('activityLog.refresh')}>
        <i class="codicon codicon-refresh"></i>
      </button>
    </div>
  </div>
  <div class="log-list">
    {#each displayEntries as entry, i}
      <div class="log-entry" class:failed={!entry.success}>
        <span class="log-index">{displayEntries.length - i}</span>
        <span class="log-status">
          <i class="codicon" class:codicon-pass-filled={entry.success} class:codicon-error={!entry.success}></i>
        </span>
        <span class="log-command truncate" title={entry.command}>{friendlyCommand(entry.command)}</span>
        <span class="log-duration">{formatDuration(entry.duration)}</span>
        <span class="log-time">{formatTime(entry.timestamp)}</span>
      </div>
    {/each}
    {#if displayEntries.length === 0}
      <div class="log-empty">{t('activityLog.empty')}</div>
    {/if}
  </div>
</div>

<style>
  .activity-log {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .log-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .log-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .log-toggle {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    font-weight: normal;
    text-transform: none;
    letter-spacing: 0;
    cursor: pointer;
  }

  .log-toggle input { margin: 0; }

  .log-refresh {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 2px;
    font-size: 12px;
  }

  .log-refresh:hover {
    color: var(--text-primary);
  }

  .log-list {
    flex: 1;
    overflow-y: auto;
    font-size: 11px;
  }

  .log-entry {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-bottom: 1px solid rgba(128, 128, 128, 0.08);
  }

  .log-entry:hover {
    background: var(--bg-hover);
  }

  .log-entry.failed {
    color: var(--vscode-errorForeground, #f44336);
  }

  .log-index {
    width: 24px;
    flex-shrink: 0;
    text-align: right;
    color: var(--text-secondary);
    font-size: 10px;
    opacity: 0.5;
  }

  .log-status {
    width: 14px;
    flex-shrink: 0;
    text-align: center;
  }

  .log-entry:not(.failed) .log-status {
    color: #4caf50;
  }

  .log-command {
    flex: 1;
    min-width: 0;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .log-duration {
    flex-shrink: 0;
    opacity: 0.5;
    width: 45px;
    text-align: right;
    font-size: 10px;
  }

  .log-time {
    flex-shrink: 0;
    opacity: 0.4;
    width: 70px;
    text-align: right;
    font-size: 10px;
  }

  .log-empty {
    padding: 20px;
    text-align: center;
    color: var(--text-secondary);
  }
</style>
