<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    onClose: () => void;
    children: Snippet;
  }

  let { title, onClose, children }: Props = $props();
  let dialogEl: HTMLDivElement | undefined = $state();
  let ready = $state(false);

  onMount(() => {
    // Focus trap
    dialogEl?.focus();

    // Delay enabling overlay click-to-close to prevent the opening click from immediately closing the modal
    requestAnimationFrame(() => { ready = true; });

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); }
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  });

  function handleOverlayClick() {
    if (ready) { onClose(); }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="modal-overlay" onclick={handleOverlayClick} onkeydown={() => {}} role="dialog" tabindex={-1}>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="modal"
    bind:this={dialogEl}
    onclick={(e) => e.stopPropagation()}
    onkeydown={() => {}}
    role="document"
    tabindex={-1}
  >
    <div class="modal-header">
      <span class="modal-title">{title}</span>
      <button class="modal-close" onclick={onClose} title="Close (Esc)"><i class="codicon codicon-close"></i></button>
    </div>
    <div class="modal-body">
      {@render children()}
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
  }

  .modal {
    background: var(--vscode-editorWidget-background, var(--bg-secondary));
    border: 1px solid rgba(128, 128, 128, 0.3);
    border-radius: 12px;
    min-width: 400px;
    max-width: 520px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
    outline: none;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid rgba(128, 128, 128, 0.2);
    flex-shrink: 0;
  }

  .modal-title {
    font-weight: 700;
    font-size: 15px;
  }

  .modal-close {
    background: transparent;
    color: var(--text-secondary);
    font-size: 14px;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .modal-close:hover {
    background: rgba(128, 128, 128, 0.2);
    color: var(--text-primary);
  }

  .modal-body {
    padding: 18px 20px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
</style>
