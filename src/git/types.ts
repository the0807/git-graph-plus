export interface Commit {
  hash: string;
  abbreviatedHash: string;
  author: PersonInfo;
  committer: PersonInfo;
  subject: string;
  body: string;
  parents: string[];
  refs: Ref[];
  /** GPG/SSH signature verification status. Present only when the log was
   *  fetched with signature verification enabled (the graph setting); absent
   *  otherwise so the graph icon stays hidden and there is no perf cost. */
  signatureStatus?: SignatureStatus;
}

/** Simplified 3-state mapping of git's `%G?` verification codes. */
export type SignatureStatus = 'good' | 'none' | 'unverified';

/** On-demand signature details for a single commit (Details panel). */
export interface CommitSignature {
  status: SignatureStatus;
  signer?: string;
  keyId?: string;
}

export interface PersonInfo {
  name: string;
  email: string;
  date: string;
}

export interface Ref {
  type: 'branch' | 'remote-branch' | 'tag' | 'head' | 'stash' | 'working-dir';
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
  /** Intermediate column positions between child and parent rows (for rail shifts) */
  waypoints?: Array<{ row: number; column: number }>;
}

export interface GraphPathData {
  points: Array<{ x: number; y: number }>;
  color: number;
  colorOverride?: string;
}

export interface GraphLinkData {
  start: { x: number; y: number };
  control: { x: number; y: number };
  end: { x: number; y: number };
  color: number;
  colorOverride?: string;
}

export interface GraphDotData {
  center: { x: number; y: number };
  color: number;
  colorOverride?: string;
  type: 'default' | 'head' | 'merge' | 'remote-tip';
}

export interface CommitGraphData {
  commits: Commit[];
  graph: GraphNode[];
  paths?: GraphPathData[];
  links?: GraphLinkData[];
  dots?: GraphDotData[];
  commitLeftMargin?: number[];
  hasMore?: boolean;
  currentLimit?: number;
  remoteFilter?: string[];
  branches?: string[];
}

export interface BranchInfo {
  name: string;
  current: boolean;
  remote?: string;
  upstream?: string;
  /** True when the branch still has upstream config but the tracked remote
   *  branch no longer exists (git reports the track field as "gone"). */
  upstreamGone?: boolean;
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
  hash?: string;
  parentHash?: string;
}

export interface DiffData {
  file: string;
  oldFile?: string;
  newFile?: string;
  content?: DiffFileContent;
  hunks: DiffHunk[];
  isBinary: boolean;
  isImage: boolean;
}

export interface DiffFileContent {
  oldText: string;
  newText: string;
  oldPath: string;
  newPath: string;
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

export interface BranchData {
  branches: BranchInfo[];
  tags: TagInfo[];
  remotes: RemoteInfo[];
  stashes: StashEntry[];
  worktrees: WorktreeInfo[];
}

export interface WorktreeInfo {
  path: string;
  hash: string;
  branch: string;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  isMain: boolean;
}

export interface LogOptions {
  branch?: string;
  branches?: string[]; // 다중 브랜치 필터 (지정 시 glob 인자 대신 브랜치 이름을 직접 전달)
  limit?: number;
  all?: boolean;
  skip?: number;
  sortOrder?: 'author-date' | 'date' | 'topological';
  remoteFilter?: string[]; // undefined = all; ['local'] = local only; ['origin'] = origin only; etc.
  /** When true, include `%G?` in the log format so each commit carries a
   *  signatureStatus. Off by default — it forces GPG verification of every
   *  commit in the log, which is slow on large repos. */
  includeSignature?: boolean;
}
