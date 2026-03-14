<script lang="ts">
  interface Option {
    value: string;
    label: string;
    color: string;
  }

  interface Props {
    options: Option[];
    value: string;
    onChange: (value: string) => void;
  }

  let { options, value, onChange }: Props = $props();

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
</script>

<svelte:window onclick={handleClickOutside} />

<div class="color-select" class:open>
  <!-- Hidden sizer: renders all options to establish max width -->
  <div class="color-select-sizer" aria-hidden="true">
    {#each options as opt}
      <span class="sizer-item">
        <span class="dot" style="background: transparent"></span>
        <span>{opt.label}</span>
        <i class="codicon codicon-chevron-down chevron"></i>
      </span>
    {/each}
  </div>
  <button class="color-select-btn" bind:this={btnEl} onclick={(e) => { e.stopPropagation(); toggle(); }}>
    <span class="dot" style="background: {current.color}"></span>
    <span class="label">{current.label}</span>
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
          <span class="dot" style="background: {opt.color}"></span>
          <span>{opt.label}</span>
        </button>
      {/each}
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
</style>
