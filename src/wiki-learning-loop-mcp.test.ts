import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import { FileSystemService } from './filesystem.js';

let vault: string, fs: FileSystemService;

beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'wiki-learning-loop-mcp-')); fs = new FileSystemService(vault); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });

async function connect() {
  const server = createServer(vault, { version: 'learning-loop-test' });
  const client = new Client({ name: 'learning-loop-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  const call = async (endpointId: string, args: Record<string, any> = {}, accessToken?: string) => {
    const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args, ...(accessToken && { accessToken }) } });
    const text = (result.content as any[]).map(item => item.text || '').join('');
    let value: any; try { value = JSON.parse(text); } catch { /* errors are intentionally plain bounded text */ }
    if (!result.isError && ['mcp.ingest_source', 'mcp.publish_knowledge', 'wiki.capture', 'continuity.save'].includes(endpointId)) {
      const reread = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'notes.read', arguments: { path: value.path, expectedRevision: value.revision, maxChars: 12000 }, accessToken } });
      const rereadText = (reread.content as any[]).map(item => item.text || '').join('');
      expect(reread.isError, rereadText).toBeFalsy();
      expect(JSON.parse(rereadText).revision).toBe(value.revision);
    }
    return { error: result.isError, text, value };
  };
  return { client, call, close: async () => { await client.close(); await server.close(); } };
}

async function knowledgeFiles() {
  return (await readdir(join(vault, 'Knowledge'), { recursive: true })).filter(path => path.endsWith('.md'));
}

test('Stage 8 deterministic protocol story covers the bounded learning loop without claiming model-quality evidence', async () => {
  const c = await connect();
  try {
    expect((await c.client.listTools()).tools.map(tool => tool.name).sort()).toEqual([
      'call_endpoint', 'get_agent_pulse', 'list_active_capabilities', 'orient_wiki', 'search_capabilities',
    ]);
    const auth = await c.call('auth.register', { accountId: 'learning-loop-account', agentId: 'learning-loop-worker', userId: 'fixture', modelId: 'codex', password: randomUUID() });
    expect(auth.error, auth.text).toBeFalsy();
    const token = auth.value.accessToken;

    // Fixture facts only: the first immutable source and one existing knowledge note.
    const original = await c.call('mcp.ingest_source', {
      sourceId: 'retry-origin', sourceWorkId: 'retry-guidance', sourceEditionId: 'origin', title: 'Retry guidance',
      content: 'Retry idempotent reads only when delivery outcome is unknown. Never retry payment creation.',
    }, token);
    expect(original.error, original.text).toBeFalsy();
    const oldEdition = await c.call('mcp.ingest_source', {
      sourceId: 'retry-v1', sourceWorkId: 'retry-guidance', sourceEditionId: 'v1', title: 'Retry guidance v1',
      content: 'Retry idempotent reads only when delivery outcome is unknown. Never retry payment creation.',
      sourceDerivations: [{ path: original.value.path, revision: original.value.revision, relation: 'quotation' }],
    }, token);
    expect(oldEdition.error, oldEdition.text).toBeFalsy();
    const existing = await c.call('mcp.publish_knowledge', {
      path: 'Knowledge/Retry.md', content: '# Retry\n\nRetry idempotent reads only when delivery outcome is unknown. Never retry payment creation.',
      noteKind: 'atomic', domain: 'retry', evidencePaths: [oldEdition.value.path], expectedRevision: 'missing',
      claims: [{ id: 'retry-safely', text: 'Retry is limited to idempotent reads with an unknown delivery outcome; never retry payment creation.', evidencePaths: [oldEdition.value.path], status: 'supported', confidence: 'medium' }],
    }, token);
    expect(existing.error, existing.text).toBeFalsy();
    expect(await knowledgeFiles()).toEqual(['Retry.md']);

    const comparison = await c.call('wiki.source_compare', { sourcePath: oldEdition.value.path, query: 'retry delivery outcome payment', maxChars: 4000, prettyPrint: true });
    expect(comparison.error, comparison.text).toBeFalsy();
    expect(comparison.text.length).toBeLessThanOrEqual(4000);
    const candidate = comparison.value.candidates.find((item: any) => item.path === 'Knowledge/Retry.md');
    expect(candidate).toBeTruthy();
    const inspected = await c.call(candidate.readAction.endpointId, candidate.readAction.arguments);
    expect(inspected.error, inspected.text).toBeFalsy();
    expect(inspected.value.revision).toBe(existing.value.revision);
    expect(inspected.text).toContain('Never retry payment creation.');

    const clarified = await c.call('mcp.publish_knowledge', {
      path: 'Knowledge/Retry.md', content: '# Retry\n\nRetry idempotent reads only when delivery outcome is unknown. Never retry payment creation.\n\nDo not generalize beyond these conditions.',
      noteKind: 'atomic', evidencePaths: [oldEdition.value.path], expectedRevision: existing.value.revision,
      claims: [{ id: 'retry-safely', text: 'Retry is limited to idempotent reads with an unknown delivery outcome; never retry payment creation.', evidencePaths: [oldEdition.value.path], status: 'supported', confidence: 'medium' }],
    }, token);
    expect(clarified.error, clarified.text).toBeFalsy();
    expect(await knowledgeFiles()).toEqual(['Retry.md']);
    const priorApplication = { id: 'before-new-edition', knowledge: { path: 'Knowledge/Retry.md', revision: clarified.value.revision }, environment: 'isolated fixture before v2', conditions: 'Idempotent read; delivery outcome unknown.', outcome: 'failed', observed: 'A rate-limit response prevented completion.', limitations: 'One recorded fixture observation, not a universal refutation.' };
    const priorObservation = await c.call('wiki.capture', { path: 'Inbox/Prior retry application.md', content: 'Prior application before source changed.', capturedFrom: 'experiment', knowledgeApplications: [priorApplication] }, token);
    expect(priorObservation.error, priorObservation.text).toBeFalsy();

    const newEdition = await c.call('mcp.ingest_source', {
      sourceId: 'retry-v2', sourceWorkId: 'retry-guidance', sourceEditionId: 'v2', title: 'Retry guidance v2',
      content: 'Retry idempotent reads only when delivery outcome is unknown and the rate-limit window has elapsed. Never retry payment creation.',
      sourceDerivations: [{ path: oldEdition.value.path, revision: oldEdition.value.revision, relation: 'adaptation' }],
    }, token);
    expect(newEdition.error, newEdition.text).toBeFalsy();
    const lineage = await c.call('wiki.source_lineage', { sourcePath: newEdition.value.path, previousSourcePath: oldEdition.value.path, maxChars: 4000, prettyPrint: true });
    expect(lineage.error, lineage.text).toBeFalsy();
    expect(lineage.text.length).toBeLessThanOrEqual(4000);
    expect(lineage.value.status).toBe('changed');
    const oldLine = await c.call(lineage.value.delta.hunks[0].old.readAction.endpointId, lineage.value.delta.hunks[0].old.readAction.arguments, token);
    const newLine = await c.call(lineage.value.delta.hunks[0].new.readAction.endpointId, lineage.value.delta.hunks[0].new.readAction.arguments, token);
    expect(oldLine.error, oldLine.text).toBeFalsy();
    expect(newLine.error, newLine.text).toBeFalsy();
    expect(oldLine.text).toContain('delivery outcome is unknown. Never retry payment creation.');
    expect(oldLine.text).not.toContain('rate-limit window has elapsed');
    expect(newLine.text).toContain('rate-limit window has elapsed');
    expect(newLine.text).toContain('Never retry payment creation');
    const impact = await c.call('wiki.source_lineage', { sourcePath: newEdition.value.path, previousSourcePath: oldEdition.value.path, maxChars: 12000 });
    expect(impact.error, impact.text).toBeFalsy();
    expect(impact.text.length).toBeLessThanOrEqual(12000);
    const affected = impact.value.claims.find((item: any) => item.path === 'Knowledge/Retry.md' && item.claimId === 'retry-safely');
    expect(affected).toMatchObject({ revision: clarified.value.revision, reviewDraft: { endpointId: 'wiki.review_claim', arguments: { path: 'Knowledge/Retry.md', claimId: 'retry-safely', expectedRevision: clarified.value.revision } } });
    expect((await c.call(affected.readAction.endpointId, affected.readAction.arguments)).error).toBeFalsy();

    const updated = await c.call('mcp.publish_knowledge', {
      path: 'Knowledge/Retry.md', content: '# Retry\n\nRetry idempotent reads only when delivery outcome is unknown and the rate-limit window has elapsed. Never retry payment creation.',
      noteKind: 'atomic', evidencePaths: [oldEdition.value.path, newEdition.value.path], expectedRevision: clarified.value.revision,
      claims: [{ id: 'retry-safely', text: 'Retry is limited to idempotent reads with an unknown delivery outcome and an elapsed rate-limit window; never retry payment creation.', evidencePaths: [oldEdition.value.path, newEdition.value.path], status: 'supported', confidence: 'medium' }],
    }, token);
    expect(updated.error, updated.text).toBeFalsy();
    expect(await knowledgeFiles()).toEqual(['Retry.md']);
    const compactComparison = await c.call('wiki.source_compare', { sourcePath: oldEdition.value.path, query: 'retry delivery outcome payment', maxChars: 2000, prettyPrint: true });
    expect(compactComparison.error, compactComparison.text).toBeFalsy();
    expect(compactComparison.text.length).toBeLessThanOrEqual(2000);
    const retryMarkdown = await readFile(join(vault, 'Knowledge/Retry.md'), 'utf8');
    expect(retryMarkdown).toContain('unknown and the rate-limit window has elapsed');
    expect(retryMarkdown).toContain('Never retry payment creation.');
    expect(retryMarkdown).not.toContain('Retry payment creation.');

    const application = { id: 'rate-limit-fixture-run', knowledge: { path: 'Knowledge/Retry.md', revision: updated.value.revision }, environment: 'isolated Windows fixture / fixed clock', conditions: 'Unknown delivery outcome; rate-limit window elapsed; idempotent read.', outcome: 'inconclusive', observed: 'The fixture records an observation, not a general success claim.', limitations: 'Deterministic protocol fixture; not model-quality or production evidence.' };
    const observation = await c.call('wiki.capture', { path: 'Inbox/Retry application.md', content: 'Observed one bounded fixture application.', capturedFrom: 'experiment', knowledgeApplications: [application] }, token);
    expect(observation.error, observation.text).toBeFalsy();
    const applications = await c.call('wiki.applications', { path: 'Knowledge/Retry.md', maxChars: 4000, prettyPrint: true });
    expect(applications.error, applications.text).toBeFalsy();
    expect(applications.text.length).toBeLessThanOrEqual(4000);
    expect(applications.value.items.find((item: any) => item.id === application.id)).toMatchObject({ id: application.id, knowledge: application.knowledge, environment: application.environment, conditions: application.conditions, outcome: 'inconclusive' });
    expect(applications.value.items.find((item: any) => item.id === priorApplication.id).knowledge.revision).toBe(clarified.value.revision);
    expect((await fs.readNote('Inbox/Retry application.md')).frontmatter.knowledge_applications).toEqual([application]);

    const matrix = await c.call('wiki.claim_matrix', { path: 'Knowledge/Retry.md', maxChars: 4000, prettyPrint: true });
    expect(matrix.error, matrix.text).toBeFalsy();
    expect(matrix.text.length).toBeLessThanOrEqual(4000);
    expect(matrix.value.authoredOrder[0].evidence.provenance.status).toBe('shared_origin_observed');
    expect(matrix.text.toLowerCase()).toContain('shared');

    const dissent = await c.call('mcp.publish_knowledge', {
      path: 'Knowledge/Retry dissent.md', content: '# Retry dissent\n\nThe rate-limit condition is not sufficient when idempotency is unknown; keep payment creation excluded.',
      noteKind: 'atomic', domain: 'retry', evidencePaths: [newEdition.value.path], expectedRevision: 'missing',
    }, token);
    expect(dissent.error, dissent.text).toBeFalsy();
    const synthesis = { question: 'When may a retry proceed?', inputs: [{ id: 'retry', path: 'Knowledge/Retry.md', revision: updated.value.revision }, { id: 'dissent', path: 'Knowledge/Retry dissent.md', revision: dissent.value.revision }], explanations: [
      { id: 'bounded-retry', explanation: 'Retry only the bounded idempotent-read case.', appliesWhen: 'Delivery outcome is unknown and the rate-limit window has elapsed.', limitations: 'Does not authorize payment creation.', basis: ['retry'] },
      { id: 'dissent', explanation: 'Do not infer safety from the rate-limit condition alone.', appliesWhen: 'Idempotency is unknown.', limitations: 'Requires more evidence before retry.', basis: ['dissent'] },
    ], choices: [], counterexamples: [{ description: 'Payment creation remains excluded even after the rate-limit window.', basis: ['retry', 'dissent'] }], unresolvedQuestions: ['How is idempotency established?'] };
    const synthesized = await c.call('mcp.publish_knowledge', {
      path: 'Knowledge/Retry conditions.md', content: '# Retry conditions\n\nKeep both conditional paths and the payment exclusion.', noteKind: 'atomic', domain: 'retry', evidencePaths: [newEdition.value.path], expectedRevision: 'missing', knowledgeSynthesis: synthesis,
    }, token);
    expect(synthesized.error, synthesized.text).toBeFalsy();
    expect((await fs.readNote('Knowledge/Retry conditions.md')).frontmatter.knowledge_synthesis).toEqual(synthesis);
    const candidates = await c.call('wiki.synthesis_candidates', { maxChars: 4000, prettyPrint: true });
    expect(candidates.error, candidates.text).toBeFalsy();
    expect(candidates.text.length).toBeLessThanOrEqual(4000);
    const detailedCandidates = await c.call('wiki.synthesis_candidates', { maxChars: 12000 });
    expect(detailedCandidates.error, detailedCandidates.text).toBeFalsy();
    expect(detailedCandidates.value.items.some((item: any) => item.mode === 'extend_existing_synthesis' && item.synthesisBasis.state === 'current_revisions')).toBe(true);
    expect(await fs.readNoteRevision('Knowledge/Retry.md')).toBe(updated.value.revision);
    expect(await fs.readNoteRevision('Knowledge/Retry dissent.md')).toBe(dissent.value.revision);

    const plan = { question: 'Does the bounded condition avoid an unsafe retry?', targets: [{ path: 'Knowledge/Retry.md', revision: updated.value.revision }], conditions: 'Fixed fixture; idempotent read; unknown delivery outcome; elapsed rate-limit window.', alternatives: ['Bounded retry remains excluded', 'Bounded retry can be evaluated'], decisionRules: [{ observation: 'Payment creation is requested.', interpretation: 'challenges', consequence: 'Do not retry payment creation.' }], executionBoundary: 'This test records only fixture facts and executes no note instructions.' };
    const planned = await c.call('mcp.publish_knowledge', { path: 'Knowledge/Retry experiment.md', content: '# Retry experiment\n\nPlan only.', noteKind: 'experiment', evidencePaths: [newEdition.value.path], expectedRevision: 'missing', knowledgeInvestigation: plan }, token);
    expect(planned.error, planned.text).toBeFalsy();
    const result = await c.call('mcp.publish_knowledge', { path: 'Knowledge/Retry experiment.md', content: '# Retry experiment\n\nResult: keep payment creation excluded.', noteKind: 'experiment', evidencePaths: [newEdition.value.path], expectedRevision: planned.value.revision, epistemicStatus: 'inconclusive', knowledgeInvestigation: { ...plan, result: { planRevision: planned.value.revision, observed: 'The bounded fixture did not authorize payment creation.', outcome: 'inconclusive', interpretation: 'Keep the payment exclusion and question open.', limitations: 'Deterministic fixture only.', evidence: [{ path: newEdition.value.path, revision: newEdition.value.revision }] } } }, token);
    expect(result.error, result.text).toBeFalsy();
    const experimentRead = await c.call('notes.read', { path: 'Knowledge/Retry experiment.md', expectedRevision: result.value.revision, maxChars: 4000 });
    expect(experimentRead.error, experimentRead.text).toBeFalsy();
    expect(experimentRead.text).toContain(planned.value.revision);
    expect((await fs.readNote('Knowledge/Retry experiment.md')).frontmatter.knowledge_investigation).toEqual({ ...plan, result: { planRevision: planned.value.revision, observed: 'The bounded fixture did not authorize payment creation.', outcome: 'inconclusive', interpretation: 'Keep the payment exclusion and question open.', limitations: 'Deterministic fixture only.', evidence: [{ path: newEdition.value.path, revision: newEdition.value.revision }] } });
    const gaps = await c.call('wiki.knowledge_gaps', { maxChars: 4000, prettyPrint: true });
    expect(gaps.error, gaps.text).toBeFalsy();
    expect(gaps.text.length).toBeLessThanOrEqual(4000);
    expect(gaps.value.items.find((item: any) => item.path === 'Knowledge/Retry experiment.md').investigation.state).toBe('result_requires_review');
    const reviewAction = gaps.value.items.find((item: any) => item.path === 'Knowledge/Retry experiment.md').investigation.nextAction;
    expect(reviewAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'Knowledge/Retry.md', expectedRevision: updated.value.revision } });
    expect((await c.call(reviewAction.endpointId, reviewAction.arguments)).error).toBeFalsy();

    const saved = await c.call('continuity.save', { topic: 'Retry conditions', summary: 'Reported conditional understanding; this is not independently verified truth.', nextAction: 'Review the changed source and experiment result.', understanding: [{ explanation: 'The retry claim preserves both the elapsed-window condition and the payment negation.', supports: [{ path: 'scope://global/Knowledge/Retry.md', revision: updated.value.revision, startLine: 2, endLine: 2 }], openQuestions: ['How is idempotency established?'], nextStep: 'Read the current Retry note before relying on it.' }] }, token);
    expect(saved.error, saved.text).toBeFalsy();
    const resumed = await c.call('continuity.resume', { maxChars: 4000, prettyPrint: true }, token);
    expect(resumed.error, resumed.text).toBeFalsy();
    expect(resumed.text.length).toBeLessThanOrEqual(4000);
    expect(resumed.value.understanding).toMatchObject({ state: 'review_required', canResume: false, interpretation: 'self_reported', independence: 'not_established' });
    const pinnedRead = await c.call(resumed.value.understanding.nextAction.endpointId, resumed.value.understanding.nextAction.arguments, token);
    expect(pinnedRead.error, pinnedRead.text).toBeFalsy();

    const changedAgain = await c.call('mcp.publish_knowledge', { path: 'Knowledge/Retry.md', content: '# Retry\n\nChanged after handoff: re-review all retry conditions. Never retry payment creation.', noteKind: 'atomic', evidencePaths: [newEdition.value.path], expectedRevision: updated.value.revision }, token);
    expect(changedAgain.error, changedAgain.text).toBeFalsy();
    const stale = await c.call('continuity.resume', { maxChars: 4000 }, token);
    expect(stale.error, stale.text).toBeFalsy();
    expect(stale.value.understanding).toMatchObject({ state: 'stale_references', canResume: false });
    expect((await c.call(resumed.value.understanding.nextAction.endpointId, resumed.value.understanding.nextAction.arguments, token)).error).toBe(true);

    const secret = 'PRIVATE-STAGE8-CANARY';
    await fs.writeNote({ path: '_scopes/agents/other/Private.md', content: secret, frontmatter: { llm_wiki_type: 'source', immutable: true } });
    const privateRead = await c.call('wiki.source_compare', { sourcePath: '_scopes/agents/other/Private.md', query: 'PRIVATE', maxChars: 2000 });
    expect(privateRead.error).toBe(true);
    expect(privateRead.text).not.toContain(secret);
    const checkpointFile = join(vault, '_scopes/agents/learning-loop-worker/_continuity/work-state.md');
    const checkpointBeforeDenial = await readFile(checkpointFile, 'utf8');
    expect((await c.call('mcp.publish_knowledge', { path: 'Knowledge/Denied.md', content: 'No anonymous write.', expectedRevision: 'missing' })).error).toBe(true);
    expect((await c.call('continuity.save', { topic: 'Denied', summary: 'No anonymous checkpoint.', nextAction: 'None' })).error).toBe(true);
    await expect(readFile(join(vault, 'Knowledge/Denied.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(checkpointFile, 'utf8')).toBe(checkpointBeforeDenial);
  } finally { await c.close(); }
});
