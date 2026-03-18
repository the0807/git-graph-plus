<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  interface Props {
    remoteName: string;
    defaultLocalName: string;
    onClose: () => void;
    onCheckout: (localName: string) => void;
  }

  let { remoteName, defaultLocalName, onClose, onCheckout }: Props = $props();
  let localName = $state(defaultLocalName);
  let nameInput: HTMLInputElement | undefined = $state();

  onMount(() => { nameInput?.focus(); });

  function handleSubmit() {
    if (localName.trim()) {
      onCheckout(localName.trim());
    }
  }
</script>

<Modal title={t('checkoutRemote.title')} {onClose}>
  <p class="modal-desc">{t('checkoutRemote.desc', { remote: remoteName })}</p>
  <div class="modal-context-card">
    <i class="codicon codicon-cloud" style="color: var(--text-secondary);"></i>
    <span>{remoteName}</span>
  </div>
  <div class="modal-form-group">
    <label class="modal-field-label">{t('checkoutRemote.localName')}</label>
    <input
      class="modal-input"
      type="text"
      bind:this={nameInput}
      bind:value={localName}
      onkeydown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
    />
  </div>
  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" onclick={handleSubmit} disabled={!localName.trim()}>{t('checkoutRemote.checkout')}</button>
  </div>
</Modal>
