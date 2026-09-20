import { expect, test } from 'vitest';
import { MemoryExposure } from './exposure.js';
const actor: any = { accountId: 'a', sessionId: 's', sessionGeneration: 1, agentId: 'one' };
const packet = () => ({ snapshot: 'a'.repeat(64), warnings: ['Not truth'], items: [{ path: 'A.md', revision: 'b'.repeat(64), excerpt: { text: 'Only if permitted. '.repeat(25), startLine: 1, endLine: 2, truncated: false }, nextAction: { endpointId: 'documents.read' } }] });
test('a delivered receipt alone never suppresses memory; only a host-confirmed current context can reuse it', () => {
  const e = new MemoryExposure(), first = e.deliver(packet(), actor, 'policy', {}, 4000);
  const unknown = e.deliver(packet(), actor, 'policy', { mode: 'if_retained', knownReads: [first.deliveryReceipt] }, 4000);
  expect(unknown.items[0].excerpt.text).toContain('Only if');
  e.confirm(actor, first.deliveryReceipt, 'context-one');
  const reused = e.deliver(packet(), actor, 'policy', { mode: 'if_retained', knownReads: [first.deliveryReceipt] }, 4000);
  expect(reused.items[0].excerpt).toBeNull(); expect(reused.items[0].nextAction).toBeDefined(); expect(reused.warnings).toEqual(['Not truth']);
  expect(JSON.stringify(reused).length).toBeLessThan(JSON.stringify(first).length);
});
test('compaction, other account, changed policy, new source and explicit full read invalidate suppression', () => {
  const e = new MemoryExposure(), first = e.deliver(packet(), actor, 'policy', {}, 4000);
  e.confirm(actor, first.deliveryReceipt, 'context-one');
  const params = { mode: 'if_retained' as const, knownReads: [first.deliveryReceipt] };
  for (const [p, policy, body] of [[{ ...actor, accountId: 'b' }, 'policy', packet()], [actor, 'new', packet()], [actor, 'policy', { ...packet(), snapshot: 'c'.repeat(64) }]] as any) {
    expect(e.deliver(body, p, policy, params, 4000).items[0].excerpt.text).toContain('Only if');
  }
  expect(e.deliver(packet(), actor, 'policy', { ...params, mode: 'full' }, 4000).items[0].excerpt.text).toContain('Only if');
  e.invalidate(actor); expect(e.deliver(packet(), actor, 'policy', params, 4000).items[0].excerpt.text).toContain('Only if');
  expect(() => e.confirm(actor, 'forged', 'context-two')).toThrow();
});
