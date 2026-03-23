<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { branchStore } from '../../lib/stores/branches.svelte';

  interface Props {
    startPoint: string;
    subject?: string;
    editableStartPoint?: boolean;
    onClose: () => void;
    onCreate: (name: string, startPoint: string, checkout: boolean) => void;
  }

  let { startPoint: initialStartPoint, subject, editableStartPoint = false, onClose, onCreate }: Props = $props();
  let name = $state('');
  // svelte-ignore state_referenced_locally
  let startPoint = $state(initialStartPoint);
  let checkout = $state(true);
  let nameInput: HTMLInputElement | undefined = $state();
  const isStartPointHash = $derived(/^[0-9a-f]{7,40}$/i.test(startPoint));
  const branchExists = $derived(name.trim() !== '' && branchStore.localBranches.some(b => b.name === name.trim()));
  const tagConflict = $derived(name.trim() !== '' && !branchExists && branchStore.tags.some(tag => tag.name === name.trim()));

  onMount(() => { nameInput?.focus(); });

  function handleSubmit() {
    if (name.trim()) {
      onCreate(name.trim(), startPoint.trim() || 'HEAD', checkout);
    }
  }
</script>

<Modal title={t('createBranch.title')} {onClose}>
  <p class="modal-desc">{t('createBranch.desc')}</p>
  <div class="modal-context-card">
    <i class="codicon {isStartPointHash ? 'codicon-git-commit' : 'codicon-git-branch'}"></i>
    <span class="modal-pill modal-pill--source">{isStartPointHash ? startPoint.substring(0, 7) : startPoint}</span>
    <i class="codicon codicon-arrow-right" style="color: var(--text-secondary);"></i>
    <i class="codicon codicon-git-branch"></i>
    <span class="modal-pill modal-pill--target">{name.trim() || '...'}</span>
  </div>
  {#if editableStartPoint}
    <div class="modal-form-group">
      <label class="modal-field-label" for="create-branch-start-point">{t('createBranch.startPoint')}</label>
      <input
        class="modal-input"
        id="create-branch-start-point"
        type="text"
        bind:value={startPoint}
        placeholder="HEAD"
        onkeydown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
      />
    </div>
  {/if}
  <div class="modal-form-group">
    <label class="modal-field-label" for="create-branch-name">{t('createBranch.name')}</label>
    <input
      class="modal-input"
      id="create-branch-name"
      type="text"
      bind:this={nameInput}
      bind:value={name}
      placeholder={t('createBranch.namePlaceholder')}
      onkeydown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
    />
  </div>
  {#if branchExists}
    <p class="modal-warning" role="alert">{t('createBranch.branchExists', { name: name.trim() })}</p>
  {:else if tagConflict}
    <p class="modal-warning" role="alert">{t('createBranch.tagConflict', { name: name.trim() })}</p>
  {/if}
  <div class="modal-form-group">
    <label class="modal-checkbox">
      <input type="checkbox" bind:checked={checkout} />
      <span>{t('createBranch.checkout')}</span>
    </label>
  </div>
  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" onclick={handleSubmit} disabled={!name.trim() || branchExists || tagConflict}>{checkout ? t('createBranch.createAndCheckout') : t('createBranch.create')}</button>
  </div>
</Modal>
