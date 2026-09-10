import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';

let base: string, vault: string, client: Client, server: ReturnType<typeof createServer>;
const tokens: Record<string, string> = {};
const workshopPath = 'Community/Workshops/research.md';
const recordPath = '_whispers/research/research/round.md';
async function call(endpointId: string, args: Record<string, unknown> = {}, who = 'owner') {
  const result = await client.callTool({ name: 'call_endpoint', arguments: {
    endpointId, arguments: { ...args, ...(tokens[who] && { accessToken: tokens[who] }) },
  } });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  return JSON.parse((result.content[0] as { text: string }).text);
}
async function connect(readOnly = false) {
  server = createServer(vault, { readOnly });
  client = new Client({ name: 'research-status', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(left), server.connect(right)]);
}
beforeEach(async () => {
  base = await realpath(tmpdir()); vault = await mkdtemp(join(base, 'research-status-'));
  await connect();
  for (const who of ['owner', 'peer', 'outside']) {
    delete tokens[who];
    tokens[who] = (await call('auth.register', { accountId: who, agentId: who, modelId: 'codex',
      userId: `family-${who}`, password: `disposable-status-${who}-password` }, who)).accessToken;
  }
  await call('workshop.create', { workshopId: 'research', title: 'Research', prompt: 'Compare current observations' });
});
afterEach(async () => {
  vi.restoreAllMocks(); await client?.close(); await server?.close();
  const actual = await realpath(vault), rel = relative(base, actual);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(actual).startsWith('research-status-')) throw Error('Unsafe cleanup');
  await rm(actual, { recursive: true, force: true });
});
const read = (who = 'owner', more: Record<string, unknown> = {}) => call('workshop.research', {
  workshopId: 'research', roundId: 'round', field: 'status', ...more,
}, who);
async function seed() {
  await call('notes.write', { path: 'STATUS-PRIVATE-LOCATOR.md', content: 'Original source', expectedRevision: 'missing' });
  const workshop = await call('workshop.read', { workshopId: 'research' });
  const round = await call('workshop.research_update', { workshopId: 'research', roundId: 'round', operation: 'create',
    expectedRevision: 'missing', expectedWorkshopRevision: workshop.workshop.revision, requestId: 'create',
    config: { question: 'CONFIG-SECRET [[STATUS-PRIVATE-LOCATOR]]', constraints: ['CONFIG-CONSTRAINT'],
      participants: ['owner', 'peer'], budgetMinutes: 30 },
  });
  const saved = await call('workshop.research_update', { workshopId: 'research', roundId: 'round', operation: 'submit',
    expectedRevision: round.revision, requestId: 'submit', submission: { candidate: 'SEALED-CANDIDATE', conditions: 'SEALED-CONDITIONS',
      failedSearches: 'SEALED-SEARCH', uncertainties: 'SEALED-UNCERTAINTY', evidence: [] },
  }, 'peer');
  return { revision: saved.revision, fs: new FileSystemService(vault) };
}
function expectMinimal(value: any, revision: string) {
  expect(value).toMatchObject({ workshopId: 'research', roundId: 'round', field: 'status', revision, phase: 'collecting' });
  expect(Object.keys(value).sort()).toEqual(['workshopId', 'roundId', 'field', 'revision', 'phase', 'basisState',
    ...(value.nextAction ? ['nextAction'] : [])].sort());
  const serialized = JSON.stringify(value);
  for (const secret of ['STATUS-PRIVATE-LOCATOR', 'CONFIG-', 'SEALED-', '_whispers/', 'submittedAccounts',
    'participants', 'fingerprint', 'submissions', 'reviews', 'sourceGuards', 'budgetExpired']) expect(serialized).not.toContain(secret);
  expect(serialized.length).toBeLessThanOrEqual(512);
}
test.each(['changed', 'hidden'])('status remains minimal when config basis becomes %s, while detail stays blocked', async change => {
  const seeded = await seed(), source = await seeded.fs.readNote('STATUS-PRIVATE-LOCATOR.md');
  await seeded.fs.writeNote({ path: 'STATUS-PRIVATE-LOCATOR.md', content: source.content + (change === 'changed' ? '\nChanged' : ''),
    frontmatter: { ...source.frontmatter, ...(change === 'hidden' && { moderation_status: 'hidden' }) }, expectedRevision: source.revision });
  for (const who of ['owner', 'peer']) {
    const result = await read(who, { maxChars: 512 });
    expectMinimal(result, seeded.revision);
    expect(result.basisState).toBe('unavailable_or_changed');
    if (who === 'peer') expect(result.nextAction).toBeUndefined();
    else expect(result.nextAction).toMatchObject({ endpointId: 'workshop.research_update', arguments: {
      operation: 'close', expectedRevision: seeded.revision, closure: { outcome: 'unresolved' },
    } });
  }
  await expect(read('owner', { field: 'config', expectedRevision: seeded.revision })).rejects.toThrow(/changed|unavailable|reference/i);
  await expect(read('outside')).rejects.toThrow(/unavailable|participant/i);
  expect((await seeded.fs.readNote(recordPath)).revision).toBe(seeded.revision);
});
test('status validates expected round revision and never returns normal projection fields', async () => {
  const seeded = await seed();
  const result = await read('owner', { maxChars: 512 });
  expectMinimal(result, seeded.revision); expect(result.basisState).toBe('current');
  await expect(read('owner', { expectedRevision: '0'.repeat(64) })).rejects.toThrow(/revision|changed/i);
});

test('status rejects out-of-range budgets and detail-only pagination inputs', async () => {
  const seeded = await seed();
  for (const input of [{ maxChars: 511 }, { maxChars: 12001 }, { maxChars: 512.5 }, { cursor: 'detail' }, { itemIndex: 0 }]) {
    await expect(read('owner', input)).rejects.toThrow(/maxChars|cursor|integer|budget/i);
  }
  expect((await seeded.fs.readNote(recordPath)).revision).toBe(seeded.revision);
});

test('valid status budget never truncates long identifiers or its required closure route', async () => {
  const workshopId = 'w'.repeat(64), roundId = 'r'.repeat(64);
  await call('workshop.create', { workshopId, title: 'Long identifier', prompt: 'A bounded round' });
  const parent = await call('workshop.read', { workshopId });
  const round = await call('workshop.research_update', { workshopId, roundId, operation: 'create',
    expectedRevision: 'missing', expectedWorkshopRevision: parent.workshop.revision, requestId: 'long-round',
    config: { question: 'Compare observations', constraints: ['No assumptions'], participants: ['owner', 'peer'], budgetMinutes: 30 },
  });
  const args = { workshopId, roundId, field: 'status' };
  await expect(call('workshop.research', { ...args, maxChars: 512 })).rejects.toThrow(/budget|maxChars/i);
  const result = await call('workshop.research', { ...args, maxChars: 1200 });
  expect(result).toMatchObject({ workshopId, roundId, revision: round.revision, nextAction: { arguments: { workshopId, roundId, expectedRevision: round.revision } } });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(1200);
});
test('read-only runtime permits minimal status and denies the offered mutation', async () => {
  const seeded = await seed(); await client.close(); await server.close(); await connect(true);
  tokens.owner = (await call('auth.login', { accountId: 'owner', password: 'disposable-status-owner-password' })).accessToken;
  expectMinimal(await read('owner', { maxChars: 512 }), seeded.revision);
  await expect(call('workshop.research_update', { workshopId: 'research', roundId: 'round', operation: 'close',
    expectedRevision: seeded.revision, requestId: 'close', closure: { outcome: 'unresolved', explanation: 'No approval' },
  })).rejects.toThrow(/read.only/i);
  expect((await seeded.fs.readNote(recordPath)).revision).toBe(seeded.revision);
});
test('terminal status exposes no closure prose or pending closure action', async () => {
  const seeded = await seed();
  const closed = await call('workshop.research_update', { workshopId: 'research', roundId: 'round', operation: 'close',
    expectedRevision: seeded.revision, requestId: 'close', closure: { outcome: 'unresolved', explanation: 'CLOSURE-SECRET' },
  });
  const result = await read('peer', { maxChars: 512 });
  expect(result.phase).toBe('closed'); expect(result.revision).toBe(closed.revision);
  expect(result.nextAction).toBeUndefined(); expect(JSON.stringify(result)).not.toContain('CLOSURE-SECRET');
  expect(JSON.stringify(result)).not.toContain('SEALED-');
});
test('late authenticated-session revocation rejects minimal status', async () => {
  await seed();
  const original = FileSystemService.prototype.readNote;
  let revoked = false;
  vi.spyOn(FileSystemService.prototype, 'readNote').mockImplementation(async function (path, ...rest) {
    const result = await original.call(this, path, ...rest);
    if (path === recordPath && !revoked) { revoked = true; await call('auth.logout'); }
    return result;
  });
  await expect(read()).rejects.toThrow(/token|actor|login|authenticated/i);
  expect(revoked).toBe(true);
});
test('workshop authority drift during minimal status rejects the response', async () => {
  const seeded = await seed(), original = FileSystemService.prototype.readNote;
  let changed = false;
  vi.spyOn(FileSystemService.prototype, 'readNote').mockImplementation(async function (path, ...rest) {
    const result = await original.call(this, path, ...rest);
    if (path === recordPath && !changed) {
      changed = true; const parent = await seeded.fs.readNote(workshopPath);
      await seeded.fs.writeNote({ path: workshopPath, content: parent.content,
        frontmatter: { ...parent.frontmatter, facilitator_account_id: 'outside' }, expectedRevision: parent.revision });
    }
    return result;
  });
  await expect(read()).rejects.toThrow(/changed|unavailable|context/i);
  expect(changed).toBe(true);
});

test.each(['workshop', 'round'])('final source revision I/O cannot return stale %s context', async target => {
  const seeded = await seed(), original = FileSystemService.prototype.readNoteRevision;
  let changed = false;
  vi.spyOn(FileSystemService.prototype, 'readNoteRevision').mockImplementation(async function (path, ...rest) {
    const result = await original.call(this, path, ...rest);
    if (path === 'STATUS-PRIVATE-LOCATOR.md' && !changed) {
      changed = true;
      const destination = target === 'workshop' ? workshopPath : recordPath;
      const current = await seeded.fs.readNote(destination);
      if (target === 'workshop') current.frontmatter.facilitator_account_id = 'outside';
      else {
        current.frontmatter.research.phase = 'closed';
        current.frontmatter.research.closure = { outcome: 'unresolved', explanation: 'Concurrent closure', accountId: 'owner' };
      }
      await seeded.fs.writeNote({ path: destination, content: current.content, frontmatter: current.frontmatter, expectedRevision: current.revision });
    }
    return result;
  });
  await expect(read()).rejects.toThrow(/changed|unavailable|context/i);
  expect(changed).toBe(true);
});

test('parent handoff during the final round reread cannot leave a stale closure route', async () => {
  const seeded = await seed(), original = FileSystemService.prototype.readNote;
  let recordReads = 0, changed = false;
  vi.spyOn(FileSystemService.prototype, 'readNote').mockImplementation(async function (path, ...rest) {
    const result = await original.call(this, path, ...rest);
    if (path === recordPath && ++recordReads === 2) {
      changed = true;
      const current = await seeded.fs.readNote(workshopPath);
      await seeded.fs.writeNote({ path: workshopPath, content: current.content,
        frontmatter: { ...current.frontmatter, facilitator_account_id: 'outside' }, expectedRevision: current.revision });
    }
    return result;
  });
  await expect(read()).rejects.toThrow(/changed|unavailable|context/i);
  expect(changed).toBe(true);
});
