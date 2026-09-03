import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { createHash } from 'node:crypto';

let vault: string;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-llm-wiki-'));
});

test('weekly review separates schedule from deadline and exposes reverse focus context', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'focus-review-owner', modelId: 'codex', password: 'focus-review-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Goals/Launch.md', '# Launch goal\n', { note_kind: 'knowledge', lifecycle: 'evergreen', focus_horizon: 'goal' });
    await write('Projects/Build.md', '# Build project\n', { llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active', focus_horizon: 'project', focus_parent: '[[Goals/Launch]]' });
    await write('Tasks/Run.md', '# Run task\n', { llm_wiki_type: 'knowledge', note_kind: 'task', lifecycle: 'active', focus_horizon: 'ground', focus_parent: '[[Projects/Build]]', task_status: 'next_action', next_action: 'Run the test', scheduled_at: '2030-01-02T10:00:00.000Z', due_at: '2030-01-03T10:00:00.000Z' });
    await write('Knowledge/Reason.md', '# Reason\n', { note_kind: 'atomic', lifecycle: 'evergreen', focus_horizon: 'ground', focus_supports: ['[[Projects/Build]]'], summary: 'The test has a reusable rationale.' });

    const dashboard = await callJson(client, 'get_wiki_review_dashboard', { limit: 20, accessToken });
    expect(dashboard.value.sections.scheduled).toMatchObject({ total: 1, items: [expect.objectContaining({ path: 'Tasks/Run.md', scheduledAt: '2030-01-02T10:00:00.000Z', dueAt: '2030-01-03T10:00:00.000Z', readiness: 'ready' })] });
    expect(dashboard.value.sections.projectReadiness.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Tasks/Run.md', readiness: 'ready' })]));

    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 20, accessToken });
    expect(graph.value.focusHealth.reverseMap.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Projects/Build.md', children: expect.arrayContaining(['tasks/run.md']), supportingNotes: expect.arrayContaining(['knowledge/reason.md']) }),
    ]));
    expect(graph.value.knowledgeConnectivity.literatureWithoutInterpretation.total).toBe(0);

    const bases = await callJson(client, 'get_wiki_bases_view', { view: 'projects', accessToken });
    expect(bases.value).toMatchObject({ view: 'projects', suggestedPath: 'Views/LLM Wiki Projects.base', matchingNotes: 2 });
    expect(bases.value.content).toContain('note.note_kind == "project" || note.note_kind == "task"');
  } finally {
    await client.close();
    await server.close();
  }
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

test('lint reports cross-note Properties type drift as an advisory organization issue', async () => {
  const { server, client } = await setup();
  try {
    await writeFile(join(vault, 'one.md'), '---\ntags: [research]\n---\nOne\n');
    await writeFile(join(vault, 'two.md'), '---\ntags: research\n---\nTwo\n');
    const lint = await callJson(client, 'lint_wiki', { limit: 20 });
    expect(lint.value.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'property_type_drift', path: 'two.md' }),
    ]));
    const health = await callJson(client, 'get_wiki_organization_health', { limit: 20 });
    expect(health.value.byCode.property_type_drift).toBe(1);
  } finally {
    await client.close();
    await server.close();
  }
});

test('lint reports library vocabulary orphans, cycles, and deprecated facet use', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'vocabulary-health-owner', modelId: 'codex', password: 'vocabulary-health-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Knowledge/Old Term.md', '# Old Term\n', { note_kind: 'knowledge', lifecycle: 'evergreen', term_status: 'deprecated', term_replaced_by: '[[Knowledge/Preferred Term]]' });
    await write('Knowledge/Preferred Term.md', '# Preferred Term\n', { note_kind: 'knowledge', lifecycle: 'evergreen', broader_terms: ['[[Knowledge/Other Term]]'] });
    await write('Knowledge/Other Term.md', '# Other Term\n', { note_kind: 'knowledge', lifecycle: 'evergreen', broader_terms: ['[[Knowledge/Preferred Term]]'] });
    await write('Knowledge/Facet User.md', '# Facet User\n', { note_kind: 'knowledge', lifecycle: 'evergreen', subject_terms: ['Old Term'] });
    await write('Knowledge/Missing Parent.md', '# Missing Parent\n', { note_kind: 'knowledge', lifecycle: 'evergreen', broader_terms: ['[[Knowledge/Does Not Exist]]'] });

    const lint = await callJson(client, 'lint_wiki', { limit: 50, accessToken });
    expect(lint.value.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'broader_term_cycle' }),
      expect.objectContaining({ code: 'unresolved_broader_terms', path: 'Knowledge/Missing Parent.md' }),
      expect.objectContaining({ code: 'deprecated_term_used', path: 'Knowledge/Facet User.md' }),
    ]));
    const health = await callJson(client, 'get_wiki_organization_health', { limit: 50, accessToken });
    expect(health.value.byCode.broader_term_cycle).toBeGreaterThan(0);
  } finally {
    await client.close();
    await server.close();
  }
});

test('term resolution, merge preview, and citation graph stay bounded and non-mutating', async () => {
  await mkdir(join(vault, '_sources'), { recursive: true });
  const sourceContent = '# Evidence\n\nThe source supports a durable claim.\n';
  const sourceHash = createHash('sha256').update(sourceContent).digest('hex');
  await writeFile(join(vault, '_sources', 'paper.md'), [
    '---',
    'mcpvault_type: source',
    'llm_wiki_type: source',
    'immutable: true',
    'title: A source paper',
    'citation_key: paper-2026',
    'source_type: paper',
    `content_sha256: ${sourceHash}`,
    '---',
    sourceContent,
  ].join('\n'));
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-resolution-owner', modelId: 'codex', password: 'organization-resolution-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
      return callJson(client, 'read_note', { path, accessToken });
    };
    await write('Knowledge/AI Agent.md', '# AI Agent\n\nA canonical concept.\n', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', aliases: ['agentic model'], stable_id: 'ai-agent' });
    await write('Knowledge/Old Agent Term.md', '# Old Agent Term\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'superseded', term_status: 'deprecated', term_replaced_by: '[[Knowledge/AI Agent]]' });
    const resolved = await callJson(client, 'call_endpoint', { endpointId: 'wiki.resolve_term', arguments: { query: 'agentic model', accessToken, maxChars: 3000 } });
    expect(resolved.value.resolved).toMatchObject({ canonicalTerm: 'AI Agent', path: 'Knowledge/AI Agent.md' });
    expect(resolved.value.matches[0]).toMatchObject({ matchKind: 'alias', matchedTerm: 'agentic model' });

    const source = await write('Knowledge/Source Copy.md', '# Source Copy\n\n[[Knowledge/AI Agent]]\n\nA source-backed claim.\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'review', stable_id: 'source-copy', evidence_paths: ['_sources/paper.md'] });
    const target = await write('Knowledge/Canonical Copy.md', '# Canonical Copy\n\n[[Knowledge/AI Agent]]\n\nA consolidated claim.\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', stable_id: 'canonical-copy', evidence_paths: ['_sources/paper.md'] });
    const merge = await callJson(client, 'call_endpoint', { endpointId: 'wiki.merge_preview', arguments: { sourcePath: 'Knowledge/Source Copy.md', targetPath: 'Knowledge/Canonical Copy.md', accessToken, maxChars: 5000 } });
    expect(merge.value).toMatchObject({ mode: 'bounded_merge_preview', recommendation: 'do_not_merge_without_identity_decision' });
    expect(merge.value.conflicts).toEqual(expect.arrayContaining(['different_titles', 'different_stable_ids', 'different_lifecycles', 'shared_evidence']));
    expect(merge.value.source.revision).toBe(source.value.revision);
    expect(merge.value.target.revision).toBe(target.value.revision);
    expect(merge.value.note).toContain('no files');

    const graph = await callJson(client, 'call_endpoint', { endpointId: 'wiki.citation_graph', arguments: { accessToken, limit: 10, maxChars: 5000 } });
    expect(graph.value.totals).toMatchObject({ sources: 1 });
    expect(graph.value.sources).toEqual(expect.arrayContaining([expect.objectContaining({ path: '_sources/paper.md', usedByCount: 2 })]));
    expect(graph.value.edges).toEqual(expect.arrayContaining([expect.objectContaining({ from: 'Knowledge/Source Copy.md', to: '_sources/paper.md', relation: 'evidence' })]));
    expect(JSON.stringify(graph.value).length).toBeLessThanOrEqual(5000);
  } finally {
    await client.close();
    await server.close();
  }
});

async function setup() {
  const server = createServer(vault, { version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'llm-wiki-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { server, client };
}

async function callJson(client: Client, name: string, arguments_: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: arguments_ });
  return { result, value: JSON.parse((result.content as any)[0].text) };
}

test('recognizes a manually maintained public schema without frontmatter', async () => {
  const { server, client } = await setup();
  try {
    await mkdir(join(vault, '_wiki'), { recursive: true });
    await writeFile(join(vault, '_wiki', 'SCHEMA.md'), '# LLM Wiki schema\n\nPlain Markdown remains a valid public schema.\n');

    const catalog = await callJson(client, 'get_wiki_catalog', {});
    expect(catalog.value).toMatchObject({ counts: { schema: 1 }, total: 1, schemaPresent: true });

    const orientation = await callJson(client, 'orient_wiki', {});
    expect(orientation.value.publicOnboarding).toMatchObject({ schemaPath: '_wiki/SCHEMA.md', readableWithoutLogin: true });
    expect(orientation.value.nextActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: 'notes.read', arguments: { path: '_wiki/SCHEMA.md' } }),
    ]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('catalog facets and explainable knowledge neighborhoods stay bounded', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'neighborhood-owner', modelId: 'codex', password: 'neighborhood-owner-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Knowledge/Anchor.md', '# Anchor\n\nA durable anchor. [[Knowledge/Linked]]\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', moc: '[[MOCs/Research]]', tags: ['research', 'anchor'] });
    await write('Knowledge/Linked.md', '# Linked\n\n[[Knowledge/Anchor]]\n', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'review', moc: '[[MOCs/Research]]', tags: ['research'] });
    await write('Knowledge/Project.md', '# Project\n', { llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active', project: '[[Projects/Build]]', tags: ['build'] });

    const catalog = await callJson(client, 'get_wiki_catalog', { includeFacets: true, facetLimit: 10, limit: 2, maxChars: 5000, accessToken });
    expect(catalog.value.facets).toMatchObject({ noteKind: { knowledge: 1, atomic: 1, project: 1 }, lifecycle: { evergreen: 1, review: 1, active: 1 }, tag: { research: 2 } });
    expect(catalog.value.entries).toHaveLength(2);

    const neighborhood = await callJson(client, 'get_wiki_neighborhood', { path: 'Knowledge/Anchor.md', limit: 5, maxChars: 3000, accessToken });
    expect(neighborhood.value.source.path).toBe('Knowledge/Anchor.md');
    expect(neighborhood.value.neighbors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Linked.md', reasons: expect.arrayContaining(['direct_link', 'shared_moc']) }),
    ]));
    expect(neighborhood.value.neighbors.every((item: Record<string, unknown>) => !('content' in item))).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('knowledge organization contract preserves aliases, projections, and typed relations', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-contract-owner', modelId: 'codex', password: 'organization-contract-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', {
      sourceId: 'organization-contract-source', title: 'Organization contract source', content: '# Source\n\n## Evidence\n\nTyped links and compact projections make knowledge easier to maintain. ^contract-evidence', capturedBy: 'codex', accessToken,
    });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Existing.md', content: '# Existing\n\nA related durable note.\n', expectedRevision: 'missing', accessToken,
    } });
    const published = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Contract.md', content: '# Contract\n\nA compact, linked knowledge note.\n', evidencePaths: [source.value.path],
      aliases: ['Knowledge contract', 'Metadata contract'], mocs: ['[[MOCs/Research]]', '[[MOCs/Operations]]'], summary: 'Properties describe the note and typed links describe why it is related.',
      keyPoints: ['Keep the full Markdown body.', 'Use typed links for meaningful relations.'], openQuestions: ['Which relation needs review next?'],
      relations: { related: ['[[Knowledge/Existing]]'] }, claims: [{ id: 'contract-claim', text: 'Typed links explain why notes are related.', status: 'supported', confidence: 'high', evidence_paths: [source.value.path], evidence: [{ path: source.value.path, heading: 'Evidence', blockId: 'contract-evidence', revision: source.value.revision }] }], stableId: 'knowledge-contract', lifecycle: 'evergreen', taskStatus: 'next_action', noteKind: 'question', epistemicStatus: 'open', reviewPolicy: 'periodic', evidence: [{ path: source.value.path, heading: 'Evidence', blockId: 'contract-evidence', revision: source.value.revision }], author: 'codex', expectedRevision: 'missing', accessToken,
    });
    expect(published.value.success).toBe(true);
    const projection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Contract.md', view: 'summary', accessToken });
    expect(projection.value).toMatchObject({ aliases: ['Knowledge contract', 'Metadata contract'], stableId: 'knowledge-contract', noteKind: 'question', taskStatus: 'next_action', reviewPolicy: 'periodic', summaryFresh: true, navigation: { mocs: ['[[MOCs/Research]]', '[[MOCs/Operations]]'] }, claims: [{ id: 'contract-claim', text: 'Typed links explain why notes are related.', status: 'supported', confidence: 'high', evidencePaths: [source.value.path], evidence: [{ path: source.value.path, heading: 'Evidence', blockId: 'contract-evidence', revision: source.value.revision }] }], relations: { related: ['[[Knowledge/Existing]]'] } });
    const progressive = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Contract.md', view: 'progressive', accessToken });
    expect(progressive.value.content).toContain('Evidence:');
    expect(progressive.value.content).toContain(source.value.path);
    expect(published.value.evidence[0]).toMatchObject({ path: source.value.path, heading: 'Evidence', blockId: 'contract-evidence', revision: source.value.revision });
    const refs = await callJson(client, 'read_references', { path: 'Knowledge/Contract.md', accessToken });
    expect(refs.value.references).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Existing.md' })]));
    const backlinks = await callJson(client, 'get_backlinks', { path: 'Knowledge/Existing.md', accessToken });
    expect(backlinks.value.backlinks).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Contract.md', relation: 'related' })]));
    const outlinks = await callJson(client, 'get_outlinks', { path: 'Knowledge/Contract.md', accessToken });
    expect(outlinks.value.outlinks).toEqual(expect.arrayContaining([expect.objectContaining({ relation: 'related' })]));
    expect(outlinks.value.outlinks.filter((entry: any) => entry.relation === 'related')).toHaveLength(1);
    const health = await callJson(client, 'get_wiki_organization_health', { limit: 20, accessToken });
    expect(health.value).toMatchObject({ healthy: true, organizationIssueTotal: 0 });
  } finally {
    await client.close();
    await server.close();
  }
});

test('questions, negative knowledge, locators, event review, MOC coverage, and Bases export stay connected', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'remaining-priorities-owner', modelId: 'codex', password: 'remaining-priorities-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', {
      sourceId: 'remaining-priorities-source', title: 'Remaining priorities source', content: '# Source\n\n## Result\n\nThe rejected approach failed under load. ^remaining-result', sourceType: 'paper', citationKey: 'remaining-priorities-2026', author: 'Research Group', publishedAt: '2026-01-01', retrievedAt: '2026-09-03', sourceFamily: 'remaining-priorities', sourceVersion: '2026-09-edition-1', capturedBy: 'codex', accessToken,
    });
    const sourceTrust = await callJson(client, 'get_wiki_source_trust', { accessToken });
    expect(sourceTrust.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ citationKey: 'remaining-priorities-2026', sourceType: 'paper', author: 'Research Group', publishedAt: '2026-01-01', retrievedAt: '2026-09-03', sourceFamily: 'remaining-priorities', sourceVersion: '2026-09-edition-1' })]));
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Related.md', content: '# Related\n\nThe linked context is stable.\n', expectedRevision: 'missing', accessToken,
    } });
    const negative = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Rejected approach.md', content: '# Rejected approach\n\nThis approach is retained as a counterexample. [[Knowledge/Related]]\n',
      evidence: [{ path: source.value.path, heading: 'Result', blockId: 'remaining-result', revision: source.value.revision, startLine: 5, endLine: 5, quoteHash: createHash('sha256').update('The rejected approach failed under load. ^remaining-result').digest('hex') }],
      noteKind: 'hypothesis', lifecycle: 'evergreen', polarity: 'negative', negativeType: 'counterexample', reviewPolicy: 'on_link_change',
      attempted: 'Run the approach under load.', observed: 'The operation failed under load.', failureCondition: 'Concurrent load exceeds the tested threshold.', reproduction: 'Run the documented load test.', reusableLesson: 'Keep a bounded fallback and test concurrency before adoption.', replacementPath: '[[Knowledge/Related]]', epistemicStatus: 'inconclusive',
      expectedRevision: 'missing', author: 'codex', accessToken,
    });
    expect(negative.value).toMatchObject({ success: true, evidence: [expect.objectContaining({ heading: 'Result', blockId: 'remaining-result', revision: source.value.revision, startLine: 5, endLine: 5 })] });

    const projection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Rejected approach.md', view: 'summary', accessToken });
    expect(projection.value).toMatchObject({ noteKind: 'hypothesis', epistemicStatus: 'inconclusive', polarity: 'negative', negativeType: 'counterexample', reusableLesson: 'Keep a bounded fallback and test concurrency before adoption.', reviewPolicy: 'on_link_change', evidence: [expect.objectContaining({ heading: 'Result', blockId: 'remaining-result', revision: source.value.revision, quoteHash: expect.any(String) })] });

    const mocWrite = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/MOCs/Research.md', content: '# Research MOC\n\n[[Knowledge/Rejected approach]]\n', frontmatter: { note_kind: 'moc', lifecycle: 'evergreen' }, expectedRevision: 'missing', accessToken,
    } });
    expect(mocWrite.isError).toBeFalsy();
    const childMocWrite = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/MOCs/Child.md', content: '# Child MOC\n\n[[Knowledge/Rejected approach]]\n', frontmatter: { note_kind: 'moc', lifecycle: 'evergreen' }, expectedRevision: 'missing', accessToken,
    } });
    expect(childMocWrite.isError).toBeFalsy();
    const parentMocWrite = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/MOCs/Parent.md', content: '# Parent MOC\n\n[Child map](Knowledge/MOCs/Child.md)\n', frontmatter: { note_kind: 'moc', lifecycle: 'evergreen' }, expectedRevision: 'missing', accessToken,
    } });
    expect(parentMocWrite.isError).toBeFalsy();
    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 10, maxChars: 5000, accessToken });
    expect(graph.value.mocCoverage).toMatchObject({ knowledgeTotal: 1, knowledgeLinkedFromMoc: 1, ratio: 1 });
    expect(graph.value.mocCoverage.mocs).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/MOCs/Parent.md', indirectKnowledge: 1, nestedMocs: 1 })]));

    const bases = await callJson(client, 'get_wiki_bases_view', { noteKind: 'hypothesis', lifecycle: 'evergreen', limit: 10, accessToken });
    expect(bases.value).toMatchObject({ format: 'obsidian-bases/yaml', suggestedPath: 'Views/LLM Wiki.base', matchingNotes: 1, truncated: false });
    expect(bases.value.content).toContain('type: table');
    expect(bases.value.content).toContain('note.note_kind == "hypothesis"');
    const home = await callJson(client, 'get_wiki_home', { limit: 10, accessToken });
    expect(home.value).toMatchObject({ suggestedHomePath: 'Home.md', suggestedIndexPath: 'JDex.md' });
    expect(home.value.mocs).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/MOCs/Research.md' })]));

    const related = await callJson(client, 'read_note', { path: 'Knowledge/Related.md', accessToken });
    const changed = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Related.md', content: '# Related\n\nThe linked context changed.\n', expectedRevision: related.value.revision, accessToken,
    } });
    if (changed.isError) throw new Error(JSON.stringify(changed));
    const impact = await callJson(client, 'get_wiki_impact_report', { limit: 10, maxChars: 6000, accessToken });
    expect(impact.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Rejected approach.md', reasons: expect.arrayContaining(['link_changed']), reviewTriggered: true, reviewTrigger: 'link_changed' })]));
    const queue = await callJson(client, 'get_wiki_review_queue', { limit: 10, maxChars: 6000, accessToken });
    expect(queue.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Rejected approach.md', reviewTrigger: 'link_changed' })]));

    await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Open question.md', content: '# Open question\n\nShould this result be reproduced independently?\n', evidencePaths: [source.value.path],
      noteKind: 'question', epistemicStatus: 'open', lifecycle: 'active', reviewPolicy: 'on_any_edit', desiredOutcome: 'Obtain one independent reproduction.', nextAction: 'Ask another agent to rerun the test.', taskContext: '@research', dueAt: '2030-01-01', reviewOutcome: 'confirmed', reviewedBy: 'codex', reviewedAt: '2030-01-01', reviewNote: 'The question remains open and evidence is intact.', expectedRevision: 'missing', author: 'codex', accessToken,
    });
    const questionProjection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Open question.md', accessToken });
    expect(questionProjection.value).toMatchObject({ epistemicStatus: 'open', desiredOutcome: 'Obtain one independent reproduction.', nextAction: 'Ask another agent to rerun the test.', taskContext: '@research', reviewOutcome: 'confirmed', reviewedBy: 'codex' });
    const question = await callJson(client, 'read_note', { path: 'Knowledge/Open question.md', accessToken });
    const editedQuestion = await client.callTool({ name: 'patch_note', arguments: {
      path: 'Knowledge/Open question.md', oldString: 'Should this result be reproduced independently?', newString: 'Should this result be reproduced independently by another agent?', expectedRevision: question.value.revision, accessToken,
    } });
    expect(editedQuestion.isError).toBeFalsy();
    const editedImpact = await callJson(client, 'get_wiki_impact_report', { limit: 10, maxChars: 8000, accessToken });
    expect(editedImpact.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Open question.md', reviewTrigger: 'note_edited' })]));

    const invalidLocator = await client.callTool({ name: 'publish_knowledge', arguments: {
      path: 'Knowledge/Invalid locator.md', content: '# Invalid locator\n\nA note with a bad locator.\n', evidence: [{ path: source.value.path, heading: 'Does not exist', revision: source.value.revision }],
      expectedRevision: 'missing', author: 'codex', accessToken,
    } });
    expect(invalidLocator.isError).toBe(true);
    expect((invalidLocator.content as any)[0].text).toContain('heading');
    const invalidQuote = await client.callTool({ name: 'publish_knowledge', arguments: {
      path: 'Knowledge/Invalid quote.md', content: '# Invalid quote\n\nA note with a bad quote.\n', evidence: [{ path: source.value.path, startLine: 5, endLine: 5, quoteHash: '0'.repeat(64), revision: source.value.revision }],
      expectedRevision: 'missing', author: 'codex', accessToken,
    } });
    expect(invalidQuote.isError).toBe(true);
    expect((invalidQuote.content as any)[0].text).toContain('quoteHash');
  } finally {
    await client.close();
    await server.close();
  }
});

test('capture, review completion, and bounded Reflect dashboard close the organization loop', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'reflect-owner', modelId: 'codex', password: 'reflect-owner-password' });
    const accessToken = registration.value.accessToken;
    const captured = await callJson(client, 'capture_wiki_note', { title: 'Unprocessed observation', content: 'A rough observation to classify later.', capturedBy: 'codex', accessToken });
    expect(captured.value).toMatchObject({ noteKind: 'fleeting', lifecycle: 'inbox', nextAction: 'Read the capture and classify it with triage_wiki_note.' });
    expect(captured.value.path).toMatch(/^Inbox\/capture-/);
    const inbox = await callJson(client, 'get_wiki_inbox', { accessToken });
    expect(inbox.value).toMatchObject({ total: 1, items: [expect.objectContaining({ path: captured.value.path, lifecycle: 'inbox' })] });

    const source = await callJson(client, 'ingest_source', { sourceId: 'reflect-source', title: 'Reflect source', content: 'The reviewable claim is grounded.', capturedBy: 'codex', accessToken });
    const published = await callJson(client, 'publish_knowledge', { path: 'Knowledge/Reviewable.md', content: '# Reviewable\n\nThe claim is grounded.\n', evidencePaths: [source.value.path], noteKind: 'atomic', lifecycle: 'review', reviewPolicy: 'manual', reviewAt: '2030-01-01', expectedRevision: 'missing', author: 'codex', accessToken });
    const reviewed = await callJson(client, 'review_wiki_note', { path: 'Knowledge/Reviewable.md', reviewOutcome: 'confirmed', reviewedBy: 'codex', reviewAt: '2031-01-01', nextLifecycle: 'evergreen', reviewNote: 'Evidence and body were checked.', expectedRevision: published.value.revision, accessToken });
    expect(reviewed.value).toMatchObject({ success: true, reviewOutcome: 'confirmed', reviewedBy: 'codex', reviewAt: '2031-01-01', nextLifecycle: 'evergreen' });
    const projection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Reviewable.md', accessToken });
    expect(projection.value).toMatchObject({ reviewOutcome: 'confirmed', reviewedBy: 'codex', reviewNote: 'Evidence and body were checked.' });

    await client.callTool({ name: 'write_note', arguments: { path: 'Projects/Unblocked later.md', content: '# Unblocked later\n', frontmatter: { note_kind: 'project', lifecycle: 'active', task_status: 'someday' }, expectedRevision: 'missing', accessToken } });
    await client.callTool({ name: 'write_note', arguments: { path: 'Projects/Needs action.md', content: '# Needs action\n', frontmatter: { note_kind: 'project', lifecycle: 'active' }, expectedRevision: 'missing', accessToken } });
    const dashboard = await callJson(client, 'get_wiki_review_dashboard', { limit: 10, maxChars: 9000, accessToken });
    expect(dashboard.value.sections).toMatchObject({ inbox: { total: 1 }, projectsAndTasks: { total: 1, items: [expect.objectContaining({ path: 'Projects/Needs action.md', missingNextAction: true })] }, knowledge: { total: 0 } });
  } finally {
    await client.close();
    await server.close();
  }
});

test('retention queue, claim review, contextual resurfacing, and term proposals stay bounded and revision-safe', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-batch-owner', modelId: 'codex', password: 'organization-batch-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', { sourceId: 'organization-batch-source', title: 'Organization batch source', content: '# Evidence\n\nThe approach is useful for debugging retrieval.\n', capturedBy: 'codex', accessToken });
    const published = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Batch.md', content: '# Batch\n\nThe approach is useful for debugging retrieval.\n', evidencePaths: [source.value.path],
      claims: [{ id: 'debugging-claim', text: 'The approach is useful for debugging retrieval.', evidencePaths: [source.value.path], status: 'supported', confidence: 'medium' }],
      retrievalCues: ['debugging retrieval', 'search results are stale'], useWhen: 'When investigating a broken or stale knowledge lookup.',
      retentionPolicy: 'review', retentionAt: '2020-01-01T00:00:00.000Z', retentionReason: 'Recheck after major search changes.',
      noteKind: 'atomic', lifecycle: 'evergreen', expectedRevision: 'missing', author: 'codex', accessToken,
    });

    const retention = await callJson(client, 'get_wiki_retention_queue', { accessToken, limit: 10, maxChars: 5000 });
    expect(retention.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Batch.md', reasons: expect.arrayContaining(['retention_review_due']), suggestedAction: 'choose_retention_policy_and_reason' })]));

    const resurfaced = await callJson(client, 'resurface_wiki_knowledge', { context: 'debugging retrieval', accessToken, limit: 20, maxChars: 6000 });
    expect(resurfaced.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Batch.md', reasons: expect.arrayContaining(['retrieval_cue_match']), contextMatch: expect.any(Number) })]));

    const reviewed = await callJson(client, 'review_wiki_claim', { path: 'Knowledge/Batch.md', claimId: 'debugging-claim', status: 'disputed', confidence: 'low', reviewedBy: 'codex', reviewNote: 'Needs an independent reproduction.', expectedRevision: published.value.revision, accessToken });
    expect(reviewed.value).toMatchObject({ success: true, claimId: 'debugging-claim', status: 'disputed', confidence: 'low' });
    const projection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Batch.md', accessToken });
    expect(projection.value.claims).toEqual([expect.objectContaining({ id: 'debugging-claim', status: 'disputed', confidence: 'low', review: expect.objectContaining({ reviewedBy: 'codex', note: 'Needs an independent reproduction.' }) })]);
    const body = await callJson(client, 'read_note', { path: 'Knowledge/Batch.md', accessToken });
    expect(body.value.content).toContain('The approach is useful for debugging retrieval.');

    const proposal = await callJson(client, 'propose_wiki_term_change', { currentTerm: 'debugging retrieval', proposedTerm: 'retrieval debugging', rationale: 'The preferred wording matches the surrounding authority vocabulary.', affectedPath: 'Knowledge/Batch.md', reportedBy: 'codex', accessToken });
    expect(proposal.value).toMatchObject({ success: true, path: expect.stringContaining('_wiki/issues/term-change-') });
    const proposalNote = await callJson(client, 'read_note', { path: proposal.value.path, accessToken });
    expect(proposalNote.value.fm).toMatchObject({ issue_kind: 'authority_change', proposal_status: 'proposed', current_term: 'debugging retrieval', proposed_term: 'retrieval debugging' });
  } finally {
    await client.close();
    await server.close();
  }
});

test('organization health exposes GTD focus, Zettelkasten connectivity, and progressive context', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-health-owner', modelId: 'codex', password: 'organization-health-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', { sourceId: 'organization-health-source', title: 'Organization health source', content: 'A stable source claim.', capturedBy: 'codex', accessToken });
    const progressive = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Progressive.md', content: '# Progressive\n\nA durable claim.\n', evidencePaths: [source.value.path], noteKind: 'atomic', lifecycle: 'evergreen',
      summary: 'A compact durable claim.', summaryLayer: 3, summaryHighlights: [{ text: 'A durable claim.', startLine: 3, endLine: 3 }], openQuestions: ['Does a second agent agree?'], expectedRevision: 'missing', author: 'codex', accessToken,
    });
    const progressiveRead = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Progressive.md', view: 'progressive', accessToken });
    expect(progressiveRead.value).toMatchObject({ view: 'progressive', summaryFresh: true, summaryStale: false });
    expect(progressiveRead.value.content).toContain('Selected passages:');
    expect(progressiveRead.value.content).toContain('Does a second agent agree?');
    const changed = await client.callTool({ name: 'patch_note', arguments: { path: 'Knowledge/Progressive.md', oldString: 'A durable claim.\n', newString: 'A changed durable claim.\n', replaceAll: true, expectedRevision: progressive.value.revision, accessToken } });
    expect(changed.isError).toBeFalsy();
    const staleRead = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Progressive.md', view: 'progressive', accessToken });
    expect(staleRead.value).toMatchObject({ summaryFresh: false, summaryStale: true });

    await client.callTool({ name: 'write_note', arguments: { path: 'Projects/Focus.md', content: '# Focus\n', frontmatter: { note_kind: 'project', lifecycle: 'active', focus_horizon: 'project', focus_parent: '[[Goals/Missing]]' }, expectedRevision: 'missing', accessToken } });
    await client.callTool({ name: 'write_note', arguments: { path: 'Goals/One.md', content: '# One\n', frontmatter: { note_kind: 'goal', lifecycle: 'active', focus_horizon: 'goal', focus_parent: '[[Goals/Two]]' }, expectedRevision: 'missing', accessToken } });
    await client.callTool({ name: 'write_note', arguments: { path: 'Goals/Two.md', content: '# Two\n', frontmatter: { note_kind: 'goal', lifecycle: 'active', focus_horizon: 'goal', focus_parent: '[[Goals/One]]' }, expectedRevision: 'missing', accessToken } });
    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 20, accessToken });
    expect(graph.value.focusHealth).toMatchObject({ unresolved: { total: 1 }, cycles: { total: 1 }, unparented: { total: 0 } });
    expect(graph.value.knowledgeConnectivity).toMatchObject({ total: 1, isolated: { total: 1 }, isolatedAtomic: { total: 1 } });
    const health = await callJson(client, 'get_wiki_organization_health', { limit: 20, accessToken });
    expect(health.value).toMatchObject({ advisoryIssueTotal: expect.any(Number), focusHealth: expect.objectContaining({ cycles: expect.objectContaining({ total: 1 }) }), knowledgeConnectivity: expect.objectContaining({ isolatedAtomic: expect.objectContaining({ total: 1 }) }) });

    await client.callTool({ name: 'write_note', arguments: { path: 'Projects/Waiting.md', content: '# Waiting\n', frontmatter: { note_kind: 'project', lifecycle: 'active', task_status: 'waiting', waiting_for: 'another agent' }, expectedRevision: 'missing', accessToken } });
    await client.callTool({ name: 'write_note', arguments: { path: 'Projects/Someday.md', content: '# Someday\n', frontmatter: { note_kind: 'project', lifecycle: 'active', task_status: 'someday' }, expectedRevision: 'missing', accessToken } });
    await client.callTool({ name: 'write_note', arguments: { path: 'Knowledge/Question.md', content: '# Question\n', frontmatter: { note_kind: 'question', lifecycle: 'review', epistemic_status: 'open' }, expectedRevision: 'missing', accessToken } });
    const dashboard = await callJson(client, 'get_wiki_review_dashboard', { limit: 20, accessToken });
    expect(dashboard.value.sections).toMatchObject({ waiting: { total: 1 }, someday: { total: 1 }, epistemic: { questions: { total: 1 } } });
  } finally {
    await client.close();
    await server.close();
  }
});

test('clarify, source distillation, and MOC candidates complete the organization loop', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-loop-owner', modelId: 'codex', password: 'organization-loop-password' });
    const accessToken = registration.value.accessToken;
    const captured = await callJson(client, 'capture_wiki_note', { path: 'Inbox/Clarify me.md', title: 'Clarify me', content: 'A rough project observation.', capturedBy: 'codex', accessToken });
    const clarified = await callJson(client, 'clarify_wiki_note', {
      path: captured.value.path, disposition: 'project', clarifyNote: 'This needs an explicit next action.', expectedRevision: captured.value.revision, accessToken,
    });
    expect(clarified.value).toMatchObject({ disposition: 'project', recommendedPath: 'Projects/', recommendedLifecycle: 'active', frontmatter: { noteKind: 'project', lifecycle: 'inbox', disposition: 'project' } });
    const inbox = await callJson(client, 'get_wiki_inbox', { accessToken });
    expect(inbox.value).toMatchObject({ total: 0, items: [] });

    const source = await callJson(client, 'ingest_source', { sourceId: 'distill-source', title: 'Distill source', content: '# Evidence\n\nA durable observation.', capturedBy: 'codex', accessToken });
    const distilled = await callJson(client, 'distill_wiki_source', {
      sourcePath: source.value.path, path: 'Resources/Distilled.md', title: 'Distilled literature', content: '# Distilled literature\n\nA source-backed interpretation.', noteKind: 'literature', expectedRevision: 'missing', author: 'codex', accessToken,
    });
    expect(distilled.value).toMatchObject({ success: true, noteKind: 'literature', distilledFrom: { path: source.value.path, revision: source.value.revision } });
    const projection = await callJson(client, 'read_wiki_projection', { path: 'Resources/Distilled.md', accessToken });
    expect(projection.value).toMatchObject({ noteKind: 'literature', evidence: [expect.objectContaining({ path: source.value.path, revision: source.value.revision })] });

    await callJson(client, 'publish_knowledge', { path: 'Knowledge/Alpha.md', content: '# Alpha\n\nA durable idea.', evidencePaths: [source.value.path], noteKind: 'atomic', lifecycle: 'evergreen', author: 'codex', expectedRevision: 'missing', accessToken });
    await callJson(client, 'publish_knowledge', { path: 'Knowledge/Beta.md', content: '# Beta\n\nAnother durable idea.', evidencePaths: [source.value.path], noteKind: 'atomic', lifecycle: 'evergreen', author: 'codex', expectedRevision: 'missing', accessToken });
    const candidates = await callJson(client, 'get_wiki_moc_candidates', { limit: 10, accessToken });
    expect(candidates.value).toMatchObject({ total: 2, candidates: expect.arrayContaining([expect.objectContaining({ suggestedPurpose: expect.any(String), suggestedQuestions: expect.any(Array), notePaths: expect.arrayContaining(['Knowledge/Alpha.md', 'Knowledge/Beta.md']) })]) });
  } finally {
    await client.close();
    await server.close();
  }
});

test('MOC question coverage, Evergreen quality, and review packet stay bounded and explicit', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'review-packet-owner', modelId: 'codex', password: 'review-packet-password' });
    const accessToken = registration.value.accessToken;
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Atomic concept.md', content: '# Atomic concept\n\nA reusable concept with a compact interpretation.\n',
      frontmatter: { note_kind: 'atomic', lifecycle: 'evergreen', summary: 'A reusable concept.' }, expectedRevision: 'missing', accessToken,
    } });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Untitled.md', content: '# Untitled\n\nA durable note that still needs organization.\n',
      frontmatter: { note_kind: 'atomic', lifecycle: 'evergreen' }, expectedRevision: 'missing', accessToken,
    } });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/MOCs/Research.md', content: '# Research\n\n## Questions\n\n- [ ] What is the reusable concept?\n  - [[Knowledge/Atomic concept]]\n- [ ] Which gap remains open?\n',
      frontmatter: { note_kind: 'moc', lifecycle: 'evergreen', moc_purpose: 'Navigate research questions', moc_questions: ['What is the reusable concept?', 'Which gap remains open?'] }, expectedRevision: 'missing', accessToken,
    } });

    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 20, maxChars: 9000, accessToken });
    expect(graph.value.mocQuestionCoverage).toMatchObject({ total: 2, linked: 1, ratio: 0.5, unlinked: { total: 1 } });
    expect(graph.value.mocQuestionCoverage.unlinked.items).toEqual(expect.arrayContaining([expect.objectContaining({ question: 'Which gap remains open?', state: 'unlinked' })]));
    expect(graph.value.mocCoverage.mocs).toEqual(expect.arrayContaining([expect.objectContaining({ questionTotal: 2, questionLinked: 1, questionCoverage: 0.5 })]));
    expect(graph.value.evergreenQuality).toMatchObject({ total: 2, needsAttention: 1, ready: 1 });
    expect(graph.value.evergreenQuality.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Untitled.md', state: 'needs_attention', flags: expect.arrayContaining(['missing_compact_projection', 'generic_concept_title']) })]));

    const packet = await callJson(client, 'get_wiki_review_packet', { limit: 5, maxChars: 7000, accessToken });
    expect(packet.value).toMatchObject({ counts: { unlinkedMocQuestions: 1, evergreenNeedsAttention: 1 } });
    expect(packet.value.priorities).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/MOCs/Research.md', reason: 'moc_question_has_no_linked_answer' })]));
    expect(JSON.stringify(packet.value).length).toBeLessThanOrEqual(7000);
  } finally {
    await client.close();
    await server.close();
  }
});

test('project packet exposes Natural Planning gaps and lint catches citation collisions', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'planning-owner', modelId: 'codex', password: 'planning-owner-password' });
    const accessToken = registration.value.accessToken;
    for (const [sourceId, title] of [['planning-source-one', 'Planning source one'], ['planning-source-two', 'Planning source two']]) {
      const result = await callJson(client, 'ingest_source', { sourceId, title, content: `# ${title}\n\nSource content.`, citationKey: 'duplicate-planning-key', capturedBy: 'codex', accessToken });
      expect(result.value.success).toBe(true);
    }
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Projects/Incomplete.md', content: '# Incomplete project\n\n## Brainstorm\n\n- Explore the first option.\n', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active', next_action: 'Inspect the first option.' }, expectedRevision: 'missing', accessToken,
    } });
    const packet = await callJson(client, 'get_wiki_project_packet', { accessToken, limit: 10 });
    expect(packet.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Projects/Incomplete.md', missing: expect.arrayContaining(['purpose', 'desired_outcome', 'project_support']) })]));
    const lint = await callJson(client, 'lint_wiki', { accessToken, limit: 50 });
    expect(lint.value.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'duplicate_citation_key' })]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('review records bounded history and split preview stays revision-safe', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'review-split-owner', modelId: 'codex', password: 'review-split-owner-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', { sourceId: 'review-split-source', title: 'Review split source', content: 'The source supports the note.', capturedBy: 'codex', accessToken });
    const published = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Review.md', content: '# Review\n\nGrounded body.', evidencePaths: [source.value.path],
      noteKind: 'knowledge', lifecycle: 'review', reviewPolicy: 'manual', author: 'codex', expectedRevision: 'missing', accessToken,
    });
    const reviewed = await callJson(client, 'review_wiki_note', {
      path: 'Knowledge/Review.md', reviewOutcome: 'confirmed', reviewReason: 'source_changed', nextLifecycle: 'evergreen',
      reviewedBy: 'codex', expectedRevision: published.value.revision, accessToken,
    });
    expect(reviewed.value).toMatchObject({ reviewCount: 1, reviewReopenCount: 0, reviewTrigger: 'source_changed' });

    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Broad.md', content: '# Broad\n\n## First idea\n\nOne claim.\n\n## Second idea\n\nAnother claim.\n',
      expectedRevision: 'missing', accessToken,
    } });
    const preview = await callJson(client, 'preview_wiki_split', { path: 'Knowledge/Broad.md', heading: 'First idea', targetPath: 'Knowledge/First idea.md', accessToken });
    expect(preview.value).toMatchObject({ mode: 'preview', sourcePath: 'Knowledge/Broad.md', heading: 'First idea', targetExists: false, collision: 'none' });
    expect(preview.value.content).toContain('One claim.');
    expect(preview.value.nextSteps).toEqual(expect.arrayContaining([expect.stringContaining('expectedRevision') ]));
    const broad = await callJson(client, 'read_note', { path: 'Knowledge/Broad.md', accessToken });
    expect(broad.value.content).toContain('Second idea');
  } finally {
    await client.close();
    await server.close();
  }
});

test('ingest, publish, catalog, lint, and immutable source enforcement form one workflow', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'wiki-owner', modelId: 'codex', password: 'wiki-owner-password' });
    const accessToken = registration.value.accessToken;
    const initialized = await callJson(client, 'initialize_llm_wiki', { actor: 'human', accessToken });
    expect(initialized.value).toMatchObject({ success: true, created: true, schemaPath: '_wiki/SCHEMA.md' });

    const ingested = await callJson(client, 'ingest_source', {
      sourceId: 'karpathy-idea', title: 'LLM Wiki idea', content: 'Persistent interlinked Markdown compounds knowledge.',
      sourceUrl: 'https://example.test/idea', capturedBy: 'human', accessToken,
    });
    expect(ingested.value).toMatchObject({ created: true, path: '_sources/karpathy-idea.md' });

    const duplicate = await callJson(client, 'ingest_source', {
      sourceId: 'karpathy-idea', title: 'LLM Wiki idea', content: 'Persistent interlinked Markdown compounds knowledge.', capturedBy: 'human', accessToken,
    });
    expect(duplicate.value.created).toBe(false);

    const published = await callJson(client, 'publish_knowledge', {
      path: 'Concepts/Compounding Wiki.md',
      content: '# Compounding Wiki\n\nA maintained wiki compounds prior synthesis.',
      evidencePaths: ['_sources/karpathy-idea.md'], author: 'codex', confidence: 'high', status: 'verified', expectedRevision: 'missing', accessToken,
    });
    expect(published.result.isError).toBeFalsy();

    const catalog = await callJson(client, 'get_wiki_catalog', {});
    expect(catalog.value.counts).toMatchObject({ schema: 1, source: 1, knowledge: 1 });
    const lint = await callJson(client, 'lint_wiki', {});
    expect(lint.value.errors).toBe(0);

    const orientation = await callJson(client, 'orient_wiki', {});
    expect(orientation.value.protocol).toBe('mcpvault-llm-wiki/v1');
    expect(orientation.value.mission).toContain('future agents');
    expect(orientation.value.firstSessionProtocol).toEqual(expect.arrayContaining([
      expect.stringContaining('first safe nextAction'),
      expect.stringContaining('peer correction'),
      expect.stringContaining('at most one focused capability search'),
      expect.stringContaining('reuse the result'),
    ]));
    expect(orientation.value.workflow).toContain('Use exact endpoint IDs in orient_wiki.nextActions directly with call_endpoint; search only for an action not already listed');
    expect(orientation.value.participation.invitation).toContain('equal participant');
    expect(orientation.value.visibleScopes).toEqual([
      { kind: 'community', uri: 'scope://community/local/' },
      { kind: 'global', uri: 'scope://global/' },
    ]);
    expect(orientation.value.nextActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: 'mcp.get_revision_status' }),
      expect.objectContaining({ tool: 'mcp.commit_changes' }),
    ]));

    const issue = await callJson(client, 'report_wiki_issue', {
      issueId: 'verify-claim', kind: 'unsupported_claim', title: 'Verify one claim', description: 'The claim needs a second source.', reportedBy: 'reviewer',
      subjectPath: 'Concepts/Compounding Wiki.md', evidencePaths: ['_sources/karpathy-idea.md'], accessToken,
    });
    const resolved = await callJson(client, 'resolve_wiki_issue', {
      path: issue.value.path, actor: 'reviewer', resolution: 'The claim was narrowed to match the source.', expectedRevision: issue.value.revision, accessToken,
    });
    expect(resolved.value.status).toBe('resolved');

    for (const mutation of [
      { name: 'write_note', arguments: { path: '_sources/karpathy-idea.md', content: 'tampered', accessToken } },
      { name: 'patch_note', arguments: { path: '_sources/karpathy-idea.md', oldString: 'Persistent', newString: 'Ephemeral', accessToken } },
      { name: 'delete_note', arguments: { path: '_sources/karpathy-idea.md', confirmPath: '_sources/karpathy-idea.md', accessToken } },
      { name: 'move_note', arguments: { oldPath: '_sources/karpathy-idea.md', newPath: 'moved.md', accessToken } },
    ]) {
      const blocked = await client.callTool(mutation);
      expect(blocked.isError, mutation.name).toBe(true);
      expect((blocked.content as any)[0].text).toContain('immutable LLM Wiki sources');
    }

    const rawPath = join(vault, '_sources', 'karpathy-idea.md');
    await writeFile(rawPath, (await readFile(rawPath, 'utf8')).replace('Persistent', 'Tampered'), 'utf8');
    const damaged = await callJson(client, 'lint_wiki', {});
    expect(damaged.value.issues).toContainEqual(expect.objectContaining({ code: 'source_hash_mismatch' }));
  } finally {
    await client.close();
    await server.close();
  }
});

test('organization metadata, catalog facets, review queue, and lint warnings stay bounded and discoverable', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-owner', modelId: 'codex', password: 'organization-owner-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', {
      sourceId: 'organization-source', title: 'Organization source', content: 'PARA and linked notes help agents find durable knowledge.', capturedBy: 'codex', accessToken,
    });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Projects/MCPVault.md', content: '# MCPVault project\n', expectedRevision: 'missing', accessToken,
    } });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/MOCs/LLM Wiki.md', content: '# LLM Wiki MOC\n\n[[Projects/MCPVault]]\n', expectedRevision: 'missing', accessToken,
    } });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Inbox/Rough capture.md', content: '# Rough capture\n\nSort this later.\n', frontmatter: { captured_at: '2000-01-01T00:00:00.000Z', updated_at: '2000-01-01T00:00:00.000Z' }, expectedRevision: 'missing', accessToken,
    } });
    const inbox = await callJson(client, 'get_wiki_inbox', { limit: 2, maxChars: 1600, accessToken });
    expect(inbox.value).toMatchObject({ total: 1, ageBands: { stale: 1 }, oldestAgeDays: expect.any(Number), items: [expect.objectContaining({ path: 'Inbox/Rough capture.md', agingBand: 'stale', suggestedAction: 'clarify_or_archive_this_old_capture' })] });
    const rough = await callJson(client, 'read_note', { path: 'Inbox/Rough capture.md', accessToken });
    const triaged = await callJson(client, 'triage_wiki_note', {
      path: 'Inbox/Rough capture.md', noteKind: 'literature', lifecycle: 'active', project: '[[Projects/MCPVault]]',
      expectedRevision: rough.value.revision, accessToken,
    });
    expect(triaged.value).toMatchObject({ success: true, frontmatter: { noteKind: 'literature', lifecycle: 'active' } });
    const inboxAfterTriage = await callJson(client, 'get_wiki_inbox', { limit: 2, maxChars: 1600, accessToken });
    expect(inboxAfterTriage.value).toMatchObject({ total: 0, items: [] });
    const stalledWrite = await client.callTool({ name: 'write_note', arguments: {
      path: 'Projects/Stalled.md', content: '# Stalled\n', frontmatter: { note_kind: 'project', lifecycle: 'active' }, expectedRevision: 'missing', accessToken,
    } });
    expect(stalledWrite.isError).toBeFalsy();
    await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Atomic/Organization.md',
      content: '# Organization\n\n[[Projects/MCPVault]] is the active implementation project.',
      evidencePaths: [source.value.path], references: ['[[Projects/MCPVault]]'], author: 'codex',
      status: 'disputed', confidence: 'medium', noteKind: 'atomic', lifecycle: 'review',
      moc: '[[Knowledge/MOCs/LLM Wiki]]', project: '[[Projects/MCPVault]]', reviewAt: '2000-01-01',
      expectedRevision: 'missing', accessToken,
    });

    const catalog = await callJson(client, 'get_wiki_catalog', { noteKind: 'atomic', lifecycle: 'review', accessToken });
    expect(catalog.value).toMatchObject({ total: 1, organization: { noteKinds: { atomic: 1 }, lifecycles: { review: 1 } } });
    expect(catalog.value.entries[0]).toMatchObject({ noteKind: 'atomic', lifecycle: 'review', project: '[[Projects/MCPVault]]' });

    const queue = await callJson(client, 'get_wiki_review_queue', { limit: 1, maxChars: 1200, accessToken });
    expect(queue.value).toMatchObject({ total: 1, truncated: false, items: [expect.objectContaining({ noteKind: 'atomic', lifecycle: 'review', overdue: true })] });
    const organizationNote = await callJson(client, 'read_note', { path: 'Knowledge/Atomic/Organization.md', accessToken });
    const snoozed = await callJson(client, 'triage_wiki_note', {
      path: 'Knowledge/Atomic/Organization.md', reviewSnoozedUntil: '2099-01-01', reviewSnoozeReason: 'Waiting for the next source edition.',
      expectedRevision: organizationNote.value.revision, accessToken,
    });
    const snoozedRead = await callJson(client, 'read_note', { path: 'Knowledge/Atomic/Organization.md', accessToken });
    expect(snoozedRead.value.fm.review_snoozed_until).toBe('2099-01-01');
    const snoozedQueue = await callJson(client, 'get_wiki_review_queue', { limit: 1, maxChars: 1200, accessToken });
    expect(snoozedQueue.value.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Atomic/Organization.md' })]));

    const lint = await callJson(client, 'lint_wiki', { accessToken });
    expect(lint.value.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'knowledge_review_due' }),
      expect.objectContaining({ code: 'active_project_without_next_action', path: 'Projects/Stalled.md' }),
    ]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('knowledge-related commits are blocked by Wiki errors while ordinary notes remain normal Git changes', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'commit-owner', modelId: 'codex', password: 'commit-owner-password' });
    const accessToken = registration.value.accessToken;
    const initialized = await client.callTool({ name: 'initialize_revision_history', arguments: { confirm: true, accessToken } });
    expect(initialized.isError).toBeFalsy();
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Ordinary.md', content: '# Ordinary note\n', expectedRevision: 'missing', accessToken,
    } });
    const ordinaryCommit = await callJson(client, 'commit_changes', { reason: 'Add an ordinary note', accessToken });
    expect(ordinaryCommit.value.success).toBe(true);

    await client.callTool({ name: 'write_note', arguments: {
      path: 'Broken knowledge.md', content: '# Unsupported\n', frontmatter: { llm_wiki_type: 'knowledge' }, expectedRevision: 'missing', accessToken,
    } });
    const blocked = await client.callTool({ name: 'commit_changes', arguments: { reason: 'Attempt to save unsupported knowledge', accessToken } });
    expect(blocked.isError).toBe(true);
    expect((blocked.content as any)[0].text).toContain('Wiki validation blocked commit');
    expect((blocked.content as any)[0].text).toContain('knowledge_without_evidence');
  } finally {
    await client.close();
    await server.close();
  }
});

test('private source and knowledge workflows are visible only to their logged-in owner', async () => {
  const { server, client } = await setup();
  try {
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'alpha-owner', modelId: 'alpha', password: 'alpha-private-password' } });
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'beta-owner', modelId: 'beta', password: 'beta-private-password' } });
    const alphaToken = (await callJson(client, 'login_scope', { accountId: 'alpha-owner', password: 'alpha-private-password' })).value.accessToken;
    const betaToken = (await callJson(client, 'login_scope', { accountId: 'beta-owner', password: 'beta-private-password' })).value.accessToken;

    const source = await callJson(client, 'ingest_source', {
      scopeUri: 'scope://model/alpha/', sourceId: 'private-source', title: 'Private', content: 'alpha-only evidence', accessToken: alphaToken,
    });
    expect(source.value.path).toBe('scope://model/alpha/_sources/private-source.md');
    const unsafePublicPublish = await client.callTool({ name: 'publish_knowledge', arguments: {
      path: 'Public Leak.md', content: 'would expose private provenance',
      evidencePaths: ['scope://model/alpha/_sources/private-source.md'], expectedRevision: 'missing', accessToken: alphaToken,
    } });
    expect(unsafePublicPublish.isError).toBe(true);
    expect((unsafePublicPublish.content as any)[0].text).toContain('more-private source');
    await client.callTool({ name: 'publish_knowledge', arguments: {
      path: 'scope://model/alpha/Private Knowledge.md', content: 'alpha-only conclusion',
      evidencePaths: ['scope://model/alpha/_sources/private-source.md'], expectedRevision: 'missing', accessToken: alphaToken,
    } });

    const betaSearch = await callJson(client, 'search_notes', { query: 'alpha-only', accessToken: betaToken });
    expect(betaSearch.value).toEqual([]);
    const anonymousCatalog = await callJson(client, 'get_wiki_catalog', {});
    expect(anonymousCatalog.value.total).toBe(0);
    const betaRead = await client.callTool({ name: 'read_note', arguments: { path: 'scope://model/alpha/Private Knowledge.md', accessToken: betaToken } });
    expect(betaRead.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('claim provenance, progressive projections, duplicate preflight, impact, and graph health stay bounded', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'quality-owner', modelId: 'codex', password: 'quality-owner-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', {
      sourceId: 'quality-source', title: 'Quality source', content: 'A durable wiki should preserve evidence, revisions, and links.', capturedBy: 'codex', accessToken,
    });
    const published = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Quality.md', title: 'Quality', content: '# Quality\n\nA durable wiki preserves evidence, revisions, and links.\n\n## Details\n\nThe details remain inspectable.\n',
      evidencePaths: [source.value.path], claims: [{ id: 'durability', text: 'A durable wiki preserves evidence.', evidencePaths: [source.value.path], confidence: 'high', status: 'supported' }],
      author: 'codex', status: 'verified', confidence: 'high', expectedRevision: 'missing', accessToken,
    });
    expect(published.value.claims).toEqual([expect.objectContaining({ id: 'durability', status: 'supported' })]);

    const summary = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Quality.md', view: 'summary', maxChars: 1200, accessToken });
    expect(summary.value).toMatchObject({ view: 'summary', path: 'Knowledge/Quality.md', content: expect.stringContaining('A durable wiki preserves evidence') });
    const outline = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Quality.md', view: 'outline', accessToken });
    expect(outline.value.content).toContain('Details');
    const section = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Quality.md', view: 'section', section: 'Details', accessToken });
    expect(section.value.content).toContain('details remain inspectable');

    const preflight = await callJson(client, 'preflight_wiki_publish', {
      path: 'Knowledge/Quality-copy.md', title: 'Quality copy', content: 'A durable wiki preserves evidence, revisions, and links.', accessToken,
    });
    expect(preflight.value.candidates[0]).toMatchObject({ path: 'Knowledge/Quality.md', relation: 'possible_duplicate' });

    await writeFile(join(vault, '_sources', 'quality-source.md'), (await readFile(join(vault, '_sources', 'quality-source.md'), 'utf8')).replace('A durable wiki should preserve', 'A changed source should preserve'), 'utf8');
    const impact = await callJson(client, 'get_wiki_impact_report', { limit: 5, maxChars: 2500, accessToken });
    expect(impact.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Quality.md', reasons: expect.arrayContaining(['source_changed']) })]));
    const lint = await callJson(client, 'lint_wiki', { accessToken });
    expect(lint.value.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid_claim_evidence', path: 'Knowledge/Quality.md' })]));

    await client.callTool({ name: 'write_note', arguments: { path: 'Knowledge/Empty MOC.md', content: '# Empty MOC\n', frontmatter: { note_kind: 'moc' }, expectedRevision: 'missing', accessToken } });
    await client.callTool({ name: 'write_note', arguments: { path: 'Knowledge/Broken.md', content: '# Broken\n\n[[Missing target]]\n', expectedRevision: 'missing', accessToken } });
    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 10, maxChars: 4000, accessToken });
    expect(graph.value.emptyMocs.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Empty MOC.md' })]));
    expect(graph.value.unresolvedLinks.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Broken.md' })]));

    const trustedSource = await callJson(client, 'ingest_source', {
      sourceId: 'decision-source', title: 'Decision evidence', content: 'Use bounded reads and preserve Git history.', capturedBy: 'codex', trustLevel: 'high', trustReason: 'Primary project design record.', accessToken,
    });
    const decision = await callJson(client, 'publish_decision_record', {
      path: 'Knowledge/Decisions/Read-policy.md', title: 'Bounded read policy', context: 'Agents have limited context and concurrent edits.', decision: 'Use progressive reads with revision checks.', alternatives: ['Load every document in full.'], consequences: ['Callers must request a larger view when needed.'], status: 'accepted', evidencePaths: [trustedSource.value.path], author: 'codex', expectedRevision: 'missing', accessToken,
    });
    expect(decision.value).toMatchObject({ created: true, path: 'Knowledge/Decisions/Read-policy.md' });
    const trust = await callJson(client, 'get_wiki_source_trust', { accessToken });
    expect(trust.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: trustedSource.value.path, trustLevel: 'high', integrity: 'intact', usedByKnowledgeNotes: 1 })]));

    await callJson(client, 'publish_blog_post', { slug: 'promotable-research', title: 'A useful research result', content: 'This community result should become durable knowledge.', category: 'research', references: [trustedSource.value.path], expectedRevision: 'missing', accessToken });
    const promotion = await callJson(client, 'get_wiki_promotion_candidates', { accessToken });
    expect(promotion.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ slug: 'promotable-research', suggestedPath: 'Knowledge/Community/promotable-research.md' })]));

    await callJson(client, 'publish_knowledge', { path: 'Knowledge/Long.md', content: `# Long\n\n${'A durable paragraph without a stored summary. '.repeat(60)}`, evidencePaths: [trustedSource.value.path], author: 'codex', expectedRevision: 'missing', accessToken });
    const summaries = await callJson(client, 'get_wiki_summary_candidates', { accessToken });
    expect(summaries.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Long.md', reason: 'missing_summary' })]));

    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Stale.md', content: '# Stale\n\nThe body was edited after the compact projection.\n',
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', summary: 'An old projection.', summary_of_content_sha256: '0000000000000000000000000000000000000000000000000000000000000000' },
      expectedRevision: 'missing', accessToken,
    } });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Alias-owner.md', content: '# Alias owner\n',
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', aliases: ['Shared concept'], stable_id: 'shared-concept' },
      expectedRevision: 'missing', accessToken,
    } });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Alias-collision.md', content: '# Alias collision\n',
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', aliases: ['Shared concept'], stable_id: 'shared-concept' },
      expectedRevision: 'missing', accessToken,
    } });
    const organizationHealth = await callJson(client, 'get_wiki_organization_health', { limit: 20, maxChars: 5000, accessToken });
    expect(organizationHealth.value.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'stale_summary', path: 'Knowledge/Stale.md' }),
      expect.objectContaining({ code: 'duplicate_alias_across_notes' }),
      expect.objectContaining({ code: 'duplicate_stable_id' }),
    ]));
    const staleSummaries = await callJson(client, 'get_wiki_summary_candidates', { accessToken });
    expect(staleSummaries.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Stale.md', reason: 'stale_summary', summaryFresh: false })]));

    await client.callTool({ name: 'write_note', arguments: { path: 'Knowledge/Old.md', content: '# Old\n\nOld knowledge.', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', updated_at: '2020-01-01T00:00:00.000Z', created_at: '2020-01-01T00:00:00.000Z' }, expectedRevision: 'missing', accessToken } });
    const unused = await callJson(client, 'get_wiki_unused_knowledge', { olderThanDays: 30, accessToken });
    expect(unused.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Old.md', suggestedAction: 'review_then_archive_or_supersede' })]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('next actions and knowledge rediscovery stay bounded while graph health checks epistemic flow', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-signals-owner', modelId: 'codex', password: 'organization-signals-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    const dynamic = (endpointId: string, arguments_: Record<string, unknown>) => callJson(client, 'call_endpoint', { endpointId, arguments: arguments_ });

    await write('Projects/Research.md', '# Research project\n\n## Support\n\n[[Knowledge/Atomic idea]]\n', {
      llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active', task_status: 'next_action',
      next_action: 'Inspect the source implementation', task_context: '@computer', due_at: '2030-01-01T00:00:00.000Z', time_estimate_minutes: 30, energy: 'high', effort: 'high',
    });
    await write('Tasks/Read.md', '# Read task\n', {
      llm_wiki_type: 'knowledge', note_kind: 'task', lifecycle: 'active', task_status: 'next_action',
      next_actions: ['Read the primary paper', 'Extract one claim'], task_context: '@research', time_estimate_minutes: 10, energy: 'low', effort: 'medium',
    });
    await write('Knowledge/Atomic idea.md', '# Atomic idea\n\nA reusable idea.\n', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', summary: 'A reusable idea.',
    });
    await write('Knowledge/Open question.md', '# Open question\n', {
      llm_wiki_type: 'knowledge', note_kind: 'question', lifecycle: 'review', epistemic_status: 'answered',
    });
    await write('Knowledge/Unsupported hypothesis.md', '# Unsupported hypothesis\n', {
      llm_wiki_type: 'knowledge', note_kind: 'hypothesis', lifecycle: 'review', epistemic_status: 'supported',
    });
    await write('Knowledge/Captured literature.md', '# Captured literature\n', {
      llm_wiki_type: 'knowledge', note_kind: 'literature', lifecycle: 'active', interpretation_status: 'unprocessed',
    });
    await write('Knowledge/Un grounded synthesis.md', '# Un grounded synthesis\n', {
      llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', interpretation_status: 'synthesized',
    });
    await write('Knowledge/Typed gap.md', '# Typed gap\n', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', supports: ['[[Knowledge/Does not exist]]'],
    });

    const computer = await dynamic('wiki.next_actions', { context: '@computer', limit: 10, maxChars: 3000, accessToken });
    expect(computer.value).toMatchObject({ context: '@computer', total: 1, items: [expect.objectContaining({ path: 'Projects/Research.md', context: '@computer', action: 'Inspect the source implementation' })] });
    expect(computer.value.items[0]).not.toHaveProperty('projectSupport');
    const lowEnergy = await dynamic('wiki.next_actions', { maxMinutes: 15, energy: 'low', accessToken });
    expect(lowEnergy.value).toMatchObject({ selection: { maxMinutes: 15, energy: 'low' }, total: 2 });
    expect(lowEnergy.value.items.every((item: any) => item.path === 'Tasks/Read.md')).toBe(true);
    const allActions = await dynamic('wiki.next_actions', { limit: 2, maxChars: 1200, accessToken });
    expect(allActions.value).toMatchObject({ total: 3, truncated: true });
    expect(allActions.value.items.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(allActions.value).length).toBeLessThanOrEqual(1200);

    const resurfaced = await dynamic('wiki.resurface', { limit: 3, maxChars: 1800, accessToken });
    expect(resurfaced.value).toMatchObject({ total: 8, rotationDate: expect.any(String) });
    expect(resurfaced.value.items.length).toBeLessThanOrEqual(3);
    for (const item of resurfaced.value.items) {
      expect(item).toMatchObject({ path: expect.stringMatching(/^(?:Knowledge|Projects|Tasks)\//), reasons: expect.any(Array) });
    }
    expect(JSON.stringify(resurfaced.value).length).toBeLessThanOrEqual(1800);

    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 20, maxChars: 5000, accessToken });
    expect(graph.value.epistemicConsistency.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Open question.md', reasons: expect.arrayContaining(['answered_without_answer_relation']) }),
      expect.objectContaining({ path: 'Knowledge/Unsupported hypothesis.md', reasons: expect.arrayContaining(['resolved_hypothesis_without_evidence']) }),
    ]));
    expect(graph.value.knowledgeFlow).toMatchObject({ stages: { unprocessed: 1, synthesized: 1 }, literatureWithoutSource: { total: 1 }, synthesisWithoutInputs: { total: 1 } });
    expect(graph.value.typedRelations.unresolved.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Typed gap.md', relation: 'supports' })]));
    const contract = await callJson(client, 'get_wiki_property_contract', { accessToken });
    expect(contract.value.relations).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'supports', direction: 'directional' })]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('composition candidates, projection-only updates, and waiting follow-up signals stay bounded and revision-safe', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-maintenance-owner', modelId: 'codex', password: 'organization-maintenance-password' });
    const accessToken = registration.value.accessToken;
    const body = [
      '# Broad note',
      '',
      '## First section',
      '',
      'This paragraph combines several reusable claims. It links to [[Knowledge/Atomic idea]] and [[Knowledge/Supporting idea]]. It should be reviewed as a possible multi-claim block.',
      '',
      ...Array.from({ length: 5 }, (_, index) => [`First reusable observation ${index + 1}.`, '']).flat(),
      '',
      '## Second section',
      '',
      ...Array.from({ length: 5 }, (_, index) => [`Second reusable observation ${index + 1}.`, '']).flat(),
      '',
      '## Third section',
      '',
      ...Array.from({ length: 5 }, (_, index) => [`Third reusable observation ${index + 1}.`, '']).flat(),
    ].join('\n');
    const written = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Broad composition.md',
      content: body,
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', stable_id: 'broad-composition' },
      expectedRevision: 'missing', accessToken,
    } });
    expect(written.isError).toBeFalsy();

    const dynamic = (endpointId: string, arguments_: Record<string, unknown>) => callJson(client, 'call_endpoint', { endpointId, arguments: arguments_ });
    const candidates = await dynamic('wiki.composition_candidates', { limit: 5, maxChars: 3000, accessToken });
    expect(candidates.value).toMatchObject({ total: 1, items: [expect.objectContaining({ path: 'Knowledge/Broad composition.md', suggestedTool: 'wiki.split_preview' })] });
    expect(candidates.value.items[0].signals).toEqual(expect.arrayContaining(['many_sections', 'many_paragraphs', 'multi_claim_paragraphs']));
    expect(candidates.value.items[0].paragraphCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ startLine: expect.any(Number), endLine: expect.any(Number), sentenceCount: 3, linkCount: 2 }),
    ]));
    expect(JSON.stringify(candidates.value).length).toBeLessThanOrEqual(3000);

    const before = await callJson(client, 'read_note', { path: 'Knowledge/Broad composition.md', accessToken });
    const projection = await dynamic('wiki.projection_update', {
      path: 'Knowledge/Broad composition.md',
      summary: 'A broad note with three reusable sections.',
      keyPoints: ['Three sections are candidates for reuse.'],
      summaryLayer: 2,
      expectedRevision: before.value.revision,
      accessToken,
    });
    expect(projection.value).toMatchObject({ projection: { summaryLayer: 2, summaryFresh: true, bodyChanged: false } });
    const after = await callJson(client, 'read_note', { path: 'Knowledge/Broad composition.md', accessToken });
    expect(after.value.content).toBe(before.value.content);
    expect(after.value.fm.stable_id).toBe('broad-composition');

    await mkdir(join(vault, 'Projects'), { recursive: true });
    await writeFile(join(vault, 'Projects', 'Waiting.md'), [
      '---',
      'llm_wiki_type: knowledge',
      'note_kind: project',
      'lifecycle: active',
      'task_status: waiting',
      'waiting_for: an external review',
      'waiting_since: 2020-01-01T00:00:00.000Z',
      '---',
      '# Waiting project',
      '',
      'A project awaiting a response.',
      '',
    ].join('\n'));
    const dashboard = await callJson(client, 'get_wiki_review_dashboard', { limit: 20, accessToken });
    expect(dashboard.value.sections.waiting.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Projects/Waiting.md', waitingAgeDays: expect.any(Number), followUpNeeded: true, followUpReason: 'waiting_14_days_or_more' }),
    ]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('Property contract is discoverable and review cadence schedules the next review', async () => {
  const { server, client } = await setup();
  try {
    const contract = await callJson(client, 'get_wiki_property_contract', { maxChars: 12000 });
    expect(contract.value.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'note_kind', type: 'text' }),
      expect.objectContaining({ name: 'review_interval_days', type: 'number' }),
    ]));

    const registration = await callJson(client, 'register_scope_account', { accountId: 'cadence-owner', modelId: 'codex', password: 'cadence-owner-password' });
    const accessToken = registration.value.accessToken;
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Cadence.md', content: '# Cadence\n\nA note with a declared review cadence.\n',
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', review_interval_days: 7 }, expectedRevision: 'missing', accessToken,
    } });
    const before = await callJson(client, 'read_note', { path: 'Knowledge/Cadence.md', includeContent: false, accessToken });
    const reviewed = await callJson(client, 'review_wiki_note', { path: 'Knowledge/Cadence.md', reviewOutcome: 'confirmed', expectedRevision: before.value.revision, accessToken });
    expect(reviewed.value).toMatchObject({ reviewOutcome: 'confirmed', reviewIntervalDays: 7, reviewAt: expect.any(String) });
    const reviewedAt = Date.parse(reviewed.value.reviewedAt);
    const nextReviewAt = Date.parse(reviewed.value.reviewAt);
    expect(nextReviewAt - reviewedAt).toBe(7 * 24 * 60 * 60 * 1000);
  } finally {
    await client.close();
    await server.close();
  }
});

test('authority, maintenance debt, answer packets, and adaptive review stay bounded', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-views-owner', modelId: 'codex', password: 'organization-views-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Knowledge/Anchor.md', '# Anchor\n\nThe anchor claim. [[Knowledge/Support]] and [[Knowledge/Counter]].\n', {
      title: 'Anchor concept', llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', aliases: ['Shared anchor'], preferred_term: 'Anchor concept (canonical)', disambiguation: 'The central organization example', stable_id: 'anchor-concept', review_policy: 'periodic', subject_terms: ['knowledge organization', 'retrieval'], domain: 'information management', methods: ['Zettelkasten'], audience: ['agents'],
    });
    await write('Knowledge/Support.md', '# Support\n\nSupporting context.\n', {
      title: 'Supporting context', llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', aliases: ['Anchor support'], stable_id: 'anchor-support',
    });
    await write('Knowledge/Counter.md', '# Counter\n\nA failed counterexample worth checking.\n', {
      title: 'Counterexample', llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'review', knowledge_status: 'disputed', knowledge_polarity: 'negative', negative_type: 'counterexample', negative_reusable_lesson: 'Check the boundary conditions before reusing the claim.',
    });
    await write('Knowledge/Alias-two.md', '# Alias two\n', {
      title: 'Another concept', llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', aliases: ['Shared anchor'], stable_id: 'another-concept',
    });
    await write('Inbox/Rough.md', '# Rough\n\nUnsorted capture.\n', { note_kind: 'fleeting', lifecycle: 'inbox' });
    await write('Knowledge/Stale.md', '# Stale\n\nBody changed after summary.\n', {
      title: 'Stale projection', llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', summary: 'Old summary', summary_of_content_sha256: '0000000000000000000000000000000000000000000000000000000000000000', updated_at: '2020-01-01T00:00:00.000Z', created_at: '2020-01-01T00:00:00.000Z',
    });
    await write('Knowledge/Legacy-anchor.md', '# Legacy anchor\n\nUse the preferred anchor term instead.\n', {
      title: 'Legacy anchor', llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', term_status: 'deprecated', term_replaced_by: '[[Knowledge/Anchor]]', broader_terms: ['[[Knowledge/Core]]'], related_terms: ['[[Knowledge/Support]]'],
    });
    await write('Knowledge/Project misplaced.md', '# Project misplaced\n\nThis belongs with active work.\n', {
      title: 'Project misplaced', llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active',
    });
    await write('Knowledge/Open question.md', '# Open question\n\nWhich retrieval projection is most useful?\n', {
      title: 'Open retrieval question', llm_wiki_type: 'knowledge', note_kind: 'question', lifecycle: 'active', epistemic_status: 'open', subject_terms: ['retrieval'], domain: 'information management',
    });

    const authority = await callJson(client, 'get_wiki_authority_map', { query: 'shared anchor', accessToken });
    expect(authority.value.entries).toEqual(expect.arrayContaining([expect.objectContaining({ term: 'Shared anchor', collision: 'term_used_by_multiple_notes', address: expect.any(String), stableIds: expect.arrayContaining(['anchor-concept', 'another-concept']) })]));
    const preferredAuthority = await callJson(client, 'get_wiki_authority_map', { query: 'canonical', accessToken });
    expect(preferredAuthority.value.entries).toEqual(expect.arrayContaining([expect.objectContaining({ term: 'Anchor concept (canonical)', preferred: 'Anchor concept (canonical)', disambiguation: ['The central organization example'] })]));
    const legacyAuthority = await callJson(client, 'get_wiki_authority_map', { query: 'legacy anchor', accessToken });
    expect(legacyAuthority.value.entries).toEqual(expect.arrayContaining([expect.objectContaining({ term: 'Legacy anchor', status: 'deprecated', replacedBy: ['[[Knowledge/Anchor]]'], broaderTerms: ['[[Knowledge/Core]]'] })]));

    const catalog = await callJson(client, 'get_wiki_catalog', { orderBy: 'alphabet', limit: 10, accessToken });
    expect(catalog.value).toMatchObject({ orderBy: 'alphabet' });
    expect(catalog.value.entries[0].title).toBe('Anchor concept');
    const facetedCatalog = await callJson(client, 'get_wiki_catalog', { includeFacets: true, limit: 10, accessToken });
    expect(facetedCatalog.value.facets).toMatchObject({ domain: { 'information management': expect.any(Number) }, subjectTerm: { retrieval: expect.any(Number) }, method: { Zettelkasten: expect.any(Number) }, audience: { agents: expect.any(Number) } });

    const debt = await callJson(client, 'get_wiki_maintenance_debt', { olderThanDays: 30, limit: 20, accessToken });
    expect(debt.value.counts).toMatchObject({ inbox_capture: 1, stale_summary: 1 });
    expect(debt.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Inbox/Rough.md' }), expect.objectContaining({ path: 'Knowledge/Stale.md', priority: 'high' })]));

    const packet = await callJson(client, 'get_wiki_answer_packet', { path: 'Knowledge/Anchor.md', intent: 'decide', includeSemantic: false, maxChars: 5000, accessToken });
    expect(packet.value).toMatchObject({ mode: 'bounded_answer_packet', intent: 'decide', source: expect.objectContaining({ path: 'Knowledge/Anchor.md' }), reasoningTrail: expect.objectContaining({ claims: expect.any(Array), evidence: expect.any(Array), counterexamples: expect.any(Array), gaps: expect.any(Array) }) });
    expect(JSON.stringify(packet.value).length).toBeLessThanOrEqual(5000);
    expect(packet.value.supporting).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Support.md', relationToSource: 'supporting_context' })]));
    expect(packet.value.counterpoints).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Counter.md', relationToSource: 'counterpoint_or_review' })]));
    const neighborhood = await callJson(client, 'get_wiki_neighborhood', { path: 'Knowledge/Anchor.md', includeSemantic: false, maxChars: 4000, accessToken });
    expect(neighborhood.value.neighbors).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Support.md', pathTrace: expect.arrayContaining([expect.stringContaining('direct_link')]) })]));
    const trail = await callJson(client, 'get_wiki_trail', { fromPath: 'Knowledge/Anchor.md', toPath: 'Knowledge/Support.md', maxDepth: 2, accessToken });
    expect(trail.value.paths).toEqual(expect.arrayContaining([expect.objectContaining({ nodes: ['Knowledge/Anchor.md', 'Knowledge/Support.md'], length: 1 })]));
    const placements = await callJson(client, 'get_wiki_placement_candidates', { limit: 10, accessToken });
    expect(placements.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Project misplaced.md', suggestedFolder: 'Projects', reasons: expect.arrayContaining(['project_or_task_outside_projects']) })]));
    const gaps = await callJson(client, 'get_wiki_knowledge_gaps', { limit: 10, accessToken });
    expect(gaps.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Open question.md', noteKind: 'question', epistemicStatus: 'open', reasons: ['question_open'] })]));

    const adaptive = await callJson(client, 'read_note', { path: 'Knowledge/Anchor.md', includeContent: false, accessToken });
    const reviewed = await callJson(client, 'review_wiki_note', { path: 'Knowledge/Anchor.md', reviewOutcome: 'confirmed', reviewedBy: 'codex', expectedRevision: adaptive.value.revision, accessToken });
    expect(reviewed.value).toMatchObject({ adaptiveReviewInterval: true, reviewIntervalDays: 30, reviewAt: expect.any(String) });
    const health = await callJson(client, 'get_wiki_organization_health', { limit: 10, accessToken });
    expect(health.value.quarantine).toMatchObject({ total: expect.any(Number), items: expect.any(Array) });
    expect(health.value.collectionHealth.items).toEqual(expect.arrayContaining([expect.objectContaining({ nextAction: expect.any(String), signals: expect.any(Array), attentionScore: expect.any(Number) })]));
    expect(legacyAuthority.value.entries).toEqual(expect.arrayContaining([expect.objectContaining({ term: 'Legacy anchor', preferred: 'Legacy anchor' })]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('canonical lineage and optional active recall stay in the Markdown organization model', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'lineage-recall-owner', modelId: 'codex', password: 'lineage-recall-password' });
    const accessToken = registration.value.accessToken;
    const write = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Legacy.md', content: '# Legacy approach\n\nThe older approach.\n', frontmatter: {
        llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'superseded', stable_id: 'legacy-approach', canonical_path: 'Knowledge/Current.md',
        term_status: 'redirect', term_replaced_by: '[[Knowledge/Current]]', same_as: ['[[Knowledge/Current]]'], version_of: ['[[Knowledge/Current]]'],
      }, expectedRevision: 'missing', accessToken,
    } });
    expect(write.isError).toBeFalsy();
    const projection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Legacy.md', accessToken });
    expect(projection.value).toMatchObject({ canonicalPath: 'Knowledge/Current.md', relations: { same_as: ['[[Knowledge/Current]]'], version_of: ['[[Knowledge/Current]]'] } });

    const recallWrite = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Recall.md', content: '# Recall\n\nA durable fact.\n', frontmatter: {
        llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', recall_prompt: 'What is the durable fact?', recall_interval_days: 1, last_recalled_at: '2020-01-01T00:00:00.000Z', recall_quality: 'partial',
      }, expectedRevision: 'missing', accessToken,
    } });
    expect(recallWrite.isError).toBeFalsy();
    const gaps = await callJson(client, 'get_wiki_knowledge_gaps', { limit: 10, accessToken });
    expect(gaps.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Recall.md', reasons: expect.arrayContaining(['recall_due']), recallPrompt: 'What is the durable fact?' })]));
    const before = await callJson(client, 'read_note', { path: 'Knowledge/Recall.md', includeContent: false, accessToken });
    const recalled = await callJson(client, 'record_wiki_recall', { path: 'Knowledge/Recall.md', recallQuality: 'good', expectedRevision: before.value.revision, accessToken });
    expect(recalled.value).toMatchObject({ recallQuality: 'good', recallIntervalDays: 1, nextRecallAt: expect.any(String) });
    const after = await callJson(client, 'read_note', { path: 'Knowledge/Recall.md', includeContent: false, accessToken });
    expect(after.value.fm).toMatchObject({ recall_quality: 'good', recall_interval_days: 1 });
  } finally {
    await client.close();
    await server.close();
  }
});

test('agent active recall state is isolated from the shared knowledge note', async () => {
  const { server, client } = await setup();
  try {
    const owner = await callJson(client, 'register_scope_account', { accountId: 'recall-isolation-owner', modelId: 'codex', password: 'recall-isolation-owner-password' });
    const ownerToken = owner.value.accessToken;
    const write = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Shared recall.md', content: '# Shared recall\n\nA fact shared by all agents.\n',
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', recall_prompt: 'What is the shared fact?', recall_interval_days: 1 },
      expectedRevision: 'missing', accessToken: ownerToken,
    } });
    expect(write.isError).toBeFalsy();
    const agent = await callJson(client, 'register_scope_account', { accountId: 'recall-isolation-worker', modelId: 'codex', agentId: 'recall-isolation-worker', userId: 'recall-isolation-owner', password: 'recall-isolation-worker-password', accessToken: ownerToken });
    const agentToken = agent.value.accessToken;
    const before = await callJson(client, 'read_note', { path: 'Knowledge/Shared recall.md', includeContent: false, accessToken: agentToken });
    const recalled = await callJson(client, 'record_wiki_recall', { path: 'Knowledge/Shared recall.md', recallQuality: 'good', expectedRevision: before.value.revision, accessToken: agentToken });
    expect(recalled.value).toMatchObject({ recallQuality: 'good', recallHistoryCount: 1, recallStreak: 1, recallSuccessCount: 1, isolatedTo: expect.stringMatching(/^scope:\/\/agent\/recall-isolation-worker\/_continuity\/recall\/[a-f0-9]{64}\.md$/) });
    const recalledAgain = await callJson(client, 'record_wiki_recall', { path: 'Knowledge/Shared recall.md', recallQuality: 'good', expectedRevision: before.value.revision, accessToken: agentToken });
    expect(recalledAgain.value).toMatchObject({ recallHistoryCount: 2, recallStreak: 2, recallSuccessCount: 2 });
    const after = await callJson(client, 'read_note', { path: 'Knowledge/Shared recall.md', includeContent: false, accessToken: ownerToken });
    expect(after.value.fm).not.toHaveProperty('last_recalled_at');
    expect(after.value.fm).not.toHaveProperty('recall_quality');
  } finally {
    await client.close();
    await server.close();
  }
});

test('recall queue, near-duplicate review, and typed relation health stay bounded', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-quality-3-owner', modelId: 'codex', password: 'organization-quality-3-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Knowledge/Recall queue.md', '# Recall queue\n\nA durable fact about graph health.\n', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', recall_prompt: 'What does graph health protect?', recall_interval_days: 1, last_recalled_at: '2020-01-01T00:00:00.000Z', recall_quality: 'failed',
    });
    await write('Knowledge/Agent Memory.md', '# Agent memory\n\nA durable note about agents, memory, graph health, and bounded review.\n', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen' });
    await write('Knowledge/Agent Memory System.md', '# Agent memory system\n\nA durable note about agents, memory, graph health, and bounded review.\n', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen' });
    await write('Knowledge/Question.md', '# Question\n', { llm_wiki_type: 'knowledge', note_kind: 'question', lifecycle: 'review', epistemic_status: 'open' });
    await write('Knowledge/Concept.md', '# Concept\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen' });
    await write('Knowledge/Self.md', '# Self\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', related: ['[[Knowledge/Self]]'], answers_questions: ['[[Knowledge/Concept]]'] });
    await write('Knowledge/Topic.md', '# Topic\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen' });
    await write('Knowledge/Related.md', '# Related\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', related: ['[[Knowledge/Topic]]'] });
    await write('Archive/Topic.md', '# Topic archive\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'archived' });
    await write('Knowledge/Ambiguous.md', '# Ambiguous\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', related: ['Topic'] });
    await write('Knowledge/Tag One.md', '# Tag One\n', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', tags: ['Research'], subject_terms: ['Unmodeled concept'] });
    await write('Knowledge/Tag Two.md', '# Tag Two\n', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', tags: ['research'] });
    await write('Knowledge/Retention.md', '# Retention\n', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'active', retention_policy: 'archive', retention_at: '2020-01-01', retention_reason: 'Old experiment retained for audit.' });

    const recall = await callJson(client, 'call_endpoint', { endpointId: 'wiki.recall_queue', arguments: { limit: 5, maxChars: 3000, accessToken } });
    expect(recall.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Recall queue.md', reason: 'previous_recall_failed' })]));
    const reviewQueue = await callJson(client, 'get_wiki_review_queue', { limit: 20, maxChars: 8000, accessToken });
    expect(reviewQueue.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Retention.md', retentionDue: true, reviewReasons: expect.arrayContaining(['retention_due']) })]));
    const duplicates = await callJson(client, 'call_endpoint', { endpointId: 'wiki.duplicate_candidates', arguments: { limit: 10, maxChars: 5000, accessToken } });
    expect(duplicates.value.items.some((item: any) => new Set([item.source, item.candidate]).size === 2 && [item.source, item.candidate].some((path: string) => path.endsWith('/Agent Memory.md')) && [item.source, item.candidate].some((path: string) => path.endsWith('/Agent Memory System.md')))).toBe(true);

    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 20, maxChars: 8000, accessToken });
    expect(graph.value.typedRelations.self.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Self.md', relation: 'related' })]));
    expect(graph.value.typedRelations.kindMismatches.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Self.md', relation: 'answers_questions', targetKind: 'knowledge' })]));
    expect(graph.value.typedRelations.reciprocityMissing.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Related.md', relation: 'related', target: 'Knowledge/Topic.md' })]));
    expect(graph.value.typedRelations.ambiguous.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Ambiguous.md', relation: 'related' })]));
    const vocabulary = await callJson(client, 'call_endpoint', { endpointId: 'wiki.vocabulary_health', arguments: { limit: 10, maxChars: 5000, accessToken } });
    expect(vocabulary.value.tagVariants).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'research', reason: 'tag_spelling_or_case_variants' })]));
    expect(vocabulary.value.unresolvedSubjectTerms).toEqual(expect.arrayContaining([expect.objectContaining({ term: 'Unmodeled concept', advisory: true })]));
    const contract = await callJson(client, 'call_endpoint', { endpointId: 'wiki.property_contract', arguments: { maxChars: 4000, accessToken } });
    expect(contract.value.conventions.nativeCompatibility).toMatchObject({ safeTypes: expect.arrayContaining(['list']), mcpManagedComplexFields: expect.arrayContaining(['claims', 'evidence']) });
    const template = await callJson(client, 'call_endpoint', { endpointId: 'wiki.note_template', arguments: { noteKind: 'question', maxChars: 4000, accessToken } });
    expect(template.value).toMatchObject({ templateId: 'question', noteKind: 'question', properties: { epistemic_status: 'open' } });
  } finally {
    await client.close();
    await server.close();
  }
});

test('organization projections expose relation reverse navigation, MOC hierarchy, redirects, and focused Bases views', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-projections-owner', modelId: 'codex', password: 'organization-projections-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Knowledge/Target.md', '# Target\n\nA durable target. ^target-line\n', { note_kind: 'atomic', lifecycle: 'evergreen', summary: 'Target summary.', primary_moc: '[[Knowledge/MOCs/Parent]]', domain: 'knowledge-management', related_terms: ['[[Knowledge/Support]]'] });
    await write('Knowledge/Support.md', '# Support\n\nSupports the target.\n\nA nearby explanation.\n', { note_kind: 'atomic', lifecycle: 'evergreen', supports: ['[[Knowledge/Target]]'] });
    await write('Knowledge/MOCs/Parent.md', '# Parent MOC\n\n[[Knowledge/MOCs/Child]]\n', { note_kind: 'moc', lifecycle: 'evergreen' });
    await write('Knowledge/MOCs/Child.md', '# Child MOC\n\n[[Knowledge/Target]]\n', { note_kind: 'moc', lifecycle: 'evergreen', moc_parent: '[[Knowledge/MOCs/Parent]]' });
    await write('Knowledge/Old.md', '# Old\n\nHistorical note.\n', { note_kind: 'knowledge', lifecycle: 'superseded', replaced_by: '[[Knowledge/Target]]', retention_reason: 'Replaced by the current target note.', retention_event: 'superseded', preserve_until: '2030-01-01', legal_hold: true });

    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 20, maxChars: 10000, accessToken });
    expect(graph.value.relationNavigation.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Target.md', incoming: expect.arrayContaining([expect.objectContaining({ relation: 'supports', paths: ['Knowledge/Support.md'] })]) }),
    ]));
    expect(graph.value.mocHierarchy).toMatchObject({ total: 2, explicitParentEdges: 1, cycles: { total: 0 }, missingParents: { total: 0 } });
    expect(graph.value.mocHierarchy.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/MOCs/Child.md', state: 'nested', resolvedParent: 'Knowledge/MOCs/Parent.md' }),
    ]));

    const projection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Old.md', view: 'summary', accessToken });
    expect(projection.value.redirect).toMatchObject({ state: 'superseded', replacement: '[[Knowledge/Target]]', action: 'preserve_under_hold' });
    expect(projection.value).toMatchObject({ retentionEvent: 'superseded', preserveUntil: '2030-01-01', legalHold: true });

    const targetProjection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Target.md', view: 'summary', accessToken });
    expect(targetProjection.value.navigation).toMatchObject({ primaryMoc: '[[Knowledge/MOCs/Parent]]', domain: 'knowledge-management' });
    const blockProjection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Target.md', view: 'section', blockId: 'target-line', contextBefore: 1, contextAfter: 1, accessToken });
    expect(blockProjection.value).toMatchObject({ section: { startLine: 12, endLine: 12 }, context: { target: { startLine: 12, endLine: 12 } } });
    expect(blockProjection.value.context.after).toEqual(expect.arrayContaining([expect.objectContaining({ line: 13 })]));

    const bases = await callJson(client, 'get_wiki_bases_view', { view: 'inbox_oldest', accessToken });
    expect(bases.value).toMatchObject({ view: 'inbox_oldest', matchingNotesExact: true });
    expect(bases.value.content).toContain('note.lifecycle == "inbox"');
    expect(bases.value.content).toContain('note.captured_at');
  } finally {
    await client.close();
    await server.close();
  }
});

test('triage persists primary MOC and retention safety metadata through the endpoint', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-retention-owner', modelId: 'codex', password: 'organization-retention-password' });
    const accessToken = registration.value.accessToken;
    const captured = await callJson(client, 'capture_wiki_note', { path: 'Inbox/Retention capture.md', content: 'A captured preservation decision.', expectedRevision: 'missing', accessToken });
    const triaged = await callJson(client, 'triage_wiki_note', {
      path: 'Inbox/Retention capture.md', expectedRevision: captured.value.revision, accessToken,
      primaryMoc: '[[Knowledge/MOCs/Operations]]', retentionEvent: 'created', preserveUntil: '2031-01-01', legalHold: true,
    });
    expect(triaged.value.frontmatter).toMatchObject({ primaryMoc: '[[Knowledge/MOCs/Operations]]', retentionEvent: 'created', preserveUntil: '2031-01-01', legalHold: true });
  } finally {
    await client.close();
    await server.close();
  }
});
