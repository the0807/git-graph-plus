<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import type { UserDetails } from '../../lib/types';

  interface Props {
    userDetails: UserDetails | null;
    onClose: () => void;
    onSave: (name: string, email: string, useGlobally: boolean) => void;
    onRemove: () => void;
  }

  let { userDetails, onClose, onSave, onRemove }: Props = $props();

  let name = $state('');
  let email = $state('');
  let useGlobally = $state(true);
  let initialized = $state(false);
  let nameInput: HTMLInputElement | undefined = $state();

  onMount(() => { nameInput?.focus(); });

  // Populate the form exactly once the async fetch resolves; keep the fields
  // writable afterwards so the user can edit without being clobbered.
  $effect(() => {
    if (!initialized && userDetails) {
      name = userDetails.name.local ?? userDetails.name.global ?? '';
      email = userDetails.email.local ?? userDetails.email.global ?? '';
      // Default to "global" when there is no local override, matching the
      // effective scope the values currently resolve from.
      useGlobally = userDetails.name.local === null && userDetails.email.local === null;
      initialized = true;
    }
  });

  const hasAny = $derived(userDetails !== null && (
    userDetails.name.local !== null || userDetails.name.global !== null ||
    userDetails.email.local !== null || userDetails.email.global !== null
  ));

  const scopeLabel = $derived(
    userDetails === null
      ? null
      : (userDetails.name.local !== null || userDetails.email.local !== null)
        ? t('userDetails.local')
        : (userDetails.name.global !== null || userDetails.email.global !== null)
          ? t('userDetails.global')
          : null
  );

  function submit() {
    if (name.trim() && email.trim()) {
      onSave(name.trim(), email.trim(), useGlobally);
    }
  }
</script>

<Modal title={t('userDetails.title')} {onClose}>
  <p class="modal-desc">{t('userDetails.desc')}</p>

  {#if !userDetails}
    <p class="loading">{t('userDetails.loading')}</p>
  {:else}
    {#if scopeLabel}
      <p class="scope-hint">
        <i class="codicon codicon-info"></i>
        {t('userDetails.currentScope')}: {scopeLabel}
      </p>
    {/if}

    <div class="modal-form-group">
      <label class="modal-field-label" for="user-details-name">{t('userDetails.name')}</label>
      <input
        class="modal-input"
        id="user-details-name"
        type="text"
        bind:this={nameInput}
        bind:value={name}
        placeholder="Jane Doe"
      />
    </div>
    <div class="modal-form-group">
      <label class="modal-field-label" for="user-details-email">{t('userDetails.email')}</label>
      <input
        class="modal-input"
        id="user-details-email"
        type="text"
        bind:value={email}
        placeholder="jane@example.com"
        onkeydown={(e) => { if (e.key === 'Enter') submit(); }}
      />
    </div>

    <div class="modal-form-group">
      <label class="modal-checkbox">
        <input type="checkbox" bind:checked={useGlobally} />
        <span>{t('userDetails.useGlobally')}</span>
      </label>
      <p class="checkbox-info">{t('userDetails.useGloballyInfo')}</p>
    </div>

    <div class="form-actions">
      {#if hasAny}
        <button class="danger-btn" onclick={onRemove}>{t('userDetails.remove')}</button>
      {/if}
      <div class="spacer"></div>
      <button onclick={onClose}>{t('common.cancel')}</button>
      <button class="primary" onclick={submit} disabled={!name.trim() || !email.trim()}>{t('userDetails.save')}</button>
    </div>
  {/if}
</Modal>

<style>
  .loading {
    color: var(--text-secondary);
    margin: 0;
  }

  .scope-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    margin: 0 0 14px;
    font-size: inherit;
  }

  .scope-hint .codicon {
    font-size: 13px;
  }

  .checkbox-info {
    margin: 6px 0 0 20px;
    color: var(--text-secondary);
    font-size: 11px;
    line-height: 1.5;
  }

  .spacer {
    flex: 1;
  }
</style>
