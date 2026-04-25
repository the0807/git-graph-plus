<script lang="ts">
  import Modal from '../common/Modal.svelte';
  import ColorSelect from '../common/ColorSelect.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { branchStore } from '../../lib/stores/branches.svelte';

  interface Props {
    branchName: string;
    onClose: () => void;
    onSet: (remote: string, remoteBranch: string) => void;
  }

  let { branchName, onClose, onSet }: Props = $props();

  const remoteNames = $derived([...new Set(branchStore.remotes.map(r => r.name))]);
  // svelte-ignore state_referenced_locally
  let selectedRemote = $state(remoteNames[0] ?? 'origin');

  const remoteBranchesForRemote = $derived(
    branchStore.remoteBranches
      .filter(b => b.name.startsWith(selectedRemote + '/'))
      .map(b => b.name.substring(selectedRemote.length + 1))
  );

  // svelte-ignore state_referenced_locally
  let selectedRemoteBranch = $state(branchName);

  const remoteOptions = $derived(remoteNames.map(r => ({ value: r, label: r, color: '' })));
  const branchOptions = $derived(remoteBranchesForRemote.map(b => ({ value: b, label: `${selectedRemote}/${b}`, color: '' })));

  function handleSubmit() {
    if (selectedRemote && selectedRemoteBranch.trim()) {
      onSet(selectedRemote, selectedRemoteBranch.trim());
    }
  }
</script>

<Modal title={t('setUpstream.title')} {onClose}>
  <p class="modal-desc">{t('setUpstream.desc', { branch: branchName })}</p>
  <div class="modal-context-card">
    <span class="modal-pill modal-pill--target"><i class="codicon codicon-git-branch"></i>{branchName}</span>
    <i class="codicon codicon-arrow-both" style="color: var(--text-secondary);"></i>
    <span class="modal-pill modal-pill--source"><i class="codicon codicon-cloud"></i>{selectedRemote}/{selectedRemoteBranch || branchName}</span>
  </div>

  {#if remoteNames.length > 1}
    <div class="modal-form-group">
      <div class="modal-field-label">{t('setUpstream.remote')}</div>
      <ColorSelect
        options={remoteOptions}
        value={selectedRemote}
        onChange={(v) => { selectedRemote = v; }}
        showDot={false}
      />
    </div>
  {/if}

  <div class="modal-form-group">
    <div class="modal-field-label">{t('setUpstream.remoteBranch')}</div>
    <ColorSelect
      options={branchOptions}
      value={selectedRemoteBranch}
      onChange={(v) => { selectedRemoteBranch = v; }}
      showDot={false}
    />
  </div>

  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" onclick={handleSubmit} disabled={!selectedRemoteBranch.trim()}>{t('setUpstream.set')}</button>
  </div>
</Modal>

