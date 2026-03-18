<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  interface Props {
    branchName: string;
    onClose: () => void;
    onDelete: (force: boolean) => void;
  }

  let { branchName, onClose, onDelete }: Props = $props();
  let force = $state(false);
  let deleteBtn: HTMLButtonElement | undefined = $state();

  onMount(() => { deleteBtn?.focus(); });
</script>

<Modal title={t('deleteBranch.title')} {onClose}>
  <p class="modal-desc">{t('deleteBranch.confirm', { name: branchName })}</p>
  <div class="modal-context-card">
    <span class="modal-pill modal-pill--danger">{branchName}</span>
  </div>
  <div class="modal-form-group">
    <label class="modal-checkbox">
      <input type="checkbox" bind:checked={force} style="accent-color: #f44336;" />
      <span>{t('deleteBranch.force')}</span>
    </label>
  </div>
  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="danger-btn" bind:this={deleteBtn} onclick={() => onDelete(force)}>{t('sidebar.delete')}</button>
  </div>
</Modal>
