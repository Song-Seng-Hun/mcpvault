import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { extractMarkdownTasks } from './markdown-tasks.js';
import { createServer } from '../tests/server-fixture.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { randomUUID } from 'node:crypto';

let vault: string;
let fs: FileSystemService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-reanchor-'));
  fs = new FileSystemService(vault);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });

async function stale(before: string, after: string, locator: { taskId?: string; line?: number }) {
  await writeFile(join(vault, 'Tasks.md'), before);
  const previous = (await fs.readNote('Tasks.md')).revision!;
  await writeFile(join(vault, 'Tasks.md'), after);
  const current = (await fs.readNote('Tasks.md')).revision!;
  const error = await fs.updateTask({ path: 'Tasks.md', ...locator, status: 'completed', expectedRevision: previous }).catch(error => error);
  expect(await readFile(join(vault, 'Tasks.md'), 'utf8')).toBe(after);
  return { error, current };
}

test('stale identity returns one revision-pinned reread location, never an automatic write retry', async () => {
  const { error, current } = await stale('- [ ] 검토 😀 ^review\n', '# Heading\n- [ ] 검토 😀 ^review\n', { taskId: 'task:block:review' });
  expect(error.recovery).toMatchObject({ error: 'task_reanchor_required', reason: 'revision_conflict', currentRevision: current,
    candidate: { line: 2, taskId: 'task:block:review' },
    nextAction: { endpointId: 'mcp.read_note_lines', arguments: { path: 'Tasks.md', expectedRevision: current, startLine: 2, endLine: 2 } } });
  expect(JSON.stringify(error.recovery)).not.toContain('검토');
  expect(JSON.stringify(error.recovery)).not.toContain('task_update');
});

test('duplicate IDs never select a reanchoring candidate', async () => {
  const { error } = await stale('- [ ] One ^id\n', '- [ ] One ^id\n- [ ] Two ^id\n', { taskId: 'task:block:id' });
  expect(error.recovery?.error).toBe('task_reanchor_required');
  expect(error.recovery.candidate).toBeUndefined();
});

test('line-only stale requests never assume the old line still identifies the task', async () => {
  const { error } = await stale('- [ ] One\n', '- [ ] Different\n- [ ] One\n', { line: 1 });
  expect(error.recovery?.currentRevision).toMatch(/^[a-f0-9]{64}$/);
  expect(error.recovery.candidate).toBeUndefined();
});

test('fenced block IDs cannot become recovery candidates', async () => {
  const { error } = await stale('- [ ] One ^id\n', '~~~md\n- [ ] One ^id\n~~~\n', { taskId: 'task:block:id' });
  expect(error.recovery?.error).toBe('task_reanchor_required');
  expect(error.recovery.candidate).toBeUndefined();
});

test('newly hidden source returns no revision or task recovery detail', async () => {
  const { error } = await stale('- [ ] Secret ^id\n', '---\nmoderation_status: hidden\n---\n- [ ] Secret ^id\n', { taskId: 'task:block:id' });
  expect(error.recovery).toBeUndefined();
  expect(error.message).toMatch(/Access denied/);
  expect(error.message).not.toContain('Secret');
});

test('content identities do not claim stable identity after duplicate insertion', async () => {
  const before = '- [ ] Repeat\n';
  const taskId = extractMarkdownTasks(before, 'Tasks.md')[0]!.taskId;
  const { error } = await stale(before, before + before, { taskId });
  expect(error.recovery.error).toBe('task_reanchor_required');
  expect(error.recovery.candidate).toBeUndefined();
});

test('revision race while preparing recovery discards all locator details', async () => {
  await writeFile(join(vault, 'Tasks.md'), '- [ ] One ^id\n');
  const revision = (await fs.readNote('Tasks.md')).revision!;
  await writeFile(join(vault, 'Tasks.md'), '# Moved\n- [ ] One ^id\n');
  const readRevision = fs.readNoteRevision.bind(fs);
  vi.spyOn(fs, 'readNoteRevision').mockImplementationOnce(async path => {
    await writeFile(join(vault, 'Tasks.md'), '# Another edit\n');
    return readRevision(path);
  });
  const error = await fs.updateTask({ path: 'Tasks.md', taskId: 'task:block:id', status: 'completed', expectedRevision: revision }).catch(error => error);
  expect(error.message).toMatch(/changed during inspection/);
  expect(error.recovery).toBeUndefined();
  expect(await readFile(join(vault, 'Tasks.md'), 'utf8')).toBe('# Another edit\n');
});

test('MCP emits bounded structured recovery with a usable pinned read and no mutation', async () => {
  await writeFile(join(vault, 'Tasks.md'), '- [ ] Review ^id\n');
  const revision = (await fs.readNote('Tasks.md')).revision!;
  const after = '# Moved\n- [ ] Review ^id\n';
  await writeFile(join(vault, 'Tasks.md'), after);
  const server = createServer(vault, { version: 'test' });
  const client = new Client({ name: 'reanchor', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    const call = (endpointId: string, args: Record<string, unknown>) => client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
    const registered = await call('auth.register', { accountId: 'reanchor', modelId: 'codex', password: randomUUID() });
    const accessToken = JSON.parse((registered.content as any)[0].text).accessToken;
    for (const maxChars of [512, 1200]) {
      const failed = await call('notes.task_update', { accessToken, path: 'Tasks.md', taskId: 'task:block:id', status: 'completed', expectedRevision: revision, maxChars });
      expect(failed.isError).toBe(true);
      const text = (failed.content as any)[0].text;
      expect(text.length).toBeLessThanOrEqual(maxChars);
      const recovery = JSON.parse(text);
      expect(recovery.error).toBe('task_reanchor_required');
      expect(recovery.candidate.line).toBe(2);
      const read = await call(recovery.nextAction.endpointId, { ...recovery.nextAction.arguments, accessToken });
      expect(read.isError).toBeFalsy();
      expect(JSON.parse((read.content as any)[0].text).revision).toBe(recovery.currentRevision);
    }
    expect(await readFile(join(vault, 'Tasks.md'), 'utf8')).toBe(after);
    const audit = (await readFile(join(vault, '.mcpvault/audit.ndjson'), 'utf8')).trim().split('\n').map(row => JSON.parse(row));
    expect(audit.filter(row => row.tool === 'update_task' && row.outcome === 'error')).toHaveLength(2);
  } finally { await client.close(); await server.close(); }
});
