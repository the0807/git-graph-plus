<script lang="ts">
  import type { DiffData } from '../../lib/types';
  import { onMount } from 'svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import {
    detectLanguage,
    highlightLineSync,
    highlightCodeLinesSync,
    getHighlighter,
    ensureLanguage,
    activeShikiTheme,
    escapeHtml,
  } from '../../lib/utils/highlighter';
  import ImageDiff from '../common/ImageDiff.svelte';

  // Right-click target on a diff line. The parent owns the context menu (it
  // already hosts one for the file tree), so we just hand it the location plus
  // enough to address the change: the hunk index lines up with the diff the
  // backend re-parses (see patch-builder / git-parser), where omitting line
  // indices reverses the whole hunk.
  export interface ReverseTarget {
    commitHash: string;
    file: string;
    hunkIndex: number;
    // The changed (+/-) line indices the user selected via the gutter drag,
    // addressing a subset of the hunk to reverse. Omitted reverses the whole hunk.
    selectedLineIndices?: number[];
    selectionText: string;
    // Raw newline-joined text of every gutter-selected line, set only when the
    // right-click originates in the gutter and a line selection is active. The
    // parent offers a "Copy Lines" menu item when present. An empty string is a
    // valid value (a lone blank line was selected), so the parent gates on
    // `!== undefined`, not truthiness. `copyLinesCount` carries the matching
    // line count so the parent need not re-split the text.
    copyLinesText?: string;
    copyLinesCount?: number;
    x: number;
    y: number;
  }

  interface Props {
    diff: DiffData;
    commitHash?: string;
    // Only meaningful for the UNCOMMITTED view: whether the selected file is in
    // the staged (index) tab. Drives the image diff's before/after refs.
    staged?: boolean;
    stacked?: boolean;
    // Optional commit label shown in the toolbar (used by stacked per-commit sections).
    heading?: string;
    // When provided (committed view only), right-clicking a diff line offers to
    // reverse that whole hunk against the working tree.
    onReverse?: (target: ReverseTarget) => void;
    // When provided (committed view only), the per-hunk header "Reverse Hunk"
    // button reverses that hunk immediately (no context menu).
    onReverseHunk?: (target: { commitHash: string; file: string; hunkIndex: number }) => void;
    // When provided (committed view only), the "Reverse Selected Lines" button
    // reverses just the dragged changed lines of a hunk immediately.
    onReverseLines?: (target: { commitHash: string; file: string; hunkIndex: number; lineIndices: number[] }) => void;
  }

  let { diff, commitHash, staged = false, stacked = false, heading, onReverse, onReverseHunk, onReverseLines }: Props = $props();

  // Whether this diff supports reversing (committed view). Drives both the
  // right-click menu and the per-hunk header reverse affordance. Whole-file
  // additions/deletions reverse too: reversing every line of an added file's
  // hunk removes it, and of a deleted file's hunk restores it (the backend's
  // patch-builder rewrites the whole-file header for partial selections).
  const canReverse = $derived(!!onReverse && !!commitHash);

  // A truncated diff renders only the first N lines of its final hunk (see
  // renderHunks). Reversing then would silently undo the unseen tail too, so we
  // only allow reverse on hunks rendered in full. Untruncated diffs are always
  // complete (renderHunks === diff.hunks).
  function isHunkComplete(hunkIndex: number): boolean {
    const full = diff.hunks[hunkIndex];
    const shown = renderHunks[hunkIndex];
    return !!full && !!shown && shown.lines.length === full.lines.length;
  }

  // Drag-to-select whole lines in the inline gutter (single hunk at a time).
  // `indices` holds every line index the drag has covered; the right-click menu
  // then narrows it to just the changed (+/-) lines via selectedChangedIndices.
  let lineSel = $state<{ hunkIdx: number; anchor: number; indices: Set<number> } | null>(null);
  // Plain (non-reactive) flag tracking whether a gutter drag is in progress.
  let dragging = false;

  // SBS: the hunk currently under the cursor (in either pane), highlighted in
  // both panes so the reverse extent is obvious before right-clicking.
  let hoveredHunkIdx = $state<number | null>(null);

  // All indices from min(a,b)..max(a,b) inclusive.
  function rangeSet(a: number, b: number): Set<number> {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const out = new Set<number>();
    for (let i = lo; i <= hi; i++) out.add(i);
    return out;
  }

  // The selected line indices that are actually reversible (+/- lines), sorted.
  // Context lines in the dragged range are dropped. Pure projection of lineSel +
  // diff.hunks, so it's derived rather than recomputed on every template access.
  const selectedChangedIndices = $derived.by<number[]>(() => {
    if (!lineSel) return [];
    const hunk = diff.hunks[lineSel.hunkIdx];
    if (!hunk) return [];
    return [...lineSel.indices]
      .filter(i => hunk.lines[i] && hunk.lines[i].type !== 'context')
      .sort((a, b) => a - b);
  });

  // The full text of every currently selected line (context included), in line
  // order, joined by newlines — for the "Copy Lines" gutter action.
  function selectedLinesText(): string {
    if (!lineSel) return '';
    const hunk = diff.hunks[lineSel.hunkIdx];
    if (!hunk) return '';
    return [...lineSel.indices]
      .sort((a, b) => a - b)
      .map(i => hunk.lines[i]?.content ?? '')
      .join('\n');
  }

  function startLineSelect(e: MouseEvent, hunkIdx: number, lineIndex: number) {
    if (e.button !== 0) return; // right/middle-click must not reset an active selection
    if (!canReverse || !isHunkComplete(hunkIdx)) return;
    e.preventDefault(); // suppress native text-selection beginning in the gutter
    if (e.shiftKey && lineSel && lineSel.hunkIdx === hunkIdx) {
      lineSel = { ...lineSel, indices: rangeSet(lineSel.anchor, lineIndex) };
      return;
    }
    // Plain click on a line already in the selection → deselect.
    if (lineSel && lineSel.hunkIdx === hunkIdx && lineSel.indices.has(lineIndex)) {
      lineSel = null;
      return;
    }
    lineSel = { hunkIdx, anchor: lineIndex, indices: rangeSet(lineIndex, lineIndex) };
    dragging = true;
    window.addEventListener('mouseup', () => { dragging = false; }, { once: true });
  }

  function extendLineSelect(_e: MouseEvent, hunkIdx: number, lineIndex: number) {
    if (dragging && lineSel && lineSel.hunkIdx === hunkIdx) {
      lineSel = { ...lineSel, indices: rangeSet(lineSel.anchor, lineIndex) };
    }
  }

  function handleLineContextMenu(e: MouseEvent, hunkIndex: number, lineIndex = -1) {
    if (!onReverse || !commitHash) return;                 // not reversible → native menu
    const changed = selectedChangedIndices;
    // Only offer "Reverse Selected Lines" when the right-click lands on a line
    // that is part of the active selection; otherwise fall back to whole-hunk.
    const inSelection = !!lineSel && lineSel.hunkIdx === hunkIndex && lineSel.indices.has(lineIndex) && changed.length > 0;
    const sel = inSelection ? { hunkIdx: lineSel!.hunkIdx, indices: changed } : null;
    const targetHunk = sel ? sel.hunkIdx : hunkIndex;
    if (!isHunkComplete(targetHunk)) return;              // truncated hunk → don't reverse unseen lines
    e.preventDefault();
    const selectionText = window.getSelection()?.toString() ?? '';
    // Right-clicking the gutter while lines are selected → offer "Copy Lines".
    // Restricted to the SAME hunk that holds the selection so the menu never
    // mixes one hunk's "Copy Lines" with another hunk's "Reverse Hunk".
    const inGutter = !!(e.target as HTMLElement).closest('.line-gutter');
    const hasCopyLines = inGutter && !!lineSel && lineSel.hunkIdx === hunkIndex && lineSel.indices.size > 0;
    onReverse({
      commitHash,
      file: diff.file,
      hunkIndex: targetHunk,
      selectedLineIndices: sel ? sel.indices : undefined,
      selectionText,
      copyLinesText: hasCopyLines ? selectedLinesText() : undefined,
      copyLinesCount: hasCopyLines ? lineSel!.indices.size : undefined,
      x: e.clientX,
      y: e.clientY,
    });
  }

  function reverseHunk(hunkIndex: number) {
    if (!onReverseHunk || !commitHash || !isHunkComplete(hunkIndex)) return;
    onReverseHunk({ commitHash, file: diff.file, hunkIndex });
  }

  function reverseSelectedLines() {
    if (!onReverseLines || !commitHash || !lineSel) return;
    const indices = selectedChangedIndices;
    if (!indices.length || !isHunkComplete(lineSel.hunkIdx)) return;
    onReverseLines({ commitHash, file: diff.file, hunkIndex: lineSel.hunkIdx, lineIndices: indices });
  }

  // Friendly hunk header label, e.g. "Hunk 1: Lines 1-5". Uses the new-side range
  // (what the file looks like after the change); falls back to the old side for
  // pure-deletion hunks where the new side is empty.
  function hunkLabel(hunk: DiffData['hunks'][number], hunkIdx: number): string {
    const useNew = hunk.newLines > 0;
    const start = useNew ? hunk.newStart : hunk.oldStart;
    const count = useNew ? hunk.newLines : hunk.oldLines;
    const end = start + Math.max(count, 1) - 1;
    const range = end > start ? `${start}-${end}` : `${start}`;
    return `Hunk ${hunkIdx + 1}: ${t('file.lines')} ${range}`;
  }

  function getFileName(path: string): string {
    return path.split('/').pop() ?? path;
  }

  // Syntax highlighting
  let highlightedLines = $state<Map<string, string>>(new Map());
  let sbsLeftEl = $state<HTMLElement | undefined>();
  let sbsRightEl = $state<HTMLElement | undefined>();
  let isSyncing = false;

  function handleSbsScroll(e: Event) {
    if (isSyncing) return;
    const target = e.target as HTMLElement;
    const other = target === sbsLeftEl ? sbsRightEl : sbsLeftEl;
    if (other) {
      isSyncing = true;
      other.scrollTop = target.scrollTop;
      other.scrollLeft = target.scrollLeft;
      requestAnimationFrame(() => { isSyncing = false; });
    }
  }

  // Cap how many diff lines we render to the DOM at once. A very large diff
  // (lockfiles, generated files, mass deletions) would otherwise create tens of
  // thousands of nodes on open and freeze the panel. Past the cap we render the
  // first N lines and offer a "show full diff" button — same opt-in philosophy
  // as MAX_HIGHLIGHT_LINES. Side-by-side roughly doubles the node count, so the
  // cap is deliberately below the highlight cap.
  const MAX_RENDER_LINES = 3000;
  let showFullDiff = $state(false);

  // Reset the toggle whenever the diff prop changes, so opening a new large
  // diff starts collapsed even if the previous one was expanded.
  $effect(() => {
    diff;
    showFullDiff = false;
    lineSel = null;
  });

  let diffMode = $state<'inline' | 'side-by-side'>('inline');

  let totalDiffLines = $derived(
    diff && !diff.isBinary
      ? diff.hunks.reduce((s, h) => s + h.lines.length, 0)
      : 0
  );
  let diffTruncated = $derived(!showFullDiff && totalDiffLines > MAX_RENDER_LINES);

  // Hunks actually handed to the template. When truncated, include whole hunks
  // until the line budget runs out, slicing the final partial hunk. The sliced
  // hunk keeps its original `oldStart` and the first-N line indices, so the
  // highlight-cache keys (`${oldStart}-${lineIndex}`) still line up.
  let renderHunks = $derived.by(() => {
    if (!diff || diff.isBinary) return [];
    if (!diffTruncated) return diff.hunks;
    const out: typeof diff.hunks = [];
    let budget = MAX_RENDER_LINES;
    for (const hunk of diff.hunks) {
      if (budget <= 0) break;
      if (hunk.lines.length <= budget) {
        out.push(hunk);
        budget -= hunk.lines.length;
      } else {
        out.push({ ...hunk, lines: hunk.lines.slice(0, budget) });
        budget = 0;
      }
    }
    return out;
  });

  const MAX_HIGHLIGHT_LINES = 5000;
  const MAX_FULL_FILE_HIGHLIGHT_LINES = 8000;

  // Tracks the VS Code color theme so highlighting re-runs (with the matching
  // light/dark token colours) when the user switches themes mid-session.
  let shikiTheme = $state<'dark-plus' | 'light-plus'>(activeShikiTheme());
  onMount(() => {
    const observer = new MutationObserver(() => { shikiTheme = activeShikiTheme(); });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  });

  // Escape clears any active gutter line-selection.
  onMount(() => {
    const onKeydown = (e: KeyboardEvent) => { if (e.key === 'Escape') lineSel = null; };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });

  $effect(() => {
    if (!diff || diff.isBinary) return;
    const newLang = detectLanguage(diff.content?.newPath ?? diff.newFile ?? diff.file);
    const oldLang = detectLanguage(diff.content?.oldPath ?? diff.oldFile ?? diff.file);
    if (!newLang && !oldLang) {
      highlightedLines = new Map();
      return;
    }
    const totalLines = diff.hunks.reduce((s, h) => s + h.lines.length, 0);
    if (totalLines > MAX_HIGHLIGHT_LINES) {
      highlightedLines = new Map();
      return;
    }
    const target = diff;
    // Only highlight what's actually rendered (renderHunks is capped at
    // MAX_RENDER_LINES); the tail beyond that was being tokenized but never
    // shown. Toggling showFullDiff changes renderHunks and re-runs this effect,
    // so the revealed lines get highlighted then.
    const visibleHunks = renderHunks;
    const mode = diffMode;
    const needsOldSide = needsHighlightedSide(visibleHunks, 'old', mode);
    const needsNewSide = needsHighlightedSide(visibleHunks, 'new', mode);
    const theme = shikiTheme; // capture so a theme switch invalidates the pass
    // Yield to the event loop between chunks so a multi-thousand-line diff
    // doesn't freeze the panel. Each batch processes CHUNK_SIZE lines then
    // hands control back via a microtask.
    const CHUNK_SIZE = 250;
    let cancelled = false;
    getHighlighter()
      .then(async h => {
        if (cancelled || diff !== target) return;
        if (target.content) {
          const oldLines = countSourceLines(target.content.oldText);
          const newLines = countSourceLines(target.content.newText);
          const linesToHighlight = (needsOldSide ? oldLines : 0) + (needsNewSide ? newLines : 0);
          if (linesToHighlight <= MAX_FULL_FILE_HIGHLIGHT_LINES) {
            const [oldReady, newReady] = await Promise.all([
              needsOldSide && oldLang ? ensureLanguage(h, oldLang) : Promise.resolve(false),
              needsNewSide && newLang ? ensureLanguage(h, newLang) : Promise.resolve(false),
            ]);
            if (cancelled || diff !== target) return;
            const newMap = new Map<string, string>();
            if (needsOldSide && oldReady) {
              highlightCodeLinesSync(h, target.content.oldText, oldLang, theme)
                .forEach((html, idx) => newMap.set(`old:${idx + 1}`, html));
            }
            if (needsNewSide && newReady) {
              highlightCodeLinesSync(h, target.content.newText, newLang, theme)
                .forEach((html, idx) => newMap.set(`new:${idx + 1}`, html));
            }
            highlightedLines = newMap;
            return;
          }
        }
        const lang = newLang || oldLang;
        // Grammars load on demand; bail out to plain escaping if this language
        // has no Shiki grammar (highlightLineSync would fall back anyway, but
        // skipping the loop avoids a pointless full pass over the diff).
        const ready = await ensureLanguage(h, lang);
        if (cancelled || diff !== target) return;
        if (!ready) { highlightedLines = new Map(); return; }
        const newMap = new Map<string, string>();
        const flat: Array<{ key: string; content: string }> = [];
        for (const hunk of visibleHunks) {
          for (let i = 0; i < hunk.lines.length; i++) {
            flat.push({ key: `${hunk.oldStart}-${i}`, content: hunk.lines[i].content });
          }
        }
        for (let i = 0; i < flat.length; i += CHUNK_SIZE) {
          if (cancelled || diff !== target) return;
          const end = Math.min(i + CHUNK_SIZE, flat.length);
          for (let j = i; j < end; j++) {
            newMap.set(flat[j].key, highlightLineSync(h, flat[j].content, lang, theme));
          }
          // Defer to next microtask so user interaction (scroll, switch file)
          // can interrupt mid-highlight without paying for the whole pass.
          if (end < flat.length) {
            await new Promise<void>(resolve => queueMicrotask(resolve));
          }
        }
        if (cancelled || diff !== target) return;
        highlightedLines = newMap;
      })
      .catch(() => {});
    return () => { cancelled = true; };
  });

  function needsHighlightedSide(
    hunks: DiffData['hunks'],
    side: 'old' | 'new',
    mode: 'inline' | 'side-by-side',
  ): boolean {
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (side === 'old') {
          if (line.type === 'delete') return true;
          if (mode === 'side-by-side' && line.type === 'context') return true;
        } else if (line.type === 'add' || line.type === 'context') {
          return true;
        }
      }
    }
    return false;
  }

  function countSourceLines(text: string): number {
    if (!text) return 0;
    const lines = text.split(/\r\n|\r|\n/);
    return /(?:\r\n|\r|\n)$/.test(text) ? lines.length - 1 : lines.length;
  }

  function getHighlighted(
    hunkStart: number,
    lineIdx: number,
    content: string,
    line?: DiffData['hunks'][number]['lines'][number],
    sideHint: 'old' | 'new' = 'new',
  ): string {
    if (line && diff.content) {
      const side = line.type === 'delete' ? 'old' : line.type === 'add' ? 'new' : sideHint;
      const lineNumber = side === 'old' ? line.oldLineNumber : line.newLineNumber;
      if (lineNumber !== undefined) {
        return highlightedLines.get(`${side}:${lineNumber}`) ?? escapeHtml(content);
      }
    }
    const key = `${hunkStart}-${lineIdx}`;
    return highlightedLines.get(key) ?? escapeHtml(content);
  }
</script>

<div class="diff-wrapper" class:stacked>
  <div class="diff-toolbar">
    {#if heading}<div class="diff-commit-label" title={heading}>{heading}</div>{/if}
    <div class="diff-toolbar-row">
      <span class="diff-file-name" title={diff.file}>
        {#if diff.file.includes('/')}
          <span class="diff-dir">{diff.file.substring(0, diff.file.lastIndexOf('/') + 1)}</span>
        {/if}
        <span class="diff-base">{getFileName(diff.file)}</span>
      </span>
      <div class="diff-mode-toggle">
        <button
          class:active={diffMode === 'inline'}
          onclick={() => { diffMode = 'inline'; lineSel = null; }}
        >{t('details.inline')}</button>
        <button
          class:active={diffMode === 'side-by-side'}
          onclick={() => { diffMode = 'side-by-side'; lineSel = null; }}
        >{t('details.sideBySide')}</button>
      </div>
    </div>
  </div>

  <div class="diff-panel">
    {#if diffTruncated}
      <div class="diff-truncated-banner">
        <span>{t('details.diffTruncated', { shown: MAX_RENDER_LINES, total: totalDiffLines })}</span>
        <button onclick={() => { showFullDiff = true; }}>{t('details.showFullDiff')}</button>
      </div>
    {/if}
    {#if diff.isBinary && diff.isImage}
      {#if commitHash && commitHash !== 'UNCOMMITTED'}
        <ImageDiff file={diff.file} staged={false} commitHash={commitHash} />
      {:else}
        <!-- UNCOMMITTED: no real commit to diff against; compare index/working
             trees based on which tab (staged vs unstaged) the file is in. -->
        <ImageDiff file={diff.file} {staged} />
      {/if}
    {:else if diff.isBinary}
      <div class="diff-empty">{t('details.binaryFile')}</div>
    {:else if diffMode === 'inline'}
      <div class="diff-content">
        {#each renderHunks as hunk, hunkIdx}
          <div class="diff-hunk" class:reversible={canReverse && isHunkComplete(hunkIdx)} class:has-selection={lineSel?.hunkIdx === hunkIdx && selectedChangedIndices.length > 0}>
            <div class="diff-hunk-header">
              <div class="hunk-header-inner">
                <span class="diff-hunk-range" title={hunkLabel(hunk, hunkIdx)}>{hunkLabel(hunk, hunkIdx)}</span>
                {#if canReverse && isHunkComplete(hunkIdx)}
                  {#if lineSel?.hunkIdx === hunkIdx && selectedChangedIndices.length > 0}
                    <button class="hunk-action-btn hunk-lines-btn" onclick={reverseSelectedLines}
                            aria-label={t('file.reverseLines')} title={t('file.reverseLines')}>
                      <i class="codicon codicon-discard"></i>
                      <span>{t('file.reverseLines')} ({selectedChangedIndices.length})</span>
                    </button>
                  {/if}
                  <button class="hunk-action-btn hunk-hunk-btn" onclick={() => reverseHunk(hunkIdx)}
                          aria-label={t('file.reverseHunk')} title={t('file.reverseHunk')}>
                    <i class="codicon codicon-discard"></i>
                    <span>{t('file.reverseHunk')}</span>
                  </button>
                {/if}
              </div>
            </div>
            {#each hunk.lines as line, lineIndex}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="diff-line diff-{line.type}" class:line-selected={lineSel?.hunkIdx === hunkIdx && lineSel.indices.has(lineIndex)} oncontextmenu={(e) => handleLineContextMenu(e, hunkIdx, lineIndex)}>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                  class="line-gutter"
                  onmousedown={(e) => startLineSelect(e, hunkIdx, lineIndex)}
                  onmouseenter={(e) => extendLineSelect(e, hunkIdx, lineIndex)}
                >
                  <span class="line-num old">{line.oldLineNumber ?? ''}</span>
                  <span class="line-num new">{line.newLineNumber ?? ''}</span>
                  <span class="line-prefix">{line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '}</span>
                </span>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span class="line-content" onmousedown={(e) => { if (e.button === 0) lineSel = null; }}>{@html getHighlighted(hunk.oldStart, lineIndex, line.content, line, line.type === 'delete' ? 'old' : 'new')}</span>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {:else}
      <!-- SBS keeps right-click → Reverse Hunk parity via the per-hunk wrapper
           handler (so right-clicking any line, context line, or empty placeholder
           row offers Reverse Hunk). Hovering a hunk in either pane highlights it
           in both (no header bar): both panes write the shared hoveredHunkIdx. -->
      <div class="diff-sbs">
        <div class="sbs-pane sbs-left" bind:this={sbsLeftEl} onscroll={handleSbsScroll}>
          <div class="sbs-inner">
            {#each renderHunks as hunk, hunkIdx}
              {#if hunkIdx > 0}<div class="hunk-separator" aria-hidden="true"></div>{/if}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="sbs-hunk"
                class:hunk-hover={canReverse && isHunkComplete(hunkIdx) && hoveredHunkIdx === hunkIdx}
                onmouseenter={() => { hoveredHunkIdx = hunkIdx; }}
                onmouseleave={() => { if (hoveredHunkIdx === hunkIdx) hoveredHunkIdx = null; }}
                oncontextmenu={(e) => handleLineContextMenu(e, hunkIdx)}
              >
                {#each hunk.lines as line, lineIndex}
                  {#if line.type === 'context' || line.type === 'delete'}
                    <div class="diff-line diff-{line.type}">
                      <span class="line-num">{line.oldLineNumber ?? ''}</span>
                      <span class="line-content">{@html getHighlighted(hunk.oldStart, lineIndex, line.content, line, 'old')}</span>
                    </div>
                  {:else}
                    <div class="diff-line diff-empty-line">
                      <span class="line-num"></span>
                      <span class="line-content"></span>
                    </div>
                  {/if}
                {/each}
              </div>
            {/each}
          </div>
        </div>
        <div class="sbs-pane sbs-right" bind:this={sbsRightEl} onscroll={handleSbsScroll}>
          <div class="sbs-inner">
            {#each renderHunks as hunk, hunkIdx}
              {#if hunkIdx > 0}<div class="hunk-separator" aria-hidden="true"></div>{/if}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="sbs-hunk"
                class:hunk-hover={canReverse && isHunkComplete(hunkIdx) && hoveredHunkIdx === hunkIdx}
                onmouseenter={() => { hoveredHunkIdx = hunkIdx; }}
                onmouseleave={() => { if (hoveredHunkIdx === hunkIdx) hoveredHunkIdx = null; }}
                oncontextmenu={(e) => handleLineContextMenu(e, hunkIdx)}
              >
                {#each hunk.lines as line, lineIndex}
                  {#if line.type === 'context' || line.type === 'add'}
                    <div class="diff-line diff-{line.type}">
                      <span class="line-num">{line.newLineNumber ?? ''}</span>
                      <span class="line-content">{@html getHighlighted(hunk.oldStart, lineIndex, line.content, line, 'new')}</span>
                    </div>
                  {:else}
                    <div class="diff-line diff-empty-line">
                      <span class="line-num"></span>
                      <span class="line-content"></span>
                    </div>
                  {/if}
                {/each}
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  /* ── Diff panel ── */
  .diff-wrapper {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 12px);
  }

  .diff-panel {
    flex: 1;
    overflow: auto;
  }

  .diff-toolbar {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 4px 12px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
    z-index: 5;
  }

  .diff-toolbar-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .diff-file-name {
    font-size: var(--vscode-font-size, 13px);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    display: flex;
    align-items: baseline;
    gap: 0;
  }

  .diff-dir {
    flex-shrink: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.55;
    font-weight: normal;
  }

  .diff-base {
    flex-shrink: 0;
    font-weight: 600;
  }

  .diff-mode-toggle {
    display: flex;
    gap: 2px;
    background: rgba(128, 128, 128, 0.15);
    border-radius: 3px;
    padding: 1px;
  }

  .diff-mode-toggle button {
    padding: 2px 8px;
    font-size: 0.75em;
    border-radius: 2px;
    background: transparent;
    color: var(--text-secondary);
  }

  .diff-mode-toggle button.active {
    background: var(--button-bg);
    color: var(--button-fg);
  }

  .diff-content {
    padding: 0;
    display: flex;
    flex-direction: column;
    min-width: 100%;
    width: max-content;
  }

  /* Each hunk is a grouping container so it can carry a header bar and show a
     hover highlight outlining exactly what "Reverse Hunk" will affect. */
  .diff-hunk {
    position: relative;
    border-top: 1px solid var(--border-color);
  }

  .diff-hunk-header {
    padding: 2px 8px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: 0.85em;
    border-bottom: 1px solid var(--border-color);
  }

  /* inline-flex (content width, not the hunk's full max-content width) so the
     label + buttons cluster at the left and the buttons sit right after the
     label instead of being pushed to the far-right edge. sticky left:0 keeps
     them pinned to the viewport's left so they stay reachable when the diff is
     scrolled horizontally. */
  .hunk-header-inner {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    position: sticky;
    left: 0;
  }

  /* No flex-grow: the label takes only its own width so it can't push the
     buttons right. It may still shrink/ellipsize if the panel is very narrow. */
  .diff-hunk-range {
    font-family: var(--vscode-editor-font-family, monospace);
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .hunk-action-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    white-space: nowrap;
    padding: 1px 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 0.95em;
    color: var(--vscode-errorForeground, #f44336);
    transition: opacity 0.1s, background 0.1s;
  }

  /* The Reverse HUNK button is a hover/focus affordance; the Reverse LINES button
     is explicit (only renders when a selection exists), so it's always visible. */
  .hunk-hunk-btn {
    opacity: 0;
    transition: opacity 0.1s;
  }

  .hunk-lines-btn {
    opacity: 1;
  }

  .diff-hunk.reversible:hover .hunk-hunk-btn,
  .diff-hunk.has-selection .hunk-hunk-btn,
  .hunk-action-btn:focus {
    opacity: 1;
  }

  .hunk-action-btn:hover {
    background: color-mix(in srgb, var(--vscode-inputValidation-errorBackground, #f44336) 25%, transparent);
  }

  .hunk-action-btn i {
    font-size: 1em;
  }

  /* Outline the whole hunk on hover so the reverse extent is obvious. Inline only
     when reversible (compare/uncommitted diffs get no misleading hint); SBS
     outlines the hovered hunk in both panes (.sbs-hunk.hunk-hover below). */
  .diff-hunk.reversible:hover,
  .sbs-hunk.hunk-hover {
    outline: 1px solid var(--vscode-focusBorder, rgba(120, 120, 255, 0.4));
    outline-offset: -1px;
  }

  /* SBS mode still uses a plain dashed separator between hunks (no header bar). */
  .hunk-separator {
    height: 0;
    border-top: 1px dashed var(--border-color);
    margin: 6px 0;
    opacity: 0.6;
    width: 100%;
  }

  .diff-line {
    display: flex;
    min-height: 20px;
    line-height: 20px;
  }

  .diff-add { background: var(--vscode-diffEditor-insertedLineBackground, rgba(72, 191, 145, 0.15)); }
  .diff-delete { background: var(--vscode-diffEditor-removedLineBackground, rgba(255, 0, 0, 0.15)); }
  .diff-empty-line { background: rgba(128, 128, 128, 0.05); }

  /* Inline gutter (line numbers + prefix) is the drag handle for line-selection.
     Suppress native text selection here so dragging selects whole lines instead. */
  .line-gutter {
    display: flex;
    flex-shrink: 0;
    user-select: none;
    cursor: pointer;
  }

  /* Selected lines get a clear accent that reads over the add/delete tints. */
  .diff-line.line-selected {
    background: var(--vscode-editor-selectionBackground, rgba(120, 150, 255, 0.25));
    box-shadow: inset 3px 0 0 var(--vscode-focusBorder, #4a9eff);
  }

  .line-num {
    width: 45px;
    flex-shrink: 0;
    text-align: right;
    padding-right: 8px;
    color: var(--text-secondary);
    opacity: 0.5;
    font-size: 0.9em;
    user-select: none;
  }

  .line-prefix {
    width: 14px;
    flex-shrink: 0;
    text-align: center;
    user-select: none;
  }

  .diff-add .line-prefix { color: #4caf50; }
  .diff-delete .line-prefix { color: #f44336; }

  :global(body.vscode-light) .diff-add .line-prefix { color: #2e7d32; }
  :global(body.vscode-light) .diff-delete .line-prefix { color: #b71c1c; }

  .line-content {
    white-space: pre;
    padding-left: 4px;
    padding-right: 24px;
  }

  .diff-empty {
    padding: 20px;
    text-align: center;
    color: var(--text-secondary);
  }

  .diff-truncated-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--text-secondary);
    background: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.08));
    border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(128, 128, 128, 0.2));
  }

  .diff-truncated-banner button {
    flex-shrink: 0;
    padding: 2px 10px;
    cursor: pointer;
    color: var(--vscode-button-foreground, #fff);
    background: var(--vscode-button-background, #0e639c);
    border: none;
    border-radius: 2px;
    font-size: 12px;
  }

  .diff-truncated-banner button:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }

  /* Side-by-side */
  .diff-sbs {
    display: flex;
    height: 100%;
    width: 100%;
  }

  .sbs-pane {
    flex: 1;
    min-width: 0;
    overflow: auto;
    background: var(--bg-primary);
  }

  .sbs-inner {
    display: flex;
    flex-direction: column;
    min-width: 100%;
    width: max-content;
    min-height: 100%;
  }

  .sbs-left {
    border-right: 1px solid var(--border-color);
  }

  .sbs-pane .diff-line {
    width: 100%;
  }

  /* ── Stacked mode (multiple FileDiffViews in a scrolling column) ── */
  /* The outer .sections-pane owns the scroll; each FileDiffView must grow to  */
  /* its full content height rather than filling/clipping inside a flex child. */
  .diff-wrapper.stacked {
    flex: none;
    overflow: visible;
  }

  .diff-wrapper.stacked .diff-panel {
    overflow: visible;
    max-height: none;
  }

  /* In SBS mode, .diff-sbs uses height:100% which resolves to 0 when the     */
  /* parent has no fixed height. Switch to auto so both panes size to content. */
  .diff-wrapper.stacked .diff-sbs {
    height: auto;
  }

  /* The toolbar (commit label + file name) sticks to the top while scrolling  */
  /* through this section's diff. Constrained to the section's own wrapper, so */
  /* the next section's toolbar takes over instead of piling up at the top.    */
  .diff-wrapper.stacked .diff-toolbar {
    position: sticky;
    top: 0;
  }

  .diff-commit-label {
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--text-secondary);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
