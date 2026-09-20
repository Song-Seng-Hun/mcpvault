import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { loadCompilationHostConfig, type CompilationHost } from './compilation-host.js';
import { CompilationBundleService } from './compilation-bundle-service.js';
import { DocumentPolicyStore } from './document-policy-store.js';
let root: string, vault: string, privateRoot: string, configPath: string, fs: FileSystemService, host: CompilationHost, config: any;
const actor = { accountId: 'owner', modelId: 'test', role: 'agent' as const, agentId: 'worker', capabilities: ['write', 'publish'] as any };
const docId = '9cac42de-e32d-41e2-8370-df5f19d3b19c';
let current: typeof actor | undefined;
const raw = '# Deploy\r\nOnly after approval. 검증 required. 😀\r\n\r\n## Restore\r\nNever overwrite user edits.\r\n';
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'compilation-bundles-')));
  vault = join(root, 'Vault'); privateRoot = join(root, 'Host'); configPath = join(privateRoot, 'compilation.json');
  await mkdir(vault); await mkdir(privateRoot, { mode: 0o700 });
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [privateRoot, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
  config = { version: 1, enabled: true, accountId: 'owner', vaultPath: vault, projects: [{ id: 'p', ruleVersion: 'v1',
    sources: [{ path: 'Manual.md', classification: 'resolved', mode: 'synthesis_allowed' }], outputPaths: ['Draft.md'],
    operations: ['index', 'synthesize'], runtimeIds: ['local'],
    chapterBundles: [{ documentPath: 'Manual.md', documentId: docId, chapterRoot: 'Chapters' }],
  }] };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  fs = new FileSystemService(vault); await writeFile(join(vault, 'Manual.md'), raw);
  host = await loadCompilationHostConfig(configPath, vault); current = actor;
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const service = () => new CompilationBundleService({ fs, access: new ScopeAccessPolicy(), host, authorize: async () => current,
  runtime: async () => ({ id: 'local', revision: 'verified-1', local: true, operations: ['index', 'synthesize'] }) });
const prepare = async () => ({ op: 'prepare', projectId: 'p', requestId: 'bundle-one', documentPath: 'Manual.md', expectedDocumentRevision: await fs.readNoteRevision('Manual.md') });
async function publisher() {
  config.projects[0].chapterBundles[0].publication = 'verbatim'; await writeFile(configPath, JSON.stringify(config));
  await mkdir(join(vault, '_wiki', '_policies'), { recursive: true });
  await writeFile(join(vault, '_wiki', '_policies', 'documents.md'), '---\ntype: protected-document-policy\nversion: 1\nrules: [{path: Manual.md, accountIds: [owner]}]\n---\n');
  const policy = new DocumentPolicyStore(vault); await policy.refresh();
  const access = new ScopeAccessPolicy({ documentRules: () => policy.rules() });
  const create = (readOnly = false) => new CompilationBundleService({ fs, access, host, documentPolicy: policy, readOnly, authorize: async () => current,
    runtime: async () => ({ id: 'local', revision: 'verified-1', local: true, operations: ['index', 'synthesize'] }) });
  const bundle = await create().execute(await prepare(), actor);
  const previewArgs = { op: 'split_preview', bundleId: bundle.bundleId, expectedJobRevision: bundle.jobRevision };
  const preview = await create().execute(previewArgs, actor);
  const args = { ...previewArgs, op: 'split_apply', expectedPublicationRevision: 'missing', fingerprint: preview.fingerprint, requestId: 'publish-one' };
  return { policy, access, create, bundle, previewArgs, preview, args };
}

test('verbatim processing preserves without granting synthesis or accepting generated candidates', async () => {
  config.projects[0].chapterBundles[0].processing = 'verbatim';
  config.projects[0].operations = ['index'];
  config.projects[0].runtimeIds = ['builtin-verbatim-v1'];
  await writeFile(configPath, JSON.stringify(config));
  const { builtinVerbatimRuntime } = await import('./compilation-local-runtime.js');
  const svc = () => new CompilationBundleService({ fs, access: new ScopeAccessPolicy(), host, authorize: async () => current,
    structuralRuntime: builtinVerbatimRuntime });
  const bundle = await svc().execute(await prepare(), actor);
  expect(bundle).toMatchObject({ status: 'source_preserved', generationAllowed: false });
  const args = { bundleId: bundle.bundleId, expectedJobRevision: bundle.jobRevision };
  expect((await svc().execute({ ...args, op: 'read', projection: 'original' }, actor)).part.text).toBe(raw);
  const plan = await svc().execute({ ...args, op: 'read', projection: 'plan' }, actor);
  await expect(svc().execute({ ...args, op: 'submit', expectedPlanRevision: plan.planRevision,
    chapterId: plan.items[0].chapterId, requestId: 'denied', content: 'Generated replacement.' }, actor)).rejects.toThrow();
  await expect(svc().execute({ ...args, op: 'read', projection: 'candidate' }, actor)).rejects.toThrow();
  config.projects[0].chapterBundles[0].processing = undefined; await writeFile(configPath, JSON.stringify(config));
  await expect(svc().execute({ ...args, op: 'read', projection: 'original' }, actor)).rejects.toThrow();
}, 30000);

test.each(['source_only', 'unresolved', 'wrong_runtime', 'missing_runtime', 'missing_grant'])('verbatim processing keeps independent policy gates: %s', async variant => {
  const { builtinVerbatimRuntime } = await import('./compilation-local-runtime.js');
  config.projects[0].chapterBundles[0].processing = 'verbatim';
  config.projects[0].chapterBundles[0].publication = 'verbatim';
  config.projects[0].operations = ['index']; config.projects[0].runtimeIds = ['builtin-verbatim-v1'];
  if (variant === 'source_only') config.projects[0].sources[0].mode = 'source_only';
  if (variant === 'unresolved') config.projects[0].sources[0].classification = 'unresolved';
  if (variant === 'wrong_runtime') config.projects[0].runtimeIds = ['different'];
  if (variant === 'missing_grant') delete config.projects[0].chapterBundles;
  await writeFile(configPath, JSON.stringify(config));
  const policy = new DocumentPolicyStore(vault); await policy.refresh();
  const svc = new CompilationBundleService({ fs, host, documentPolicy: policy, access: new ScopeAccessPolicy(), authorize: async () => current,
    ...(variant !== 'missing_runtime' && { structuralRuntime: builtinVerbatimRuntime }) });
  const result = await svc.execute(await prepare(), actor);
  if (variant === 'source_only') {
    expect(result).toMatchObject({ status: 'source_preserved', generationAllowed: false });
    await expect(svc.execute({ op: 'split_preview', bundleId: result.bundleId, expectedJobRevision: result.jobRevision }, actor)).rejects.toThrow();
  } else expect(result.status).toBe(variant === 'unresolved' ? 'review_required' : variant === 'missing_grant' ? 'diagnostic_only' : 'waiting_runtime');
  expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toBe(raw);
}, 30000);

test('interrupted chapter creation stays hidden and resumes without overwriting; later user edits block rollback', async () => {
  const { create, access, preview, previewArgs, args } = await publisher();
  const originalWrite = fs.writeNoteWithRevisionGuardsAndReceipt.bind(fs);
  const fault = vi.spyOn(fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementationOnce(async (...input) => {
    await originalWrite(...input); throw Error('Synthetic interruption after real write');
  });
  try { await expect(create().execute(args, actor)).rejects.toThrow(); } finally { fault.mockRestore(); }
  expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toBe(raw);
  for (const item of preview.outputs) expect(access.canReadProtectedDocument(item.path, actor)).toBe(false);
  const pending = await create().execute(previewArgs, actor);
  expect(pending.status).toBe('applying');
  const applied = await create().execute({ ...args, expectedPublicationRevision: pending.publicationRevision }, actor);
  expect(applied.status).toBe('applied');
  await writeFile(join(vault, preview.outputs[0].path), 'Human edit: preserve me.');
  const toc = await readFile(join(vault, 'Manual.md'), 'utf8');
  await expect(create().execute({ ...args, op: 'split_revert', requestId: 'rollback', expectedPublicationRevision: applied.publicationRevision }, actor)).rejects.toThrow();
  expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toBe(toc);
  expect(await readFile(join(vault, preview.outputs[0].path), 'utf8')).toBe('Human edit: preserve me.');
}, 30000);

test('rollback of an interrupted split restores readability without requiring missing chapters to be created', async () => {
  const { create, access, previewArgs, preview, args } = await publisher();
  const originalWrite = fs.writeNoteWithRevisionGuardsAndReceipt.bind(fs);
  const fault = vi.spyOn(fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementationOnce(async (...input) => {
    await originalWrite(...input); throw Error('Synthetic interruption');
  });
  try { await expect(create().execute(args, actor)).rejects.toThrow(); } finally { fault.mockRestore(); }
  const pending = await create().execute(previewArgs, actor);
  const result = await create().execute({ ...args, op: 'split_revert', requestId: 'abort', expectedPublicationRevision: pending.publicationRevision }, actor);
  expect(result.status).toBe('withdrawn'); expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toBe(raw);
  for (const item of preview.outputs) expect(access.canReadProtectedDocument(item.path, actor)).toBe(false);
}, 30000);

test('publication rejects readonly, forged fingerprints, changed source and unowned root entries without cutover', async () => {
  const { create, args } = await publisher();
  await expect(create(true).execute(args, actor)).rejects.toThrow();
  await expect(create().execute({ ...args, fingerprint: '0'.repeat(64) }, actor)).rejects.toThrow();
  await mkdir(join(vault, 'Chapters')); await writeFile(join(vault, 'Chapters', 'User.txt'), 'Unowned.');
  await expect(create().execute(args, actor)).rejects.toThrow();
  expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toBe(raw);
  expect(await readFile(join(vault, 'Chapters', 'User.txt'), 'utf8')).toBe('Unowned.');
}, 30000);

test('published state is not reported as applied after source restoration outside its journal', async () => {
  const { create, args, previewArgs } = await publisher();
  await create().execute(args, actor);
  await writeFile(join(vault, 'Manual.md'), raw);
  await expect(create().execute(previewArgs, actor)).rejects.toThrow();
}, 30000);

test('changed chapter at the release boundary is re-hidden, never recorded as completed', async () => {
  const { create, policy, args, preview, access } = await publisher();
  const finish = policy.finishPublication.bind(policy);
  const fault = vi.spyOn(policy, 'finishPublication').mockImplementationOnce(async (...input) => {
    await finish(...input); await writeFile(join(vault, preview.outputs[0].path), 'Concurrent user content.');
  });
  try { await expect(create().execute(args, actor)).rejects.toThrow(); } finally { fault.mockRestore(); }
  for (const item of preview.outputs) expect(access.canReadProtectedDocument(item.path, actor)).toBe(false);
  expect(await readFile(join(vault, preview.outputs[0].path), 'utf8')).toBe('Concurrent user content.');
}, 30000);

test('a lost release acknowledgement reconciles the actual bytes rather than rewriting them', async () => {
  const { create, policy, args, previewArgs, preview } = await publisher();
  const finish = policy.finishPublication.bind(policy);
  const fault = vi.spyOn(policy, 'finishPublication').mockImplementationOnce(async (...input) => {
    await finish(...input); throw Error('Synthetic response loss after durable release');
  });
  try { await expect(create().execute(args, actor)).rejects.toThrow(); } finally { fault.mockRestore(); }
  const before = await Promise.all(['Manual.md', ...preview.outputs.map((x: any) => x.path)].map(path => readFile(join(vault, path), 'utf8')));
  const pending = await create().execute(previewArgs, actor);
  const recovered = await create().execute({ ...args, expectedPublicationRevision: pending.publicationRevision }, actor);
  expect(recovered.status).toBe('applied');
  expect(await Promise.all(['Manual.md', ...preview.outputs.map((x: any) => x.path)].map(path => readFile(join(vault, path), 'utf8')))).toEqual(before);
}, 30000);

test('last-attempt release loss can reconcile and rollback has its own bounded recovery budget', async () => {
  const { create, policy, args, previewArgs } = await publisher();
  const finish = policy.finishPublication.bind(policy);
  const fault = vi.spyOn(policy, 'finishPublication')
    .mockImplementationOnce(async () => { throw Error('Before release, first attempt'); })
    .mockImplementationOnce(async () => { throw Error('Before release, second attempt'); })
    .mockImplementationOnce(async (...input) => { await finish(...input); throw Error('Lost final release acknowledgement'); });
  let revision = 'missing';
  try {
    for (let i = 0; i < 3; i++) {
      await expect(create().execute({ ...args, expectedPublicationRevision: revision }, actor)).rejects.toThrow();
      revision = (await create().execute(previewArgs, actor)).publicationRevision;
    }
  } finally { fault.mockRestore(); }
  const recovered = await create().execute({ ...args, expectedPublicationRevision: revision }, actor);
  expect(recovered.status).toBe('applied');
  const restored = await create().execute({ ...args, op: 'split_revert', requestId: 'restore', expectedPublicationRevision: recovered.publicationRevision }, actor);
  expect(restored.status).toBe('withdrawn');
  expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toBe(raw);
}, 30000);

test('reconciliation never reports applied if the source changes during completion receipt storage', async () => {
  const { create, policy, access, args, previewArgs } = await publisher();
  const finish = policy.finishPublication.bind(policy);
  const lost = vi.spyOn(policy, 'finishPublication').mockImplementationOnce(async (...input) => { await finish(...input); throw Error('Lost acknowledgement'); });
  try { await expect(create().execute(args, actor)).rejects.toThrow(); } finally { lost.mockRestore(); }
  const pending = await create().execute(previewArgs, actor);
  const write = host.records!.write.bind(host.records);
  const interrupted = new CompilationBundleService({ fs, access, documentPolicy: policy, authorize: async () => current,
    runtime: async () => ({ id: 'local', revision: 'verified-1', local: true, operations: ['index', 'synthesize'] }),
    host: { ...host, records: { ...host.records!, write: async (...input) => {
      const result = await write(...input);
      if ((input[1] as any)?.state === 'applied') await writeFile(join(vault, 'Manual.md'), raw);
      return result;
    } } } });
  await expect(interrupted.execute({ ...args, expectedPublicationRevision: pending.publicationRevision }, actor)).rejects.toThrow();
  expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toBe(raw);
}, 30000);

test('small publication responses retain the receipt and a complete additional-read action', async () => {
  config.projects[0].chapterBundles[0].chapterRoot = 'Sections/' + 'a'.repeat(60);
  await writeFile(join(vault, 'Manual.md'), '# A\nOne.\n# B\nTwo.\n# C\nThree.\n# D\nFour.\n');
  const { create, args, previewArgs } = await publisher();
  const preview = await create().execute({ ...previewArgs, maxChars: 1024 }, actor);
  expect(JSON.stringify(preview).length).toBeLessThanOrEqual(1024);
  expect(preview.partial).toBe(true); expect(preview.nextAction.endpointId).toBe('wiki.compilation');
  const applied = await create().execute({ ...args, maxChars: 1024 }, actor);
  expect(applied.status).toBe('applied'); expect(applied.publicationRevision).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(applied).length).toBeLessThanOrEqual(1024);
}, 30000);

test('explicit verbatim publication creates hidden chapters before TOC, rereads, survives restart and restores exact original', async () => {
  config.projects[0].chapterBundles[0].publication = 'verbatim'; await writeFile(configPath, JSON.stringify(config));
  await mkdir(join(vault, '_wiki', '_policies'), { recursive: true });
  await writeFile(join(vault, '_wiki', '_policies', 'documents.md'), '---\ntype: protected-document-policy\nversion: 1\nrules: [{path: Manual.md, accountIds: [owner]}]\n---\n');
  const policy = new DocumentPolicyStore(vault); await policy.refresh();
  const access = new ScopeAccessPolicy({ documentRules: () => policy.rules() });
  const create = () => new CompilationBundleService({ fs, access, host, documentPolicy: policy, authorize: async () => current,
    runtime: async () => ({ id: 'local', revision: 'verified-1', local: true, operations: ['index', 'synthesize'] }) } as any);
  const bundle = await create().execute(await prepare(), actor);
  const preview = await create().execute({ op: 'split_preview', bundleId: bundle.bundleId, expectedJobRevision: bundle.jobRevision }, actor);
  expect(preview.status).toBe('ready'); expect(preview.outputs).toHaveLength(2);
  const args = { op: 'split_apply', bundleId: bundle.bundleId, expectedJobRevision: bundle.jobRevision,
    expectedPublicationRevision: 'missing', fingerprint: preview.fingerprint, requestId: 'publish-one' };
  const applied = await create().execute(args, actor);
  expect(applied.status).toBe('applied'); expect(applied.effectVerified).toBe(false);
  expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toContain('Read this section');
  for (const item of preview.outputs) {
    expect(access.canReadProtectedDocument(item.path, actor)).toBe(true);
    expect(access.canReadProtectedDocument(item.path, { ...actor, accountId: 'other' })).toBe(false);
  }
  expect(await create().execute(args, actor)).toEqual(applied);
  const reverted = await create().execute({ ...args, op: 'split_revert', requestId: 'restore-one', expectedPublicationRevision: applied.publicationRevision }, actor);
  expect(reverted.status).toBe('withdrawn');
  expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toBe(raw);
  for (const item of preview.outputs) expect(access.canReadProtectedDocument(item.path, actor)).toBe(false);
}, 30000);

const candidateFields = () => ({ title: 'Safe deployment', description: 'Approval before deployment.', kind: 'manual',
  domain: 'software', useWhen: 'Deploying.', avoidWhen: 'Reading only.', stage: 'execute', aliases: ['배포'],
  prerequisites: [], tools: ['notes.change_set'], counterexamples: [] });
test('chapter plan is revision-pinned and private candidates survive restart without duplicate writes', async () => {
  const bundle = await service().execute(await prepare(), actor);
  const args = { op: 'read', projection: 'plan', bundleId: bundle.bundleId, expectedJobRevision: bundle.jobRevision, maxChars: 12000 };
  const plan = await service().execute(args, actor);
  expect(plan.items).toHaveLength(2); expect(plan.automaticApplication).toBe(false);
  const exact = await service().execute(plan.items[0].readAction.arguments, actor);
  expect(exact.part.text).toBe(raw.slice(plan.items[0].startOffset, plan.items[0].endOffset)); expect(exact.partial).toBe(false);
  const submit = { op: 'submit', bundleId: bundle.bundleId, expectedJobRevision: bundle.jobRevision,
    expectedPlanRevision: plan.planRevision, chapterId: plan.items[0].chapterId, requestId: 'chapter-one',
    metadata: candidateFields(), content: 'Only deploy after approval. 검증 required. 😀\nExample: preview the change before applying.\n' };
  const saved = await service().execute(submit, actor);
  expect(saved).toMatchObject({ status: 'candidate_stored', semantic: 'not_assessed', automaticApplication: false });
  const before = await Promise.all((await readdir(privateRoot)).sort().map(async name => [name, await readFile(join(privateRoot, name), 'utf8')]));
  expect(await service().execute(submit, actor)).toEqual(saved);
  expect(await Promise.all((await readdir(privateRoot)).sort().map(async name => [name, await readFile(join(privateRoot, name), 'utf8')]))).toEqual(before);
  const read = await service().execute({ ...args, projection: 'candidate', chapterId: submit.chapterId,
    expectedPlanRevision: plan.planRevision, expectedCandidateRevision: saved.candidateRevision }, actor);
  expect(read.part.text).toContain(submit.content);
  expect(read.part.text).toContain('semantic_review: not_assessed');
  expect(await readdir(vault)).toEqual(['Manual.md']); expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toBe(raw);
  await expect(service().execute({ ...submit, content: 'Overwrite previous candidate.' }, actor)).rejects.toThrow();
  const changed = await service().execute({ ...submit, requestId: 'different-request', content: 'Different candidate.' }, actor);
  expect(changed).toMatchObject({ status: 'review_required', reason: 'candidate_conflict' });
}, 30000);

test('candidate admission rejects stale plans, source-only synthesis and incoming authority fields', async () => {
  const bundle = await service().execute(await prepare(), actor);
  const args = { op: 'read', projection: 'plan', bundleId: bundle.bundleId, expectedJobRevision: bundle.jobRevision, maxChars: 12000 };
  const plan = await service().execute(args, actor);
  const submit = { op: 'submit', bundleId: bundle.bundleId, expectedJobRevision: bundle.jobRevision, expectedPlanRevision: plan.planRevision,
    chapterId: plan.items[0].chapterId, requestId: 'candidate', metadata: candidateFields(), content: 'Preserve approval.\nExample: read the rule.\n' };
  await expect(service().execute({ ...submit, expectedPlanRevision: '0'.repeat(64) }, actor)).rejects.toThrow();
  await expect(service().execute({ ...submit, metadata: { ...candidateFields(), absolute: true } }, actor)).rejects.toThrow();
  config.projects[0].sources[0].mode = 'source_only'; await writeFile(configPath, JSON.stringify(config));
  const sourceOnly = await service().execute({ ...await prepare(), requestId: 'source-only' }, actor);
  const exactPlan = await service().execute({ ...args, bundleId: sourceOnly.bundleId, expectedJobRevision: sourceOnly.jobRevision }, actor);
  await expect(service().execute({ ...submit, bundleId: sourceOnly.bundleId, expectedJobRevision: sourceOnly.jobRevision,
    expectedPlanRevision: exactPlan.planRevision }, actor)).rejects.toThrow();
}, 30000);

test('bundle preparation preserves exact source privately without rewriting the Vault', async () => {
  const input = await prepare(), s = service();
  const result = await s.execute(input, actor);
  expect(result).toMatchObject({ status: 'source_preserved', documentId: docId, originalPreserved: true, automaticApplication: false });
  expect(result.bundleId).toMatch(/^[a-f0-9-]{36}$/);
  expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toBe(raw);
  expect(await readdir(vault)).toEqual(['Manual.md']);
  const before = await Promise.all((await readdir(privateRoot)).sort().map(async name => [name, await readFile(join(privateRoot, name), 'utf8')]));
  const repeated = await service().execute(input, actor);
  expect(repeated).toEqual(result);
  expect(await Promise.all((await readdir(privateRoot)).sort().map(async name => [name, await readFile(join(privateRoot, name), 'utf8')]))).toEqual(before);
});

test('original reads use pinned bundle/source revisions and bounded Unicode-safe continuations', async () => {
  await writeFile(join(vault, 'Manual.md'), raw.repeat(15));
  const result = await service().execute(await prepare(), actor);
  let args: any = { op: 'read', bundleId: result.bundleId, expectedJobRevision: result.jobRevision, projection: 'original', maxChars: 1100 };
  let collected = '';
  for (let reads = 0;; reads++) {
    expect(reads).toBeLessThan(30);
    const page = await service().execute(args, actor);
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(1100);
    expect(page.sourceRevision).toBe(result.sourceRevision);
    collected += page.part.text;
    if (!page.nextAction) break;
    args = page.nextAction.arguments;
  }
  expect(collected).toBe(raw.repeat(15));
  const segment = await service().execute({ op: 'read', bundleId: result.bundleId, expectedJobRevision: result.jobRevision,
    projection: 'original', startOffset: 0, endOffset: raw.length, maxChars: 1100 }, actor);
  expect(segment.part.text).toBe(raw); expect(segment.partial).toBe(false);
  await expect(service().execute({ ...args, expectedJobRevision: undefined }, actor)).rejects.toThrow();
});

test('missing bundle grant or unresolved classification collects no private source body', async () => {
  for (const change of ['missing', 'unresolved']) {
    if (change === 'missing') delete config.projects[0].chapterBundles;
    else { config.projects[0].chapterBundles = [{ documentPath: 'Manual.md', documentId: docId, chapterRoot: 'Chapters' }]; config.projects[0].sources[0].classification = 'unresolved'; }
    await writeFile(configPath, JSON.stringify(config));
    const result = await service().execute(await prepare(), actor);
    expect(['diagnostic_only', 'review_required']).toContain(result.status);
    expect(await readdir(privateRoot)).toEqual(['compilation.json']);
  }
});

test('source-only preparation never permits synthesis and changed source requires review', async () => {
  config.projects[0].sources[0].mode = 'source_only'; await writeFile(configPath, JSON.stringify(config));
  const result = await service().execute(await prepare(), actor);
  expect(result).toMatchObject({ mode: 'source_only', generationAllowed: false, automaticApplication: false });
  await expect(service().execute({ op: 'submit', bundleId: result.bundleId, content: 'Translated content.' }, actor)).rejects.toThrow();
  await writeFile(join(vault, 'Manual.md'), 'Changed manually.');
  expect(await service().execute({ op: 'read', bundleId: result.bundleId }, actor)).toMatchObject({ status: 'review_required', reason: 'input_changed' });
});

test('revocation hides bundle contents and read-only mode rejects preparation', async () => {
  const result = await service().execute(await prepare(), actor);
  current = undefined;
  await expect(service().execute({ op: 'read', bundleId: result.bundleId, projection: 'original', expectedJobRevision: result.jobRevision }, actor)).rejects.toThrow('Document bundle unavailable');
  current = actor;
  const readOnly = new CompilationBundleService({ fs, access: new ScopeAccessPolicy(), host, readOnly: true, authorize: async () => current });
  await expect(readOnly.execute(await prepare(), actor)).rejects.toThrow();
});

test('a request ID cannot be rebound to changed input', async () => {
  await service().execute(await prepare(), actor);
  await writeFile(join(vault, 'Manual.md'), raw + 'Changed input.');
  await expect(service().execute(await prepare(), actor)).rejects.toThrow('Document bundle unavailable');
});

test.each([1, 2, 3, 4])('restart after preservation write %i resumes without changing original bytes', async cut => {
  const real = host.records!; let writes = 0;
  const interrupted = new CompilationBundleService({ fs, access: new ScopeAccessPolicy(),
    host: { ...host, records: { read: id => real.read(id), write: async (id, value, revision, guard) => {
      const result = await real.write(id, value, revision, guard);
      if (++writes === cut) throw new Error('Simulated process interruption after durable write');
      return result;
    } } }, authorize: async () => current,
    runtime: async () => ({ id: 'local', revision: 'verified-1', local: true, operations: ['index', 'synthesize'] }) });
  const input = await prepare();
  await expect(interrupted.execute(input, actor)).rejects.toThrow();
  host = await loadCompilationHostConfig(configPath, vault);
  const result = await service().execute(input, actor);
  expect(result).toMatchObject({ status: 'source_preserved', originalPreserved: true, automaticApplication: false });
  const original = await service().execute({ op: 'read', bundleId: result.bundleId, projection: 'original', expectedJobRevision: result.jobRevision }, actor);
  expect(original.part.text).toBe(raw);
  expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toBe(raw);
});

test('policy or runtime drift rejects a pinned original without disclosing host data', async () => {
  const result = await service().execute(await prepare(), actor);
  const args = { op: 'read', bundleId: result.bundleId, projection: 'original', expectedJobRevision: result.jobRevision };
  const changedRuntime = new CompilationBundleService({ fs, access: new ScopeAccessPolicy(), host, authorize: async () => current,
    runtime: async () => ({ id: 'local', revision: 'verified-2', local: true, operations: ['index', 'synthesize'] }) });
  await expect(changedRuntime.execute(args, actor)).rejects.toThrow('Document bundle unavailable');
  delete config.projects[0].chapterBundles; await writeFile(configPath, JSON.stringify(config));
  await expect(service().execute(args, actor)).rejects.toThrow('Document bundle unavailable');
});

test('corrupt original is retained, never recaptured or exposed in errors', async () => {
  const input = await prepare(), result = await service().execute(input, actor);
  const files = await readdir(privateRoot);
  const original = (await Promise.all(files.filter(f => f.includes('.record-')).map(async name => ({ name, raw: await readFile(join(privateRoot, name), 'utf8') }))))
    .find(f => JSON.parse(f.raw).text !== undefined)!;
  const corrupt = '{"text":"PRIVATE-CORRUPTION';
  await writeFile(join(privateRoot, original.name), corrupt);
  await expect(service().execute(input, actor)).rejects.toThrow('Document bundle unavailable');
  expect(await readFile(join(privateRoot, original.name), 'utf8')).toBe(corrupt);
  expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toBe(raw);
  expect(result.originalPreserved).toBe(true);
});

test('BOM and empty original bytes round-trip exactly; managed frontmatter is excluded', async () => {
  for (const text of ['\ufeff' + raw, '']) {
    await writeFile(join(vault, 'Manual.md'), text);
    const input = { ...await prepare(), requestId: text ? 'bom' : 'empty' };
    const result = await service().execute(input, actor);
    const page = await service().execute({ op: 'read', bundleId: result.bundleId, projection: 'original', expectedJobRevision: result.jobRevision }, actor);
    expect(page.part.text).toBe(text);
  }
  await writeFile(join(vault, 'Manual.md'), '---\nmcpvault_type: managed\n---\nProtected record.');
  await expect(service().execute({ ...await prepare(), requestId: 'managed' }, actor)).rejects.toThrow();
// Two full captures/reads verify real private Windows ACLs at each save boundary.
// The combined integration case can exceed Vitest's five-second unit default.
}, 20000);

test('a pinned historical original never borrows the revision of edited current content', async () => {
  const bundle = await service().execute(await prepare(), actor);
  await writeFile(join(vault, 'Manual.md'), 'Later manual edit.');
  const page = await service().execute({ op: 'read', bundleId: bundle.bundleId, expectedJobRevision: bundle.jobRevision, projection: 'original' }, actor);
  expect(page).toMatchObject({ sourceRevision: bundle.sourceRevision, sourceState: 'historical', part: { text: raw } });
  expect(page.sourceRevision).not.toBe(await fs.readNoteRevision('Manual.md'));
});

test('three failed capture attempts stop; repeated requests do not mutate the stopped journal', async () => {
  const real = host.records!;
  const failing = new CompilationBundleService({ fs, access: new ScopeAccessPolicy(),
    host: { ...host, records: { read: id => real.read(id), write: async (id, value, revision, guard) => {
      if (value && typeof value === 'object' && 'text' in value) throw new Error('Original storage interruption');
      return real.write(id, value, revision, guard);
    } } }, authorize: async () => current,
    runtime: async () => ({ id: 'local', revision: 'verified-1', local: true, operations: ['index', 'synthesize'] }) });
  const input = await prepare();
  for (let attempt = 0; attempt < 3; attempt++) await expect(failing.execute(input, actor)).rejects.toThrow();
  const files = async () => Promise.all((await readdir(privateRoot)).sort().map(async name => [name, await readFile(join(privateRoot, name), 'utf8')]));
  const before = await files();
  for (let repeat = 0; repeat < 2; repeat++) expect(await service().execute(input, actor)).toMatchObject({ status: 'review_required', reason: 'attempt_limit' });
  expect(await files()).toEqual(before);
});

test('a source edit at the original commit boundary leaves no committed original record', async () => {
  const real = host.records!;
  const racing = new CompilationBundleService({ fs, access: new ScopeAccessPolicy(),
    host: { ...host, records: { read: id => real.read(id), write: async (id, value, revision, guard) => {
      let checks = 0;
      return real.write(id, value, revision, async () => {
        if (++checks === 2 && value && typeof value === 'object' && 'text' in value) await writeFile(join(vault, 'Manual.md'), 'Concurrent user edit.');
        await guard?.();
      });
    } } }, authorize: async () => current,
    runtime: async () => ({ id: 'local', revision: 'verified-1', local: true, operations: ['index', 'synthesize'] }) });
  await expect(racing.execute(await prepare(), actor)).rejects.toThrow();
  for (const name of (await readdir(privateRoot)).filter(f => f.includes('.record-'))) expect(JSON.parse(await readFile(join(privateRoot, name), 'utf8'))).not.toHaveProperty('text');
  expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toBe('Concurrent user edit.');
});

test('a missing manifest is history loss, not permission to initialize it again', async () => {
  const input = await prepare(), bundle = await service().execute(input, actor);
  const files = (await readdir(privateRoot)).filter(name => name.includes('.record-'));
  const manifest = (await Promise.all(files.map(async name => ({ name, value: JSON.parse(await readFile(join(privateRoot, name), 'utf8')) }))))
    .find(item => item.value.documentId === bundle.documentId)!;
  await rename(join(privateRoot, manifest.name), join(privateRoot, manifest.name + '.retained'));
  await expect(service().execute(input, actor)).rejects.toThrow('Document bundle unavailable');
  expect(await readdir(privateRoot)).not.toContain(manifest.name);
  expect(await readFile(join(vault, 'Manual.md'), 'utf8')).toBe(raw);
});
