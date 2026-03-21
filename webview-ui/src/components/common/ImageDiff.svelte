<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';

  interface Props {
    file: string;
    staged: boolean;
    commitHash?: string;
  }

  let { file, staged, commitHash }: Props = $props();

  const vscode = getVsCodeApi();

  let oldImage = $state<string | null>(null);
  let newImage = $state<string | null>(null);
  let oldImageInfo = $state<{ width: number; height: number; bytes: number } | null>(null);
  let newImageInfo = $state<{ width: number; height: number; bytes: number } | null>(null);
  let mode = $state<'side-by-side' | 'swipe' | 'onion'>('side-by-side');
  let swipePosition = $state(50);
  let onionOpacity = $state(0.5);
  let dragging = $state(false);
  let swipeContainerEl = $state<HTMLElement | null>(null);

  // Track which refs we expect so we can assign old/new correctly
  let oldRef = $state('');
  let newRef = $state('');

  $effect(() => {
    oldImage = null;
    newImage = null;
    oldImageInfo = null;
    newImageInfo = null;

    if (commitHash) {
      oldRef = `${commitHash}~1`;
      newRef = commitHash;
    } else if (staged) {
      oldRef = 'HEAD';
      newRef = ':0';
    } else {
      oldRef = ':0';
      newRef = 'working';
    }

    vscode.postMessage({ type: 'getImageAtRef', payload: { ref: oldRef, path: file } });
    vscode.postMessage({ type: 'getImageAtRef', payload: { ref: newRef, path: file } });
  });

  onMount(() => {
    function handleMessage(event: MessageEvent) {
      const msg = event.data;
      if (msg.type === 'imageData' && msg.payload.path === file) {
        const dataUrl = msg.payload.base64
          ? `data:${msg.payload.mimeType};base64,${msg.payload.base64}`
          : null;

        const bytes = msg.payload.base64
          ? Math.floor(msg.payload.base64.length * 3 / 4)
          : 0;

        // Match by ref to avoid race condition
        if (msg.payload.ref === oldRef) {
          oldImage = dataUrl;
          if (dataUrl) {
            loadImageInfo(dataUrl, bytes, (info) => { oldImageInfo = info; });
          }
        } else if (msg.payload.ref === newRef) {
          newImage = dataUrl;
          if (dataUrl) {
            loadImageInfo(dataUrl, bytes, (info) => { newImageInfo = info; });
          }
        }
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  });

  function loadImageInfo(src: string, bytes: number, cb: (info: { width: number; height: number; bytes: number }) => void) {
    const img = new Image();
    img.onload = () => cb({ width: img.naturalWidth, height: img.naturalHeight, bytes });
    img.src = src;
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function handleSwipeMove(e: MouseEvent) {
    if (!dragging || !swipeContainerEl) return;
    const rect = swipeContainerEl.getBoundingClientRect();
    swipePosition = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
  }

  function handleSwipeStart(e: MouseEvent) {
    e.preventDefault();
    dragging = true;
  }

  function handleSwipeEnd() {
    dragging = false;
  }
</script>

<svelte:window onmouseup={handleSwipeEnd} onmousemove={handleSwipeMove} />

<div class="image-diff">
  <div class="image-diff-toolbar">
    <button class:active={mode === 'side-by-side'} onclick={() => { mode = 'side-by-side'; }}>Side by Side</button>
    <button class:active={mode === 'swipe'} onclick={() => { mode = 'swipe'; }}>Swipe</button>
    <button class:active={mode === 'onion'} onclick={() => { mode = 'onion'; }}>Onion Skin</button>
  </div>

  {#if mode === 'side-by-side'}
    <div class="sbs-container">
      <div class="sbs-panel">
        <div class="sbs-label">Before</div>
        {#if oldImage}
          <div class="sbs-image-wrapper">
            <img src={oldImage} alt="Before" class="diff-image" />
            {#if oldImageInfo}
              <div class="image-info">W: {oldImageInfo.width}px | H: {oldImageInfo.height}px ({formatBytes(oldImageInfo.bytes)})</div>
            {/if}
          </div>
        {:else}
          <div class="no-image">No image</div>
        {/if}
      </div>
      <div class="sbs-panel">
        <div class="sbs-label">After</div>
        {#if newImage}
          <div class="sbs-image-wrapper">
            <img src={newImage} alt="After" class="diff-image" />
            {#if newImageInfo}
              <div class="image-info">W: {newImageInfo.width}px | H: {newImageInfo.height}px ({formatBytes(newImageInfo.bytes)})</div>
            {/if}
          </div>
        {:else}
          <div class="no-image">No image</div>
        {/if}
      </div>
    </div>
  {:else if mode === 'swipe'}
    <div class="swipe-wrapper">
      <div class="swipe-inner">
        <div class="swipe-labels">
          <span class="swipe-label-text">Before</span>
          <span class="swipe-label-text">After</span>
        </div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="swipe-container" bind:this={swipeContainerEl}>
          {#if newImage}
            <img src={newImage} alt="After" class="swipe-image swipe-new" />
          {/if}
          <div class="swipe-old-clip" style="clip-path: inset(0 {100 - swipePosition}% 0 0);">
            {#if oldImage}
              <img src={oldImage} alt="Before" class="swipe-image" />
            {/if}
          </div>
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="swipe-divider"
            style="left: {swipePosition}%;"
            onmousedown={handleSwipeStart}
            role="separator"
          >
            <div class="swipe-handle"></div>
          </div>
        </div>
      </div>
    </div>
  {:else}
    <div class="onion-container">
      <div class="onion-controls">
        <span class="onion-label">Before</span>
        <input type="range" min="0" max="1" step="0.01" bind:value={onionOpacity} />
        <span class="onion-label">After</span>
      </div>
      <div class="onion-images">
        {#if oldImage}
          <img src={oldImage} alt="Before" class="onion-image" />
        {/if}
        {#if newImage}
          <img src={newImage} alt="After" class="onion-image onion-overlay" style="opacity: {onionOpacity};" />
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .image-diff {
    padding: 8px;
  }

  .image-diff-toolbar {
    display: flex;
    gap: 2px;
    margin-bottom: 16px;
    background: rgba(128, 128, 128, 0.15);
    border-radius: 4px;
    padding: 2px;
    width: fit-content;
  }

  .image-diff-toolbar button {
    padding: 3px 10px;
    font-size: 11px;
    border-radius: 3px;
    background: transparent;
    color: var(--text-secondary);
  }

  .image-diff-toolbar button.active {
    background: var(--button-bg);
    color: var(--button-fg);
  }

  .sbs-container {
    display: flex;
    gap: 8px;
  }

  .sbs-panel {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .sbs-image-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    max-width: 100%;
  }

  .sbs-label {
    font-size: 11px;
    color: var(--text-secondary);
    margin-bottom: 4px;
    font-weight: 600;
  }

  .image-info {
    margin-top: 4px;
    padding: 3px 8px;
    font-size: 11px;
    color: var(--text-secondary);
    background: rgba(128, 128, 128, 0.15);
    border-radius: 3px;
  }

  .diff-image {
    max-width: 100%;
    max-height: 400px;
    object-fit: contain;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: repeating-conic-gradient(#808080 0% 25%, transparent 0% 50%) 50% / 16px 16px;
  }

  .no-image {
    padding: 40px;
    color: var(--text-secondary);
    font-size: 12px;
    border: 1px dashed var(--border-color);
    border-radius: 4px;
  }

  .swipe-wrapper {
    display: flex;
    justify-content: center;
  }

  .swipe-inner {
    display: inline-flex;
    flex-direction: column;
    max-width: 100%;
  }

  .swipe-container {
    position: relative;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: repeating-conic-gradient(#808080 0% 25%, transparent 0% 50%) 50% / 16px 16px;
    cursor: ew-resize;
    user-select: none;
  }

  .swipe-image {
    display: block;
  }

  .swipe-new {
    max-width: 100%;
    max-height: 400px;
  }

  .swipe-old-clip {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .swipe-old-clip .swipe-image {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .swipe-labels {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .swipe-label-text {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .swipe-divider {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--vscode-focusBorder, #007fd4);
    cursor: ew-resize;
    z-index: 10;
    transform: translateX(-50%);
  }

  .swipe-handle {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--vscode-focusBorder, #007fd4);
    border: 2px solid white;
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  }

  .onion-container {
    text-align: center;
  }

  .onion-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: center;
    margin-bottom: 8px;
  }

  .onion-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .onion-controls input[type="range"] {
    width: 150px;
  }

  .onion-images {
    position: relative;
    display: inline-block;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    overflow: hidden;
    background: repeating-conic-gradient(#808080 0% 25%, transparent 0% 50%) 50% / 16px 16px;
  }

  .onion-image {
    display: block;
    max-width: 100%;
    max-height: 400px;
    object-fit: contain;
  }

  .onion-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>
