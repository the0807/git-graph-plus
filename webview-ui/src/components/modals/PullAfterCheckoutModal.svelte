<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  interface Props {
    branchName: string;
    behind: number;
    onClose: () => void;
    onCheckoutOnly: () => void;
    onCheckoutAndPull: () => void;
  }

  let { branchName, behind, onClose, onCheckoutOnly, onCheckoutAndPull }: Props = $props();
  let pullBtn: HTMLButtonElement | undefined = $state();

  onMount(() => { pullBtn?.focus(); });
</script>

<Modal title={t('checkoutBranch.title')} {onClose}>
  <p class="modal-desc">{t('checkoutBranch.desc', { count: behind })}</p>
  <div class="modal-context-card">
    <i class="codicon codicon-git-branch"></i>
    <span class="modal-pill modal-pill--target">{branchName}</span>
    <span style="font-size: 11px; color: var(--text-secondary);"><i class="codicon codicon-arrow-down"></i> {t('checkoutBranch.behind', { count: behind })}</span>
  </div>
  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button onclick={onCheckoutOnly}>{t('checkoutBranch.checkoutOnly')}</button>
    <button class="primary" bind:this={pullBtn} onclick={onCheckoutAndPull}>{t('checkoutBranch.checkoutAndPull')}</button>
  </div>
</Modal>
