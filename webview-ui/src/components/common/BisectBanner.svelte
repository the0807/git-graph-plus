<script lang="ts">
  import { t } from '../../lib/i18n/index.svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';

  interface Props {
    message: string;
    onReset: () => void;
  }

  let { message, onReset }: Props = $props();

  const vscode = getVsCodeApi();

  // Parse bisect result message
  const isFinished = $derived(message.includes('is the first bad commit') || message.includes('첫 번째 나쁜 커밋'));

  // Extract remaining steps from message like "Bisecting: 3 revisions left to test after this (roughly 2 steps)"
  const remainingSteps = $derived.by(() => {
    const match = message.match(/roughly (\d+) step/);
    return match ? match[1] : null;
  });

  // Extract current commit hash from message
  const currentHash = $derived.by(() => {
    const match = message.match(/\[([a-f0-9]{7,40})\]/);
    return match ? match[1] : null;
  });

  // Extract culprit commit hash when finished
  const culpritHash = $derived.by(() => {
    if (!isFinished) return null;
    const match = message.match(/^([a-f0-9]{7,40})/m);
    return match ? match[1] : null;
  });

  // Extract commit message summary of culprit
  const culpritSummary = $derived.by(() => {
    if (!isFinished) return null;
    const lines = message.split('\n');
    // Look for indented lines after Date: (git log format)
    let pastHeaders = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('Author:') || trimmed.startsWith('Date:') || trimmed.startsWith('commit ') || trimmed.startsWith(':')) {
        pastHeaders = true;
        continue;
      }
      if (trimmed === '' && pastHeaders) continue;
      if (pastHeaders && trimmed.length > 0 && !trimmed.includes('is the first bad commit')) {
        return trimmed;
      }
    }
    return null;
  });

  // Extract author from culprit
  const culpritAuthor = $derived.by(() => {
    if (!isFinished) return null;
    const match = message.match(/Author:\s*(.+?)\s*</);
    return match ? match[1] : null;
  });

  function markGood() {
    vscode.postMessage({ type: 'bisectGood', payload: {} });
  }

  function markBad() {
    vscode.postMessage({ type: 'bisectBad', payload: {} });
  }

  function skip() {
    vscode.postMessage({ type: 'bisectSkip' });
  }
</script>

<div class="bisect-banner" class:finished={isFinished}>
  <div class="bisect-header">
    <i class="codicon codicon-search"></i>
    <span class="bisect-title">
      {#if isFinished}
        {t('bisect.banner.found')}
      {:else}
        {t('bisect.banner.title')}
        {#if remainingSteps}
          <span class="bisect-remaining"> - {t('bisect.banner.remaining', { count: remainingSteps })}</span>
        {/if}
      {/if}
    </span>
  </div>

  {#if isFinished && culpritHash}
    <div class="bisect-culprit">
      <i class="codicon codicon-git-commit"></i>
      <span class="bisect-hash">{culpritHash.substring(0, 7)}</span>
      {#if culpritSummary}
        <span class="bisect-summary">{culpritSummary}</span>
      {/if}
    </div>
  {:else if currentHash}
    <div class="bisect-current">
      <span class="bisect-current-label">{t('bisect.banner.current')}</span>
      <span class="bisect-hash">{currentHash.substring(0, 7)}</span>
    </div>
  {/if}

  <div class="bisect-actions">
    {#if !isFinished}
      <button class="bisect-btn bisect-good" onclick={markGood}>
        <i class="codicon codicon-check"></i>
        {t('bisect.banner.good')}
      </button>
      <button class="bisect-btn bisect-bad" onclick={markBad}>
        <i class="codicon codicon-close"></i>
        {t('bisect.banner.bad')}
      </button>
      <button class="bisect-btn bisect-skip" onclick={skip}>
        {t('bisect.banner.skip')}
      </button>
    {/if}
    <button class="bisect-btn bisect-reset" onclick={onReset}>
      {t('bisect.banner.reset')}
    </button>
  </div>
</div>

<style>
  .bisect-banner {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 14px;
    background: rgba(33, 150, 243, 0.08);
    border: 1px solid rgba(33, 150, 243, 0.3);
    border-radius: 6px;
    margin: 8px;
  }

  .bisect-banner.finished {
    background: rgba(76, 175, 80, 0.08);
    border-color: rgba(76, 175, 80, 0.3);
  }

  .bisect-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .bisect-header i {
    font-size: 14px;
    color: #2196f3;
  }

  .bisect-banner.finished .bisect-header i {
    color: #4caf50;
  }

  .bisect-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .bisect-remaining {
    font-weight: 400;
    color: var(--text-secondary);
  }

  .bisect-current {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .bisect-culprit {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    padding: 6px 10px;
    background: rgba(128, 128, 128, 0.1);
    border-radius: 4px;
  }

  .bisect-culprit i {
    color: var(--text-secondary);
  }

  .bisect-hash {
    font-family: monospace;
    font-weight: 600;
    color: var(--text-primary);
  }

  .bisect-summary {
    color: var(--text-primary);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bisect-actions {
    display: flex;
    gap: 6px;
  }

  .bisect-btn {
    padding: 3px 10px;
    font-size: 11px;
    border-radius: 3px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .bisect-btn:hover {
    background: rgba(128, 128, 128, 0.15);
  }

  .bisect-good {
    border-color: rgba(76, 175, 80, 0.4);
    color: #4caf50;
  }

  .bisect-good:hover {
    background: rgba(76, 175, 80, 0.15);
  }

  .bisect-bad {
    border-color: rgba(244, 67, 54, 0.4);
    color: #f44336;
  }

  .bisect-bad:hover {
    background: rgba(244, 67, 54, 0.15);
  }

  .bisect-skip {
    color: var(--text-secondary);
  }

  .bisect-reset {
    color: var(--text-secondary);
    margin-left: auto;
  }
</style>
