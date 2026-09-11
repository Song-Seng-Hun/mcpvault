import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { resolveEvidenceLocator } from './evidence-locator.js';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
test('matches indented ATX headings, terminal unique blocks and body-relative quoted ranges', () => {
  const body = '  # Scope ###\r\nstatement ^point\r\n## Child\r\nchild\r\n# Outside\r\nother';
  expect(resolveEvidenceLocator(body, { heading: 'Scope', blockId: 'point', startLine: 2, endLine: 2, quoteHash: hash('statement ^point\r') })).toMatchObject({ valid: true, preferredLine: 2, startLine: 2, endLine: 2 });
  expect(resolveEvidenceLocator(body, { heading: 'Scope', startLine: 5, endLine: 5 })).toMatchObject({ valid: false, issue: 'outside_heading' });
  expect(resolveEvidenceLocator(body, { blockId: 'point', startLine: 3, endLine: 4 })).toMatchObject({ valid: false, issue: 'outside_range' });
});
test('matching fences hide fake headings/blocks and mismatched fences do not end examples', () => {
  const body = '~~~~\n# Fake\nquote ^fake\n```\n# Still fake\n~~~~\n# Real\nreal ^real\n```js\n# Hidden\n```';
  for (const heading of ['Fake', 'Still fake', 'Hidden']) expect(resolveEvidenceLocator(body, { heading }).valid).toBe(false);
  expect(resolveEvidenceLocator(body, { blockId: 'fake' }).valid).toBe(false);
  expect(resolveEvidenceLocator(body, { heading: 'Real', blockId: 'real' })).toMatchObject({ valid: true, preferredLine: 8 });
});
test('ambiguous blocks, invalid ranges, stale hashes and revisions fail closed', () => {
  expect(resolveEvidenceLocator('one ^dup\ntwo ^dup', { blockId: 'dup' }).issue).toBe('ambiguous_block');
  expect(resolveEvidenceLocator('one ^block-long', { blockId: 'block' }).valid).toBe(false);
  expect(resolveEvidenceLocator('one', { startLine: 0, endLine: 1 }).issue).toBe('invalid_range');
  expect(resolveEvidenceLocator('one', { startLine: 1, endLine: 2 }).issue).toBe('invalid_range');
  expect(resolveEvidenceLocator('one', { quoteHash: hash('one') }).valid).toBe(false);
  expect(resolveEvidenceLocator('one', { startLine: 1, endLine: 1, quoteHash: hash('two') }).issue).toBe('stale_quote');
  expect(resolveEvidenceLocator('one', { revision: 'a'.repeat(64) }, 'b'.repeat(64)).issue).toBe('stale_revision');
});
