<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { t } from '../../lib/i18n/index.svelte';
  import type { Commit } from '../../lib/types';
  import Modal from '../common/Modal.svelte';

  interface Props {
    base: string;
    branchName?: string;
    baseSubject?: string;
    onClose: () => void;
  }

  let { base, branchName = 'HEAD', baseSubject = '', onClose }: Props = $props();

  const vscode = getVsCodeApi();

  interface TodoEntry {
    action: 'pick' | 'squash' | 'fixup' | 'reword' | 'edit' | 'drop';
    hash: string;
    subject: string;
  }

  let todos = $state<TodoEntry[]>([]);
  let loading = $state(true);
  let dragIndex = $state<number | null>(null);
  let showActionMenu = $state<number | null>(null);
  let dropdownPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });

  const ACTIONS: Array<{ value: TodoEntry['action']; icon: string; label: string; color: string }> = [
    { value: 'pick', icon: 'check', label: 'Pick', color: '#4caf50' },
    { value: 'reword', icon: 'edit', label: 'Reword', color: '#2196f3' },
    { value: 'edit', icon: 'debug-pause', label: 'Edit', color: '#9c27b0' },
    { value: 'squash', icon: 'fold', label: 'Squash', color: '#ff9800' },
    { value: 'fixup', icon: 'fold-down', label: 'Fixup', color: '#ff9800' },
    { value: 'drop', icon: 'trash', label: 'Drop', color: '#f44336' },
  ];

  const dropCount = $derived(todos.filter(t => t.action === 'drop').length);

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

    function handleClickOutside() {
      showActionMenu = null;
    }
    window.addEventListener('click', handleClickOutside);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('click', handleClickOutside);
    };
  });

  function setAction(index: number, action: TodoEntry['action']) {
    todos[index].action = action;
    showActionMenu = null;
  }

  function moveUp(index: number) {
    if (index <= 0) return;
    const item = todos.splice(index, 1)[0];
    todos.splice(index - 1, 0, item);
    todos = [...todos];
  }

  function moveDown(index: number) {
    if (index >= todos.length - 1) return;
    const item = todos.splice(index, 1)[0];
    todos.splice(index + 1, 0, item);
    todos = [...todos];
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
    const allTodos = todos.map(t => ({ action: t.action, hash: t.hash }));
    vscode.postMessage({
      type: 'interactiveRebase',
      payload: { base, todos: allTodos },
    });
    onClose();
  }

  function getActionInfo(action: TodoEntry['action']) {
    return ACTIONS.find(a => a.value === action) ?? ACTIONS[0];
  }
</script>

<Modal title={t('rebase.title')} {onClose}>
  {#if loading}
    <div class="rebase-loading"><span class="spinner"></span> {t('rebase.loading')}</div>
  {:else if todos.length === 0}
    <div class="rebase-empty">{t('rebase.noCommits')}</div>
  {:else}
    <div class="modal-context-card">
      <i class="codicon codicon-git-branch"></i>
      <span class="modal-pill modal-pill--target">{branchName}</span>
      <i class="codicon codicon-arrow-right" style="color: var(--text-secondary);"></i>
      <i class="codicon codicon-git-commit"></i>
      <span class="modal-pill modal-pill--source">{base.substring(0, 7)}</span>
    </div>
    <div class="rebase-header">
      <span class="rebase-count">{todos.length} commit{todos.length > 1 ? 's' : ''}</span>
      <span class="rebase-hint">{t('rebase.instructions')}</span>
    </div>

    <div class="todo-list" role="list">
      {#each todos as todo, index (todo.hash)}
        {@const info = getActionInfo(todo.action)}
        <div
          class="todo-item"
          class:dropped={todo.action === 'drop'}
          class:dragging={dragIndex === index}
          draggable="true"
          ondragstart={() => handleDragStart(index)}
          ondragover={(e) => handleDragOver(e, index)}
          ondragend={handleDragEnd}
          role="listitem"
        >
          <span class="drag-handle" title="Drag to reorder">
            <i class="codicon codicon-gripper"></i>
          </span>

          <div class="action-wrapper">
            <button
              class="action-badge"
              style="background: {info.color}"
              onclick={(e) => {
                e.stopPropagation();
                if (showActionMenu === index) { showActionMenu = null; return; }
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                dropdownPos = { x: rect.left, y: rect.bottom + 2 };
                showActionMenu = index;
              }}
              title="Click to change action"
            >
              <i class="codicon codicon-{info.icon}"></i>
              {info.label}
              <i class="codicon codicon-chevron-down action-chevron"></i>
            </button>
          </div>

          <span class="todo-hash">{todo.hash.substring(0, 7)}</span>
          <span class="todo-subject truncate">{todo.subject}</span>

          <div class="move-btns">
            <button class="move-btn" disabled={index === 0} onclick={() => moveUp(index)} title="Move up">
              <i class="codicon codicon-chevron-up"></i>
            </button>
            <button class="move-btn" disabled={index === todos.length - 1} onclick={() => moveDown(index)} title="Move down">
              <i class="codicon codicon-chevron-down"></i>
            </button>
          </div>
        </div>
      {/each}
    </div>

    {#if showActionMenu !== null}
      {@const activeAction = todos[showActionMenu]?.action}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="action-dropdown" style="left: {dropdownPos.x}px; top: {dropdownPos.y}px;" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
        {#each ACTIONS as act}
          <button
            class="action-option"
            class:active={activeAction === act.value}
            onclick={() => setAction(showActionMenu!, act.value)}
          >
            <i class="codicon codicon-{act.icon}" style="color: {act.color}"></i>
            <span>{act.label}</span>
            <span class="action-desc">{t(`rebase.action.${act.value}`)}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if dropCount > 0}
      <div class="rebase-warning">
        <i class="codicon codicon-warning"></i>
        <span>{t('rebase.dropWarning', { count: String(dropCount) })}</span>
      </div>
    {/if}

    <div class="form-actions">
      <button onclick={onClose}>{t('common.cancel')}</button>
      <button class="primary" onclick={execute}>{t('rebase.start')}</button>
    </div>
  {/if}
</Modal>

<style>
  .rebase-loading, .rebase-empty {
    padding: 24px;
    text-align: center;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .rebase-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .rebase-count {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-primary);
    background: var(--bg-secondary);
    padding: 2px 8px;
    border-radius: 10px;
  }

  .rebase-hint {
    font-size: 11px;
    color: var(--text-secondary);
  }

  .todo-list {
    max-height: 350px;
    overflow-y: auto;
    border: 1px solid var(--border-color);
    border-radius: 6px;
  }

  .todo-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--border-color);
    font-size: 12px;
    transition: opacity 0.15s;
  }

  .todo-item:last-child {
    border-bottom: none;
  }

  .todo-item:hover {
    background: var(--bg-hover);
  }

  .todo-item.dropped {
    opacity: 0.35;
  }

  .todo-item.dropped .todo-subject {
    text-decoration: line-through;
  }

  .todo-item.dragging {
    opacity: 0.5;
    background: var(--bg-selected);
  }

  .drag-handle {
    cursor: grab;
    opacity: 0.3;
    font-size: 12px;
    user-select: none;
    flex-shrink: 0;
  }

  .drag-handle:hover {
    opacity: 0.7;
  }

  .action-wrapper {
    position: relative;
    flex-shrink: 0;
  }

  .action-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    color: #fff;
    border: none;
    cursor: pointer;
    min-width: 72px;
    text-transform: uppercase;
  }

  .action-badge:hover {
    filter: brightness(1.15);
  }

  .action-chevron {
    font-size: 10px;
    opacity: 0.7;
    margin-left: 2px;
  }

  .action-dropdown {
    position: fixed;
    z-index: 3000;
    background: var(--vscode-menu-background, var(--bg-secondary));
    border: 1px solid var(--vscode-menu-border, var(--border-color));
    border-radius: 6px;
    padding: 4px;
    min-width: 200px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .action-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-primary);
    font-size: 11px;
    cursor: pointer;
    text-align: left;
  }

  .action-option:hover {
    background: var(--bg-hover);
  }

  .action-option.active {
    background: var(--bg-selected);
  }

  .action-desc {
    color: var(--text-secondary);
    font-size: 10px;
    margin-left: auto;
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

  .move-btns {
    display: flex;
    flex-direction: column;
    gap: 0;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .todo-item:hover .move-btns {
    opacity: 1;
  }

  .move-btn {
    padding: 0 2px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 10px;
    line-height: 1;
    border-radius: 2px;
  }

  .move-btn:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .move-btn:disabled {
    opacity: 0.2;
    cursor: default;
  }

  .rebase-warning {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: rgba(244, 67, 54, 0.08);
    border: 1px solid rgba(244, 67, 54, 0.25);
    border-radius: 5px;
    color: #f44336;
    font-size: 11px;
    margin-top: 10px;
  }

  :global(body.vscode-light) .action-badge {
    color: #000;
  }

  :global(body.vscode-light) .rebase-warning {
    background: rgba(183, 28, 28, 0.06);
    border-color: rgba(183, 28, 28, 0.2);
    color: #b71c1c;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
