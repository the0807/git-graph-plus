<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';

  interface Props {
    commit: string;
    branch: string;
    onClose: () => void;
    onCherryPick: (noCommit: boolean) => void;
  }

  let { commit, branch, onClose, onCherryPick }: Props = $props();
  let noCommit = $state(false);
  let cherryPickBtn: HTMLButtonElement | undefined = $state();
  let conflictPrediction = $state<{ hasConflict: boolean; files: string[] } | null>(null);

  onMount(() => {
    cherryPickBtn?.focus();
    const vscode = getVsCodeApi();
    vscode.postMessage({ type: 'predictConflicts', payload: { ours: 'HEAD', theirs: commit } });
    const handler = (event: MessageEvent) => {
      if (event.data.type === 'conflictPrediction') {
        conflictPrediction = event.data.payload;
        window.removeEventListener('message', handler);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  });
</script>

<Modal title={t('cherryPick.title')} {onClose}>
  <p class="modal-desc">{t('cherryPick.desc')}</p>
  <div class="modal-context-card">
    <span class="modal-pill modal-pill--target"><i class="codicon codicon-git-commit"></i><span class="modal-pill-text">{commit.substring(0, 7)}</span></span>
    <i class="codicon codicon-arrow-right" style="color: var(--text-secondary);"></i>
    <span class="modal-pill modal-pill--source"><i class="codicon codicon-git-branch"></i><span class="modal-pill-text">{branch}</span></span>
  </div>
  <div class="modal-form-group">
    <label class="modal-checkbox">
      <input type="checkbox" bind:checked={noCommit} />
      <span>{t('cherryPick.noCommit')}</span>
    </label>
  </div>
  <div class="form-actions">
    <div class="conflict-status" class:is-warning={conflictPrediction?.hasConflict} class:is-success={conflictPrediction !== null && !conflictPrediction?.hasConflict}>
      {#if conflictPrediction === null}
        <span class="spinner"></span>
        <span>{t('cherryPick.checkingConflicts')}</span>
      {:else if conflictPrediction.hasConflict}
        <i class="codicon codicon-warning"></i>
        <span>{t('cherryPick.conflictWarning', { count: String(conflictPrediction.files.length) })}</span>
      {:else}
        <i class="codicon codicon-check"></i>
        <span>{t('cherryPick.noConflict')}</span>
      {/if}
    </div>
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" bind:this={cherryPickBtn} onclick={() => onCherryPick(noCommit)}>{t('cherryPick.cherryPick')}</button>
  </div>
</Modal>

<style>
  .conflict-status {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    margin-right: auto;
    color: var(--text-secondary);
  }

  .conflict-status.is-warning { color: #f0a020; }
  .conflict-status.is-success { color: #4caf50; }
</style>
