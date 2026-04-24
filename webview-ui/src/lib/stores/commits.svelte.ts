import type { Commit, GraphNode, CommitGraphData, GraphPathData, GraphLinkData, GraphDotData } from '../types';

class CommitStore {
  commits = $state<Commit[]>([]);
  graphNodes = $state<GraphNode[]>([]);
  paths = $state<GraphPathData[]>([]);
  links = $state<GraphLinkData[]>([]);
  dots = $state<GraphDotData[]>([]);
  commitLeftMargin = $state<number[]>([]);
  loading = $state(false);
  loadingMore = $state(false);
  hasMore = $state(false);
  currentLimit = $state(0);

  setData(data: CommitGraphData) {
    this.commits = data.commits;
    this.graphNodes = data.graph;
    this.paths = data.paths ?? [];
    this.links = data.links ?? [];
    this.dots = data.dots ?? [];
    this.commitLeftMargin = data.commitLeftMargin ?? [];
    this.hasMore = data.hasMore ?? false;
    if (data.currentLimit) this.currentLimit = data.currentLimit;
    this.loading = false;
    this.loadingMore = false;
  }

  setLoading(value: boolean) {
    this.loading = value;
  }

  setLoadingMore(value: boolean) {
    this.loadingMore = value;
  }

  getCommit(hash: string): Commit | undefined {
    return this.commits.find((c) => c.hash === hash);
  }

  getGraphNode(hash: string): GraphNode | undefined {
    return this.graphNodes.find((n) => n.commit === hash);
  }
}

export const commitStore = new CommitStore();
