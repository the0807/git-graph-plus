<script lang="ts">
  import { onMount } from 'svelte';

  interface MenuItem {
    label: string;
    icon?: string;
    action: () => void;
    danger?: boolean;
    disabled?: boolean;
    separator?: boolean;
    children?: MenuItem[];
  }

  interface Props {
    x: number;
    y: number;
    items: MenuItem[];
    onClose: () => void;
  }

  let { x, y, items, onClose }: Props = $props();
  let menuEl: HTMLDivElement | undefined = $state();
  let activeSubmenu = $state<number | null>(null);

  onMount(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (menuEl && !menuEl.contains(target)) {
        onClose();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); }
    }
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  });

  // Keep menu within viewport using actual rendered size
  // svelte-ignore state_referenced_locally
  let adjustedX = $state(x);
  // svelte-ignore state_referenced_locally
  let adjustedY = $state(y);

  $effect(() => {
    if (menuEl) {
      const rect = menuEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      adjustedX = x + rect.width > vw ? Math.max(0, vw - rect.width - 4) : x;
      adjustedY = y + rect.height > vh ? Math.max(0, vh - rect.height - 4) : y;
    }
  });
</script>

<div
  class="context-menu"
  bind:this={menuEl}
  style="left: {adjustedX}px; top: {adjustedY}px;"
  role="menu"
>
  {#each items as item, idx}
    {#if item.separator}
      <div class="separator"></div>
    {:else if item.children}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="submenu-wrapper" onmouseleave={() => { activeSubmenu = null; }}>
        <button
          class="menu-item has-children"
          class:submenu-active={activeSubmenu === idx}
          onmouseenter={() => { activeSubmenu = idx; }}
          role="menuitem"
        >
          {#if item.icon}<i class="codicon codicon-{item.icon} menu-icon"></i>{/if}
          <span class="menu-label">{item.label}</span>
          <i class="codicon codicon-chevron-right submenu-arrow"></i>
        </button>
        {#if activeSubmenu === idx}
          <div class="submenu" role="menu" tabindex="-1">
            {#each item.children as child}
              {#if child.separator}
                <div class="separator"></div>
              {:else}
                <button
                  class="menu-item"
                  class:danger={child.danger}
                  disabled={child.disabled}
                  onclick={() => { child.action(); onClose(); }}
                  role="menuitem"
                >
                  {#if child.icon}<i class="codicon codicon-{child.icon} menu-icon"></i>{/if}
                  {child.label}
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <button
        class="menu-item"
        class:danger={item.danger}
        disabled={item.disabled}
        onmouseenter={() => { activeSubmenu = null; }}
        onclick={() => { item.action(); onClose(); }}
        role="menuitem"
      >
        {#if item.icon}<i class="codicon codicon-{item.icon} menu-icon"></i>{/if}
        {item.label}
      </button>
    {/if}
  {/each}
</div>

<style>
  .context-menu {
    position: fixed;
    z-index: 1000;
    background: var(--vscode-menu-background, var(--bg-secondary));
    border: 1px solid var(--vscode-menu-border, var(--border-color));
    border-radius: 4px;
    padding: 4px 0;
    min-width: 280px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .menu-item {
    display: block;
    width: 100%;
    padding: 4px 16px;
    white-space: nowrap;
    text-align: left;
    font-size: 12px;
    background: transparent;
    color: var(--vscode-menu-foreground, var(--text-primary));
    border: none;
    border-radius: 0;
    cursor: pointer;
  }

  .menu-item:hover:not(:disabled) {
    background: var(--vscode-menu-selectionBackground, var(--bg-selected));
    color: var(--vscode-menu-selectionForeground, var(--text-selected));
  }

  .menu-item:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .menu-item.danger {
    color: var(--vscode-errorForeground, #f44336);
  }

  .menu-item.danger:hover:not(:disabled) {
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    color: #fff;
  }

  .menu-icon {
    font-size: 14px;
    margin-right: 6px;
    opacity: 0.7;
    flex-shrink: 0;
  }

  .menu-label {
    flex: 1;
  }

  .has-children {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .submenu-arrow {
    margin-left: auto;
    font-size: 11px;
    opacity: 0.5;
  }

  .submenu-active {
    background: var(--vscode-menu-selectionBackground, var(--bg-selected));
    color: var(--vscode-menu-selectionForeground, var(--text-selected));
  }

  .submenu-wrapper {
    position: relative;
  }

  .submenu {
    position: absolute;
    left: 100%;
    top: -5px;
    margin-left: 2px;
    background: var(--vscode-menu-background, var(--bg-secondary));
    border: 1px solid var(--vscode-menu-border, var(--border-color));
    border-radius: 4px;
    padding: 4px 0;
    min-width: 180px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 1001;
  }

  .separator {
    height: 1px;
    margin: 4px 8px;
    background: var(--border-color);
  }

  :global(body.vscode-light) .menu {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  :global(body.vscode-light) .submenu {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  :global(body.vscode-light) .menu-item.danger:hover:not(:disabled) {
    background: rgba(183, 28, 28, 0.08);
    color: #b71c1c;
  }
</style>
