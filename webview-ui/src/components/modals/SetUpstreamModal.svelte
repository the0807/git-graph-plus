<script lang="ts">
  import Modal from '../common/Modal.svelte';
  import ColorSelect from '../common/ColorSelect.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { branchStore } from '../../lib/stores/branches.svelte';

  interface Props {
    branchName: string;
    currentUpstream?: string;
    onClose: () => void;
    onSet: (remote: string, remoteBranch: string, createRemote: boolean) => void;
  }

  let { branchName, currentUpstream = '', onClose, onSet }: Props = $props();

  const remoteNames = $derived([...new Set(branchStore.remotes.map(r => r.name))]);

  function parseUpstream(upstream: string) {
    const slashIdx = upstream.indexOf('/');
    if (slashIdx === -1) return { remote: '', branch: upstream };
    return { remote: upstream.slice(0, slashIdx), branch: upstream.slice(slashIdx + 1) };
  }

  // svelte-ignore state_referenced_locally
  const parsed = parseUpstream(currentUpstream);
  // svelte-ignore state_referenced_locally
  let selectedRemote = $state(parsed.remote || remoteNames[0] || 'origin');

  const remoteBranchesForRemote = $derived(
    branchStore.remoteBranches
      .filter(b => b.name.startsWith(selectedRemote + '/'))
      .map(b => b.name.substring(selectedRemote.length + 1))
  );

  const remoteOptions = $derived(remoteNames.map(r => ({ value: r, label: r, color: '' })));
  const branchOptions = $derived(
    remoteBranchesForRemote.map(b => ({ value: b, label: `${selectedRemote}/${b}`, color: '' }))
  );

  const hasBranchOptions = $derived(remoteBranchesForRemote.length > 0);

  // svelte-ignore state_referenced_locally
  let dropdownBranch = $state(parsed.branch || branchName);
  // svelte-ignore state_referenced_locally
  let textBranch = $state(currentUpstream ? '' : branchName);
  // upstream이 없으면 새로 만드는 케이스 → 텍스트 입력으로 시작
  // svelte-ignore state_referenced_locally
  let manualInput = $state(!currentUpstream);

  const useDropdown = $derived(hasBranchOptions && !manualInput);
  const activeBranch = $derived(manualInput ? textBranch : dropdownBranch);

  const remoteBranchExists = $derived(
    useDropdown || remoteBranchesForRemote.includes(activeBranch.trim())
  );

  function handleSubmit() {
    if (selectedRemote && activeBranch.trim()) {
      onSet(selectedRemote, activeBranch.trim(), !remoteBranchExists);
    }
  }
</script>

<Modal title={t('setUpstream.title')} {onClose}>
  <p class="modal-desc">{t('setUpstream.desc', { branch: branchName })}</p>
  <div class="modal-context-card">
    <span class="modal-pill modal-pill--target"><i class="codicon codicon-git-branch"></i>{branchName}</span>
    <i class="codicon codicon-arrow-both" style="color: var(--text-secondary);"></i>
    <span class="modal-pill modal-pill--source"><i class="codicon codicon-cloud"></i>{selectedRemote}/{activeBranch || branchName}</span>
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
    <div class="modal-field-label-row">
      <span class="modal-field-label">{t('setUpstream.remoteBranch')}</span>
      {#if hasBranchOptions}
        <button class="toggle-btn" onclick={() => { manualInput = !manualInput; }}>
          <i class="codicon {manualInput ? 'codicon-list-unordered' : 'codicon-edit'}"></i>
          <span>{manualInput ? t('setUpstream.selectFromList') : t('setUpstream.typeManually')}</span>
        </button>
      {/if}
    </div>
    {#if useDropdown}
      <ColorSelect
        options={branchOptions}
        value={dropdownBranch}
        onChange={(v) => { dropdownBranch = v; }}
        showDot={false}
      />
    {:else}
      <input
        class="modal-input"
        type="text"
        bind:value={textBranch}
      />
    {/if}
  </div>

  {#if activeBranch.trim() && !remoteBranchExists}
    <p class="notice">
      <i class="codicon codicon-info"></i>
      {t('setUpstream.willCreate.pre')}<code class="cmd">git push -u</code>{t('setUpstream.willCreate.post')}
    </p>
  {/if}

  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" onclick={handleSubmit} disabled={!activeBranch.trim()}>{t('setUpstream.set')}</button>
  </div>
</Modal>

<style>
  .modal-field-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .modal-field-label-row .modal-field-label {
    margin-bottom: 0;
  }

  .toggle-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    background: none;
    border: none;
    padding: 0;
    font-size: 11px;
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
  }

  .toggle-btn:hover {
    color: var(--text-primary);
  }

  .toggle-btn:hover span {
    text-decoration: underline;
  }

  .toggle-btn .codicon {
    font-size: 11px;
  }

  .notice {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
    margin: 0;
  }

  .cmd {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15));
    border-radius: 3px;
    padding: 1px 4px;
  }
</style>
