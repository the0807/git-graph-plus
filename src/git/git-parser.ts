import type { Commit, Ref, SignatureStatus, BranchInfo, TagInfo, RemoteInfo, StashEntry, DiffData, DiffHunk, DiffLine, WorktreeInfo } from './types';

/** Map git's `%G?` signature verification code to our 3-state enum.
 *  `G` = valid signature → good; `N` = no signature → none; everything else
 *  (`B` bad, `U` unknown validity, `X` expired sig, `Y` expired key, `R`
 *  revoked key, `E` cannot check) collapses to unverified. Returns undefined
 *  for an empty code (signature column not requested). */
export function mapSignatureStatus(code: string): SignatureStatus | undefined {
  const c = code.trim();
  if (!c) return undefined;
  switch (c) {
    case 'G': return 'good';
    case 'N': return 'none';
    default: return 'unverified';
  }
}

// 3-byte sentinel for record boundaries. A single \x01 can be embedded in
// commit subjects/bodies and tag messages by any contributor (`git commit -m`
// preserves arbitrary unicode), which would split one record into two phantom
// records. Three control bytes in a row are effectively impossible to type
// and never appear in normal git output, so this is collision-free.
const RECORD_SEP = '\x01\x02\x03';
const FIELD_SEP = '\x00';

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
  // Appended after %b only when the log was fetched with signature verification;
  // absent (undefined) otherwise. Body never contains a NUL, so this column stays
  // unambiguous even for multi-line bodies.
  const signatureCode = fields[12];

  const parents = parentStr.trim() ? parentStr.trim().split(' ') : [];
  const refs = refStr ? parseRefs(refStr, remoteNames) : [];

  const commit: Commit = {
    hash,
    abbreviatedHash,
    author: { name: authorName, email: authorEmail, date: authorDate },
    committer: { name: committerName, email: committerEmail, date: committerDate },
    subject,
    body,
    parents,
    refs,
  };

  if (signatureCode !== undefined) {
    const status = mapSignatureStatus(signatureCode);
    if (status) commit.signatureStatus = status;
  }

  return commit;
}

/** Split an upstream ref like "origin/feature/x" into its remote and branch.
 *  The first path segment is the remote; everything after is the branch name,
 *  which may itself contain slashes (e.g. "feature/x"). */
export function splitUpstreamRef(upstream: string): { remote: string; branch: string } {
  const [remote, ...rest] = upstream.split('/');
  return { remote, branch: rest.join('/') };
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

    const rawName = fields[0]?.trim() ?? '';
    const hash = fields[1]?.trim() ?? '';
    const upstream = fields[2]?.trim() || undefined;
    const trackStr = fields[3]?.trim() ?? '';

    let ahead = 0;
    let behind = 0;
    const aheadMatch = trackStr.match(/ahead (\d+)/);
    const behindMatch = trackStr.match(/behind (\d+)/);
    if (aheadMatch) { ahead = parseInt(aheadMatch[1], 10); }
    if (behindMatch) { behind = parseInt(behindMatch[1], 10); }
    // git reports "gone" when the upstream config still points at a remote
    // branch that no longer exists (e.g. after deleting the remote branch).
    const upstreamGone = trackStr === 'gone';

    // Use full refname to distinguish local from remote branches
    const fullRefname = fields[4]?.trim() ?? '';
    const isRemote = fullRefname.startsWith('refs/remotes/');
    const remote = isRemote ? rawName.split('/')[0] : undefined;
    // Strip heads/ prefix added by git when tag and branch names collide
    const name = !isRemote && rawName.startsWith('heads/') ? rawName.substring(6) : rawName;

    return { name, current, remote, upstream, upstreamGone, ahead, behind, hash };
  }).filter(b => b.name.length > 0);
}

export function parseTags(raw: string): TagInfo[] {
  if (!raw.trim()) {
    return [];
  }

  return raw.split(RECORD_SEP).filter(s => s.trim()).map((record) => {
    const fields = record.split(FIELD_SEP);
    const name = fields[0]?.trim() ?? '';
    const hash = fields[1]?.trim() ?? '';
    const objectType = fields[2]?.trim() ?? '';
    const subject = fields[3]?.trim() ?? '';
    const body = fields[4]?.trim() ?? '';

    let message: string | undefined;
    if (subject) {
      message = body ? `${subject}\n\n${body}` : subject;
    }

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
    // Prefer the +++/--- header lines: they each carry the full path on their
    // own line, so they stay unambiguous even when the path contains spaces or
    // a literal " b/" substring that would mis-split the "diff --git" header.
    const bodyPaths = resolveDiffPathsFromBody(lines);
    let oldFile = bodyPaths.oldPath;
    let newFile = bodyPaths.newPath;
    let filePath = newFile ?? oldFile ?? '';
    if (!filePath) {
      // Fallback for diffs without +++/--- lines (e.g. pure mode/rename headers):
      // parse "a/path b/path" or quoted paths like "\"a/path\" \"b/path\"".
      const header = lines[0] ?? '';
      const quotedMatch = header.match(/^"?a\/(.+?)"?\s+"?b\/(.+?)"?\s*$/);
      if (quotedMatch) {
        // Unescape git's quoted path encoding (e.g. \t, \n, octal \NNN)
        oldFile = unescapeGitPath(quotedMatch[1]);
        newFile = unescapeGitPath(quotedMatch[2]);
        filePath = newFile;
      } else {
        const headerMatch = header.match(/a\/(.+?) b\/(.+)/);
        if (headerMatch) {
          oldFile = headerMatch[1];
          newFile = headerMatch[2];
          filePath = newFile;
        } else {
          filePath = file ?? 'unknown';
          oldFile = filePath;
          newFile = filePath;
        }
      }
    }

    // Check if binary
    const isBinary = fileDiff.includes('Binary files');
    const isImage = /\.(png|jpg|jpeg|gif|bmp|svg|webp|ico)$/i.test(filePath);

    if (isBinary) {
      const diff: DiffData = { file: filePath, hunks: [], isBinary: true, isImage };
      if (oldFile && oldFile !== filePath) diff.oldFile = oldFile;
      if (newFile && newFile !== filePath) diff.newFile = newFile;
      results.push(diff);
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
      } else if (line.startsWith(' ') || (line === '' && i < lines.length - 1)) {
        // Context line. A blank context line may arrive as " " (git's normal
        // output) or, if trailing whitespace was stripped, as "". The final
        // empty string is always the trailing-newline artifact from split('\n'),
        // not real content — skip it (`i < lines.length - 1`) so it doesn't
        // become a phantom context line that also bumps the trailing line numbers.
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

    const diff: DiffData = { file: filePath, hunks, isBinary: false, isImage };
    if (oldFile && oldFile !== filePath) diff.oldFile = oldFile;
    if (newFile && newFile !== filePath) diff.newFile = newFile;
    results.push(diff);
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

/** Resolve pre/post image paths from the +++/--- header lines of a single file
 *  diff. /dev/null is omitted so additions/deletions naturally have only one
 *  populated side. */
function resolveDiffPathsFromBody(lines: string[]): { oldPath?: string; newPath?: string } {
  let plusPath: string | null = null;
  let minusPath: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Stop at the first hunk: beyond it, content lines may legitimately start
    // with "+++ " / "--- " and must not be mistaken for header lines.
    if (line.startsWith('@@')) break;
    if (line.startsWith('+++ ')) plusPath = stripDiffPathPrefix(line.slice(4));
    else if (line.startsWith('--- ')) minusPath = stripDiffPathPrefix(line.slice(4));
  }
  return {
    oldPath: minusPath ?? undefined,
    newPath: plusPath ?? undefined,
  };
}

/** Strip the leading `a/` or `b/` from a +++/--- path, unescape git quoting,
 *  and map /dev/null (add/delete sentinel) to null. */
function stripDiffPathPrefix(raw: string): string | null {
  let s = raw.replace(/\r$/, '');
  if (s.startsWith('"')) {
    // Quoted form wraps the whole "b/path" (with \t, octal escapes, etc).
    s = unescapeGitPath(s);
  } else {
    // git only appends a "\t<timestamp>" tail in the unquoted form.
    const tab = s.indexOf('\t');
    if (tab !== -1) s = s.slice(0, tab);
  }
  if (s === '/dev/null') return null;
  if (s.startsWith('a/') || s.startsWith('b/')) s = s.slice(2);
  return s || null;
}

function unescapeGitPath(p: string): string {
  // Remove surrounding quotes if present
  if (p.startsWith('"') && p.endsWith('"')) {
    p = p.slice(1, -1);
  }
  // git emits non-ASCII bytes as runs of octal escapes (\NNN\NNN\NNN per
  // UTF-8 sequence). Collect consecutive runs into a byte buffer so we can
  // decode the multi-byte sequence as UTF-8 in one shot — `\355\225\234` is
  // "한" (U+D55C), not three U+00xx chars.
  let result = '';
  let i = 0;
  while (i < p.length) {
    if (p[i] === '\\' && i + 3 < p.length && /[0-3]/.test(p[i + 1]) && /[0-7]/.test(p[i + 2]) && /[0-7]/.test(p[i + 3])) {
      const bytes: number[] = [];
      while (i < p.length && p[i] === '\\' && i + 3 < p.length && /[0-3]/.test(p[i + 1]) && /[0-7]/.test(p[i + 2]) && /[0-7]/.test(p[i + 3])) {
        bytes.push(parseInt(p.slice(i + 1, i + 4), 8));
        i += 4;
      }
      result += Buffer.from(bytes).toString('utf-8');
      continue;
    }
    if (p[i] === '\\' && i + 1 < p.length) {
      const esc = p[i + 1];
      switch (esc) {
        case 'n': result += '\n'; break;
        case 'r': result += '\r'; break;
        case 't': result += '\t'; break;
        case '\\': result += '\\'; break;
        case '"': result += '"'; break;
        default: result += esc;
      }
      i += 2;
      continue;
    }
    result += p[i];
    i++;
  }
  return result;
}

