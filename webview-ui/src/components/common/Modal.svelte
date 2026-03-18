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

  /* ── Shared modal classes (used by child modal components) ── */

  :global(.modal-desc) {
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 14px;
  }

  :global(.modal-context-card) {
    background: var(--bg-secondary);
    border-radius: 6px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    flex-wrap: nowrap;
    overflow: hidden;
  }

  :global(.modal-pill) {
    padding: 2px 10px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
    flex-shrink: 1;
    min-width: 0;
  }
  :global(.modal-pill--source) { background: rgba(115, 209, 61, 0.15); color: #73d13d; }
  :global(.modal-pill--target) { background: rgba(99, 176, 244, 0.15); color: #63b0f4; }
  :global(.modal-pill--danger) { background: rgba(244, 67, 54, 0.15); color: #f44336; }
  :global(.modal-pill--tag) { background: rgba(226, 160, 41, 0.15); color: #e2a029; }

  :global(.modal-arrow) {
    color: var(--text-secondary);
    font-size: 13px;
    flex-shrink: 0;
  }

  :global(.modal-field-label) {
    font-size: 11px;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }

  :global(.modal-field-row) {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    font-size: 12px;
  }

  :global(.modal-field-row .modal-field-label) {
    width: auto;
    flex-shrink: 0;
    white-space: nowrap;
    margin-bottom: 0;
  }

  :global(.modal-input) {
    width: 100%;
    box-sizing: border-box;
    background: var(--input-bg);
    border: 1px solid var(--input-border, var(--border-color));
    border-radius: 5px;
    padding: 6px 10px;
    color: var(--input-fg);
    font-size: 12px;
    font-family: inherit;
    outline: none;
  }
  :global(.modal-input:focus) {
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  :global(.modal-textarea) {
    width: 100%;
    box-sizing: border-box;
    background: var(--input-bg);
    border: 1px solid var(--input-border, var(--border-color));
    border-radius: 5px;
    padding: 6px 10px;
    color: var(--input-fg);
    font-size: 12px;
    font-family: inherit;
    outline: none;
    resize: vertical;
  }
  :global(.modal-textarea:focus) {
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  :global(.modal-checkbox) {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  :global(.modal-warning) {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: rgba(240, 160, 32, 0.08);
    border: 1px solid rgba(240, 160, 32, 0.25);
    border-radius: 5px;
    color: #f0a020;
    font-size: 11px;
    margin-top: 6px;
  }

  :global(.modal-hash) {
    font-family: monospace;
    color: var(--text-secondary);
  }

  :global(.modal-form-group) {
    margin-bottom: 12px;
  }
</style>
