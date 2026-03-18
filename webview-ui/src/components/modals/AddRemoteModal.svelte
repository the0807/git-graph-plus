<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  interface Props {
    onClose: () => void;
    onAdd: (name: string, url: string) => void;
  }

  let { onClose, onAdd }: Props = $props();
  let name = $state('');
  let url = $state('');
  let nameInput: HTMLInputElement | undefined = $state();

  onMount(() => { nameInput?.focus(); });

  function handleSubmit() {
    if (name.trim() && url.trim()) {
      onAdd(name.trim(), url.trim());
    }
  }
</script>

<Modal title={t('addRemote.title')} {onClose}>
  <div class="modal-form-group">
    <label class="modal-field-label" for="add-remote-name">{t('addRemote.name')}</label>
    <input
      class="modal-input"
      id="add-remote-name"
      type="text"
      bind:this={nameInput}
      bind:value={name}
      placeholder="upstream"
    />
  </div>
  <div class="modal-form-group">
    <label class="modal-field-label" for="add-remote-url">{t('addRemote.url')}</label>
    <input
      class="modal-input"
      id="add-remote-url"
      type="text"
      bind:value={url}
      placeholder="https://github.com/..."
      onkeydown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
    />
  </div>
  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" onclick={handleSubmit} disabled={!name.trim() || !url.trim()}>{t('addRemote.add')}</button>
  </div>
</Modal>
