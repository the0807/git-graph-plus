<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { getGravatarUrl } from '../../lib/utils/gravatar';
  import { t } from '../../lib/i18n/index.svelte';

  interface AuthorStat { author: string; email: string; count: number; }
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
    if (count === 0) return 'rgba(128,128,128,0.08)';
    const intensity = Math.min(count / maxHeatCount, 1);
    return `rgba(99, 176, 244, ${0.15 + intensity * 0.85})`;
  }

  function getHeatCount(weekday: number, hour: number): number {
    return byWeekdayHour.find(s => s.weekday === weekday && s.hour === hour)?.count ?? 0;
  }

  let totalCommits = $derived(byAuthor.reduce((sum, a) => sum + a.count, 0));
  let maxCount = $derived(byAuthor[0]?.count || 1);
</script>

<div class="stats-view">
  {#if loading}
    <div class="loading"><span class="spinner"></span> {t('stats.loading')}</div>
  {:else}
    <!-- Contributors -->
    <div class="stats-section">
      <div class="section-header">
        <h3 class="stats-title">{t('stats.contributors', { count: byAuthor.length })}</h3>
        <span class="stats-subtitle">{totalCommits} commits</span>
      </div>
      <div class="author-list">
        {#each byAuthor as author, i}
          <div class="author-row">
            <span class="author-rank">#{i + 1}</span>
            <img class="author-avatar" src={getGravatarUrl(author.email, 24)} alt="" loading="lazy" />
            <div class="author-info">
              <span class="author-name truncate">{author.author}</span>
              <div class="author-bar-container">
                <div class="author-bar" style="width: {(author.count / maxCount) * 100}%"></div>
              </div>
            </div>
            <span class="author-count">{author.count}</span>
            <span class="author-percent">{((author.count / totalCommits) * 100).toFixed(0)}%</span>
          </div>
        {/each}
      </div>
    </div>

    <!-- Heatmap -->
    <div class="stats-section">
      <div class="section-header">
        <h3 class="stats-title">{t('stats.commitsByDayHour', { count: totalCommits })}</h3>
      </div>
      <div class="heatmap-container">
        <div class="heatmap">
          <div class="heatmap-header">
            <div class="heatmap-label"></div>
            {#each Array(24) as _, h}
              <div class="heatmap-hour">{h.toString().padStart(2, '0')}</div>
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
                  title="{WEEKDAYS[d]} {h.toString().padStart(2, '0')}:00 - {count} commits"
                ></div>
              {/each}
            </div>
          {/each}
        </div>
        <div class="heatmap-legend">
          <span class="heatmap-legend-label">{t('stats.less')}</span>
          {#each [0, 0.25, 0.5, 0.75, 1] as intensity}
            <div class="heatmap-legend-cell" style="background: {intensity === 0 ? 'rgba(128,128,128,0.08)' : `rgba(99, 176, 244, ${0.15 + intensity * 0.85})`}"></div>
          {/each}
          <span class="heatmap-legend-label">{t('stats.more')}</span>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .stats-view {
    height: 100%;
    overflow-y: auto;
    padding: 20px;
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
    margin-bottom: 28px;
  }

  .section-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 12px;
  }

  .stats-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .stats-subtitle {
    font-size: 11px;
    color: var(--text-secondary);
  }

  /* ---- Contributors ---- */
  .author-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .author-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: inherit;
    padding: 4px 6px;
    border-radius: 4px;
  }

  .author-row:hover {
    background: var(--bg-hover);
  }

  .author-rank {
    width: 24px;
    color: var(--text-secondary);
    font-size: 10px;
    text-align: right;
    flex-shrink: 0;
    opacity: 0.6;
  }

  .author-avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .author-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .author-name {
    font-size: inherit;
    color: var(--text-primary);
  }

  .author-bar-container {
    height: 4px;
    background: rgba(128, 128, 128, 0.1);
    border-radius: 2px;
    overflow: hidden;
  }

  .author-bar {
    height: 100%;
    background: #63b0f4;
    border-radius: 2px;
    transition: width 0.3s;
  }

  .author-count {
    width: 40px;
    text-align: right;
    color: var(--text-primary);
    font-size: 11px;
    flex-shrink: 0;
    font-weight: 600;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .author-percent {
    width: 32px;
    text-align: right;
    color: var(--text-secondary);
    font-size: 10px;
    flex-shrink: 0;
  }

  /* ---- Heatmap ---- */
  .heatmap-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .heatmap {
    display: inline-flex;
    flex-direction: column;
    gap: 2px;
  }

  .heatmap-header, .heatmap-row {
    display: flex;
    gap: 2px;
    align-items: center;
  }

  .heatmap-label {
    width: 36px;
    font-size: 10px;
    color: var(--text-secondary);
    text-align: right;
    flex-shrink: 0;
    padding-right: 4px;
  }

  .heatmap-hour {
    width: 22px;
    font-size: 9px;
    color: var(--text-secondary);
    text-align: center;
    opacity: 0.6;
  }

  .heatmap-cell {
    width: 22px;
    height: 22px;
    border-radius: 3px;
    cursor: default;
    transition: transform 0.1s;
  }

  .heatmap-cell:hover {
    transform: scale(1.2);
    outline: 1px solid var(--text-secondary);
    z-index: 1;
  }

  .heatmap-legend {
    display: flex;
    align-items: center;
    gap: 3px;
    padding-left: 40px;
  }

  .heatmap-legend-label {
    font-size: 10px;
    color: var(--text-secondary);
    padding: 0 4px;
  }

  .heatmap-legend-cell {
    width: 14px;
    height: 14px;
    border-radius: 2px;
  }
</style>
