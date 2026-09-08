import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrontmatterHandler } from './frontmatter.js';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertRoleplayReplayAdmission, RoleplayStore } from './roleplay-store.js';
import { roleplayHash, roleplayRevision, type RoleplayCommand } from './roleplay-model.js';

const cleanup: string[] = [];
afterEach(async () => { for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'roleplay-')); cleanup.push(root);
  const vaultPath = join(root, 'vault'), hostPath = join(root, 'host'); await mkdir(vaultPath); await mkdir(hostPath);
  const options = { vaultPath, hostPath, policy: { administrators: ['host'] } };
  const store = await RoleplayStore.open(options);
  const command: RoleplayCommand = { op: 'initialize', actor: 'host', requestId: 'init', expectedRevision: roleplayRevision(await store.snapshot()), data: { title: 'Lantern Library', places: { hall: [] } } };
  return { root, options, store, command };
}
describe('durable roleplay records', () => {
  it('uses the existing deduplicated account and enterprise mention grammar', async () => {
    const f = await fixture();
    try {
      await f.store.transact(f.command);
      const act = async (op: string, data: Record<string, unknown>) => f.store.transact({ op, actor: 'host', requestId: `mention-${(await f.store.snapshot()).sequence}`, expectedRevision: roleplayRevision(await f.store.snapshot()), data });
      await act('scene', { roomId: 'hall-chat', location: 'hall', title: 'Hall', gm: 'host' });
      await act('ooc', { roomId: 'hall-chat', content: '@Peer.One @peer_one @actor:center:agent.one @Peer.One mail@example.com' });
      const record = (await f.store.read()).records.at(-1)!;
      expect(record.frontmatter.mentions).toEqual(['peer.one', 'peer_one', 'actor:center:agent.one']);
    } finally { await f.store.close(); }
  });
  it('reuses verified replay projections without reparsing unchanged canonical records', async () => {
    const f = await fixture(); await f.store.transact(f.command); await f.store.snapshot();
    const parse = vi.spyOn(FrontmatterHandler.prototype, 'parse');
    try {
      const read = await f.store.read(); read.state.title = 'caller modification';
      expect((await f.store.snapshot()).title).toBe('Lantern Library');
      expect(parse).not.toHaveBeenCalled();
      await writeFile(join(f.options.vaultPath, read.records[0]!.path), '# tampered\n');
      await expect(f.store.snapshot()).rejects.toThrow(/integrity|tamper|repair/i);
    } finally { parse.mockRestore(); await f.store.close(); }
  });
  it('admits a turn only when existing and candidate replay bytes fit the aggregate capacity', () => {
    expect(() => assertRoleplayReplayAdmission(32 * 1024 * 1024 - 1, 1)).not.toThrow();
    expect(() => assertRoleplayReplayAdmission(32 * 1024 * 1024 - 1, 2)).toThrow(/capacity/i);
  });
  it('replays one authoritative Markdown record and returns the same retry receipt after restart', async () => {
    const f = await fixture(); const first = await f.store.transact(f.command); await f.store.close();
    const restarted = await RoleplayStore.open(f.options);
    try {
      expect(await restarted.transact(f.command)).toEqual(first);
      expect((await restarted.snapshot()).sequence).toBe(1);
      expect(await readFile(join(f.options.vaultPath, first.path), 'utf8')).toContain('fiction_domain: roleplay');
    } finally { await restarted.close(); }
  });
  it('returns validated canonical content and frontmatter with each read record', async () => {
    const f = await fixture(); const committed = await f.store.transact(f.command);
    try {
      const { records } = await f.store.read();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ path: committed.path, revision: committed.noteRevision, content: await readFile(join(f.options.vaultPath, committed.path), 'utf8') });
      expect(records[0].frontmatter).toMatchObject({ fiction_domain: 'roleplay', roleplay_committed: true, roleplay_event: records[0].event });
    } finally { await f.store.close(); }
  });
  it('recovers a trusted pending turn despite one bounded atomic-helper temporary file', async () => {
    const f = await fixture(); const committed = await f.store.transact(f.command);
    const [{ event }] = (await f.store.read()).records;
    const text = await readFile(join(f.options.vaultPath, committed.path), 'utf8');
    await f.store.close();
    const checkpointBase = `roleplay-${roleplayHash(f.options.vaultPath.toLowerCase())}`;
    await writeFile(join(f.options.hostPath, `${checkpointBase}.prepared.md`), text);
    await writeFile(join(f.options.hostPath, `${checkpointBase}.checkpoint.json`), JSON.stringify({ version: 1, vault: f.options.vaultPath, sequence: 0, hash: '0'.repeat(64), pending: { sequence: event.sequence, hash: event.hash } }));
    await rm(join(f.options.vaultPath, committed.path));
    await writeFile(join(f.options.vaultPath, 'Community', 'Roleplay', 'Turns', `.${randomUUID()}.tmp`), 'interrupted atomic write');
    const recovered = await RoleplayStore.open(f.options);
    try { expect((await recovered.snapshot()).sequence).toBe(1); }
    finally { await recovered.close(); }
  });
  it('rejects unexpected turn-directory filenames instead of treating them as helper temporary files', async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.options.vaultPath, 'Community', 'Roleplay', 'Turns', '.forged.tmp'), 'not an atomic helper file');
      await expect(f.store.snapshot()).rejects.toThrow(/checkpoint|record|repair/i);
    } finally { await f.store.close(); }
  });
  it('fails closed on an oversized otherwise-recognized atomic-helper temporary file', async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.options.vaultPath, 'Community', 'Roleplay', 'Turns', `.${randomUUID()}.tmp`), Buffer.alloc(65537));
      await expect(f.store.snapshot()).rejects.toThrow(/temporary|size|capacity|repair/i);
    } finally { await f.store.close(); }
  });
  it('serializes competing commits, admits one revision winner, and checks authority even on retry', async () => {
    const f = await fixture();
    try {
      const results = await Promise.allSettled([f.store.transact(f.command), f.store.transact({ ...f.command, requestId: 'other' })]);
      expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
      await expect(f.store.transact(f.command, async () => { throw new Error('revoked'); })).rejects.toThrow('revoked');
      expect((await f.store.snapshot()).sequence).toBe(1);
    } finally { await f.store.close(); }
  });
  it('detects direct record editing and refuses state mutation', async () => {
    const f = await fixture(); const first = await f.store.transact(f.command);
    try {
      await writeFile(join(f.options.vaultPath, first.path), '# forged\n');
      await expect(f.store.snapshot()).rejects.toThrow(/integrity|tamper|repair/i);
    } finally { await f.store.close(); }
  });
  it('detects deleted final records instead of silently rolling back', async () => {
    const f = await fixture(); const first = await f.store.transact(f.command); await f.store.close();
    await rm(join(f.options.vaultPath, first.path));
    await expect(RoleplayStore.open(f.options)).rejects.toThrow(/checkpoint|repair/i);
  });
  it('rejects a second writer for the same vault even using another host directory', async () => {
    const f = await fixture(); const secondHost = join(f.root, 'other-host'); await mkdir(secondHost);
    try { await expect(RoleplayStore.open({ ...f.options, hostPath: secondHost })).rejects.toThrow(/writer/); }
    finally { await f.store.close(); }
  });
});
