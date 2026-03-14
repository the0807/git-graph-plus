import { describe, it, expect } from 'vitest';
import { buildGraph, buildFullGraph } from '../git-graph-builder';
import type { Commit, Ref } from '../types';

function makeCommit(hash: string, parents: string[] = [], refs: Ref[] = []): Commit {
  return {
    hash,
    abbreviatedHash: hash.substring(0, 7),
    author: { name: 'Test', email: 'test@test.com', date: '2024-01-01' },
    committer: { name: 'Test', email: 'test@test.com', date: '2024-01-01' },
    subject: `Commit ${hash}`,
    body: '',
    parents,
    refs,
  };
}

describe('buildGraph', () => {
  it('should return empty array for no commits', () => {
    expect(buildGraph([])).toEqual([]);
  });

  it('should place linear history in same column', () => {
    const commits = [
      makeCommit('c3', ['c2']),
      makeCommit('c2', ['c1']),
      makeCommit('c1', []),
    ];

    const nodes = buildGraph(commits);

    expect(nodes).toHaveLength(3);
    // All on the same column
    expect(nodes[0].column).toBe(nodes[1].column);
    expect(nodes[1].column).toBe(nodes[2].column);
  });

  it('should assign different columns for branches', () => {
    const commits = [
      makeCommit('c4', ['c3', 'c2']),
      makeCommit('c3', ['c1']),
      makeCommit('c2', ['c1']),
      makeCommit('c1', []),
    ];

    const nodes = buildGraph(commits);

    expect(nodes).toHaveLength(4);
    expect(nodes[0].parents).toHaveLength(2);
    // The second parent (c2) should be in a different column
    expect(nodes[0].parents[1].column).not.toBe(nodes[0].parents[0].column);
  });

  it('should handle root commit (no parents)', () => {
    const commits = [makeCommit('root', [])];
    const nodes = buildGraph(commits);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].column).toBeGreaterThanOrEqual(0);
    expect(nodes[0].parents).toEqual([]);
  });

  it('should handle octopus merge', () => {
    const commits = [
      makeCommit('merge', ['p1', 'p2', 'p3']),
      makeCommit('p1', ['root']),
      makeCommit('p2', ['root']),
      makeCommit('p3', ['root']),
      makeCommit('root', []),
    ];

    const nodes = buildGraph(commits);

    expect(nodes).toHaveLength(5);
    expect(nodes[0].parents).toHaveLength(3);
  });

  it('should assign colors to nodes', () => {
    const commits = [
      makeCommit('c2', ['c1']),
      makeCommit('c1', []),
    ];

    const nodes = buildGraph(commits);

    expect(nodes[0].color).toBeTruthy();
    expect(typeof nodes[0].color).toBe('string');
    expect(nodes[0].color.startsWith('#')).toBe(true);
  });
});

describe('buildFullGraph remote-tip detection', () => {
  it('should mark commit as remote-tip when it has only remote-branch refs and local branch exists elsewhere', () => {
    const commits = [
      makeCommit('c3', ['c2'], [{ type: 'remote-branch', name: 'main', remote: 'origin' }]),
      makeCommit('c2', ['c1'], [{ type: 'branch', name: 'main' }]),
      makeCommit('c1', []),
    ];
    const graph = buildFullGraph(commits);
    expect(graph.dots[0].type).toBe('remote-tip');
    expect(graph.dots[1].type).toBe('default');
  });

  it('should NOT mark as remote-tip when commit has both local and remote refs', () => {
    const commits = [
      makeCommit('c2', ['c1'], [
        { type: 'branch', name: 'main' },
        { type: 'remote-branch', name: 'main', remote: 'origin' },
      ]),
      makeCommit('c1', []),
    ];
    const graph = buildFullGraph(commits);
    expect(graph.dots[0].type).not.toBe('remote-tip');
  });

  it('should NOT mark as remote-tip when commit has head ref', () => {
    const commits = [
      makeCommit('c2', ['c1'], [
        { type: 'head', name: 'main' },
        { type: 'remote-branch', name: 'main', remote: 'origin' },
      ]),
      makeCommit('c1', []),
    ];
    const graph = buildFullGraph(commits);
    expect(graph.dots[0].type).toBe('head');
  });

  it('should NOT mark as remote-tip when commit has tag ref', () => {
    const commits = [
      makeCommit('c2', ['c1'], [
        { type: 'tag', name: 'v1.0' },
        { type: 'remote-branch', name: 'main', remote: 'origin' },
      ]),
      makeCommit('c1', []),
    ];
    const graph = buildFullGraph(commits);
    expect(graph.dots[0].type).not.toBe('remote-tip');
  });

  it('should not generate paths for remote-tip commits', () => {
    const commits = [
      makeCommit('c3', ['c2'], [{ type: 'remote-branch', name: 'feature', remote: 'origin' }]),
      makeCommit('c2', ['c1'], [{ type: 'branch', name: 'feature' }]),
      makeCommit('c1', []),
    ];
    const graph = buildFullGraph(commits);
    expect(graph.dots[0].type).toBe('remote-tip');
    expect(graph.dots[0].center).toBeDefined();
    const remoteTipY = graph.dots[0].center.y;
    const pathsStartingAtTip = graph.paths.filter(p =>
      p.points.length > 0 && p.points[0].y === remoteTipY
    );
    expect(pathsStartingAtTip).toHaveLength(0);
  });

  it('should not generate links for remote-tip merge commits', () => {
    const commits = [
      makeCommit('c4', ['c2', 'c3'], [{ type: 'remote-branch', name: 'main', remote: 'origin' }]),
      makeCommit('c3', ['c1']),
      makeCommit('c2', ['c1'], [{ type: 'branch', name: 'main' }]),
      makeCommit('c1', []),
    ];
    const graph = buildFullGraph(commits);
    expect(graph.dots[0].type).toBe('remote-tip');
    const remoteTipY = graph.dots[0].center.y;
    const linksFromTip = graph.links.filter(l => l.start.y === remoteTipY);
    expect(linksFromTip).toHaveLength(0);
  });
});
