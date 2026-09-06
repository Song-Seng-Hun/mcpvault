import { expect, test } from 'vitest';
import { createRecallCollector, packRecallQueue } from './recall-queue.js';

type Row = { path: string; priority: number; group: string };
const compare = (a: Row, b: Row) => b.priority - a.priority || a.path.localeCompare(b.path);
function exhaustive(rows: Row[], limit: number) {
  const buckets = new Map<string, Row[]>();
  for (const row of [...rows].sort(compare)) buckets.set(row.group, [...(buckets.get(row.group) || []), row]);
  const result: Row[] = [];
  for (let i = 0; result.length < rows.length; i++) for (const bucket of buckets.values()) if (bucket[i]) result.push(bucket[i]!);
  return result.slice(0, limit);
}
test.each([1, 2, 5, 30])('bounded recall collector matches exhaustive interleaving at limit %i', limit => {
  for (const groupCount of [1, 3, 10, 45]) {
    const rows = Array.from({ length: 350 }, (_, i) => ({ path: `Note${i}.md`, priority: (i * 37) % 53, group: `group${i % groupCount}` }));
    for (const ordered of [rows, [...rows].reverse(), [...rows].sort((a, b) => compare(b, a))]) {
      const collector = createRecallCollector<Row>(limit, compare);
      for (const row of ordered) { collector.add(row.group, row); expect(collector.retainedCount).toBeLessThanOrEqual(limit * limit); }
      expect(collector.values()).toEqual(exhaustive(rows, limit));
      expect(collector.groupCount).toBe(groupCount);
    }
  }
});
test.each([false, true])('recall packing bounds whole JSON with pretty=%s', pretty => {
  const item = { path: 'Note.md', revision: 'a'.repeat(64), recallPrompt: 'Explain.', title: 'x'.repeat(5000), reason: 'never_recalled' };
  for (const maxChars of [512, 800, 2000, 12000]) {
    const result = packRecallQueue([item], 1, 1, maxChars, pretty);
    expect(JSON.stringify(result, null, pretty ? 2 : undefined).length).toBeLessThanOrEqual(maxChars);
    expect(result.items[0]).toMatchObject({ path: item.path, revision: item.revision, recallPrompt: item.recallPrompt });
  }
});
test('oversized exact prompt retries with preserved arguments instead of an answer read', () => {
  const item = { path: 'Note.md', revision: 'a'.repeat(64), recallPrompt: 'x'.repeat(1000) };
  const result: any = packRecallQueue([item], 1, 1, 512, false);
  expect(result.items).toEqual([]);
  expect(result.retry).toMatchObject({ endpointId: 'wiki.recall_queue', reuseOriginalArguments: true, overrides: { maxChars: 12000 } });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
});

test('compaction retains private revision and repair context or retries', () => {
  const item = { path: 'Note.md', revision: 'a'.repeat(64), stateRevision: 'b'.repeat(64), recallPrompt: 'Explain.',
    repairStatus: 'in_progress', confusion: 'Important distinction', repairPath: 'Repair.md', repairRevision: 'c'.repeat(64),
    suggestedAction: 'Inspect the repair before marking it resolved.', title: 'x'.repeat(5000) };
  for (const maxChars of [512, 1200]) {
    const result = packRecallQueue([item], 1, 1, maxChars, true);
    expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(maxChars);
    if (result.items.length) expect(result.items[0]).toMatchObject({ stateRevision: item.stateRevision,
      repairStatus: item.repairStatus, confusion: item.confusion, repairPath: item.repairPath, repairRevision: item.repairRevision,
      suggestedAction: item.suggestedAction });
    else expect(result.retry).toMatchObject({ overrides: { maxChars: 12000 } });
  }
});
