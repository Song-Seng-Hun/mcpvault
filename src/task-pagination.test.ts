import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { createServer } from './createServer.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { packTaskPage } from './task-page.js';

let vault: string;
let fs: FileSystemService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-task-pages-'));
  fs = new FileSystemService(vault);
  await writeFile(join(vault, 'Tasks.md'), Array.from({ length: 7 }, (_, i) => `- [ ] Task ${i} ${'context '.repeat(30)}`).join('\n'));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });

test('task pages retain ordered slices and reject drift rather than silently skipping work', async () => {
  const first = await fs.listTasks({ limit: 2 });
  expect(first.snapshotFingerprint).toMatch(/^[a-f0-9]{64}$/);
  const second = await fs.listTasks({ limit: 2, offset: 2, expectedSnapshot: first.snapshotFingerprint });
  expect(second.tasks.map(task => task.line)).toEqual([3, 4]);
  expect(second).toMatchObject({ total: 7, offset: 2, truncated: true, snapshotFingerprint: first.snapshotFingerprint });
  const end = await fs.listTasks({ limit: 2, offset: 7, expectedSnapshot: first.snapshotFingerprint });
  expect(end).toMatchObject({ tasks: [], total: 7, truncated: false });
  await writeFile(join(vault, 'Tasks.md'), '- [ ] Changed before continuation\n');
  await expect(fs.listTasks({ limit: 2, offset: 2, expectedSnapshot: first.snapshotFingerprint })).rejects.toThrow(/changed.*restart/i);
});

test('task fingerprints bind the filter but exclude hidden owners', async () => {
  await writeFile(join(vault, 'Hidden.md'), '---\nmoderation_status: hidden\n---\n- [ ] sentinel\n');
  const first = await fs.listTasks({ limit: 1 });
  await writeFile(join(vault, 'Hidden.md'), '---\nmoderation_status: hidden\n---\n- [ ] altered secret\n');
  expect((await fs.listTasks({ limit: 1, offset: 1, expectedSnapshot: first.snapshotFingerprint })).snapshotFingerprint).toBe(first.snapshotFingerprint);
  await expect(fs.listTasks({ status: 'all', offset: 1, expectedSnapshot: first.snapshotFingerprint })).rejects.toThrow(/changed.*restart/i);
});

test('task continuation rejects unguarded offsets and malformed parameters', async () => {
  await expect(fs.listTasks({ offset: 1 })).rejects.toThrow(/expectedSnapshot/);
  await expect(fs.listTasks({ offset: -1 })).rejects.toThrow(/offset/);
  await expect(fs.listTasks({ offset: 0.5 })).rejects.toThrow(/offset/);
  await expect(fs.listTasks({ expectedSnapshot: 'invalid' })).rejects.toThrow(/expectedSnapshot/);
});

test('public task continuation consumes only emitted items and small pages retain a usable retry', async () => {
  const server = createServer(vault, { version: 'test' });
  const client = new Client({ name: 'task-pages', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    const call = (args: Record<string, unknown>) => client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'mcp.list_tasks', arguments: args } });
    let args: Record<string, unknown> = { limit: 7, maxChars: 1200, prettyPrint: true, pathPrefix: 'scope://global/Tasks.md' };
    const lines: number[] = [];
    for (let iteration = 0; iteration < 10; iteration++) {
      const response = await call(args);
      expect(response.isError).toBeFalsy();
      const text = (response.content as any)[0].text;
      expect(text.length).toBeLessThanOrEqual(Number(args.maxChars));
      const page = JSON.parse(text);
      lines.push(...page.tasks.map((task: any) => task.line));
      expect(page.tasks.every((task: any) => /^[a-f0-9]{64}$/.test(task.revision))).toBe(true);
      if (!page.nextAction) break;
      expect(page.nextAction.endpointId).toBe('mcp.list_tasks');
      expect(page.nextAction.arguments.offset).toBe(lines.length);
      expect(page.nextAction.arguments.pathPrefix).toBe('scope://global/Tasks.md');
      expect(page.nextAction.arguments).not.toHaveProperty('accessToken');
      args = page.nextAction.arguments;
    }
    expect(lines).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const small = await call({ limit: 7, maxChars: 512, prettyPrint: true });
    expect(small.isError).toBeFalsy();
    const smallText = (small.content as any)[0].text;
    expect(smallText.length).toBeLessThanOrEqual(512);
    const smallPage = JSON.parse(smallText);
    expect(smallPage.nextAction).toBeDefined();
    if (!smallPage.returned) {
      expect(smallPage.nextAction.reuseOriginalArguments).toBe(true);
      expect(smallPage.nextAction.overrides).toMatchObject({ maxChars: 12000, prettyPrint: false, limit: 1 });
    }
  } finally { await client.close(); await server.close(); }
});

test('unreadable selected storage never masquerades as an empty complete task page', async () => {
  const service = fs as any;
  const original = service.resolvePath.bind(fs);
  vi.spyOn(service, 'resolvePath').mockImplementation((path: unknown) => {
    if (path === 'Tasks.md') throw Object.assign(new Error('sensitive driver detail'), { code: 'EACCES' });
    return original(path);
  });
  await expect(fs.listTasks()).rejects.toThrow('Vault read unavailable');
});

test('oversized locators have a bounded retry and then explicit ceiling failure, never a skip loop', () => {
  const page = { tasks: [{ path: 'x'.repeat(13000), line: 1, taskId: 'task:block:one', status: 'open' as const, text: 'Task', revision: 'a'.repeat(64) }], total: 1, offset: 0, truncated: false, snapshotFingerprint: 'b'.repeat(64) };
  const result = packTaskPage(page, { maxChars: 512, prettyPrint: true, accessToken: 'secret-token', pathPrefix: 'scope://global/' + 'x'.repeat(13000) });
  expect(result.length).toBeLessThanOrEqual(512);
  expect(result).not.toContain('secret-token');
  const retry = JSON.parse(result).nextAction;
  expect(retry).toMatchObject({ reuseOriginalArguments: true, overrides: { limit: 1, maxChars: 12000, prettyPrint: false } });
  expect(() => packTaskPage(page, retry.overrides)).toThrow(/no task was skipped/);
});
