import { expect, test } from 'vitest';
import { mkdtemp, mkdir, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import { loadCompilationHostConfig } from './compilation-host.js';

const parse = (result: any) => JSON.parse(result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(''));
test.each(['source_only', 'synthesis_allowed'])('MCP bundle%s preserves source and permits bounded read-only projections', async mode => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bundle-mcp-'))), vault = join(root, 'Vault'), hostPath = join(root, 'Host');
  let server: ReturnType<typeof createServer> | undefined, client: Client | undefined;
  try {
    await mkdir(vault); await mkdir(hostPath, { mode: 0o700 });
    if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [hostPath, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
    await mkdir(join(vault, '_wiki', '_policies'), { recursive: true });
    await writeFile(join(vault, '_wiki', '_policies', 'documents.md'), '---\ntype: protected-document-policy\nversion: 1\nrules:\n  - path: Manual.md\n    accountIds: [operator]\n---\n');
    const raw = '# Approval\r\nOnly approved edits. 승인 required. 😀\r\n', revision = createHash('sha256').update(raw).digest('hex');
    await writeFile(join(vault, 'Manual.md'), raw);
    const path = join(hostPath, 'compilation.json');
    await writeFile(path, JSON.stringify({ version: 1, enabled: true, accountId: 'operator', vaultPath: vault,
      projects: [{ id: 'p', ruleVersion: 'v1', sources: [{ path: 'Manual.md', mode, classification: 'resolved' }],
        outputPaths: ['Draft.md'], operations: ['index', 'synthesize'], runtimeIds: ['local'],
        chapterBundles: [{ documentPath: 'Manual.md', documentId: '9cac42de-e32d-41e2-8370-df5f19d3b19c', chapterRoot: 'Chapters' }] }] }));
    const connect = async (readOnly: boolean) => {
      server = createServer(vault, { readOnly, compilation: { host: await loadCompilationHostConfig(path, vault),
        runtime: async () => ({ id: 'local', revision: 'v1', local: true, operations: ['index', 'synthesize'] }) } });
      client = new Client({ name: 'bundle-mcp-test', version: '1' });
      const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(ct), server.connect(st)]);
    };
    await connect(false);
    const password = randomUUID();
    const account = parse(await client!.callTool({ name: 'call_endpoint', arguments: { endpointId: 'auth.register', arguments: {
      accountId: 'operator', modelId: 'codex', userId: 'fixture', agentId: 'worker', password } } }));
    const call = (args: Record<string, unknown>, token = account.accessToken) => client!.callTool({ name: 'call_endpoint',
      arguments: { endpointId: 'wiki.compilation', accessToken: token, arguments: { kind: 'document_bundle', ...args } } });
    const prepared = await call({ op: 'prepare', requestId: 'one', projectId: 'p', documentPath: 'Manual.md', expectedDocumentRevision: revision });
    expect(prepared.isError, JSON.stringify(prepared.content)).toBeFalsy();
    const bundle = parse(prepared);
    expect(bundle).toMatchObject({ status: 'source_preserved', generationAllowed: mode === 'synthesis_allowed', automaticApplication: false });
    let candidateRead: Record<string, unknown> | undefined;
    if (mode === 'synthesis_allowed') {
      const planned = await call({ op: 'read', projection: 'plan', bundleId: bundle.bundleId, expectedJobRevision: bundle.jobRevision });
      expect(planned.isError, JSON.stringify(planned.content)).toBeFalsy(); const plan = parse(planned);
      const saved = await call({ op: 'submit', bundleId: bundle.bundleId, expectedJobRevision: bundle.jobRevision, expectedPlanRevision: plan.planRevision,
        chapterId: plan.items[0].chapterId, requestId: 'chapter-one', content: 'Only approved edits. 승인 required. 😀\nExample: review before changing.\n',
        metadata: { title: 'Approval', description: 'Approval requirements.', kind: 'manual', domain: 'software', useWhen: 'Editing.',
          avoidWhen: 'Read only.', stage: 'execute', aliases: ['승인'], prerequisites: [], tools: [], counterexamples: [] } });
      expect(saved.isError, JSON.stringify(saved.content)).toBeFalsy(); expect(parse(saved).semantic).toBe('not_assessed');
      candidateRead = { op: 'read', projection: 'candidate', bundleId: bundle.bundleId, chapterId: plan.items[0].chapterId,
        expectedJobRevision: bundle.jobRevision, expectedPlanRevision: plan.planRevision, expectedCandidateRevision: parse(saved).candidateRevision };
    }
    await client!.close(); await server!.close(); await connect(true);
    const login = await client!.callTool({ name: 'call_endpoint', arguments: { endpointId: 'auth.login', arguments: { accountId: 'operator', password } } });
    expect(login.isError, JSON.stringify(login.content)).toBeFalsy(); account.accessToken = parse(login).accessToken;
    const readArgs = { op: 'read', bundleId: bundle.bundleId, projection: 'original', expectedJobRevision: bundle.jobRevision };
    const result = await call(readArgs);
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy(); expect(parse(result).part.text).toBe(raw);
    if (candidateRead) {
      const candidate = await call(candidateRead); expect(candidate.isError, JSON.stringify(candidate.content)).toBeFalsy();
      expect(parse(candidate).part.text).toContain('Only approved edits. 승인 required. 😀');
    }
    expect((await client!.listTools()).tools).toHaveLength(5);
    for (const op of ['prepare', 'submit', 'check', 'retry']) expect((await call({ op, requestId: 'denied' })).isError).toBe(true);
    const anonymous = await call(readArgs, '');
    expect(anonymous.isError).toBe(true); expect(JSON.stringify(anonymous)).not.toContain('승인 required');
    expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toBe(raw);
    await writeFile(join(vault, '_wiki', '_policies', 'documents.md'), '---\ntype: protected-document-policy\nversion: 1\nrules:\n  - path: Manual.md\n    accountIds: [different-owner]\n---\n');
    const revoked = await call(readArgs);
    expect(revoked.isError).toBe(true);
    for (const hidden of ['Manual.md', 'different-owner', '승인 required']) expect(JSON.stringify(revoked)).not.toContain(hidden);
    if (candidateRead) { const denied = await call(candidateRead); expect(denied.isError).toBe(true); expect(JSON.stringify(denied)).not.toContain('승인 required'); }
  } finally { await client?.close(); await server?.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);
