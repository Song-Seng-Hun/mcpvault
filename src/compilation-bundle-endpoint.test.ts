import { expect, test } from 'vitest';
import { mkdtemp, mkdir, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { createServer, connectMcpClient } from '../tests/server-fixture.js';
import { loadCompilationHostConfig } from './compilation-host.js';

const parse = (result: any) => JSON.parse(result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(''));
test.each(['source_only', 'synthesis_allowed', 'publication'])('MCP bundle%s preserves source and permits bounded read-only projections', async variant => {
  const mode = variant === 'publication' ? 'synthesis_allowed' : variant;
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bundle-mcp-'))), vault = join(root, 'Vault'), hostPath = join(root, 'Host');
  let server: ReturnType<typeof createServer> | undefined, client: Client | undefined;
  try {
    await mkdir(vault); await mkdir(hostPath, { mode: 0o700 });
    if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [hostPath, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
    await mkdir(join(vault, '_wiki', '_policies'), { recursive: true });
    await writeFile(join(vault, '_wiki', '_policies', 'documents.md'), '---\ntype: protected-document-policy\nversion: 1\nrules:\n  - path: Manual.md\n    accountIds: [operator]\n---\n');
    const raw = '# Approval\r\nOnly approved edits. 승인 required. 😀\r\n' + (variant === 'publication' ? '## Restore\r\nKeep user edits.\r\n' : ''), revision = createHash('sha256').update(raw).digest('hex');
    await writeFile(join(vault, 'Manual.md'), raw);
    const path = join(hostPath, 'compilation.json');
    await writeFile(path, JSON.stringify({ version: 1, enabled: true, accountId: 'operator', vaultPath: vault,
      projects: [{ id: 'p', ruleVersion: 'v1', sources: [{ path: 'Manual.md', mode, classification: 'resolved' }],
        outputPaths: ['Draft.md'], operations: ['index', 'synthesize'], runtimeIds: ['local'],
        chapterBundles: [{ documentPath: 'Manual.md', documentId: '9cac42de-e32d-41e2-8370-df5f19d3b19c', chapterRoot: 'Chapters',
          ...(variant === 'publication' && { publication: 'verbatim' }) }] }] }));
    const connect = async (readOnly: boolean) => {
      ({ server, client } = await connectMcpClient(vault, { readOnly, compilation: { host: await loadCompilationHostConfig(path, vault),
        runtime: async () => ({ id: 'local', revision: 'v1', local: true, operations: ['index', 'synthesize'] }) } }, 'bundle-mcp-test'));
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
    if (variant === 'publication') {
      const previewResult = await call({ op: 'split_preview', bundleId: bundle.bundleId, expectedJobRevision: bundle.jobRevision });
      expect(previewResult.isError, JSON.stringify(previewResult.content)).toBeFalsy(); const preview = parse(previewResult);
      expect(preview.status).toBe('ready');
      const args = { bundleId: bundle.bundleId, expectedJobRevision: bundle.jobRevision, fingerprint: preview.fingerprint };
      const appliedResult = await call({ ...args, op: 'split_apply', expectedPublicationRevision: 'missing', requestId: 'publish' });
      expect(appliedResult.isError, JSON.stringify(appliedResult.content)).toBeFalsy(); const applied = parse(appliedResult);
      expect(applied.status).toBe('applied');
      const hidden = await client!.callTool({ name: 'call_endpoint', arguments: { endpointId: 'notes.read', arguments: { path: preview.outputs[0].path } } });
      expect(hidden.isError).toBe(true);
      const restored = await call({ ...args, op: 'split_revert', expectedPublicationRevision: applied.publicationRevision, requestId: 'restore' });
      expect(restored.isError, JSON.stringify(restored.content)).toBeFalsy(); expect(parse(restored).status).toBe('withdrawn');
      // Private synthesis candidates keep their old authority pin. Physical
      // publication does not promote them; preserved original reads remain supported.
      if (candidateRead) expect((await call(candidateRead)).isError).toBe(true);
      candidateRead = undefined;
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
    expect((await client!.listTools()).tools).toHaveLength(16);
    for (const op of ['prepare', 'submit', 'check', 'retry', 'split_apply', 'split_revert']) expect((await call({ op, requestId: 'denied' })).isError).toBe(true);
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
