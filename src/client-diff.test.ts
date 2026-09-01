import { expect, test } from 'vitest';
import { createNoteUpdatePlan } from './client-diff.js';

test('builds a minimal patch for a small replacement', () => {
  const plan = createNoteUpdatePlan('before\nkeep\nafter\n', 'before\nkeep\nchanged\n', 'a'.repeat(64));
  expect(plan).toMatchObject({ changed: true, mode: 'patch', expectedRevision: 'a'.repeat(64) });
  expect(plan.patches).toEqual([{ oldString: 'after', newString: 'changed' }]);
});

test('falls back to a full write when the diff is insertion-only or larger', () => {
  const insertion = createNoteUpdatePlan('same', 'same plus text', 'b'.repeat(64));
  expect(insertion).toMatchObject({ mode: 'write', content: 'same plus text', reason: 'insertion_only' });

  const deletion = createNoteUpdatePlan('remove this', '', 'c'.repeat(64));
  expect(deletion).toMatchObject({ mode: 'write', content: '', reason: 'patch_larger_than_write' });
});

test('does not emit a mutation for unchanged content', () => {
  expect(createNoteUpdatePlan('내용', '내용', 'd'.repeat(64))).toEqual({
    changed: false,
    expectedRevision: 'd'.repeat(64),
    mode: 'patch',
    patches: [],
  });
});
