import * as vscode from 'vscode';
import { normalizeInteractiveRebaseMode, type InteractiveRebaseMode } from '../git/classic-rebase';

/**
 * Reads the `gitGraphPlus.timeout` setting (in seconds) and returns the
 * equivalent in milliseconds for `GitService.setDefaultTimeout`. Falls back to
 * the 60s default when the value is missing or non-positive.
 */
export function readTimeoutMs(): number {
  const seconds = vscode.workspace.getConfiguration('gitGraphPlus').get<number>('timeout', 60);
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60000;
}

/** Default number of commits loaded on the first graph render / refresh. */
export const DEFAULT_INITIAL_COMMIT_COUNT = 200;
/** Default number of extra commits fetched each time "Load more" is clicked. */
export const DEFAULT_LOAD_MORE_COMMIT_COUNT = 50;

function readPositiveIntSetting(key: string, fallback: number): number {
  const raw = vscode.workspace.getConfiguration('gitGraphPlus').get<number>(key, fallback);
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : fallback;
}

/**
 * Reads `gitGraphPlus.initialCommitCount` — how many commits to load when the
 * graph first renders (and on refresh). Falls back to 200 when unset/invalid.
 */
export function readInitialCommitCount(): number {
  return readPositiveIntSetting('initialCommitCount', DEFAULT_INITIAL_COMMIT_COUNT);
}

/**
 * Reads `gitGraphPlus.loadMoreCommitCount` — how many additional commits each
 * "Load more" click fetches. Falls back to 50 when unset/invalid.
 */
export function readLoadMoreCommitCount(): number {
  return readPositiveIntSetting('loadMoreCommitCount', DEFAULT_LOAD_MORE_COMMIT_COUNT);
}

/**
 * Reads `gitGraphPlus.interactiveRebase.mode` — whether interactive rebase
 * opens the GUI editor (`ui`, default) or runs classic `git rebase -i` in the
 * integrated terminal (`classic`).
 */
export function readInteractiveRebaseMode(): InteractiveRebaseMode {
  return normalizeInteractiveRebaseMode(
    vscode.workspace.getConfiguration('gitGraphPlus').get<string>('interactiveRebase.mode', 'ui'),
  );
}

/**
 * Reads `gitGraphPlus.showAvatars` — whether author/committer avatars are
 * shown in the graph, hover cards, commit details, and stats view. Defaults to
 * true; only an explicit `false` disables them.
 */
export function readShowAvatars(): boolean {
  return vscode.workspace.getConfiguration('gitGraphPlus').get<boolean>('showAvatars', true) !== false;
}
