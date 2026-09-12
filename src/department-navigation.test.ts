import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, getServerRuntime } from './createServer.js';
import { EnterpriseRegistry } from './enterprise-registry.js';
import { withEnterpriseRequestContext } from './enterprise-request-context.js';
import { FileSystemService } from './filesystem.js';

const disposers: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of disposers.splice(0).reverse()) await close(); });
const cert = 'b'.repeat(64);
async function fixture(extraDocuments = 0) {
  const root = await mkdtemp(join(tmpdir(), 'department-navigation-'));
  disposers.push(() => rm(root, { recursive: true, force: true }));
  const vaultPath = join(root, 'vault'); await mkdir(vaultPath);
  for (const name of ['A-company', 'B-engineering', 'C-engineering', 'D-sales', 'E-cross', 'F-confidential', 'G-claimed']) {
    await writeFile(join(vaultPath, `${name}.md`), `---\ndepartment: engineering\n---\n# ${name}\n`);
  }
  await mkdir(join(vaultPath, 'Engineering'));
  const extraPaths = Array.from({ length: extraDocuments }, (_, i) => `Engineering/Item-${String(i).padStart(3, '0')}.md`);
  for (const path of extraPaths) await writeFile(join(vaultPath, path), '# Department note');
  const registryPath = join(root, 'private/registry.json');
  const registry = new EnterpriseRegistry({ registryPath, vaultPath });
  await registry.initialize({ mode: 'company', realmId: 'acme', vaultPath });
  await registry.createEmployee({ userId: 'employee', sharedMemoryEnabled: false });
  await registry.updateEmployeeDepartments({ userId: 'employee', departmentIds: ['engineering'], defaultDepartmentId: 'engineering', expectedDepartmentRevision: 0 });
  await registry.registerRuntime({ runtimeId: 'local', kind: 'internal', certFingerprint: cert });
  const binding = { accountId: 'worker', agentId: 'worker', modelId: 'codex', userId: 'employee', runtimeId: 'local' };
  const secretFile = join(root, 'private/invite.txt');
  await registry.createInvite({ binding, expiresAt: new Date(Date.now() + 60000).toISOString(), secretFile });
  const server = createServer(vaultPath, { enterpriseRegistryPath: registryPath, documentRules: () => [
    { path: 'B-engineering.md', realmId: 'acme', departmentIds: ['engineering'] },
    { path: 'C-engineering.md', realmId: 'acme', departmentIds: ['engineering'] },
    { path: 'D-sales.md', realmId: 'acme', departmentIds: ['sales'] },
    { path: 'E-cross.md', realmId: 'acme', departmentIds: ['engineering', 'sales'] },
    { path: 'F-confidential.md', realmId: 'acme', departmentIds: ['engineering'], confidential: true },
    ...extraPaths.map(path => ({ path, realmId: 'acme', departmentIds: ['engineering'] })),
  ] });
  disposers.push(() => server.close());
  const runtime = getServerRuntime(server)!;
  let accessToken: string | undefined;
  const call = async (endpoint: string, args: Record<string, unknown> = {}) => {
    const result = await withEnterpriseRequestContext({ transport: 'http', certFingerprint: cert }, () =>
      endpoint === 'orient_wiki' ? runtime.dispatchTool(endpoint, { accessToken, ...args })
        : runtime.dispatchTool('call_endpoint', { endpointId: endpoint === 'notes.query' ? 'mcp.query_notes' : endpoint, arguments: { accessToken, ...args } }));
    return { result, text: result.content[0].text, value: result.isError ? undefined : JSON.parse(result.content[0].text) };
  };
  const registered = await call('auth.register', { ...binding, password: 'department-fixture-password', sessionId: 'session', invitationToken: (await readFile(secretFile, 'utf8')).trim() });
  expect(registered.result.isError, registered.text).not.toBe(true);
  accessToken = registered.value.accessToken;
  return { call, registry };
}

test('orientation offers verified default department navigation without replacing its primary action', async () => {
  const { call } = await fixture();
  const oriented = await call('orient_wiki');
  expect(oriented.result.isError, oriented.text).not.toBe(true);
  expect(oriented.value.defaultNavigation).toMatchObject({ departmentId: 'engineering', basis: 'administrator_verified',
    action: { endpointId: 'mcp.query_notes', arguments: { department: 'default', includeContent: false, includeTotal: false } } });
  expect(oriented.value.primaryAction.tool).toBe('get_agent_pulse');
});

test('department selection precedes pagination and counts and grants no confidential or claimed access', async () => {
  const { call } = await fixture();
  for (const includeTotal of [false, true]) {
    const page = await call('notes.query', { department: 'default', limit: 1, includeTotal, maxChars: 512 });
    expect(page.result.isError, page.text).not.toBe(true);
    expect(page.text.length).toBeLessThanOrEqual(512);
    expect(page.value.notes.map((note: any) => note.path)).toEqual(['B-engineering.md']);
    expect(page.value.total).toBe(includeTotal ? 3 : -1);
    expect(page.value.nextCursor.context).toMatch(/^[a-f0-9]{64}$/);
    const second = await call('notes.query', { department: 'default', limit: 2, includeTotal, after: page.value.nextCursor });
    expect(second.result.isError, second.text).not.toBe(true);
    expect(second.value.notes.map((note: any) => note.path)).toEqual(['C-engineering.md', 'E-cross.md']);
    expect(second.value.total).toBe(includeTotal ? 3 : -1);
    expect(second.text).not.toMatch(/D-sales|F-confidential|G-claimed/);
  }
  const company = await call('notes.query', { includeTotal: false });
  expect(company.value.notes.map((note: any) => note.path)).toContain('A-company.md');
  expect((await call('notes.query', { department: 'sales' })).result.isError).toBe(true);
});

test('department cursors reject selection, filter and verified membership drift', async () => {
  const { call, registry } = await fixture();
  const first = await call('notes.query', { department: 'default', limit: 1, includeTotal: false });
  expect(first.result.isError, first.text).not.toBe(true);
  const after = first.value.nextCursor;
  expect((await call('notes.query', { after })).result.isError).toBe(true);
  expect((await call('notes.query', { department: 'default', after, filters: { department: 'engineering' } })).result.isError).toBe(true);
  await registry.updateEmployeeDepartments({ userId: 'employee', departmentIds: ['sales'], defaultDepartmentId: 'sales', expectedDepartmentRevision: 1 });
  expect((await call('notes.query', { department: 'default', after })).result.isError).toBe(true);
  const current = await call('notes.query', { department: 'default', includeTotal: false });
  expect(current.result.isError, current.text).not.toBe(true);
  expect(current.value.notes.map((note: any) => note.path)).toEqual(['D-sales.md', 'E-cross.md']);
  expect((await call('orient_wiki')).value.defaultNavigation.departmentId).toBe('sales');
});

test('revoked default membership removes the navigation hint and refuses a client-supplied claim', async () => {
  const { call, registry } = await fixture();
  await registry.updateEmployeeDepartments({ userId: 'employee', departmentIds: [], expectedDepartmentRevision: 1 });
  expect((await call('orient_wiki')).value).not.toHaveProperty('defaultNavigation');
  const query = await call('notes.query', { department: 'default', departmentId: 'engineering', defaultDepartmentId: 'engineering' });
  expect(query.result.isError, query.text).toBe(true);
  expect(query.text).not.toMatch(/B-engineering|F-confidential/);
});

test('one-row department pages do not observe every protected source during discovery', async () => {
  const { call } = await fixture(33);
  const page = await call('notes.query', { department: 'default', limit: 1, includeTotal: false, pathPrefix: 'Engineering' });
  expect(page.result.isError, page.text).not.toBe(true);
  expect(page.value.notes.map((note: any) => note.path)).toEqual(['Engineering/Item-000.md']);
  expect(page.value.totalKnown).toBe(false);
  expect(page.value.truncated).toBe(true);
  const reverse = await call('notes.query', { department: 'default', limit: 1, includeTotal: false, pathPrefix: 'Engineering', sortOrder: 'desc' });
  expect(reverse.result.isError, reverse.text).not.toBe(true);
  expect(reverse.value.notes[0].path).toBe('Engineering/Item-032.md');
  const next = await call('notes.query', { department: 'default', limit: 1, includeTotal: false, pathPrefix: 'Engineering', sortOrder: 'desc', after: reverse.value.nextCursor });
  expect(next.result.isError, next.text).not.toBe(true);
  expect(next.value.notes[0].path).toBe('Engineering/Item-031.md');
});

test('delivered department metadata still records protected source lineage for subsequent writes', async () => {
  const { call } = await fixture();
  const page = await call('notes.query', { department: 'default', limit: 1, includeTotal: false });
  expect(page.result.isError, page.text).not.toBe(true);
  const write = await call('notes.write', { path: 'scope://agent/worker/Derived.md', content: 'Department-derived interpretation', expectedRevision: 'missing' });
  expect(write.result.isError).toBe(true);
  expect(write.text).toMatch(/Persist source classifications before creating protected derivatives/);
});

test('membership revoked after physical department metadata read suppresses the outgoing page', async () => {
  const { call, registry } = await fixture();
  const read = FileSystemService.prototype.readNoteMetadata;
  let revoked = false;
  vi.spyOn(FileSystemService.prototype, 'readNoteMetadata').mockImplementation(async function(this: FileSystemService, ...args) {
    const result = await read.apply(this, args);
    if (!revoked && result.some(note => note.path === 'B-engineering.md')) {
      revoked = true;
      await registry.updateEmployeeDepartments({ userId: 'employee', departmentIds: [], expectedDepartmentRevision: 1 });
    }
    return result;
  });
  const page = await call('notes.query', { department: 'default', limit: 1, includeTotal: false });
  expect(revoked).toBe(true);
  expect(page.result.isError, page.text).toBe(true);
  expect(page.text).not.toMatch(/B-engineering|C-engineering/);
});
