import { expect, test, vi } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { iterateNoteBodies } from './paged-query.js';
import type { QueryNote } from './types.js';

const row = (i: number): QueryNote => ({ path: `${i}.md`, frontmatter: {}, revision: `r${i}` });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('body windows preserve cursor order across 1201 rows without requesting content pages', async () => {
  const all = Array.from({ length: 1201 }, (_, i) => row(i)), cursors: unknown[] = [];
  const canAccess = (path: string) => !path.startsWith('private/'), canRead = (note: QueryNote) => !note.frontmatter.hidden;
  const fs = {
    queryNotes: vi.fn(async (params: any, pathGuard: any, rowGuard: any) => {
      expect(params).toMatchObject({ limit: 500, includeContent: false, includeTotal: false });
      expect(pathGuard).toBe(canAccess); expect(rowGuard).toBe(canRead);
      cursors.push(params.after?.value);
      const start = params.after ? Number(params.after.value) + 1 : 0;
      const notes = all.slice(start, start + 500);
      return { notes, truncated: start + notes.length < all.length,
        nextCursor: { path: notes.at(-1)!.path, value: start + notes.length - 1 } };
    }),
    readQueryNoteBody: vi.fn(async (note: QueryNote, pathGuard: any, rowGuard: any) => {
      expect(pathGuard).toBe(canAccess); expect(rowGuard).toBe(canRead);
      return { ...note, content: note.path };
    }),
  };
  const paths: string[] = [];
  for await (const note of iterateNoteBodies(fs as any, { offset: 9, includeContent: true }, canAccess, canRead)) paths.push(note.path);
  expect(paths).toEqual(all.map(note => note.path));
  expect(cursors).toEqual([undefined, 499, 999]);
});

test('failed body group drains delayed siblings, yields nothing and starts no next group', async () => {
  const delayed = deferred(), started = deferred();
  let active = 0, calls = 0, finished = false;
  const failure = new Error('body failed');
  const fs = {
    queryNotes: async () => ({ notes: Array.from({ length: 12 }, (_, i) => row(i)), truncated: false }),
    readQueryNoteBody: async (note: QueryNote) => {
      calls++; active++; if (calls === 4) started.resolve();
      try {
        if (note.path === '0.md') throw failure;
        await delayed.promise;
        return { ...note, content: 'body' };
      } finally { active--; }
    },
  };
  const next = iterateNoteBodies(fs as any).next();
  const outcome = next.then(value => { finished = true; return value; }, error => { finished = true; return error; });
  await started.promise;
  await setImmediate();
  expect(finished).toBe(false); expect(calls).toBe(4); expect(active).toBe(3);
  delayed.resolve();
  expect(await outcome).toBe(failure);
  expect(active).toBe(0); expect(calls).toBe(4);
});

test('reverse body completion keeps source order and early return stops after the current group', async () => {
  const gates = Array.from({ length: 4 }, deferred), started = deferred();
  let calls = 0;
  const fs = {
    queryNotes: vi.fn(async () => ({ notes: Array.from({ length: 9 }, (_, i) => row(i)), truncated: false })),
    readQueryNoteBody: async (note: QueryNote) => {
      const index = calls++; if (calls === 4) started.resolve();
      await gates[index]!.promise;
      return { ...note, content: 'body' };
    },
  };
  const iterator = iterateNoteBodies(fs as any), first = iterator.next();
  await started.promise;
  for (const gate of [...gates].reverse()) { gate.resolve(); await Promise.resolve(); }
  expect((await first).value?.path).toBe('0.md');
  expect((await iterator.next()).value?.path).toBe('1.md');
  await iterator.return();
  expect(calls).toBe(4); expect(fs.queryNotes).toHaveBeenCalledTimes(1);
});

test('empty final metadata page performs no body work and honors the initial cursor', async () => {
  const after = { path: 'last.md' };
  const fs = { queryNotes: vi.fn(async () => ({ notes: [], truncated: true })), readQueryNoteBody: vi.fn() };
  expect(await iterateNoteBodies(fs as any, { after }).next()).toEqual({ done: true, value: undefined });
  expect(fs.queryNotes.mock.calls[0]?.[0]).toMatchObject({ after });
  expect(fs.readQueryNoteBody).not.toHaveBeenCalled();
});
