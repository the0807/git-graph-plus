<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import ColorSelect from '../common/ColorSelect.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  interface Props {
    source: string;
    target: string;
    onClose: () => void;
    onMerge: (options: { noFf: boolean; ffOnly: boolean; squash: boolean }) => void;
  }

  let { source, target, onClose, onMerge }: Props = $props();
  let mergeMode = $state<'default' | 'no-ff' | 'ff-only' | 'squash'>('default');
  let mergeBtn: HTMLButtonElement | undefined = $state();

  onMount(() => { mergeBtn?.focus(); });
</script>

<Modal title={t('merge.title')} {onClose}>
  <p class="modal-desc">{t('merge.desc')}</p>
  <div class="modal-context-card">
    <span class="modal-pill modal-pill--source">{source}</span>
    <span class="modal-arrow">&rarr;</span>
    <span class="modal-pill modal-pill--target">{target}</span>
  </div>
  <div class="modal-form-group">
    <label class="modal-field-label">{t('merge.mergeType')}</label>
    <ColorSelect
      options={[
        { value: 'default', label: t('merge.default'), color: '#4caf50' },
        { value: 'no-ff', label: t('merge.noFf'), color: '#2196f3' },
        { value: 'ff-only', label: t('merge.ffOnly'), color: '#ff9800' },
        { value: 'squash', label: t('merge.squash'), color: '#9c27b0', warning: t('merge.squashWarning') },
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
