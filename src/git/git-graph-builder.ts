// Graph layout algorithm ported from SourceGit (https://github.com/sourcegit-scm/sourcegit)
// Copyright (c) SourceGit contributors, licensed under MIT License.

import type { BranchInfo, Commit, GraphNode, ParentConnection } from './types';

const COLOR_PALETTE = [
  '#63b0f4', '#73d13d', '#ff7a45', '#b37feb',
  '#f759ab', '#36cfc9', '#ffc53d', '#ff4d4f',
  '#597ef7', '#9254de', '#43e8d8', '#faad14',
];

// ── SourceGit-faithful data structures ──

export interface GraphPath {
  points: Array<{ x: number; y: number }>;
  color: number;
}

export interface GraphLink {
  start: { x: number; y: number };
  control: { x: number; y: number };
  end: { x: number; y: number };
  color: number;
}

export interface GraphDot {
  center: { x: number; y: number };
  color: number;
  type: 'default' | 'head' | 'merge';
  localOnly: boolean;
  remoteTip: boolean;
}

export interface FullGraphData {
  paths: GraphPath[];
  links: GraphLink[];
  dots: GraphDot[];
  /** Per-commit left margin (X of content start) */
  commitLeftMargin: number[];
}


// ── PathHelper (exact SourceGit port) ──
class PathHelper {
  path: GraphPath;
  next: string;
  lastX: number;
  private lastY: number;
  private endY: number = 0;

  get isMerged(): boolean { return false; } // simplified

  constructor(next: string, color: number, start: { x: number; y: number }, to?: { x: number; y: number }) {
    this.next = next;
    this.path = { points: [], color };

    if (to) {
      this.lastX = to.x;
      this.lastY = to.y;
      this.path.points.push(start);
      this.path.points.push(to);
    } else {
      this.lastX = start.x;
      this.lastY = start.y;
      this.path.points.push(start);
    }
  }

  /** Path passes through this row without a commit */
  pass(x: number, y: number, halfH: number) {
    if (x > this.lastX) {
      this.add(this.lastX, this.lastY);
      this.add(x, y - halfH);
    } else if (x < this.lastX) {
      this.add(this.lastX, y - halfH);
      y += halfH;
      this.add(x, y);
    }
    this.lastX = x;
    this.lastY = y;
  }

  /** Path has a commit at this row, continues to next parent */
  goto(x: number, y: number, halfH: number) {
    if (x > this.lastX) {
      this.add(this.lastX, this.lastY);
      this.add(x, y - halfH);
    } else if (x < this.lastX) {
      let minY = y - halfH;
      if (minY > this.lastY) minY -= halfH;
      this.add(this.lastX, minY);
      this.add(x, y);
    }
    this.lastX = x;
    this.lastY = y;
  }

  /** Path ends at this row */
  end(x: number, y: number, halfH: number) {
    if (x > this.lastX) {
      this.add(this.lastX, this.lastY);
      this.add(x, y - halfH);
    } else if (x < this.lastX) {
      this.add(this.lastX, y - halfH);
    }
    this.add(x, y);
    this.lastX = x;
    this.lastY = y;
  }

  private add(x: number, y: number) {
    if (this.endY < y) {
      this.path.points.push({ x, y });
      this.endY = y;
    }
  }
}

// ── Remote-only detection ──
// Finds commits that exist only on remote branches (between remote tip and local branch).
// Uses upstream tracking info for accurate local↔remote branch matching.

function buildUpstreamMap(branches: BranchInfo[]): Map<string, string> {
  // Maps "remote/branch" (upstream) → local branch hash
  const map = new Map<string, string>();
  for (const b of branches) {
    if (!b.remote && b.upstream) {
      map.set(b.upstream, b.hash);
    }
  }
  return map;
}

function buildRemoteOnlyData(commits: Commit[], branches: BranchInfo[]): { tipSet: Set<string>; allSet: Set<string> } {
  const hashIndex = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    hashIndex.set(commits[i].hash, i);
  }

  // upstream map: "origin/main" → local branch hash
  const upstreamMap = buildUpstreamMap(branches);

  // Fallback: name-based map from commit refs (for branches without explicit upstream)
  const localBranchMap = new Map<string, string>();
  for (const c of commits) {
    for (const r of c.refs) {
      if (r.type === 'branch' || r.type === 'head') {
        localBranchMap.set(r.name, c.hash);
      }
    }
  }

  // Find remote tips with their corresponding local hash
  const tipSet = new Set<string>();
  const tips: Array<{ tipIdx: number; localHash: string }> = [];
  for (const c of commits) {
    const hasRemoteRef = c.refs.some(r => r.type === 'remote-branch');
    const hasLocalRef = c.refs.some(r => r.type === 'branch' || r.type === 'head' || r.type === 'tag');
    if (!hasRemoteRef || hasLocalRef) continue;

    for (const r of c.refs) {
      if (r.type !== 'remote-branch') continue;
      const fullRemoteName = `${r.remote}/${r.name}`;
      const localHash = upstreamMap.get(fullRemoteName) ?? localBranchMap.get(r.name);
      if (localHash && localHash !== c.hash) {
        tipSet.add(c.hash);
        const idx = hashIndex.get(c.hash);
        if (idx !== undefined) tips.push({ tipIdx: idx, localHash });
        break;
      }
    }
  }

  // For each remote tip, BFS through parents stopping at the corresponding local branch's ancestors
  const allSet = new Set<string>();
  const ancestorCache = new Map<string, Set<string>>();

  for (const { tipIdx, localHash } of tips) {
    // Get or compute ancestors of the corresponding local branch
    let localAncestors = ancestorCache.get(localHash);
    if (!localAncestors) {
      localAncestors = new Set([localHash]);
      const q: number[] = [];
      const li = hashIndex.get(localHash);
      if (li !== undefined) q.push(li);
      let qHead = 0;
      while (qHead < q.length) {
        const idx = q[qHead++];
        for (const ph of commits[idx].parents) {
          if (!localAncestors.has(ph)) {
            localAncestors.add(ph);
            const pi = hashIndex.get(ph);
            if (pi !== undefined) q.push(pi);
          }
        }
      }
      ancestorCache.set(localHash, localAncestors);
    }

    // BFS from remote tip, stop at local branch ancestors
    allSet.add(commits[tipIdx].hash);
    const queue = [tipIdx];
    let qHead = 0;
    while (qHead < queue.length) {
      const idx = queue[qHead++];
      for (const parentHash of commits[idx].parents) {
        if (allSet.has(parentHash) || localAncestors.has(parentHash)) continue;
        allSet.add(parentHash);
        const pi = hashIndex.get(parentHash);
        if (pi !== undefined) queue.push(pi);
      }
    }
  }

  return { tipSet, allSet };
}

// ── Local-only detection ──

function buildPushedSet(commits: Commit[]): Set<string> {
  const hashIndex = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    hashIndex.set(commits[i].hash, i);
  }

  const pushed = new Set<string>();
  const queue: number[] = [];

  // Start from commits that have remote-branch refs
  for (let i = 0; i < commits.length; i++) {
    if (commits[i].refs.some(r => r.type === 'remote-branch')) {
      if (!pushed.has(commits[i].hash)) {
        pushed.add(commits[i].hash);
        queue.push(i);
      }
    }
  }

  // BFS through parents
  let qHead = 0;
  while (qHead < queue.length) {
    const idx = queue[qHead++];
    for (const parentHash of commits[idx].parents) {
      if (!pushed.has(parentHash)) {
        pushed.add(parentHash);
        const pi = hashIndex.get(parentHash);
        if (pi !== undefined) queue.push(pi);
      }
    }
  }

  return pushed;
}

function pickColor(unsolved: PathHelper[]): number {
  const used = new Set(unsolved.map(p => p.path.color));
  for (let i = 0; i < COLOR_PALETTE.length; i++) {
    if (!used.has(i)) return i;
  }
  return 0;
}

// ── Main parse function (SourceGit CommitGraph.Parse port) ──

// Layout grid: one rail is UNIT_W wide and one commit row is UNIT_H tall.
// The webview consumes these in svg-coordinate space; HALF_* values are
// pre-computed because every link/path math touches them.
const UNIT_W = 12;
const HALF_W = 6;
const UNIT_H = 1;
const HALF_H = 0.5;

export function buildFullGraph(commits: Commit[], branches: BranchInfo[] = []): FullGraphData {

  const result: FullGraphData = {
    paths: [],
    links: [],
    dots: [],
    commitLeftMargin: [],
  };

  const unsolved: PathHelper[] = [];
  const ended: PathHelper[] = [];
  // Index `unsolved` by `.next` for O(1) merge-parent lookup. Matches `.find()`
  // "first wins" semantics: if multiple paths share the same `next`, the
  // earliest-inserted one is kept in the map.
  const nextMap = new Map<string, PathHelper>();
  const trackNext = (l: PathHelper) => { if (!nextMap.has(l.next)) nextMap.set(l.next, l); };
  const untrackNext = (l: PathHelper) => { if (nextMap.get(l.next) === l) nextMap.delete(l.next); };
  let offsetY = -HALF_H;
  const { tipSet: remoteTipSet, allSet: remoteOnlySet } = buildRemoteOnlyData(commits, branches);
  const pushedSet = buildPushedSet(commits);

  for (const commit of commits) {
    let major: PathHelper | null = null;
    offsetY += UNIT_H;

    let offsetX = 4 - HALF_W;
    const maxOffsetOld = unsolved.length > 0 ? unsolved[unsolved.length - 1].lastX : offsetX + UNIT_W;

    for (const l of unsolved) {
      if (l.next === commit.hash) {
        if (major === null) {
          offsetX += UNIT_W;
          major = l;
          if (commit.parents.length > 0) {
            untrackNext(major);
            major.next = commit.parents[0];
            trackNext(major);
            major.goto(offsetX, offsetY, HALF_H);
          } else {
            major.end(offsetX, offsetY, HALF_H);
            ended.push(l);
          }
        } else {
          l.end(major.lastX, offsetY, HALF_H);
          ended.push(l);
        }
      } else {
        offsetX += UNIT_W;
        l.pass(offsetX, offsetY, HALF_H);
      }
    }

    // Remove ended paths in a single O(n) pass
    if (ended.length > 0) {
      const toRemove = new Set(ended);
      let w = 0;
      for (let r = 0; r < unsolved.length; r++) {
        if (!toRemove.has(unsolved[r])) unsolved[w++] = unsolved[r];
      }
      unsolved.length = w;
      for (const e of ended) untrackNext(e);
      ended.length = 0;
    }

    // New branch head
    if (major === null) {
      offsetX += UNIT_W;
      if (commit.parents.length > 0) {
        major = new PathHelper(commit.parents[0], pickColor(unsolved), { x: offsetX, y: offsetY });
        unsolved.push(major);
        trackNext(major);
        result.paths.push(major.path);
      }
    }

    // Dot
    const position = { x: major?.lastX ?? offsetX, y: offsetY };
    const dotColor = major?.path.color ?? 0;
    const isRemoteOnly = remoteOnlySet.has(commit.hash);
    const isLocalOnly = !pushedSet.has(commit.hash);
    let dotType: GraphDot['type'] = 'default';
    if (commit.refs.some(r => r.type === 'head')) dotType = 'head';
    else if (commit.parents.length > 1) dotType = 'merge';
    result.dots.push({ center: position, color: dotColor, type: dotType, localOnly: isLocalOnly, remoteTip: isRemoteOnly });

    // Merge parents - skip for remote-tip commits unless they are merge commits
    if (!remoteTipSet.has(commit.hash) || commit.parents.length > 1) {
      for (let j = 1; j < commit.parents.length; j++) {
        const parentHash = commit.parents[j];
        const parent = nextMap.get(parentHash);

        if (parent) {
          // Existing path → create link
          result.links.push({
            start: position,
            end: { x: parent.lastX, y: offsetY + HALF_H },
            control: { x: parent.lastX, y: position.y },
            color: parent.path.color,
          });
        } else {
          // New path for merge parent
          offsetX += UNIT_W;
          const l = new PathHelper(parentHash, pickColor(unsolved), position, { x: offsetX, y: position.y + HALF_H });
          unsolved.push(l);
          trackNext(l);
          result.paths.push(l.path);
        }
      }
    }

    result.commitLeftMargin.push(Math.max(offsetX, maxOffsetOld) + HALF_W + 2);
  }

  // End remaining paths
  for (let i = 0; i < unsolved.length; i++) {
    const path = unsolved[i];
    const endY = (commits.length - 0.5) * UNIT_H;
    if (path.path.points.length === 1 && Math.abs(path.path.points[0].y - endY) < 0.0001) continue;
    path.end((i + 0.5) * UNIT_W + 4, endY + HALF_H, HALF_H);
  }

  return result;
}

// ── Legacy adapter: convert FullGraphData to GraphNode[] for existing rendering ──

export function buildGraphFromFullData(commits: Commit[], full: FullGraphData): GraphNode[] {
  const nodes: GraphNode[] = [];
  const hashIndex = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    hashIndex.set(commits[i].hash, i);
  }
  for (let i = 0; i < commits.length; i++) {
    const dot = full.dots[i];
    const commit = commits[i];
    const color = COLOR_PALETTE[dot.color % COLOR_PALETTE.length];
    const parentConns: ParentConnection[] = [];
    for (let pi = 0; pi < commit.parents.length; pi++) {
      const parentIdx = hashIndex.get(commit.parents[pi]) ?? -1;
      if (parentIdx === -1) continue;
      const parentDot = full.dots[parentIdx];
      const pColor = COLOR_PALETTE[parentDot.color % COLOR_PALETTE.length];
      parentConns.push({
        hash: commit.parents[pi],
        column: parentDot.center.x,
        color: pi === 0 ? color : pColor,
      });
    }
    nodes.push({
      commit: commit.hash,
      column: dot.center.x,
      color,
      parents: parentConns,
    });
  }
  return nodes;
}

export function buildGraph(commits: Commit[], branches: BranchInfo[] = []): GraphNode[] {
  return buildGraphFromFullData(commits, buildFullGraph(commits, branches));
}
