/** Fragments git emits when a remote operation fails for credential reasons.
 *  Used to decide whether to surface the credential-help UI. SSH-key failures
 *  (`Permission denied (publickey)`, `Host key verification failed`) are
 *  included because the UI still has useful SSH guidance for them. */
const AUTH_FAILURE_RE = /terminal prompts disabled|Authentication failed|could not read Username|could not read Password|Permission denied.*publickey|Host key verification failed|Could not read from remote/;

export function isAuthFailure(stderr: string): boolean {
  return AUTH_FAILURE_RE.test(stderr);
}

/** Classify a remote URL's transport so the UI can show the right hint
 *  (SSH key vs HTTPS credential helper). */
export function transportFromRemoteUrl(url: string): 'ssh' | 'https' | 'unknown' {
  if (url.startsWith('git@') || url.startsWith('ssh://')) return 'ssh';
  if (url.startsWith('https://') || url.startsWith('http://')) return 'https';
  return 'unknown';
}

/** Join up to three message fragments, summarising any overflow. Mirrors the
 *  file-list truncation so long server output can't flood the error toast. */
function joinCapped(parts: string[]): string {
  return parts.length <= 3
    ? parts.join(' ')
    : `${parts.slice(0, 3).join(' ')} (+${parts.length - 3} more)`;
}

export function formatGitError(stderr: string): string {
  // git pads `remote:` lines with trailing spaces; strip them so joined
  // messages stay clean.
  let rawLines = stderr.split('\n').map(l => l.replace(/\s+$/, ''));
  const actionableLines = rawLines.filter(l => l.trim() !== 'Using default branch names.');
  if (actionableLines.length > 0) rawLines = actionableLines;
  if (rawLines.every(l => l.length === 0)) return stderr.trim();

  // 1. Remote server error/fatal lines are most specific (e.g. GitHub rule
  //    violations). There are often several — the actionable cause is
  //    frequently on the *second* line — so surface them all, not just the first.
  const remoteErrors = rawLines
    .filter(l => /^remote:\s*(error|fatal):/i.test(l))
    .map(l => l.replace(/^remote:\s*(error|fatal):\s*/i, '').trim())
    .filter(l => l.length > 0);
  if (remoteErrors.length > 0) {
    return joinCapped(remoteErrors);
  }

  // The parenthetical reason on a ref-update rejection is the most concise
  // cause, e.g. `! [rejected] main -> main (fetch first)` or
  // `! [remote rejected] main -> main (pre-receive hook declined)`.
  const rejectionLine = rawLines.find(l => /^\s*!\s*\[(?:remote )?rejected\]/i.test(l));
  const rejectionReason = rejectionLine?.match(/\(([^)]*)\)\s*$/)?.[1];

  // 2. Plain `remote:` messages (no error/fatal keyword) carry the
  //    human-readable reason for hook declines and push-protection blocks.
  const remoteMsgs = rawLines
    .filter(l => /^remote:/i.test(l))
    .map(l => l.replace(/^remote:\s?/i, '').trim())
    .filter(l => l.length > 0);
  if (remoteMsgs.length > 0) {
    const shown = joinCapped(remoteMsgs);
    return rejectionReason ? `${shown} (${rejectionReason})` : shown;
  }

  // 3. No server message, but the push/fetch was rejected — the generic
  //    "failed to push some refs" line says nothing about *why*, so surface the
  //    rejection line itself (e.g. `[rejected] main -> main (fetch first)`).
  if (rejectionLine) {
    return rejectionLine.trim().replace(/^!\s*/, '').replace(/\]\s+/, '] ');
  }

  // 4. Find first error/fatal/warning line
  const firstErrorIdx = rawLines.findIndex(l => /^(error|fatal|warning):/i.test(l));
  if (firstErrorIdx === -1) {
    const fallback = rawLines.find(l => l.trim() && !/^hint:/i.test(l));
    return (fallback ?? rawLines[0]).trim();
  }

  const mainMessage = rawLines[firstErrorIdx].replace(/^(error|fatal|warning):\s*/i, '').trim();

  // Collect tab-indented file lines immediately following the error
  const files: string[] = [];
  for (let i = firstErrorIdx + 1; i < rawLines.length; i++) {
    if (/^\t|^    /.test(rawLines[i])) {
      files.push(rawLines[i].trim());
    } else {
      break;
    }
  }

  if (files.length === 0) return mainMessage;

  const fileList = files.length <= 3
    ? files.join(', ')
    : `${files.slice(0, 3).join(', ')} (+${files.length - 3} more)`;

  return `${mainMessage}\n${fileList}`;
}
