<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { branchStore } from '../../lib/stores/branches.svelte';

  interface Props {
    branchName: string;
    onClose: () => void;
    onDelete: (force: boolean, deleteWorktree?: string, deleteRemote?: boolean) => void;
  }

  let { branchName, onClose, onDelete }: Props = $props();
  let force = $state(false);
  let deleteRemote = $state(false);
  let deleteBtn: HTMLButtonElement | undefined = $state();

  const linkedWorktree = $derived(branchStore.worktrees.find(w => !w.isMain && w.branch === branchName));
  const hasRemote = $derived((() => {
    const localInfo = branchStore.branches.find(b => !b.remote && b.name === branchName);
    if (localInfo?.upstream) return true;
    return branchStore.branches.some(b => b.remote && b.name.endsWith('/' + branchName));
  })());

  onMount(() => { deleteBtn?.focus(); });
</script>

<Modal title={t('deleteBranch.title')} {onClose}>
  <p class="modal-desc">{@html t('deleteBranch.confirm', { name: `<span class="modal-pill modal-pill--danger">${branchName}</span>` })}</p>
  <div class="modal-form-group">
    <label class="modal-checkbox modal-checkbox--danger">
      <input type="checkbox" bind:checked={force} />
      <span>{t('deleteBranch.force')}</span>
    </label>
    {#if hasRemote}
      <label class="modal-checkbox modal-checkbox--danger" style="margin-top: 6px;">
        <input type="checkbox" bind:checked={deleteRemote} />
        <span>{t('deleteBranch.deleteRemote')}</span>
      </label>
    {/if}
  </div>
  {#if linkedWorktree}
    <div class="modal-warning">
      <i class="codicon codicon-warning"></i>
      <span>{t('deleteBranch.worktreeWarning', { name: linkedWorktree.branch || branchName })}</span>
    </div>
  {/if}
  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="danger-btn" bind:this={deleteBtn} onclick={() => onDelete(force, linkedWorktree?.path, deleteRemote)}>{t('sidebar.delete')}</button>
  </div>
</Modal>
