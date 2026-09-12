import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startMcpHttpApi } from './mcp-http.js';
import { createServer } from '../tests/server-fixture.js';
import { RoleplayStore } from './roleplay-store.js';
import { roleplayRevision } from './roleplay-model.js';
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f(); });
async function setupHarness() {
  const root = await mkdtemp(join(tmpdir(), 'roleplay-mcp-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const vaultPath = join(root, 'vault'), hostPath = join(root, 'host'); await mkdir(vaultPath); await mkdir(hostPath);
  const world = await RoleplayStore.open({ vaultPath, hostPath, policy: { administrators: ['host'] } }); cleanup.push(() => world.close());
  const server = createServer(vaultPath, { roleplay: world }); cleanup.push(() => server.close());
  const client = new Client({ name: 'roleplay-protocol', version: '1' }); cleanup.push(() => client.close());
  const api = await startMcpHttpApi(server, { port: 0 }); cleanup.push(() => api.close());
  const second = new Client({ name: 'independent-player', version: '1' }); cleanup.push(() => second.close());
  const url = new URL(`http://127.0.0.1:${api.port}${api.path}`);
  await client.connect(new StreamableHTTPClientTransport(url)); await second.connect(new StreamableHTTPClientTransport(url));
  const call = async (endpointId: string, args: Record<string, unknown>, caller = client) => {
    const r = await caller.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
    const text = (r.content as any[])[0].text; return { error: r.isError, value: r.isError ? text : JSON.parse(text) };
  };
  const tokens: Record<string, string> = {};
  for (const account of ['host', 'alice', 'bob']) {
    const registered = await call('auth.register', { accountId: account, agentId: account, modelId: 'codex', userId: `owner-${account}`, password: 'isolated-roleplay-test-password' });
    expect(registered.error).not.toBe(true); tokens[account] = registered.value.accessToken;
  }
  return { vaultPath, world, client, second, call, tokens };
}
let harness: Awaited<ReturnType<typeof setupHarness>>;
// Isolated transport/account setup is not the behavior under test. Keep real
// HTTP/authentication. This scenario performs many real Windows-ACL guarded
// transactions; its explicit body timeout below is not a per-request SLA.
beforeEach(async () => { harness = await setupHarness(); });
test('nine dynamic endpoints keep five MCP tools; two authenticated players share one state and immutable chat projection', async () => {
  const { vaultPath, world, client, second, call, tokens } = harness;
  expect((await client.listTools()).tools).toHaveLength(5);
  let serial = 0;
  const act = async (endpoint: string, data: Record<string, unknown>, account = 'host') => call(`roleplay.${endpoint}`, { ...data, requestId: `request-${++serial}`, expectedRevision: roleplayRevision(await world.snapshot()), accessToken: tokens[account] });
  expect((await act('world', { op: 'initialize', title: 'Lantern Archive', places: { hall: ['garden'], garden: ['hall'] } }, 'alice')).error).toBe(true);
  expect((await act('world', { op: 'initialize', title: 'Lantern Archive', places: { hall: ['garden'], garden: ['hall'] } })).error).not.toBe(true);
  for (const place of ['hall', 'garden']) {
    expect((await call('chat.room_create', { roomId: place, title: place, expectedRevision: 'missing', accessToken: tokens.host })).error).not.toBe(true);
    if (place === 'hall') expect((await call('chat.message', { roomId: 'hall', messageId: 'before-game', requestId: 'before-game', content: 'Welcome before world binding.', accessToken: tokens.host })).error).not.toBe(true);
    expect((await act('scene', { op: 'scene', roomId: place, location: place, title: place, gm: 'host' })).error).not.toBe(true);
  }
  for (const id of ['alice', 'bob']) expect((await act('character', { op: 'character', id, name: id, controller: id, location: 'hall' })).error).not.toBe(true);
  const legacyReply = await act('action', { op: 'speak', characterId: 'alice', generation: 1, roomId: 'hall', replyTo: 'before-game', content: 'I remember this welcome.' }, 'alice');
  expect(legacyReply.error).not.toBe(true);
  expect((await act('world', { op: 'item', id: 'key', owner: 'place:hall', quantity: 1 })).error).not.toBe(true);
  const revision = roleplayRevision(await world.snapshot());
  const compete = await Promise.all(['alice', 'bob'].map(id => call('roleplay.action', { op: 'take', characterId: id, generation: 1, roomId: 'hall', itemId: 'key', amount: 1, content: 'I pick up the key.', requestId: `compete-${id}`, expectedRevision: revision, accessToken: tokens[id] }, id === 'bob' ? second : client)));
  expect(compete.filter(r => !r.error)).toHaveLength(1);
  const winner = compete[0]!.error ? 'bob' : 'alice';
  const moved = await act('action', { op: 'move', characterId: winner, generation: 1, roomId: 'hall', to: 'garden', content: 'I enter the garden.' }, winner);
  expect(moved.error).not.toBe(true);
  const context = await call('roleplay.context', { characterId: winner, roomId: 'garden', maxChars: 4000 }, second);
  expect(context.error).not.toBe(true); expect(context.value.character.location).toBe('garden');
  const chat = await call('chat.room_read', { roomId: 'hall', maxChars: 6000 });
  expect(chat.error).not.toBe(true); expect(chat.value.messages.some((m: any) => m.messageId === `roleplay-${moved.value.id}`)).toBe(true);
  const message = chat.value.messages.find((m: any) => m.messageId === `roleplay-${moved.value.id}`);
  expect(message.content.trim()).toBe('I enter the garden.');
  expect(message.content).not.toContain('roleplay_event');
  expect(Array.from(message.content.trim()).length).toBeLessThanOrEqual(280);
  // Regression for the real-model stall: discover a registered recovery action
  // directly from context rather than inventing a GM-only resolution.
  for (const [id, conditions, effects] of [
    ['restore-power', [{ op: 'location', value: 'garden' }], [{ op: 'flag', characterId: '$actor', key: 'power-on', value: true }]],
    ['unlock', [{ op: 'equals', key: 'power-on', value: true }, { op: 'quantity', itemId: 'key', owner: 'character:$actor', min: 1 }], [{ op: 'transfer', itemId: 'key', from: 'character:$actor', to: 'place:garden', amount: 1 }, { op: 'flag', characterId: '$actor', key: 'vault-open', value: true }]],
  ] as const) expect((await act('world', { op: 'rule', id, conditions, effects })).error).not.toBe(true);
  const beforeHints = roleplayRevision(await world.snapshot());
  const hints = await call('roleplay.context', { characterId: winner, roomId: 'garden', maxChars: 12000 });
  expect(hints.error).not.toBe(true);
  const recovery = hints.value.items.find((item: any) => item.kind === 'registered_action' && item.ruleId === 'restore-power');
  expect(recovery.conditionsMatch).toBe(true);
  expect(hints.value.items.find((item: any) => item.ruleId === 'unlock').conditionsMatch).toBe(false);
  expect(roleplayRevision(await world.snapshot())).toBe(beforeHints);
  expect((await act('action', { ...recovery.nextAction.arguments, content: 'Restore the power.' }, winner)).error).not.toBe(true);
  const restored = await call('roleplay.context', { characterId: winner, roomId: 'garden', maxChars: 12000 });
  const unlock = restored.value.items.find((item: any) => item.ruleId === 'unlock');
  expect(unlock.conditionsMatch).toBe(true);
  expect((await act('action', { ...unlock.nextAction.arguments, content: 'Use the key to open the vault.' }, winner)).error).not.toBe(true);
  expect((await world.snapshot()).characters[winner]!.flags['vault-open']).toBe(true);
  expect((await world.snapshot()).items.key![`character:${winner}`]).toBe(0);
  expect((await act('action', { ...unlock.nextAction.arguments, content: 'Use the key again.' }, winner)).error).toBe(true);
  const edit = await call('notes.patch', { path: moved.value.path, oldString: 'I enter', newString: 'Forged', expectedRevision: moved.value.noteRevision, accessToken: tokens[winner] });
  expect(edit.error).toBe(true);
  expect((await call('roleplay.world', { op: 'read' })).error).not.toBe(true);
  expect((await act('world', { op: 'settings', evolutionMode: 'evolving', worldGmAccounts: ['host'] })).error).not.toBe(true);
  const dialogue = await act('action', { op: 'speak', characterId: winner, generation: 1, roomId: 'garden', content: 'The garden now feels safer to me.' }, winner);
  expect(dialogue.error).not.toBe(true);
  const evolved = await act('evolution', { op: 'propose', characterId: winner, generation: 1, roomId: 'garden', reason: 'After unlocking the vault.',
    sources: [{ turnId: dialogue.value.id, revision: dialogue.value.revision, noteRevision: dialogue.value.noteRevision }],
    changes: [{ kind: 'belief', target: winner, key: 'garden', text: 'I feel safer in the garden now.' }] }, winner);
  expect(evolved.error, JSON.stringify(evolved.value)).not.toBe(true);
  const evolutionRead = await call('roleplay.evolution', { op: 'read', proposalId: evolved.value.id });
  expect(evolutionRead.error, JSON.stringify(evolutionRead.value)).not.toBe(true);
  expect(evolutionRead.value.items.some((i: any) => i.kind === 'proposal' && i.status === 'applied')).toBe(true);
  const evolvedContext = await call('roleplay.context', { characterId: winner, roomId: 'garden', maxChars: 4000 });
  expect(JSON.stringify(evolvedContext.value)).toContain('I feel safer in the garden now.');
  const readonlyServer = createServer(vaultPath, { roleplay: world, readOnly: true }); cleanup.push(() => readonlyServer.close());
  const readonlyApi = await startMcpHttpApi(readonlyServer, { port: 0 }); cleanup.push(() => readonlyApi.close());
  const readonlyClient = new Client({ name: 'read-only-evolution', version: '1' }); cleanup.push(() => readonlyClient.close());
  await readonlyClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${readonlyApi.port}${readonlyApi.path}`)));
  expect((await call('roleplay.evolution', { op: 'list' }, readonlyClient)).error).not.toBe(true);
  const beforeReadonly = roleplayRevision(await world.snapshot());
  for (const op of ['propose', 'apply', 'reject']) {
    const denied = await call('roleplay.evolution', { op, requestId: `readonly-${op}`, expectedRevision: beforeReadonly, accessToken: tokens[winner], proposalId: evolved.value.id }, readonlyClient);
    expect(denied.error).toBe(true); expect(String(denied.value)).toMatch(/read.only/i);
  }
  expect(roleplayRevision(await world.snapshot())).toBe(beforeReadonly);
  const path = join(vaultPath, moved.value.path);
  const original = await readFile(path, 'utf8');
  await writeFile(path, original.replace('I enter the garden.', 'FORGED SUCCESS'));
  const forged = await call('chat.room_read', { roomId: 'hall', maxChars: 6000 });
  expect(forged.error).toBe(true);
  expect(JSON.stringify(forged.value)).not.toContain('FORGED SUCCESS');
}, 30000);
