import { expect, test } from 'vitest';
import { packProjectPacket } from './project-packet.js';
const rows = Array.from({ length: 7 }, (_, i) => ({ path: `Project-${i}.md`, revision: String(i).repeat(64),
  planningNeedsAttention: true, planning: { ready: false }, execution: { ready: false },
  projectSupport: ['[[Exact target#Heading|alias]]'], title: 'title' }));
const metadata = { needsPlanning: 7, dependencyBlocked: 0, generatedAt: '2026-09-05T00:00:00Z' };
test.each([false, true])('all emitted pages respect budgets and visit exact identities once (pretty=%s)', prettyPrint => {
  let options: any = { prettyPrint }, visited: string[] = [];
  for (let step = 0; step < 10; step++) {
    const page = packProjectPacket(rows, metadata, 3, 1600, options);
    expect(JSON.stringify(page, null, prettyPrint ? 2 : undefined).length).toBeLessThanOrEqual(1600);
    expect(page.returned).toBeGreaterThan(0);
    visited.push(...page.items.map((row: any) => row.path));
    if (!page.truncated) break;
    expect(page.nextAction.arguments.offset).toBe(visited.length);
    options = page.nextAction.arguments;
  }
  expect(visited).toEqual(rows.map(row => row.path));
});
test.each([false, true])('512-character retry never skips an oversized record (pretty=%s)', prettyPrint => {
  const page = packProjectPacket([{ ...rows[0], path: 'Long'.repeat(500) + '.md', projectSupport: ['x'.repeat(30000)] }], metadata, 12, 512, { prettyPrint });
  expect(JSON.stringify(page, null, prettyPrint ? 2 : undefined).length).toBeLessThanOrEqual(512);
  expect(page.items).toEqual([]); expect(page.offset).toBe(0);
  expect(page.nextAction.reuseOriginalArguments).toBe(true);
});
test('oversized details become an explicit summary with exact source identity, not clipped links', () => {
  const row = { ...rows[0], projectSupport: ['[[Heading' + 'x'.repeat(20000) + ']]'] };
  const page = packProjectPacket([row], metadata, 12, 1600);
  expect(page.items[0]).toMatchObject({ path: row.path, revision: row.revision, detailsOmitted: true });
  expect(page.items[0].projectSupport).toBeUndefined();
  expect(page.items[0].readAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: row.path, maxChars: 8000 } });
});
test('changed off-page project rejects a continuation and generated time does not', () => {
  const first = packProjectPacket(rows, metadata, 1, 3000);
  const options = first.nextAction.arguments;
  expect(packProjectPacket(rows, { ...metadata, generatedAt: 'later' }, 1, 3000, options).items[0].path).toBe(rows[1]!.path);
  expect(() => packProjectPacket(rows.map((row, i) => i === 6 ? { ...row, revision: 'f'.repeat(64) } : row), metadata, 1, 3000, options)).toThrow(/Project view changed/);
  expect(() => packProjectPacket(rows, metadata, 1, 3000, { offset: 1 })).toThrow(/requires expectedSnapshot/);
});
test('an identity beyond the maximum budget fails without silently advancing', () => {
  expect(() => packProjectPacket([{ ...rows[0], path: 'x'.repeat(20000) }], metadata, 1, 16000)).toThrow(/no items skipped/);
});
test.each([false, true])('empty packets fit minimum budgets (pretty=%s)', prettyPrint => {
  const page = packProjectPacket([], metadata, 1, 512, { prettyPrint });
  expect(page.items).toEqual([]);expect(page.truncated).toBe(false);
  expect(JSON.stringify(page, null, prettyPrint ? 2 : undefined).length).toBeLessThanOrEqual(512);
});
