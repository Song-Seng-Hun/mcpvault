import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

let vault: string;
let fs: FileSystemService;
let service: LlmWikiService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-lint-hygiene-'));
  fs = new FileSystemService(vault);
  const access = new ScopeAccessPolicy();
  service = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
async function seed(path: string, fields: Record<string, unknown> = {}, body = '# Current\n\nCurrent body.') {
  await mkdir(dirname(join(vault, path)), { recursive: true });
  await writeFile(join(vault, path), `---\n${stringify(fields)}---\n${body}`);
}

test.each(['hidden', 'removed', 'quarantined'])('lint excludes %s owners before every collision and count', async state => {
  await seed('A-secret.md', { moderation_status: state, llm_wiki_type: 'knowledge', aliases: ['shared'], stable_id: 'same', tags: 'wrong', domain: 'Secret grouping' });
  await seed('Public.md', { aliases: ['shared'], stable_id: 'same', tags: ['right'] });
  const lint = await service.lint();
  expect(lint.issues).toEqual([]);
  expect(lint.errors + lint.warnings).toBe(0);
  const health = await service.organizationHealth(undefined, 100, 16000);
  expect(JSON.stringify(health)).not.toMatch(/A-secret|Secret grouping|duplicate_alias|property_type_drift/);
  expect(health.collectionHealth.totalNotes).toBe(1);
});

test('hidden evidence is unavailable without reading its body or echoing target details', async () => {
  await seed('_sources/Hidden-source.md', { moderation_status: 'hidden', llm_wiki_type: 'source' });
  await seed('Claim.md', { llm_wiki_type: 'knowledge', evidence_paths: ['_sources/Hidden-source.md'], claims: [{ id: 'c', text: 'Claim', evidence_paths: ['_sources/Hidden-source.md'] }] });
  const reads = vi.spyOn(fs, 'readNote');
  const lint = await service.lint();
  expect(lint.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing_evidence' }), expect.objectContaining({ code: 'missing_claim_evidence' })]));
  expect(JSON.stringify(lint)).not.toContain('Hidden-source');
  expect(reads.mock.calls.map(([path]) => path)).not.toContain('_sources/Hidden-source.md');
});

test('a cached alias owner becoming hidden forces a fresh visible result', async () => {
  await seed('A-owner.md', { aliases: ['shared'] });
  await seed('B.md', { aliases: ['shared'] });
  expect((await service.lint()).issues.some(item => item.code === 'duplicate_alias_across_notes')).toBe(true);
  await seed('A-owner.md', { aliases: ['shared'], moderation_status: 'hidden' });
  const next = await service.lint();
  expect(next.issues).toEqual([]);
  expect(next.warnings).toBe(0);
});

test('lint rejects a dependency changed while the scan is finishing', async () => {
  await seed('A-owner.md', { aliases: ['shared'] });
  await seed('B.md', { aliases: ['shared'] });
  const unresolved = fs.findUnresolvedLinks.bind(fs);
  vi.spyOn(fs, 'findUnresolvedLinks').mockImplementation(async (...args) => {
    await seed('A-owner.md', { moderation_status: 'hidden' });
    return unresolved(...args);
  });
  await expect(service.lint()).rejects.toThrow(/changed|retry/i);
});

test('lint does not combine stale inventory Properties with a current body', async () => {
  await seed('Concept.md', { llm_wiki_type: 'knowledge', lifecycle: 'evergreen' });
  const query = fs.queryNotes.bind(fs);
  vi.spyOn(fs, 'queryNotes').mockImplementation(async (...args) => {
    const result = await query(...args);
    return { ...result, notes: result.notes.map(note => ({ ...note, frontmatter: { ...note.frontmatter, lifecycle: 'invalid' } })) };
  });
  const lint = await service.lint();
  expect(lint.issues.some(issue => issue.code === 'invalid_lifecycle')).toBe(false);
});

test('cached lint verification propagates genuine IO failure', async () => {
  await seed('Concept.md');
  await service.lint();
  vi.spyOn((fs as any).vaultIo, 'readUtf8Metadata').mockRejectedValue(Object.assign(new Error('storage offline'), { code: 'EIO' }));
  await expect(service.lint()).rejects.toThrow('storage offline');
});

test('a deleted known owner invalidates cached collision and validation totals', async () => {
  await seed('A-owner.md', { aliases: ['shared'], llm_wiki_type: 'knowledge' });
  await seed('B.md', { aliases: ['shared'] });
  expect((await service.lint()).errors).toBeGreaterThan(0);
  await rm(join(vault, 'A-owner.md'));
  const report = await service.lint();
  expect(report).toMatchObject({ healthy: true, errors: 0, warnings: 0, issues: [] });
});

test('public response limits do not truncate internal validation error totals', async () => {
  for (let i = 0; i < 4; i++) await seed(`Knowledge-${i}.md`, { llm_wiki_type: 'knowledge', lifecycle: 'invalid' });
  const full = await service.lint(undefined, 500);
  const minimal = await service.lint(undefined, 0);
  const publicReport: any = await service.lintReport(undefined, 1, 512);
  expect(full.errors).toBeGreaterThan(1);
  expect(minimal).toMatchObject({ healthy: false, errors: full.errors, warnings: full.warnings, issues: [], truncated: true });
  expect(publicReport).toMatchObject({ healthy: false, errors: full.errors, warnings: full.warnings, truncated: true });
  expect(publicReport.issues).toHaveLength(1);
});

test('organization aggregation rejects an owner changed after its lint', async () => {
  await seed('Concept.md', { llm_wiki_type: 'knowledge', lifecycle: 'invalid' });
  const graph = service.graphHealth.bind(service);
  vi.spyOn(service, 'graphHealth').mockImplementation(async (...args) => {
    await seed('Concept.md', { moderation_status: 'hidden' });
    return graph(...args);
  });
  await expect(service.organizationHealth()).rejects.toThrow(/changed|retry/i);
});

test('public lint obeys whole budgets and retains one repair action', async () => {
  await seed('Concept.md', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'invalid', summary: 's'.repeat(12000), authority_id: 'id'.repeat(600) });
  for (const maxChars of [512, 600, 1000, 7000, 16000]) {
    const lint: any = await (service as any).lintReport(undefined, 200, maxChars);
    expect(JSON.stringify(lint).length).toBeLessThanOrEqual(maxChars);
    expect(lint.issues.length).toBeGreaterThan(0);
    expect(lint.nextAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'Concept.md' } });
  }
});

test('organization health obeys whole budgets while keeping a real repair finding', async () => {
  await seed('Concept.md', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'invalid', summary: 's'.repeat(12000), authority_id: 'id'.repeat(600) });
  for (const maxChars of [512, 600, 1000, 7000, 16000]) {
    const health: any = await service.organizationHealth(undefined, 30, maxChars);
    expect(JSON.stringify(health).length).toBeLessThanOrEqual(maxChars);
    expect(health.issues.length).toBeGreaterThan(0);
  }
});

test('long lint identities return an exact original-arguments retry', async () => {
  const path = Array.from({ length: 8 }, (_, i) => `${i}-${'folder'.repeat(10)}`).join('/') + '/Concept.md';
  await seed(path, { llm_wiki_type: 'knowledge', lifecycle: 'invalid' });
  const lint: any = await (service as any).lintReport(undefined, 200, 512);
  expect(JSON.stringify(lint).length).toBeLessThanOrEqual(512);
  expect(lint.retry).toEqual({ endpointId: 'mcp.lint_wiki', reuseOriginalArguments: true, overrides: { maxChars: 16000 } });
  const health: any = await service.organizationHealth(undefined, 30, 512);
  expect(JSON.stringify(health).length).toBeLessThanOrEqual(512);
  expect(health.retry).toEqual({ endpointId: 'wiki.organization_health', reuseOriginalArguments: true, overrides: { maxChars: 16000 } });
});
