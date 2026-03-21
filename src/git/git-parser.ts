import type { Commit, Ref, BranchInfo, TagInfo, RemoteInfo, StashEntry, DiffData, DiffHunk, DiffLine, WorktreeInfo } from './types';

const RECORD_SEP = '\x01';
const FIELD_SEP = '\x00';

/**
 * Parse `git log --graph --format=<marker>fields` output.
 * Each commit line looks like:  "| * | \x01hash\x00abbrev\x00..."
 * Non-commit lines are pure graph characters: "| | |", "| |/", etc.
 *
 * We extract:
 * - commits: structured Commit objects
 * - graphLines: one string per commit, containing only the graph prefix chars
 *   from which we determine the node column (position of '*').
 */
export function parseGraphLog(raw: string, marker = '\x1E', sep = '\x1F', remoteNames?: string[]): { commits: Commit[]; graphLines: string[] } {
  if (!raw.trim()) {
    return { commits: [], graphLines: [] };
  }

  const commits: Commit[] = [];
  const graphLines: string[] = [];

  const lines = raw.split('\n');

  for (const line of lines) {
    const markerIdx = line.indexOf(marker);
    if (markerIdx === -1) {
      // Pure graph line (between commits) — skip
      continue;
    }

    // Graph prefix is everything before the marker
    const graphPrefix = line.substring(0, markerIdx);
    const dataStr = line.substring(markerIdx + 1);

    // Parse commit fields
    const fields = dataStr.split(sep);
    const hash = fields[0]?.trim() ?? '';
    if (!hash) continue;

    const abbreviatedHash = fields[1] ?? '';
    const authorName = fields[2] ?? '';
    const authorEmail = fields[3] ?? '';
    const authorDate = fields[4] ?? '';
    const committerName = fields[5] ?? '';
    const committerEmail = fields[6] ?? '';
    const committerDate = fields[7] ?? '';
    const subject = fields[8] ?? '';
    const parentStr = fields[9] ?? '';
    const refStr = fields[10]?.trim() ?? '';

    const parents = parentStr.trim() ? parentStr.trim().split(' ') : [];
    const refs = refStr ? parseRefs(refStr, remoteNames) : [];

    commits.push({
      hash,
      abbreviatedHash,
      author: { name: authorName, email: authorEmail, date: authorDate },
      committer: { name: committerName, email: committerEmail, date: committerDate },
      subject,
      body: '',
      parents,
      refs,
    });

    graphLines.push(graphPrefix);
  }

  return { commits, graphLines };
}

export function parseLog(raw: string, remoteNames?: string[]): Commit[] {
  if (!raw.trim()) {
    return [];
  }

  const records = raw.split(RECORD_SEP).filter((r) => r.trim());
  return records.map(r => parseCommitRecord(r, remoteNames));
}

function parseCommitRecord(record: string, remoteNames?: string[]): Commit {
  const fields = record.split(FIELD_SEP);

  const hash = fields[0]?.trim() ?? '';
  const abbreviatedHash = fields[1] ?? '';
  const authorName = fields[2] ?? '';
  const authorEmail = fields[3] ?? '';
  const authorDate = fields[4] ?? '';
  const committerName = fields[5] ?? '';
  const committerEmail = fields[6] ?? '';
  const committerDate = fields[7] ?? '';
  const subject = fields[8] ?? '';
  const parentStr = fields[9] ?? '';
  const refStr = fields[10]?.trim() ?? '';
  const body = (fields[11] ?? '').trim();

  const parents = parentStr.trim() ? parentStr.trim().split(' ') : [];
  const refs = refStr ? parseRefs(refStr, remoteNames) : [];

  return {
    hash,
    abbreviatedHash,
    author: { name: authorName, email: authorEmail, date: authorDate },
    committer: { name: committerName, email: committerEmail, date: committerDate },
    subject,
    body,
    parents,
    refs,
  };
}

export function parseRefs(refStr: string, remoteNames?: string[]): Ref[] {
  if (!refStr.trim()) {
    return [];
  }

  const knownRemotes = new Set(remoteNames ?? []);

  return refStr.split(',').map((r) => r.trim()).filter(Boolean).map((refName): Ref => {
    // HEAD -> main
    if (refName.startsWith('HEAD -> ')) {
      return { type: 'head', name: refName.replace('HEAD -> ', '') };
    }
    // HEAD (detached)
    if (refName === 'HEAD') {
      return { type: 'head', name: 'HEAD' };
    }
    // stash ref
    if (refName === 'refs/stash' || refName === 'stash') {
      return { type: 'stash', name: 'stash' };
    }
    // tag: v1.0
    if (refName.startsWith('tag: ')) {
      return { type: 'tag', name: refName.replace('tag: ', '') };
    }
    // Remote branch: only if prefix matches a known remote name
    if (refName.includes('/')) {
      const slashIndex = refName.indexOf('/');
      const prefix = refName.substring(0, slashIndex);

      if (knownRemotes.has(prefix)) {
        return {
          type: 'remote-branch',
          name: refName.substring(slashIndex + 1),
          remote: prefix,
        };
      }
      // Not a known remote → treat as local branch (e.g. feat/login)
      return { type: 'branch', name: refName };
    }
    // local branch
    return { type: 'branch', name: refName };
  });
}

export function parseBranches(raw: string): BranchInfo[] {
  if (!raw.trim()) {
    return [];
  }

  return raw.trim().split('\n').filter(Boolean).map((line) => {
    const current = line.startsWith('*');
    const rest = current ? line.substring(1) : line;
    const fields = rest.split(FIELD_SEP);

    const name = fields[0]?.trim() ?? '';
    const hash = fields[1]?.trim() ?? '';
    const upstream = fields[2]?.trim() || undefined;
    const trackStr = fields[3]?.trim() ?? '';

    let ahead = 0;
    let behind = 0;
    const aheadMatch = trackStr.match(/ahead (\d+)/);
    const behindMatch = trackStr.match(/behind (\d+)/);
    if (aheadMatch) { ahead = parseInt(aheadMatch[1], 10); }
    if (behindMatch) { behind = parseInt(behindMatch[1], 10); }

    // Use full refname to distinguish local from remote branches
    const fullRefname = fields[4]?.trim() ?? '';
    const isRemote = fullRefname.startsWith('refs/remotes/');
    const remote = isRemote ? name.split('/')[0] : undefined;

    return { name, current, remote, upstream, ahead, behind, hash };
  }).filter(b => b.name.length > 0);
}

export function parseTags(raw: string): TagInfo[] {
  if (!raw.trim()) {
    return [];
  }

  return raw.trim().split('\n').filter(Boolean).map((line) => {
    const fields = line.split(FIELD_SEP);
    const name = fields[0]?.trim() ?? '';
    const hash = fields[1]?.trim() ?? '';
    const objectType = fields[2]?.trim() ?? '';
    const message = fields[3]?.trim() || undefined;

    return {
      name,
      hash,
      message,
      isAnnotated: objectType === 'tag',
    };
  });
}

export function parseRemotes(raw: string): RemoteInfo[] {
  if (!raw.trim()) {
    return [];
  }

  const remoteMap = new Map<string, RemoteInfo>();

  raw.trim().split('\n').filter(Boolean).forEach((line) => {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!match) { return; }

    const [, name, url, type] = match;
    if (!remoteMap.has(name)) {
      remoteMap.set(name, { name, fetchUrl: '', pushUrl: '' });
    }
    const remote = remoteMap.get(name)!;
    if (type === 'fetch') {
      remote.fetchUrl = url;
    } else {
      remote.pushUrl = url;
    }
  });

  return Array.from(remoteMap.values());
}

export function parseDiff(raw: string, file?: string): DiffData[] {
  if (!raw.trim()) {
    return [];
  }

  const results: DiffData[] = [];
  // Split by "diff --git" to get per-file diffs
  const fileDiffs = raw.split(/^diff --git /m).filter(Boolean);

  for (const fileDiff of fileDiffs) {
    const lines = fileDiff.split('\n');
    // Parse file path from "a/path b/path" or quoted paths like "\"a/path\" \"b/path\""
    let filePath: string;
    const header = lines[0] ?? '';
    const quotedMatch = header.match(/^"?a\/(.+?)"?\s+"?b\/(.+?)"?\s*$/);
    if (quotedMatch) {
      // Unescape git's quoted path encoding (e.g. \t, \n, octal \NNN)
      filePath = unescapeGitPath(quotedMatch[2]);
    } else {
      const headerMatch = header.match(/a\/(.+?) b\/(.+)/);
      filePath = headerMatch ? headerMatch[2] : file ?? 'unknown';
    }

    // Check if binary
    const isBinary = fileDiff.includes('Binary files');
    const isImage = /\.(png|jpg|jpeg|gif|bmp|svg|webp|ico)$/i.test(filePath);

    if (isBinary) {
      results.push({ file: filePath, hunks: [], isBinary: true, isImage });
      continue;
    }

    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let oldLineNum = 0;
    let newLineNum = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      // Hunk header: @@ -oldStart,oldLines +newStart,newLines @@
      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
      if (hunkMatch) {
        const oldStart = parseInt(hunkMatch[1], 10) || 0;
        const oldLines = parseInt(hunkMatch[2] ?? '1', 10) || 1;
        const newStart = parseInt(hunkMatch[3], 10) || 0;
        const newLines = parseInt(hunkMatch[4] ?? '1', 10) || 1;

        currentHunk = {
          header: line,
          oldStart,
          oldLines,
          newStart,
          newLines,
          lines: [],
        };
        hunks.push(currentHunk);
        oldLineNum = oldStart;
        newLineNum = newStart;
        continue;
      }

      if (!currentHunk) { continue; }

      if (line.startsWith('+')) {
        currentHunk.lines.push({
          type: 'add',
          content: line.substring(1),
          newLineNumber: newLineNum,
        });
        newLineNum++;
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({
          type: 'delete',
          content: line.substring(1),
          oldLineNumber: oldLineNum,
        });
        oldLineNum++;
      } else if (line.startsWith(' ') || line === '') {
        currentHunk.lines.push({
          type: 'context',
          content: line.startsWith(' ') ? line.substring(1) : line,
          oldLineNumber: oldLineNum,
          newLineNumber: newLineNum,
        });
        oldLineNum++;
        newLineNum++;
      }
    }

    results.push({ file: filePath, hunks, isBinary: false, isImage });
  }

  return results;
}

export function parseStashList(raw: string): StashEntry[] {
  if (!raw.trim()) {
    return [];
  }

  return raw.trim().split('\n').filter(Boolean).map((line) => {
    const fields = line.split(FIELD_SEP);
    const refStr = fields[0]?.trim() ?? '';
    const message = fields[1]?.trim() ?? '';
    const date = fields[2]?.trim() ?? '';

    const parents = fields[3]?.trim() ?? '';
    const parentHash = parents.split(' ')[0] || undefined;
    const hash = fields[4]?.trim() || undefined;

    const indexMatch = refStr.match(/stash@\{(\d+)\}/);
    const index = indexMatch ? parseInt(indexMatch[1], 10) : 0;

    return { index, message, date, parentHash, hash };
  });
}


export function parseWorktreeList(raw: string): WorktreeInfo[] {
  if (!raw.trim()) {
    return [];
  }

  const worktrees: WorktreeInfo[] = [];
  const blocks = raw.trim().split('\n\n');

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block.trim()) continue;

    const lines = block.split('\n');
    let wtPath = '';
    let hash = '';
    let branch = '';
    let detached = false;
    let locked = false;
    let prunable = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        wtPath = line.substring(9);
      } else if (line.startsWith('HEAD ')) {
        hash = line.substring(5);
      } else if (line.startsWith('branch ')) {
        // refs/heads/main -> main
        branch = line.substring(7).replace(/^refs\/heads\//, '');
      } else if (line === 'detached') {
        detached = true;
      } else if (line === 'locked' || line.startsWith('locked ')) {
        locked = true;
      } else if (line === 'prunable' || line.startsWith('prunable ')) {
        prunable = true;
      }
    }

    if (wtPath) {
      worktrees.push({
        path: wtPath,
        hash,
        branch,
        detached,
        locked,
        prunable,
        isMain: i === 0,
      });
    }
  }

  return worktrees;
}

export function parseLfsFiles(raw: string): Array<{ oid: string; path: string }> {
  if (!raw.trim()) { return []; }
  return raw.trim().split('\n').filter(Boolean).map(line => {
    const parts = line.split(/\s+[-*]\s+/);
    return { oid: parts[0]?.trim() ?? '', path: parts[1]?.trim() ?? '' };
  });
}

export function parseLfsLocks(raw: string): Array<{ path: string; owner: string; id: string }> {
  if (!raw.trim()) { return []; }
  return raw.trim().split('\n').filter(Boolean).map(line => {
    const parts = line.split('\t');
    return { path: parts[0]?.trim() ?? '', owner: parts[1]?.trim() ?? '', id: parts[2]?.trim() ?? '' };
  });
}

function unescapeGitPath(p: string): string {
  // Remove surrounding quotes if present
  if (p.startsWith('"') && p.endsWith('"')) {
    p = p.slice(1, -1);
  }
  // Unescape common git escape sequences
  return p.replace(/\\([nrt\\"])|\\([0-3][0-7]{2})/g, (_, esc, oct) => {
    if (oct) { return String.fromCharCode(parseInt(oct, 8)); }
    switch (esc) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case '\\': return '\\';
      case '"': return '"';
      default: return esc;
    }
  });
}

