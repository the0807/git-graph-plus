<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';

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

  onMount(() => { nameInput?.focus(); });

  function handleSubmit() {
    if (name.trim()) {
      onCreate(name.trim(), startPoint.trim() || 'HEAD', checkout);
    }
  }
</script>

<Modal title={t('createBranch.title')} {onClose}>
  <p class="modal-desc">{t('createBranch.desc')}</p>
  {#if subject}
    <div class="modal-context-card">
      <i class="codicon codicon-git-commit"></i>
      <span class="modal-pill modal-pill--target">{startPoint.substring(0, 7)}</span>
      <span class="truncate" style="color: var(--text-secondary); font-size: 11px;">{subject}</span>
    </div>
  {/if}
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
  <div class="modal-form-group">
    <label class="modal-checkbox">
      <input type="checkbox" bind:checked={checkout} />
      <span>{t('createBranch.checkout')}</span>
    </label>
  </div>
  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" onclick={handleSubmit} disabled={!name.trim()}>{checkout ? t('createBranch.createAndCheckout') : t('createBranch.create')}</button>
  </div>
</Modal>
