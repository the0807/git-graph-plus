<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { t } from '../../lib/i18n/index.svelte';
  import type { Commit } from '../../lib/types';
  import Modal from '../common/Modal.svelte';

  interface Props {
    base: string;
    onClose: () => void;
  }

  let { base, onClose }: Props = $props();

  const vscode = getVsCodeApi();

  interface TodoEntry {
    action: 'pick' | 'squash' | 'fixup' | 'reword' | 'edit' | 'drop';
    hash: string;
    subject: string;
  }

  let todos = $state<TodoEntry[]>([]);
  let loading = $state(true);
  let dragIndex = $state<number | null>(null);

  const ACTIONS: TodoEntry['action'][] = ['pick', 'squash', 'fixup', 'reword', 'edit', 'drop'];

  onMount(() => {
    function handleMessage(event: MessageEvent) {
      const msg = event.data;
      if (msg.type === 'rebaseCommitsData') {
        todos = msg.payload.commits.map((c: Commit) => ({
          action: 'pick' as const,
          hash: c.hash,
          subject: c.subject,
        }));
        loading = false;
      }
    }
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'getRebaseCommits', payload: { base } });
    return () => window.removeEventListener('message', handleMessage);
  });

  function cycleAction(index: number) {
    const current = ACTIONS.indexOf(todos[index].action);
    todos[index].action = ACTIONS[(current + 1) % ACTIONS.length];
  }

  function handleDragStart(index: number) {
    dragIndex = index;
  }

  function handleDragOver(e: DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    const item = todos.splice(dragIndex, 1)[0];
    todos.splice(index, 0, item);
    todos = [...todos];
    dragIndex = index;
  }

  function handleDragEnd() {
    dragIndex = null;
  }

  function execute() {
    const activeTodos = todos
      .filter(t => t.action !== 'drop')
      .map(t => ({ action: t.action, hash: t.hash }));

    // Include drops too — git rebase -i needs them as comments or excluded
    const allTodos = todos.map(t => ({ action: t.action, hash: t.hash }));

    vscode.postMessage({
      type: 'interactiveRebase',
      payload: { base, todos: allTodos },
    });
    onClose();
  }

  function getActionColor(action: TodoEntry['action']): string {
    switch (action) {
      case 'pick': return '#4caf50';
      case 'squash': return '#ff9800';
      case 'fixup': return '#ff9800';
      case 'reword': return '#2196f3';
      case 'edit': return '#9c27b0';
      case 'drop': return '#f44336';
    }
  }
</script>

<Modal title={t('rebase.title', { base })} {onClose}>
  {#if loading}
    <div class="loading">{t('rebase.loading')}</div>
  {:else if todos.length === 0}
    <div class="empty">{t('rebase.noCommits')}</div>
  {:else}
    <div class="instructions">
      {t('rebase.instructions')}
    </div>
    <div class="todo-list">
      {#each todos as todo, index (todo.hash)}
        <div
          class="todo-item"
          class:dropped={todo.action === 'drop'}
          draggable="true"
          ondragstart={() => handleDragStart(index)}
          ondragover={(e) => handleDragOver(e, index)}
          ondragend={handleDragEnd}
          role="listitem"
        >
          <span class="drag-handle">&#9776;</span>
          <button
            class="action-badge"
            style="background: {getActionColor(todo.action)}"
            onclick={() => cycleAction(index)}
            title="Click to change action"
          >
            {todo.action}
          </button>
          <span class="todo-hash">{todo.hash.substring(0, 7)}</span>
          <span class="todo-subject truncate">{todo.subject}</span>
        </div>
      {/each}
    </div>
    <div class="form-actions">
      <button onclick={onClose}>{t('common.cancel')}</button>
      <button class="primary" onclick={execute}>{t('rebase.start')}</button>
    </div>
  {/if}
</Modal>

<style>
  .loading, .empty {
    padding: 20px;
    text-align: center;
    color: var(--text-secondary);
  }

  .instructions {
    font-size: 11px;
    color: var(--text-secondary);
    margin-bottom: 10px;
  }

  .todo-list {
    max-height: 400px;
    overflow-y: auto;
    border: 1px solid var(--border-color);
    border-radius: 4px;
  }

  .todo-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-color);
    cursor: grab;
    font-size: 12px;
  }

  .todo-item:last-child {
    border-bottom: none;
  }

  .todo-item:hover {
    background: var(--bg-hover);
  }

  .todo-item.dropped {
    opacity: 0.4;
    text-decoration: line-through;
  }

  .drag-handle {
    cursor: grab;
    opacity: 0.4;
    font-size: 10px;
    user-select: none;
  }

  .action-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    border: none;
    cursor: pointer;
    min-width: 50px;
    text-align: center;
    text-transform: uppercase;
  }

  .todo-hash {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .todo-subject {
    flex: 1;
    min-width: 0;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
