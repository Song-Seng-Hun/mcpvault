import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

test('ingest, publish, catalog, lint, and immutable source enforcement form one workflow', async () => {
  const { server, client } = await setup();
  try {
    const initialized = await callJson(client, 'initialize_llm_wiki', { actor: 'human' });
    expect(initialized.value).toMatchObject({ success: true, created: true, schemaPath: '_wiki/SCHEMA.md' });

    const ingested = await callJson(client, 'ingest_source', {
      sourceId: 'karpathy-idea', title: 'LLM Wiki idea', content: 'Persistent interlinked Markdown compounds knowledge.',
      sourceUrl: 'https://example.test/idea', capturedBy: 'human',
    });
    expect(ingested.value).toMatchObject({ created: true, path: '_sources/karpathy-idea.md' });

    const duplicate = await callJson(client, 'ingest_source', {
      sourceId: 'karpathy-idea', title: 'LLM Wiki idea', content: 'Persistent interlinked Markdown compounds knowledge.', capturedBy: 'human',
    });
    expect(duplicate.value.created).toBe(false);

    const published = await callJson(client, 'publish_knowledge', {
      path: 'Concepts/Compounding Wiki.md',
      content: '# Compounding Wiki\n\nA maintained wiki compounds prior synthesis.',
      evidencePaths: ['_sources/karpathy-idea.md'], author: 'codex', confidence: 'high', status: 'verified', expectedRevision: 'missing',
    });
    expect(published.result.isError).toBeFalsy();

    const catalog = await callJson(client, 'get_wiki_catalog', {});
    expect(catalog.value.counts).toMatchObject({ schema: 1, source: 1, knowledge: 1 });
    const lint = await callJson(client, 'lint_wiki', {});
    expect(lint.value.errors).toBe(0);

    const issue = await callJson(client, 'report_wiki_issue', {
      issueId: 'verify-claim', kind: 'unsupported_claim', title: 'Verify one claim', description: 'The claim needs a second source.', reportedBy: 'reviewer',
      subjectPath: 'Concepts/Compounding Wiki.md', evidencePaths: ['_sources/karpathy-idea.md'],
    });
    const resolved = await callJson(client, 'resolve_wiki_issue', {
      path: issue.value.path, actor: 'reviewer', resolution: 'The claim was narrowed to match the source.', expectedRevision: issue.value.revision,
    });
    expect(resolved.value.status).toBe('resolved');

    for (const mutation of [
      { name: 'write_note', arguments: { path: '_sources/karpathy-idea.md', content: 'tampered' } },
      { name: 'patch_note', arguments: { path: '_sources/karpathy-idea.md', oldString: 'Persistent', newString: 'Ephemeral' } },
      { name: 'delete_note', arguments: { path: '_sources/karpathy-idea.md', confirmPath: '_sources/karpathy-idea.md' } },
      { name: 'move_note', arguments: { oldPath: '_sources/karpathy-idea.md', newPath: 'moved.md' } },
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
