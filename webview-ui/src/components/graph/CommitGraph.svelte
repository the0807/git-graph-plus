<script lang="ts">
  import { commitStore } from '../../lib/stores/commits.svelte';
  import { branchStore } from '../../lib/stores/branches.svelte';
  import { uiStore } from '../../lib/stores/ui.svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { t } from '../../lib/i18n/index.svelte';
  import { getGravatarUrl } from '../../lib/utils/gravatar';
  import ContextMenu from '../common/ContextMenu.svelte';
  import InteractiveRebase from '../rebase/InteractiveRebase.svelte';
  import Modal from '../common/Modal.svelte';
  import ColorSelect from '../common/ColorSelect.svelte';
  import type { Commit, CommitGraphData } from '../../lib/types';

  const COLOR_PALETTE = [
    '#63b0f4', '#73d13d', '#ff7a45', '#b37feb',
    '#f759ab', '#36cfc9', '#ffc53d', '#ff4d4f',
    '#597ef7', '#9254de', '#43e8d8', '#faad14',
  ];

  /**
   * Build SVG path `d` string from SourceGit Path points.
   * Exactly mirrors SourceGit's DrawCurves rendering.
   */
  function buildPathD(points: Array<{ x: number; y: number }>): string {
    if (points.length < 2) return '';

    const parts: string[] = [];
    let last = { x: laneX(points[0].x), y: points[0].y * ROW_HEIGHT };
    parts.push(`M ${last.x} ${last.y}`);

    for (let i = 1; i < points.length; i++) {
      const cur = { x: laneX(points[i].x), y: points[i].y * ROW_HEIGHT };

      if (cur.x > last.x) {
        // Going right: QuadraticBezier with control at (cur.x, last.y)
        parts.push(`Q ${cur.x} ${last.y}, ${cur.x} ${cur.y}`);
      } else if (cur.x < last.x) {
        if (i < points.length - 1) {
          // Middle: CubicBezier S-curve
          const midY = (last.y + cur.y) / 2;
          parts.push(`C ${last.x} ${midY + 4}, ${cur.x} ${midY - 4}, ${cur.x} ${cur.y}`);
        } else {
          // Last: QuadraticBezier with control at (last.x, cur.y)
          parts.push(`Q ${last.x} ${cur.y}, ${cur.x} ${cur.y}`);
        }
      } else {
        // Same X: straight line
        parts.push(`L ${cur.x} ${cur.y}`);
      }

      last = cur;
    }

    return parts.join(' ');
  }

  interface Props {
    searchResults?: CommitGraphData | null;
  }

  let { searchResults = null }: Props = $props();

  const vscode = getVsCodeApi();

  let contextMenu = $state<{ x: number; y: number; items: any[] } | null>(null);
  let contextMenuHash = $state<string | null>(null);
  let compareBase = $state<string | null>(null);
  let interactiveRebaseBase = $state<string | null>(null);
  let showResetModal = $state(false);
  let resetTarget = $state('');
  let resetMode = $state<'soft' | 'mixed' | 'hard'>('mixed');

  // Confirmation modals
  let showMergeModal = $state(false);
  let mergeTarget = $state('');
  let mergeMode = $state<'default' | 'no-ff' | 'ff-only' | 'squash'>('default');

  let showRebaseModal = $state(false);
  let rebaseTarget = $state('');
  let rebaseAutostash = $state(false);

  let showCherryPickModal = $state(false);
  let cherryPickTarget = $state('');
  let cherryPickNoCommit = $state(false);

  let showRevertModal = $state(false);
  let revertTarget = $state('');
  let revertNoCommit = $state(false);

  let showDeleteTagModal = $state(false);
  let deleteTagName = $state('');

  let showDeleteBranchModal = $state(false);
  let deleteBranchName = $state('');
  let deleteBranchForce = $state(false);

  let showCheckoutRemoteModal = $state(false);
  let checkoutRemoteName = $state('');
  let checkoutRemoteLocalName = $state('');

  let showCheckoutCommitModal = $state(false);
  let checkoutCommitHash = $state('');

  let showCreateTagModal = $state(false);
  let createTagRef = $state('');
  let createTagSubject = $state('');
  let createTagName = $state('');
  let createTagMessage = $state('');
  let createTagPush = $state(false);

  let showCreateBranchModal = $state(false);
  let createBranchStartPoint = $state('');
  let createBranchSubject = $state('');
  let createBranchName = $state('');
  let createBranchCheckout = $state(true);

  let showPullAfterCheckoutModal = $state(false);
  let pullAfterCheckoutRef = $state('');
  let pullAfterCheckoutBehind = $state(0);

  function doCheckout(ref: string) {
    // Check if this is a local branch that is behind its remote
    const branch = branchStore.branches.find(b => !b.remote && b.name === ref);
    if (branch && branch.behind > 0) {
      pullAfterCheckoutRef = ref;
      pullAfterCheckoutBehind = branch.behind;
      showPullAfterCheckoutModal = true;
      return;
    }
    vscode.postMessage({ type: 'checkout', payload: { ref } });
  }

  function doCheckoutRemote(remoteName: string, branchName: string) {
    // Check if a local branch tracks this remote (upstream), or has the same name
    const localBranch = branchStore.branches.find(b => !b.remote && (b.upstream === remoteName || b.name === branchName));
    if (localBranch) {
      doCheckout(localBranch.name);
    } else {
      // No local branch → show create modal
      checkoutRemoteName = remoteName;
      checkoutRemoteLocalName = branchName;
      showCheckoutRemoteModal = true;
    }
  }

  let isSearchActive = $derived(searchResults !== null);

  let displayCommits = $derived(searchResults?.commits ?? commitStore.commits);
  let displayPaths = $derived(commitStore.paths);
  let displayLinks = $derived(commitStore.links);
  let displayDots = $derived(commitStore.dots);
  let displayLeftMargin = $derived(commitStore.commitLeftMargin);


  const ROW_HEIGHT = 32;
  // SourceGit uses unitWidth=12 for X coordinates, we scale them up for display
  const X_SCALE = 1.2; // multiply SourceGit X coords by this for pixel positions
  const BUFFER_ROWS = 20; // Larger buffer to keep lines visible during scroll

  let container: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  let viewportHeight = $state(600);

  let totalHeight = $derived(displayCommits.length * ROW_HEIGHT);

  let graphWidth = $derived.by(() => {
    if (displayLeftMargin.length > 0) {
      const maxMargin = Math.max(...displayLeftMargin);
      return Math.ceil(maxMargin * X_SCALE) + 4;
    }
    return 30;
  });

  let startIndex = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS));
  let endIndex = $derived(
    Math.min(
      displayCommits.length,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER_ROWS
    )
  );

  let visibleCommits = $derived(
    displayCommits.slice(startIndex, endIndex).map((commit, i) => ({
      commit,
      index: startIndex + i,
    }))
  );

  // Hash → commit lookup map
  let commitMap = $derived.by(() => {
    const map = new Map<string, typeof displayCommits[0]>();
    for (const c of displayCommits) {
      map.set(c.hash, c);
    }
    return map;
  });

  function laneX(col: number): number {
    return col * X_SCALE;
  }

  function handleScroll() {
    if (container) {
      scrollTop = container.scrollTop;
    }
  }

  function handleResize() {
    if (container) {
      viewportHeight = container.clientHeight;
    }
  }

  function selectCommit(hash: string) {
    uiStore.selectCommit(uiStore.selectedCommitHash === hash ? null : hash);
  }

  function onCommitContextMenu(e: MouseEvent, commit: Commit) {
    e.preventDefault();
    contextMenuHash = commit.hash;
    const currentBranch = branchStore.currentBranch?.name ?? 'HEAD';
    const items: any[] = [];

    // ── Ref submenus ──
    const refs = commit.refs.filter(r => {
      if (r.type === 'remote-branch' && r.name === 'HEAD') return false;
      return true;
    }).sort((a, b) => {
      const order = { head: 0, branch: 1, 'remote-branch': 2, tag: 3, stash: 4 };
      return (order[a.type] ?? 4) - (order[b.type] ?? 4);
    });

    for (const ref of refs) {
      if (ref.type === 'head' || ref.type === 'branch') {
        const branchName = ref.name;
        items.push({
          label: branchName,
          action: () => {},
          children: [
            {
              label: 'Checkout',
              action: () => doCheckout(branchName),
            },
            {
              label: t('graph.mergeInto', { branch: currentBranch }),
              action: () => { mergeTarget = branchName; mergeMode = 'default'; showMergeModal = true; },
            },
            { separator: true, label: '', action: () => {} },
            {
              label: t('graph.rename'),
              action: () => vscode.postMessage({ type: 'renameBranch', payload: { oldName: branchName, newName: '' } }),
            },
            {
              label: t('graph.deleteBranch'),
              action: () => { deleteBranchName = branchName; deleteBranchForce = false; showDeleteBranchModal = true; },
              danger: true,
            },
            { separator: true, label: '', action: () => {} },
            {
              label: t('graph.copyBranchName'),
              action: () => vscode.postMessage({ type: 'copyToClipboard', payload: { text: branchName } }),
            },
          ],
        });
      } else if (ref.type === 'remote-branch') {
        const fullName = `${ref.remote}/${ref.name}`;
        items.push({
          label: fullName,
          action: () => {},
          children: [
            {
              label: 'Checkout',
              action: () => doCheckoutRemote(fullName, ref.name),
            },
            {
              label: t('graph.mergeInto', { branch: currentBranch }),
              action: () => { mergeTarget = fullName; mergeMode = 'default'; showMergeModal = true; },
            },
            { separator: true, label: '', action: () => {} },
            {
              label: t('graph.copyBranchName'),
              action: () => vscode.postMessage({ type: 'copyToClipboard', payload: { text: fullName } }),
            },
          ],
        });
      } else if (ref.type === 'tag') {
        items.push({
          label: ref.name,
          action: () => {},
          children: [
            {
              label: 'Checkout',
              action: () => vscode.postMessage({ type: 'checkout', payload: { ref: ref.name } }),
            },
            {
              label: t('graph.deleteTag'),
              action: () => { deleteTagName = ref.name; showDeleteTagModal = true; },
              danger: true,
            },
            { separator: true, label: '', action: () => {} },
            {
              label: t('graph.copyTagName'),
              action: () => vscode.postMessage({ type: 'copyToClipboard', payload: { text: ref.name } }),
            },
          ],
        });
      } else if (ref.type === 'stash') {
        const stashEntry = branchStore.stashes.find((_s, i) => i === 0);
        items.push({
          label: `stash: ${stashEntry?.message ?? 'stash@{0}'}`,
          action: () => {},
          children: [
            {
              label: t('sidebar.apply'),
              action: () => vscode.postMessage({ type: 'stashApply', payload: { index: 0, drop: false } }),
            },
            {
              label: t('sidebar.pop'),
              action: () => vscode.postMessage({ type: 'stashApply', payload: { index: 0, drop: true } }),
            },
            { separator: true, label: '', action: () => {} },
            {
              label: t('sidebar.drop'),
              action: () => vscode.postMessage({ type: 'stashDrop', payload: { index: 0 } }),
              danger: true,
            },
          ],
        });
      }
    }

    // Separator after refs (only if there were any refs)
    if (refs.length > 0) {
      items.push({ separator: true, label: '', action: () => {} });
    }

    // ── Create actions ──
    items.push(
      {
        label: t('graph.createBranchHere'),
        action: () => { createBranchStartPoint = commit.hash; createBranchSubject = commit.subject; createBranchName = ''; createBranchCheckout = true; showCreateBranchModal = true; },
      },
      {
        label: t('graph.newTag'),
        action: () => { createTagRef = commit.hash; createTagSubject = commit.subject; createTagName = ''; createTagMessage = ''; createTagPush = false; showCreateTagModal = true; },
      },
    );

    // ── Branch operations ──
    items.push(
      { separator: true, label: '', action: () => {} },
      {
        label: t('graph.mergeInto', { branch: currentBranch }),
        action: () => { mergeTarget = commit.hash; mergeMode = 'default'; showMergeModal = true; },
      },
      {
        label: t('graph.rebaseTo', { branch: currentBranch }),
        action: () => { rebaseTarget = commit.hash; showRebaseModal = true; },
      },
      {
        label: t('graph.interactiveRebaseTo', { branch: currentBranch }),
        action: () => { interactiveRebaseBase = commit.hash; },
      },
    );

    // ── Reset ──
    items.push(
      { separator: true, label: '', action: () => {} },
      {
        label: t('graph.resetBranchToHere', { branch: currentBranch }),
        action: () => { resetTarget = commit.hash; showResetModal = true; },
      },
    );

    // ── Commit operations ──
    items.push(
      { separator: true, label: '', action: () => {} },
      {
        label: t('graph.checkoutCommit'),
        action: () => vscode.postMessage({ type: 'checkout', payload: { ref: commit.hash } }),
      },
      {
        label: t('graph.cherryPickCommit'),
        action: () => { cherryPickTarget = commit.hash; showCherryPickModal = true; },
      },
      {
        label: t('graph.revertCommit'),
        action: () => { revertTarget = commit.hash; showRevertModal = true; },
      },
      {
        label: t('graph.savePatch'),
        action: () => vscode.postMessage({ type: 'saveCommitPatch', payload: { hash: commit.hash } }),
      },
    );

    // ── Compare ──
    items.push({ separator: true, label: '', action: () => {} });
    items.push({
      label: t('graph.compareToLocal'),
      action: () => vscode.postMessage({ type: 'compareToWorking', payload: { hash: commit.hash } }),
    });

    if (compareBase) {
      items.push({
        label: t('graph.compareWith', { hash: compareBase.substring(0, 7) }),
        action: () => {
          vscode.postMessage({ type: 'getDiff', payload: { ref1: compareBase, ref2: commit.hash } });
          compareBase = null;
        },
      });
      items.push({
        label: t('graph.cancelCompare'),
        action: () => { compareBase = null; },
      });
    } else {
      items.push({
        label: t('graph.selectForCompare'),
        action: () => { compareBase = commit.hash; },
      });
    }

    // ── Copy SHA ──
    items.push(
      { separator: true, label: '', action: () => {} },
      {
        label: t('graph.copySHA'),
        action: () => vscode.postMessage({ type: 'copyToClipboard', payload: { text: commit.hash } }),
      },
    );

    contextMenu = { x: e.clientX, y: e.clientY, items };
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours < 12 ? 'AM' : 'PM';
    const h12 = hours % 12 || 12;
    return `${year}-${month}-${day} ${ampm} ${h12}:${mins}`;
  }

  $effect(() => {
    if (container) {
      viewportHeight = container.clientHeight;
    }
  });
</script>

<svelte:window onresize={handleResize} />

<div class="commit-graph" bind:this={container} onscroll={handleScroll}>
  {#if commitStore.loading && !isSearchActive}
    <div class="loading"><span class="spinner"></span> {t('graph.loading')}</div>
  {:else if displayCommits.length === 0}
    <div class="empty">{isSearchActive ? t('graph.noResults') : t('graph.noCommits')}</div>
  {:else}
    {#if isSearchActive}
      <div class="search-info">
        {t('graph.searchResults', { count: displayCommits.length, plural: displayCommits.length !== 1 ? 's' : '' })}
      </div>
    {/if}

    <!-- Column headers -->
    <div class="graph-header">
      <div class="col-message">{t('graph.description')}</div>
      <div class="col-author">{t('graph.author')}</div>
      <div class="col-hash">{t('graph.sha')}</div>
      <div class="col-date">{t('graph.date')}</div>
    </div>

    <!-- Virtual scroll container -->
    <div class="scroll-content" style="height: {totalHeight}px; position: relative;">
      <!-- SVG for graph — SourceGit-style Path + Link + Dot rendering -->
      <svg
        class="graph-lines"
        width={graphWidth}
        style="position: absolute; top: 0; height: {totalHeight}px; overflow: visible;"
      >
        <!-- Paths: continuous branch lines -->
        {#each displayPaths as path}
          {@const pathColor = COLOR_PALETTE[path.color % COLOR_PALETTE.length]}
          {@const pathD = buildPathD(path.points)}
          {#if pathD}
            <path d={pathD} fill="none" stroke={pathColor} stroke-width="5" opacity="0.07" stroke-linecap="round" />
            <path d={pathD} fill="none" stroke={pathColor} stroke-width="2" opacity="0.85" stroke-linecap="round" />
          {/if}
        {/each}

        <!-- Links: merge connection curves -->
        {#each displayLinks as link}
          {@const linkColor = COLOR_PALETTE[link.color % COLOR_PALETTE.length]}
          {@const sx = laneX(link.start.x)}
          {@const sy = link.start.y * ROW_HEIGHT}
          {@const cx = laneX(link.control.x)}
          {@const cy = link.control.y * ROW_HEIGHT}
          {@const ex = laneX(link.end.x)}
          {@const ey = link.end.y * ROW_HEIGHT}
          <path
            d="M {sx} {sy} Q {cx} {cy}, {ex} {ey}"
            fill="none" stroke={linkColor} stroke-width="5" opacity="0.07" stroke-linecap="round"
          />
          <path
            d="M {sx} {sy} Q {cx} {cy}, {ex} {ey}"
            fill="none" stroke={linkColor} stroke-width="2" opacity="0.85" stroke-linecap="round"
          />
        {/each}

        <!-- Dots: commit nodes -->
        {#each displayDots as dot, i}
          {@const dotColor = COLOR_PALETTE[dot.color % COLOR_PALETTE.length]}
          {@const dx = laneX(dot.center.x)}
          {@const dy = dot.center.y * ROW_HEIGHT}
          {#if dot.type === 'head'}
            <circle cx={dx} cy={dy} r={5} fill="var(--bg-primary, #1e1e1e)" stroke={dotColor} stroke-width="2" />
          {:else if dot.type === 'merge'}
            <circle cx={dx} cy={dy} r={4} fill="var(--bg-primary, #1e1e1e)" stroke={dotColor} stroke-width="1.5" />
            <circle cx={dx} cy={dy} r={2} fill={dotColor} />
          {:else}
            <circle cx={dx} cy={dy} r={4} fill={dotColor} />
          {/if}
        {/each}
      </svg>

      <!-- Commit rows -->
      <div
        class="visible-rows"
        style="position: absolute; top: {startIndex * ROW_HEIGHT}px; width: 100%;"
      >
        {#each visibleCommits as { commit, index } (commit.hash)}
          {@const dot = displayDots[index]}
          {@const nodeColor = dot ? COLOR_PALETTE[dot.color % COLOR_PALETTE.length] : '#888'}
          {@const isRemoteTip = dot?.remoteTip ?? false}
          <div
            class="commit-row"
            class:selected={uiStore.selectedCommitHash === commit.hash}
            class:highlighted={contextMenuHash === commit.hash}
            style="height: {ROW_HEIGHT}px;"
            onclick={() => selectCommit(commit.hash)}
            ondblclick={() => {
              const localRef = commit.refs.find(r => r.type === 'head' || r.type === 'branch');
              if (localRef) {
                doCheckout(localRef.name);
              } else {
                checkoutCommitHash = commit.hash;
                showCheckoutCommitModal = true;
              }
            }}
            oncontextmenu={(e) => onCommitContextMenu(e, commit)}
            role="row"
            tabindex={0}
            onkeydown={(e) => { if (e.key === 'Enter') selectCommit(commit.hash); }}
          >
            <div class="col-message" style="padding-left: {(displayLeftMargin[index] ?? graphWidth) * X_SCALE + 4}px;">
              {#if dot?.localOnly}
                <span class="local-dot" title="Not pushed"></span>
              {:else if dot?.remoteTip}
                <span class="remote-dot" title="Remote only"></span>
              {/if}
              {#each commit.refs.filter(r => {
                  if (r.type === 'remote-branch') {
                    if (r.name === 'HEAD') return false;
                    const fullRemoteName = `${r.remote}/${r.name}`;
                    // Hide if a local branch on this commit tracks this remote
                    const localRefs = commit.refs.filter(lr => lr.type === 'branch' || lr.type === 'head');
                    for (const lr of localRefs) {
                      const localInfo = branchStore.branches.find(b => !b.remote && b.name === lr.name);
                      if (localInfo?.upstream === fullRemoteName) return false;
                    }
                  }
                  return true;
                }).sort((a, b) => {
                  const order = { head: 0, branch: 1, 'remote-branch': 2, tag: 3, stash: 4 };
                  return (order[a.type] ?? 4) - (order[b.type] ?? 4);
                }) as ref}
                  {@const hasRemote = (ref.type === 'branch' || ref.type === 'head') && (() => {
                    const localInfo = branchStore.branches.find(b => !b.remote && b.name === ref.name);
                    if (localInfo?.upstream) {
                      return commit.refs.some(r => r.type === 'remote-branch' && `${r.remote}/${r.name}` === localInfo.upstream);
                    }
                    return commit.refs.some(r => r.type === 'remote-branch' && r.name === ref.name);
                  })()}
                  {@const badgeColor = ref.type === 'tag' ? '#e2a029' : ref.type === 'stash' ? '#9c27b0' : nodeColor}
                  <span
                    class="ref-badge"
                    style="--badge-color: {badgeColor};"
                    class:badge-bold={ref.type === 'head' || ref.type === 'tag' || ref.type === 'stash'}
                    title="Double-click to checkout: {ref.type === 'remote-branch' ? `${ref.remote}/${ref.name}` : ref.name}"
                    ondblclick={(e) => {
                      e.stopPropagation();
                      if (ref.type === 'remote-branch') {
                        doCheckoutRemote(`${ref.remote}/${ref.name}`, ref.name);
                      } else if (ref.type === 'tag' || ref.type === 'stash') {
                        checkoutCommitHash = ref.type === 'stash' ? commit.hash : ref.name;
                        showCheckoutCommitModal = true;
                      } else {
                        doCheckout(ref.name);
                      }
                    }}
                    role="button"
                    tabindex={0}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') {
                        if (ref.type === 'remote-branch') {
                          doCheckoutRemote(`${ref.remote}/${ref.name}`, ref.name);
                        } else if (ref.type === 'tag' || ref.type === 'stash') {
                          checkoutCommitHash = ref.type === 'stash' ? commit.hash : ref.name;
                          showCheckoutCommitModal = true;
                        } else {
                          vscode.postMessage({ type: 'checkout', payload: { ref: ref.name } });
                        }
                      }
                    }}
                  >
                    {#if ref.type === 'head'}
                      <i class="codicon codicon-check ref-icon"></i>
                      {ref.name}
                    {:else if ref.type === 'remote-branch'}
                      <i class="codicon codicon-cloud ref-icon"></i>
                      {ref.remote}/{ref.name}
                    {:else if ref.type === 'tag'}
                      <i class="codicon codicon-tag ref-icon"></i>
                      {ref.name}
                    {:else if ref.type === 'stash'}
                      <i class="codicon codicon-archive ref-icon"></i>
                      {ref.name}
                    {:else}
                      {#if hasRemote}<i class="codicon codicon-cloud ref-icon"></i>{/if}
                      {ref.name}
                    {/if}
                  </span>
                {/each}
                <span class="commit-subject truncate" title={commit.subject}>{commit.subject}</span>
            </div>
              <div class="col-author truncate" title={commit.author.name}>
                <img class="avatar-sm" src={getGravatarUrl(commit.author.email, 20)} alt="" loading="lazy" />
                {commit.author.name}
              </div>
              <div class="col-hash" title={commit.hash}>{commit.abbreviatedHash}</div>
              <div class="col-date" title={new Date(commit.author.date).toLocaleString()}>{formatDate(commit.author.date)}</div>
          </div>
        {/each}
      </div>

    </div>
  {/if}
</div>

{#if compareBase}
  <div class="compare-indicator">
    {t('graph.comparingFrom', { hash: compareBase.substring(0, 7) })}
    <button onclick={() => { compareBase = null; }}>{t('common.cancel')}</button>
  </div>
{/if}

{#if contextMenu}
  <ContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={contextMenu.items}
    onClose={() => { contextMenu = null; if (!showMergeModal && !showRebaseModal && !showCherryPickModal && !showRevertModal && !showResetModal && !showDeleteTagModal && !showDeleteBranchModal && !showCreateTagModal && !showCreateBranchModal) contextMenuHash = null; }}
  />
{/if}

{#if interactiveRebaseBase}
  <InteractiveRebase
    base={interactiveRebaseBase}
    onClose={() => { interactiveRebaseBase = null; }}
  />
{/if}

{#if showResetModal}
  <Modal title="Reset Branch to Revision" onClose={() => { showResetModal = false; contextMenuHash = null; }}>
    <p class="modal-desc">Move the branch head to the selected revision.</p>
    <div class="info-rows">
      <div class="info-row"><span class="info-label">Branch:</span><span class="info-value"><i class="codicon codicon-git-branch"></i> {branchStore.currentBranch?.name ?? 'current branch'}</span></div>
      <div class="info-row"><span class="info-label">Move to:</span><span class="info-value"><i class="codicon codicon-git-commit"></i> {resetTarget.substring(0, 7)}</span></div>
      <div class="info-row">
        <span class="info-label">Reset Type:</span>
        <span class="info-value">
          <ColorSelect
            options={[
              { value: 'soft', label: 'Soft — Keep all changes staged', color: '#4caf50' },
              { value: 'mixed', label: 'Mixed — Keep all changes unstaged', color: '#ff9800' },
              { value: 'hard', label: 'Hard — Discard all changes', color: '#f44336', warning: 'All uncommitted changes will be permanently lost.' },
            ]}
            value={resetMode}
            onChange={(v) => { resetMode = v as typeof resetMode; }}
          />
        </span>
      </div>
    </div>
    <div class="form-actions">
      <button onclick={() => { showResetModal = false; contextMenuHash = null; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => {
          vscode.postMessage({ type: 'reset', payload: { ref: resetTarget, mode: resetMode } });
          showResetModal = false;
          contextMenuHash = null;
        }}>Reset</button>
    </div>
  </Modal>
{/if}

{#if showMergeModal}
  <Modal title="Merge Branch" onClose={() => { showMergeModal = false; contextMenuHash = null; }}>
    <p class="modal-desc">Merge the selected branch into the current branch.</p>
    <div class="info-rows">
      <div class="info-row"><span class="info-label">Source:</span><span class="info-value"><i class="codicon codicon-git-branch"></i> {mergeTarget}</span></div>
      <div class="info-row"><span class="info-label">Into:</span><span class="info-value"><i class="codicon codicon-git-branch"></i> {branchStore.currentBranch?.name ?? 'current branch'}</span></div>
      <div class="info-row">
        <span class="info-label">Merge Type:</span>
        <span class="info-value">
          <ColorSelect
            options={[
              { value: 'default', label: 'Default — Fast-forward if possible', color: '#4caf50' },
              { value: 'no-ff', label: 'No Fast-forward — Always create merge commit', color: '#2196f3' },
              { value: 'ff-only', label: 'Fast-forward Only — Fail if not possible', color: '#ff9800' },
              { value: 'squash', label: 'Squash — Combine all commits into one', color: '#9c27b0', warning: 'Original commits will not be preserved in the history.' },
            ]}
            value={mergeMode}
            onChange={(v) => { mergeMode = v as typeof mergeMode; }}
          />
        </span>
      </div>
    </div>
    <div class="form-actions">
      <button onclick={() => { showMergeModal = false; contextMenuHash = null; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => { showMergeModal = false; contextMenuHash = null; vscode.postMessage({ type: 'merge', payload: { branch: mergeTarget, noFf: mergeMode === 'no-ff', ffOnly: mergeMode === 'ff-only', squash: mergeMode === 'squash' } }); }}>Merge</button>
    </div>
  </Modal>
{/if}

{#if showRebaseModal}
  <Modal title="Rebase Branch" onClose={() => { showRebaseModal = false; contextMenuHash = null; }}>
    <p class="modal-desc">Rebase the current branch onto the selected revision. This will rewrite commit history.</p>
    <div class="info-rows">
      <div class="info-row"><span class="info-label">Branch:</span><span class="info-value"><i class="codicon codicon-git-branch"></i> {branchStore.currentBranch?.name ?? 'current branch'}</span></div>
      <div class="info-row"><span class="info-label">Onto:</span><span class="info-value"><i class="codicon codicon-git-commit"></i> {rebaseTarget.substring(0, 7)}</span></div>
      <div class="info-row">
        <span class="info-label">Options:</span>
        <span class="info-value">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={rebaseAutostash} />
            <span>{t('rebase.autostash')}</span>
          </label>
        </span>
      </div>
    </div>
    <div class="form-actions">
      <button onclick={() => { showRebaseModal = false; contextMenuHash = null; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => { showRebaseModal = false; contextMenuHash = null; vscode.postMessage({ type: 'rebase', payload: { onto: rebaseTarget, autostash: rebaseAutostash } }); }}>Rebase</button>
    </div>
  </Modal>
{/if}

{#if showCherryPickModal}
  <Modal title="Cherry-pick Commit" onClose={() => { showCherryPickModal = false; contextMenuHash = null; }}>
    <p class="modal-desc">Apply the selected commit onto the current branch.</p>
    <div class="info-rows">
      <div class="info-row"><span class="info-label">Commit:</span><span class="info-value"><i class="codicon codicon-git-commit"></i> {cherryPickTarget.substring(0, 7)}</span></div>
      <div class="info-row"><span class="info-label">Onto:</span><span class="info-value"><i class="codicon codicon-git-branch"></i> {branchStore.currentBranch?.name ?? 'current branch'}</span></div>
      <div class="info-row">
        <span class="info-label">Options:</span>
        <span class="info-value">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={cherryPickNoCommit} />
            <span>{t('cherryPick.noCommit')}</span>
          </label>
        </span>
      </div>
    </div>
    <div class="form-actions">
      <button onclick={() => { showCherryPickModal = false; contextMenuHash = null; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => { showCherryPickModal = false; contextMenuHash = null; vscode.postMessage({ type: 'cherryPick', payload: { commit: cherryPickTarget, noCommit: cherryPickNoCommit } }); }}>Cherry-pick</button>
    </div>
  </Modal>
{/if}

{#if showRevertModal}
  <Modal title="Revert Commit" onClose={() => { showRevertModal = false; contextMenuHash = null; }}>
    <p class="modal-desc">Create a new commit that undoes the changes of the selected commit.</p>
    <div class="info-rows">
      <div class="info-row"><span class="info-label">Commit:</span><span class="info-value"><i class="codicon codicon-git-commit"></i> {revertTarget.substring(0, 7)}</span></div>
      <div class="info-row"><span class="info-label">Branch:</span><span class="info-value"><i class="codicon codicon-git-branch"></i> {branchStore.currentBranch?.name ?? 'current branch'}</span></div>
      <div class="info-row">
        <span class="info-label">Options:</span>
        <span class="info-value">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={revertNoCommit} />
            <span>{t('revert.noCommit')}</span>
          </label>
        </span>
      </div>
    </div>
    <div class="form-actions">
      <button onclick={() => { showRevertModal = false; contextMenuHash = null; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => { showRevertModal = false; contextMenuHash = null; vscode.postMessage({ type: 'revert', payload: { commit: revertTarget, noCommit: revertNoCommit } }); }}>Revert</button>
    </div>
  </Modal>
{/if}

{#if showDeleteTagModal}
  <Modal title={t('deleteTag.title')} onClose={() => { showDeleteTagModal = false; contextMenuHash = null; }}>
    <p class="modal-desc">{t('deleteTag.confirm', { name: deleteTagName })}</p>
    <div class="form-actions">
      <button onclick={() => { showDeleteTagModal = false; contextMenuHash = null; }}>{t('common.cancel')}</button>
      <button class="danger-btn" onclick={() => { showDeleteTagModal = false; contextMenuHash = null; vscode.postMessage({ type: 'deleteTag', payload: { name: deleteTagName } }); }}>{t('sidebar.delete')}</button>
    </div>
  </Modal>
{/if}

{#if showCreateTagModal}
  <Modal title={t('createTag.title')} onClose={() => { showCreateTagModal = false; contextMenuHash = null; }}>
    <p class="modal-desc">{t('createTag.desc')}</p>
    <div class="fork-form">
      <div class="fork-row">
        <span class="fork-label">{t('createTag.createAt')}</span>
        <span class="fork-value"><i class="codicon codicon-git-commit"></i> {createTagRef.substring(0, 7)} {createTagSubject}</span>
      </div>
      <div class="fork-row">
        <label class="fork-label" for="ctx-tag-name">{t('createTag.name')}</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input id="ctx-tag-name" type="text" class="fork-input" bind:value={createTagName} placeholder={t('createTag.namePlaceholder')} autofocus onkeydown={(e) => { if (e.key === 'Enter' && createTagName.trim()) { showCreateTagModal = false; contextMenuHash = null; vscode.postMessage({ type: 'createTag', payload: { name: createTagName.trim(), ref: createTagRef, message: createTagMessage.trim() || undefined } }); if (createTagPush) vscode.postMessage({ type: 'pushTag', payload: { name: createTagName.trim() } }); } }} />
      </div>
      <div class="fork-row fork-row-top">
        <label class="fork-label" for="ctx-tag-msg">{t('createTag.message')}</label>
        <textarea id="ctx-tag-msg" class="fork-textarea" bind:value={createTagMessage} placeholder={t('createTag.messagePlaceholder')} rows="4"></textarea>
      </div>
      <div class="fork-row">
        <span class="fork-label"></span>
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={createTagPush} />
          <span>{t('createTag.pushToRemotes')}</span>
        </label>
      </div>
    </div>
    <div class="form-actions">
      <button onclick={() => { showCreateTagModal = false; contextMenuHash = null; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => { showCreateTagModal = false; contextMenuHash = null; vscode.postMessage({ type: 'createTag', payload: { name: createTagName.trim(), ref: createTagRef, message: createTagMessage.trim() || undefined } }); if (createTagPush) vscode.postMessage({ type: 'pushTag', payload: { name: createTagName.trim() } }); }} disabled={!createTagName.trim()}>{createTagPush ? t('createTag.createAndPush') : t('createTag.create')}</button>
    </div>
  </Modal>
{/if}

{#if showCreateBranchModal}
  <Modal title={t('createBranch.title')} onClose={() => { showCreateBranchModal = false; contextMenuHash = null; }}>
    <p class="modal-desc">{t('createBranch.desc')}</p>
    <div class="fork-form">
      <div class="fork-row">
        <span class="fork-label">{t('createBranch.createAt')}</span>
        <span class="fork-value"><i class="codicon codicon-git-commit"></i> {createBranchStartPoint.substring(0, 7)} {createBranchSubject}</span>
      </div>
      <div class="fork-row">
        <label class="fork-label" for="ctx-branch-name">{t('createBranch.name')}</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input id="ctx-branch-name" type="text" class="fork-input" bind:value={createBranchName} placeholder={t('createBranch.namePlaceholder')} autofocus onkeydown={(e) => { if (e.key === 'Enter' && createBranchName.trim()) { showCreateBranchModal = false; contextMenuHash = null; vscode.postMessage({ type: 'createBranch', payload: { name: createBranchName.trim(), startPoint: createBranchStartPoint, checkout: createBranchCheckout } }); } }} />
      </div>
      <div class="fork-row">
        <span class="fork-label"></span>
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={createBranchCheckout} />
          <span>{t('createBranch.checkout')}</span>
        </label>
      </div>
    </div>
    <div class="form-actions">
      <button onclick={() => { showCreateBranchModal = false; contextMenuHash = null; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => { showCreateBranchModal = false; contextMenuHash = null; vscode.postMessage({ type: 'createBranch', payload: { name: createBranchName.trim(), startPoint: createBranchStartPoint, checkout: createBranchCheckout } }); }} disabled={!createBranchName.trim()}>{createBranchCheckout ? t('createBranch.createAndCheckout') : t('createBranch.create')}</button>
    </div>
  </Modal>
{/if}

{#if showDeleteBranchModal}
  <Modal title={t('deleteBranch.title')} onClose={() => { showDeleteBranchModal = false; contextMenuHash = null; }}>
    <p class="modal-desc">{t('deleteBranch.confirm', { name: deleteBranchName })}</p>
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={deleteBranchForce} />
        <span>{t('deleteBranch.force')}</span>
      </label>
    </div>
    <div class="form-actions">
      <button onclick={() => { showDeleteBranchModal = false; contextMenuHash = null; }}>{t('common.cancel')}</button>
      <button class="danger-btn" onclick={() => { showDeleteBranchModal = false; contextMenuHash = null; vscode.postMessage({ type: 'deleteBranch', payload: { name: deleteBranchName, force: deleteBranchForce } }); }}>{t('sidebar.delete')}</button>
    </div>
  </Modal>
{/if}

{#if showCheckoutRemoteModal}
  <Modal title={t('checkoutRemote.title')} onClose={() => { showCheckoutRemoteModal = false; }}>
    <p class="modal-desc">{t('checkoutRemote.desc', { remote: checkoutRemoteName })}</p>
    <div class="info-rows">
      <div class="info-row"><span class="info-label">{t('checkoutRemote.remote')}:</span><span class="info-value"><i class="codicon codicon-cloud"></i> {checkoutRemoteName}</span></div>
      <div class="info-row">
        <span class="info-label">{t('checkoutRemote.localName')}:</span>
        <span class="info-value" style="flex: 1;">
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="text"
            class="modal-input"
            bind:value={checkoutRemoteLocalName}
            autofocus
            onkeydown={(e) => {
              if (e.key === 'Enter' && checkoutRemoteLocalName.trim()) {
                showCheckoutRemoteModal = false;
                vscode.postMessage({ type: 'createBranch', payload: { name: checkoutRemoteLocalName.trim(), startPoint: checkoutRemoteName, checkout: true } });
              }
            }}
          />
        </span>
      </div>
    </div>
    <div class="form-actions">
      <button onclick={() => { showCheckoutRemoteModal = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => {
        showCheckoutRemoteModal = false;
        vscode.postMessage({ type: 'createBranch', payload: { name: checkoutRemoteLocalName.trim(), startPoint: checkoutRemoteName, checkout: true } });
      }} disabled={!checkoutRemoteLocalName.trim()}>{t('checkoutRemote.checkout')}</button>
    </div>
  </Modal>
{/if}

{#if showCheckoutCommitModal}
  <Modal title={t('checkoutCommit.title')} onClose={() => { showCheckoutCommitModal = false; }}>
    <p class="modal-desc">{t('checkoutCommit.desc', { hash: checkoutCommitHash.substring(0, 7) })}</p>
    <div class="form-actions">
      <button onclick={() => { showCheckoutCommitModal = false; }}>{t('common.cancel')}</button>
      <button class="primary" onclick={() => {
        showCheckoutCommitModal = false;
        vscode.postMessage({ type: 'checkout', payload: { ref: checkoutCommitHash } });
      }}>Checkout</button>
    </div>
  </Modal>
{/if}

{#if showPullAfterCheckoutModal}
  <Modal title="Checkout Branch" onClose={() => { showPullAfterCheckoutModal = false; }}>
    <p class="modal-desc">This branch is <strong>{pullAfterCheckoutBehind}</strong> commit{pullAfterCheckoutBehind > 1 ? 's' : ''} behind the remote. Pull after checkout?</p>
    <div class="info-rows">
      <div class="info-row"><span class="info-label">Branch:</span><span class="info-value"><i class="codicon codicon-git-branch"></i> {pullAfterCheckoutRef}</span></div>
    </div>
    <div class="form-actions">
      <button onclick={() => { showPullAfterCheckoutModal = false; }}>{t('common.cancel')}</button>
      <button onclick={() => {
        showPullAfterCheckoutModal = false;
        vscode.postMessage({ type: 'checkout', payload: { ref: pullAfterCheckoutRef } });
      }}>Checkout Only</button>
      <button class="primary" onclick={() => {
        showPullAfterCheckoutModal = false;
        vscode.postMessage({ type: 'checkout', payload: { ref: pullAfterCheckoutRef, pullAfter: true } });
      }}>Checkout & Pull</button>
    </div>
  </Modal>
{/if}

<style>
  /* ---- Layout ---- */
  .commit-graph {
    height: 100%;
    overflow-y: auto;
    overflow-x: auto;
    position: relative;
  }

  .loading, .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .search-info {
    padding: 6px 14px;
    font-size: 11px;
    color: var(--text-link);
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
  }

  /* ---- Header ---- */
  .graph-header {
    display: flex;
    align-items: center;
    height: 32px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-secondary);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .graph-header > div {
    padding: 0 10px;
  }

  /* ---- SVG layer — must be ABOVE rows so nodes/lines are visible ---- */
  .graph-lines {
    pointer-events: none;
    z-index: 3;
  }

  .visible-rows {
    z-index: 1;
  }

  /* ---- Commit row ---- */
  .commit-row {
    display: flex;
    align-items: center;
    cursor: pointer;
    transition: background 0.08s;
    user-select: none;
  }

  .commit-row:hover {
    background: var(--bg-hover);
  }

  .commit-row.selected {
    background: var(--bg-selected);
    color: var(--text-selected);
  }

  .commit-row.highlighted:not(.selected) {
    background: var(--bg-hover);
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: -1px;
  }

  .commit-row:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: -1px;
  }

  /* ---- Columns ---- */
  .col-message {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px;
    overflow: hidden;
  }

  .local-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    background: #4da6ff;
    opacity: 0.8;
  }

  .remote-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--text-secondary, #888);
    opacity: 0.8;
  }

  .col-author {
    width: 120px;
    flex-shrink: 0;
    padding: 0 10px;
    font-size: 12px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .avatar-sm {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .commit-row.selected .col-author,
  .commit-row.selected .col-date,
  .commit-row.selected .col-hash {
    color: var(--text-selected);
    opacity: 0.8;
  }

  .col-date {
    width: 140px;
    flex-shrink: 0;
    padding: 0 10px;
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .col-hash {
    width: 75px;
    flex-shrink: 0;
    padding: 0 10px;
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--text-secondary);
    opacity: 0.7;
  }

  .commit-subject {
    flex: 1;
    min-width: 0;
    font-size: 13px;
  }

  /* ---- Ref badges ---- */
  .ref-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 7px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
    line-height: 16px;
    cursor: pointer;
    transition: filter 0.1s;
    /* Dark theme defaults */
    background: color-mix(in srgb, var(--badge-color) 15%, transparent);
    color: #fff;
    border: 1px solid color-mix(in srgb, var(--badge-color) 25%, transparent);
  }

  .ref-badge.badge-bold {
    background: color-mix(in srgb, var(--badge-color) 55%, transparent);
    border-color: color-mix(in srgb, var(--badge-color) 70%, transparent);
  }

  /* Light theme overrides */
  :global(body.vscode-light) .ref-badge {
    background: color-mix(in srgb, var(--badge-color) 18%, transparent);
    color: color-mix(in srgb, var(--badge-color) 85%, #000);
    border: 1px solid color-mix(in srgb, var(--badge-color) 40%, transparent);
  }

  :global(body.vscode-light) .ref-badge.badge-bold {
    background: color-mix(in srgb, var(--badge-color) 75%, #fff);
    color: #fff;
    border-color: color-mix(in srgb, var(--badge-color) 85%, transparent);
  }

  /* High contrast overrides */
  :global(body.vscode-high-contrast) .ref-badge {
    background: color-mix(in srgb, var(--badge-color) 30%, transparent);
    color: #fff;
    border: 1px solid var(--badge-color);
  }

  .ref-badge:hover {
    filter: brightness(1.2);
  }

  :global(body.vscode-light) .ref-badge:hover {
    filter: brightness(0.9);
  }

  .ref-icon {
    font-size: 12px;
    flex-shrink: 0;
  }


  /* ---- Compare indicator ---- */
  .compare-indicator {
    position: fixed;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--vscode-badge-background, #4d4d4d);
    color: var(--vscode-badge-foreground, #fff);
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }

  .compare-indicator button {
    font-size: 11px;
    padding: 3px 10px;
  }

  /* ---- Modal styles ---- */
  .modal-desc {
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 16px;
  }

  .info-rows {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 18px;
  }

  .info-row {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 13px;
  }

  .info-label {
    width: 90px;
    flex-shrink: 0;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .info-value {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }


  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .form-group { margin-bottom: 12px; }

  .modal-input {
    width: 100%;
    padding: 5px 8px;
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border, var(--border-color));
    border-radius: 3px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
  }

  .modal-input:focus {
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 12px;
  }

  .danger-btn {
    background: var(--vscode-errorForeground, #f44336) !important;
    color: #fff !important;
  }

  /* ---- Fork-style form layout ---- */
  .fork-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .fork-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .fork-row-top {
    align-items: flex-start;
  }

  .fork-label {
    min-width: 120px;
    text-align: right;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    flex-shrink: 0;
  }

  .fork-value {
    font-size: 12px;
    color: var(--vscode-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fork-input {
    flex: 1;
    min-width: 0;
  }

  .fork-textarea {
    flex: 1;
    min-width: 0;
    resize: vertical;
    font-family: inherit;
    font-size: 12px;
    padding: 6px 8px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
  }

  .fork-textarea:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
</style>
