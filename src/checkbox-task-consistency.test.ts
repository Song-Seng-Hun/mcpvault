import { beforeEach, afterEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { createServer } from './createServer.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { randomUUID } from 'node:crypto';

let vault: string;
let fs: FileSystemService;
let events: string[];
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-checkbox-consistency-'));
  events = [];
  fs = new FileSystemService(vault, undefined, undefined, path => { events.push(path); });
});
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });

test('task inventory excludes hidden owners before counts and returns exact source revisions', async () => {
  await writeFile(join(vault, 'Visible.md'), '- [ ] Review evidence\n');
  for (const status of ['hidden', 'quarantined', 'removed']) {
    await writeFile(join(vault, `${status}.md`), `---\nmoderation_status: ${status}\n---\n- [ ] private task ${status}\n`);
  }
  const result = await fs.listTasks();
  expect(result.total).toBe(1);
  expect(result.tasks).toHaveLength(1);
  expect(result.tasks[0]).toMatchObject({ path: 'Visible.md', revision: (await fs.readNote('Visible.md')).revision });
  expect(JSON.stringify(result)).not.toContain('private task');
});

test('ambiguous block task IDs reject without choosing or writing the first task', async () => {
  const content = '- [ ] First ^duplicate\n- [ ] Second ^duplicate\n';
  await writeFile(join(vault, 'Tasks.md'), content);
  const note = await fs.readNote('Tasks.md');
  await expect(fs.updateTask({ path: 'Tasks.md', taskId: 'task:block:duplicate', status: 'completed', expectedRevision: note.revision! })).rejects.toThrow(/ambiguous/i);
  expect(await readFile(join(vault, 'Tasks.md'), 'utf8')).toBe(content);
  expect(events).toEqual([]);
});

test('line fallback never reuses an earlier checkbox match inside a fenced example', async () => {
  const content = '- [ ] Real task\n~~~md\n- [ ] Example only\n~~~\n';
  await writeFile(join(vault, 'Tasks.md'), content);
  const note = await fs.readNote('Tasks.md');
  await expect(fs.updateTask({ path: 'Tasks.md', line: 3, status: 'completed', expectedRevision: note.revision! })).rejects.toThrow(/not a Markdown checkbox/);
  expect(await readFile(join(vault, 'Tasks.md'), 'utf8')).toBe(content);
  expect(events).toEqual([]);
});

test('hidden task mutation is denied even outside managed Community folders', async () => {
  const content = '---\nmoderation_status: hidden\n---\n- [ ] Secret\n';
  await writeFile(join(vault, 'Tasks.md'), content);
  const note = await fs.readNote('Tasks.md');
  await expect(fs.updateTask({ path: 'Tasks.md', line: 4, status: 'completed', expectedRevision: note.revision! })).rejects.toThrow(/Access denied/);
  expect(await readFile(join(vault, 'Tasks.md'), 'utf8')).toBe(content);
  expect(events).toEqual([]);
});

test('explicit current line disambiguates block IDs and concurrent stale updates cannot win', async () => {
  await writeFile(join(vault, 'Tasks.md'), '- [ ] First ^duplicate\r\n- [ ] Second ^duplicate\r\n');
  const revision = (await fs.readNote('Tasks.md')).revision!;
  const results = await Promise.allSettled([1, 2].map(line => fs.updateTask({ path: 'Tasks.md', line, status: 'completed', expectedRevision: revision })));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect(await readFile(join(vault, 'Tasks.md'), 'utf8')).toBe('- [x] First ^duplicate\r\n- [ ] Second ^duplicate\r\n');
});

test('public MCP task inventory and update share visible current revision and identity rules', async () => {
  await writeFile(join(vault, 'Tasks.md'), '- [ ] First ^duplicate\n- [ ] Second ^duplicate\n');
  await writeFile(join(vault, 'Hidden.md'), '---\nmoderation_status: quarantined\n---\n- [ ] hidden-sentinel\n');
  const server = createServer(vault, { version: 'test' });
  const client = new Client({ name: 'checkbox-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    const call = (endpointId: string, args: Record<string, unknown>) => client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
    const listed = await call('mcp.list_tasks', { maxChars: 1200, prettyPrint: true });
    expect(listed.isError).toBeFalsy();
    const text = (listed.content as any)[0].text;
    expect(text.length).toBeLessThanOrEqual(1200);
    expect(text).not.toContain('Hidden.md');
    expect(text).not.toContain('hidden-sentinel');
    const page = JSON.parse(text);
    expect(page.total).toBe(2);
    expect(page.returned).toBe(2);
    expect(page.tasks[0].revision).toBe((await fs.readNote('Tasks.md')).revision);
    const registration = await call('auth.register', { accountId: 'checkbox-test', modelId: 'codex', password: randomUUID() });
    expect(registration.isError).toBeFalsy();
    const accessToken = JSON.parse((registration.content as any)[0].text).accessToken;
    const args = { path: 'Tasks.md', status: 'completed', expectedRevision: page.tasks[0].revision, accessToken };
    const ambiguous = await call('notes.task_update', { ...args, taskId: page.tasks[0].taskId });
    expect(ambiguous.isError).toBe(true);
    expect((ambiguous.content as any)[0].text).toMatch(/ambiguous/);
    const done = await call('notes.task_update', { ...args, line: 2 });
    expect(done.isError).toBeFalsy();
    const receipt = JSON.parse((done.content as any)[0].text);
    expect(receipt.revision).toBe((await fs.readNote('Tasks.md')).revision);
    expect(await readFile(join(vault, 'Tasks.md'), 'utf8')).toBe('- [ ] First ^duplicate\n- [x] Second ^duplicate\n');
    const refreshed = await call('mcp.list_tasks', { maxChars: 1200 });
    const current = JSON.parse((refreshed.content as any)[0].text);
    expect(current.total).toBe(1);
    expect(current.tasks[0].revision).toBe(receipt.revision);
  } finally {
    await client.close();
    await server.close();
  }
});
