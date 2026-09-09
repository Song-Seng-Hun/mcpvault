// Explicit, isolated NAS probe. Never points a test store at the live Vault root.
// Keeps its journal/checkpoint as evidence; it does not delete or reset data.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RoleplayStore } from '../dist/src/roleplay-store.js';
import { roleplayRevision } from '../dist/src/roleplay-model.js';
import { inspectRoleplayRecovery, recoverRoleplayWriter } from '../dist/src/roleplay-recovery.js';
import { roleplayHostIdentity, canonicalRoleplayPath } from '../dist/src/roleplay-storage-host.js';
import { RoleplayService } from '../dist/src/roleplay-service.js';
import { FileSystemService } from '../dist/src/filesystem.js';
import { ScopeAccessPolicy } from '../dist/src/scope-access.js';
import { ReferenceService } from '../dist/src/references.js';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createServer } from '../dist/src/createServer.js';
import { startMcpHttpApi } from '../dist/src/mcp-http.js';

const [nasRoot, hostRoot] = process.argv.slice(2);
if (!nasRoot || !hostRoot || !isAbsolute(nasRoot) || !isAbsolute(hostRoot) || !nasRoot.startsWith('\\\\') || hostRoot.startsWith('\\\\')) throw new Error('Explicit UNC live root and existing local validation host directory required');
await canonicalRoleplayPath(nasRoot, false); await canonicalRoleplayPath(hostRoot, true);
const validationRoot = join(nasRoot, '.mcpvault-validation');
await mkdir(validationRoot, { recursive: true });
const vaultPath = await mkdtemp(join(validationRoot, 'roleplay-evolving-'));
const hostPath = await mkdtemp(join(hostRoot, 'roleplay-evolving-'));
const foreignHostPath = await mkdtemp(join(hostRoot, 'roleplay-foreign-'));
const options = { vaultPath, hostPath, policy: { administrators: ['fixture-host'] } };
const modelUrl = pathToFileURL(resolve('dist/src/roleplay-model.js')).href;
const storeUrl = pathToFileURL(resolve('dist/src/roleplay-store.js')).href;
const crashCode = `
  import fs from 'node:fs/promises';
  import { syncBuiltinESMExports } from 'node:module';
  const rename = fs.rename;
  fs.rename = async (from, to) => {
    if (String(to).endsWith('0000000001.md')) {
      process.stdout.write('INTENT_READY\\n'); setInterval(() => {}, 1000); await new Promise(() => {});
    }
    return rename(from, to);
  };
  syncBuiltinESMExports();
  const { RoleplayStore } = await import(${JSON.stringify(storeUrl)});
  const { roleplayRevision } = await import(${JSON.stringify(modelUrl)});
  const store = await RoleplayStore.open(JSON.parse(process.argv[1]));
  await store.transact({ op: 'initialize', actor: 'fixture-host', requestId: 'crash-initialize', expectedRevision: roleplayRevision(await store.snapshot()), data: { title: 'Isolated NAS verification fixture - not the operational world', places: { hall: [] } } });
`;
const child = spawn(process.execPath, ['--input-type=module', '-e', crashCode, JSON.stringify(options)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const exited = once(child, 'exit');
let stderr = '', output = '', store, mcpServer, mcpApi, client;
child.stderr.on('data', chunk => { stderr += chunk; });
try {
  await new Promise((ready, reject) => {
    const timeout = setTimeout(() => reject(new Error(`NAS intent timeout: ${stderr}`)), 30000);
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('INTENT_READY')) { clearTimeout(timeout); ready(); } });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(`Fixture child exited before intent: ${stderr}`)); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
  });
  await assert.rejects(RoleplayStore.open(options), /writer|lock/);
  const live = await inspectRoleplayRecovery(options);
  await assert.rejects(recoverRoleplayWriter(options, { expectedFingerprint: live.fingerprint, reason: 'Isolated live-writer refusal probe' }), /live|running/);
  await roleplayHostIdentity(foreignHostPath, true);
  const foreign = { vaultPath, hostPath: foreignHostPath };
  const inspection = await inspectRoleplayRecovery(foreign);
  const lockBefore = await readFile(join(vaultPath, '.mcpvault-roleplay/writer.lock'), 'utf8');
  await assert.rejects(recoverRoleplayWriter(foreign, { expectedFingerprint: inspection.fingerprint, reason: 'Isolated foreign-host refusal probe' }), /host.*identity|host.*review/);
  assert.equal(await readFile(join(vaultPath, '.mcpvault-roleplay/writer.lock'), 'utf8'), lockBefore);
  child.kill('SIGKILL'); await exited;
  const dead = await inspectRoleplayRecovery(options);
  assert.equal(dead.lock.pid, child.pid); assert.equal(dead.checkpoint.pending.sequence, 1); assert.equal(dead.turnFiles, 0);
  const recovered = await recoverRoleplayWriter(options, { expectedFingerprint: dead.fingerprint, reason: 'Isolated fixture child killed after durable intent and before NAS canonical rename' });
  store = await RoleplayStore.open(options); assert.equal((await store.snapshot()).sequence, 1);
  const fs = new FileSystemService(vaultPath), access = new ScopeAccessPolicy();
  let service = new RoleplayService(fs, access, new ReferenceService(fs, access), store, { assertActor: async () => {} });
  const principal = { accountId: 'fixture-host', modelId: 'test', agentId: 'test', role: 'agent', capabilities: ['chat'] };
  const write = async (endpoint, data) => service.execute(endpoint, { ...data, requestId: `probe-${(await store.snapshot()).sequence}`, expectedRevision: roleplayRevision(await store.snapshot()) }, principal);
  await write('character', { op: 'character', id: 'fixture', name: 'Verification fixture', controller: 'fixture-host', location: 'hall', definition: 'Initial fixture definition.' });
  await fs.writeNote({ path: 'Community/ChatRooms/fixture.md', content: 'Isolated verification room, not an operational conversation.', frontmatter: { mcpvault_type: 'chat_room', room_id: 'fixture', status: 'open' }, expectedRevision: 'missing' });
  await write('scene', { op: 'scene', roomId: 'fixture', location: 'hall', title: 'Verification scene', gm: 'fixture-host' });
  await write('world', { op: 'settings', evolutionMode: 'evolving', worldGmAccounts: ['fixture-host'] });
  const spoken = await write('action', { op: 'speak', characterId: 'fixture', generation: 1, roomId: 'fixture', content: 'After this test, I trust verified evidence more.' });
  const evolved = await write('evolution', { op: 'propose', characterId: 'fixture', generation: 1, roomId: 'fixture', reason: 'Explicit fixture experience.', sources: [{ turnId: spoken.id, revision: spoken.revision, noteRevision: spoken.noteRevision }], changes: [{ kind: 'belief', target: 'fixture', key: 'verification', text: 'I now prefer verified evidence.' }] });
  const history = await service.execute('history', { turnId: evolved.id, maxChars: 4000 });
  assert.equal(history.items[0].noteRevision, evolved.noteRevision);
  const before = await service.execute('context', { characterId: 'fixture', maxChars: 4000 });
  assert(before.items.some(item => item.kind === 'evolvingBelief' && item.text === 'I now prefer verified evidence.'));
  await store.close(); store = await RoleplayStore.open(options);
  service = new RoleplayService(fs, access, new ReferenceService(fs, access), store, { assertActor: async () => {} });
  const after = await service.execute('context', { characterId: 'fixture', maxChars: 4000 });
  assert.equal(after.revision, before.revision); assert.deepEqual(after.items, before.items);
  mcpServer = createServer(vaultPath, { roleplay: store });
  mcpApi = await startMcpHttpApi(mcpServer, { port: 0 });
  client = new Client({ name: 'isolated-nas-roleplay-reader', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpApi.port}${mcpApi.path}`)));
  assert.equal((await client.listTools()).tools.length, 5);
  const reread = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'roleplay.history', arguments: { turnId: evolved.id, maxChars: 4000 } } });
  assert(!reread.isError);
  const decoded = JSON.parse(reread.content.find(item => item.type === 'text').text);
  assert.equal(decoded.items[0].noteRevision, evolved.noteRevision);
  console.log(JSON.stringify({ passed: true, vaultPath, hostPath, exclusiveWriter: true, liveWriterRefused: true, foreignHostRefused: true, actualChildKilledAtPendingRename: true, recovered, exactReread: { path: evolved.path, noteRevision: evolved.noteRevision, worldRevision: evolved.revision }, actualMcpExactReread: true, contextSurvivedRestart: true, operationalWorldUnchanged: true, fixturesPreserved: true }));
} finally {
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
  await client?.close(); await mcpApi?.close(); await mcpServer?.close();
  await store?.close();
}
