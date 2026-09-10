import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { DocumentResourceReader } from './document-resource.js';

let root: string, reader: DocumentResourceReader;
const access = new ScopeAccessPolicy();
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-document-resource-'));
  reader = new DocumentResourceReader(new FileSystemService(root), new PathFilter(), access);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test('reads original bytes and revision without granting note APIs new extensions', async () => {
  const bytes = Buffer.from('#!/bin/sh\r\necho "한글"\r\n', 'utf8');
  await writeFile(join(root, 'sample.sh'), bytes);
  expect(new PathFilter().isAllowed('sample.sh')).toBe(false);
  const result = await reader.read('sample.sh');
  expect(result.path).toBe('sample.sh');
  expect(result.bytes).toEqual(bytes);
  expect(result.text).toBe(bytes.toString('utf8'));
  expect(result.revision).toBe(createHash('sha256').update(bytes).digest('hex'));
  expect(result.mediaType).toBe('text/x-shellscript');
});

test('PDF reads preserve bytes without interpreting them as UTF-8 or running anything', async () => {
  const bytes = Buffer.from([37, 80, 68, 70, 45, 49, 255, 0]);
  await writeFile(join(root, 'sample.pdf'), bytes);
  const result = await reader.read('sample.pdf');
  expect(result.bytes).toEqual(bytes);
  expect(result.text).toBeUndefined();
  expect(result.mediaType).toBe('application/pdf');
});

test('checks revision and bounded bytes and rejects malformed text', async () => {
  await writeFile(join(root, 'note.md'), '# Test\n');
  const current = await reader.read('note.md');
  await expect(reader.read('note.md', undefined, { expectedRevision: current.revision })).resolves.toMatchObject({ revision: current.revision });
  await writeFile(join(root, 'note.md'), '# Changed\n');
  await expect(reader.read('note.md', undefined, { expectedRevision: current.revision })).rejects.toThrow(/revision|stale/i);
  await expect(reader.read('note.md', undefined, { maxBytes: 3 })).rejects.toThrow(/budget|limit/i);
  await writeFile(join(root, 'bad.txt'), Buffer.from([0xff, 0xfe, 0xfd]));
  await expect(reader.read('bad.txt')).rejects.toThrow(/UTF-8/i);
});

test.each(['../outside.md', '/note.md', 'C:/private.txt', 'a/../note.md', '.secrets.txt', 'a/.git/config', 'x.md:stream', 'name. ', 'folder//note.md'])('refuses unsafe input %s', async path => {
  await expect(reader.read(path)).rejects.toThrow();
});

test('private scopes and moderation apply to every raw/derived entry point', async () => {
  await mkdir(join(root, '_scopes', 'agents', 'secret'), { recursive: true });
  await writeFile(join(root, '_scopes', 'agents', 'secret', 'hidden.sh'), 'echo hidden');
  await expect(reader.read('_scopes/agents/secret/hidden.sh')).rejects.toThrow(/unavailable|denied|private/i);
  await writeFile(join(root, 'hidden.md'), '---\nmoderation_status: hidden\n---\nsecret');
  await expect(reader.read('hidden.md')).rejects.toThrow(/unavailable|hidden/i);
  await writeFile(join(root, 'quoted.md'), '---\nmoderation_status: "quarantined"\n---\nsecret');
  await expect(reader.read('quoted.md')).rejects.toThrow(/unavailable|hidden/i);
});

test('rejects canonical aliases into another scope and junction directories', async () => {
  await mkdir(join(root, 'inside'));
  await writeFile(join(root, 'inside', 'note.md'), 'private-ish');
  await symlink(join(root, 'inside'), join(root, 'alias'), 'junction');
  await expect(reader.read('alias/note.md')).rejects.toThrow(/alias|canonical|symbolic|junction/i);
});

test('revalidation detects replacement even if a caller still holds the old snapshot', async () => {
  await writeFile(join(root, 'note.md'), 'old');
  const snapshot = await reader.read('note.md');
  await writeFile(join(root, 'note.md'), 'new');
  await expect(reader.assertCurrent(snapshot)).rejects.toThrow(/revision|stale/i);
});

test('authorized agent-scope URI survives canonical validation and revision rereads', async () => {
  const principal = { accountId: 'alice', modelId: 'gpt', agentId: 'alice-worker', role: 'agent' as const };
  await mkdir(join(root, '_scopes', 'agents', 'alice-worker'), { recursive: true });
  await writeFile(join(root, '_scopes', 'agents', 'alice-worker', 'private.md'), '# Mine');
  const snapshot = await reader.read('scope://agent/alice-worker/private.md', principal);
  expect(snapshot.text).toBe('# Mine');
  await expect(reader.assertCurrent(snapshot, principal)).resolves.toBeUndefined();
  await expect(reader.read('scope://agent/alice-worker/private.md', { ...principal, agentId: 'someone-else' })).rejects.toThrow();
});
