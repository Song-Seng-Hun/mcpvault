import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { FileSystemService } from './filesystem.js';
import { createServer } from './createServer.js';
import { endpointIdForTool } from './endpoint-registry.js';

let vault: string;
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'mcpvault-projection-consistency-')); });
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
const path = 'Community/Posts/snapshot.md';
const note = (heading: string, hidden = false) => `---\nmcpvault_type: blog_post\nstatus: published\n${hidden ? 'moderation_status: hidden\n' : ''}---\n# ${heading}\n\n${heading} body`;

test.each(['read_note_lines', 'get_note_outline'])('%s never attaches an old revision to new content', async tool => {
  const before = note('Original');
  const after = note('Concurrent');
  await mkdir(join(vault, 'Community/Posts'), { recursive: true });
  await writeFile(join(vault, path), before);
  const originalRead = FileSystemService.prototype.readNote;
  let armed = false;
  let changed = false;
  vi.spyOn(FileSystemService.prototype, 'readNote').mockImplementation(async function(this: FileSystemService, target: string) {
    const snapshot = await originalRead.call(this, target);
    if (armed && !changed && target === path) { changed = true; await writeFile(join(vault, path), after); }
    return snapshot;
  });
  const server = createServer(vault, { version: 'projection-consistency' });
  const client = new Client({ name: 'projection-consistency', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    armed = true;
    const response = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: endpointIdForTool(tool), arguments: { path, ...(tool === 'read_note_lines' && { startLine: 5, endLine: 7 }), maxChars: 512 } } });
    expect(changed).toBe(true);
    expect(response.isError).not.toBe(true);
    const text = (response.content as any)[0].text;
    const result = JSON.parse(text);
    expect(result.revision).toBe(hash(before));
    expect(text).toContain('Original');
    expect(text).not.toContain('Concurrent');
    expect(text.length).toBeLessThanOrEqual(512);
    expect(await readFile(join(vault, path), 'utf8')).toBe(after);
    const current = await originalRead.call(new FileSystemService(vault), path);
    expect(current.revision).toBe(hash(after));
  } finally { await client.close(); await server.close(); }
});

test.each(['read_note_lines', 'get_note_outline'])('%s cannot leak a newly hidden snapshot after a public precheck', async tool => {
  const before = note('Public');
  const hidden = note('HiddenPrivateMarker', true);
  await mkdir(join(vault, 'Community/Posts'), { recursive: true });
  await writeFile(join(vault, path), before);
  const originalRead = FileSystemService.prototype.readNote;
  let armed = false;
  vi.spyOn(FileSystemService.prototype, 'readNote').mockImplementation(async function(this: FileSystemService, target: string) {
    const snapshot = await originalRead.call(this, target);
    if (armed && target === path) { armed = false; await writeFile(join(vault, path), hidden); }
    return snapshot;
  });
  const server = createServer(vault, { version: 'projection-consistency' });
  const client = new Client({ name: 'projection-consistency', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    armed = true;
    const args = { path, ...(tool === 'read_note_lines' && { startLine: 1, endLine: 9 }), maxChars: 512 };
    const response = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: endpointIdForTool(tool), arguments: args } });
    const text = (response.content as any)[0].text;
    expect(text).not.toContain('HiddenPrivateMarker');
    expect(JSON.parse(text).revision).toBe(hash(before));
    const denied = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: endpointIdForTool(tool), arguments: args } });
    expect(denied.isError).toBe(true);
    expect((denied.content as any)[0].text).not.toContain('HiddenPrivateMarker');
  } finally { await client.close(); await server.close(); }
});

test.each(['read_note_lines', 'get_note_outline'])('%s rejects the hidden snapshot it actually read even if later published', async tool => {
  const hidden = note('InitiallyHidden', true);
  const published = note('NewPublic');
  await mkdir(join(vault, 'Community/Posts'), { recursive: true });
  await writeFile(join(vault, path), hidden);
  const originalRead = FileSystemService.prototype.readNote;
  let armed = false;
  vi.spyOn(FileSystemService.prototype, 'readNote').mockImplementation(async function(this: FileSystemService, target: string) {
    const snapshot = await originalRead.call(this, target);
    if (armed && target === path) { armed = false; await writeFile(join(vault, path), published); }
    return snapshot;
  });
  const server = createServer(vault, { version: 'projection-consistency' });
  const client = new Client({ name: 'projection-consistency', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    armed = true;
    const args = { path, ...(tool === 'read_note_lines' && { startLine: 1, endLine: 9 }), maxChars: 512 };
    const denied = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: endpointIdForTool(tool), arguments: args } });
    expect(denied.isError).toBe(true);
    expect((denied.content as any)[0].text).not.toContain('InitiallyHidden');
    const allowed = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: endpointIdForTool(tool), arguments: args } });
    expect(allowed.isError).not.toBe(true);
    expect(JSON.parse((allowed.content as any)[0].text).revision).toBe(hash(published));
  } finally { await client.close(); await server.close(); }
});
