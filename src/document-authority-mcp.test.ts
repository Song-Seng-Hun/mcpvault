import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, getServerRuntime } from '../tests/server-fixture.js';
import { startRestApi } from './rest-api.js';
import { FileSystemService } from './filesystem.js';
import type { DocumentAuthorityOptions } from './document-authority.js';
import { VaultIoCoordinator } from './vault-io.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { withEnterpriseStorageContext } from './enterprise-storage-context.js';
import { PathFilter } from './pathfilter.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture(options?: DocumentAuthorityOptions) {
  const root = await mkdtemp(join(tmpdir(), 'document-authority-mcp-')); cleanups.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'Private-payroll.md'), '# PRIVATE_TITLE\n\nPRIVATE_BODY unique-confidential-needle');
  await writeFile(join(root, 'Public.md'), '# Public\n\npublic needle');
  const server = createServer(root, options ?? { documentRules: () => [{ path: 'Private-payroll.md', confidential: true }] });
  cleanups.push(() => server.close());
  const runtime = getServerRuntime(server)!;
  const call = async (endpointId: string, args: Record<string, unknown> = {}) => runtime.dispatchTool('call_endpoint', { endpointId, arguments: args });
  return { server, call, root };
}

const protectedPolicy = (rules: unknown[]) => `---\ntype: protected-document-policy\nversion: 1\nrules: ${JSON.stringify(rules)}\n---\n# Protected document policies\n`;
async function persistPolicy(root: string, rules: unknown[]) {
  await mkdir(join(root, '_wiki', '_policies'), { recursive: true });
  await writeFile(join(root, '_wiki', '_policies', 'documents.md'), protectedPolicy(rules));
}

test('the protected Markdown policy is applied without a caller-supplied policy option', async () => {
  const { call, root } = await fixture({});
  await persistPolicy(root, [{ path: 'Private-payroll.md', confidential: true }]);
  const response = await call('notes.read', { path: 'Private-payroll.md', maxChars: 2000 });
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toMatch(/PRIVATE_TITLE|PRIVATE_BODY/);
});

test('protected metadata cannot be listed, exported, or edited by generic note operations', async () => {
  const { root } = await fixture({});
  await persistPolicy(root, [{ path: 'Private-payroll.md', confidential: true }]);
  const path = '_wiki/_policies/documents.md', filter = new PathFilter();
  expect(filter.isAllowed(path)).toBe(false);
  expect(filter.isAllowedForListing(path)).toBe(false);
  const fs = new FileSystemService(root);
  await expect(fs.readNote(path)).rejects.toThrow(/restricted|denied/i);
  await expect(fs.writeNote({ path, content: protectedPolicy([]), overwrite: true })).rejects.toThrow(/restricted|denied/i);
});

test('policy corruption or disappearance cannot turn existing protected data public', async () => {
  const { call, root } = await fixture({});
  await persistPolicy(root, [{ path: 'Private-payroll.md', confidential: true }]);
  await call('notes.read', { path: 'Public.md' });
  await writeFile(join(root, '_wiki', '_policies', 'documents.md'), 'broken policy');
  expect((await call('notes.read', { path: 'Private-payroll.md' })).isError).toBe(true);
  await rm(join(root, '_wiki', '_policies', 'documents.md'));
  expect((await call('notes.read', { path: 'Private-payroll.md' })).isError).toBe(true);
});

test('NAS policy edits after physical read invalidate the outgoing response', async () => {
  const { call, root } = await fixture({});
  await persistPolicy(root, []);
  const readNote = FileSystemService.prototype.readNote;
  vi.spyOn(FileSystemService.prototype, 'readNote').mockImplementation(async function(this: FileSystemService, path, maxBytes) {
    const note = await readNote.call(this, path, maxBytes);
    if (path === 'Private-payroll.md') await persistPolicy(root, [{ path, confidential: true }]);
    return note;
  });
  const response = await call('notes.read', { path: 'Private-payroll.md', maxChars: 2000 });
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toMatch(/PRIVATE_TITLE|PRIVATE_BODY/);
});

test('a local session cannot publish knowledge from confidential reads without inherited restrictions', async () => {
  const { call, root } = await fixture({ localInferenceAllowed: () => true });
  await persistPolicy(root, [{ path: 'Private-payroll.md', confidential: true }]);
  const registered = await call('auth.register', { accountId: 'local-worker', userId: 'local-owner', agentId: 'local-agent', modelId: 'local-model', password: 'local-test-password-123' });
  expect(registered.isError, JSON.stringify(registered)).not.toBe(true);
  const accessToken = JSON.parse(registered.content[0].text).accessToken;
  const input = await call('notes.read', { path: 'Private-payroll.md', accessToken });
  expect(input.isError).not.toBe(true);
  const write = await call('notes.write', { path: 'Derived.md', content: 'PRIVATE_BODY distilled knowledge', expectedRevision: 'missing', accessToken });
  expect(write.isError, JSON.stringify(write)).not.toBe(true);
  const external = await call('notes.read', { path: 'Derived.md' });
  expect(external.isError).toBe(true);
  expect(JSON.stringify(external)).not.toContain('PRIVATE_BODY');
  expect(await readFile(join(root, '_wiki', '_policies', 'documents.md'), 'utf8')).toMatch(/derived\.md/i);
  expect(await readFile(join(root, 'Private-payroll.md'), 'utf8')).toContain('PRIVATE_BODY unique-confidential-needle');
});

test('revoked local admission cannot modify derivative metadata or read confidential audit targets', async () => {
  let local = true;
  const { call, root } = await fixture({ localInferenceAllowed: () => local });
  await persistPolicy(root, [{ path: 'Private-payroll.md', confidential: true }]);
  const registered = await call('auth.register', { accountId: 'local-worker', userId: 'local-owner', agentId: 'local-agent', modelId: 'local-model', password: 'local-test-password-123' });
  const accessToken = JSON.parse(registered.content[0].text).accessToken;
  expect((await call('notes.read', { path: 'Private-payroll.md', accessToken })).isError).not.toBe(true);
  const before = await readFile(join(root, '_wiki', '_policies', 'documents.md'), 'utf8');
  local = false;
  expect((await call('notes.write', { path: 'Derived.md', content: 'PRIVATE_BODY', expectedRevision: 'missing', accessToken })).isError).toBe(true);
  expect(await readFile(join(root, '_wiki', '_policies', 'documents.md'), 'utf8')).toBe(before);
  const audit = await call('mcp.list_audit_events', { accessToken, includeErrors: true, maxChars: 4000 });
  expect(audit.isError, JSON.stringify(audit)).not.toBe(true);
  expect(JSON.stringify(audit)).not.toContain('Private-payroll');
});

test('source-linked Wiki publishing automatically inherits the evidence policy before validation and write', async () => {
  const { call, root } = await fixture({ localInferenceAllowed: () => true });
  const registered = await call('auth.register', { accountId: 'local-worker', userId: 'local-owner', agentId: 'local-agent', modelId: 'local-model', password: 'local-test-password-123' });
  const accessToken = JSON.parse(registered.content[0].text).accessToken;
  const captured = await call('mcp.ingest_source', { sourceId: 'protected-evidence', title: 'Evidence', content: '# Evidence\n\nPRIVATE_BODY', capturedBy: 'local-agent', accessToken });
  expect(captured.isError, JSON.stringify(captured)).not.toBe(true);
  const source = JSON.parse(captured.content[0].text).path;
  await persistPolicy(root, [{ path: source, confidential: true }]);
  const written = await call('mcp.publish_knowledge', { path: 'Knowledge/Protected.md', content: '# Interpretation\n\nPRIVATE_BODY distilled.', evidencePaths: [source], status: 'draft', expectedRevision: 'missing', accessToken });
  expect(written.isError, JSON.stringify(written)).not.toBe(true);
  const external = await call('notes.read', { path: 'Knowledge/Protected.md' });
  expect(external.isError).toBe(true);
  expect(JSON.stringify(external)).not.toContain('PRIVATE_BODY');
});

test('MCP raw, parsed and original-export paths all refuse confidential documents for unverified callers', async () => {
  const { call } = await fixture();
  for (const endpointId of ['notes.read', 'documents.read', 'documents.outline', 'resources.export', 'resources.manifest']) {
    const response = await call(endpointId, { path: 'Private-payroll.md', maxChars: 2000 });
    expect(response.isError, endpointId).toBe(true);
    expect(JSON.stringify(response), endpointId).not.toMatch(/PRIVATE_TITLE|PRIVATE_BODY/);
  }
});

test('a policy change after physical read suppresses the entire outgoing response', async () => {
  let rules: any[] = [];
  const { call } = await fixture({ documentRules: () => rules });
  const readNote = FileSystemService.prototype.readNote;
  vi.spyOn(FileSystemService.prototype, 'readNote').mockImplementation(async function(this: FileSystemService, path, maxBytes) {
    const note = await readNote.call(this, path, maxBytes);
    if (path === 'Private-payroll.md') rules = [{ path, confidential: true }];
    return note;
  });
  const response = await call('notes.read', { path: 'Private-payroll.md', maxChars: 2000 });
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toMatch(/PRIVATE_TITLE|PRIVATE_BODY/);
});

test('physical IO rechecks confidentiality after its awaited reader completes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'document-authority-io-')); cleanups.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'Secret.md'), '# Confidential');
  let revoked = false;
  const access = new ScopeAccessPolicy({ documentRules: () => [{ path: 'Secret.md', confidential: revoked }] });
  const io = new VaultIoCoordinator({ reader: async () => { revoked = true; return '# Confidential'; } });
  const fs = new FileSystemService(root, undefined, undefined, undefined, undefined, undefined, io);
  await expect(withEnterpriseStorageContext({ access, assertFresh: () => {} }, () => fs.readNote('Secret.md'))).rejects.toThrow(/protected|denied/i);
});

test('ordinary note search and listing cannot reveal confidential names, counts or snippets', async () => {
  const { call } = await fixture();
  for (const [endpointId, args] of [['wiki.search', { query: 'needle' }], ['documents.search', { query: 'unique-confidential-needle' }]] as const) {
    const response = await call(endpointId, { ...args, maxChars: 4000 });
    expect(response.isError, endpointId).not.toBe(true);
    expect(JSON.stringify(response), endpointId).not.toMatch(/Private-payroll|PRIVATE_TITLE|PRIVATE_BODY/);
  }
});

test('REST shares the same confidential document rejection boundary', async () => {
  const { server } = await fixture(); const api = await startRestApi(server, { port: 0 }); cleanups.push(() => api.close());
  for (const endpointId of ['notes.read', 'documents.read', 'resources.export']) {
    const response = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/${endpointId}?path=Private-payroll.md&maxChars=1500`);
    expect(response.status, endpointId).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toMatch(/PRIVATE_TITLE|PRIVATE_BODY/);
  }
});
