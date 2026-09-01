import { expect, test } from 'vitest';
import { ContextBudgeter } from './client-context.js';

test('packs required and high-priority context within a Unicode-safe budget', () => {
  const budgeter = new ContextBudgeter();
  const packed = budgeter.pack([
    { id: 'optional', text: 'optional context', priority: 1 },
    { id: 'root', text: 'root 내용', required: true },
    { id: 'peer', text: 'peer evidence', priority: 2, maxChars: 5 },
  ], 16);

  expect(packed.fragments.map(fragment => fragment.id)).toEqual(['root', 'peer']);
  expect(packed.text).toContain('root 내용');
  expect(packed.truncatedIds).toEqual(['peer']);
  expect(packed.omittedIds).toEqual(['optional']);
  expect(packed.usedChars).toBeLessThanOrEqual(16);
});

test('does not split surrogate pairs while clipping', () => {
  const packed = new ContextBudgeter().pack([{ id: 'emoji', text: '😀😀😀' }], 2);
  expect(packed.text).toBe('😀😀');
  expect(new ContextBudgeter().estimateTokens(packed.text)).toBe(1);
});

test('deduplicates the same note revision before spending context budget', () => {
  const packed = new ContextBudgeter().pack([
    { id: 'mention', text: 'mention context', required: true, source: { path: 'note.md', revision: 'a'.repeat(64) } },
    { id: 'search', text: 'duplicate search context', priority: 10, source: { path: 'note.md', revision: 'a'.repeat(64) } },
    { id: 'other', text: 'other evidence', source: { path: 'other.md', revision: 'b'.repeat(64) } },
  ], 1000);

  expect(packed.fragments.map(fragment => fragment.id)).toEqual(['mention', 'other']);
  expect(packed.deduplicatedIds).toEqual(['search']);
  expect(packed.omittedIds).toEqual(['search']);
});
