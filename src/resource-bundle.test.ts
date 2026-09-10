import { beforeEach, afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { PathFilter } from './pathfilter.js';
import { DocumentResourceReader } from './document-resource.js';
import { DocumentIndex } from './document-index.js';
import { DocumentService } from './document-service.js';
import { readSkillResourceBundle, previewResourceBundle, applyResourceBundle, type ResourceBundleHostEntry } from './resource-bundle-host.js';
let root: string, vault: string, entry: ResourceBundleHostEntry;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-resource-host-')); vault = join(root, 'vault'); await mkdir(vault);
  const source = join(root, 'source'); await mkdir(join(source, 'scripts'), { recursive: true });
  await writeFile(join(source, 'SKILL.md'), '---\nname: sample\ndescription: Reference\n---\n# Read [script](scripts/test.sh)\n');
  await writeFile(join(source, 'LICENSE'), 'MIT License\nPermission is hereby granted, free of charge, to any person obtaining a copy');
  await writeFile(join(source, 'scripts/test.sh'), '#!/bin/sh\r\nexit 73\r\n');
  entry = { id: 'sample', origin: 'example/plugin', version: '1', root: source, licensePath: join(source, 'LICENSE'), publishResourcesToCommunity: true };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
test('host bundle preserves original bytes/paths/licenses, revision checks apply and retries are no-op', async () => {
  const original = Buffer.from([0, 255, 27, 88]); await writeFile(join(entry.root, 'image.png'), original);
  const source = await readSkillResourceBundle(entry);
  expect(source.files.map(f => f.path)).toContain('scripts/test.sh');
  const preview = await previewResourceBundle(vault, source);
  await expect(applyResourceBundle(vault, source, 'stale')).rejects.toThrow(/fingerprint/i);
  const applied = await applyResourceBundle(vault, source, preview.fingerprint);
  const reader = new DocumentResourceReader(new FileSystemService(vault), new PathFilter(), new ScopeAccessPolicy());
  const script = await reader.read(`${applied.path}/files/scripts/test.sh`);
  expect(script.bytes).toEqual(await readFile(join(entry.root, 'scripts/test.sh')));
  expect((await reader.read(`${applied.path}/files/image.png`)).bytes).toEqual(original);
  expect(script.revision).toBe(createHash('sha256').update(script.bytes).digest('hex'));
  const replay = await previewResourceBundle(vault, source);
  expect((await applyResourceBundle(vault, source, replay.fingerprint)).status).toBe('unchanged');
});
test('requires explicit host community admission, rejects secret text and junction sources', async () => {
  await expect(readSkillResourceBundle({ ...entry, publishResourcesToCommunity: false } as any)).rejects.toThrow(/community|admission/i);
  await writeFile(join(entry.root, 'scripts/test.sh'), 'ghp_abcdefghijklmnopqrstuvwxyz1234567890');
  await expect(readSkillResourceBundle(entry)).rejects.toThrow(/sensitive|quarantine/i);
  await writeFile(join(entry.root, 'scripts/test.sh'), 'safe');
  await symlink(join(entry.root, 'scripts'), join(entry.root, 'alias'), 'junction');
  await expect(readSkillResourceBundle(entry)).rejects.toThrow(/junction|symbolic|alias/i);
});
test('manifest moderation and original hash gate every bundle resource read', async () => {
  const source = await readSkillResourceBundle(entry), preview = await previewResourceBundle(vault, source);
  const applied = await applyResourceBundle(vault, source, preview.fingerprint);
  const reader = new DocumentResourceReader(new FileSystemService(vault), new PathFilter(), new ScopeAccessPolicy());
  const path = `${applied.path}/files/scripts/test.sh`;
  await writeFile(join(vault, path), 'tampered');
  await expect(reader.read(path)).rejects.toThrow(/hash|revision|bundle/i);
  await writeFile(join(vault, path), source.files.find(f => f.path === 'scripts/test.sh')!.bytes);
  const manifestPath = join(vault, applied.path, 'manifest.md');
  await writeFile(manifestPath, '---\nmoderation_status: hidden\n---\n' + await readFile(manifestPath, 'utf8'));
  await expect(reader.read(path)).rejects.toThrow(/unavailable|hidden/i);
});
test('generic filesystem writes cannot modify imported originals or move their ancestors', async () => {
  const source = await readSkillResourceBundle(entry), preview = await previewResourceBundle(vault, source);
  const applied = await applyResourceBundle(vault, source, preview.fingerprint), fs = new FileSystemService(vault);
  await expect(fs.writeNote({ path: `${applied.path}/manifest.md`, content: 'replace' })).rejects.toThrow(/immutable|resource/i);
});
test('manifest endpoint pages exact admitted original members with actionable export paths', async () => {
  const source = await readSkillResourceBundle(entry), preview = await previewResourceBundle(vault, source);
  const applied = await applyResourceBundle(vault, source, preview.fingerprint);
  const index = new DocumentIndex(new DocumentResourceReader(new FileSystemService(vault), new PathFilter(), new ScopeAccessPolicy()));
  try {
    const service = new DocumentService(index), manifest = await service.manifest({ path: `${applied.path}/manifest.md`, maxChars: 2400, limit: 1 } as any);
    expect((manifest as any).items).toHaveLength(1);
    expect((manifest as any).items[0].exportAction.arguments.path).toContain('/files/');
    expect(JSON.stringify(manifest).length).toBeLessThanOrEqual(2400);
    expect((manifest as any).cursor).toBeTruthy();
  } finally { index.close(); }
});
