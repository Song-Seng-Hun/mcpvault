import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

let vault: string;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-llm-wiki-'));
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
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

test('knowledge organization contract preserves aliases, projections, and typed relations', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-contract-owner', modelId: 'codex', password: 'organization-contract-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', {
      sourceId: 'organization-contract-source', title: 'Organization contract source', content: 'Typed links and compact projections make knowledge easier to maintain.', capturedBy: 'codex', accessToken,
    });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Existing.md', content: '# Existing\n\nA related durable note.\n', expectedRevision: 'missing', accessToken,
    } });
    const published = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Contract.md', content: '# Contract\n\nA compact, linked knowledge note.\n', evidencePaths: [source.value.path],
      aliases: ['Knowledge contract', 'Metadata contract'], summary: 'Properties describe the note and typed links describe why it is related.',
      keyPoints: ['Keep the full Markdown body.', 'Use typed links for meaningful relations.'], openQuestions: ['Which relation needs review next?'],
      relations: { related: ['[[Knowledge/Existing]]'] }, stableId: 'knowledge-contract', lifecycle: 'evergreen', author: 'codex', expectedRevision: 'missing', accessToken,
    });
    expect(published.value.success).toBe(true);
    const projection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Contract.md', view: 'summary', accessToken });
    expect(projection.value).toMatchObject({ aliases: ['Knowledge contract', 'Metadata contract'], stableId: 'knowledge-contract', relations: { related: ['[[Knowledge/Existing]]'] } });
    const refs = await callJson(client, 'read_references', { path: 'Knowledge/Contract.md', accessToken });
    expect(refs.value.references).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Existing.md' })]));
    const health = await callJson(client, 'get_wiki_organization_health', { limit: 20, accessToken });
    expect(health.value).toMatchObject({ healthy: true, organizationIssueTotal: 0 });
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
      path: 'Inbox/Rough capture.md', content: '# Rough capture\n\nSort this later.\n', expectedRevision: 'missing', accessToken,
    } });
    const inbox = await callJson(client, 'get_wiki_inbox', { limit: 2, maxChars: 1600, accessToken });
    expect(inbox.value).toMatchObject({ total: 1, items: [expect.objectContaining({ path: 'Inbox/Rough capture.md' })] });
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

    await client.callTool({ name: 'write_note', arguments: { path: 'Knowledge/Old.md', content: '# Old\n\nOld knowledge.', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', updated_at: '2020-01-01T00:00:00.000Z', created_at: '2020-01-01T00:00:00.000Z' }, expectedRevision: 'missing', accessToken } });
    const unused = await callJson(client, 'get_wiki_unused_knowledge', { olderThanDays: 30, accessToken });
    expect(unused.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Old.md', suggestedAction: 'review_then_archive_or_supersede' })]));
  } finally {
    await client.close();
    await server.close();
  }
});
