<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  interface Props {
    branch: string;
    onto: string;
    onClose: () => void;
    onRebase: (options: { autostash: boolean }) => void;
  }

  let { branch, onto, onClose, onRebase }: Props = $props();
  let autostash = $state(false);
  let rebaseBtn: HTMLButtonElement | undefined = $state();

  onMount(() => { rebaseBtn?.focus(); });
</script>

<Modal title={t('rebaseBranch.title')} {onClose}>
  <p class="modal-desc">{t('rebaseBranch.desc')}</p>
  <div class="modal-context-card">
    <span class="modal-pill modal-pill--target">{branch}</span>
    <span class="modal-arrow">&rarr;</span>
    <span class="modal-pill modal-pill--source">{onto}</span>
  </div>
  <div class="modal-form-group">
    <label class="modal-checkbox">
      <input type="checkbox" bind:checked={autostash} />
      <span>{t('rebase.autostash')}</span>
    </label>
  </div>
  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" bind:this={rebaseBtn} onclick={() => onRebase({ autostash })}>{t('rebaseBranch.rebase')}</button>
  </div>
</Modal>
