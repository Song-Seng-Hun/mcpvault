import { expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtemp, mkdir, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const parse = (result: any) => JSON.parse(result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(''));
test('built CLI preserves, publishes, rereads and restores through its actual local processor', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'compilation-local-cli-')));
  const vault = join(root, 'Vault'), host = join(root, 'Host'), configPath = join(host, 'compilation.json');
  let client: Client | undefined;
  const password = randomUUID(), raw = '# Prepare\r\nKeep conditions. 승인 required.\r\n## Recover\r\nNever overwrite user edits.\r\n';
  const config = { version: 1, enabled: true, accountId: 'operator', vaultPath: vault, projects: [{ id: 'p', ruleVersion: 'v1',
    sources: [{ path: 'Manual.md', classification: 'resolved', mode: 'synthesis_allowed' }], outputPaths: ['Draft.md'],
    operations: ['index'], runtimeIds: ['builtin-verbatim-v1'], chapterBundles: [{ documentPath: 'Manual.md',
      documentId: '9cac42de-e32d-41e2-8370-df5f19d3b19c', chapterRoot: 'Chapters', processing: 'verbatim', publication: 'verbatim' }] }] };
  try {
    await mkdir(vault); await mkdir(host, { mode: 0o700 });
    if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [host, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    await writeFile(join(vault, 'Manual.md'), raw);
    await mkdir(join(vault, '_wiki', '_policies'), { recursive: true });
    const policyPath = join(vault, '_wiki', '_policies', 'documents.md');
    await writeFile(policyPath, '---\ntype: protected-document-policy\nversion: 1\nrules: [{path: Manual.md, accountIds: [operator]}]\n---\n');
    const connect = async (readOnly = false) => {
      client = new Client({ name: 'compilation-local-cli-test', version: '1' });
      const transport = new StdioClientTransport({ command: process.execPath,
        args: [resolve('dist/server.js'), vault, '--compilation-config', configPath, ...(readOnly ? ['--read-only'] : [])],
        cwd: process.cwd(), stderr: 'pipe', env: Object.fromEntries(['SystemRoot', 'TEMP', 'TMP', 'PATH'].flatMap(k => process.env[k] ? [[k, process.env[k]!]] : [])) });
      transport.stderr?.on('data', () => undefined);
      await client.connect(transport);
    };
    await connect();
    const invoke = (endpointId: string, args: Record<string, unknown>, token?: string) => client!.callTool({ name: 'call_endpoint',
      arguments: { endpointId, arguments: args, ...(token && { accessToken: token }) } });
    const registered = await invoke('auth.register', { accountId: 'operator', modelId: 'codex', userId: 'fixture', agentId: 'worker', password });
    expect(registered.isError).toBeFalsy(); let token = parse(registered).accessToken;
    const call = (args: Record<string, unknown>, auth = token) => invoke('wiki.compilation', { kind: 'document_bundle', ...args }, auth);
    const prepared = await call({ op: 'prepare', projectId: 'p', requestId: 'prepare', documentPath: 'Manual.md', expectedDocumentRevision: createHash('sha256').update(raw).digest('hex') });
    expect(prepared.isError, JSON.stringify(prepared.content)).toBeFalsy(); const bundle = parse(prepared);
    expect(bundle).toMatchObject({ status: 'source_preserved', generationAllowed: false });
    const basis = { bundleId: bundle.bundleId, expectedJobRevision: bundle.jobRevision };
    expect((await call({ ...basis, op: 'submit', requestId: 'forged-generation', content: 'Unverified.' })).isError).toBe(true);
    const previewed = await call({ ...basis, op: 'split_preview' }); expect(previewed.isError).toBeFalsy(); const preview = parse(previewed);
    expect(preview.status).toBe('ready');
    const appliedResult = await call({ ...basis, op: 'split_apply', requestId: 'apply', fingerprint: preview.fingerprint, expectedPublicationRevision: 'missing' });
    expect(appliedResult.isError, JSON.stringify(appliedResult.content)).toBeFalsy(); const applied = parse(appliedResult);
    expect(applied.status).toBe('applied'); expect(applied.effectVerified).toBe(false);
    for (const chapter of preview.outputs) {
      expect((await invoke('notes.read', { path: chapter.path })).isError).toBe(true);
      expect((await invoke('notes.read', { path: chapter.path }, token)).isError).toBeFalsy();
    }
    await client!.close(); await connect();
    const login = await invoke('auth.login', { accountId: 'operator', password }); expect(login.isError).toBeFalsy(); token = parse(login).accessToken;
    const historical = await call({ ...basis, op: 'read', projection: 'original' }); expect(historical.isError).toBeFalsy(); expect(parse(historical).part.text).toBe(raw);
    const restoredResult = await call({ ...basis, op: 'split_revert', requestId: 'restore', fingerprint: preview.fingerprint, expectedPublicationRevision: applied.publicationRevision });
    expect(restoredResult.isError, JSON.stringify(restoredResult.content)).toBeFalsy(); expect(parse(restoredResult).status).toBe('withdrawn');
    expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toBe(raw);
    for (const chapter of preview.outputs) expect((await invoke('notes.read', { path: chapter.path }, token)).isError).toBe(true);
    await client!.close(); await connect(true);
    const relogin = await invoke('auth.login', { accountId: 'operator', password }); expect(relogin.isError).toBeFalsy(); token = parse(relogin).accessToken;
    expect((await call({ ...basis, op: 'split_apply', requestId: 'denied', fingerprint: preview.fingerprint, expectedPublicationRevision: parse(restoredResult).publicationRevision })).isError).toBe(true);
    expect(parse(await call({ ...basis, op: 'read', projection: 'original' })).part.text).toBe(raw);
    await writeFile(policyPath, '---\ntype: protected-document-policy\nversion: 1\nrules: [{path: Manual.md, accountIds: [another]}]\n---\n');
    const denied = await call({ ...basis, op: 'read', projection: 'original' }); expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).not.toContain('Keep conditions');
    expect((await client!.listTools()).tools).toHaveLength(16);
  } finally { await client?.close(); await rm(root, { recursive: true, force: true }); }
}, 120000);
