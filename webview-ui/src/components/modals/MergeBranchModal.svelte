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
  let showAllConflictFiles = $state(false);
  const MAX_VISIBLE_FILES = 3;

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
  {#if conflictPrediction?.hasConflict}
    <div class="modal-warning">
      <i class="codicon codicon-warning"></i>
      <div>
        <span>{@html t('merge.conflictWarning', { count: String(conflictPrediction.files.length) })}</span>
        {#if conflictPrediction.files.length > 0}
          <ul class="conflict-file-list">
            {#each (showAllConflictFiles ? conflictPrediction.files : conflictPrediction.files.slice(0, MAX_VISIBLE_FILES)) as file}
              <li>{file}</li>
            {/each}
          </ul>
          {#if conflictPrediction.files.length > MAX_VISIBLE_FILES}
            {#if showAllConflictFiles}
              <button class="show-more-btn" onclick={() => { showAllConflictFiles = false; }}>{t('merge.collapse')}</button>
            {:else}
              <button class="show-more-btn" onclick={() => { showAllConflictFiles = true; }}>+{conflictPrediction.files.length - MAX_VISIBLE_FILES} {t('merge.moreFiles')}</button>
            {/if}
          {/if}
        {/if}
      </div>
    </div>
  {:else if conflictPrediction && !conflictPrediction.hasConflict}
    <div class="modal-success">
      <i class="codicon codicon-check"></i>
      <span>{t('merge.noConflict')}</span>
    </div>
  {/if}
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
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" bind:this={mergeBtn} onclick={() => onMerge({ noFf: mergeMode === 'no-ff', ffOnly: mergeMode === 'ff-only', squash: mergeMode === 'squash' })}>{t('merge.merge')}</button>
  </div>
</Modal>

<style>
  .conflict-file-list {
    margin: 4px 0 0;
    padding-left: 16px;
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace);
    opacity: 0.9;
  }

  .conflict-file-list li {
    padding: 1px 0;
  }

  .show-more-btn {
    background: none;
    border: none;
    color: var(--text-secondary, #888);
    font-size: 11px;
    cursor: pointer;
    padding: 2px 0;
    margin-top: 2px;
  }

  .show-more-btn:hover {
    text-decoration: underline;
    background: none;
  }

  .modal-success {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: rgba(76, 175, 80, 0.08);
    border: 1px solid rgba(76, 175, 80, 0.25);
    border-radius: 5px;
    color: #4caf50;
    font-size: 11px;
    margin: 0 0 6px;
  }
</style>
