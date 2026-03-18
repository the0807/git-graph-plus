<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  interface Props {
    tagName: string;
    onClose: () => void;
    onDelete: () => void;
  }

  let { tagName, onClose, onDelete }: Props = $props();
  let deleteBtn: HTMLButtonElement | undefined = $state();

  onMount(() => { deleteBtn?.focus(); });
</script>

<Modal title={t('deleteTag.title')} {onClose}>
  <p class="modal-desc">{t('deleteTag.confirm', { name: tagName })}</p>
  <div class="modal-context-card">
    <span class="modal-pill modal-pill--tag">{tagName}</span>
  </div>
  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="danger-btn" bind:this={deleteBtn} onclick={onDelete}>{t('sidebar.delete')}</button>
  </div>
</Modal>
