import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
let vault: string;
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'obsidian-workflows-')); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
async function connect(readOnly = false) {
  const server = createServer(vault, { version: 'test', readOnly });
  const client = new Client({ name: 'test', version: 'test' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  const call = async (endpointId: string, args: any = {}, accessToken?: string) => {
    const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args, ...(accessToken && { accessToken }) } });
    const text = (result.content as any[])[0].text;
    return { error: result.isError, text, value: result.isError ? {} : JSON.parse(text) };
  };
  return { client, server, call };
}
test('dynamic views and host bundles are usable without expanding the five-tool surface', async () => {
  await writeFile(join(vault, 'View.md'), '---\nwiki_view:\n  version: 1\n  filters: {note_kind: atomic}\n  columns: [title]\n---\n');
  await writeFile(join(vault, 'A.md'), '---\nnote_kind: atomic\ntitle: A\n---\n');
  const { server, client, call } = await connect();
  try {
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual(['call_endpoint', 'get_agent_pulse', 'list_active_capabilities', 'orient_wiki', 'search_capabilities'].sort());
    const view = await call('wiki.view', { path: 'View.md' }); expect(view.error, view.text).toBeFalsy(); expect(view.value.items[0].path).toBe('A.md');
    const base = await call('wiki.bases_view', { savedViewPath: 'View.md' }); expect(base.error, base.text).toBeFalsy(); expect(base.value.yaml).toContain('note_kind');
    const bundle = await call('wiki.property_contract', { hostBundle: true }); expect(bundle.error, bundle.text).toBeFalsy(); expect(bundle.value.fingerprint).toMatch(/^sha256:/);
    const scaffold = await call('wiki.note_template', { authoring: { intent: 'reply', slug: 'self-introductions' } });
    expect(scaffold.value.authoring.nextAction.endpointId).toBe('community.comment');
  } finally { await client.close(); await server.close(); }
});
test('MOC registration rejects anonymous and read-only clients', async () => {
  await writeFile(join(vault, 'Map.md'), '---\nnote_kind: moc\n---\n# Map');
  await mkdir(join(vault, 'Knowledge'));
  for (const readOnly of [false, true]) {
    const { server, client, call } = await connect(readOnly);
    try {
      expect((await call('wiki.moc_region', { path: 'Map.md', operation: 'register', pathPrefix: 'Knowledge' })).error).toBe(true);
      const status = await call('wiki.moc_region_status', { path: 'Map.md' });
      expect(status.error, status.text).toBeFalsy(); expect(status.value.status).toBe('unregistered');
    }
    finally { await client.close(); await server.close(); }
  }
});

test('retired MOC status option rejects calls while the canonical read preserves access', async () => {
  await writeFile(join(vault, 'Map.md'), '---\nnote_kind: moc\n---\n# Map');
  await writeFile(join(vault, 'Hidden.md'), '---\nnote_kind: moc\nmoderation_status: hidden\n---\nPRIVATE BODY');
  for (const readOnly of [false, true]) {
    const { server, client, call } = await connect(readOnly);
    try {
      for (const path of ['Map.md', 'Hidden.md', 'scope://agent/another/Private.md']) {
        const canonical = await call('wiki.moc_region_status', { path });
        const legacy = await call('wiki.moc_region', { path, operation: 'status' });
        expect(legacy.error).toBe(true);
        expect(legacy.text).not.toContain('PRIVATE BODY');
        if (path === 'Map.md') expect(canonical.value.status).toBe('unregistered');
        else expect(canonical.error).toBe(true);
      }
    } finally { await client.close(); await server.close(); }
  }
});
test('mechanical normalization previews an exact change set without refreshing semantic fingerprints', async () => {
  await writeFile(join(vault, 'Windows.md'), '---\r\nnote_kind: atomic\r\nsummary_of_content_sha256: old\r\n---\r\n# Body\r\n');
  const { server, client, call } = await connect();
  try {
    const preview = await call('wiki.preflight', { path: 'Windows.md', normalizeFormatting: true });
    expect(preview.error, preview.text).toBeFalsy();
    expect(preview.value.formatting.nextAction).toMatchObject({ endpointId: 'notes.change_set', arguments: { dryRun: true, changes: [{ path: 'Windows.md', patches: [{ oldString: '\r\n', newString: '\n', replaceAll: true }] }] } });
    expect(JSON.stringify(preview.value.formatting.nextAction)).not.toContain('summary_of_content_sha256');
  } finally { await client.close(); await server.close(); }
});
test('optional read navigation preserves authored order and caps related discoveries', async () => {
  await writeFile(join(vault, 'Map.md'), '---\nnote_kind: moc\n---\n# Map\n[[B]]\n[[A]]\n[[C]]\n%% MCPVault MOC BEGIN %%\n[[Generated]]\n%% MCPVault MOC END %%\n');
  await writeFile(join(vault, 'Generated.md'), '# Generated');
  for (const id of ['A', 'B', 'C']) await writeFile(join(vault, `${id}.md`), `---\nnote_kind: atomic\nprimary_moc: "[[Map]]"\n---\n# ${id}\n`);
  const { server, client, call } = await connect();
  try {
    const result = await call('wiki.read_projection', { path: 'A.md', includeNavigation: true, includeRelated: true, maxChars: 12000 });
    expect(result.error, result.text).toBeFalsy();
    expect(result.value.navigation).toMatchObject({ parent: { path: 'Map.md' }, previous: { path: 'B.md' }, next: { path: 'C.md' }, origin: 'authored-moc-order' });
    expect(result.value.related.items.length).toBeLessThanOrEqual(5);
    const path = await call('wiki.learning_path', { path: 'Map.md', maxChars: 12000 });
    expect(path.error, path.text).toBeFalsy();
    expect(path.value.authoredOrder.map((row: any) => row.path)).not.toContain('Generated.md');
  } finally { await client.close(); await server.close(); }
});

test('authenticated MOC registration receives actual host file events without plugins or Obsidian', async () => {
  await mkdir(join(vault, 'Knowledge'));
  await writeFile(join(vault, 'Map.md'), '---\nnote_kind: moc\n---\n# Authored\n');
  const { server, client, call } = await connect();
  try {
    const auth = await call('auth.register', { accountId: 'moc-fixture', userId: 'fixture-owner', modelId: 'codex', agentId: 'moc-fixture', password: randomUUID() });
    expect(auth.error, auth.text).toBeFalsy();
    const token = auth.value.accessToken;
    const preview = await call('wiki.moc_region', { path: 'Map.md', pathPrefix: 'Knowledge', operation: 'preview' }, token);
    expect(preview.error, preview.text).toBeFalsy();
    const registered = await call('wiki.moc_region', preview.value.applyAction.arguments, token);
    expect(registered.error, registered.text).toBeFalsy();
    await writeFile(join(vault, 'Knowledge/Host.md'), '# Written by host');
    await vi.waitFor(async () => expect(await readFile(join(vault, 'Map.md'), 'utf8')).toContain('[[Knowledge/Host.md]]'), { timeout: 6000, interval: 200 });
    const status = await call('wiki.moc_region_status', { path: 'Map.md' });
    expect(status.error, status.text).toBeFalsy(); expect(status.value.status).toBe('active');
  } finally { await client.close(); await server.close(); }
}, 10000);
