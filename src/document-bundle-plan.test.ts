import { expect, test } from 'vitest';
import { parseDocumentStructure } from './document-structure.js';
import { createBundlePlan } from './document-bundle-plan.js';
import { bundleIdentity } from './compilation-bundle-model.js';

const documentId = '9cac42de-e32d-41e2-8370-df5f19d3b19c';
const plan = (raw: string, id = documentId) => {
  const source = parseDocumentStructure({ path: 'Manual.md', raw });
  return createBundlePlan(source, { documentId: id, bundleId: bundleIdentity({ id, revision: source.revision }), chapterRoot: 'Chapters', ruleVersion: 'v1' });
};
test('server plan covers exact source and keeps unambiguous chapter IDs across insertion', () => {
  const a = '# Approval\r\nOnly after approval. 승인 😀\r\n\r\n', b = '# Restore\r\nNever overwrite.\r\n';
  const before = plan(a + b), after = plan('# Intro\r\nRead first.\r\n\r\n' + a + b);
  expect(before.items).toHaveLength(2);
  expect(after.items.slice(1).map(i => i.chapterId)).toEqual(before.items.map(i => i.chapterId));
  expect(before.items.map(i => (a + b).slice(i.startOffset, i.endOffset)).join('')).toBe(a + b);
  expect(before.items[0]!.next).toBe(before.items[1]!.path);
  expect(before.items[1]!.previous).toBe(before.items[0]!.path);
  expect(before.items[0]!.parent).toBe('Manual.md');
  expect(before.revision).not.toBe(after.revision);
  expect(plan(a + b, 'f00d631d-4e24-4bc5-8e27-b29ecf0b133d').items[0]!.chapterId).not.toBe(before.items[0]!.chapterId);
});
test('duplicate units have separate bundle-scoped IDs and are never claimed unambiguous', () => {
  const unit = '# Same\nKeep this.\n\n', repeated = plan(unit + unit);
  expect(new Set(repeated.items.map(i => i.chapterId)).size).toBe(2);
  expect(repeated.items.every(i => i.identity === 'ambiguous')).toBe(true);
  expect(plan('# New\n\n' + unit + unit).items.slice(1).map(i => i.chapterId)).not.toEqual(repeated.items.map(i => i.chapterId));
});
test('indivisible source units remain references; no code fence or table slicing', () => {
  const raw = '~~~text\n' + 'Exact line 😀\n'.repeat(80) + '~~~\n';
  const result = plan(raw);
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ kind: 'source_reference', startOffset: 0, endOffset: raw.length });
  expect(plan('').items).toEqual([]);
});
test('trusted plan inputs are still syntax checked; source bytes and path bind revision', () => {
  const source = parseDocumentStructure({ path: 'Manual.md', raw: '# One\nOnly once.\n' });
  const input = { documentId, bundleId: documentId, chapterRoot: 'Chapters', ruleVersion: 'v1' };
  for (const chapterRoot of ['../Elsewhere', 'C:/Host', 'Chapters#Block', '_wiki'])
    expect(() => createBundlePlan(source, { ...input, chapterRoot })).toThrow();
  expect(() => createBundlePlan(source, { ...input, documentId: '1' })).toThrow();
  expect(() => createBundlePlan(source, { ...input, absolute: true } as never)).toThrow();
  expect(createBundlePlan(source, input).revision).not.toBe(createBundlePlan(source, { ...input, ruleVersion: 'v2' }).revision);
});
