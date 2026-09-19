import { test, expect } from 'vitest';
import { wikiEvolutionAdapter } from './wiki-adapter.js';
const principal: any = { accountId: 'alice', capabilities: ['write'] };
// Adapter contract only. Publication/fidelity behavior remains separately tested by its real owner service.
test('wiki adapter accepts only the exact checked synthesis job and confirms completion, not generated text', async () => {
  const job: any = { requestId: 'job1', projectId: 'project1', operation: 'synthesize', outputPath: 'Result.md', outputRevision: 'a'.repeat(64),
    status: 'checked', protection: 'ready', draft: { content: 'Preserve exception.', fingerprint: 'd'.repeat(64) },
    evidence: { decision: 'extend_existing' }, validation: { status: 'passed' } };
  let completed = false;
  const owner: any = {
    evolutionSnapshot: async () => ({ job: structuredClone(job), revision: completed ? 'c'.repeat(64) : 'b'.repeat(64) }),
    execute: async (p: any) => { expect(p.op).toBe('retry'); completed = true; job.status = 'completed'; job.receipt = { outputRevision: 'c'.repeat(64) }; return { status: 'completed', outputRevision: 'c'.repeat(64) }; },
  };
  const adapter = wikiEvolutionAdapter(owner), target: any = { kind: 'wiki', id: 'job1', path: 'Result.md' };
  const baseline = await adapter.read(target, principal);
  const cycle: any = { id: 'cycle', target, scope: { kind: 'project', id: 'project1' }, baseline, candidate: { jobRevision: baseline.revision } };
  cycle.intent = await adapter.preview(cycle, principal, async () => {});
  expect((await adapter.reconcile(cycle, principal, async () => {})).state).toBe('unknown');
  const result = await adapter.apply(cycle, principal, async () => {});
  expect(await adapter.reconcile(cycle, principal, async () => {})).toEqual({ state: 'applied', revision: result.revision });
  job.draft.content = 'Changed after evaluation';
  expect((await adapter.reconcile(cycle, principal, async () => {})).state).toBe('unknown');
});
