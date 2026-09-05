import { expect, test } from 'vitest';
import { packQueryPage } from './query-page.js';
import type { QueryNote, QueryNotesResult } from './types.js';
const row = (path = 'A.md', frontmatter = {}) => ({ path, frontmatter, revision: 'a'.repeat(64) });
const page = (notes: QueryNote[], truncated = false): QueryNotesResult => ({ notes, total: notes.length, truncated });
const cursor = (note: QueryNote) => ({ path: note.path, value: note.frontmatter.rank ?? note.path });
const options = { maxChars: 512, cursorFor: cursor };
test('oversized Properties use an exact guarded locator and original sort cursor', async () => {
  const result = await packQueryPage(page([row('A.md', { rank: 7, detail: 'x'.repeat(9000) })], true), options);
  expect(result.isError).not.toBe(true);
  expect(result.text.length).toBeLessThanOrEqual(512);
  const value = JSON.parse(result.text);
  expect(value.nextCursor).toEqual({ path: 'A.md', value: 7 });
  expect(value.notes[0].frontmatter).toBeUndefined();
  expect(value.notes[0].frontmatterOmitted).toBe(true);
  expect(value.notes[0].nextAction.arguments).toMatchObject({ path: 'A.md', expectedRevision: 'a'.repeat(64) });
});
test('an exact locator that cannot fit returns an error without a cursor', async () => {
  const result = await packQueryPage(page([row(`${'긴'.repeat(220)}.md`, { detail: 'x'.repeat(9000) })], true), options);
  expect(result.isError).toBe(true);
  const value = JSON.parse(result.text);
  expect(value.error).toBe('query_response_budget_too_small');
  expect(value.nextCursor).toBeUndefined();
  expect(value.retryArguments.maxChars).toBeGreaterThan(512);
  expect(result.text.length).toBeLessThanOrEqual(512);
});
test('page packing stops hydration after the output prefix fills', async () => {
  let reads = 0;
  const result = await packQueryPage(page(Array.from({ length: 50 }, (_, i) => row(`N${i}.md`, { detail: 'x'.repeat(90) }))), {
    ...options, includeContent: true,
    hydrate: async note => { reads++; return { ...note, content: 'body' }; },
  });
  expect(result.isError).not.toBe(true);
  const value = JSON.parse(result.text);
  expect(reads).toBeLessThan(5);
  expect(value.nextCursor.path).toBe(value.notes.at(-1).path);
  expect(value.truncated).toBe(true);
});
test('an unavailable body has explicit omission rather than an empty body', async () => {
  const result = await packQueryPage(page([row()]), { ...options, includeContent: true, hydrate: async () => undefined });
  const value = JSON.parse(result.text);
  expect(value.notes[0]).toMatchObject({ contentOmitted: true, sourceState: 'index_advisory' });
  expect(value.notes[0].content).toBeUndefined();
  expect(value.notes[0].nextAction.endpointId).toBe('mcp.get_note_outline');
  expect(value.truncated).toBe(false);
});
test('pretty print never defeats the serialized budget', async () => {
  const result = await packQueryPage(page([row(), row('B.md')]), { ...options, prettyPrint: true });
  expect(result.text.length).toBeLessThanOrEqual(512);
  expect(JSON.parse(result.text).notes).toHaveLength(2);
});

test('a budget retry preserves complete Unicode identifiers and exact cursor', async () => {
  const source = page([row(`${'긴'.repeat(220)}.md`, { detail: 'x'.repeat(9000) })], true);
  const first = await packQueryPage(source, options);
  const retry = JSON.parse(first.text).retryArguments;
  const next = await packQueryPage(source, { ...options, ...retry });
  expect(next.isError).not.toBe(true);
  const value = JSON.parse(next.text);
  expect(value.notes[0].path).toBe(source.notes[0]!.path);
  expect(value.nextCursor.path).toBe(source.notes[0]!.path);
  expect(value.notes[0].nextAction.arguments.path).toBe(source.notes[0]!.path);
});
test('an impossible sort cursor errors without an endless maximum-budget retry', async () => {
  const result = await packQueryPage(page([row('A.md', { rank: 'x'.repeat(25000) })], true), { ...options, maxChars: 20000 });
  const value = JSON.parse(result.text);
  expect(result.isError).toBe(true);
  expect(value.nextCursor).toBeUndefined();
  expect(value.retryArguments).toBeUndefined();
  expect(value.hint).toContain('bounded sort property');
});
test('an empty query retains its zero count without a spurious continuation', async () => {
  const result = await packQueryPage(page([]), options);
  expect(JSON.parse(result.text)).toEqual({ notes: [], total: 0, truncated: false });
});
