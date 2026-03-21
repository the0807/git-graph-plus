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
    <label class="modal-field-label" for="flow-production">{t('flow.init.productionBranch')}</label>
    <input id="flow-production" class="modal-input" bind:this={firstInput} bind:value={productionBranch} />
  </div>
  <div class="modal-form-group">
    <label class="modal-field-label" for="flow-develop">{t('flow.init.developBranch')}</label>
    <input id="flow-develop" class="modal-input" bind:value={developBranch} />
  </div>

  <div class="flow-separator"></div>

  <div class="modal-form-group">
    <label class="modal-field-label" for="flow-feature">{t('flow.init.featurePrefix')}</label>
    <input id="flow-feature" class="modal-input" bind:value={featurePrefix} />
  </div>
  <div class="modal-form-group">
    <label class="modal-field-label" for="flow-release">{t('flow.init.releasePrefix')}</label>
    <input id="flow-release" class="modal-input" bind:value={releasePrefix} />
  </div>
  <div class="modal-form-group">
    <label class="modal-field-label" for="flow-hotfix">{t('flow.init.hotfixPrefix')}</label>
    <input id="flow-hotfix" class="modal-input" bind:value={hotfixPrefix} />
  </div>
  <div class="modal-form-group">
    <label class="modal-field-label" for="flow-versiontag">{t('flow.init.versionTagPrefix')}</label>
    <input id="flow-versiontag" class="modal-input" bind:value={versionTagPrefix} />
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
