// Mirrored types from extension for use in webview

export interface Commit {
  hash: string;
  abbreviatedHash: string;
  author: PersonInfo;
  committer: PersonInfo;
  subject: string;
  body: string;
  parents: string[];
  refs: Ref[];
}

export interface PersonInfo {
  name: string;
  email: string;
  date: string;
}

export interface Ref {
  type: 'branch' | 'remote-branch' | 'tag' | 'head' | 'stash';
  name: string;
  remote?: string;
}

export interface GraphNode {
  commit: string;
  column: number;
  color: string;
  parents: ParentConnection[];
}

export interface ParentConnection {
  hash: string;
  column: number;
  color: string;
  waypoints?: Array<{ row: number; column: number }>;
}

export interface GraphPathData {
  points: Array<{ x: number; y: number }>;
  color: number;
}

export interface GraphLinkData {
  start: { x: number; y: number };
  control: { x: number; y: number };
  end: { x: number; y: number };
  color: number;
}

export interface GraphDotData {
  center: { x: number; y: number };
  color: number;
  type: 'default' | 'head' | 'merge';
  localOnly: boolean;
  remoteTip: boolean;
}

export interface CommitGraphData {
  commits: Commit[];
  graph: GraphNode[];
  paths?: GraphPathData[];
  links?: GraphLinkData[];
  dots?: GraphDotData[];
  commitLeftMargin?: number[];
}

export interface BranchInfo {
  name: string;
  current: boolean;
  remote?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  hash: string;
}

export interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface TagInfo {
  name: string;
  hash: string;
  message?: string;
  isAnnotated: boolean;
}

export interface StashEntry {
  index: number;
  message: string;
  date: string;
}

export interface BranchData {
  branches: BranchInfo[];
  tags: TagInfo[];
  remotes: RemoteInfo[];
  stashes: StashEntry[];
}

export interface DiffData {
  file: string;
  hunks: DiffHunk[];
  isBinary: boolean;
  isImage: boolean;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'add' | 'delete';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  isMain: boolean;
}
