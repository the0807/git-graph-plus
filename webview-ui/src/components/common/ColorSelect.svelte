<script lang="ts">
  interface Option {
    value: string;
    label: string;
    color: string;
    warning?: string;
    flag?: string;
  }

  interface Props {
    options: Option[];
    value: string;
    onChange: (value: string) => void;
    showDot?: boolean;
  }

  let { options, value, onChange, showDot = true }: Props = $props();

  let open = $state(false);
  let btnEl: HTMLButtonElement | undefined = $state();
  let dropdownStyle = $state('');

  let current = $derived(options.find(o => o.value === value) ?? options[0]);

  function toggle() {
    if (open) {
      open = false;
      return;
    }
    if (btnEl) {
      const rect = btnEl.getBoundingClientRect();
      dropdownStyle = `position: fixed; top: ${rect.bottom + 2}px; left: ${rect.left}px; width: ${rect.width}px;`;
    }
    open = true;
  }

  function select(v: string) {
    onChange(v);
    open = false;
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.color-select')) {
      open = false;
    }
  }

  $effect(() => {
    if (open) {
      window.addEventListener('click', handleClickOutside, true);
      return () => window.removeEventListener('click', handleClickOutside, true);
    }
  });
</script>

<div class="color-select" class:open>
  <!-- Hidden sizer: renders all options to establish max width -->
  <div class="color-select-sizer" aria-hidden="true">
    {#each options as opt}
      <span class="sizer-item">
        {#if showDot}<span class="dot" style="background: transparent"></span>{/if}
        <span>{opt.label}</span>
        {#if opt.flag}<span class="flag-badge">{opt.flag}</span>{/if}
        <i class="codicon codicon-chevron-down chevron"></i>
      </span>
    {/each}
  </div>
  <button class="color-select-btn" bind:this={btnEl} onclick={(e) => { e.stopPropagation(); toggle(); }}>
    {#if showDot}<span class="dot" style="background: {current.color}"></span>{/if}
    <span class="label">{current.label}</span>
    {#if current.flag}<span class="flag-badge">{current.flag}</span>{/if}
    <i class="codicon codicon-chevron-down chevron"></i>
  </button>
  {#if open}
    <div class="color-select-dropdown" style={dropdownStyle}>
      {#each options as opt}
        <button
          class="color-select-option"
          class:selected={opt.value === value}
          onclick={(e) => { e.stopPropagation(); select(opt.value); }}
        >
          {#if showDot}<span class="dot" style="background: {opt.color}"></span>{/if}
          <span>{opt.label}</span>
          {#if opt.flag}<span class="flag-badge">{opt.flag}</span>{/if}
          {#if opt.warning}<i class="codicon codicon-warning warning-icon"></i>{/if}
        </button>
      {/each}
    </div>
  {/if}
  {#if current.warning}
    <div class="warning-message">
      <i class="codicon codicon-warning"></i>
      <span>{@html current.warning}</span>
    </div>
  {/if}
</div>

<style>
  .color-select {
    position: relative;
    min-width: 0;
  }

  .color-select-sizer {
    height: 0;
    overflow: hidden;
    visibility: hidden;
  }

  .sizer-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    font-size: 12px;
    white-space: nowrap;
  }

  .color-select-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 8px;
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border, var(--border-color));
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }

  .color-select-btn:hover {
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chevron {
    font-size: 10px;
    opacity: 0.6;
    flex-shrink: 0;
    transition: transform 0.15s;
  }

  .open .chevron {
    transform: rotate(180deg);
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .color-select-dropdown {
    background: var(--vscode-editorWidget-background, var(--bg-secondary));
    border: 1px solid var(--vscode-editorWidget-border, var(--border-color));
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 2100;
    overflow: hidden;
  }

  .color-select-option {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    color: var(--text-primary);
    border: none;
    border-radius: 0;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }

  .color-select-option:hover {
    background: var(--bg-hover);
  }

  .color-select-option.selected {
    font-weight: 600;
    background: var(--bg-selected);
    color: var(--text-selected);
  }

  .warning-icon {
    margin-left: auto;
    color: #f0a020;
    font-size: 12px;
    flex-shrink: 0;
  }

  .warning-message {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    padding: 5px 8px;
    background: rgba(240, 160, 32, 0.1);
    border: 1px solid rgba(240, 160, 32, 0.3);
    border-radius: 4px;
    color: #f0a020;
    font-size: 11px;
    line-height: 1.3;
  }

  .flag-badge {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    padding: 1px 6px;
    background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.1));
    border: 1px solid var(--vscode-editorWidget-border, rgba(128, 128, 128, 0.25));
    border-radius: 100px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
</style>
