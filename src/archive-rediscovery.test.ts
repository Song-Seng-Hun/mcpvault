import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { VaultGraphIndex } from './vault-graph.js';
import { VaultMetadataIndex } from './vault-index.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';

let vault: string;
let fs: FileSystemService;
let service: LlmWikiService;
let graph: VaultGraphIndex | undefined;
let metadataIndex: VaultMetadataIndex | undefined;
const principal = { accountId: 'worker', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
function setup(indexed = false) {
  if (indexed) graph = new VaultGraphIndex(vault, new PathFilter(), new FrontmatterHandler());
  fs = new FileSystemService(vault, undefined, undefined, undefined, undefined, graph);
  const access = new ScopeAccessPolicy();
  service = new LlmWikiService(fs, access, new ReferenceService(fs, access));
}
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'mcpvault-archive-')); setup(); });
afterEach(async () => { vi.restoreAllMocks(); graph?.close(); graph = undefined; await metadataIndex?.close(); metadataIndex = undefined; await rm(vault, { recursive: true, force: true }); });
async function seed(path: string, fields = 'lifecycle: archived', body = 'Preserved knowledge.') {
  const raw = `---\nllm_wiki_type: knowledge\n${fields}\n---\n${body}`;
  await mkdir(dirname(join(vault, path)), { recursive: true });
  await writeFile(join(vault, path), raw);
  return raw;
}
const digest = (raw: string) => createHash('sha256').update(raw).digest('hex');

test.each([false, true])('archive previews distinct referring documents instead of repeated links with indexed=%s', async indexed => {
  setup(indexed);
  await seed('Old.md');
  await seed('AReader.md', '', Array(12).fill('[[Old]]').join('\n'));
  for (const name of ['BReader', 'CReader', 'DReader']) await seed(`${name}.md`, '', 'A distinct use of [[Old]]');
  const result: any = await service.resurfaceArchivedKnowledge(undefined, 8, 12000);
  expect(result.items[0].referringNotes.map((note: any) => note.path)).toEqual(['AReader.md', 'BReader.md', 'CReader.md', 'DReader.md']);
  expect(result.items[0]).toMatchObject({ incomingLinks: 15, incomingLinksAdvisory: true, referenceScanTruncated: false });
  expect(result.items[0].referencesNextAction).toBeUndefined();
});

test('archive can use a later fresh author when the first repeated author is stale', async () => {
  setup(true);
  await seed('Old.md');
  await seed('AReader.md', '', Array(10).fill('Obsolete [[Old]]').join('\n'));
  const valid = await seed('BReader.md', '', 'Current [[Old]] context');
  await fs.getBacklinks('Old.md');
  vi.spyOn(graph as any, 'ensure').mockResolvedValue(undefined);
  await seed('AReader.md', '', 'No longer refers to it.');
  const result: any = await service.resurfaceArchivedKnowledge(undefined, 8, 12000);
  expect(result.items).toHaveLength(1);
  expect(result.items[0].referringNotes).toEqual([expect.objectContaining({ path: 'BReader.md', revision: digest(valid) })]);
  expect(JSON.stringify(result)).not.toContain('Obsolete');
});

test('archive caps reference probes and returns an exact authorized backlink continuation', async () => {
  setup(true);
  const folder = '_scopes/agents/worker/';
  await seed(`${folder}Old.md`);
  await seed(`${folder}AReader.md`, '', Array(80).fill('[[Old]]').join('\n'));
  await seed(`${folder}BReader.md`, '', 'Later [[Old]]');
  const probe = vi.spyOn(fs, 'getBacklinks');
  const result: any = await service.resurfaceArchivedKnowledge(principal, 8, 12000);
  expect(probe.mock.calls).toHaveLength(1);
  expect(probe.mock.calls[0]![1]).toBe(64);
  expect(result.items[0].referringNotes).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ referenceScanTruncated: true, referencesNextAction: {
    endpointId: 'mcp.get_backlinks', arguments: { path: 'scope://agent/worker/Old.md', offset: 64, limit: 20, maxChars: 3000 },
  } });
  expect(JSON.stringify(result)).not.toMatch(/_scopes|accessToken/);
});

test('exhausting stale reference samples is incomplete, not proof that no useful archive exists', async () => {
  setup(true);
  await seed('Old.md');
  await seed('AReader.md', '', Array(80).fill('Obsolete [[Old]]').join('\n'));
  await seed('BReader.md', '', 'Later current [[Old]]');
  await fs.getBacklinks('Old.md');
  vi.spyOn(graph as any, 'ensure').mockResolvedValue(undefined);
  await seed('AReader.md', '', 'No longer refers to it.');
  const result: any = await service.resurfaceArchivedKnowledge(undefined, 8, 12000);
  expect(result).toMatchObject({ items: [], truncated: true, referenceScanTruncated: true,
    referencesNextAction: { endpointId: 'mcp.get_backlinks', arguments: { path: 'Old.md', offset: 64 } } });
  expect(JSON.stringify(result)).not.toContain('Obsolete');
});

test.each(['hidden', 'edited', 'deleted'])('reference follow-up never exposes a target observed %s at its final check', async change => {
  setup(true);
  await seed('Old.md');
  await seed('Reader.md', '', Array(80).fill('[[Old]]').join('\n'));
  const validate = (service as any).currentMaintenanceCandidates.bind(service);
  vi.spyOn(service as any, 'currentMaintenanceCandidates').mockImplementation(async (...args: unknown[]) => {
    const result = await validate(...args);
    if (change === 'deleted') await rm(join(vault, 'Old.md'));
    else await seed('Old.md', change === 'hidden' ? 'lifecycle: archived\nmoderation_status: hidden' : 'lifecycle: evergreen');
    return result;
  });
  const result: any = await service.resurfaceArchivedKnowledge(undefined, 8, 12000);
  expect(result.items).toEqual([]);
  expect(result.referencesNextAction).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('Old.md');
});

test('reference continuation metadata also respects the smallest whole-response budgets', async () => {
  setup(true);
  await seed('Old.md');
  await seed('Reader.md', '', Array(80).fill('[[Old]]').join('\n'));
  for (const budget of [512, 700, 1200]) {
    const result: any = await service.resurfaceArchivedKnowledge(undefined, 8, budget);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(budget);
    expect(result.truncated).toBe(true);
    expect(result.referencesNextAction || result.retry).toBeTruthy();
  }
});

test('archive excludes hidden and foreign notes before counts and probing', async () => {
  await seed('Visible.md');
  for (const status of ['hidden', 'removed', 'quarantined']) await seed(`${status}.md`, `lifecycle: archived\nmoderation_status: ${status}`);
  await seed('_scopes/agents/other/Secret.md');
  await seed('Reader.md', '', '[[Visible]] [[hidden]] [[removed]] [[quarantined]] [[Secret]]');
  const result: any = await service.resurfaceArchivedKnowledge();
  expect(result).toMatchObject({ totalInactive: 1, probed: 1 });
  expect(result.items.map((x: any) => x.path)).toEqual(['Visible.md']);
});

test.each(['hidden', 'reactivated', 'deleted'])('archive omits %s metadata changed after discovery', async change => {
  await seed('Old.md');
  await seed('Reader.md', '', '[[Old]]');
  const query = fs.queryNotes.bind(fs);
  vi.spyOn(fs, 'queryNotes').mockImplementation(async (...args) => {
    const result = await query(...args);
    if (change === 'deleted') await rm(join(vault, 'Old.md'), { force: true });
    else await seed('Old.md', change === 'hidden' ? 'lifecycle: archived\nmoderation_status: hidden' : 'lifecycle: evergreen');
    return result;
  });
  expect(await service.resurfaceArchivedKnowledge()).toMatchObject({ items: [], totalInactive: 0 });
});

test('archive bounds the whole JSON with exact revision-bearing reads and no mutation', async () => {
  const raw = await seed('Old.md', `lifecycle: archived\ntitle: ${'title '.repeat(300)}\nretention_reason: ${'reason '.repeat(100)}`);
  await seed('Reader.md', '', `${'context '.repeat(100)} [[Old]]`);
  for (const budget of [512, 600, 900, 1600, 5000]) {
    const result: any = await service.resurfaceArchivedKnowledge(undefined, 8, budget);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(budget);
    expect(result.items[0]).toMatchObject({ path: 'Old.md', revision: digest(raw), nextAction: {
      endpointId: 'notes.read', arguments: { path: 'Old.md', maxChars: 3000 },
    } });
  }
  expect(await readFile(join(vault, 'Old.md'), 'utf8')).toBe(raw);
});

test('archive reaches later path windows while keeping recommendation truncation distinct', async () => {
  for (let i = 0; i < 23; i++) await seed(`A${String(i).padStart(2, '0')}.md`);
  await seed('Reader.md', '', '[[A00]] [[A01]] [[A22]]');
  const first: any = await service.resurfaceArchivedKnowledge(undefined, 1, 5000);
  expect(first).toMatchObject({ totalInactive: 23, probed: 20, selectionTruncated: true,
    nextScan: { endpointId: 'wiki.resurface_archives', arguments: { afterPath: 'A19.md', limit: 1, maxChars: 5000 } } });
  const args = first.nextScan.arguments;
  const second: any = await service.resurfaceArchivedKnowledge(undefined, args.limit, args.maxChars, args.afterPath);
  expect(second).toMatchObject({ totalInactive: 23, probed: 3, selectionTruncated: false });
  expect(second.items.map((x: any) => x.path)).toEqual(['A22.md']);
  expect(second.nextScan).toBeUndefined();
});

test.each(['../outside.md', 'C:/outside.md', '/outside.md', '.git/config', 'scope://agent/other/Secret.md', 'x'.repeat(1025)])('archive rejects unsafe cursor %s', async afterPath => {
  await expect(service.resurfaceArchivedKnowledge(undefined, 1, 5000, afterPath)).rejects.toThrow();
});

test('archive cursor and reads preserve authorized scope URIs', async () => {
  for (let i = 0; i < 21; i++) await seed(`_scopes/agents/worker/A${String(i).padStart(2, '0')}.md`);
  await seed('_scopes/agents/worker/Reader.md', '', '[[A20]]');
  const first: any = await service.resurfaceArchivedKnowledge(principal, 1, 5000);
  expect(first.nextScan.arguments.afterPath).toBe('scope://agent/worker/A19.md');
  const second: any = await service.resurfaceArchivedKnowledge(principal, 1, 5000, first.nextScan.arguments.afterPath);
  expect(second.items[0]).toMatchObject({ path: 'scope://agent/worker/A20.md',
    nextAction: { arguments: { path: 'scope://agent/worker/A20.md' } } });
  expect(JSON.stringify(second)).not.toContain('_scopes');
});

test('archive rejects real storage failure instead of silently returning no candidates', async () => {
  await seed('Old.md');
  vi.spyOn((fs as any).vaultIo, 'readUtf8').mockRejectedValue(Object.assign(new Error('storage unavailable'), { code: 'EIO' }));
  await expect(service.resurfaceArchivedKnowledge()).rejects.toThrow('storage unavailable');
});

test('archive never exposes a raw hidden or private replacement', async () => {
  await seed('A.md', 'lifecycle: archived\nreplaced_by: "[[Hidden]]"');
  await seed('B.md', 'lifecycle: archived\nreplaced_by: "[[_scopes/agents/other/Secret]]"');
  await seed('C.md', 'lifecycle: superseded\nreplaced_by: "[[Current]]"');
  await seed('Hidden.md', 'moderation_status: hidden');
  await seed('_scopes/agents/other/Secret.md', '');
  const raw = await seed('Current.md', '');
  await seed('Reader.md', '', '[[A]] [[B]] [[C]]');
  const result: any = await service.resurfaceArchivedKnowledge(undefined, 8, 12000);
  expect(JSON.stringify(result)).not.toMatch(/Hidden|Secret/);
  expect(result.items.find((x: any) => x.path === 'C.md')).toMatchObject({ replacedBy: 'Current.md', replacementRevision: digest(raw) });
});

test.each([false, true])('backlinks opt-in pins context to the parsed source revision (indexed=%s)', async indexed => {
  setup(indexed);
  await seed('Old.md');
  const raw = await seed('Reader.md', '', '[[Old]]');
  expect((await fs.getBacklinks('Old.md')).backlinks[0]).not.toHaveProperty('sourceRevision');
  const result = await fs.getBacklinks('Old.md', 4, () => true, 0, { includeSourceRevision: true });
  expect(result.backlinks[0]).toMatchObject({ sourceRevision: digest(raw) });
});

test('archive never relabels obsolete indexed context with a new source revision', async () => {
  setup(true);
  await seed('Old.md');
  const old = await seed('Reader.md', '', 'Obsolete [[Old]]');
  await fs.getBacklinks('Old.md');
  vi.spyOn(graph as any, 'ensure').mockResolvedValue(undefined);
  await seed('Reader.md', '', 'Corrected, no longer references the archive.');
  const links = await fs.getBacklinks('Old.md', 4, () => true, 0, { includeSourceRevision: true });
  expect(links.backlinks[0]?.sourceRevision).toBe(digest(old));
  expect(await service.resurfaceArchivedKnowledge()).toMatchObject({ items: [] });
});

test.each(['hidden', 'edited', 'deleted'])('archive discards preview sources %s after backlink discovery', async change => {
  await seed('Old.md');
  await seed('Reader.md', '', '[[Old]]');
  const backlinks = fs.getBacklinks.bind(fs);
  vi.spyOn(fs, 'getBacklinks').mockImplementation(async (...args) => {
    const result = await backlinks(...args);
    if (change === 'deleted') await rm(join(vault, 'Reader.md'));
    else await seed('Reader.md', change === 'hidden' ? 'moderation_status: hidden' : '', 'Changed context');
    return result;
  });
  expect(await service.resurfaceArchivedKnowledge()).toMatchObject({ items: [] });
});

test('archive refuses to mix metadata and a changed candidate revision', async () => {
  await seed('Old.md', 'lifecycle: archived\ntitle: Old title');
  await seed('Reader.md', '', '[[Old]]');
  const backlinks = fs.getBacklinks.bind(fs);
  vi.spyOn(fs, 'getBacklinks').mockImplementation(async (...args) => {
    const result = await backlinks(...args);
    await seed('Old.md', 'lifecycle: evergreen\ntitle: New title');
    return result;
  });
  expect(await service.resurfaceArchivedKnowledge()).toMatchObject({ items: [] });
});

test('archive scan cursor uses the inventory natural ordering without repeating earlier names', async () => {
  for (let i = 1; i <= 23; i++) await seed(`A${i}.md`);
  const first: any = await service.resurfaceArchivedKnowledge(undefined, 1);
  expect(first.nextScan.arguments.afterPath).toBe('A20.md');
  const second: any = await service.resurfaceArchivedKnowledge(undefined, 1, 5000, first.nextScan.arguments.afterPath);
  expect(second.probed).toBe(3);
  expect(second.nextScan).toBeUndefined();
});

test('archive recommendation truncation includes items dropped for the response budget', async () => {
  for (let i = 0; i < 3; i++) await seed(`A${i}.md`);
  await seed('Reader.md', '', '[[A0]] [[A1]] [[A2]]');
  const result: any = await service.resurfaceArchivedKnowledge(undefined, 3, 512);
  expect(result).toMatchObject({ selectionTruncated: true, truncated: true });
  expect(result.items).toHaveLength(1);
});

test('archive long-path retry preserves both window limit and cursor and returns exact paths', async () => {
  const prefix = Array.from({ length: 8 }, (_, i) => `${i}-${'segment'.repeat(7)}`).join('/');
  for (let i = 0; i < 21; i++) await seed(`${prefix}/A${String(i).padStart(2, '0')}.md`);
  await seed('Reader.md', '', `[[${prefix}/A20]]`);
  const first: any = await service.resurfaceArchivedKnowledge(undefined, 1, 512);
  expect(JSON.stringify(first).length).toBeLessThanOrEqual(512);
  expect(first.retry).toEqual({ endpointId: 'wiki.resurface_archives', reuseOriginalArguments: true, overrides: { maxChars: 12000 } });
  const expanded: any = await service.resurfaceArchivedKnowledge(undefined, 1, first.retry.overrides.maxChars);
  const cursor = expanded.nextScan.arguments.afterPath;
  const small: any = await service.resurfaceArchivedKnowledge(undefined, 1, 512, cursor);
  expect(small.retry.reuseOriginalArguments).toBe(true);
  const next: any = await service.resurfaceArchivedKnowledge(undefined, 1, small.retry.overrides.maxChars, cursor);
  expect(next.items[0].path).toBe(`${prefix}/A20.md`);
});

test('archive can reach a referenced note after the maximum 200-note window', async () => {
  setup(true);
  for (let i = 0; i < 201; i += 8) await Promise.all(Array.from({ length: Math.min(8, 201 - i) }, (_, n) => seed(`A${String(i + n).padStart(3, '0')}.md`)));
  await seed('Reader.md', '', '[[A200]]');
  // Match the deployed server's metadata + graph indexes for this larger
  // integration fixture. The other window/privacy tests cover the raw fallback.
  metadataIndex = new VaultMetadataIndex(vault, new PathFilter(), new FrontmatterHandler());
  fs = new FileSystemService(vault, undefined, undefined, undefined, metadataIndex, graph);
  const access = new ScopeAccessPolicy();
  service = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const first: any = await service.resurfaceArchivedKnowledge(undefined, 20, 5000);
  expect(first).toMatchObject({ probed: 200, items: [], nextScan: { arguments: { afterPath: 'A199.md' } } });
  const second: any = await service.resurfaceArchivedKnowledge(undefined, 20, 5000, first.nextScan.arguments.afterPath);
  expect(second.items[0].path).toBe('A200.md');
}, 15_000); // Full filesystem/index integration, not a five-second latency SLA.

test('archive suppresses a scan cursor hidden during candidate lookup', async () => {
  for (let i = 0; i < 21; i++) await seed(`A${String(i).padStart(2, '0')}.md`);
  await seed('Reader.md', '', '[[A00]]');
  const backlinks = fs.getBacklinks.bind(fs);
  vi.spyOn(fs, 'getBacklinks').mockImplementation(async (...args) => {
    const result = await backlinks(...args);
    if (args[0] === 'A00.md') await seed('A19.md', 'lifecycle: archived\nmoderation_status: hidden');
    return result;
  });
  const result: any = await service.resurfaceArchivedKnowledge(undefined, 1, 512);
  expect(result).toMatchObject({ reason: 'scan_changed_retry_same_request', retry: { reuseOriginalArguments: true } });
  expect(JSON.stringify(result)).not.toContain('A19');
});

test.each(['hidden', 'edited', 'deleted'])('archive revalidates a replacement %s after resolution', async change => {
  await seed('Old.md', 'lifecycle: archived\nreplaced_by: "[[Replacement]]"');
  await seed('Reader.md', '', '[[Old]]');
  await seed('Replacement.md', '');
  const lookup = fs.findPathForWikiLink.bind(fs);
  const metadata = fs.readNoteMetadata.bind(fs);
  let resolving = false;
  vi.spyOn(fs, 'findPathForWikiLink').mockImplementation(async (...args) => { resolving = true; return lookup(...args); });
  vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
    const result = await metadata(...args);
    if (resolving && args[0].includes('Replacement.md')) {
      resolving = false;
      if (change === 'deleted') await rm(join(vault, 'Replacement.md'));
      else await seed('Replacement.md', change === 'hidden' ? 'moderation_status: hidden' : '', 'Changed replacement');
    }
    return result;
  });
  const result: any = await service.resurfaceArchivedKnowledge();
  expect(result.items[0]).toMatchObject({ replacementState: 'unavailable' });
  expect(result.items[0]).not.toHaveProperty('replacedBy');
});

test('archive final check removes a source changed during replacement hydration', async () => {
  await seed('Old.md', 'lifecycle: archived\nreplaced_by: "[[Replacement]]"');
  await seed('Reader.md', '', '[[Old]]');
  await seed('Replacement.md', '');
  const lookup = fs.findPathForWikiLink.bind(fs);
  vi.spyOn(fs, 'findPathForWikiLink').mockImplementation(async (...args) => {
    const result = await lookup(...args);
    await seed('Reader.md', 'moderation_status: hidden', 'Hidden context');
    return result;
  });
  expect(await service.resurfaceArchivedKnowledge()).toMatchObject({ items: [] });
});

test('archive rejects an indexed edge resolved against an obsolete target alias', async () => {
  setup(true);
  const old = await seed('Old.md', 'lifecycle: archived\naliases: [FormerName]');
  await seed('Reader.md', '', '[[FormerName]]');
  await fs.getBacklinks('Old.md');
  vi.spyOn(graph as any, 'ensure').mockResolvedValue(undefined);
  await seed('Old.md', 'lifecycle: archived\naliases: [NewName]');
  const result = await fs.getBacklinks('Old.md', 4, () => true, 0, { includeSourceRevision: true });
  expect(result).toMatchObject({ targetRevision: digest(old) });
  expect(await service.resurfaceArchivedKnowledge()).toMatchObject({ items: [] });
});

test('archive reports a backlink lookup failure when the target still exists', async () => {
  await seed('Old.md');
  vi.spyOn(fs, 'getBacklinks').mockRejectedValue(new Error('graph storage unavailable'));
  await expect(service.resurfaceArchivedKnowledge()).rejects.toThrow('graph storage unavailable');
});

test('archive tolerates target deletion during backlink lookup without hiding genuine errors', async () => {
  await seed('Old.md');
  vi.spyOn(fs, 'getBacklinks').mockImplementation(async () => {
    await rm(join(vault, 'Old.md'));
    throw Object.assign(new Error('gone'), { code: 'ENOENT' });
  });
  expect(await service.resurfaceArchivedKnowledge()).toMatchObject({ items: [] });
});

test('archive rejects absolute or traversal cursors even when filesystem compatibility resolves them', async () => {
  await seed('Old.md');
  for (const afterPath of ['/Old.md', '\\Old.md', join(vault, 'Old.md'), 'nested/../Old.md']) {
    await expect(service.resurfaceArchivedKnowledge(undefined, 1, 5000, afterPath)).rejects.toThrow();
  }
});

test('archive freshness scan overlaps IO with a bounded eight-read fanout', async () => {
  await Promise.all(Array.from({ length: 16 }, (_, i) => seed(`A${i}.md`)));
  const read = fs.readNoteMetadata.bind(fs);
  let active = 0;
  let maximum = 0;
  vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
    active++;
    maximum = Math.max(maximum, active);
    try { return await read(...args); } finally { active--; }
  });
  // Start after every inactive note, isolating the inventory/counting phase
  // from the already-parallel backlink probe phase.
  expect(await service.resurfaceArchivedKnowledge(undefined, 1, 5000, 'A15.md')).toMatchObject({ totalInactive: 16, probed: 0 });
  expect(maximum).toBeGreaterThan(1);
  expect(maximum).toBeLessThanOrEqual(8);
});

test('indexed backlinks reuse a scope-local reverse view instead of rescanning every author per target', async () => {
  setup(true);
  await Promise.all(Array.from({ length: 21 }, (_, i) => seed(`A${i}.md`)));
  await seed('Reader.md', '', '[[A20]]');
  const canAccess = vi.fn(() => true);
  await fs.getBacklinks('A0.md', 4, canAccess);
  const initialCalls = canAccess.mock.calls.length;
  for (let i = 1; i < 21; i++) {
    const result = await fs.getBacklinks(`A${i}.md`, 4, canAccess);
    expect(result.total).toBe(i === 20 ? 1 : 0);
  }
  expect(canAccess.mock.calls.length - initialCalls).toBeLessThan(100);
  // A distinct caller predicate must not reuse another scope's resolver.
  expect(await fs.getBacklinks('A20.md', 4, path => path !== 'Reader.md')).toMatchObject({ total: 0, backlinks: [] });
});

test('indexed reverse lookup still checks current access and moderation on matching authors', async () => {
  setup(true);
  await seed('Old.md');
  await seed('Reader.md', '', '[[Old]]');
  let readable = true;
  const canAccess = (path: string) => path !== 'Reader.md' || readable;
  expect((await fs.getBacklinks('Old.md', 4, canAccess)).total).toBe(1);
  readable = false;
  expect((await fs.getBacklinks('Old.md', 4, canAccess)).total).toBe(0);
  readable = true;
  vi.spyOn(graph as any, 'ensure').mockResolvedValue(undefined);
  await seed('Reader.md', 'moderation_status: hidden', '[[Old]]');
  expect((await fs.getBacklinks('Old.md', 4, canAccess)).total).toBe(0);
});

test('oversized reverse lookup falls back without dropping edges or changing pagination', async () => {
  setup(true);
  await seed('Old.md');
  await seed('Reader.md', '', Array.from({ length: 16385 }, () => '[[Old]]').join('\n'));
  const result = await fs.getBacklinks('Old.md', 2, () => true, 16383);
  expect(result).toMatchObject({ total: 16385, truncated: false });
  expect(result.backlinks).toHaveLength(2);
});

test('indexed reverse lookup is rebuilt after a graph generation change', async () => {
  setup(true);
  await seed('Old.md');
  await seed('Other.md');
  await seed('Reader.md', '', '[[Old]]');
  const canAccess = () => true;
  expect((await fs.getBacklinks('Old.md', 4, canAccess)).total).toBe(1);
  await seed('Reader.md', '', '[[Other]]');
  graph!.invalidate('Reader.md');
  expect((await fs.getBacklinks('Old.md', 4, canAccess)).total).toBe(0);
  expect((await fs.getBacklinks('Other.md', 4, canAccess)).total).toBe(1);
});

test('raw backlinks hash each source once rather than once per occurrence', async () => {
  await seed('Old.md');
  const raw = await seed('Reader.md', '', Array.from({ length: 100 }, () => '[[Old]]').join('\n'));
  const hashes = vi.spyOn(fs as any, 'revision');
  const result = await fs.getBacklinks('Old.md', 4, () => true, 0, { includeSourceRevision: true });
  expect(result).toMatchObject({ total: 100, truncated: true });
  expect(result.backlinks.every(link => link.sourceRevision === digest(raw))).toBe(true);
  expect(hashes.mock.calls.filter(([content]) => content === raw)).toHaveLength(1);
});
