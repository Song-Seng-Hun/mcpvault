import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';
import { LayeredMemoryService } from './layered-memory.js';
import { RetrievalService } from './retrieval-service.js';

let root: string; let client: Client; let server: ReturnType<typeof createServer>; let fs: FileSystemService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'layered-memory-')); fs = new FileSystemService(root);
  await fs.writeNote({ path: 'Memory/NAS.md', content: '# NAS\n\nNAS notifications can fail on this mount; polling worked only after testing. ^nas', frontmatter: { memory_role: 'procedural', observed_at: '2026-01-01', use_when: 'NAS missing changes' } });
  await fs.writeNote({ path: 'Community/Memory/Meeting.md', content: 'NAS team meeting', frontmatter: { memory_role: 'episodic' } });
  await fs.writeNote({ path: 'Memory/Retired.md', content: 'NAS outdated advice', frontmatter: { memory_role: 'semantic', memory_state: 'archived' } });
  server = createServer(root, { version: 'memory-test' });
  client = new Client({ name: 'memory-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(ct), server.connect(st)]);
});
afterEach(async () => { vi.restoreAllMocks(); await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); });
async function call(endpointId: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
  const text = (result.content as any)[0].text as string;
  return { result, text, value: result.isError ? { error: text } : JSON.parse(text) };
}
test('memory recall discovers current scoped experience without exposing shared or archived noise', async () => {
  const reply = await call('memory.recall', { scope: 'global', query: 'NAS', maxChars: 4000 });
  expect(reply.result.isError).not.toBe(true);
  expect(reply.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Memory/NAS.md' })]));
  expect(reply.text).not.toContain('Meeting'); expect(reply.text).not.toContain('outdated advice');
  expect(reply.text.length).toBeLessThanOrEqual(4000);
  expect(reply.value.items[0]).toHaveProperty('revision');
  expect(reply.value.items[0]).toHaveProperty('nextAction');
});
test('personal recall requires identity and does not silently fall back to Global', async () => {
  const reply = await call('memory.recall', { query: 'NAS' });
  expect(reply.result.isError).toBe(true); expect(reply.text).not.toContain('polling worked');
});

test('bounded onboarding separates private experience retention from unrelated shared maintenance', async () => {
  const registered = await call('auth.register', { accountId: 'memory-onboarding', agentId: 'memory-onboarding', modelId: 'codex', password: 'memory-onboarding-password' });
  const accessToken = registered.value.accessToken;
  const result = await client.callTool({ name: 'orient_wiki', arguments: { accessToken, maxChars: 4000 } });
  const text = (result.content as any)[0].text as string;
  const orientation = JSON.parse(text);
  expect(text.length).toBeLessThanOrEqual(4000);
  expect(orientation.actionBudget.instruction).toContain('memory.brief');
  expect(orientation.actionBudget.instruction).toContain('personal by default');
  expect(orientation.actionBudget.instruction).toContain('Shared edits require task authorization');
  expect(orientation.primaryAction.endpointId).toBe('get_agent_pulse');
});
test('brief and consolidation remain bounded read-only projections with historical opt-in', async () => {
  const before = (await fs.readNote('Memory/NAS.md')).revision;
  const historical = await call('memory.recall', { scope: 'global', query: 'NAS', includeHistory: true, maxChars: 12000 });
  expect(historical.result.isError).not.toBe(true); expect(historical.text).toContain('outdated advice');
  const brief = await call('memory.brief', { scope: 'global', query: 'NAS', maxChars: 2000 });
  expect(brief.result.isError).not.toBe(true); expect(brief.text.length).toBeLessThanOrEqual(2000);
  const synthesis = await call('memory.consolidate', { scope: 'global', query: 'NAS', maxChars: 4000 });
  expect(synthesis.result.isError).not.toBe(true); expect(synthesis.value).toHaveProperty('interpretation', 'agent_required');
  expect((await fs.readNote('Memory/NAS.md')).revision).toBe(before);
});

test('question excerpts select the relevant later paragraph instead of the introduction', async () => {
  await fs.writeNote({ path: 'Memory/Late.md', content: '# Background\n\nUnrelated introduction.\n\n## Condition\n\nGPU is not necessary unless the measured CPU budget is exceeded.', frontmatter: { memory_role: 'procedural' } });
  const reply = await call('memory.recall', { scope: 'global', query: 'GPU', semantic: false });
  expect(reply.result.isError).not.toBe(true); expect(reply.text).toContain('not necessary unless');
});

test('corrections are followed even when only the original matches the query', async () => {
  await fs.writeNote({ path: 'Memory/Old.md', content: 'Old zebracase hypothesis', frontmatter: { memory_role: 'episodic' } });
  await fs.writeNote({ path: 'Memory/New.md', content: 'Actual cause was a driver failure, not the assumed disk.', frontmatter: { memory_role: 'semantic', memory_corrects: [{ path: 'Memory/Old.md' }] } });
  const reply = await call('memory.recall', { scope: 'global', query: 'zebracase', semantic: false });
  expect(reply.result.isError).not.toBe(true); expect(reply.text).toContain('Actual cause');
  expect(reply.text).not.toContain('Old zebracase hypothesis');
});

test('memory snapshots reject modified continuations and expose no credentials in budget recovery', async () => {
  const first = await call('memory.recall', { scope: 'global', query: 'NAS', includeHistory: true, limit: 1 });
  expect(first.value.nextCursor).toBeDefined();
  await fs.writeNote({ path: 'Memory/NAS.md', content: 'Changed NAS observation', frontmatter: { memory_role: 'episodic' } });
  const stale = await call('memory.recall', { scope: 'global', query: 'NAS', includeHistory: true, cursor: first.value.nextCursor });
  expect(stale.result.isError).toBe(true); expect(stale.text).toMatch(/snapshot changed/i);
});

test('consolidation distinguishes changed basis and unreviewed related memories', async () => {
  const source = await fs.readNote('Memory/NAS.md');
  await fs.writeNote({ path: 'Memory/Synthesis.md', content: 'NAS operating lesson', frontmatter: {
    memory_role: 'semantic', memory_basis: [{ path: 'Memory/NAS.md', revision: source.revision }], summary: 'Old NAS summary', summary_of_content_sha256: 'a'.repeat(64),
  } });
  await fs.writeNote({ path: 'Memory/NAS.md', content: 'NAS changed conditions', frontmatter: { memory_role: 'procedural' } });
  await fs.writeNote({ path: 'Memory/NewExperience.md', content: 'NAS failed with another mount', frontmatter: { memory_role: 'episodic' } });
  const reply = await call('memory.consolidate', { scope: 'global', query: 'NAS', maxChars: 12000 });
  expect(reply.result.isError).not.toBe(true);
  const summary = reply.value.items.find((item: any) => item.path === 'Memory/Synthesis.md');
  expect(summary.summaryState).toBe('stale');
  expect(summary.basis[0].state).toBe('changed');
  expect(summary.unreviewedRelated).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Memory/NewExperience.md' })]));
});

test('same model and family do not grant access to another agent memory', async () => {
  const tokenFor = async (name: string) => {
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: name, agentId: name, modelId: 'codex', userId: 'test-family', password: 'test-memory-password' } });
    const login = await client.callTool({ name: 'login_scope', arguments: { accountId: name, password: 'test-memory-password' } });
    return JSON.parse((login.content as any)[0].text).accessToken;
  };
  const alice = await tokenFor('memory-alice'); const bob = await tokenFor('memory-bob');
  const write = await client.callTool({ name: 'write_note', arguments: { path: 'scope://agent/memory-alice/Experience.md', content: 'uniquesecret experience', frontmatter: { memory_role: 'episodic' }, accessToken: alice } });
  expect(write.isError).not.toBe(true);
  const own = await call('memory.recall', { query: 'uniquesecret', accessToken: alice });
  expect(own.result.isError).not.toBe(true); expect(own.text).toContain('uniquesecret experience');
  const other = await call('memory.recall', { query: 'uniquesecret', accessToken: bob });
  expect(other.text).not.toContain('Experience.md'); expect(other.value.items).toEqual([]);
});

test('acyclic correction chains return only the current terminal interpretation', async () => {
  await fs.writeNote({ path: 'Memory/A.md', content: 'chainneedle original', frontmatter: { memory_role: 'episodic' } });
  await fs.writeNote({ path: 'Memory/B.md', content: 'Intermediate superseded cause', frontmatter: { memory_role: 'semantic', memory_corrects: [{ path: 'Memory/A.md' }] } });
  await fs.writeNote({ path: 'Memory/C.md', content: 'Final revised cause', frontmatter: { memory_role: 'semantic', memory_corrects: [{ path: 'Memory/B.md' }] } });
  const reply = await call('memory.recall', { scope: 'global', query: 'chainneedle', semantic: false });
  expect(reply.text).toContain('Final revised cause'); expect(reply.text).not.toContain('Intermediate superseded cause');
});

test('standalone block anchors include their list context and revision-safe lines', async () => {
  await fs.writeNote({ path: 'Memory/Steps.md', content: '# Procedure\n\n- First inspect the mount\n- Then test polling\n\n^steps', frontmatter: {
    memory_entries: [{ role: 'procedural', block_id: 'steps' }],
  } });
  const reply = await call('memory.recall', { scope: 'global', query: 'polling', semantic: false, maxChars: 12000 });
  const item = reply.value.items.find((x: any) => x.path === 'Memory/Steps.md');
  expect(item.excerpt.text).toContain('First inspect'); expect(item.excerpt.text).toContain('Then test');
});

test('correction discovery is not limited to the first metadata page', async () => {
  await fs.writeNote({ path: 'Memory/000-old.md', content: 'longinventoryneedle obsolete', frontmatter: { memory_role: 'episodic' } });
  for (let i = 0; i < 500; i++) await fs.writeNote({ path: `Memory/middle-${String(i).padStart(4, '0')}.md`, content: 'Noise', frontmatter: { memory_role: 'episodic' } });
  await fs.writeNote({ path: 'Memory/zz-correction.md', content: 'Latest conclusion after full inventory', frontmatter: { memory_role: 'semantic', memory_corrects: [{ path: 'Memory/000-old.md' }] } });
  const reply = await call('memory.recall', { scope: 'global', query: 'longinventoryneedle', semantic: false });
  expect(reply.result.isError).not.toBe(true); expect(reply.text).toContain('Latest conclusion after full inventory');
  expect(reply.text).not.toContain('longinventoryneedle obsolete');
}, 20000);

test('more than twenty query matches can all be reached without false exhaustion', async () => {
  for (let i = 0; i < 23; i++) await fs.writeNote({ path: `Memory/Page-${i}.md`, content: 'paginationneedle observation', frontmatter: { memory_role: 'episodic' } });
  const paths = new Set<string>(); let cursor: any;
  for (let page = 0; page < 30; page++) {
    const reply = await call('memory.recall', { scope: 'global', query: 'paginationneedle', semantic: false, limit: 2, maxChars: 4000, ...(cursor && { cursor }) });
    expect(reply.result.isError).not.toBe(true);
    for (const item of reply.value.items) { expect(paths.has(item.path)).toBe(false); paths.add(item.path); }
    cursor = reply.value.nextCursor; if (!cursor) break;
  }
  expect(paths.size).toBe(23);
});

test('basis changes invalidate a paginated memory snapshot even for non-memory sources', async () => {
  await fs.writeNote({ path: 'Source.md', content: 'source v1' });
  const basis = await fs.readNote('Source.md');
  for (const name of ['One', 'Two']) await fs.writeNote({ path: `Memory/${name}.md`, content: 'basisneedle experience', frontmatter: { memory_role: 'semantic', memory_basis: [{ path: 'Source.md', revision: basis.revision }] } });
  const first = await call('memory.recall', { scope: 'global', query: 'basisneedle', semantic: false, limit: 1 });
  await fs.writeNote({ path: 'Source.md', content: 'source v2' });
  const next = await call('memory.recall', { scope: 'global', query: 'basisneedle', semantic: false, limit: 1, cursor: first.value.nextCursor });
  expect(next.result.isError).toBe(true); expect(next.text).toMatch(/snapshot changed/i);
});

test('correction cycles are reported as unresolved instead of no matching memory', async () => {
  await fs.writeNote({ path: 'Memory/CycleA.md', content: 'cycleneedle first interpretation', frontmatter: { memory_role: 'episodic', memory_corrects: [{ path: 'Memory/CycleB.md' }] } });
  await fs.writeNote({ path: 'Memory/CycleB.md', content: 'cycleneedle competing interpretation', frontmatter: { memory_role: 'episodic', memory_corrects: [{ path: 'Memory/CycleA.md' }] } });
  const reply = await call('memory.recall', { scope: 'global', query: 'cycleneedle', semantic: false });
  expect(reply.result.isError).not.toBe(true);
  expect(reply.value.status).toBe('partial');
  expect(reply.text).toMatch(/correction.*unresolved/i);
  expect(reply.value.nextAction.arguments.includeHistory).toBe(true);
});

test('path filtering does not conceal a correction outside the selected subfolder', async () => {
  await fs.writeNote({ path: 'Memory/Narrow/Old.md', content: 'prefixneedle obsolete advice', frontmatter: { memory_role: 'episodic' } });
  await fs.writeNote({ path: 'Memory/Elsewhere/New.md', content: 'Current different conclusion', frontmatter: { memory_role: 'semantic', memory_corrects: [{ path: 'Memory/Narrow/Old.md' }] } });
  const reply = await call('memory.recall', { scope: 'global', pathPrefix: 'Memory/Narrow', query: 'prefixneedle', semantic: false });
  expect(reply.result.isError).not.toBe(true);
  expect(reply.text).not.toContain('prefixneedle obsolete advice');
  expect(reply.value.status).toBe('partial');
  expect(reply.text).toMatch(/correction.*filter/i);
});

test('single-letter candidate false positives do not return unrelated experiences', async () => {
  const reply = await call('memory.recall', { scope: 'global', query: '가', semantic: false });
  expect(reply.result.isError).not.toBe(true); expect(reply.value.items).toEqual([]);
  expect(reply.text).not.toContain('polling worked');
});

test('source hydration is bounded to eight distinct documents per memory call', async () => {
  for (let i = 0; i < 12; i++) await fs.writeNote({ path: `Memory/Budget${i}.md`, content: 'hydrationneedle', frontmatter: { memory_role: 'episodic' } });
  const reads = vi.spyOn(FileSystemService.prototype, 'readNote');
  const reply = await call('memory.recall', { scope: 'global', query: 'hydrationneedle', semantic: false, limit: 100, maxChars: 12000 });
  expect(reply.result.isError).not.toBe(true);
  const paths = reads.mock.calls.map(args => args[0]).filter(path => path.startsWith('Memory/'));
  expect(paths.length).toBeLessThanOrEqual(8); expect(new Set(paths).size).toBe(paths.length);
  expect(reply.value.truncated).toBe(true); expect(reply.value.nextCursor).toBeDefined();
});

test('authentication revoked during a memory read prevents the private response', async () => {
  const login = await call('auth.register', { accountId: 'race-reader', agentId: 'race-reader', modelId: 'codex', userId: 'race-human', password: 'private-test-password' });
  const accessToken = login.value.accessToken;
  await fs.writeNote({ path: '_scopes/agents/race-reader/Private.md', content: 'sensitive_memory_race', frontmatter: { memory_role: 'episodic' } });
  const read = LayeredMemoryService.prototype.read;
  vi.spyOn(LayeredMemoryService.prototype, 'read').mockImplementationOnce(async function(this: LayeredMemoryService, ...args) {
    const result = await read.apply(this, args);
    await call('auth.logout', { accessToken });
    return result;
  });
  const result = await call('memory.recall', { query: 'sensitive_memory_race', semantic: false, accessToken });
  expect(result.result.isError).toBe(true); expect(result.text).not.toContain('sensitive_memory_race');
});

test('a source edited during hydration cannot return the stale excerpt', async () => {
  const original = FileSystemService.prototype.readNote; let changed = false;
  vi.spyOn(FileSystemService.prototype, 'readNote').mockImplementation(async function(this: FileSystemService, ...args) {
    const value = await original.apply(this, args);
    if (!changed && args[0] === 'Memory/NAS.md') {
      changed = true;
      await fs.writeNote({ path: 'Memory/NAS.md', content: 'New NAS interpretation', frontmatter: { memory_role: 'procedural' } });
    }
    return value;
  });
  const result = await call('memory.recall', { scope: 'global', query: 'NAS', semantic: false });
  expect(result.result.isError).toBe(true); expect(result.text).not.toContain('polling worked');
});

test('short-query false positives cannot redirect to an unrelated correction', async () => {
  await fs.writeNote({ path: 'Memory/Correction.md', content: 'This is unrelated to the requested character.', frontmatter: { memory_role: 'semantic', memory_corrects: [{ path: 'Memory/NAS.md' }] } });
  const result = await call('memory.recall', { scope: 'global', query: '가', semantic: false });
  expect(result.value.items).toEqual([]);
});

test('a long anchored block retains matches after its preview budget', async () => {
  await fs.writeNote({ path: 'Memory/Long.md', content: '- ' + 'background '.repeat(120) + '\n- uniquelateblock condition is unverified.\n\n^long-block', frontmatter: { memory_entries: [{ block_id: 'long-block', role: 'episodic' }] } });
  const result = await call('memory.recall', { scope: 'global', query: 'uniquelateblock', semantic: false });
  expect(result.value.items).toHaveLength(1);
  expect(result.value.items[0].excerpt.text).toContain('uniquelateblock');
});

test('a revision-qualified correction does not suppress a subsequently revised source', async () => {
  const old = await fs.readNote('Memory/NAS.md');
  await fs.writeNote({ path: 'Memory/Specific.md', content: 'Earlier conclusion was wrong', frontmatter: { memory_role: 'semantic', memory_corrects: [{ path: 'Memory/NAS.md', revision: old.revision }] } });
  await fs.writeNote({ path: 'Memory/NAS.md', content: 'NAS newly revised interpretation', frontmatter: { memory_role: 'procedural' } });
  const result = await call('memory.recall', { scope: 'global', query: 'NAS', semantic: false });
  expect(result.text).toContain('newly revised interpretation');
});

test('an unrelated terminal chain cannot hide a mixed correction cycle warning', async () => {
  for (const [name, target] of [['A', 'B'], ['B', 'A'], ['D', 'C']]) await fs.writeNote({ path: `Memory/Mixed${name}.md`, content: 'mixedneedle interpretation', frontmatter: { memory_role: 'episodic', memory_corrects: [{ path: `Memory/Mixed${target}.md` }] } });
  await fs.writeNote({ path: 'Memory/MixedC.md', content: 'mixedneedle earlier interpretation', frontmatter: { memory_role: 'episodic' } });
  const result = await call('memory.recall', { scope: 'global', query: 'mixedneedle', semantic: false, maxChars: 12000 });
  expect(result.text).toContain('MixedD.md'); expect(result.value.status).toBe('partial');
  expect(result.text).toMatch(/correction.*unresolved/i);
});

test('block-specific retrieval cues discover experience without matching its body', async () => {
  await fs.writeNote({ path: 'Memory/Cued.md', content: 'The fix only worked on this mount. ^cue', frontmatter: { memory_entries: [{ block_id: 'cue', role: 'episodic', retrieval_cues: ['cueneedleunique'] }] } });
  const result = await call('memory.recall', { scope: 'global', query: 'cueneedleunique', semantic: false });
  expect(result.value.items).toHaveLength(1); expect(result.text).toContain('only worked');
});

test('long correction chains confirm the matching origin without hydrating every intermediate', async () => {
  await fs.writeNote({ path: 'Memory/Chain0.md', content: 'chainoriginneedle old claim', frontmatter: { memory_role: 'episodic' } });
  for (let i = 1; i <= 8; i++) await fs.writeNote({ path: `Memory/Chain${i}.md`, content: `revised claim ${i}`, frontmatter: { memory_role: 'episodic', memory_corrects: [{ path: `Memory/Chain${i - 1}.md` }] } });
  const result = await call('memory.recall', { scope: 'global', query: 'chainoriginneedle', semantic: false, maxChars: 12000 });
  expect(result.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Memory/Chain8.md' })]));
});

test('standalone anchors preserve a loose list including conditions before blank lines', async () => {
  await fs.writeNote({ path: 'Memory/Loose.md', content: '- uniqueloosecondition applies\n\n- Other step\n\n^loose', frontmatter: { memory_entries: [{ block_id: 'loose', role: 'episodic' }] } });
  const result = await call('memory.recall', { scope: 'global', query: 'uniqueloosecondition', semantic: false });
  expect(result.text).toContain('uniqueloosecondition'); expect(result.text).toContain('Other step');
});

test('memory survives a server restart without a second memory store', async () => {
  const first = await call('memory.recall', { scope: 'global', query: 'NAS', semantic: false });
  await client.close(); await server.close();
  server = createServer(root, { version: 'restarted-memory-test', readOnly: true });
  client = new Client({ name: 'restarted-memory-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(ct), server.connect(st)]);
  const second = await call('memory.recall', { scope: 'global', query: 'NAS', semantic: false });
  expect(second.result.isError).not.toBe(true); expect(second.value.items).toEqual(first.value.items);
  const brief = await call('memory.brief', { scope: 'global', query: 'NAS', semantic: false });
  const comparison = await call('memory.consolidate', { scope: 'global', query: 'NAS', semantic: false });
  expect(brief.result.isError).not.toBe(true); expect(comparison.result.isError).not.toBe(true);
  expect((await client.listTools()).tools).toHaveLength(5);
});

test('a semantic eligibility change invalidates continuation even with unchanged source order', async () => {
  await fs.writeNote({ path: 'Memory/Other.md', content: 'NAS second memory', frontmatter: { memory_role: 'episodic' } });
  const results = await Promise.all(['Memory/NAS.md', 'Memory/Other.md'].map(async path => ({ p: path, t: path, ex: '', mc: 0, rv: (await fs.readNote(path)).revision })));
  const outcome = { results, usedQuery: 'NAS', expanded: false, semantic: { state: 'available' as const }, complete: true };
  vi.spyOn(RetrievalService.prototype, 'memoryCandidates').mockResolvedValueOnce(outcome).mockResolvedValueOnce({ ...outcome, results: results.map(hit => ({ ...hit, vs: true })) });
  const first = await call('memory.recall', { scope: 'global', query: 'NAS', limit: 1 });
  const next = await call('memory.recall', { scope: 'global', query: 'NAS', limit: 1, cursor: first.value.nextCursor });
  expect(next.result.isError).toBe(true); expect(next.text).toMatch(/snapshot changed/i);
});
