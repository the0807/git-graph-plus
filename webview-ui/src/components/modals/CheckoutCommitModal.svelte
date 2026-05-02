<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { t } from '../../lib/i18n/index.svelte';

  type DirtyPayload = { merge?: boolean; stash?: boolean; stashUntracked?: boolean; force?: boolean; clean?: boolean };

  interface Props {
    hash: string;
    linkedBranches?: string[];
    linkedRemoteBranches?: { remote: string; name: string }[];
    onCheckout: (ref: string, dirty: DirtyPayload) => void;
    onClose: () => void;
  }

  let { hash, linkedBranches = [], linkedRemoteBranches = [], onCheckout, onClose }: Props = $props();

  const vscode = getVsCodeApi();
  let dirty = $state(false);
  let dirtyOption = $state<'keep' | 'stash' | 'discard'>('keep');

  onMount(() => {
    const handler = (e: MessageEvent) => {
      if (e.data.type === 'dirtyState') {
        dirty = e.data.payload.dirty;
        window.removeEventListener('message', handler);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'checkDirty' });
    return () => window.removeEventListener('message', handler);
  });

  function buildDirtyPayload(): DirtyPayload {
    if (!dirty) return {};
    if (dirtyOption === 'stash')   return { stash: true, stashUntracked: true };
    if (dirtyOption === 'discard') return { force: true, clean: true };
    return { merge: true };
  }

  function confirm() {
    const payload = buildDirtyPayload();
    if (linkedBranches.length > 0) {
      onCheckout(linkedBranches[0], payload);
    } else if (linkedRemoteBranches.length > 0) {
      const rb = linkedRemoteBranches[0];
      onCheckout(`${rb.remote}/${rb.name}`, payload);
    } else {
      onCheckout(hash, payload);
    }
    onClose();
  }
</script>

<Modal title={t('checkoutCommit.title')} {onClose}>
  <div class="modal-context-card">
    <span class="modal-pill modal-pill--target">
      <i class="codicon codicon-git-commit"></i>
      <span class="modal-pill-text">{hash.substring(0, 7)}</span>
    </span>
  </div>

  {#if linkedBranches.length > 0}
    <div class="modal-context-card">
      {#each linkedBranches as branch}
        <span class="modal-pill modal-pill--source" title={branch}>
          <i class="codicon codicon-git-branch"></i>
          <span class="modal-pill-text">{branch}</span>
        </span>
      {/each}
    </div>
  {:else if linkedRemoteBranches.length > 0}
    <div class="modal-context-card">
      {#each linkedRemoteBranches as rb}
        <span class="modal-pill modal-pill--target" title="{rb.remote}/{rb.name}">
          <i class="codicon codicon-cloud"></i>
          <span class="modal-pill-text">{rb.remote}/{rb.name}</span>
        </span>
      {/each}
    </div>
  {:else}
    <div class="modal-warning">
      <i class="codicon codicon-warning"></i>
      <span>{t('checkoutCommit.detachedWarning')}</span>
    </div>
  {/if}

  {#if dirty}
    <div class="modal-form-group">
      <div class="modal-field-label">{t('checkout.localChanges')}</div>
      <label class="modal-radio">
        <input type="radio" name="co-dirty" value="keep" bind:group={dirtyOption} />
        <span>{t('checkout.keepChanges')}</span>
      </label>
      <label class="modal-radio">
        <input type="radio" name="co-dirty" value="stash" bind:group={dirtyOption} />
        <span>{t('checkout.stash')}</span>
      </label>
      <label class="modal-radio">
        <input type="radio" name="co-dirty" value="discard" bind:group={dirtyOption} />
        <span>{t('checkout.discardAll')}</span>
      </label>
    </div>
    {#if dirtyOption === 'discard'}
      <p class="modal-warning" role="alert">
        <i class="codicon codicon-warning"></i>
        <span>{@html t('checkout.discardWarning')}</span>
      </p>
    {/if}
  {/if}

  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    {#if linkedBranches.length > 0}
      <button class="primary" onclick={confirm}>{t('checkoutCommit.checkoutBranch', { name: linkedBranches[0] })}</button>
    {:else if linkedRemoteBranches.length > 0}
      <button class="primary" onclick={confirm}>{t('checkoutCommit.checkoutRemote', { name: linkedRemoteBranches[0].name })}</button>
    {:else}
      <button class="primary" onclick={confirm}>{t('checkoutCommit.checkout')}</button>
    {/if}
  </div>
</Modal>
