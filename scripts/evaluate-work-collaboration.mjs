// Deterministic protocol evaluation in fresh temporary Vaults. No model calls,
// live Vault access, networking, host configuration, or repository mutations.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { FileSystemService } from '../dist/src/filesystem.js';
import { ScopeAuthService } from '../dist/src/scope-auth.js';
import { ScopeAccessPolicy } from '../dist/src/scope-access.js';
import { ReferenceService } from '../dist/src/references.js';
import { AgentTaskService } from '../dist/src/agent-tasks.js';
import { WorkService } from '../dist/src/work-service.js';

const cases = ['summary_only', 'missing_read', 'unrelated_artifact', 'wrong_snapshot', 'mandatory_unknown', 'missing_host_execution', 'host_detected_defect', 'valid_review'];
async function evaluate(version, scenario) {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-plan2-eval-'));
  const metrics = { calls: 0, requestChars: 0, responseChars: 0, estimatedTokens: 0, reviewMilliseconds: 0 };
  const call = async (service, method, args) => {
    metrics.calls++; metrics.requestChars += JSON.stringify(args).length;
    try { const value = await service[method](args); metrics.responseChars += JSON.stringify(value).length; return value; }
    catch (error) { metrics.responseChars += String(error.message).length; throw error; }
  };
  try {
    const fs = new FileSystemService(vault), auth = new ScopeAuthService(vault), refs = new ReferenceService(fs, new ScopeAccessPolicy());
    const tasks = new AgentTaskService(fs, refs, auth);
    // The deliberately defective fixture accepts an unauthorized caller. Only
    // the explicitly supplied host verifier observes this result, never a claim.
    const acceptsCaller = () => true;
    const observedHostResult = acceptsCaller('unauthorized') === false ? 'pass' : 'fail';
    const work = new WorkService(fs, refs, auth, tasks, scenario === 'host_detected_defect'
      ? { verifyReviewExecution: async (_id, expected) => expected.test.result === observedHostResult } : {});
    const people = [];
    for (const id of ['owner', 'peer']) people.push((await auth.register({ accountId: id, modelId: id, password: 'isolated-fixture-password' })).principal);
    const [owner, peer] = people;
    await call(work, 'project', { principal: owner, op: 'create', projectId: 'eval', title: 'Evaluation', goal: 'Reject misleading review',
      allowedWork: ['Synthetic fixture'], completionCriteria: ['Authorized callers only'], participants: ['peer'], requestId: 'project',
      ...(version === 2 && { reviewPolicy: { version: 2, requireHostExecution: ['missing_host_execution', 'host_detected_defect'].includes(scenario) } }) });
    const locators = [];
    for (const role of ['before', 'after', 'test']) {
      const path = `Knowledge/${role}.md`;
      const content = scenario === 'host_detected_defect' && role === 'after' ? 'Fixture defect: acceptsCaller always returns true'
        : scenario === 'host_detected_defect' && role === 'test' ? 'Host observed unauthorized caller accepted: FAIL' : `${role}: controlled fixture`;
      await fs.writeNote({ path, content, ...(['before', 'after'].includes(role) && { frontmatter: { source_work_id: 'evaluation-fixture' } }) });
      const note = await fs.readNote(path);
      locators.push({ id: role, role, path, revision: note.revision, startLine: 1, endLine: note.originalContent.split(/\r?\n/).length, required: true });
    }
    const actualPath = scenario === 'unrelated_artifact' ? 'Knowledge/actual.md' : 'Knowledge/after.md';
    if (scenario === 'unrelated_artifact') await fs.writeNote({ path: actualPath, content: 'Different actual changed artifact' });
    const artifact = { path: actualPath, revision: (await fs.readNote(actualPath)).revision };
    const task = await call(tasks, 'create', { principal: owner, projectId: 'eval', taskId: 'task', title: 'Review', description: 'Review caller admission change',
      completionCriteria: ['Authorized callers only'], artifacts: [artifact], verification: 'Author reports passing check', requestId: 'task',
      ...(version === 2 && { changeContext: { reason: 'Caller admission', scope: 'One controlled function', locators } }) });
    const claimed = await call(work, 'claim', { principal: owner, taskId: 'task', op: 'start', expectedRevision: task.revision, expectedGeneration: 0, requestId: 'claim' });
    const requested = await call(work, 'review', { principal: owner, taskId: 'task', op: 'request', expectedRevision: claimed.revision, expectedGeneration: 1, requestId: 'request', reason: 'Review actual caller behavior' });
    const start = performance.now();
    const contextReceipts = [];
    if (version === 2 && scenario !== 'summary_only') {
      await call(work, 'reviewContext', { principal: peer, taskId: 'task', maxChars: 12000 });
      for (const locator of locators.filter(l => scenario !== 'missing_read' || l.role !== 'before')) {
        const result = await call(work, 'reviewContext', { principal: peer, taskId: 'task', locatorId: locator.id, maxChars: 12000 });
        contextReceipts.push(...result.items.map(item => item.receipt));
      }
    }
    const checks = [{ criterion: 'Authorized callers only', verdict: scenario === 'mandatory_unknown' ? 'unknown' : 'pass',
      rationale: 'Claimed exact before/after comparison and focused admission test', evidenceIds: ['before', 'after', 'test'], missingChecks: [],
      tests: [{ locatorId: 'test', snapshot: scenario === 'wrong_snapshot' ? '0'.repeat(64) : locators[1].revision,
        environment: 'isolated deterministic fixture', result: 'pass', missingChecks: [],
        ...(scenario === 'host_detected_defect' && { executionId: 'host-known-failure' }) }] }];
    let approved = false;
    try {
      await call(work, 'review', { principal: peer, taskId: 'task', op: 'approve', expectedRevision: requested.revision,
        artifactFingerprint: requested.artifactFingerprint, requestId: 'approve', reason: 'Claimed passing review',
        ...(scenario !== 'summary_only' && { contextReceipts, checks }) });
      approved = true;
    } catch { /* A rejection is the expected outcome for negative controls. */ }
    metrics.reviewMilliseconds = Math.round((performance.now() - start) * 100) / 100;
    metrics.estimatedTokens = Math.ceil((metrics.requestChars + metrics.responseChars) / 4);
    const expectedApproval = version === 1 || scenario === 'valid_review';
    assert.equal(approved, expectedApproval, `Unexpected v${version} result for ${scenario}`);
    return { version, scenario, approved, negativeControl: scenario !== 'valid_review', ...metrics };
  } finally {
    assert.equal(dirname(resolve(vault)), resolve(tmpdir()));
    assert.ok(basename(vault).startsWith('mcpvault-plan2-eval-'));
    await rm(vault, { recursive: true, force: true });
  }
}
const rows = [];
for (const version of [1, 2]) for (const scenario of cases) rows.push(await evaluate(version, scenario));
const summary = [1, 2].map(version => {
  const selected = rows.filter(row => row.version === version), negative = selected.filter(row => row.negativeControl);
  return { version, negativeControls: negative.length, falseApprovals: negative.filter(row => row.approved).length,
    rejectedNegativeControls: negative.filter(row => !row.approved).length,
    unnecessaryWaitsOnValidControl: selected.filter(row => !row.negativeControl && !row.approved).length,
    calls: selected.reduce((sum, row) => sum + row.calls, 0), estimatedTokens: selected.reduce((sum, row) => sum + row.estimatedTokens, 0),
    reviewMilliseconds: Math.round(selected.reduce((sum, row) => sum + row.reviewMilliseconds, 0) * 100) / 100 };
});
process.stdout.write(JSON.stringify({ evaluation: 'deterministic-protocol-controls', summary, rows,
  limitations: ['No live models or semantic-comprehension measurement.', 'Token counts are character/4 estimates, not provider usage.',
    'Timing is local service time, not model review latency.', 'Negative controls cover protocol gates and one host-observed injected defect, not collusion or dishonest structured self-reports.'] }, null, 2) + '\n');
