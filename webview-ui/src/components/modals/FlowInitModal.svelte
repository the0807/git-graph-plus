<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  interface Props {
    onClose: () => void;
    onInit: (options: {
      productionBranch: string;
      developBranch: string;
      featurePrefix: string;
      releasePrefix: string;
      hotfixPrefix: string;
      versionTagPrefix: string;
    }) => void;
  }

  let { onClose, onInit }: Props = $props();

  let productionBranch = $state('main');
  let developBranch = $state('develop');
  let featurePrefix = $state('feature/');
  let releasePrefix = $state('release/');
  let hotfixPrefix = $state('hotfix/');
  let versionTagPrefix = $state('');
  let firstInput: HTMLInputElement | undefined = $state();

  onMount(() => { firstInput?.focus(); });

  function handleSubmit() {
    onInit({ productionBranch, developBranch, featurePrefix, releasePrefix, hotfixPrefix, versionTagPrefix });
  }
</script>

<Modal title={t('flow.init.title')} {onClose}>
  <p class="modal-desc">{t('flow.init.desc')}</p>

  <div class="modal-form-group">
    <label class="modal-field-label">{t('flow.init.productionBranch')}</label>
    <input class="modal-input" bind:this={firstInput} bind:value={productionBranch} />
  </div>
  <div class="modal-form-group">
    <label class="modal-field-label">{t('flow.init.developBranch')}</label>
    <input class="modal-input" bind:value={developBranch} />
  </div>

  <div class="flow-separator"></div>

  <div class="modal-form-group">
    <label class="modal-field-label">{t('flow.init.featurePrefix')}</label>
    <input class="modal-input" bind:value={featurePrefix} />
  </div>
  <div class="modal-form-group">
    <label class="modal-field-label">{t('flow.init.releasePrefix')}</label>
    <input class="modal-input" bind:value={releasePrefix} />
  </div>
  <div class="modal-form-group">
    <label class="modal-field-label">{t('flow.init.hotfixPrefix')}</label>
    <input class="modal-input" bind:value={hotfixPrefix} />
  </div>
  <div class="modal-form-group">
    <label class="modal-field-label">{t('flow.init.versionTagPrefix')}</label>
    <input class="modal-input" bind:value={versionTagPrefix} />
  </div>

  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" onclick={handleSubmit} disabled={!productionBranch.trim() || !developBranch.trim()}>
      {t('flow.init.submit')}
    </button>
  </div>
</Modal>

<style>
  .flow-separator {
    border-top: 1px solid var(--border-color);
    margin: 12px 0;
  }
</style>
