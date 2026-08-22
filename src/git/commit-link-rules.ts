export interface LinkRule {
  pattern: string;
  url: string;
}

interface RemoteInfo {
  host: string;
  owner: string;
  repo: string;
}

/**
 * Parse a git remote URL (ssh shorthand, ssh:// or https://) into host + owner + repo.
 * Returns null when the URL is not in a recognized owner/repo form.
 */
export function parseRemoteHost(url: string): RemoteInfo | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  const trimmed = url.trim();

  // ssh shorthand: git@host:owner/repo(.git)
  const ssh = trimmed.match(/^[^@\s]+@([^:/\s]+):(.+?)\/([^/\s]+?)(?:\.git)?\/?$/);
  if (ssh) return { host: ssh[1], owner: ssh[2], repo: ssh[3] };

  // ssh://, https://, http:// forms
  const proto = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s]+@)?([^:/\s]+)(?::\d+)?\/(.+?)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (proto) return { host: proto[1], owner: proto[2], repo: proto[3] };

  return null;
}

/**
 * Convert a git remote URL to the repository page that can be opened in a browser.
 */
export function remoteUrlToRepositoryWebUrl(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  const info = parseRemoteHost(remoteUrl);
  if (!info) return null;
  return `https://${info.host}/${info.owner}/${info.repo}`;
}

/**
 * Built-in auto-link rules derived from the repo's remote.
 *
 * `!N` (merge request) is GitLab-only syntax, so an `!N` rule is generated for
 * ANY host (including self-hosted GitLab). `#N` (issue) has a forge-specific
 * path, so it is only generated for the recognized SaaS hosts github.com and
 * gitlab.com; on self-hosted hosts the issue path is ambiguous and users add a
 * custom `commitMessageLinks` rule instead.
 */
export function buildBuiltinRules(remoteUrl: string | null): LinkRule[] {
  if (!remoteUrl) return [];
  const info = parseRemoteHost(remoteUrl);
  if (!info) return [];
  const base = remoteUrlToRepositoryWebUrl(remoteUrl);
  if (!base) return [];
  const rules: LinkRule[] = [
    // `!N` is GitLab-only — safe to link on any host.
    { pattern: '!(\\d+)', url: `${base}/-/merge_requests/$1` },
  ];
  if (info.host === 'github.com') {
    // GitHub redirects /issues/N to the PR when N is a PR, so one rule covers both.
    rules.push({ pattern: '#(\\d+)', url: `${base}/issues/$1` });
  } else if (info.host === 'gitlab.com') {
    rules.push({ pattern: '#(\\d+)', url: `${base}/-/issues/$1` });
  }
  return rules;
}

/**
 * Validate + compile user custom rules (skipping bad entries, like
 * compileBranchColorRules), then append built-in rules when autoDetect is on.
 * Custom rules come first so a user can override the built-in `#N` behaviour.
 */
export function resolveCommitLinkRules(
  customRaw: unknown,
  autoDetect: boolean,
  remoteUrl: string | null,
): LinkRule[] {
  const rules: LinkRule[] = [];
  if (Array.isArray(customRaw)) {
    for (const entry of customRaw) {
      if (!entry || typeof entry !== 'object') continue;
      const { pattern, url } = entry as Partial<LinkRule>;
      if (typeof pattern !== 'string' || typeof url !== 'string') continue;
      try {
        new RegExp(pattern); // validate; skip if it throws
      } catch {
        continue;
      }
      rules.push({ pattern, url });
    }
  }
  if (autoDetect) rules.push(...buildBuiltinRules(remoteUrl));
  return rules;
}
