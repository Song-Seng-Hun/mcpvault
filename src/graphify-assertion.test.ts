import { expect, test } from 'vitest';
import { adaptGraphifyAssertions } from './graphify-assertion.js';
const revision = 'a'.repeat(64), repositoryId = 'b'.repeat(64);
const packet = () => ({ status: 'current', repositoryId, tool: { name: 'graphifyy', version: '0.9.58', adapterVersion: 1 },
  partial: true, testStatus: 'not_executed', nodes: [
    { id: 's', label: 'untrusted label', source_file: 'src/a.ts', source_location: 'L1', sha256: revision },
    { id: 't', source_file: 'src/b.test.ts', source_location: 'L2', sha256: revision },
  ], edges: ['calls', 'tests', 'calls'].map((relation, occurrenceId) => ({ source: 's', target: 't', relation, occurrenceId,
    source_file: 'src/a.ts', source_location: 'L3', sourceHash: revision, method: 'graphify_ast_resolution' })) });
const host = () => ({ repositoryId, canRead: (p: string) => ['src/a.ts', 'src/b.test.ts'].includes(p), readRevision: async (_p: string) => revision });
test('adapts existing P3 occurrences without AST execution, merging or evidence promotion', async () => {
  const r = await adaptGraphifyAssertions(packet(), host());
  expect(r.assertions.map(a => a.relation)).toEqual(['calls', 'tests', 'calls']);
  expect(new Set(r.assertions.map(a => a.id)).size).toBe(3);
  expect(r.assertions[0]).toMatchObject({ kind: 'extracted', evidenceState: 'not_verified', locator: { basis: 'graphify_result', occurrence: 0, sourceLocation: 'L3' } });
  expect(r.testStatus).toBe('not_executed'); expect(r.partial).toBe(true);
  expect(r.assertions[0]!.target).toMatchObject({ path: 'src/b.test.ts', revision, symbolId: 't' });
  expect(JSON.stringify(r)).not.toContain('untrusted label');
});
test.each(['stale', 'hidden', 'repository', 'revision', 'escape', 'duplicate'])('rejects %s inputs without exposing source identities', async kind => {
  const p = packet(), h = host();
  if (kind === 'stale') p.status = 'stale';
  if (kind === 'hidden') h.canRead = () => false;
  if (kind === 'repository') h.repositoryId = 'c'.repeat(64);
  if (kind === 'revision') h.readRevision = async () => 'c'.repeat(64);
  if (kind === 'escape') p.nodes[0]!.source_file = '../outside.ts';
  if (kind === 'duplicate') p.edges[1]!.occurrenceId = 0;
  await expect(adaptGraphifyAssertions(p, h)).rejects.toThrow('Graphify result unavailable or changed');
});
test('last read revocation or byte change discards every record', async () => {
  const h = host(); let calls = 0;
  h.readRevision = async () => { if (++calls === 3) h.canRead = () => false; return revision; };
  await expect(adaptGraphifyAssertions(packet(), h)).rejects.toThrow('Graphify result unavailable or changed');
});
test('unknown source location stays unspecified, not invented as line one', async () => {
  const p: any = packet(); delete p.edges[0].source_location;
  const r = await adaptGraphifyAssertions(p, host());
  expect(r.assertions[0]!.locator).toEqual({ basis: 'graphify_result', occurrence: 0 });
});
