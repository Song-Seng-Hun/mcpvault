import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { VaultIoCoordinator } from './vault-io.js';
import { readBoundedSource } from './bounded-source-read.js';
import * as taskParser from './markdown-tasks.js';

let vault: string;
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'mcpvault-task-io-')); });
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });

test('concurrent task scans share bounded IO and later scans do not retain old source content', async () => {
  await writeFile(join(vault, 'Tasks.md'), '- [ ] Original\n');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let bothRequested!: () => void;
  const requested = new Promise<void>(resolve => { bothRequested = resolve; });
  const reads: number[] = [];
  const io = new VaultIoCoordinator({ boundedReader: async (path, maxBytes) => {
    reads.push(maxBytes);
    await gate;
    return readBoundedSource(path, maxBytes);
  } });
  const original = io.readUtf8Bounded.bind(io);
  let requests = 0;
  vi.spyOn(io, 'readUtf8Bounded').mockImplementation((...args) => {
    const result = original(...args);
    if (++requests === 2) bothRequested();
    return result;
  });
  const fs = new FileSystemService(vault, undefined, undefined, undefined, undefined, undefined, io);
  const scans = Promise.all([fs.listTasks(), fs.listTasks()]);
  try {
    await Promise.race([requested, scans]);
  } finally { release(); }
  const [first, second] = await scans;
  expect(requests).toBe(2);
  expect(reads).toEqual([8 * 1024 * 1024]);
  expect(first.snapshotFingerprint).toBe(second.snapshotFingerprint);
  await writeFile(join(vault, 'Tasks.md'), '- [ ] Changed\n');
  const fresh = await fs.listTasks();
  expect(reads).toHaveLength(2);
  expect(fresh.tasks[0]!.text).toBe('Changed');
  expect(fresh.snapshotFingerprint).not.toBe(first.snapshotFingerprint);
  expect(io.status()).toMatchObject({ active: 0, queued: 0 });
});

test('oversized task sources fail without a misleading partial inventory or raw source identity', async () => {
  await writeFile(join(vault, 'Small.md'), '- [ ] Ordinary task\n');
  await writeFile(join(vault, 'Sensitive-owner.md'), '- [ ] ' + 'x'.repeat(8 * 1024 * 1024));
  const fs = new FileSystemService(vault);
  let failure: unknown;
  try { await fs.listTasks(); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).toMatch(/8 MiB.*pathPrefix/);
  expect(String(failure)).not.toContain('Sensitive-owner');
  expect((await fs.listTasks({ pathPrefix: 'Small.md' })).total).toBe(1);
});

test('lazy task iteration preserves Markdown locations, duplicate identities, CRLF and matching fences', () => {
  expect(taskParser.iterateMarkdownTasks).toBeTypeOf('function');
  const markdown = ['---', 'summary: example', '---', '- [ ] One ^one', '````md', '- [ ] Example', '```', '- [ ] Still example', '````', '- [ ] Repeat', '- [x] Repeat', '~~~', '- [ ] Tilde example', '~~~', '- [ ] Last', ''].join('\r\n');
  const tasks = [...taskParser.iterateMarkdownTasks(markdown, 'Tasks.md')];
  expect(tasks).toEqual(taskParser.extractMarkdownTasks(markdown, 'Tasks.md'));
  expect(tasks.map(task => [task.line, task.text, task.status])).toEqual([[4, 'One ^one', 'open'], [10, 'Repeat', 'open'], [11, 'Repeat', 'completed'], [15, 'Last', 'open']]);
  expect(tasks[0]!.taskId).toBe('task:block:one');
  expect(tasks[1]!.taskId).not.toBe(tasks[2]!.taskId);
  const iterator = taskParser.iterateMarkdownTasks(markdown, 'Tasks.md');
  expect(iterator.next().value).toEqual(tasks[0]);
  iterator.return();
  expect(iterator.next().done).toBe(true);
});
