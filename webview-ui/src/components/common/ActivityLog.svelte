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

  let entries = $state<LogEntry[]>([]);
  let autoRefresh = $state(true);

  function refresh() {
    vscode.postMessage({ type: 'getActivityLog' });
  }

  onMount(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data.type === 'activityLogData') {
        entries = event.data.payload;
      }
    }
    window.addEventListener('message', handleMessage);
    refresh();

    // Auto-refresh every 2 seconds when visible
    const interval = setInterval(() => {
      if (autoRefresh) { refresh(); }
    }, 2000);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearInterval(interval);
    };
  });

  function formatTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString();
  }
</script>

<div class="activity-log">
  <div class="log-header">
    <span>{t('activityLog.title')}</span>
    <div class="log-actions">
      <label class="auto-label">
        <input type="checkbox" bind:checked={autoRefresh} />
        <span>{t('activityLog.auto')}</span>
      </label>
      <button onclick={refresh}>{t('activityLog.refresh')}</button>
    </div>
  </div>
  <div class="log-list">
    {#each entries as entry}
      <div class="log-entry" class:failed={!entry.success}>
        <span class="log-status"><i class="codicon" class:codicon-pass-filled={entry.success} class:codicon-error={!entry.success}></i></span>
        <span class="log-command truncate">{entry.command}</span>
        <span class="log-duration">{entry.duration}ms</span>
        <span class="log-time">{formatTime(entry.timestamp)}</span>
      </div>
    {/each}
    {#if entries.length === 0}
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
    gap: 8px;
  }

  .auto-label {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    font-weight: normal;
    text-transform: none;
    letter-spacing: 0;
    cursor: pointer;
  }

  .auto-label input { margin: 0; }

  .log-list {
    flex: 1;
    overflow-y: auto;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
  }

  .log-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 10px;
    border-bottom: 1px solid rgba(128, 128, 128, 0.1);
  }

  .log-entry:hover {
    background: var(--bg-hover);
  }

  .log-entry.failed {
    color: var(--vscode-errorForeground, #f44336);
  }

  .log-status {
    width: 12px;
    flex-shrink: 0;
    text-align: center;
  }

  .log-entry:not(.failed) .log-status {
    color: #4caf50;
  }

  .log-command {
    flex: 1;
    min-width: 0;
  }

  .log-duration {
    flex-shrink: 0;
    opacity: 0.5;
    width: 50px;
    text-align: right;
  }

  .log-time {
    flex-shrink: 0;
    opacity: 0.4;
    width: 70px;
    text-align: right;
  }

  .log-empty {
    padding: 20px;
    text-align: center;
    color: var(--text-secondary);
    font-family: inherit;
  }
</style>
