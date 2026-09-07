import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { MocRegionService } from './wiki-moc-regions.js';
import { extractObsidianLinkOccurrences, findUnresolvedLinkMatches } from './backlinks.js';
import { managedNavigationRegion } from './managed-navigation.js';
const principal = { accountId: 'owner', modelId: 'codex', role: 'model' as const, capabilities: ['write' as const] };
let vault: string; let fs: FileSystemService; let authorized: boolean; let service: MocRegionService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'moc-regions-')); fs = new FileSystemService(vault); authorized = true;
  service = new MocRegionService(vault, fs, new ScopeAccessPolicy(), async () => authorized ? principal : undefined);
  await writeFile(join(vault, 'Map.md'), '---\nnote_kind: moc\n---\n# Manual map\nKeep this order.\n');
  await mkdir(join(vault, 'Knowledge')); await writeFile(join(vault, 'Knowledge/A.md'), '# A\n');
});
afterEach(async () => { await service.close(); await rm(vault, { recursive: true, force: true }); });
async function register() {
  const preview = await service.run(principal, { path: 'Map.md', operation: 'preview', pathPrefix: 'Knowledge' });
  return service.run(principal, { ...preview.applyAction.arguments, operation: 'register' });
}
test('registered regions preserve manual prose and refresh create/delete with restart recovery', async () => {
  await register();
  expect((await fs.readNote('Map.md')).content).toContain('Keep this order.');
  expect((await fs.readNote('Map.md')).content).toContain('[[Knowledge/A.md]]');
  await writeFile(join(vault, 'Knowledge/B.md'), '# B\n');
  await service.notify([{ path: 'Knowledge/B.md', kind: 'upsert' }]); await service.flush();
  expect((await fs.readNote('Map.md')).content).toContain('[[Knowledge/B.md]]');
  const revision = (await fs.readNote('Map.md')).revision;
  await service.notify([{ path: 'Knowledge/B.md', kind: 'upsert' }]); await service.flush();
  expect((await fs.readNote('Map.md')).revision).toBe(revision);
  await service.close();
  service = new MocRegionService(vault, fs, new ScopeAccessPolicy(), async () => authorized ? principal : undefined);
  await rm(join(vault, 'Knowledge/A.md')); await service.start(); await service.flush();
  expect((await fs.readNote('Map.md')).content).not.toContain('[[Knowledge/A.md]]');
});
test('manual region edits stop rather than overwrite and require new preview', async () => {
  await register(); const note = await fs.readNote('Map.md');
  await fs.writeNote({ path: 'Map.md', content: note.content.replace('[[Knowledge/A.md]]', 'MANUAL'), frontmatter: note.frontmatter, expectedRevision: note.revision });
  await service.notify([{ path: 'Map.md', kind: 'upsert' }]); await service.flush();
  expect((await fs.readNote('Map.md')).content).toContain('MANUAL');
  expect((await service.run(principal, { path: 'Map.md', operation: 'status' })).status).toBe('conflict');
});
test('revocation, forged metadata, hidden/private notes and stale previews do not authorize writes', async () => {
  const preview = await service.run(principal, { path: 'Map.md', operation: 'preview', pathPrefix: 'Knowledge' });
  await writeFile(join(vault, 'Knowledge/B.md'), '# B');
  await expect(service.run(principal, { ...preview.applyAction.arguments, operation: 'register' })).rejects.toThrow(/changed|fingerprint/i);
  await register(); authorized = false;
  await writeFile(join(vault, 'Knowledge/C.md'), '# C');
  await service.notify([{ path: 'Knowledge/C.md', kind: 'upsert' }]); await service.flush();
  expect((await fs.readNote('Map.md')).content).not.toContain('Knowledge/C.md');
  expect((await service.run(principal, { path: 'Map.md', operation: 'status' })).status).toBe('suspended');
  expect(await readFile(join(vault, '.mcpvault/moc-regions.json'), 'utf8')).not.toContain('accessToken');
});
test('generated navigation remains navigable but cannot cure an orphan', async () => {
  await register(); const content = (await fs.readNote('Map.md')).content;
  expect(extractObsidianLinkOccurrences(content)[0]).toMatchObject({ origin: 'generated-navigation' });
  expect((await fs.findOrphanNotes()).orphans.map(row => row.path)).toContain('Knowledge/A.md');
});
test('region writes preserve raw frontmatter comments and forged registration cannot enroll', async () => {
  const header = '---\r\nnote_kind: moc # authored comment\r\nsummary_of_content_sha256: old\r\n---\r\n';
  await writeFile(join(vault, 'Map.md'), `${header}# Manual\r\n`);
  await register();
  expect(await readFile(join(vault, 'Map.md'), 'utf8')).toContain(header);
  await writeFile(join(vault, 'Forged.md'), '---\nnote_kind: moc\nmoc_region: {owner: owner, status: active}\n---\n# Forged');
  await service.notify([{ path: 'Knowledge/A.md', kind: 'upsert' }]); await service.flush();
  expect(await readFile(join(vault, 'Forged.md'), 'utf8')).not.toContain('MOC BEGIN');
});
test('rename/move/hidden changes are reflected, unrelated event bursts perform no query', async () => {
  await register();
  const queries = vi.spyOn(fs, 'queryNotes');
  for (let i = 0; i < 50; i++) await service.notify([{ path: `Elsewhere/${i}.md`, kind: 'upsert' }]);
  await service.flush(); expect(queries).not.toHaveBeenCalled();
  await rename(join(vault, 'Knowledge/A.md'), join(vault, 'Knowledge/Renamed.md'));
  await service.notify([{ path: 'Knowledge/A.md', kind: 'delete' }, { path: 'Knowledge/Renamed.md', kind: 'upsert' }]); await service.flush();
  expect((await fs.readNote('Map.md')).content).toContain('[[Knowledge/Renamed.md]]');
  await writeFile(join(vault, 'Knowledge/Renamed.md'), '---\nmoderation_status: hidden\n---\nSECRET');
  await service.notify([{ path: 'Knowledge/Renamed.md', kind: 'upsert' }]); await service.flush();
  expect((await fs.readNote('Map.md')).content).not.toContain('Renamed');
});
test('cross-scope, private, managed-community and malformed markers fail closed', async () => {
  for (const pathPrefix of ['Community', '_scopes/models/codex', '../Knowledge', '.mcpvault']) await expect(service.run(principal, { operation: 'preview', path: 'Map.md', pathPrefix })).rejects.toThrow();
  for (const path of ['_sources/Map.md', 'Community/Posts/x.md', '../Map.md']) await expect(service.run(principal, { operation: 'preview', path, pathPrefix: 'Knowledge' })).rejects.toThrow();
  await register(); const note = await fs.readNote('Map.md');
  await fs.writeNote({ path: 'Map.md', content: note.originalContent.replace('%% MCPVault MOC END %%', ''), expectedRevision: note.revision });
  await service.notify([{ path: 'Map.md', kind: 'upsert' }]); await service.flush();
  expect((await service.run(principal, { path: 'Map.md', operation: 'status' })).status).toBe('conflict');
});
test.runIf(process.platform === 'win32')('Windows case aliases cannot change the registering owner', async () => {
  await register();
  await expect(service.run({ ...principal, accountId: 'intruder' }, { path: 'map.md', operation: 'preview', pathPrefix: 'Knowledge' })).rejects.toThrow(/registering account/);
});

test.runIf(process.platform === 'win32')('Windows case aliases preserve folder membership and exclude the MOC itself', async () => {
  await writeFile(join(vault, 'Knowledge/Map.md'), '---\nnote_kind: moc\n---\n# Inner');
  const preview = await service.run(principal, { operation: 'preview', path: 'knowledge/map.md', pathPrefix: 'knowledge' });
  expect(preview.preview).toContain('[[Knowledge/A.md]]');
  expect(preview.preview).not.toContain('[[Knowledge/Map.md]]');
});

test('fenced markers are inert and generated links are excluded from generic repair', () => {
  const region = '%% MCPVault MOC BEGIN %%\n[[Missing]]\n%% MCPVault MOC END %%\n';
  expect(managedNavigationRegion('~~~md\n' + region + '~~~\n')).toBeUndefined();
  expect(findUnresolvedLinkMatches(region + '[[AuthoredMissing]]', []).map(row => row.target)).toEqual(['AuthoredMissing']);
});

test('moving the entire watched folder clears inventory and recreation resumes it', async () => {
  await register();
  await rename(join(vault, 'Knowledge'), join(vault, 'Moved'));
  await service.notify([{ path: 'Knowledge', kind: 'delete' }]); await service.flush();
  expect((await service.run(principal, { path: 'Map.md', operation: 'status' })).status).toBe('active');
  expect((await fs.readNote('Map.md')).content).not.toContain('Knowledge/A.md');
  await rename(join(vault, 'Moved'), join(vault, 'Knowledge'));
  await service.notify([{ path: 'Knowledge', kind: 'upsert' }]); await service.flush();
  expect((await fs.readNote('Map.md')).content).toContain('[[Knowledge/A.md]]');
});
