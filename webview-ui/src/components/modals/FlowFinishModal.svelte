<script lang="ts">
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import type { FlowConfig } from '../../lib/types';

  interface Props {
    flowType: string;
    branchName: string;
    config: FlowConfig;
    onClose: () => void;
    onFinish: () => void;
  }

  let { flowType, branchName, config, onClose, onFinish }: Props = $props();

  const titleKey = $derived(`flow.finish.${flowType}.title`);

  const tagName = $derived.by(() => {
    const prefixMap: Record<string, string> = {
      feature: config.featurePrefix,
      release: config.releasePrefix,
      hotfix: config.hotfixPrefix,
    };
    return branchName.replace(prefixMap[flowType] || '', '');
  });

  interface StepInfo { icon: string; text: string }

  const steps: StepInfo[] = $derived.by(() => {
    const dev = config.developBranch;
    const prod = config.productionBranch;
    const tag = config.versionTagPrefix + tagName;

    if (flowType === 'feature') {
      return [
        { icon: 'codicon-git-merge', text: t('flow.finish.feature.step1', { name: branchName, developBranch: dev }) },
        { icon: 'codicon-trash', text: t('flow.finish.feature.step2', { name: branchName }) },
        { icon: 'codicon-arrow-swap', text: t('flow.finish.feature.step3', { developBranch: dev }) },
      ];
    } else if (flowType === 'release') {
      return [
        { icon: 'codicon-git-merge', text: t('flow.finish.release.step1', { name: branchName, productionBranch: prod }) },
        { icon: 'codicon-tag', text: t('flow.finish.release.step2', { tag }) },
        { icon: 'codicon-git-merge', text: t('flow.finish.release.step3', { productionBranch: prod, developBranch: dev }) },
        { icon: 'codicon-trash', text: t('flow.finish.release.step4', { name: branchName }) },
      ];
    } else {
      return [
        { icon: 'codicon-git-merge', text: t('flow.finish.hotfix.step1', { name: branchName, productionBranch: prod }) },
        { icon: 'codicon-tag', text: t('flow.finish.hotfix.step2', { tag }) },
        { icon: 'codicon-git-merge', text: t('flow.finish.hotfix.step3', { productionBranch: prod, developBranch: dev }) },
        { icon: 'codicon-trash', text: t('flow.finish.hotfix.step4', { name: branchName }) },
      ];
    }
  });
</script>

<Modal title={t(titleKey)} {onClose}>
  <div class="modal-context-card">
    <i class="codicon codicon-git-branch"></i>
    <span class="modal-pill modal-pill--danger">{branchName}</span>
  </div>

  <p class="modal-desc">{t('flow.finish.confirm', { name: branchName })}</p>

  <div class="flow-steps">
    {#each steps as step, i}
      <div class="flow-step">
        <span class="flow-step-num">{i + 1}</span>
        <i class="codicon {step.icon}"></i>
        <span>{step.text}</span>
      </div>
    {/each}
  </div>

  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary danger" onclick={onFinish}>
      {t('flow.finish.submit')}
    </button>
  </div>
</Modal>

<style>
  .flow-steps {
    background: rgba(128, 128, 128, 0.06);
    border: 1px solid var(--border-color);
    border-radius: 5px;
    padding: 4px 0;
    margin: 12px 0;
  }

  .flow-step {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--text-primary);
  }

  .flow-step-num {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: rgba(128, 128, 128, 0.2);
    font-size: 10px;
    font-weight: 600;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .flow-step i {
    color: var(--text-secondary);
    font-size: 12px;
    flex-shrink: 0;
  }

  .danger {
    background: var(--vscode-errorForeground, #f44336) !important;
  }
</style>
