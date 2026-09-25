/**
 * Compare two filesystem paths for equality, tolerating the format differences
 * that arise between VS Code's `Uri.fsPath` (backslashes on Windows) and git's
 * `rev-parse --show-toplevel` output (forward slashes, lowercase drive letter).
 *
 * Without this, the repository dropdown matched the active repo by exact string
 * equality and fell back to `repos[0]` whenever the formats disagreed — showing
 * the wrong repository on Windows. See issue #30.
 */
function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  if (!a || !b) { return false; }
  return normalize(a) === normalize(b);
}

/**
 * Last segment of a filesystem path, used to label a repository whose entry is
 * missing from the discovered repo list (e.g. VS Code's SCM switched focus to a
 * repo the filesystem scan did not surface). Handles both separators so Windows
 * backslash paths work. See issue #96.
 */
export function repoNameFromPath(p: string): string {
  if (!p) { return ''; }
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}
