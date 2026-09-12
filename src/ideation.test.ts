import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import { IdeationService } from './ideation.js';
import { createFacilitation, managedFacilitationMarkdown } from './workshop-facilitation.js';
import { FileSystemService } from './filesystem.js';

let vault: string;

test('a tiny method catalog budget increases the next read budget rather than repeating an empty page', () => {
  const service = new IdeationService({} as any, {} as any);
  const page = service.getWorkshopMethods({ maxChars: 512 });
  expect(JSON.stringify(page).length).toBeLessThanOrEqual(512);
  expect(page.truncated).toBe(true);
  expect(page.nextAction?.arguments.maxChars).toBeGreaterThan(512);
  const next = service.getWorkshopMethods(page.nextAction!.arguments);
  expect(next.methods.length).toBeGreaterThan(0);
});

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-ideation-'));
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

async function setup() {
  const server = createServer(vault, { version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'ideation-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { server, client };
}

async function json(client: Client, name: string, arguments_: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: arguments_ });
  if (result.isError) throw new Error((result.content as any)[0].text);
  return { result, value: JSON.parse((result.content as any)[0].text) };
}

test('Idea Lab preserves branches, bounded critiques, evaluations, and revision-safe status', async () => {
  const { server, client } = await setup();
  try {
    const registration = await json(client, 'register_scope_account', { accountId: 'idea-owner', modelId: 'codex', password: 'idea-owner-password-123' });
    const accessToken = registration.value.accessToken;
    await client.callTool({ name: 'write_note', arguments: { path: 'IdeaEvidence.md', content: 'Evidence for the initial idea.', accessToken } });

    const catalog = await json(client, 'search_capabilities', { query: 'brainstorm', limit: 20 });
    expect(catalog.value.endpoints.some((endpoint: any) => endpoint.endpointId === 'idea.create')).toBe(true);
    expect(catalog.value.endpoints.some((endpoint: any) => endpoint.endpointId === 'workshop.create')).toBe(true);
    const bypass = await client.callTool({ name: 'write_note', arguments: { path: 'Community/Ideas/bypass.md', content: 'Managed content must use Idea Lab.', accessToken } });
    expect(bypass.isError).toBe(true);

    const created = await json(client, 'create_idea', {
      ideaId: 'bounded-idea', title: 'Bounded collaboration', seed: 'Use short projections to let agents improve a shared Wiki [[IdeaEvidence]].',
      successCriteria: ['A later agent can continue without reading the full transcript.'], accessToken,
    });
    expect(created.value).toMatchObject({ ideaId: 'bounded-idea', status: 'seed' });
    const initial = await json(client, 'read_idea', { ideaId: 'bounded-idea', accessToken });
    expect(initial.value.idea.references).toEqual(['IdeaEvidence.md']);

    const contribution = await json(client, 'contribute_idea', { ideaId: 'bounded-idea', kind: 'challenge', content: 'What happens when a short projection hides the strongest counterexample?', accessToken });
    expect(contribution.value).toMatchObject({ success: true, kind: 'challenge' });
    const evaluation = await json(client, 'evaluate_idea', { ideaId: 'bounded-idea', novelty: 4, usefulness: 5, feasibility: 3, risk: 2, evidenceQuality: 4, rationale: 'Useful if the projection always exposes unresolved objections.', accessToken });
    expect(evaluation.value.success).toBe(true);

    const branch = await json(client, 'branch_idea', { parentIdeaId: 'bounded-idea', title: 'Projection with objections', seed: 'Always reserve one bounded slot for the strongest unresolved objection.', expectedParentRevision: initial.value.idea.revision, accessToken });
    expect(branch.value.parentIdeaId).toBe('bounded-idea');
    const bounded = await json(client, 'read_idea', { ideaId: 'bounded-idea', maxChars: 900, accessToken });
    expect(bounded.value.idea.ideaId).toBe('bounded-idea');
    expect(bounded.value.truncated).toBe(true);

    const workshop = await json(client, 'create_workshop', { workshopId: 'projection-workshop', title: 'Improve projections', prompt: 'How should a bounded read preserve useful disagreement?', agenda: ['independent ideas', 'counterexamples', 'synthesis'], ideaIds: ['bounded-idea', branch.value.ideaId], accessToken });
    expect(workshop.value.phase).toBe('diverge');
    const pulse = await json(client, 'get_agent_pulse', { accessToken });
    expect(pulse.value).toMatchObject({
      nextAction: { tool: 'workshop.read', target: 'projection-workshop', followUpTool: 'workshop.contribute' },
      signals: { activeWorkshops: 1, maintenanceAvailable: false, ownPublishedPosts: 0 },
      context: expect.arrayContaining([expect.objectContaining({ kind: 'workshop' })]),
    });
    const workshopRead = await json(client, 'read_workshop', { workshopId: 'projection-workshop', accessToken });
    const workshopContribution = await json(client, 'contribute_workshop', { workshopId: 'projection-workshop', kind: 'idea', content: 'Reserve one response slot for the least-supported but highest-impact objection.', expectedPhase: 'diverge', accessToken });
    expect(workshopContribution.value.phase).toBe('diverge');
    const advanced = await json(client, 'update_workshop_phase', { workshopId: 'projection-workshop', phase: 'critique', reason: 'The initial ideas are captured; now test failure modes.', expectedRevision: workshopRead.value.workshop.revision, accessToken });
    expect(advanced.value.phase).toBe('critique');
    const synthesized = await json(client, 'synthesize_workshop', { workshopId: 'projection-workshop', synthesis: 'Use a bounded summary plus one unresolved objection and a link to the full thread.', references: ['IdeaEvidence.md'], expectedRevision: advanced.value.revision, accessToken });
    expect(synthesized.value).toMatchObject({ phase: 'decide', synthesisStatus: 'proposed' });
  } finally {
    await client.close();
    await server.close();
  }
});

test('branch_idea forwards a retry key through the MCP dispatcher', async () => {
  const { server, client } = await setup();
  try {
    const registration = await json(client, 'register_scope_account', { accountId: 'branch-retry-owner', modelId: 'codex', password: 'branch-retry-owner-password-123' });
    const accessToken = registration.value.accessToken;
    const parent = await json(client, 'create_idea', { ideaId: 'retry-parent', title: 'Retry parent', seed: 'Preserve branch creation retries.', accessToken });
    const request = { parentIdeaId: 'retry-parent', title: 'Retry child', seed: 'One durable branch.', expectedParentRevision: parent.value.revision, requestId: 'branch-mcp-retry', accessToken };
    const first = await json(client, 'branch_idea', request);
    const replay = await json(client, 'branch_idea', request);
    expect(replay.value.ideaId).toBe(first.value.ideaId);
  } finally {
    await client.close();
    await server.close();
  }
});

test('evaluate_idea forwards expectedIdeaRevision through the MCP dispatcher', async () => {
  const { server, client } = await setup();
  try {
    const registration = await json(client, 'register_scope_account', { accountId: 'evaluation-revision-owner', modelId: 'codex', password: 'evaluation-revision-owner-password-123' });
    const accessToken = registration.value.accessToken;
    await json(client, 'create_idea', { ideaId: 'evaluation-parent', title: 'Evaluation parent', seed: 'Reject stale source evaluations.', accessToken });
    const result = await client.callTool({ name: 'evaluate_idea', arguments: {
      ideaId: 'evaluation-parent', novelty: 4, usefulness: 4, feasibility: 3, risk: 2, evidenceQuality: 4,
      rationale: 'The supplied source revision must be current.', expectedIdeaRevision: '0'.repeat(64), accessToken,
    } });
    expect(result.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('branch_idea preserves initiate-only participation accounting and replays its one receipt', async () => {
  const { server, client } = await setup();
  try {
    const registration = await json(client, 'register_scope_account', { accountId: 'branch-participation-owner', modelId: 'codex', password: 'branch-participation-owner-password-123' });
    const accessToken = registration.value.accessToken;
    const parent = await json(client, 'create_idea', { ideaId: 'participation-parent', title: 'Branch parent', seed: 'Preserve the initiation limit.', accessToken });
    const settings = await json(client, 'manage_community_participation', {
      op: 'update', expectedRevision: 'missing', requestId: 'enable-branch-participation',
      settings: { enabled: true, allowedTopics: ['branch'], allowedActions: ['explore', 'initiate'] }, accessToken,
    });
    const explore = await json(client, 'record_community_participation', {
      op: 'start', action: 'explore', topic: 'branch', expectedRevision: settings.value.revision, requestId: 'start-explore-branch', accessToken,
    });
    const branch = { parentIdeaId: 'participation-parent', title: 'Branch child', seed: 'Create one branch.', expectedParentRevision: parent.value.revision, accessToken };
    const denied = await client.callTool({ name: 'branch_idea', arguments: { ...branch, requestId: explore.value.activeRun.publicRequestId } });
    expect(denied.isError).toBe(true);
    const initiator = await json(client, 'register_scope_account', { accountId: 'branch-initiation-owner', modelId: 'codex', agentId: 'branch-initiation-agent', password: 'branch-initiation-owner-password-123', accessToken });
    const initiatorToken = initiator.value.accessToken;
    const initiateSettings = await json(client, 'manage_community_participation', {
      op: 'update', expectedRevision: 'missing', requestId: 'enable-branch-initiation',
      settings: { enabled: true, allowedTopics: ['branch'], allowedActions: ['initiate'] }, accessToken: initiatorToken,
    });
    const initiate = await json(client, 'record_community_participation', {
      op: 'start', action: 'initiate', topic: 'branch', expectedRevision: initiateSettings.value.revision, requestId: 'start-initiate-branch', accessToken: initiatorToken,
    });
    const first = await json(client, 'branch_idea', { ...branch, requestId: initiate.value.activeRun.publicRequestId, accessToken: initiatorToken });
    const replay = await json(client, 'branch_idea', { ...branch, requestId: initiate.value.activeRun.publicRequestId, accessToken: initiatorToken });
    expect(replay.value.ideaId).toBe(first.value.ideaId);
    const recorded = await json(client, 'manage_community_participation', { op: 'read', accessToken: initiatorToken });
    expect(recorded.value).toMatchObject({ daily: { initiations: 1 }, activeRun: { action: 'initiate', publicAttempt: { operation: 'idea.branch', path: first.value.path } } });
  } finally {
    await client.close();
    await server.close();
  }
});

test('managed facilitation rejects inaccessible sources and stale steps, replays requests, and advances only after actual participants submit', async () => {
  const { server, client } = await setup();
  try {
    const owner = await json(client, 'register_scope_account', { accountId: 'fac-owner', modelId: 'codex', password: 'fac-owner-password-123' });
    const participant = await json(client, 'register_scope_account', { accountId: 'fac-participant', modelId: 'codex', agentId: 'fac-participant-agent', password: 'fac-participant-password-123', accessToken: owner.value.accessToken });
    const evidence = await json(client, 'write_note', { path: 'Facilitation evidence.md', content: 'A visible source for the managed workshop.', accessToken: owner.value.accessToken });
    const config = {
      version: 1, methods: [{ methodId: 'brainwriting' }], purpose: 'Generate bounded alternatives.', scope: 'Public workshop only.',
      successCriteria: ['Two distinct independent ideas are recorded.'], sourceRevisions: [{ path: 'Facilitation evidence.md', revision: evidence.value.revision }],
      facilitatorAccountId: 'fac-owner', participants: ['fac-owner', 'fac-participant'], decisionAuthority: { approverAccountId: 'fac-owner' },
    };
    const inaccessible = await client.callTool({ name: 'create_workshop', arguments: {
      workshopId: 'managed-private-source', title: 'Private source must fail', prompt: 'Do not disclose a private source.',
      facilitation: { ...config, sourceRevisions: [{ path: '_scopes/agents/secret/Hidden.md', revision: 'a'.repeat(64) }] }, accessToken: owner.value.accessToken,
    } });
    expect(inaccessible.isError).toBe(true);

    const created = await json(client, 'create_workshop', { workshopId: 'managed-brainwriting', title: 'Managed brainwriting', prompt: 'Generate alternatives.', facilitation: config, accessToken: owner.value.accessToken });
    const methods = await json(client, 'list_workshop_methods', { methodId: 'brainwriting', accessToken: owner.value.accessToken });
    expect(methods.value.methods[0]).toMatchObject({ methodId: 'brainwriting', steps: expect.any(Array) });
    const state = await json(client, 'read_workshop_facilitation', { workshopId: 'managed-brainwriting', accessToken: owner.value.accessToken });
    expect(state.value).toMatchObject({ managed: true, revision: created.value.revision, nextAction: { stepId: 'brainwriting-independent' } });
    const forgedOutput = await client.callTool({ name: 'update_workshop_facilitation', arguments: {
      workshopId: 'managed-brainwriting', expectedRevision: state.value.revision, requestId: 'managed-forged-output', operation: 'record_output',
      payload: { output: { type: 'facilitation_receipt', status: 'accepted' } }, accessToken: owner.value.accessToken,
    } });
    expect(forgedOutput.isError).toBe(true);

    const stale = await client.callTool({ name: 'contribute_workshop', arguments: {
      workshopId: 'managed-brainwriting', kind: 'idea', content: 'This must not land in a later step.', expectedRevision: state.value.revision,
      stepId: 'brainwriting-build', structured: { extension: 'No stale step.' }, requestId: 'managed-stale-step', accessToken: owner.value.accessToken,
    } });
    expect(stale.isError).toBe(true);
    const first = await json(client, 'contribute_workshop', {
      workshopId: 'managed-brainwriting', kind: 'idea', content: 'First independent alternative.', expectedRevision: state.value.revision,
      stepId: 'brainwriting-independent', structured: { variant:'async', ideaIds: [{ideaId:'first-alternative',origin:'fac-owner'}] }, requestId: 'managed-first', accessToken: owner.value.accessToken,
    });
    const replay = await json(client, 'contribute_workshop', {
      workshopId: 'managed-brainwriting', kind: 'idea', content: 'First independent alternative.', expectedRevision: state.value.revision,
      stepId: 'brainwriting-independent', structured: { variant:'async', ideaIds: [{ideaId:'first-alternative',origin:'fac-owner'}] }, requestId: 'managed-first', accessToken: owner.value.accessToken,
    });
    expect(replay.value.contributionId).toBe(first.value.contributionId);
    await json(client, 'contribute_workshop', {
      workshopId: 'managed-brainwriting', kind: 'idea', content: 'Second independent alternative.', expectedRevision: state.value.revision,
      stepId: 'brainwriting-independent', structured: { variant:'async', ideaIds: [{ideaId:'second-alternative',origin:'fac-participant'}] }, requestId: 'managed-second', accessToken: participant.value.accessToken,
    });
    const advanced = await json(client, 'update_workshop_facilitation', {
      workshopId: 'managed-brainwriting', expectedRevision: state.value.revision, requestId: 'managed-advance', operation: 'advance',
      payload: { reason: 'Both configured accounts supplied independent ideas.' }, accessToken: owner.value.accessToken,
    });
    expect(advanced.value.currentStepId).toBe('brainwriting-build');
    const staleAdvance = await client.callTool({ name: 'update_workshop_facilitation', arguments: {
      workshopId: 'managed-brainwriting', expectedRevision: state.value.revision, requestId: 'managed-stale-advance', operation: 'advance',
      payload: { reason: 'This revision is stale.' }, accessToken: owner.value.accessToken,
    } });
    expect(staleAdvance.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('managed facilitation persists handoff, revocation, concurrent advance, restart, bounded cursors, and malformed-config rejection', async () => {
  let active = await setup();
  try {
    const owner = await json(active.client, 'register_scope_account', { accountId: 'handoff-owner', modelId: 'codex', password: 'handoff-owner-password-123' });
    const facilitator = await json(active.client, 'register_scope_account', { accountId: 'handoff-facilitator', modelId: 'codex', agentId: 'handoff-facilitator-agent', password: 'handoff-facilitator-password-123', accessToken: owner.value.accessToken });
    const extra = await json(active.client, 'register_scope_account', { accountId: 'handoff-extra', modelId: 'codex', agentId: 'handoff-extra-agent', password: 'handoff-extra-password-123', accessToken: owner.value.accessToken });
    const evidence = await json(active.client, 'write_note', { path: 'Handoff evidence.md', content: 'Visible managed-workshop basis.', accessToken: owner.value.accessToken });
    const config = {
      version: 1, methods: [{ methodId: 'brainwriting' }], purpose: 'Exercise durable managed state.', scope: 'Public workshop only.',
      successCriteria: ['A handoff remains account-bound after restart.'], sourceRevisions: [{ path: 'Handoff evidence.md', revision: evidence.value.revision }],
      facilitatorAccountId: 'handoff-owner', participants: ['handoff-owner', 'handoff-facilitator', 'handoff-extra'], decisionAuthority: { approverAccountId: 'handoff-owner' },
    };
    await json(active.client, 'create_workshop', { workshopId: 'managed-handoff', title: 'Managed handoff', prompt: 'Exercise handoff.', facilitation: config, accessToken: owner.value.accessToken });
    const initial = await json(active.client, 'read_workshop_facilitation', { workshopId: 'managed-handoff' });
    await json(active.client, 'contribute_workshop', { workshopId: 'managed-handoff', kind: 'idea', content: 'Owner idea.', expectedRevision: initial.value.revision, stepId: 'brainwriting-independent', structured: { variant:'async',ideaIds: [{ideaId:'owner-idea',origin:'handoff-owner'}] }, requestId: 'handoff-owner-idea', accessToken: owner.value.accessToken });
    await json(active.client, 'contribute_workshop', { workshopId: 'managed-handoff', kind: 'idea', content: 'Facilitator idea.', expectedRevision: initial.value.revision, stepId: 'brainwriting-independent', structured: { variant:'async',ideaIds: [{ideaId:'facilitator-idea',origin:'handoff-facilitator'}] }, requestId: 'handoff-facilitator-idea', accessToken: facilitator.value.accessToken });
    const handedOff = await json(active.client, 'update_workshop_facilitation', { workshopId: 'managed-handoff', expectedRevision: initial.value.revision, requestId: 'handoff-change', operation: 'handoff', payload: { facilitatorAccountId: 'handoff-facilitator' }, accessToken: owner.value.accessToken });
    expect(handedOff.value).toMatchObject({ facilitatorAccountId: 'handoff-facilitator' });
    const formerOwner = await active.client.callTool({ name: 'update_workshop_facilitation', arguments: { workshopId: 'managed-handoff', expectedRevision: handedOff.value.revision, requestId: 'handoff-former-owner', operation: 'resume', payload: { resumeCondition: 'Should reject.' }, accessToken: owner.value.accessToken } });
    expect(formerOwner.isError).toBe(true);
    const formerOwnerReplay = await active.client.callTool({ name: 'update_workshop_facilitation', arguments: { workshopId: 'managed-handoff', expectedRevision: initial.value.revision, requestId: 'handoff-change', operation: 'handoff', payload: { facilitatorAccountId: 'handoff-facilitator' }, accessToken: owner.value.accessToken } });
    expect(formerOwnerReplay.isError).toBe(true);
    const revoked = await json(active.client, 'update_workshop_facilitation', { workshopId: 'managed-handoff', expectedRevision: handedOff.value.revision, requestId: 'handoff-revoke', operation: 'revoke', payload: { accountId: 'handoff-extra' }, accessToken: facilitator.value.accessToken });
    expect(revoked.value.facilitatorAccountId).toBe('handoff-facilitator');
    const advances = await Promise.all(['handoff-advance-a', 'handoff-advance-b'].map(requestId => active.client.callTool({ name: 'update_workshop_facilitation', arguments: { workshopId: 'managed-handoff', expectedRevision: revoked.value.revision, requestId, operation: 'advance', payload: { reason: 'Both actual participants submitted.' }, accessToken: facilitator.value.accessToken } })));
    expect(advances.filter(result => !result.isError)).toHaveLength(1);

    for (let index = 0; index < 3; index++) {
      await json(active.client, 'contribute_workshop', { workshopId: 'managed-handoff', kind: 'extension', content: `Bounded build ${index}.`, expectedRevision: advances.find(result => !result.isError) ? JSON.parse((advances.find(result => !result.isError)!.content as any)[0].text).revision : '', stepId: 'brainwriting-build', structured: { ideaIds: [{ideaId:`build-${index}`,origin:'handoff-facilitator',parentIdeaId:'owner-idea',extension:`Build ${index}.`}], extension: `Build ${index}.`, parentIdeaIds: ['owner-idea'] }, requestId: `handoff-build-${index}`, accessToken: facilitator.value.accessToken });
    }
    await expect(json(active.client, 'read_workshop_facilitation', { workshopId: 'managed-handoff', limit: 1, maxChars: 512 })).rejects.toThrow(/maxChars.*too small/);
    const page = await json(active.client, 'read_workshop_facilitation', { workshopId: 'managed-handoff', limit: 1, maxChars: 6000 });
    expect(page.value.truncated).toBe(true);
    expect(page.value.cursor).toBeDefined();
    expect(JSON.stringify(page.value).length).toBeLessThanOrEqual(6000);
    const second = await json(active.client, 'read_workshop_facilitation', { workshopId: 'managed-handoff', limit: 1, maxChars: 6000, cursor: page.value.cursor });
    expect(second.value.submissions[0].contributionId).not.toBe(page.value.submissions[0].contributionId);

    await active.client.close();
    await active.server.close();
    active = await setup();
    const restarted = await json(active.client, 'read_workshop_facilitation', { workshopId: 'managed-handoff' });
    expect(restarted.value).toMatchObject({ managed: true, facilitation: { facilitatorAccountId: 'handoff-facilitator' } });
    await writeFile(join(vault, 'Community', 'Workshops', 'managed-malformed.md'), '---\nmcpvault_type: workshop\nworkshop_id: managed-malformed\nfacilitation: malformed\n---\n# Malformed\n', 'utf8');
    const malformed = await active.client.callTool({ name: 'read_workshop_facilitation', arguments: { workshopId: 'managed-malformed' } });
    expect(malformed.isError).toBe(true);
    await expect(readFile(join(vault, 'Community', 'Workshops', 'managed-malformed.md'), 'utf8')).resolves.toContain('facilitation: malformed');
    expect(extra.value.accessToken).toEqual(expect.any(String));
  } finally {
    await active.client.close();
    await active.server.close();
  }
});

test('managed mutation stops before writing when final actor revalidation fails', async () => {
  const revision = 'a'.repeat(64);
  const facilitation = createFacilitation({
    version: 1, methods: [{ methodId: 'brainwriting' }], purpose: 'Verify final actor.', scope: 'Test only.', successCriteria: ['No write after actor change.'],
    sourceRevisions: [{ path: 'Evidence.md', revision }], facilitatorAccountId: 'callback-owner', participants: ['callback-owner'], decisionAuthority: {},
  });
  const note = { path: 'Community/Workshops/callback.md', revision, content: `# Callback\n\n${managedFacilitationMarkdown(facilitation)}\n`, frontmatter: { mcpvault_type: 'workshop', workshop_id: 'callback', facilitator_account_id: 'callback-owner', facilitation } };
  let writes = 0;
  const service = new IdeationService({ readNote: async () => note, writeNote: async () => { writes++; } } as any, {
    validateAndNormalize: async (paths: unknown) => Array.isArray(paths) ? paths : [],
  } as any);
  await expect(service.updateWorkshopFacilitation({ principal: { accountId: 'callback-owner', modelId: 'codex', role: 'model' }, workshopId: 'callback', expectedRevision: revision, requestId: 'callback-resume', operation: 'resume', payload: { resumeCondition: 'A verified actor is required.' }, revalidateActor: async () => ({ accountId: 'other-account', modelId: 'codex', role: 'model' }) })).rejects.toThrow(/account changed/i);
  expect(writes).toBe(0);
});

test('managed contribution scan overflow reports unknown completion and never advances', async () => {
  const { server, client } = await setup();
  try {
    const owner = await json(client, 'register_scope_account', { accountId: 'scan-owner', modelId: 'codex', password: 'scan-owner-password-123' });
    const evidence = await json(client, 'write_note', { path: 'Scan evidence.md', content: 'Current source.', accessToken: owner.value.accessToken });
    const config = {
      version: 1, methods: [{ methodId: 'brainwriting' }], purpose: 'Bounded scan.', scope: 'Public only.', successCriteria: ['Never infer from a partial scan.'],
      sourceRevisions: [{ path: 'Scan evidence.md', revision: evidence.value.revision }], facilitatorAccountId: 'scan-owner', participants: ['scan-owner'], decisionAuthority: {},
    };
    const created = await json(client, 'create_workshop', { workshopId: 'scan-overflow', title: 'Scan overflow', prompt: 'Bound current-step aggregation.', facilitation: config, accessToken: owner.value.accessToken });
    const fs = new FileSystemService(vault);
    for (let index = 0; index < 129; index++) {
      await fs.writeNote({ path: `Community/Workshops/scan-overflow/Contributions/raw-${index}.md`, content: '# Raw contribution\n', frontmatter: {
        mcpvault_type: 'workshop_contribution', workshop_id: 'scan-overflow', contribution_id: `raw-${index}`, account_id: 'scan-owner', kind: 'idea', phase: 'diverge',
        facilitation_step_id: 'brainwriting-independent', workshop_revision: created.value.revision,
        structured: { variant:'async',ideaIds: [{ideaId:`raw-${index}`,origin:'scan-owner'}] }, created_at: `2026-09-08T00:00:${String(index).padStart(2, '0')}Z`,
      } });
    }
    const read = await json(client, 'read_workshop_facilitation', { workshopId: 'scan-overflow', limit: 1, maxChars: 12000, accessToken: owner.value.accessToken });
    expect(read.value).toMatchObject({ completionUnknown: true, nextAction: { kind: 'blocked' } });
    const advance = await client.callTool({ name: 'update_workshop_facilitation', arguments: {
      workshopId: 'scan-overflow', expectedRevision: created.value.revision, requestId: 'scan-overflow-advance', operation: 'advance', payload: { reason: 'Must not advance.' }, accessToken: owner.value.accessToken,
    } });
    expect(advance.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});
