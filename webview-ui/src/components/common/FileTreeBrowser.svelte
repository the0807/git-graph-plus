<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';

  interface Props {
    commitHash: string;
  }

  let { commitHash }: Props = $props();

  interface TreeEntry {
    mode: string;
    type: 'blob' | 'tree';
    hash: string;
    name: string;
  }

  const vscode = getVsCodeApi();

  let entries = $state<TreeEntry[]>([]);
  let currentPath = $state<string[]>([]);
  let loading = $state(true);

  let displayPath = $derived(currentPath.length > 0 ? currentPath.join('/') : '/');

  onMount(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data.type === 'lsTreeData') {
        entries = event.data.payload.entries;
        loading = false;
      }
    }
    window.addEventListener('message', handleMessage);
    loadTree();
    return () => window.removeEventListener('message', handleMessage);
  });

  function loadTree(subpath?: string) {
    loading = true;
    const fullPath = subpath ?? (currentPath.length > 0 ? currentPath.join('/') : undefined);
    vscode.postMessage({ type: 'lsTree', payload: { ref: commitHash, path: fullPath } });
  }

  function navigateInto(name: string) {
    currentPath = [...currentPath, name];
    loadTree(currentPath.join('/'));
  }

  function navigateUp() {
    if (currentPath.length > 0) {
      currentPath = currentPath.slice(0, -1);
      loadTree(currentPath.length > 0 ? currentPath.join('/') : undefined);
    }
  }

  function navigateToRoot() {
    currentPath = [];
    loadTree();
  }

  function openFile(name: string) {
    const filePath = currentPath.length > 0 ? `${currentPath.join('/')}/${name}` : name;
    vscode.postMessage({ type: 'openDiff', payload: { file: filePath, commitHash } });
  }
</script>

<div class="file-tree-browser">
  <div class="tree-header">
    <button class="nav-btn" onclick={navigateToRoot} disabled={currentPath.length === 0} title="Root">/</button>
    {#if currentPath.length > 0}
      <button class="nav-btn" onclick={navigateUp} title="Go up">&#8593;</button>
    {/if}
    <span class="tree-path truncate">{displayPath}</span>
    <span class="tree-ref">{commitHash.substring(0, 7)}</span>
  </div>

  <div class="tree-list">
    {#if loading}
      <div class="tree-loading"><span class="spinner"></span></div>
    {:else}
      {#each entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
        return a.name.localeCompare(b.name);
      }) as entry}
        <button
          class="tree-item"
          onclick={() => entry.type === 'tree' ? navigateInto(entry.name) : openFile(entry.name)}
        >
          <span class="tree-icon">{entry.type === 'tree' ? '&#128193;' : '&#128196;'}</span>
          <span class="tree-name truncate">{entry.name}</span>
        </button>
      {/each}
      {#if entries.length === 0}
        <div class="tree-empty">Empty directory</div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .file-tree-browser {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .tree-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    font-size: inherit;
    flex-shrink: 0;
  }

  .nav-btn {
    padding: 2px 6px;
    font-size: inherit;
    font-weight: bold;
  }

  .tree-path {
    flex: 1;
    min-width: 0;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
  }

  .tree-ref {
    color: var(--text-secondary);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
  }

  .tree-list {
    flex: 1;
    overflow-y: auto;
  }

  .tree-loading, .tree-empty {
    padding: 20px;
    text-align: center;
    color: var(--text-secondary);
    font-size: inherit;
  }

  .tree-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 12px;
    text-align: left;
    background: transparent;
    color: var(--text-primary);
    border: none;
    border-radius: 0;
    font-size: inherit;
    cursor: pointer;
  }

  .tree-item:hover {
    background: var(--bg-hover);
  }

  .tree-icon {
    font-size: 14px;
    flex-shrink: 0;
  }

  .tree-name {
    flex: 1;
    min-width: 0;
  }
</style>
