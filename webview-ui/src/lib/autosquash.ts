/**
 * Client-side autosquash arrangement for the interactive rebase UI.
 *
 * Mirrors `git rebase --autosquash`: `fixup! <subject>` / `squash! <subject>`
 * commits are moved directly below the commit they target and their action is
 * set to `fixup` / `squash`. The actual rebase is still applied through the
 * existing interactiveRebase path — this only rearranges the todo list.
 */

export interface AutosquashTodo {
  action: 'pick' | 'squash' | 'fixup' | 'reword' | 'edit' | 'drop';
  hash: string;
  subject: string;
  body: string;
  newMessage?: string;
}

const PREFIX_RE = /^(fixup|squash|amend)! (.+)$/;

interface Parsed {
  kind: 'fixup' | 'squash' | 'amend';
  /** The subject the prefix points at (the text after `fixup! `/`squash! `/`amend! `). */
  target: string;
}

function parsePrefix(subject: string): Parsed | null {
  const m = PREFIX_RE.exec(subject);
  if (!m) return null;
  return { kind: m[1] as 'fixup' | 'squash' | 'amend', target: m[2] };
}

/** True if any todo is a `fixup!` / `squash!` / `amend!` commit that could be autosquashed. */
export function hasAutosquashTargets(todos: AutosquashTodo[]): boolean {
  return todos.some(t => parsePrefix(t.subject) !== null);
}

/**
 * Returns a new todo array with fixup!/squash!/amend! commits grouped under
 * their targets. Non-matching commits keep their relative order. A prefix
 * commit with no preceding target is left as `pick` in place.
 *
 * `amend!` commits are the `git commit --fixup=amend:<hash>` form: their
 * changes fold into the target like a `fixup`, but the target is reworded with
 * the amend commit's body (the text after `amend! <subject>`) — matching git's
 * own `fixup -C` autosquash behaviour.
 */
export function applyAutosquash(todos: AutosquashTodo[]): AutosquashTodo[] {
  // Resolve each commit's "match key": the subject git would compare against.
  // For a prefix commit, that is the inner target subject; chaining
  // (`fixup! fixup! X`) collapses to the innermost subject so the whole chain
  // lands on the same target group.
  const matchKey = (subject: string): string => {
    let s = subject;
    let parsed = parsePrefix(s);
    while (parsed) {
      s = parsed.target;
      parsed = parsePrefix(s);
    }
    return s;
  };

  // Build the result by walking the original order. Each non-prefix commit
  // anchors a group; matching prefix commits attach to the nearest preceding
  // group with the same key.
  const result: AutosquashTodo[] = [];
  // Index in `result` of the last todo belonging to each group key.
  const groupEnd = new Map<string, number>();
  // Index in `result` of the first (anchor) todo of each group key — needed to
  // reword the target when an `amend!` commit attaches to it.
  const groupStart = new Map<string, number>();

  for (const todo of todos) {
    const parsed = parsePrefix(todo.subject);
    if (parsed) {
      const key = matchKey(todo.subject);
      const insertAfter = groupEnd.get(key);
      if (insertAfter !== undefined) {
        const placed: AutosquashTodo = {
          ...todo,
          action: parsed.kind === 'amend' ? 'fixup' : parsed.kind,
          newMessage: undefined,
        };
        result.splice(insertAfter + 1, 0, placed);
        // Shift group-end/start indices that sit at/after the insertion point,
        // then extend this group's end to the freshly placed member. A later
        // chained prefix commit resolves to the same key and attaches here.
        for (const [k, idx] of groupEnd) {
          if (idx > insertAfter) groupEnd.set(k, idx + 1);
        }
        for (const [k, idx] of groupStart) {
          if (idx > insertAfter) groupStart.set(k, idx + 1);
        }
        groupEnd.set(key, insertAfter + 1);

        if (parsed.kind === 'amend') {
          const targetIdx = groupStart.get(key);
          if (targetIdx !== undefined) {
            const newMessage = todo.body?.trim();
            if (newMessage) {
              result[targetIdx] = { ...result[targetIdx], action: 'reword', newMessage };
            }
          }
        }
        continue;
      }
      // No preceding target — leave as pick where it is.
      result.push({ ...todo });
      groupEnd.set(todo.subject, result.length - 1);
      groupStart.set(todo.subject, result.length - 1);
      continue;
    }
    // Regular commit: anchors a group keyed by its subject.
    result.push({ ...todo });
    groupEnd.set(todo.subject, result.length - 1);
    groupStart.set(todo.subject, result.length - 1);
  }

  // Guard: the first todo can never be squash/fixup.
  if (result.length > 0 && (result[0].action === 'squash' || result[0].action === 'fixup')) {
    result[0] = { ...result[0], action: 'pick', newMessage: undefined };
  }

  return result;
}
