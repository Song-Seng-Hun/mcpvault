import { expect, test } from 'vitest';
import type { Tool } from '@modelcontextprotocol/server';
import { EndpointRegistry, operationReadAlias, ownerActionForEndpointTool, type EndpointAvailabilityContext } from './endpoint-registry.js';

const context = (extra: Partial<EndpointAvailabilityContext> = {}): EndpointAvailabilityContext => ({
  readOnly: false, authenticated: false, capabilities: new Set(), ...extra,
});
const tool = (name: string): Tool => ({ name, description: 'Catalog entry', inputSchema: { type: 'object' } });
const compact = (registry: EndpointRegistry, current = context(), cursor?: string) =>
  registry.list(undefined, 1, 512, current, false, { compact: true, cursor });

test('small compact pages serialize static schemas once per registration generation', () => {
  let schemaReads = 0;
  const tools = Array.from({ length: 40 }, (_, index): Tool => ({
    ...tool(`entry_${String(index).padStart(2, '0')}`),
    inputSchema: { type: 'object', properties: { payload: {
      type: 'string', get description() { schemaReads++; return 'stable schema sentinel '.repeat(100); },
    } } },
  }));
  const registry = new EndpointRegistry();
  registry.setTools(tools, {}, new Set());
  const first = compact(registry);
  const coldReads = schemaReads;
  expect(coldReads).toBe(tools.length);
  expect(first.nextCursor).toBeTruthy();
  const second = compact(registry, context(), first.nextCursor);
  expect(second.endpoints[0]!.endpointId).toBe('mcp.entry_01');
  expect(compact(registry)).toEqual(first);
  compact(registry, context({ principalKey: 'another-session', authenticated: true }));
  registry.list('entry', 1, 512, context(), true, { compact: true });
  expect(schemaReads - coldReads).toBe(0);

  registry.setTools(tools, {}, new Set());
  compact(registry);
  expect(schemaReads - coldReads).toBe(tools.length);
  const refreshedReads = schemaReads;
  compact(registry);
  expect(schemaReads).toBe(refreshedReads);
});

test('re-registering an identical catalog invalidates the previous generation cursor', () => {
  const registry = new EndpointRegistry();
  const tools = [tool('one'), tool('two')];
  registry.setTools(tools, {}, new Set());
  const first = compact(registry);
  expect(first.nextCursor).toBeTruthy();
  registry.setTools(tools, {}, new Set());
  expect(() => compact(registry, context(), first.nextCursor)).toThrow(/cursor/i);
  expect(compact(registry).nextCursor).not.toBe(first.nextCursor);
});

test('re-registration refreshes a changed schema with unchanged endpoint IDs', () => {
  const registry = new EndpointRegistry();
  const tools = [tool('one'), tool('two')];
  registry.setTools(tools, {}, new Set());
  const first = compact(registry);
  tools[0]!.inputSchema = { type: 'object', properties: { revision: { const: 'new' } } };
  registry.setTools(tools, {}, new Set());
  expect(() => compact(registry, context(), first.nextCursor)).toThrow(/cursor/i);
  expect(registry.list('mcp.one', 1, 20000, context(), false).endpoints[0]!.input.properties)
    .toMatchObject({ revision: { const: 'new' } });
});

const changedContexts: Array<[string, Partial<EndpointAvailabilityContext>]> = [
  ['readOnly', { readOnly: true }],
  ['authentication', { authenticated: true }],
  ['principal', { principalKey: 'different-principal' }],
  ['capabilities', { capabilities: new Set(['write']) }],
  ['skill configuration', { skillEvolutionEnabled: false }],
  ['roleplay configuration', { roleplayConfigured: false }],
  ['roleplay write configuration', { roleplayWritesConfigured: false }],
  ['economy configuration', { economyConfigured: false }],
  ['explanations configuration', { explanationsConfigured: false }],
  ['benchmarks configuration', { benchmarksConfigured: false }],
];
test.each(changedContexts)('a warm catalog rejects a cursor after changing %s', (_name, change) => {
  const registry = new EndpointRegistry();
  registry.setTools([tool('one'), tool('two')], {}, new Set());
  const first = compact(registry);
  expect(first.nextCursor).toBeTruthy();
  expect(() => compact(registry, context(change), first.nextCursor)).toThrow(/cursor/i);
});

test('capability ordering is deterministic but mutating the same capability set revokes a cursor', () => {
  const registry = new EndpointRegistry();
  registry.setTools([tool('one'), tool('two')], { two: 'write' }, new Set(['two']));
  const current = context({ authenticated: true, capabilities: new Set(['write', 'task']) });
  const first = compact(registry, current);
  expect(compact(registry, context({ ...current, capabilities: new Set(['task', 'write']) }))).toEqual(first);
  current.capabilities.delete('write');
  expect(() => compact(registry, current, first.nextCursor)).toThrow(/cursor/i);
  expect(registry.list('mcp.two', 1, 2000, current, false).endpoints[0]).toMatchObject({ available: false, state: 'locked' });
  expect(registry.list(undefined, 100, 2000, current, true, { compact: true }).endpoints.map(item => item.endpointId)).toEqual(['mcp.one']);
});

test('owner consent locks optional schemas and active-only listings exclude them', () => {
  const registry = new EndpointRegistry();
  registry.setTools([tool('list_blog_posts'), tool('read_note')], {}, new Set());
  const ownerActivity = { policyFingerprint: 'a'.repeat(64), executionBindingGeneration: 'b'.repeat(32), eligibility: {
    collaboration: { discover: false, read: false, claim: false, execute: false },
  } } as NonNullable<EndpointAvailabilityContext['ownerActivity']>;
  const current = context({ ownerActivity });
  expect(registry.list('community.posts', 1, 20000, current, false).endpoints[0]).toMatchObject({
    available: false, state: 'locked', reason: 'owner consent required',
  });
  expect(registry.list(undefined, 100, 20000, current, true).endpoints.map(item => item.endpointId))
    .toEqual(['notes.read']);
});

test('owner consent never flips a parent lock or disabled mixed operation to ready', () => {
  const registry = new EndpointRegistry();
  registry.setTools([{ ...tool('manage_roleplay_world'), inputSchema: { type: 'object', properties: { op: { enum: ['read', 'create'] } } } }],
    { manage_roleplay_world: 'write' }, new Set(['manage_roleplay_world']));
  const current = context({ readOnly: true, roleplayConfigured: true, ownerActivity: {
    policyFingerprint: 'a'.repeat(64), executionBindingGeneration: 'b'.repeat(32),
    eligibility: { roleplay: { discover: true, read: true, claim: true, execute: true } },
  } });
  const endpoint = registry.list('roleplay.world', 1, 20000, current, false).endpoints[0]!;
  expect(endpoint.operations?.read).toMatchObject({ available: true, state: 'ready' });
  expect(endpoint.operations?.create).toMatchObject({ available: false, state: 'disabled' });
  expect(endpoint).toMatchObject({ available: true, state: 'ready' });
  expect(registry.list('roleplay.world', 1, 20000, current, true).endpoints.map(item => item.endpointId)).toEqual(['roleplay.world']);
});

test('unregistered raw operation labels cannot downgrade owner activity while registered claim aliases remain claims', () => {
  expect(ownerActionForEndpointTool('publish_blog_post', true, 'list')).toBe('execute');
  expect(ownerActionForEndpointTool('publish_blog_post', true, 'search')).toBe('execute');
  expect(ownerActionForEndpointTool('manage_quest_contract', true, 'claim')).toBe('claim');
  expect(ownerActionForEndpointTool('claim_work_task', true, 'release')).toBe('claim');
});

test('registered list operations require discover consent while their registered reads require read consent', () => {
  expect(ownerActionForEndpointTool('manage_skill_candidate', true, 'list')).toBe('discover');
  expect(ownerActionForEndpointTool('manage_skill_candidate', true, 'read')).toBe('read');
  expect(ownerActionForEndpointTool('manage_roleplay_evolution', true, 'list')).toBe('discover');
  expect(ownerActionForEndpointTool('manage_roleplay_evolution', true, 'read')).toBe('read');
});

test('owner consent cannot revive host-disabled operations projected from a mixed endpoint', () => {
  const registry = new EndpointRegistry();
  registry.setTools([
    { ...tool('manage_roleplay_world'), inputSchema: { type: 'object', properties: { op: { enum: ['read', 'create'] } } } },
    { ...tool('manage_skill_candidate'), inputSchema: { type: 'object', properties: { op: { enum: ['read', 'promote'] } } } },
  ], { manage_roleplay_world: 'chat', manage_skill_candidate: 'write' }, new Set(['manage_roleplay_world', 'manage_skill_candidate']));
  const ownerActivity = { policyFingerprint: 'a'.repeat(64), executionBindingGeneration: 'b'.repeat(32), eligibility: {
    roleplay: { discover: true, read: true, claim: true, execute: true },
    'skill-evolution': { discover: true, read: true, claim: true, execute: true },
  } } as NonNullable<EndpointAvailabilityContext['ownerActivity']>;
  const current = context({ authenticated: true, capabilities: new Set(['chat', 'write']), roleplayConfigured: false,
    skillEvolutionEnabled: false, ownerActivity });

  const roleplay = registry.list('roleplay.world', 1, 20000, current, false).endpoints[0]!;
  expect(roleplay).toMatchObject({ available: false, state: 'disabled' });
  expect(roleplay.operations!.read).toMatchObject({ available: false, state: 'disabled' });
  expect(roleplay.operations!.create).toMatchObject({ available: false, state: 'disabled' });
  const skill = registry.list('skill.candidate', 1, 20000, current, false).endpoints[0]!;
  expect(skill).toMatchObject({ available: false, state: 'disabled' });
  expect(skill.operations!.read).toMatchObject({ available: false, state: 'disabled' });
  expect(skill.operations!.promote).toMatchObject({ available: false, state: 'disabled' });
});

test('warm catalogs recompute host availability and mixed-operation read permissions', () => {
  const registry = new EndpointRegistry();
  registry.setTools([
    tool('one'), tool('submit_roleplay_action'),
    { ...tool('manage_work_group'), inputSchema: { type: 'object', properties: { op: { enum: ['read', 'join'] } } } },
  ], { submit_roleplay_action: 'chat', manage_work_group: 'task' }, new Set(['submit_roleplay_action', 'manage_work_group']));
  const current = context({ authenticated: true, capabilities: new Set(['chat', 'task']), roleplayConfigured: true, roleplayWritesConfigured: true });
  const first = compact(registry, current);
  current.roleplayWritesConfigured = false;
  current.readOnly = true;
  current.authenticated = false;
  expect(() => compact(registry, current, first.nextCursor)).toThrow(/cursor/i);
  const action = registry.list('roleplay.action', 1, 2000, current, false).endpoints[0]!;
  expect(action).toMatchObject({ available: false, state: 'disabled' });
  const group = registry.list('work.group', 1, 2000, current, false).endpoints[0]!;
  expect(group.operations!.read).toMatchObject({ available: true, state: 'ready' });
  expect(group.operations!.join).toMatchObject({ available: false, state: 'disabled' });
  expect(operationReadAlias('manage_work_group', 'read')).toBe('read_work_group');
  expect(operationReadAlias('manage_work_group', 'join')).toBeUndefined();
});

test.each([512, 2000])('warm compact pagination remains bounded and deterministic at %i characters', maxChars => {
  const registry = new EndpointRegistry();
  const tools = Array.from({ length: 12 }, (_, index) => ({ ...tool(`entry_${String(index).padStart(2, '0')}`), description: '\n"\\'.repeat(200) }));
  registry.setTools([...tools].reverse(), {}, new Set());
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < tools.length; page++) {
    const result = registry.list(undefined, 3, maxChars, context(), false, { compact: true, cursor });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(maxChars);
    expect(result.endpoints.length).toBeGreaterThan(0);
    expect(result.total).toBe(tools.length);
    expect(result.truncated).toBe(Boolean(result.nextCursor));
    seen.push(...result.endpoints.map(item => item.endpointId));
    for (const item of result.endpoints) expect(item.input).toBeUndefined();
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  expect(cursor).toBeUndefined();
  expect(seen).toEqual(tools.map(item => `mcp.${item.name}`));
});

test('search and active-only cursors remain bound to their request after warming', () => {
  const registry = new EndpointRegistry();
  registry.setTools([tool('entry_one'), tool('entry_two'), tool('other')], {}, new Set());
  const result = registry.list('entry', 1, 2000, context(), false, { compact: true });
  expect(result.nextCursor).toBeTruthy();
  expect(() => registry.list('other', 1, 2000, context(), false, { compact: true, cursor: result.nextCursor })).toThrow(/cursor/i);
  expect(() => registry.list('entry', 1, 2000, context(), true, { compact: true, cursor: result.nextCursor })).toThrow(/cursor/i);
  expect(registry.list(' ENTRY ', 1, 2000, context(), false, { compact: true, cursor: result.nextCursor }).endpoints[0]!.endpointId).toBe('mcp.entry_two');
});

test('fixed control tools stay excluded while exact IDs, legacy aliases and routes still resolve', () => {
  const registry = new EndpointRegistry();
  const controls = ['orient_wiki', 'get_agent_pulse', 'list_active_capabilities', 'search_capabilities', 'call_endpoint'];
  registry.setTools([...controls, 'publish_blog_post', 'read_note', 'update_task'].map(tool), {}, new Set(['publish_blog_post', 'update_task']));
  compact(registry);
  expect(registry.size()).toBe(3);
  for (const name of controls) expect(registry.resolve(`mcp.${name}`)).toBeUndefined();
  expect(registry.list('create discussion', 1, 2000, context(), false).endpoints[0]!.endpointId).toBe('community.post');
  expect(registry.list('please show `notes.read`', 1, 2000, context(), false).endpoints[0]!.input).toBeDefined();
  expect(registry.resolveRoute('POST', '/api/notes/tasks')!.endpoint.endpointId).toBe('notes.task_update');
  expect(registry.resolveRoute('GET', '/api/notes/folder/note.md')!.pathArguments).toEqual({ path: 'folder/note.md' });
});

test('warm catalogs still reject malformed and out-of-range cursors', () => {
  const registry = new EndpointRegistry();
  registry.setTools([tool('one'), tool('two')], {}, new Set());
  const first = compact(registry);
  const decoded = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8'));
  for (const cursor of ['bad', 'x'.repeat(257), ...[-1, 0.5, 2].map(o => Buffer.from(JSON.stringify({ ...decoded, o })).toString('base64url'))]) {
    expect(() => compact(registry, context(), cursor)).toThrow(/cursor/i);
  }
});
