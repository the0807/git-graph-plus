<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  interface Props {
    tagName: string;
    hasRemote?: boolean;
    onClose: () => void;
    onDelete: (deleteRemote: boolean) => void;
  }

  let { tagName, hasRemote = false, onClose, onDelete }: Props = $props();
  let deleteRemote = $state(false);
  let deleteBtn: HTMLButtonElement | undefined = $state();

  onMount(() => { deleteBtn?.focus(); });
</script>

<Modal title={t('deleteTag.title')} {onClose}>
  <p class="modal-desc">{@html t('deleteTag.confirm', { name: tagName })}</p>
  {#if hasRemote}
    <div class="modal-form-group">
      <label class="modal-checkbox modal-checkbox--danger">
        <input type="checkbox" bind:checked={deleteRemote} />
        <span>{t('deleteTag.deleteRemote')}</span>
      </label>
    </div>
  {/if}
  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="danger-btn" bind:this={deleteBtn} onclick={() => onDelete(deleteRemote)}>{t('sidebar.delete')}</button>
  </div>
</Modal>
