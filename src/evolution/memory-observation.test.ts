import { expect, test } from 'vitest';
import { memoryObservation } from './memory-observation.js';
const revision = 'a'.repeat(64);
const result = (data: unknown, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], isError });

test('only returned memory spans produce receipts; basis and nextAction are not delivered content', () => {
  const packet = memoryObservation('memory.recall', result({ snapshot: revision, status: 'context_found', items: [{
    path: 'private/path.md', revision, role: 'episodic', block_id: 'block', matchReason: 'correction_target',
    excerpt: { startLine: 5, endLine: 7, text: 'private text' }, basis: [{ path: 'unread.md', revision: 'b'.repeat(64) }],
    nextAction: { arguments: { path: 'unread.md', expectedRevision: 'b'.repeat(64) } },
  }] }));
  expect(packet).toMatchObject({ status: 'delivered', partial: false, resources: [{ revision, role: 'episodic', startLine: 5, endLine: 7, reason: 'correction_target', contentHash: expect.stringMatching(/^[a-f0-9]{64}$/), returnedChars: 12, truncated: false }] });
  expect(JSON.stringify(packet)).not.toMatch(/private|unread/);
  expect(JSON.stringify(packet)).not.toContain('b'.repeat(64));
});

test('invalid evidence never manufactures delivery and resource limit is explicit', () => {
  expect(memoryObservation('memory.brief', result({ status: 'not_needed', items: [] }))).toMatchObject({ status: 'not_needed', resources: [] });
  expect(memoryObservation('memory.recall', result({}, true))).toMatchObject({ status: 'unavailable', resources: [] });
  const row = { path: 'x.md', revision, role: 'episodic', excerpt: { startLine: 2, endLine: 1, text: 'invalid' } };
  expect(memoryObservation('memory.recall', result({ items: [row] }))).toMatchObject({ status: 'unavailable', partial: true, resources: [] });
  row.excerpt.endLine = 3;
  const many = memoryObservation('memory.recall', result({ items: Array.from({ length: 40 }, (_, i) => ({ ...row, path: `${i}.md` })) }));
  expect(many?.resources).toHaveLength(32); expect(many?.partial).toBe(true);
});

test('continuity without returned content is not a delivered working-memory body', () => {
  expect(memoryObservation('continuity.resume', result({ exists: true, path: 'x.md', revision, content: '', truncated: true })))
    .toMatchObject({ status: 'route_only', partial: true, resources: [] });
  expect(memoryObservation('notes.read', result({ path: 'x.md', revision }))).toBeUndefined();
});

test('a truncated span is not recorded as a complete line-range read', () => {
  const evidence = memoryObservation('memory.brief', result({ items: [{ path: 'x.md', revision, role: 'semantic',
    excerpt: { startLine: 1, endLine: 8, text: 'Only a prefix', truncated: true } }] }));
  expect(evidence).toMatchObject({ status: 'delivered', partial: true, resources: [{ truncated: true, returnedChars: 13 }] });
});
