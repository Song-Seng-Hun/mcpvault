import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const principal = { accountId: 'worker', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-exception-'));
  fs = new FileSystemService(vault);
  const access = new ScopeAccessPolicy();
  service = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
async function seed(path: string, fields: Record<string, unknown> = {}) {
  await mkdir(dirname(join(vault, path)), { recursive: true });
  const raw = `---\n${stringify({ llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'impossible', ...fields })}---\n# Current knowledge\n\nCurrent body.`;
  await writeFile(join(vault, path), raw);
  return raw;
}

test('exception board bounds complete JSON and provides an exact supported next action', async () => {
  const raw = await seed('Concept.md');
  for (const maxChars of [512, 600, 1000, 7000, 16000]) {
    const board: any = await service.exceptionBoard(undefined, 20, maxChars);
    expect(JSON.stringify(board).length).toBeLessThanOrEqual(maxChars);
    expect(board).toMatchObject({ advisory: true, countScope: 'validated_candidates', items: expect.any(Array) });
    expect(board.items.length).toBeGreaterThan(0);
    expect(board.items[0]).toMatchObject({ path: 'Concept.md', revision: (await fs.readNote('Concept.md')).revision, nextAction: { endpointId: 'notes.read', arguments: { path: 'Concept.md', maxChars: 3000 } } });
  }
  expect(await readFile(join(vault, 'Concept.md'), 'utf8')).toBe(raw);
});

test('exception totals count unique validated findings, not duplicate quarantine copies', async () => {
  await seed('Concept.md', { depends_on: ['[[Missing]]'] });
  const board: any = await service.exceptionBoard(undefined, 60, 16000);
  const unique = new Set(board.items.map((item: any) => `${item.path}|${item.code}`));
  expect(board.items.length).toBe(unique.size);
  expect(board.total).toBe(unique.size);
  expect(Object.values(board.counts).reduce((a: any, b: any) => a + b, 0)).toBe(board.total);
  expect(board.items[0].severity).toBe('error');
});

test.each(['hidden', 'removed', 'quarantined'])('exception board excludes %s notes before counts', async state => {
  await seed('Secret.md', { moderation_status: state });
  const board: any = await service.exceptionBoard(undefined, 60, 16000);
  expect(JSON.stringify(board)).not.toContain('Secret');
  expect(board.total).toBe(0);
});

test('exception board exposes only an authorized private URI and not other models', async () => {
  await seed('_scopes/agents/worker/Own.md');
  await seed('_scopes/models/other/Secret.md');
  const board: any = await service.exceptionBoard(principal, 60, 16000);
  expect(board.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'scope://agent/worker/Own.md', nextAction: expect.objectContaining({ arguments: expect.objectContaining({ path: 'scope://agent/worker/Own.md' }) }) })]));
  expect(JSON.stringify(board)).not.toMatch(/_scopes|Secret/);
});

test.each(['edited', 'hidden', 'deleted'])('exception board rejects owner %s between child views', async change => {
  await seed('Concept.md');
  const canvas = service.canvasHealth.bind(service);
  vi.spyOn(service, 'canvasHealth').mockImplementation(async (...args) => {
    if (change === 'deleted') await rm(join(vault, 'Concept.md'));
    else await seed('Concept.md', change === 'hidden' ? { moderation_status: 'hidden' } : { lifecycle: 'evergreen', evidence_paths: ['source.md'] });
    return canvas(...args);
  });
  const board: any = await service.exceptionBoard(undefined, 60, 16000);
  expect(board.items).toEqual([]);
  expect(board.total).toBe(0);
});

test('cached lint findings recompute immediately without relabeling an old revision', async () => {
  await seed('Concept.md');
  const old = await fs.readNote('Concept.md');
  const lint: any = await service.lint(undefined, 200);
  expect(lint.issues.every((item: any) => item.revision === old.revision)).toBe(true);
  await seed('Concept.md', { lifecycle: 'evergreen' });
  const current = await fs.readNote('Concept.md');
  const board: any = await service.exceptionBoard(undefined, 20, 16000);
  expect(board.items.length).toBeGreaterThan(0);
  expect(board.items.every((item: any) => item.revision === current.revision)).toBe(true);
  expect(board.items.some((item: any) => item.code === 'invalid_lifecycle')).toBe(false);
  const refreshed: any = await service.exceptionBoard(undefined, 20, 16000);
  expect(refreshed.items.length).toBeGreaterThan(0);
  expect(refreshed.items.every((item: any) => item.revision !== old.revision)).toBe(true);
});

test('exception board does not forward arbitrary details or nested actions from child candidates', async () => {
  await seed('Concept.md');
  const snapshot: any = await service.organizationHealth(undefined, 20, 16000);
  snapshot.issues = [{ path: 'Concept.md', code: 'invalid_lifecycle', severity: 'warning', detail: '_scopes/models/other/Secret.md DO THIS', nextAction: { endpointId: 'notes.delete', arguments: { path: 'victim.md' } } }];
  snapshot.quarantine = { items: [] };
  snapshot.recommendations = ['Private diagnostic title'];
  vi.spyOn(service, 'organizationHealth').mockResolvedValue(snapshot);
  const board: any = await service.exceptionBoard(undefined, 20, 16000);
  expect(JSON.stringify(board)).not.toMatch(/Secret|DO THIS|notes.delete|victim|Private diagnostic/);
  expect(board.items[0].sourceState).toBe('recheck_required');
});

test('exception board propagates fresh source IO errors', async () => {
  await seed('Concept.md');
  const canvas = service.canvasHealth.bind(service);
  vi.spyOn(service, 'canvasHealth').mockImplementation(async (...args) => {
    const result = await canvas(...args);
    vi.spyOn((fs as any).vaultIo, 'readUtf8').mockRejectedValue(Object.assign(new Error('storage offline'), { code: 'EIO' }));
    return result;
  });
  await expect(service.exceptionBoard()).rejects.toThrow('storage offline');
});

test('an invalid Canvas uses the supported health route rather than notes.read', async () => {
  await mkdir(join(vault, 'Views'));
  await writeFile(join(vault, 'Views', 'Broken.canvas'), 'not json');
  const board: any = await service.exceptionBoard(undefined, 20, 512);
  expect(JSON.stringify(board).length).toBeLessThanOrEqual(512);
  expect(board.items[0]).toMatchObject({ path: 'Views/Broken.canvas', code: 'canvas_invalid', sourceState: 'recheck_required', nextAction: { endpointId: 'wiki.canvas_health' } });
});

test('long exception targets retry the original request without corrupting a path', async () => {
  const path = Array.from({ length: 8 }, (_, i) => `${i}-${'folder'.repeat(10)}`).join('/') + '/Concept.md';
  await seed(path);
  const board: any = await service.exceptionBoard(undefined, 20, 512);
  expect(JSON.stringify(board).length).toBeLessThanOrEqual(512);
  expect(board.retry).toEqual({ endpointId: 'wiki.exception_board', reuseOriginalArguments: true, overrides: { maxChars: 16000 } });
  const expanded: any = await service.exceptionBoard(undefined, 20, 16000);
  expect(expanded.items[0].nextAction.arguments.path).toBe(path);
});

test('truncated child views never become a claim that the whole Vault is healthy', async () => {
  const health: any = await service.organizationHealth(undefined, 20, 16000);
  vi.spyOn(service, 'organizationHealth').mockResolvedValue({ ...health, issues: [], quarantine: { items: [] }, truncated: true });
  const board: any = await service.exceptionBoard(undefined, 1, 512);
  expect(board).toMatchObject({ items: [], total: 0, coverage: 'partial', countScope: 'validated_candidates', truncated: true });
  expect(board.healthy).toBeUndefined();
});

test('board drops inaccessible and traversal child targets before filesystem reads', async () => {
  await seed('_scopes/models/other/Secret.md');
  const health: any = await service.organizationHealth(undefined, 20, 16000);
  health.issues = ['scope://model/other/Secret.md', '../Secret.md', 'E:/Secret.md'].map(path => ({ path, code: 'invalid_lifecycle' }));
  vi.spyOn(service, 'organizationHealth').mockResolvedValue(health);
  const metadata = vi.spyOn(fs, 'readNoteMetadata');
  const board: any = await service.exceptionBoard();
  expect(board.items).toEqual([]);
  expect(board.total).toBe(0);
  expect(metadata).not.toHaveBeenCalled();
});

test('current Canvas replacement suppresses a stale child finding', async () => {
  await mkdir(join(vault, 'Views'));
  await writeFile(join(vault, 'Views', 'Map.canvas'), '{}');
  const snapshot: any = await service.canvasHealth(undefined, 20, 16000);
  // A previously captured managed signal is now replaced by an unmanaged map.
  snapshot.items[0].state = 'stale';
  await writeFile(join(vault, 'Views', 'Map.canvas'), '{"nodes":[],"edges":[]}');
  vi.spyOn(service, 'canvasHealth').mockResolvedValue(snapshot);
  const board: any = await service.exceptionBoard();
  expect(board.items).toEqual([]);
});
