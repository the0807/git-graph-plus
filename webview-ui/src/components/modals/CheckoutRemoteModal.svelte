<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  interface Props {
    remoteName: string;
    defaultLocalName: string;
    dirty: boolean;
    onClose: () => void;
    onCheckout: (localName: string, dirtyOption: 'keep' | 'stash' | 'stashAll' | 'discard') => void;
  }

  let { remoteName, defaultLocalName, dirty, onClose, onCheckout }: Props = $props();
  // svelte-ignore state_referenced_locally
  let localName = $state(defaultLocalName);
  let dirtyOption = $state<'keep' | 'stash' | 'stashAll' | 'discard'>('keep');
  let nameInput: HTMLInputElement | undefined = $state();

  onMount(() => { nameInput?.focus(); });

  function handleSubmit() {
    if (localName.trim()) {
      onCheckout(localName.trim(), dirtyOption);
    }
  }
</script>

<Modal title={t('checkoutRemote.title')} {onClose}>
  <p class="modal-desc">{t('checkoutRemote.desc', { remote: remoteName })}</p>
  <div class="modal-context-card">
    <i class="codicon codicon-cloud" style="color: var(--text-secondary);"></i>
    <span class="modal-pill modal-pill--target">{remoteName}</span>
  </div>
  <div class="modal-form-group">
    <label class="modal-field-label" for="checkout-local-name">{t('checkoutRemote.localName')}</label>
    <input
      class="modal-input"
      id="checkout-local-name"
      type="text"
      bind:this={nameInput}
      bind:value={localName}
      onkeydown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
    />
  </div>
  {#if dirty}
    <div class="modal-form-group">
      <div class="modal-field-label">{t('checkout.localChanges')}</div>
      <label class="modal-radio">
        <input type="radio" name="remote-dirty-option" value="keep" bind:group={dirtyOption} />
        <span>{t('checkout.keepChanges')}</span>
      </label>
      <label class="modal-radio">
        <input type="radio" name="remote-dirty-option" value="stash" bind:group={dirtyOption} />
        <span>{t('checkout.stashTracked')}</span>
      </label>
      <label class="modal-radio">
        <input type="radio" name="remote-dirty-option" value="stashAll" bind:group={dirtyOption} />
        <span>{t('checkout.stashAll')}</span>
      </label>
      <label class="modal-radio">
        <input type="radio" name="remote-dirty-option" value="discard" bind:group={dirtyOption} />
        <span>{t('checkout.discardAll')}</span>
      </label>
    </div>
    {#if dirtyOption === 'discard'}
      <p class="modal-warning" role="alert">{@html t('checkout.discardWarning')}</p>
    {/if}
  {/if}
  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" onclick={handleSubmit} disabled={!localName.trim()}>{t('checkoutRemote.checkout')}</button>
  </div>
</Modal>
