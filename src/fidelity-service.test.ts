import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { FidelityService, type FidelityCheckParams } from './fidelity-service.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
let vault: string, fs: FileSystemService, access: ScopeAccessPolicy, service: FidelityService;
const sourceBody = 'Only if approved, allow 12 attempts.\nNever transfer externally.';
const outputBody = 'Allow 12 attempts.\nTransfer only when approved.';
async function note(path: string, raw: string) {
  await mkdir(dirname(join(vault, path)), { recursive: true }); await writeFile(join(vault, path), raw);
}
async function inputs(): Promise<FidelityCheckParams> {
  await note('_sources/input.md', `---\nllm_wiki_type: source\nimmutable: true\ncontent_sha256: ${hash(sourceBody)}\n---\n${sourceBody}`);
  await note('Knowledge/output.md', `---\nllm_wiki_type: knowledge\n---\n${outputBody}`);
  const sourceRevision = await fs.readNoteRevision('_sources/input.md');
  const outputRevision = await fs.readNoteRevision('Knowledge/output.md');
  return { sourcePath: '_sources/input.md', outputPath: 'Knowledge/output.md', sourceRevision, outputRevision,
    facts: [{ id: 'required-condition', kind: 'condition', sourceLocator: { revision: sourceRevision, startLine: 1, endLine: 1, quoteHash: hash(sourceBody.split('\n')[0]!) },
      outputLocator: { revision: outputRevision, startLine: 1, endLine: 1, quoteHash: hash(outputBody.split('\n')[0]!) },
      comparisonMode: 'exact', semanticJudgment: 'missing' }], maxChars: 4000 };
}
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'fidelity-service-'));
  fs = new FileSystemService(vault); access = new ScopeAccessPolicy();
  service = new FidelityService(fs, access);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });

test('keeps agent-reported omission distinct from verified literal correspondence, without writes', async () => {
  const params = await inputs(); const before = await fs.readNoteRevision(params.outputPath);
  const result = await service.check(params);
  expect(result.status).toBe('partial');
  expect(result.checks[0]).toMatchObject({ id: 'required-condition', literalStatus: 'match',
    semanticJudgment: { source: 'agent_report', judgment: 'missing' } });
  expect(result.automaticApplication).toBe(false);
  expect(result.nextAction.arguments.expectedRevision).toBe(params.sourceRevision);
  expect(result.nextAction.arguments.startLine).toBe(6); // body line1 after5 frontmatter lines
  expect(await fs.readNoteRevision(params.outputPath)).toBe(before);
  expect(JSON.stringify(result)).not.toContain('Only if approved');
});
test('agent preservation report cannot override a mechanically changed condition', async () => {
  const params = await inputs(); params.facts[0]!.semanticJudgment = 'preserved';
  const result = await service.check(params);
  expect(result.status).toBe('partial'); expect(result.automaticApplication).toBe(false);
  expect(result.checks[0].verbatimStatus).toBe('different');
  expect(result).not.toHaveProperty('confidence'); expect(result).not.toHaveProperty('truth');
});
test('checks verbatim natural language independently of absent numeric literals', async () => {
  const body = '외부 전송 금지. 승인된 작업만 실행한다. 🙂';
  await note('Source.md', `---\nllm_wiki_type: source\nimmutable: true\ncontent_sha256: ${hash(body)}\n---\n${body}`);
  await note('Result.md', body);
  const sourceRevision = await fs.readNoteRevision('Source.md'), outputRevision = await fs.readNoteRevision('Result.md');
  const result = await service.check({ sourcePath: 'Source.md', outputPath: 'Result.md', sourceRevision, outputRevision,
    facts: [{ id: 'negation', kind: 'negation', comparisonMode: 'exact', semanticJudgment: 'preserved',
      sourceLocator: { revision: sourceRevision, startLine: 1, endLine: 1, quoteHash: hash(body) },
      outputLocator: { revision: outputRevision, startLine: 1, endLine: 1, quoteHash: hash(body) } }] });
  expect(result.status).toBe('checked'); expect(result.automaticApplication).toBe(false);
  expect(result.checks[0]).toMatchObject({ literalStatus: 'out_of_scope', verbatimStatus: 'match', preservation: 'verified_verbatim' });
});
test.each(['hidden', 'private', 'missing', 'traversal', 'policy'] as const)('does not reveal input existence for %s', async mode => {
  const params = await inputs();
  if (mode === 'hidden') await note(params.sourcePath, '---\nmoderation_status: hidden\n---\nTOPSECRET');
  if (mode === 'private') params.sourcePath = '_scopes/agents/other/TOPSECRET.md';
  if (mode === 'missing') params.sourcePath = 'Missing/TOPSECRET.md';
  if (mode === 'traversal') params.sourcePath = '../TOPSECRET.md';
  if (mode === 'policy') vi.spyOn(access, 'canAccessPhysicalPath').mockReturnValue(false);
  await expect(service.check(params)).rejects.toThrow(/^Fidelity input unavailable or changed$/);
});
test.each(['edit', 'delete', 'revoke', 'moderate'] as const)('rechecks after body I/O for %s', async mode => {
  const params = await inputs(); const read = fs.readNote.bind(fs);
  vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => {
    const value = await read(...args);
    if (args[0] === params.outputPath) {
      if (mode === 'edit') await note(params.sourcePath, 'NEWSECRET');
      if (mode === 'delete') await rm(join(vault, params.sourcePath));
      if (mode === 'revoke') vi.spyOn(access, 'canAccessPhysicalPath').mockReturnValue(false);
      if (mode === 'moderate') await note(params.sourcePath, '---\nmoderation_status: hidden\n---\nTOPSECRET');
    }
    return value;
  });
  await expect(service.check(params)).rejects.toThrow(/^Fidelity input unavailable or changed$/);
});
test('rechecks permission after the final async revision read', async () => {
  const params = await inputs(); const read = fs.readNoteRevision.bind(fs);
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => {
    const result = await read(...args); vi.spyOn(access, 'canAccessPhysicalPath').mockReturnValue(false); return result;
  });
  await expect(service.check(params)).rejects.toThrow(/^Fidelity input unavailable or changed$/);
});
test('executes the caller current-account guard, including before returning', async () => {
  const params = await inputs(); const guard = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(Error('account revoked TOPSECRET'));
  await expect(service.check(params, guard)).rejects.toThrow(/^Fidelity input unavailable or changed$/);
});
test.each(['missing_digest', 'mismatch', 'mutable', 'not_source'] as const)('requires actually verified immutable sources: %s', async mode => {
  const params = await inputs();
  await note(params.sourcePath, `---\nllm_wiki_type: ${mode === 'not_source' ? 'knowledge' : 'source'}\nimmutable: ${mode !== 'mutable'}\n${mode === 'missing_digest' ? '' : `content_sha256: ${mode === 'mismatch' ? hash('bad') : hash(sourceBody)}\n`}---\n${sourceBody}`);
  params.sourceRevision = await fs.readNoteRevision(params.sourcePath); params.facts[0]!.sourceLocator.revision = params.sourceRevision;
  await expect(service.check(params)).rejects.toThrow(/^Fidelity input unavailable or changed$/);
});
test('old locators remain unavailable, never a passed comparison', async () => {
  const params = await inputs(); params.facts[0]!.sourceLocator.quoteHash = hash('old quote');
  expect((await service.check(params)).status).toBe('partial');
});
test('partial read action preserves the entire verified source span', async () => {
  const params = await inputs();
  params.facts[0]!.sourceLocator = { revision: params.sourceRevision, startLine: 1, endLine: 2, quoteHash: hash(sourceBody) };
  const result = await service.check(params);
  expect(result.nextAction.arguments).toMatchObject({ startLine: 6, endLine: 7, expectedRevision: params.sourceRevision });
});
test('invalid source coordinates do not become an unbounded or nonexistent follow-up read', async () => {
  const params = await inputs();
  params.facts[0]!.sourceLocator.startLine = 999999;
  params.facts[0]!.sourceLocator.endLine = 999999;
  const result = await service.check(params);
  expect(result.status).toBe('partial');
  expect(result.nextAction.arguments).toMatchObject({ startLine: 6, endLine: 6, expectedRevision: params.sourceRevision });
});
test('preserves source action and partial status in a small response', async () => {
  const params = await inputs(); params.maxChars = 512;
  const result = await service.check(params);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
  expect(result.status).toBe('partial'); expect(result.nextAction.arguments.expectedRevision).toBe(params.sourceRevision);
});
test('never treats invalid, empty or excessive facts as complete inspection', async () => {
  const params = await inputs();
  for (const facts of [[], Array.from({ length: 33 }, () => params.facts[0]!), [{ ...params.facts[0]!, semanticJudgment: 'true' }]]) {
    await expect(service.check({ ...params, facts } as FidelityCheckParams)).rejects.toThrow();
  }
});
test('accepts already-normalized private paths only for their authenticated owner', async () => {
  const params = await inputs();
  const source = await fs.readNote(params.sourcePath), output = await fs.readNote(params.outputPath);
  const sourcePath = '_scopes/agents/worker/Source.md', outputPath = '_scopes/agents/worker/Output.md';
  await note(sourcePath, source.originalContent); await note(outputPath, output.originalContent);
  const principal = { accountId: 'worker', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
  expect((await service.check({ ...params, sourcePath, outputPath, principal })).status).toBe('partial');
  await expect(service.check({ ...params, sourcePath, outputPath })).rejects.toThrow(/^Fidelity input unavailable or changed$/);
});
