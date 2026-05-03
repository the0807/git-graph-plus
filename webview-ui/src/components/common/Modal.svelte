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

    let closed = false;
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape' && !closed) { closed = true; onClose(); }
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
    border-radius: 8px;
    width: 480px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
    outline: none;
  }

  :global(body.vscode-light) .modal {
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.08);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 12px 14px 20px;
    border-bottom: 1px solid rgba(128, 128, 128, 0.2);
    flex-shrink: 0;
  }

  .modal-title {
    font-weight: 700;
    font-size: 15px;
  }

  .modal-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1;
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
    font-size: inherit;
    color: var(--text-secondary);
    margin-bottom: 14px;
    line-height: 1.6;
    word-break: keep-all;
    overflow-wrap: anywhere;
  }

  :global(.modal-emph--danger) { color: #f44336; }
  :global(.modal-emph--info) { color: #4da6ff; }

  :global(.modal-context-card) {
    background: var(--bg-secondary);
    border-radius: 6px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-bottom: 14px;
    flex-wrap: nowrap;
    overflow: hidden;
  }

  :global(.modal-pill) {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    gap: 3px;
    padding: 1px 7px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: normal;
    white-space: nowrap;
    flex-shrink: 0;
    /* Dark theme defaults — mirrors graph ref-badge */
    background: color-mix(in srgb, var(--pill-color) 15%, transparent);
    color: #fff;
    border: 1px solid color-mix(in srgb, var(--pill-color) 25%, transparent);
  }

  :global(.modal-pill .codicon[class*='codicon-']) {
    font-size: 12px;
    line-height: 1;
    flex-shrink: 0;
  }

  :global(.modal-pill--source) { --pill-color: #73d13d; }
  :global(.modal-pill--target) { --pill-color: #63b0f4; }
  :global(.modal-pill--danger) { --pill-color: #f44336; }
  :global(.modal-pill--tag)    { --pill-color: #f0c040; background: color-mix(in srgb, #f0c040 55%, transparent); border-color: color-mix(in srgb, #f0c040 70%, transparent); }
  :global(.modal-pill--stash)  { --pill-color: #888; }

  /* Light theme — mirrors graph ref-badge light overrides */
  :global(body.vscode-light .modal-pill) {
    background: color-mix(in srgb, var(--pill-color) 18%, transparent);
    color: #000;
    border: 1px solid color-mix(in srgb, var(--pill-color) 40%, transparent);
  }

  :global(body.vscode-light .modal-pill--tag) {
    background: color-mix(in srgb, #f0c040 75%, #fff);
    border-color: color-mix(in srgb, #f0c040 85%, transparent);
    color: #000;
  }

  :global(.modal-label) {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    min-width: 90px;
  }

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
    font-size: inherit;
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
    font-size: inherit;
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
    font-size: inherit;
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
    font-size: inherit;
    color: var(--text-secondary);
    cursor: pointer;
  }

  :global(.modal-checkbox input[type="checkbox"]) {
    appearance: none;
    width: 14px;
    height: 14px;
    border: 1px solid var(--text-secondary);
    border-radius: 3px;
    background: transparent;
    cursor: pointer;
    position: relative;
    flex-shrink: 0;
  }

  :global(.modal-checkbox input[type="checkbox"]:focus) {
    outline: none;
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  :global(.modal-checkbox input[type="checkbox"]:checked) {
    background: var(--vscode-button-background, #0078d4);
    border-color: var(--vscode-button-background, #0078d4);
  }

  :global(.modal-checkbox input[type="checkbox"]:checked::after) {
    content: '';
    position: absolute;
    left: 4px;
    top: 0;
    width: 4px;
    height: 8px;
    border: solid #fff;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }

  :global(.modal-checkbox--danger input[type="checkbox"]:checked) {
    background: #f44336;
    border-color: #f44336;
  }

  :global(.modal-radio) {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: inherit;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 2px 0;
  }

  :global(.modal-radio input[type="radio"]) {
    appearance: none;
    width: 14px;
    height: 14px;
    border: 1px solid var(--text-secondary);
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
    flex-shrink: 0;
    position: relative;
  }

  :global(.modal-radio input[type="radio"]:checked) {
    background: var(--vscode-focusBorder, #007fd4);
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  :global(.modal-radio input[type="radio"]:checked::after) {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #fff;
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
    margin: 0 0 6px;
  }

  :global(body.vscode-light .modal-warning) {
    background: rgba(200, 120, 0, 0.08);
    border-color: rgba(200, 120, 0, 0.3);
    color: #9a6700;
  }

  :global(.modal-hash) {
    font-family: monospace;
    color: var(--text-secondary);
  }

  :global(.modal-form-group) {
    margin-bottom: 12px;
  }

  :global(.form-actions) {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  :global(.modal-form-group + .form-actions) {
    margin-top: 12px;
  }

  :global(.modal-warning + .form-actions) {
    margin-top: 6px;
  }

  :global(.modal-form-group:last-of-type) {
    margin-bottom: 0;
  }

  :global(.danger-btn) {
    background: var(--vscode-errorForeground, #f44336) !important;
    color: #fff !important;
  }

  :global(.modal-flag-badge) {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    padding: 1px 6px;
    background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.1));
    border: 1px solid var(--vscode-editorWidget-border, rgba(128, 128, 128, 0.25));
    border-radius: 6px;
    color: var(--text-secondary);
    flex-shrink: 0;
    margin-left: 4px;
  }
</style>
