<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import ColorSelect from '../common/ColorSelect.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { branchStore } from '../../lib/stores/branches.svelte';

  interface Props {
    defaultPath?: string;
    onClose: () => void;
    onAdd: (path: string, branch?: string, newBranch?: string) => void;
  }

  let { defaultPath = '', onClose, onAdd }: Props = $props();

  const localBranches = $derived(branchStore.localBranches.map(b => b.name));
  // svelte-ignore state_referenced_locally
  let startAt = $state(branchStore.currentBranch?.name ?? 'HEAD');
  let branchName = $state('');
  // svelte-ignore state_referenced_locally
  let location = $state(defaultPath);
  let branchInput: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (defaultPath && branchName) {
      location = defaultPath + branchName.replace(/\//g, '-');
    } else if (defaultPath) {
      location = defaultPath;
    }
  });

  onMount(() => { branchInput?.focus(); });

  const canSubmit = $derived(branchName.trim() !== '' && location.trim() !== '');

  function handleSubmit() {
    if (!canSubmit) return;
    onAdd(location.trim(), startAt, branchName.trim());
  }
</script>

<Modal title={t('worktree.addTitle')} {onClose}>
  <div class="modal-form-group">
    <div class="modal-field-row">
      <div class="modal-field-label">{t('worktree.startAt')}</div>
      <ColorSelect
        options={localBranches.map(b => ({ value: b, label: b, color: '' }))}
        value={startAt}
        onChange={(v) => { startAt = v; }}
        showDot={false}
      />
    </div>
  </div>

  <div class="modal-form-group">
    <div class="modal-field-row">
      <label class="modal-field-label" for="wt-branch">{t('worktree.branchName')}</label>
      <input id="wt-branch" class="modal-input" type="text" bind:value={branchName} bind:this={branchInput} placeholder={t('worktree.branchPlaceholder')} onkeydown={(e) => { if (e.key === 'Enter' && canSubmit) handleSubmit(); }} />
    </div>
  </div>

  <div class="modal-form-group">
    <div class="modal-field-row">
      <label class="modal-field-label" for="wt-location">{t('worktree.location')}</label>
      <input id="wt-location" class="modal-input location-input" type="text" bind:value={location} />
    </div>
  </div>

  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" disabled={!canSubmit} onclick={handleSubmit}>{t('worktree.add')}</button>
  </div>
</Modal>

<style>
  .location-input {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    color: var(--text-secondary);
  }
</style>
