import { expect, test, vi } from 'vitest';
import { organizationNoteTemplate, NOTE_TEMPLATE_IDS } from './organization.js';
import { getLlmWikiTools } from './llm-wiki-tools.js';
import { getResearchBridgeTools } from './research-bridge-tools.js';
import { EndpointRegistry } from './endpoint-registry.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, getServerRuntime } from './createServer.js';
import { FileSystemService } from './filesystem.js';

test('research templates remain optional scaffolds over existing kinds and are reachable in the schema', () => {
  const kinds = { 'research-journal': 'journal', 'search-log': 'literature', 'bridge-hypothesis': 'hypothesis' };
  const schema = getLlmWikiTools().find(t => t.name === 'get_wiki_note_template')!.inputSchema as any;
  for (const [templateId, kind] of Object.entries(kinds)) {
    expect(NOTE_TEMPLATE_IDS).toContain(templateId);
    expect(schema.properties.noteKind.enum).toContain(templateId);
    expect(organizationNoteTemplate(templateId)).toMatchObject({ templateId, noteKind: kind, properties: { note_kind: kind } });
  }
  const literature = organizationNoteTemplate('literature').markdown;
  expect(literature).toContain('## Author claim'); expect(literature).toContain('## Exact locator');
  expect(literature.match(/## Interpretation/g)).toHaveLength(1);
  const experiment = organizationNoteTemplate('experiment').markdown;
  expect(experiment).toContain('result.planRevision'); expect(experiment).toContain('## Execution outcome');
});

test('bridge endpoint is dynamic, GET and read-only with bounded schema', () => {
  const registry = new EndpointRegistry(); registry.setTools(getResearchBridgeTools(), {}, new Set());
  const endpoint = registry.resolve('wiki.bridge_candidates');
  expect(endpoint).toMatchObject({ toolName: 'get_wiki_bridge_candidates', method: 'GET', mutating: false });
  expect(registry.resolveRoute('GET', '/api/wiki/bridge-candidates')?.endpoint.endpointId).toBe('wiki.bridge_candidates');
  expect((endpoint!.input as any).properties.maxChars.maximum).toBe(12000);
});

test('real read-only server dispatches the dynamic endpoint and revision-safe source actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'research-endpoint-'));
  const fs = new FileSystemService(root);
  await fs.writeNote({ path: 'Focus.md', content: 'Observed symmetry.', frontmatter: { note_kind: 'question', methods: ['symmetry'] } });
  await fs.writeNote({ path: 'Physics.md', content: 'Symmetry has conditions.', frontmatter: { note_kind: 'literature', domain: 'physics', methods: ['symmetry'] } });
  const server = createServer(root, { version: 'test', readOnly: true });
  try {
    const runtime = getServerRuntime(server)!;
    const response = await runtime.dispatchTool('call_endpoint', { endpointId: 'wiki.bridge_candidates', arguments: { focusPath: 'Focus.md', maxChars: 6000, prettyPrint: true } });
    expect(response.isError).not.toBe(true);
    const text = response.content[0].text, packet = JSON.parse(text);
    expect(text.length).toBeLessThanOrEqual(6000);
    expect(packet.candidates[0].target).toBe('Physics.md');
    const source = packet.sources[0];
    const read = await runtime.dispatchTool('call_endpoint', source.nextAction);
    expect(read.isError).not.toBe(true);
    await fs.writeNote({ path: 'Focus.md', content: 'Changed observation.', frontmatter: { note_kind: 'question' } });
    const stale = await runtime.dispatchTool('call_endpoint', source.nextAction);
    expect(stale.isError).toBe(true);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});

test('anonymous callers cannot inject a principal to read a private research input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'research-principal-'));
  const fs = new FileSystemService(root);
  await fs.writeNote({ path: '_scopes/agents/victim/Secret.md', content: 'PRIVATE_RESEARCH_MARKER', frontmatter: { note_kind: 'question' } });
  const server = createServer(root, { version: 'test', readOnly: true });
  try {
    const response = await getServerRuntime(server)!.dispatchTool('call_endpoint', { endpointId: 'wiki.bridge_candidates', arguments: {
      focusPath: 'scope://agent/victim/Secret.md', principal: { accountId: 'victim', agentId: 'victim', modelId: 'gpt', role: 'agent' },
    } });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response)).not.toContain('PRIVATE_RESEARCH_MARKER');
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});

test('logout while a private input is being read prevents delivery of its contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'research-logout-'));
  const fs = new FileSystemService(root), path = '_scopes/agents/victim/Secret.md';
  await fs.writeNote({ path, content: 'PRIVATE_LOGOUT_MARKER', frontmatter: { note_kind: 'question' } });
  const server = createServer(root, { version: 'test' });
  try {
    const runtime = getServerRuntime(server)!;
    const registered = await runtime.dispatchTool('call_endpoint', { endpointId: 'auth.register', arguments: {
      accountId: 'victim', modelId: 'gpt', agentId: 'victim', password: 'fixture-password-only',
    } });
    expect(registered.isError).not.toBe(true);
    const accessToken = JSON.parse(registered.content[0].text).accessToken;
    expect(typeof accessToken).toBe('string');
    const original = FileSystemService.prototype.readNote;
    let revoked = false;
    vi.spyOn(FileSystemService.prototype, 'readNote').mockImplementation(async function (this: FileSystemService, selectedPath, bytes) {
      const note = await original.call(this, selectedPath, bytes);
      if (selectedPath === path && !revoked) {
        revoked = true;
        const logout = await runtime.dispatchTool('call_endpoint', { endpointId: 'auth.logout', arguments: { accessToken } });
        expect(logout.isError).not.toBe(true);
      }
      return note;
    });
    const response = await runtime.dispatchTool('call_endpoint', { endpointId: 'wiki.bridge_candidates', arguments: { focusPath: 'scope://agent/victim/Secret.md', accessToken } });
    expect(revoked).toBe(true);
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response)).not.toContain('PRIVATE_LOGOUT_MARKER');
  } finally { vi.restoreAllMocks(); await server.close(); await rm(root, { recursive: true, force: true }); }
});
