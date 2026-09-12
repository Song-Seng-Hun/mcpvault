import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { MaintenanceService } from './maintenance-service.js';
import { MaintenanceDerivedService } from './maintenance-derived.js';
import { LlmWikiService } from './llm-wiki.js';
import { ReferenceService } from './references.js';
import type { MaintenanceHost, MaintenanceConfig } from './maintenance-host.js';

let vault: string, fs: FileSystemService, access: ScopeAccessPolicy;
let config: MaintenanceConfig, durable: any, services: MaintenanceService[];
let host: MaintenanceHost;
const actor = { accountId: 'operator', modelId: 'test', agentId: 'worker', role: 'agent' as const };
const authorize = vi.fn(async () => actor);
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'maintenance-worker-'));
  fs = new FileSystemService(vault); access = new ScopeAccessPolicy(); services = [];
  config = { version: 1, enabled: true, accountId: actor.accountId,
    paths: ['Old.md', 'New.md', 'Ref.md'], operations: ['moved_link_repair'] };
  durable = undefined; authorize.mockReset().mockResolvedValue(actor);
  // Only the trusted host adapter is substituted. Vault writes, reference
  // resolution, revision checks, protection and change-set code are real.
  host = {
    refresh: async () => structuredClone(config),
    readState: async () => structuredClone(durable),
    writeState: async value => { durable = structuredClone(value); },
    acquire: async () => ({ assertHeld: async () => {}, close: async () => {} }),
  };
});
afterEach(async () => {
  for (const service of services) await service.close();
  vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true });
});
async function seed(path: string, content: string) {
  await mkdir(dirname(join(vault, path)), { recursive: true }); await writeFile(join(vault, path), content);
}
async function fixture() {
  await seed('Old.md', '---\nllm_wiki_type: knowledge\n---\n# Topic\nEvidence.\n\n## Detail\nBlock. ^proof\n');
  await seed('Ref.md', '---\nllm_wiki_type: knowledge\n---\n# Reference\n[[Old.md#Detail|label]] and [[Old.md#^proof]].\n\n```md\n[[Old.md]]\n```\n');
}
function create(options: Partial<ConstructorParameters<typeof MaintenanceService>[0]> = {}) {
  const service = new MaintenanceService({ fs, access, host, authorize,
    // Explicit flushes own the worker in deterministic tests.
    schedule: () => () => {}, ...options });
  services.push(service); return service;
}
async function move(service: MaintenanceService) {
  return service.move({ oldPath: 'Old.md', newPath: 'New.md', expectedRevision: (await fs.readNote('Old.md')).revision }, actor);
}

test('absent or disabled host configuration never captures or repairs automatically', async () => {
  await fixture(); const before = await readFile(join(vault, 'Ref.md'), 'utf8');
  const service = create({ host: undefined });
  expect((await move(service)).success).toBe(true);
  await service.notify([{ path: 'New.md', kind: 'upsert' }]); await service.flush();
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(before);
  expect(durable).toBeUndefined();
});

test('a closed worker cannot accept another manual move', async () => {
  await fixture(); const service = create(); await service.close();
  await expect(move(service)).rejects.toThrow(/closed/i);
  expect(await fs.noteExists('Old.md')).toBe(true); expect(await fs.noteExists('New.md')).toBe(false);
});

test('host-recorded successful move repairs only exact links and preserves anchors and fences', async () => {
  await fixture(); const service = create();
  const patch = vi.spyOn(fs, 'patchMultipleNotes');
  expect((await move(service)).success).toBe(true); await service.flush();
  const ref = await readFile(join(vault, 'Ref.md'), 'utf8');
  expect(ref).toContain('[[./New.md#Detail|label]]');
  expect(ref).toContain('[[./New.md#^proof]]');
  expect(ref).toContain('```md\n[[Old.md]]\n```');
  expect(patch.mock.calls.some(([p]) => p.dryRun !== false)).toBe(true);
  expect(patch.mock.calls.some(([p]) => p.dryRun === false && /^[a-f0-9]{64}$/.test(p.confirmPlanFingerprint || ''))).toBe(true);
});

test.each(['reference', 'destination', 'old-reused', 'old-reused-removed', 'revoked', 'disabled'])('repair preserves user data after %s change', async kind => {
  await fixture(); const service = create(); expect((await move(service)).success).toBe(true);
  if (kind === 'reference') await seed('Ref.md', '# New user text\n[[Old.md]]');
  if (kind === 'destination') await seed('New.md', '# Different target\nUnrelated.');
  if (kind.startsWith('old-reused')) {
    await fs.writeNote({ path: 'Old.md', content: '# Reused\nA different note.', expectedRevision: 'missing' });
    if (kind === 'old-reused-removed') await fs.deleteNote({ path: 'Old.md', confirmPath: 'Old.md', allowDanglingReferences: true, expectedRevision: (await fs.readNote('Old.md')).revision });
  }
  if (kind === 'revoked') authorize.mockResolvedValue(undefined as any);
  if (kind === 'disabled') config.enabled = false;
  const before = await readFile(join(vault, 'Ref.md'), 'utf8');
  await service.flush();
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(before);
});

test('external moves and incomplete history never become inferred repair authority', async () => {
  await fixture(); const service = create();
  expect((await fs.moveNote({ oldPath: 'Old.md', newPath: 'New.md' })).success).toBe(true);
  const before = await readFile(join(vault, 'Ref.md'), 'utf8');
  await service.notify([{ path: 'Old.md', kind: 'delete' }, { path: 'New.md', kind: 'upsert' }]);
  await service.flush();
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(before);
});

test('failed moves never authorize recovery, even with an existing destination', async () => {
  await fixture(); await seed('New.md', '# Occupied\nExisting user data.');
  const service = create(); const before = await readFile(join(vault, 'Ref.md'), 'utf8');
  expect((await move(service)).success).toBe(false); await service.flush();
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(before);
});

test('successful repair is idempotent across duplicate events and restart', async () => {
  await fixture(); const first = create(); expect((await move(first)).success).toBe(true); await first.flush();
  const before = await fs.readNote('Ref.md'); const patch = vi.spyOn(fs, 'patchMultipleNotes');
  for (let n = 0; n < 4; n++) await first.notify([{ path: 'New.md', kind: 'upsert' }]);
  await first.flush(); await first.close();
  const second = create(); await second.notify(); await second.flush();
  expect((await fs.readNote('Ref.md')).revision).toBe(before.revision);
  expect(patch).not.toHaveBeenCalled();
});

test('unobserved restart gap retains an unapplied move for review without guessing path history', async () => {
  await fixture(); const first = create(); expect((await move(first)).success).toBe(true);
  await first.close(); const before = await readFile(join(vault, 'Ref.md'), 'utf8');
  const second = create(); await second.notify(); await second.flush();
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(before);
});

test('ordinary knowledge allow list excludes immutable original references', async () => {
  await fixture(); await seed('Ref.md', '---\nllm_wiki_type: source\nimmutable: true\n---\n[[Old.md]]');
  const service = create(); const before = await readFile(join(vault, 'Ref.md'), 'utf8');
  await move(service); await service.flush();
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(before);
});

test('a catalog observation gap during applying invalidates the pending move before writing', async () => {
  await fixture(); const service = create(); await move(service);
  const before = await readFile(join(vault, 'Ref.md'), 'utf8');
  const save = host.writeState;
  host.writeState = async value => { await save(value); if ((value as any).jobs[0]?.status === 'applying') await service.notify(); };
  await service.flush();
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(before);
  expect(durable.jobs[0].status).toBe('review_required');
});

test('a write completed before receipt failure is re-read after restart without another patch', async () => {
  await fixture(); const first = create(); await move(first);
  const save = host.writeState;
  host.writeState = async value => { if ((value as any).jobs[0]?.status === 'verified') throw new Error('Crash before receipt'); await save(value); };
  await first.flush(); expect(durable.jobs[0].status).toBe('applying'); await first.close();
  const after = await fs.readNote('Ref.md'); expect(after.content).toContain('New.md');
  host.writeState = save; const patch = vi.spyOn(fs, 'patchMultipleNotes');
  await create().flush();
  expect(durable.jobs[0].status).toBe('verified'); expect(patch).not.toHaveBeenCalled();
  expect((await fs.readNote('Ref.md')).revision).toBe(after.revision);
});

test('corrupt recovery bytes remain untouched and never reach a change set', async () => {
  await fixture(); const first = create(); await move(first); await first.close();
  durable.jobs[0].intent.after += '\nFORGED'; const original = structuredClone(durable);
  const patch = vi.spyOn(fs, 'patchMultipleNotes');
  await expect(create().flush()).rejects.toThrow(/mismatch/i);
  expect(durable).toEqual(original); expect(patch).not.toHaveBeenCalled();
});

test('closing during write admission prevents the queued edit and preserves user bytes', async () => {
  await fixture(); const service = create(); await move(service);
  const before = await readFile(join(vault, 'Ref.md'), 'utf8');
  const save = host.writeState; let closing: Promise<void> | undefined;
  host.writeState = async value => { await save(value); if ((value as any).jobs[0]?.status === 'applying') closing = service.close(); };
  await service.flush(); await closing;
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(before);
});

test('derived retries stop after three failures and unchanged events cannot restart them', async () => {
  await fixture(); config.paths = ['Ref.md']; config.operations = ['cache_refresh'];
  const revision = (await fs.readNote('Ref.md')).revision;
  const fingerprint = createHash('sha256').update('stable-cache').digest('hex');
  const repair = vi.fn(async () => { throw new Error('Unavailable cache'); });
  const service = create({ derived: { inspect: async () => ({ revision, fingerprint, needed: true }), repair } });
  for (let n = 0; n < 6; n++) { await service.notify([{ path: 'Ref.md', kind: 'upsert' }]); await service.flush(); }
  expect(repair).toHaveBeenCalledTimes(3); expect(durable.jobs).toHaveLength(1);
  expect(durable.jobs[0]).toMatchObject({ status: 'stopped', attempts: 3 });
});

test('a source-note event checks configured managed Canvas outputs too', async () => {
  config.paths = ['Views/Map.canvas']; config.operations = ['managed_canvas_regenerate'];
  const inspect = vi.fn(async () => ({ fingerprint: '0'.repeat(64), revision: '0'.repeat(64), needed: false }));
  const service = create({ derived: { inspect, repair: async () => { throw new Error('No write needed'); } } });
  await service.notify([{ path: 'Root.md', kind: 'upsert' }]); await service.flush();
  expect(inspect).toHaveBeenCalledWith('managed_canvas_regenerate', 'Views/Map.canvas', actor);
});

test('overflow batches invalidate unobserved old-path events instead of authorizing repairs', async () => {
  await fixture(); const service = create(); await move(service);
  const before = await readFile(join(vault, 'Ref.md'), 'utf8');
  await service.notify([...Array.from({ length: 256 }, (_, i) => ({ path: `Other${i}.md`, kind: 'upsert' as const })), { path: 'Old.md', kind: 'delete' }]);
  await service.flush();
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(before);
  expect(durable.jobs[0].status).toBe('review_required');
});

test('pending-path overflow triggers reconciliation for configured paths not admitted to the set', async () => {
  await fixture(); config.paths = ['Ref.md']; config.operations = ['cache_refresh'];
  const inspect = vi.fn(async () => ({ fingerprint: '0'.repeat(64), revision: '0'.repeat(64), needed: false }));
  const service = create({ derived: { inspect, repair: async () => { throw new Error('No write needed'); } } });
  await service.notify([...Array.from({ length: 128 }, (_, i) => ({ path: `Other${i}.md`, kind: 'upsert' as const })), { path: 'Ref.md', kind: 'upsert' }]);
  await service.flush();
  expect(inspect).toHaveBeenCalledWith('cache_refresh', 'Ref.md', actor);
});

test.each(['path', 'operation', 'account'])('a %s grant revoked during final authorization blocks the physical patch', async kind => {
  await fixture(); const service = create(); await move(service);
  const before = await readFile(join(vault, 'Ref.md'), 'utf8');
  const patch = fs.patchMultipleNotes.bind(fs);
  vi.spyOn(fs, 'patchMultipleNotes').mockImplementation(async (params, project, policy) => {
    if (params.dryRun === false) {
      const original = authorize.getMockImplementation()!;
      let checks = 0;
      authorize.mockImplementation(async (...args) => {
        const result = await original(...args);
        if (++checks === 2) {
          if (kind === 'path') config.paths = ['Old.md', 'New.md'];
          else if (kind === 'operation') config.operations = ['cache_refresh'];
          else config.accountId = 'different';
        }
        return result;
      });
    }
    return patch(params, project, policy);
  });
  await service.flush();
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(before);
});

test('source events regenerate a real managed Canvas once and preserve an unmanaged neighbor across restart', async () => {
  await fixture(); const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const preview = await wiki.canvasView(actor, 'Old.md', 'neighborhood', 2, 24, 12000, false);
  const saved = await wiki.writeCanvasView({ ...preview.exportAction.arguments, principal: actor });
  await fs.writeCanvasFile({ path: 'Views/User.canvas', expectedRevision: 'missing', content: '{"nodes":[],"edges":[]}' });
  config.paths = [saved.path, 'Views/User.canvas']; config.operations = ['managed_canvas_regenerate'];
  const derived = new MaintenanceDerivedService(fs, access, wiki, async () => {});
  const first = create({ derived }); await first.notify(); await first.flush();
  expect(durable?.jobs ?? []).toHaveLength(0);
  await seed('Old.md', '---\nllm_wiki_type: knowledge\n---\n# Changed topic\nCurrent evidence.');
  await first.notify([{ path: 'Old.md', kind: 'upsert' }]); await first.flush();
  expect(durable.jobs).toHaveLength(1); expect(durable.jobs[0].status).toBe('verified');
  const after = await fs.readCanvasFile(saved.path); expect(after.revision).not.toBe(saved.revision);
  expect(durable.jobs[0].intent.previousRevision).toBe(saved.revision);
  const write = vi.spyOn(fs, 'writeCanvasFile');
  await first.notify([{ path: 'Old.md', kind: 'upsert' }]); await first.flush(); await first.close();
  const restarted = create({ derived }); await restarted.notify(); await restarted.flush();
  expect(write).not.toHaveBeenCalled(); expect((await fs.readCanvasFile(saved.path)).revision).toBe(after.revision);
  expect(await readFile(join(vault, 'Views/User.canvas'), 'utf8')).toBe('{"nodes":[],"edges":[]}');
});

test('post-move read cannot restore eligibility invalidated by an observation gap while awaiting', async () => {
  await fixture(); const service = create(); const before = await readFile(join(vault, 'Ref.md'), 'utf8');
  const read = fs.readNote.bind(fs); let injected = false;
  vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => {
    const note = await read(...args);
    if (args[0] === 'New.md' && !injected) { injected = true; await service.notify(); }
    return note;
  });
  expect((await move(service)).success).toBe(true); await service.flush();
  expect(injected).toBe(true); expect(durable.jobs[0].status).toBe('review_required');
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(before);
});

test('a final admission observation gap after the reference read prevents physical dispatch', async () => {
  await fixture(); const service = create(); await move(service);
  const before = await readFile(join(vault, 'Ref.md'), 'utf8');
  const dispatch = (fs as any).writeProtectedFile.bind(fs); const read = fs.readNote.bind(fs);
  let admission = false, injected = false;
  vi.spyOn(fs as any, 'writeProtectedFile').mockImplementation(async (...args: any[]) => {
    const callback = args[3];
    if (callback) args[3] = async () => { admission = true; try { await callback(); } finally { admission = false; } };
    return dispatch(...args);
  });
  vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => {
    const note = await read(...args);
    if (admission && args[0] === 'Ref.md' && !injected) { injected = true; await service.notify(); }
    return note;
  });
  await service.flush(); expect(injected).toBe(true);
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(before);
});

test('a completed preview cannot restore a move invalidated while awaiting it', async () => {
  await fixture(); const service = create(); await move(service);
  const before = await readFile(join(vault, 'Ref.md'), 'utf8'); const patch = fs.patchMultipleNotes.bind(fs);
  vi.spyOn(fs, 'patchMultipleNotes').mockImplementation(async (...args) => {
    const result = await patch(...args); if (args[0].dryRun === true) await service.notify(); return result;
  });
  await service.flush(); expect(durable.jobs[0].status).toBe('review_required');
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(before);
});

test('an observation gap after the write is retained for review instead of certified verified', async () => {
  await fixture(); const service = create(); await move(service); const read = fs.readNote.bind(fs); let injected = false;
  vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => {
    const note = await read(...args);
    if (!injected && args[0] === 'Ref.md' && note.content.includes('./New.md')) { injected = true; await service.notify(); }
    return note;
  });
  await service.flush(); expect(injected).toBe(true); expect(durable.jobs[0].status).toBe('review_required');
  expect(durable.jobs[0].intent.before).toContain('[[Old.md#Detail|label]]');
});
