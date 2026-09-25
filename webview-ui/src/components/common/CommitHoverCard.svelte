<script lang="ts">
  import type { Commit } from '../../lib/types';
  import { avatarStore } from '../../lib/stores/avatars.svelte';
  import { onMount } from 'svelte';

  interface Props {
    commit: Commit;
    x: number;
    y: number;
    onClose: () => void;
    onNavigate: () => void;
  }

  let { commit, x, y, onClose, onNavigate }: Props = $props();
  let cardEl: HTMLDivElement | undefined = $state();

  function formatFullDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString();
  }

  // Keep within viewport
  // svelte-ignore state_referenced_locally
  let adjustedX = $state(x);
  // svelte-ignore state_referenced_locally
  let adjustedY = $state(y);

  $effect(() => {
    if (cardEl) {
      const rect = cardEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const OFFSET_X = 10;
      const OFFSET_Y = 15;

      let nextX = x + OFFSET_X;
      let nextY = y + OFFSET_Y;

      if (nextX + rect.width > vw - 10) nextX = x - rect.width - OFFSET_X;
      if (nextY + rect.height > vh - 10) nextY = y - rect.height - OFFSET_Y;

      adjustedX = Math.max(10, nextX);
      adjustedY = Math.max(10, nextY);
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="commit-hover-card"
  bind:this={cardEl}
  style="left: {adjustedX}px; top: {adjustedY}px;"
  onmouseleave={onClose}
>
  <div class="card-header">
    <div class="author-row">
      {#if avatarStore.enabled}
        <img class="avatar" src={avatarStore.url(commit.author.email, 32)} alt="" />
      {/if}
      <div class="author-meta">
        <div class="name-line">
          <span class="author-name">{commit.author.name}</span>
          <span class="author-email">&lt;{commit.author.email}&gt;</span>
        </div>
        <div class="date-line">
          <span class="commit-date">{formatFullDate(commit.author.date)}</span>
          <span class="dot">·</span>
          <span class="commit-hash">{commit.hash.substring(0, 7)}</span>
        </div>
      </div>
    </div>
  </div>
  <div class="card-body">
    <div class="commit-subject">{commit.subject}</div>
  </div>
</div>

<style>
  .commit-hover-card {
    position: fixed;
    z-index: 2000;
    background: var(--vscode-editorWidget-background, var(--bg-secondary));
    border: 1px solid var(--vscode-editorWidget-border, var(--border-color));
    border-radius: 6px;
    padding: 12px;
    min-width: 320px;
    max-width: 480px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
    font-size: var(--vscode-font-size, 13px);
    pointer-events: auto;
    transition: transform 0.1s ease-out, opacity 0.1s ease-out;
  }

  :global(body.vscode-light) .commit-hover-card {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  }

  .author-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 12px;
  }

  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
  }

  .author-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .name-line {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
  }

  .author-name {
    font-weight: 600;
    color: var(--text-primary);
  }

  .author-email {
    font-size: 0.9em;
    color: var(--text-secondary);
    opacity: 0.7;
  }

  .date-line {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    font-size: 0.9em;
  }

  .dot {
    opacity: 0.4;
  }

  .commit-hash {
    font-family: var(--vscode-editor-font-family, monospace);
    opacity: 0.6;
    background: rgba(128, 128, 128, 0.1);
    padding: 0 4px;
    border-radius: 3px;
  }

  .commit-subject {
    font-weight: 500;
    line-height: 1.5;
    word-break: break-word;
    color: var(--text-primary);
    border-top: 1px solid var(--border-color);
    padding-top: 10px;
  }
</style>
