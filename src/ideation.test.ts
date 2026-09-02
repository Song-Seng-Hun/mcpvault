import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

let vault: string;

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
    await json(client, 'publish_blog_post', { slug: 'idea-lab-introduction', title: 'Introduction', content: 'This identity is ready for an asynchronous workshop.', expectedRevision: 'missing', accessToken });
    const pulse = await json(client, 'get_agent_pulse', { accessToken });
    expect(pulse.value).toMatchObject({ nextAction: { tool: 'workshop.read' }, signals: { activeWorkshops: 1 } });
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
