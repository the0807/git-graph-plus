<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import ColorSelect from '../common/ColorSelect.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';

  interface Props {
    source: string;
    target: string;
    onClose: () => void;
    onMerge: (options: { noFf: boolean; ffOnly: boolean; squash: boolean }) => void;
  }

  let { source, target, onClose, onMerge }: Props = $props();
  let mergeMode = $state<'default' | 'no-ff' | 'ff-only' | 'squash'>('default');
  const isHash = (ref: string) => /^[0-9a-f]{7,40}$/i.test(ref);
  const shortRef = (ref: string) => /^[0-9a-f]{40}$/i.test(ref) ? ref.substring(0, 7) : ref;
  let mergeBtn: HTMLButtonElement | undefined = $state();

  let conflictPrediction = $state<{ hasConflict: boolean; files: string[] } | null>(null);

  onMount(() => {
    mergeBtn?.focus();
    const vscode = getVsCodeApi();
    vscode.postMessage({ type: 'predictConflicts', payload: { ours: target, theirs: source } });
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

<Modal title={t('merge.title')} {onClose}>
  <p class="modal-desc">{t('merge.desc')}</p>
  <div class="modal-context-card">
    <span class="modal-pill modal-pill--source"><i class="codicon {isHash(source) ? 'codicon-git-commit' : 'codicon-git-branch'}"></i>{shortRef(source)}</span>
    <i class="codicon codicon-arrow-right" style="color: var(--text-secondary);"></i>
    <span class="modal-pill modal-pill--target"><i class="codicon {isHash(target) ? 'codicon-git-commit' : 'codicon-git-branch'}"></i>{shortRef(target)}</span>
  </div>
  <div class="modal-form-group">
    <span class="modal-field-label">{t('merge.mergeType')}</span>
    <ColorSelect
      options={[
        { value: 'default', label: t('merge.default'), color: '#4caf50' },
        { value: 'no-ff', label: t('merge.noFf'), color: '#2196f3', flag: '--no-ff' },
        { value: 'ff-only', label: t('merge.ffOnly'), color: '#ff9800', flag: '--ff-only' },
        { value: 'squash', label: t('merge.squash'), color: '#9c27b0', warning: t('merge.squashWarning'), flag: '--squash' },
      ]}
      value={mergeMode}
      onChange={(v) => { mergeMode = v as typeof mergeMode; }}
    />
  </div>
  <div class="form-actions">
    <div class="conflict-status" class:is-warning={conflictPrediction?.hasConflict} class:is-success={conflictPrediction !== null && !conflictPrediction?.hasConflict}>
      {#if conflictPrediction === null}
        <span class="spinner"></span>
        <span>{t('merge.checkingConflicts')}</span>
      {:else if conflictPrediction.hasConflict}
        <i class="codicon codicon-warning"></i>
        <span>{@html t('merge.conflictWarning', { count: String(conflictPrediction.files.length) })}</span>
      {:else}
        <i class="codicon codicon-check"></i>
        <span>{t('merge.noConflict')}</span>
      {/if}
    </div>
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" bind:this={mergeBtn} onclick={() => onMerge({ noFf: mergeMode === 'no-ff', ffOnly: mergeMode === 'ff-only', squash: mergeMode === 'squash' })}>{t('merge.merge')}</button>
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
