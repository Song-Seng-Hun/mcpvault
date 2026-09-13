import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { loadCompilationHostConfig, type CompilationHost } from './compilation-host.js';
import { CompilationBundleService } from './compilation-bundle-service.js';
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
