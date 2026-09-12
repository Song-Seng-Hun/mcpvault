import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, getServerRuntime, type CreateServerOptions } from './createServer.js';
import { HOST_FEATURE_IDS_V1 } from './host-features.js';
import { startRestApi } from './rest-api.js';
import { DocumentSearch } from './document-search.js';

const construction = vi.hoisted(() => ({ documents: vi.fn(), notifications: vi.fn(), community: vi.fn(), skills: vi.fn() }));
vi.mock('./document-index.js', async original => {
  const module = await original<typeof import('./document-index.js')>();
  return { ...module, DocumentIndex: class extends module.DocumentIndex { constructor(...args: ConstructorParameters<typeof module.DocumentIndex>) { super(...args); construction.documents(); } } };
});
vi.mock('./notifications.js', async original => {
  const module = await original<typeof import('./notifications.js')>();
  return { ...module, NotificationService: class extends module.NotificationService { constructor(...args: ConstructorParameters<typeof module.NotificationService>) { super(...args); construction.notifications(); } } };
});
vi.mock('./community-features.js', async original => {
  const module = await original<typeof import('./community-features.js')>();
  return { ...module, CommunityFeaturesService: class extends module.CommunityFeaturesService { constructor(...args: ConstructorParameters<typeof module.CommunityFeaturesService>) { super(...args); construction.community(); } } };
});
vi.mock('./skill-evolution.js', async original => {
  const module = await original<typeof import('./skill-evolution.js')>();
  return { ...module, SkillEvolutionService: class extends module.SkillEvolutionService { constructor(...args: ConstructorParameters<typeof module.SkillEvolutionService>) { super(...args); construction.skills(); } } };
});
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.clearAllMocks(); });
async function fixture(options: CreateServerOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'host-features-runtime-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'Note.md'), '# Ordinary wiki');
  const server = createServer(root, options); cleanup.push(() => server.close());
  return { root, server, runtime: getServerRuntime(server)! };
}

test('new runtimes default to wiki core without constructing optional services or exposing their endpoints', async () => {
  const { runtime } = await fixture();
  expect((await runtime.dispatchTool('call_endpoint', { endpointId: 'notes.read', arguments: { path: 'Note.md' } })).isError).not.toBe(true);
  for (const endpoint of ['documents.read', 'memory.recall', 'work.board', 'community.post', 'roleplay.world']) expect(runtime.endpointRegistry.resolve(endpoint)).toBeUndefined();
  for (const count of Object.values(construction)) expect(count).not.toHaveBeenCalled();
});

test('explicit document convenience does not activate collaboration or other optional services', async () => {
  const { runtime } = await fixture({ features: { version: 1, selected: ['wiki-core', 'document-search'] } });
  expect(runtime.endpointRegistry.resolve('documents.read')).toBeDefined();
  expect((await runtime.dispatchTool('call_endpoint', { endpointId: 'documents.outline', arguments: { path: 'Note.md' } })).isError).not.toBe(true);
  expect(construction.documents).toHaveBeenCalledTimes(1);
  expect(construction.notifications).not.toHaveBeenCalled(); expect(construction.skills).not.toHaveBeenCalled();
});

test('server shutdown releases document search metadata caches', async () => {
  const close = vi.spyOn(DocumentSearch.prototype, 'close');
  try {
    const { server } = await fixture({ features: { version: 1, selected: ['wiki-core', 'document-search'] } });
    await server.close();
    expect(close).toHaveBeenCalledTimes(1);
  } finally { close.mockRestore(); }
});

test('disabled feature direct and operation-alias calls cannot bypass host selection', async () => {
  const { runtime } = await fixture();
  for (const [name, args] of [['read_document', { path: 'Note.md' }], ['manage_work_group', { op: 'read' }], ['read_work_group', {}]] as const) {
    const response = await runtime.dispatchTool(name, args);
    expect(response.isError).toBe(true); expect(JSON.stringify(response)).toMatch(/feature|disabled|unavailable/i);
  }
});

test('explicit current feature snapshot preserves all current endpoints without granting provider execution', async () => {
  const { runtime } = await fixture({ features: { version: 1, selected: [...HOST_FEATURE_IDS_V1] } });
  expect(runtime.endpointRegistry.resolve('documents.read')).toBeDefined();
  expect(runtime.endpointRegistry.resolve('community.post')).toBeDefined();
  const response = await runtime.dispatchTool('call_endpoint', { endpointId: 'roleplay.world', arguments: { op: 'read' } });
  expect(response.isError).toBe(true);
  expect(response.content[0].text).toMatch(/owner|consent|authority/i);
});

test('wiki-only capability pages and idle pulse never recommend a disabled feature', async () => {
  const { runtime } = await fixture();
  const result = await runtime.dispatchTool('list_active_capabilities', { limit: 1 });
  expect(result.isError).not.toBe(true);
  const registration = await runtime.dispatchTool('register_scope_account', { accountId: 'wiki-owner', modelId: 'model', password: 'test-only-password' });
  const accessToken = JSON.parse(registration.content[0].text).accessToken;
  const response = await runtime.dispatchTool('get_agent_pulse', { accessToken, maxChars: 12000 });
  expect(response.isError).not.toBe(true);
  const pulse = JSON.parse(response.content[0].text);
  const action = pulse.nextAction ?? pulse.primaryAction;
  const tool = action?.tool ?? action?.endpointId;
  expect(tool).toBeTruthy();
  expect(tool).not.toMatch(/community|work\.|memory|idea|benchmark|explanation|roleplay|skill/);
  for (const count of Object.values(construction)) expect(count).not.toHaveBeenCalled();
});

test('REST and feature reactivation preserve files without a direct endpoint bypass', async () => {
  const { server, root } = await fixture();
  const api = await startRestApi(server, { port: 0 }); cleanup.push(() => api.close());
  const blocked = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/documents.read?path=Note.md`);
  expect(blocked.ok).toBe(false);
  const enabled = createServer(root, { features: { version: 1, selected: ['wiki-core', 'document-search'] } }); cleanup.push(() => enabled.close());
  const response = await getServerRuntime(enabled)!.dispatchTool('call_endpoint', { endpointId: 'documents.read', arguments: { path: 'Note.md' } });
  expect(response.isError).not.toBe(true); expect(response.content[0].text).toContain('Ordinary wiki');
});

test('personal memory and work selections leave community subscriptions off', async () => {
  const { runtime } = await fixture({ features: { version: 1, selected: ['wiki-core', 'personal-memory', 'work-management'] } });
  expect(runtime.endpointRegistry.resolve('memory.recall')).toBeDefined();
  expect(runtime.endpointRegistry.resolve('work.board')).toBeDefined();
  expect(runtime.endpointRegistry.resolve('community.post')).toBeUndefined();
  expect(construction.notifications).not.toHaveBeenCalled(); expect(construction.skills).not.toHaveBeenCalled();
});
