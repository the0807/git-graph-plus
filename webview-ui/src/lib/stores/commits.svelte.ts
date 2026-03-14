import type { Commit, GraphNode, CommitGraphData, GraphPathData, GraphLinkData, GraphDotData } from '../types';

class CommitStore {
  commits = $state<Commit[]>([]);
  graphNodes = $state<GraphNode[]>([]);
  paths = $state<GraphPathData[]>([]);
  links = $state<GraphLinkData[]>([]);
  dots = $state<GraphDotData[]>([]);
  commitLeftMargin = $state<number[]>([]);
  loading = $state(false);

  setData(data: CommitGraphData) {
    this.commits = data.commits;
    this.graphNodes = data.graph;
    this.paths = data.paths ?? [];
    this.links = data.links ?? [];
    this.dots = data.dots ?? [];
    this.commitLeftMargin = data.commitLeftMargin ?? [];
    this.loading = false;
  }

  setLoading(value: boolean) {
    this.loading = value;
  }

  getCommit(hash: string): Commit | undefined {
    return this.commits.find((c) => c.hash === hash);
  }

  getGraphNode(hash: string): GraphNode | undefined {
    return this.graphNodes.find((n) => n.commit === hash);
  }
}

export const commitStore = new CommitStore();
