<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { t } from '../../lib/i18n/index.svelte';

  interface AuthorStat { author: string; count: number; }
  interface HourStat { weekday: number; hour: number; count: number; }

  const vscode = getVsCodeApi();
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  let byAuthor = $state<AuthorStat[]>([]);
  let byWeekdayHour = $state<HourStat[]>([]);
  let loading = $state(true);
  let maxHeatCount = $derived(Math.max(1, ...byWeekdayHour.map(s => s.count)));

  onMount(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data.type === 'statsData') {
        byAuthor = event.data.payload.byAuthor;
        byWeekdayHour = event.data.payload.byWeekdayHour;
        loading = false;
      }
    }
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'getStats' });
    return () => window.removeEventListener('message', handleMessage);
  });

  function getHeatColor(count: number): string {
    if (count === 0) return 'rgba(128,128,128,0.1)';
    const intensity = Math.min(count / maxHeatCount, 1);
    return `rgba(99, 176, 244, ${0.15 + intensity * 0.85})`;
  }

  function getHeatCount(weekday: number, hour: number): number {
    return byWeekdayHour.find(s => s.weekday === weekday && s.hour === hour)?.count ?? 0;
  }

  let totalCommits = $derived(byAuthor.reduce((sum, a) => sum + a.count, 0));
</script>

<div class="stats-view">
  {#if loading}
    <div class="loading"><span class="spinner"></span> {t('stats.loading')}</div>
  {:else}
    <div class="stats-section">
      <h3 class="stats-title">{t('stats.contributors', { count: byAuthor.length })}</h3>
      <div class="author-list">
        {#each byAuthor as author, i}
          <div class="author-row">
            <span class="author-rank">#{i + 1}</span>
            <span class="author-name truncate">{author.author}</span>
            <div class="author-bar-container">
              <div class="author-bar" style="width: {(author.count / (byAuthor[0]?.count || 1)) * 100}%"></div>
            </div>
            <span class="author-count">{author.count}</span>
          </div>
        {/each}
      </div>
    </div>

    <div class="stats-section">
      <h3 class="stats-title">{t('stats.commitsByDayHour', { count: totalCommits })}</h3>
      <div class="heatmap">
        <div class="heatmap-header">
          <div class="heatmap-label"></div>
          {#each Array(24) as _, h}
            <div class="heatmap-hour">{h}</div>
          {/each}
        </div>
        {#each Array(7) as _, d}
          <div class="heatmap-row">
            <div class="heatmap-label">{WEEKDAYS[d]}</div>
            {#each Array(24) as _, h}
              {@const count = getHeatCount(d, h)}
              <div
                class="heatmap-cell"
                style="background: {getHeatColor(count)}"
                title="{WEEKDAYS[d]} {h}:00 — {count} commits"
              ></div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .stats-view {
    height: 100%;
    overflow-y: auto;
    padding: 16px;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    color: var(--text-secondary);
  }

  .stats-section {
    margin-bottom: 24px;
  }

  .stats-title {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 10px;
    color: var(--text-primary);
  }

  .author-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .author-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    padding: 3px 0;
  }

  .author-rank {
    width: 28px;
    color: var(--text-secondary);
    font-size: 11px;
    text-align: right;
    flex-shrink: 0;
  }

  .author-name {
    width: 140px;
    flex-shrink: 0;
  }

  .author-bar-container {
    flex: 1;
    height: 8px;
    background: rgba(128, 128, 128, 0.1);
    border-radius: 4px;
    overflow: hidden;
  }

  .author-bar {
    height: 100%;
    background: #63b0f4;
    border-radius: 4px;
    transition: width 0.3s;
  }

  .author-count {
    width: 45px;
    text-align: right;
    color: var(--text-secondary);
    font-size: 11px;
    flex-shrink: 0;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  /* Heatmap */
  .heatmap {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .heatmap-header, .heatmap-row {
    display: flex;
    gap: 2px;
    align-items: center;
  }

  .heatmap-label {
    width: 32px;
    font-size: 10px;
    color: var(--text-secondary);
    text-align: right;
    flex-shrink: 0;
  }

  .heatmap-hour {
    width: 18px;
    font-size: 9px;
    color: var(--text-secondary);
    text-align: center;
  }

  .heatmap-cell {
    width: 18px;
    height: 18px;
    border-radius: 3px;
    cursor: default;
  }
</style>
