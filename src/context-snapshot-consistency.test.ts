import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

const vaults: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });

async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-context-snapshot-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const write = (path: string, extra: Record<string, unknown> = {}, content = '# OLD-CONTEXT\n') => fs.writeNote({ path, content, frontmatter: { note_kind: 'atomic', ...extra } });
  await write('Root.md', { note_kind: 'moc' }, '# Root\n[[A.md]]\n');
  await write('A.md');
  return { vault, fs, access, wiki, write };
}

test.each(['root', 'neighbor'].flatMap(target => ['hidden', 'revised', 'deleted'].map(change => ({ target, change }))))('answer packet rejects $target $change after reading its projection', async ({ target, change }) => {
  const { vault, wiki, write } = await fixture();
  const diversity = wiki.evidenceDiversity.bind(wiki);
  vi.spyOn(wiki, 'evidenceDiversity').mockImplementation(async (...args) => {
    const result = await diversity(...args);
    const path = target === 'root' ? 'Root.md' : 'A.md';
    if (change === 'deleted') await unlink(join(vault, path));
    else await write(path, change === 'hidden' ? { moderation_status: 'hidden' } : {}, 'PRIVATE-MARKER');
    return result;
  });
  await expect(wiki.answerPacket(undefined, 'Root.md', 16000, false)).rejects.toThrow(/context source changed or became unavailable/);
});

test('answer packet never combines old neighborhood classification with a revised neighbor body', async () => {
  const { wiki, write } = await fixture();
  const neighborhood = wiki.neighborhood.bind(wiki);
  vi.spyOn(wiki, 'neighborhood').mockImplementation(async (...args) => {
    const result = await neighborhood(...args);
    await write('A.md', { lifecycle: 'review', polarity: 'negative' }, '# New counterpoint');
    return result;
  });
  await expect(wiki.answerPacket(undefined, 'Root.md', 16000, false)).rejects.toThrow(/context source changed or became unavailable/);
});

test.each(['root', 'entry'])('context pack rejects $0 drift after the answer packet has finished', async target => {
  const { fs, wiki, write } = await fixture();
  const packet = wiki.answerPacket.bind(wiki), read = fs.readNote.bind(fs);
  let packetFinished = false, changed = false;
  vi.spyOn(wiki, 'answerPacket').mockImplementation(async (...args) => {
    const result = await packet(...args);
    packetFinished = true;
    if (target === 'root') { await write('Root.md', { moderation_status: 'hidden' }, 'PRIVATE-MARKER'); changed = true; }
    return result;
  });
  vi.spyOn(fs, 'readNote').mockImplementation(async path => {
    const note = await read(path);
    if (packetFinished && target === 'entry' && path === 'A.md' && !changed) {
      changed = true;
      await write('A.md', { moderation_status: 'hidden' }, 'PRIVATE-MARKER');
    }
    return note;
  });
  await expect(wiki.contextPack(undefined, 'Root.md', 16000, false)).rejects.toThrow(/context source changed or became unavailable/);
  expect(changed).toBe(true);
});

test('authorized private neighbor projections use resolved scope paths', async () => {
  const { fs, wiki, write } = await fixture();
  const root = '_scopes/models/codex/Root.md', neighbor = '_scopes/models/codex/Peer.md';
  await write(root, {}, '[[Peer]]');
  await write(neighbor);
  const packet = await wiki.answerPacket({ modelId: 'codex', agentId: 'worker' }, root, 16000, false);
  expect(packet.supporting).toContainEqual(expect.objectContaining({ path: 'scope://model/codex/Peer.md', revision: (await fs.readNote(neighbor)).revision }));
});

test('context final checks deduplicate bounded sources and ignore unrelated notes', async () => {
  const { fs, wiki, write } = await fixture();
  const paths = Array.from({ length: 12 }, (_, i) => `Entry-${i}.md`);
  for (const path of paths) await write(path);
  await write('Root.md', { note_kind: 'moc' }, paths.map(path => `[[${path}]]`).join('\n') + '\n[[Entry-0.md]]');
  await write('Unrelated.md');
  const packet = wiki.answerPacket.bind(wiki), read = fs.readNoteRevision.bind(fs);
  let finished = false, active = 0, peak = 0;
  const checked: string[] = [];
  vi.spyOn(wiki, 'answerPacket').mockImplementation(async (...args) => {
    const result = await packet(...args);
    await write('Unrelated.md', {}, 'Unrelated concurrent edit');
    finished = true;
    return result;
  });
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async path => {
    if (!finished) return read(path);
    checked.push(path); active += 1; peak = Math.max(peak, active);
    try { return await read(path); } finally { active -= 1; }
  });
  const result = await wiki.contextPack(undefined, 'Root.md', 16000, false);
  expect(result.entrypoints.filter(item => item.role === 'moc_reading_order').map(item => item.path)).toEqual(paths);
  expect(checked.sort()).toEqual(['Root.md', ...paths].sort());
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(4);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(16000);
});

test.each(['answer', 'context'])('%s compact output preserves long canonical root paths', async mode => {
  const { fs, wiki, write } = await fixture();
  const path = `Notes/${'a'.repeat(171)}.md`;
  await write(path, { title: 'Short' }, '# Note');
  const result = mode === 'answer'
    ? await wiki.answerPacket(undefined, path, 1024, false)
    : await wiki.contextPack(undefined, path, 1024, false);
  const root = mode === 'answer' ? result.source : result.root;
  expect(root).toMatchObject({ path, revision: (await fs.readNote(path)).revision });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(1024);
  if (mode === 'context') expect(result.readOrder).toContain(path);
});

test('an answer packet reports truncation when its budget removes supporting rows', async () => {
  const { wiki, write } = await fixture();
  await write('Root.md', { note_kind: 'moc' }, '[[A.md]]\n[[B.md]]\n[[C.md]]');
  await write('B.md'); await write('C.md');
  const full = await wiki.answerPacket(undefined, 'Root.md', 16000, false);
  expect(full.supporting.length).toBe(3);
  const budget = JSON.stringify(full).length - 50;
  const small = await wiki.answerPacket(undefined, 'Root.md', budget, false);
  expect(small.supporting.length).toBeLessThan(full.supporting.length);
  expect(small.truncated).toBe(true);
  expect(JSON.stringify(small).length).toBeLessThanOrEqual(budget);
});
