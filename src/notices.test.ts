import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import { FileSystemService } from './filesystem.js';
import { NoticeRegistry, NoticeService } from './notices.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(readOnly = false) {
  const root = await mkdtemp(join(tmpdir(), 'notice-test-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const vault = join(root, 'vault'); await mkdir(vault); await mkdir(join(vault, 'Guides'));
  await writeFile(join(vault, 'Guides/Welcome.md'), '# Welcome\nOriginal conditions.\n');
  const configPath = join(root, 'notices.json');
  const policy = { version: 1, vaultPath: vault, notices: [{ id: 'welcome', path: 'Guides/Welcome.md', title: 'Welcome', priority: 100, topics: ['onboarding'], editors: ['editor'] }] };
  await writeFile(configPath, JSON.stringify(policy));
  const server = createServer(vault, { noticeConfigPath: configPath, readOnly } as any); cleanup.push(() => server.close());
  const client = new Client({ name: 'notice-test', version: '1' }); cleanup.push(() => client.close());
  const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(a), server.connect(b)]);
  const call = async (endpointId: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
    const raw = (result.content as any[])[0].text;
    return { error: Boolean(result.isError), value: result.isError ? raw : JSON.parse(raw) };
  };
  const tokens: Record<string, string> = {};
  for (const id of ['editor', 'reader']) {
    const r = await call('auth.register', { accountId: id, agentId: id, modelId: 'codex', userId: id, password: 'isolated-notice-test-password' });
    tokens[id] = r.value.accessToken;
  }
  return { call, tokens, vault, policy, configPath, client };
}

test('registered notices route onboarding and reject generic body/property/delete/ancestor mutations', async () => {
  const { call, tokens, vault, client } = await fixture();
  expect((await client.listTools()).tools).toHaveLength(5);
  const read = await call('notice.read', { id: 'welcome' });
  expect(read.error).toBe(false);
  expect(read.value.content).toContain('Original conditions');
  const orientation = await client.callTool({ name: 'orient_wiki', arguments: {} });
  expect(JSON.parse((orientation.content as any[])[0].text).primaryAction.endpointId).toBe('notice.read');
  const raw = await call('notes.write', { path: 'Guides/Welcome.md', content: 'stolen', expectedRevision: read.value.revision, accessToken: tokens.editor });
  expect(raw.error).toBe(true);
  expect(raw.value).toMatch(/notice/i);
  const patch = await call('notes.patch', { path: 'Guides/Welcome.md', oldString: 'Original', newString: 'Forged', expectedRevision: read.value.revision, accessToken: tokens.editor });
  expect(patch.error).toBe(true);
  expect(await readFile(join(vault, 'Guides/Welcome.md'), 'utf8')).toContain('Original conditions');
});

test('preview fingerprints bind authorized content, revision and current delegation; only one competing edit succeeds', async () => {
  const { call, tokens, configPath, policy } = await fixture();
  const read = await call('notice.read', { id: 'welcome' });
  expect(read.error).toBe(false);
  const input = { id: 'welcome', content: '# Welcome\nUpdated conditions.', reason: 'Clarify conditions', expectedRevision: read.value.revision, accessToken: tokens.editor };
  expect((await call('notice.preview', { ...input, accessToken: tokens.reader })).error).toBe(true);
  const preview = await call('notice.preview', input); expect(preview.error).toBe(false);
  expect((await call('notice.revise', { ...input, content: 'tampered', fingerprint: preview.value.fingerprint })).error).toBe(true);
  const writes = await Promise.all([1, 2].map(() => call('notice.revise', { ...input, fingerprint: preview.value.fingerprint })));
  expect(writes.filter(r => !r.error)).toHaveLength(1);
  const current = await call('notice.read', { id: 'welcome' }); expect(current.value.content).toContain('Updated conditions');
  const next = { ...input, expectedRevision: current.value.revision, content: 'Revoked edit' };
  const nextPreview = await call('notice.preview', next);
  policy.notices[0]!.editors = [];
  await writeFile(configPath, JSON.stringify(policy));
  expect((await call('notice.revise', { ...next, fingerprint: nextPreview.value.fingerprint })).error).toBe(true);
});

test('notice feedback uses exact notice revision instead of a fake source-code path', async () => {
  const { call, tokens } = await fixture();
  const read = await call('notice.read', { id: 'welcome' }); expect(read.error).toBe(false);
  const proposal = { slug: 'welcome-feedback', title: 'Clarify welcome', content: 'The instructions need an example.', category: 'feedback', noticeId: 'welcome', noticeRevision: read.value.revision, proposedChange: 'Add an example.', expectedRevision: 'missing', accessToken: tokens.reader };
  const post = await call('community.post', proposal); expect(post.error).toBe(false);
  expect(post.value.noticeId).toBe('welcome');
  expect((await call('community.post', { ...proposal, slug: 'stale-feedback', noticeRevision: '0'.repeat(64) })).error).toBe(true);
});

test('notice reads respect response budget and read-only mode denies even delegated edits', async () => {
  const { call, tokens, vault } = await fixture(true);
  await writeFile(join(vault, 'Guides/Welcome.md'), '가'.repeat(9000));
  const r = await call('notice.read', { id: 'welcome', maxChars: 1000 });
  expect(r.error).toBe(false); expect(JSON.stringify(r.value).length).toBeLessThanOrEqual(1000);
  expect(r.value.truncated).toBe(true); expect(r.value.nextAction.arguments.expectedRevision).toBe(r.value.revision);
  expect((await call('notice.revise', { id: 'welcome', content: 'bad', reason: 'test', expectedRevision: r.value.revision, fingerprint: 'x', accessToken: tokens.editor })).error).toBe(true);
});

test('all filesystem entry points and ancestor moves preserve protected originals', async () => {
  const { vault, configPath } = await fixture();
  const registry = new NoticeRegistry(vault, configPath);
  const fs = new FileSystemService(vault, undefined, undefined, undefined, undefined, undefined, undefined, undefined, path => registry.assertMutation(path));
  const path = 'Guides/Welcome.md', revision = (await fs.readNote(path)).revision;
  await expect(fs.updateFrontmatter({ path, frontmatter: { notice: false }, expectedRevision: revision })).rejects.toThrow(/notice/i);
  await expect(fs.deleteNote({ path, confirmPath: path, expectedRevision: revision, permanent: true } as any)).rejects.toThrow(/notice/i);
  await expect(fs.moveFile({ oldPath: 'Guides', newPath: 'Moved', confirmOldPath: 'Guides', confirmNewPath: 'Moved' } as any)).rejects.toThrow(/notice/i);
  expect((await fs.readNote(path)).revision).toBe(revision);
  await fs.writeNote({ path: 'Normal.md', content: 'notice: true does not grant official status' });
});

test('priority receipts skip unchanged notices and updated revisions resurface within the whole budget', async () => {
  const { client, call, vault } = await fixture();
  const first = await call('notice.read', { id: 'welcome' });
  const pulse = async (args: any) => JSON.parse(((await client.callTool({ name: 'get_agent_pulse', arguments: args })).content as any[])[0].text);
  const pending = await pulse({ maxChars: 512 });
  expect(JSON.stringify(pending).length).toBeLessThanOrEqual(512);
  expect(pending.primaryAction.endpointId).toBe('notice.read');
  const known = await call('notice.list', { knownRevisions: { welcome: first.value.revision } }); expect(known.value.notices).toHaveLength(0);
  await writeFile(join(vault, 'Guides/Welcome.md'), '# Changed by host');
  const changed = await pulse({ knownNoticeRevisions: { welcome: first.value.revision }, maxChars: 512 });
  expect(changed.primaryAction.endpointId).toBe('notice.read');
  expect(changed.primaryAction.arguments.expectedRevision).not.toBe(first.value.revision);
});

test('approved feedback is revision-linked in both notice and proposal reads', async () => {
  const { call, tokens } = await fixture();
  const original = await call('notice.read', { id: 'welcome' });
  const proposal = await call('community.post', { slug: 'example', title: 'Add example', content: 'An example clarifies the rule.', category: 'feedback', noticeId: 'welcome', noticeRevision: original.value.revision, proposedChange: 'Add example.', expectedRevision: 'missing', accessToken: tokens.reader });
  const args = { id: 'welcome', content: '# Welcome\nOriginal conditions. Example here.', reason: 'Adopt proposed example', expectedRevision: original.value.revision, feedbackPath: proposal.value.path, feedbackRevision: proposal.value.revision, accessToken: tokens.editor };
  const preview = await call('notice.preview', args); expect(preview.error).toBe(false);
  const changed = await call('notice.revise', { ...args, fingerprint: preview.value.fingerprint }); expect(changed.error).toBe(false);
  const post = await call('community.post_read', { slug: 'example' });
  expect(post.error).toBe(false);
  expect(post.value.noticeReview).toMatchObject({ decision: 'adopted', noticeRevision: changed.value.revision });
  const notice = await call('notice.read', { id: 'welcome' });
  expect(notice.value.reviews[0]).toMatchObject({ path: proposal.value.path, revision: proposal.value.revision, decision: 'adopted' });
});

test('hidden registrations never leak through list, priority, or feedback; broken config fails closed', async () => {
  const { call, configPath, policy, vault, tokens } = await fixture();
  await mkdir(join(vault, '_scopes/agents/private'), { recursive: true });
  await writeFile(join(vault, '_scopes/agents/private/Hidden.md'), '# Hidden');
  policy.notices.push({ id: 'secret', path: '_scopes/agents/private/Hidden.md', title: 'Do not leak', priority: 100, topics: ['onboarding'], editors: ['editor'] });
  await writeFile(configPath, JSON.stringify(policy));
  const listed = await call('notice.list'); expect(listed.error).toBe(false); expect(JSON.stringify(listed.value)).not.toMatch(/secret|Hidden|Do not leak/);
  expect((await call('notice.read', { id: 'secret', accessToken: tokens.reader })).error).toBe(true);
  await writeFile(configPath, '{broken');
  const raw = await call('notes.write', { path: 'Guides/Welcome.md', content: 'bypass broken registry', accessToken: tokens.editor });
  expect(raw.error).toBe(true);
  expect(await readFile(join(vault, 'Guides/Welcome.md'), 'utf8')).toContain('Original conditions');
});

test('deferred proposals can be explicitly reconsidered without requiring their author to rewrite history', async () => {
  const { call, tokens } = await fixture();
  const original = await call('notice.read', { id: 'welcome' });
  const proposal = await call('community.post', { slug: 'later', title: 'Later improvement', content: 'Please add an example.', category: 'feedback', noticeId: 'welcome', noticeRevision: original.value.revision, proposedChange: 'Example.', expectedRevision: 'missing', accessToken: tokens.reader });
  const defer = { id: 'welcome', decision: 'deferred', reason: 'Need more context', expectedRevision: original.value.revision, feedbackPath: proposal.value.path, feedbackRevision: proposal.value.revision, accessToken: tokens.editor };
  const p = await call('notice.preview', defer); expect(p.error).toBe(false);
  const held = await call('notice.revise', { ...defer, fingerprint: p.value.fingerprint }); expect(held.error).toBe(false);
  const adopt = { ...defer, decision: 'adopted', content: '# Welcome\nOriginal conditions. Example.', reason: 'Reviewed against current wording', expectedRevision: held.value.revision };
  expect((await call('notice.preview', adopt)).error).toBe(true);
  const rebased = await call('notice.preview', { ...adopt, rebaseFeedback: true }); expect(rebased.error).toBe(false);
  const done = await call('notice.revise', { ...adopt, rebaseFeedback: true, fingerprint: rebased.value.fingerprint }); expect(done.error).toBe(false);
  expect((await call('community.post_read', { slug: 'later' })).value.noticeReview.decision).toBe('adopted');
});

test('authority revoked during final preparation never commits a notice', async () => {
  const { vault, configPath } = await fixture();
  const registry = new NoticeRegistry(vault, configPath), access = new ScopeAccessPolicy();
  const fs = new FileSystemService(vault, undefined, undefined, undefined, undefined, undefined, undefined, access, path => registry.assertMutation(path));
  const service = new NoticeService(registry, fs, access, new ReferenceService(fs, access));
  const principal = { accountId: 'editor', modelId: 'codex', agentId: 'editor', role: 'agent' as const };
  const current = await fs.readNote('Guides/Welcome.md');
  const input = { id: 'welcome', content: '# Changed', expectedRevision: current.revision, reason: 'Test race' };
  const p = await service.preview(input, principal);
  let valid = true, checks = 0;
  await expect(service.revise({ ...input, fingerprint: p.fingerprint }, principal, async () => {
    // Authority can be revoked at the final awaited boundary; the synchronous
    // dispatch check must still reject it before touching the original file.
    if (++checks === 6) valid = false;
  }, () => { if (!valid) throw new Error('Revoked session'); })).rejects.toThrow(/Revoked/);
  expect((await fs.readNote('Guides/Welcome.md')).revision).toBe(current.revision);
});

test('shared enterprise guidance may receive feedback, but personal guidance may not', async () => {
  const { vault, configPath } = await fixture();
  const registry = new NoticeRegistry(vault, configPath);
  const access = new ScopeAccessPolicy({ commandCenterId: 'office', enterprise: { mode: 'company', realmId: 'office' } });
  const fs = new FileSystemService(vault);
  const service = new NoticeService(registry, fs, access, new ReferenceService(fs, access));
  const principal = { accountId: 'editor', modelId: 'codex', agentId: 'editor', userId: 'host', commandCenterId: 'office', role: 'agent' as const, enterprise: { mode: 'company' as const, realmId: 'office', runtimeId: 'local', sharedMemoryEnabled: false } };
  const revision = (await fs.readNote('Guides/Welcome.md')).revision;
  expect(await service.feedback('welcome', revision, principal)).toMatchObject({ noticeId: 'welcome' });
  await expect(service.feedback('welcome', revision)).rejects.toThrow(/unavailable/);
});

test('unregistering a notice at final dispatch invalidates an in-flight editor grant', async () => {
  const { vault, configPath, policy } = await fixture();
  const registry = new NoticeRegistry(vault, configPath);
  const fs = new FileSystemService(vault, undefined, undefined, undefined, undefined, undefined, undefined, undefined, path => registry.assertMutation(path));
  const access = new ScopeAccessPolicy();
  const service = new NoticeService(registry, fs, access, new ReferenceService(fs, access));
  const principal = { accountId: 'editor', modelId: 'codex', agentId: 'editor', role: 'agent' as const };
  const current = await fs.readNote('Guides/Welcome.md');
  const input = { id: 'welcome', content: '# Late edit', expectedRevision: current.revision, reason: 'Test unregister race' };
  const preview = await service.preview(input, principal);
  let checks = 0;
  await expect(service.revise({ ...input, fingerprint: preview.fingerprint }, principal, async () => {
    if (++checks === 6) await writeFile(configPath, JSON.stringify({ ...policy, notices: [] }));
  }, () => {})).rejects.toThrow(/notice|authority|policy/i);
  expect((await fs.readNote('Guides/Welcome.md')).revision).toBe(current.revision);
});
