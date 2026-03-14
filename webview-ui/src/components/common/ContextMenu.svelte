<script lang="ts">
  import { onMount } from 'svelte';

  interface MenuItem {
    label: string;
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

  // Keep menu within viewport
  let adjustedX = $derived.by(() => {
    if (!menuEl) return x;
    const maxX = window.innerWidth - 200;
    return Math.min(x, maxX);
  });

  let adjustedY = $derived.by(() => {
    if (!menuEl) return y;
    const maxY = window.innerHeight - items.length * 28 - 10;
    return Math.min(y, maxY);
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
      <button
        class="menu-item has-children"
        class:submenu-active={activeSubmenu === idx}
        onmouseenter={() => { activeSubmenu = idx; }}
        role="menuitem"
      >
        {item.label}
        <span class="submenu-arrow">›</span>
      </button>
      {#if activeSubmenu === idx}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="submenu"
          role="menu"
          tabindex="-1"
          style="top: {idx * 28 + 4}px;"
          onmouseleave={() => { activeSubmenu = null; }}
        >
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
                {child.label}
              </button>
            {/if}
          {/each}
        </div>
      {/if}
    {:else}
      <button
        class="menu-item"
        class:danger={item.danger}
        disabled={item.disabled}
        onmouseenter={() => { activeSubmenu = null; }}
        onclick={() => { item.action(); onClose(); }}
        role="menuitem"
      >
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

  .has-children {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .submenu-arrow {
    margin-left: 12px;
    opacity: 0.6;
  }

  .submenu-active {
    background: var(--vscode-menu-selectionBackground, var(--bg-selected));
    color: var(--vscode-menu-selectionForeground, var(--text-selected));
  }

  .submenu {
    position: absolute;
    left: 100%;
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
</style>
