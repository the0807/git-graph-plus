<script lang="ts">
  import { uiStore } from '../../lib/stores/ui.svelte';
  import { commitStore } from '../../lib/stores/commits.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import CommitDetails from '../commit/CommitDetails.svelte';

  let commit = $derived(
    uiStore.selectedCommitHash
      ? commitStore.getCommit(uiStore.selectedCommitHash)
      : undefined
  );
</script>

<div class="bottom-panel">
  {#if commit}
    <CommitDetails {commit} />
  {:else if uiStore.comparing}
    <CommitDetails />
  {:else}
    <div class="empty">{t('details.selectCommit')}</div>
  {/if}
</div>

<style>
  .bottom-panel {
    height: 100%;
    overflow-y: auto;
    background: var(--bg-primary);
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-secondary);
    font-size: 13px;
  }
</style>
