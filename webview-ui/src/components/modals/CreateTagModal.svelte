<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  interface Props {
    startPoint: string;
    subject?: string;
    editableStartPoint?: boolean;
    onClose: () => void;
    onCreate: (name: string, message: string, startPoint: string, push: boolean) => void;
  }

  let { startPoint: initialStartPoint, subject, editableStartPoint = false, onClose, onCreate }: Props = $props();
  let name = $state('');
  let message = $state('');
  // svelte-ignore state_referenced_locally
  let startPoint = $state(initialStartPoint);
  let push = $state(true);
  let nameInput: HTMLInputElement | undefined = $state();

  onMount(() => { nameInput?.focus(); });

  function handleSubmit() {
    if (name.trim()) {
      onCreate(name.trim(), message.trim(), startPoint.trim() || 'HEAD', push);
    }
  }
</script>

<Modal title={t('createTag.title')} {onClose}>
  <p class="modal-desc">{t('createTag.desc')}</p>
  {#if subject}
    <div class="modal-context-card">
      <i class="codicon codicon-git-commit"></i>
      <span class="modal-pill modal-pill--target">{startPoint.substring(0, 7)}</span>
      <span class="truncate" style="color: var(--text-secondary); font-size: 11px;">{subject}</span>
    </div>
  {/if}
  {#if editableStartPoint}
    <div class="modal-form-group">
      <label class="modal-field-label" for="create-tag-target">{t('createTag.target')}</label>
      <input
        class="modal-input"
        id="create-tag-target"
        type="text"
        bind:value={startPoint}
        placeholder="HEAD"
      />
    </div>
  {/if}
  <div class="modal-form-group">
    <label class="modal-field-label" for="create-tag-name">{t('createTag.name')}</label>
    <input
      class="modal-input"
      id="create-tag-name"
      type="text"
      bind:this={nameInput}
      bind:value={name}
      placeholder={t('createTag.namePlaceholder')}
      onkeydown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
    />
  </div>
  <div class="modal-form-group">
    <label class="modal-field-label" for="create-tag-message">{t('createTag.message')}</label>
    <textarea
      class="modal-textarea"
      id="create-tag-message"
      bind:value={message}
      placeholder={t('createTag.messagePlaceholder')}
      rows="4"
    ></textarea>
  </div>
  <div class="modal-form-group">
    <label class="modal-checkbox">
      <input type="checkbox" bind:checked={push} />
      <span>{t('createTag.pushToRemotes')}</span>
    </label>
  </div>
  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" onclick={handleSubmit} disabled={!name.trim()}>{push ? t('createTag.createAndPush') : t('createTag.create')}</button>
  </div>
</Modal>
