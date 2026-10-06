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
  registry.setTools([tool('resolve_skill'), tool('read_note')], {}, new Set());
  const ownerActivity = { policyFingerprint: 'a'.repeat(64), executionBindingGeneration: 'b'.repeat(32), eligibility: {
    'skill-evolution': { discover: false, read: false, claim: false, execute: false },
  } } as NonNullable<EndpointAvailabilityContext['ownerActivity']>;
  const current = context({ ownerActivity, skillEvolutionEnabled: true });
  expect(registry.list('skill.resolve', 1, 20000, current, false).endpoints[0]).toMatchObject({
    available: false, state: 'locked', reason: 'owner consent required',
  });
  expect(registry.list(undefined, 100, 20000, current, true).endpoints.map(item => item.endpointId))
    .toEqual(['notes.read']);
});

test('owner consent never flips a parent lock or disabled mixed operation to ready', () => {
  const registry = new EndpointRegistry();
  registry.setTools([{ ...tool('manage_skill_candidate'), inputSchema: { type: 'object', properties: { op: { enum: ['read', 'promote'] } } } }],
    { manage_skill_candidate: 'write' }, new Set(['manage_skill_candidate']));
  const current = context({ readOnly: true, ownerActivity: {
    policyFingerprint: 'a'.repeat(64), executionBindingGeneration: 'b'.repeat(32),
    eligibility: { 'skill-evolution': { discover: true, read: true, claim: true, execute: true } },
  } });
  const endpoint = registry.list('skill.candidate', 1, 20000, current, false).endpoints[0]!;
  expect(endpoint.operations?.read).toMatchObject({ available: true, state: 'ready' });
  expect(endpoint.operations?.promote).toMatchObject({ available: false, state: 'disabled' });
  expect(endpoint).toMatchObject({ available: true, state: 'ready' });
  expect(registry.list('skill.candidate', 1, 20000, current, true).endpoints.map(item => item.endpointId)).toEqual(['skill.candidate']);
});

test('unregistered raw operation labels cannot downgrade owner activity while registered claim aliases remain claims', () => {
  expect(ownerActionForEndpointTool('record_skill_experience', true, 'list')).toBe('execute');
  expect(ownerActionForEndpointTool('record_skill_experience', true, 'search')).toBe('execute');
  expect(ownerActionForEndpointTool('claim_work_task', true, 'release')).toBe('claim');
});

test('registered list operations require discover consent while their registered reads require read consent', () => {
  expect(ownerActionForEndpointTool('manage_skill_candidate', true, 'list')).toBe('discover');
  expect(ownerActionForEndpointTool('manage_skill_candidate', true, 'read')).toBe('read');
});

test('owner consent cannot revive host-disabled operations projected from a mixed endpoint', () => {
  const registry = new EndpointRegistry();
  registry.setTools([
    { ...tool('manage_skill_candidate'), inputSchema: { type: 'object', properties: { op: { enum: ['read', 'promote'] } } } },
  ], { manage_skill_candidate: 'write' }, new Set(['manage_skill_candidate']));
  const ownerActivity = { policyFingerprint: 'a'.repeat(64), executionBindingGeneration: 'b'.repeat(32), eligibility: {
    'skill-evolution': { discover: true, read: true, claim: true, execute: true },
  } } as NonNullable<EndpointAvailabilityContext['ownerActivity']>;
  const current = context({ authenticated: true, capabilities: new Set(['write']),
    skillEvolutionEnabled: false, ownerActivity });

  const skill = registry.list('skill.candidate', 1, 20000, current, false).endpoints[0]!;
  expect(skill).toMatchObject({ available: false, state: 'disabled' });
  expect(skill.operations!.read).toMatchObject({ available: false, state: 'disabled' });
  expect(skill.operations!.promote).toMatchObject({ available: false, state: 'disabled' });
});

test('warm catalogs recompute host availability and mixed-operation read permissions', () => {
  const registry = new EndpointRegistry();
  registry.setTools([
    tool('one'), tool('promote_skill'),
    { ...tool('manage_work_group'), inputSchema: { type: 'object', properties: { op: { enum: ['read', 'join'] } } } },
  ], { promote_skill: 'write', manage_work_group: 'task' }, new Set(['promote_skill', 'manage_work_group']));
  const current = context({ authenticated: true, capabilities: new Set(['write', 'task']), skillEvolutionEnabled: true });
  const first = compact(registry, current);
  current.skillEvolutionEnabled = false;
  current.readOnly = true;
  current.authenticated = false;
  expect(() => compact(registry, current, first.nextCursor)).toThrow(/cursor/i);
  const action = registry.list('skill.promote', 1, 2000, current, false).endpoints[0]!;
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

test('fixed control tools stay excluded while exact IDs and routes still resolve', () => {
  const registry = new EndpointRegistry();
  const controls = ['orient_wiki', 'get_agent_pulse', 'list_active_capabilities', 'search_capabilities', 'call_endpoint'];
  registry.setTools([...controls, 'write_note', 'read_note', 'update_task'].map(tool), {}, new Set(['write_note', 'update_task']));
  compact(registry);
  expect(registry.size()).toBe(3);
  for (const name of controls) expect(registry.resolve(`mcp.${name}`)).toBeUndefined();
  expect(registry.list('notes.write', 1, 2000, context(), false).endpoints[0]!.endpointId).toBe('notes.write');
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

const wireBytes = (value: unknown) => Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }] }), 'utf8');

test('exact descriptor queries browse the whole descriptor without hijacking exact IDs', () => {
  const registry = new EndpointRegistry();
  registry.setTools([{ ...tool('branch_tool'), inputSchema: { type: 'object', properties: { branch: { type: 'object', properties: { leaf: { type: 'string' } } } } } }], {}, new Set());
  const root = registry.list('mcp.branch_tool#', 1, 2000, context(), false);
  expect(root.endpoints[0]!.endpointId).toBe('mcp.branch_tool');
  expect(root.descriptorPage).toMatchObject({ path: '', kind: 'object', value: expect.objectContaining({ input: expect.any(Object) }) });
  expect(registry.list('mcp.branch_tool', 1, 2000, context(), false).endpoints[0]!.input).toBeDefined();
  const leaf = registry.list('mcp.branch_tool#/input/properties/branch/properties/leaf/type', 1, 2000, context(), false);
  expect(leaf.descriptorPage).toMatchObject({ path: '/input/properties/branch/properties/leaf/type', kind: 'string', value: 'string' });
});

test('descriptor pointers preserve encoded names and long Unicode strings as typed fragments', () => {
  const registry = new EndpointRegistry();
  const long = '한글😀'.repeat(2000) + '\uD800';
  registry.setTools([{ ...tool('unicode_tool'), inputSchema: { type: 'object', properties: { 'a/b~x': { type: 'string', description: long } } } }], {}, new Set());
  const encoded = registry.list('mcp.unicode_tool#/input/properties/a~1b~0x/type', 1, 2000, context(), false);
  expect(encoded.descriptorPage?.value).toBe('string');
  const fragment = registry.list('mcp.unicode_tool#/input/properties/a~1b~0x/description', 1, 512, context(), false);
  expect(fragment.descriptorPage?.value).toMatchObject({ type: 'string-fragment', offset: 0, total: long.length });
  expect((fragment.descriptorPage?.value as any).text.length).toBeLessThan(long.length);
  expect(wireBytes(fragment)).toBeLessThanOrEqual(512);
  let cursor = fragment.nextCursor;
  let offset = 0;
  let restored = '';
  for (let page = fragment; ; page = registry.list('mcp.unicode_tool#/input/properties/a~1b~0x/description', 1, 512, context(), false, { cursor })) {
    const value = page.descriptorPage?.value as any;
    expect(value.type).toBe('string-fragment');
    expect(value.offset).toBe(offset);
    expect(value.text.length).toBeGreaterThan(0);
    expect(wireBytes(page)).toBeLessThanOrEqual(512);
    offset += value.text.length;
    restored += value.text;
    expect(/[\uD800-\uDBFF]/.test(long[offset - 1]!) && /[\uDC00-\uDFFF]/.test(long[offset] ?? '')).toBe(false);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  expect(offset).toBe(long.length);
  expect(restored).toBe(long);
});

test('descriptor child pages are complete, byte-bounded and cursor-bound', () => {
  const registry = new EndpointRegistry();
  const properties = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`field${i}`, { type: 'string', description: 'x'.repeat(80) }]));
  registry.setTools([{ ...tool('paged_tool'), inputSchema: { type: 'object', properties } }], {}, new Set());
  const query = 'mcp.paged_tool#/input/properties';
  const seen: string[] = []; let page = registry.list(query, 5, 512, context(), false);
  for (;;) {
    expect(wireBytes(page)).toBeLessThanOrEqual(512);
    for (const entry of page.descriptorPage?.entries ?? []) seen.push(entry.path);
    if (!page.nextCursor) break;
    page = registry.list(query, 5, 512, context(), false, { cursor: page.nextCursor });
  }
  expect(seen).toHaveLength(81);
  expect(new Set(seen).size).toBe(81);
  const first = registry.list(query, 5, 512, context(), false);
  expect(() => registry.list(query, 5, 512, context({ principalKey: 'changed' }), false, { cursor: first.nextCursor })).toThrow(/cursor/i);
  const scalar = registry.list('mcp.paged_tool#/input/properties/field0/type', 1, 512, context(), false);
  expect(scalar.descriptorPage?.value).toBe('string');
  expect(() => registry.list('mcp.paged_tool#/input/properties/field0/type', 1, 512, context(), false, { cursor: first.nextCursor })).toThrow(/cursor/i);
});

test('descriptor cursors reject malformed, stale-generation and changed-descriptor state', () => {
  const registry = new EndpointRegistry();
  const inputSchema = { type: 'object', properties: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`field${i}`, { type: 'string' }])) };
  registry.setTools([{ ...tool('cursor_tool'), inputSchema }], {}, new Set());
  const query = 'mcp.cursor_tool#/input/properties';
  const first = registry.list(query, 2, 512, context(), false);
  expect(first.nextCursor).toBeTruthy();
  for (const cursor of ['bad', 'x'.repeat(257), Buffer.from(JSON.stringify({ o: -1 })).toString('base64url')])
    expect(() => registry.list(query, 2, 512, context(), false, { cursor })).toThrow(/cursor/i);
  registry.setTools([{ ...tool('cursor_tool'), inputSchema: { type: 'object', properties: { changed: { type: 'boolean' } } } }], {}, new Set());
  expect(() => registry.list(query, 2, 512, context(), false, { cursor: first.nextCursor })).toThrow(/cursor/i);
});
