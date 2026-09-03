import { describe, it, expect } from 'vitest';
import { applyAutosquash, hasAutosquashTargets, type AutosquashTodo } from '../autosquash';

// Helper: build a pick todo from a subject (hash derived from subject for readability).
function pick(hash: string, subject: string, body = ''): AutosquashTodo {
  return { action: 'pick', hash, subject, body };
}

// Compact view for asserting order + action.
const view = (todos: AutosquashTodo[]) => todos.map(t => `${t.action}:${t.hash}`);

describe('hasAutosquashTargets', () => {
  it('is false when no fixup!/squash! commits are present', () => {
    expect(hasAutosquashTargets([pick('a', 'Add feature'), pick('b', 'Add tests')])).toBe(false);
  });

  it('is true when a fixup! commit is present', () => {
    expect(hasAutosquashTargets([pick('a', 'Add feature'), pick('b', 'fixup! Add feature')])).toBe(true);
  });

  it('is true when a squash! commit is present', () => {
    expect(hasAutosquashTargets([pick('a', 'Add feature'), pick('b', 'squash! Add feature')])).toBe(true);
  });

  it('is true when an amend! commit is present', () => {
    expect(hasAutosquashTargets([pick('a', 'Add feature'), pick('b', 'amend! Add feature')])).toBe(true);
  });
});

describe('applyAutosquash', () => {
  it('moves a fixup! commit directly below its target and sets action=fixup', () => {
    const todos = [
      pick('a', 'Add feature'),
      pick('b', 'Unrelated work'),
      pick('c', 'fixup! Add feature'),
    ];
    expect(view(applyAutosquash(todos))).toEqual(['pick:a', 'fixup:c', 'pick:b']);
  });

  it('sets action=squash for a squash! commit', () => {
    const todos = [
      pick('a', 'Add feature'),
      pick('b', 'squash! Add feature'),
    ];
    expect(view(applyAutosquash(todos))).toEqual(['pick:a', 'squash:b']);
  });

  it('places multiple fixups for the same target in encountered order after it', () => {
    const todos = [
      pick('a', 'Add feature'),
      pick('b', 'Other'),
      pick('c', 'fixup! Add feature'),
      pick('d', 'fixup! Add feature'),
    ];
    expect(view(applyAutosquash(todos))).toEqual(['pick:a', 'fixup:c', 'fixup:d', 'pick:b']);
  });

  it('chains fixup! of a fixup! onto the same group', () => {
    const todos = [
      pick('a', 'Add feature'),
      pick('b', 'fixup! Add feature'),
      pick('c', 'fixup! fixup! Add feature'),
    ];
    expect(view(applyAutosquash(todos))).toEqual(['pick:a', 'fixup:b', 'fixup:c']);
  });

  it('leaves an unmatched fixup! as pick in place', () => {
    const todos = [
      pick('a', 'Add feature'),
      pick('b', 'fixup! Nonexistent commit'),
    ];
    expect(view(applyAutosquash(todos))).toEqual(['pick:a', 'pick:b']);
  });

  it('preserves the relative order of non-matching commits', () => {
    const todos = [
      pick('a', 'First'),
      pick('b', 'Second'),
      pick('c', 'fixup! First'),
      pick('d', 'Third'),
    ];
    expect(view(applyAutosquash(todos))).toEqual(['pick:a', 'fixup:c', 'pick:b', 'pick:d']);
  });

  it('does not let the first todo become a fixup/squash (matches HEAD~ boundary)', () => {
    // A fixup! whose only possible target is itself first → stays pick, never first squash.
    const todos = [
      pick('a', 'fixup! Add feature'),
      pick('b', 'Add feature'),
    ];
    const result = applyAutosquash(todos);
    expect(result[0].action).toBe('pick');
  });

  it('folds an amend! commit in as fixup and rewords the target with its body', () => {
    const todos = [
      pick('a', 'Add feature'),
      pick('b', 'amend! Add feature', 'Rewritten feature message'),
    ];
    const result = applyAutosquash(todos);

    expect(view(result)).toEqual(['reword:a', 'fixup:b']);
    expect(result[0].newMessage).toBe('Rewritten feature message');
  });

  it('folds an amend! commit with an empty body in as a plain fixup (no reword)', () => {
    const todos = [
      pick('a', 'Add feature'),
      pick('b', 'amend! Add feature'),
    ];
    const result = applyAutosquash(todos);

    expect(view(result)).toEqual(['pick:a', 'fixup:b']);
    expect(result[0].newMessage).toBeUndefined();
  });
});
