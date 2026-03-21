<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  interface Props {
    flowType: string;
    prefix: string;
    baseBranch: string;
    onClose: () => void;
    onStart: (name: string) => void;
  }

  let { flowType, prefix, baseBranch, onClose, onStart }: Props = $props();
  let name = $state('');
  let nameInput: HTMLInputElement | undefined = $state();

  onMount(() => { nameInput?.focus(); });

  const titleKey = $derived(`flow.start.${flowType}.title`);
  const descKey = $derived(`flow.start.${flowType}.desc`);

  function handleSubmit() {
    if (name.trim()) {
      onStart(name.trim());
    }
  }
</script>

<Modal title={t(titleKey)} {onClose}>
  <p class="modal-desc">{t(descKey, { developBranch: baseBranch, productionBranch: baseBranch })}</p>

  <div class="modal-context-card">
    <i class="codicon codicon-git-branch"></i>
    <span class="modal-pill modal-pill--source">{baseBranch}</span>
    <span class="modal-arrow">&rarr;</span>
    <i class="codicon codicon-git-branch"></i>
    <span class="modal-pill modal-pill--target">{prefix}{name || '...'}</span>
  </div>

  <div class="modal-form-group">
    <label class="modal-field-label" for="flow-name">{t('flow.start.name')}</label>
    <div class="flow-name-input">
      <span class="flow-prefix">{prefix}</span>
      <input
        id="flow-name"
        class="flow-name"
        bind:this={nameInput}
        bind:value={name}
        onkeydown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
        placeholder="name"
      />
    </div>
  </div>

  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" onclick={handleSubmit} disabled={!name.trim()}>
      {t('flow.start.submit', { type: flowType.charAt(0).toUpperCase() + flowType.slice(1) })}
    </button>
  </div>
</Modal>

<style>
  .flow-name-input {
    display: flex;
    align-items: center;
    background: var(--input-bg);
    border: 1px solid var(--input-border, var(--border-color));
    border-radius: 5px;
  }

  .flow-name-input:focus-within {
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .flow-prefix {
    padding: 6px 0 6px 10px;
    font-size: 13px;
    color: var(--text-secondary);
    white-space: nowrap;
    user-select: none;
  }

  .flow-name {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    padding: 6px 10px 6px 2px;
    font-size: 13px;
    color: var(--text-primary);
  }

</style>
