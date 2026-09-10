import { guidanceError } from './guidance-runtime.js';
import { readSkillSource, safeText, type SkillHostEntry } from './skill-library.js';
import { RESOURCE_BUNDLE_ROOT, safeResourceRelative, resourceBundleHash, renderResourceBundleManifest, parseResourceBundleManifest, type ResourceBundleManifest } from './resource-bundle.js';
import { DocumentResourceReader, documentMedia } from './document-resource.js';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { PathFilter } from './pathfilter.js';
import { mkdir, readdir, lstat, realpath, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export interface ResourceBundleSource { manifest: ResourceBundleManifest; files: Array<{ path: string; bytes: Buffer }> }
export interface ResourceBundleHostEntry extends SkillHostEntry { publishResourcesToCommunity: true }
export async function readSkillResourceBundle(entry: ResourceBundleHostEntry): Promise<ResourceBundleSource> {
  if (entry.publishResourcesToCommunity !== true) throw guidanceError(new Error('Explicit host admission to Community is required for all resource bytes'), 'guid-c39b2e371d6c3767');
  const skill = await readSkillSource(entry); // Existing license, sensitive Markdown, and host-root admission.
  const reader = new DocumentResourceReader(new FileSystemService(entry.root), new PathFilter(), new ScopeAccessPolicy());
  const files: ResourceBundleSource['files'] = [], entries: ResourceBundleManifest['entries'] = [];
  let visited = 0, total = 0;
  const add = (path: string, bytes: Buffer, mediaType: string) => {
    total += bytes.length;
    if (total > 64 * 1024 * 1024 || entries.length >= 128) throw guidanceError(new Error('Resource bundle inventory or byte budget exceeded'), 'guid-7700dcabd791a704');
    files.push({ path, bytes }); entries.push({ path, status: 'available', sha256: hash(bytes), byteLength: bytes.length, mediaType });
  };
  const visit = async (dir: string, depth: number) => {
    if (depth > 5) throw guidanceError(new Error('Resource bundle directory depth exceeded'), 'guid-81fd4ae9bb4a207e');
    for (const item of (await readdir(join(entry.root, dir), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++visited > 1024) throw guidanceError(new Error('Resource bundle inventory budget exceeded'), 'guid-4c0fcf219c4b0240');
      if (item.isSymbolicLink()) throw guidanceError(new Error('Resource bundle symbolic links or junctions require review'), 'guid-a2dcb20d9c437cb5');
      const path = dir ? `${dir}/${item.name}` : item.name;
      // Restricted host data is never copied or named in the public manifest.
      if (!safeResourceRelative(path)) continue;
      if (path.toLowerCase() === 'bundle-license.txt') throw guidanceError(new Error('Reserved bundle license path'), 'guid-79cedcf187331f49');
      if (item.isDirectory()) { await visit(path, depth + 1); continue; }
      if (!item.isFile()) continue;
      const media = documentMedia(path);
      if (media.mediaType === 'application/octet-stream') {
        if (entries.length >= 127) throw guidanceError(new Error('Resource bundle inventory budget exceeded'), 'guid-4c0fcf219c4b0240');
        entries.push({ path, status: 'rejected', reason: 'unsupported-binary-requires-host-review' }); continue;
      }
      const snapshot = await reader.read(path, undefined, { decodeText: false });
      if (media.text) {
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes); }
        catch { throw guidanceError(new Error('Resource text encoding requires host review'), 'guid-103351980d6bc629'); }
        safeText(text, 8 * 1024 * 1024);
      }
      add(path, snapshot.bytes, snapshot.mediaType);
    }
  };
  await visit('', 0);
  const licenseReader = new DocumentResourceReader(new FileSystemService(dirname(entry.licensePath!)), new PathFilter(), new ScopeAccessPolicy());
  const license = await licenseReader.read(basename(entry.licensePath!), undefined, { maxBytes: 131072 });
  add('bundle-license.txt', license.bytes, 'text/plain');
  entries.sort((a, b) => a.path.localeCompare(b.path)); files.sort((a, b) => a.path.localeCompare(b.path));
  return { manifest: { version: 1, id: skill.id, origin: skill.origin, sourceVersion: skill.version, license: skill.license,
    licenseFile: 'bundle-license.txt', entries, execution: 'never' }, files };
}
async function safeHostTarget(vault: string, path: string) {
  const root = await realpath(vault), target = resolve(root, path), rel = relative(root, target);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../')) throw guidanceError(new Error('Resource target escaped the admitted Vault'), 'guid-729cb7d6bf713fd9');
  let current = root;
  for (const part of rel.split(/[\\/]/)) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw guidanceError(new Error('Resource target cannot use junctions or symbolic links'), 'guid-7c7b5ef7be85b983'); }
    catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') break; throw error; }
  }
  return target;
}
function validateSource(source: ResourceBundleSource) {
  const revision = resourceBundleHash(source.manifest), content = renderResourceBundleManifest(source.manifest);
  parseResourceBundleManifest(content, revision);
  safeText(source.manifest.origin, 2000); safeText(source.manifest.sourceVersion, 2000);
  const accepted = source.manifest.entries.filter(e => e.status === 'available');
  if (source.files.length !== accepted.length || accepted.reduce((sum, e) => sum + e.byteLength!, 0) > 64 * 1024 * 1024) throw guidanceError(new Error('Resource bundle byte inventory mismatch'), 'guid-bb917d49bb354304');
  const seen = new Set<string>();
  for (const file of source.files) {
    const entry = accepted.find(e => e.path === file.path);
    if (seen.has(file.path) || !entry || !Buffer.isBuffer(file.bytes) || file.bytes.length !== entry.byteLength || hash(file.bytes) !== entry.sha256) throw guidanceError(new Error('Resource bundle source hash mismatch'), 'guid-c7831f79ed22840d');
    seen.add(file.path);
  }
  return { revision, content, path: `${RESOURCE_BUNDLE_ROOT}/${source.manifest.id}/${revision}` };
}
export async function previewResourceBundle(vault: string, source: ResourceBundleSource) {
  const prepared = validateSource(source), target = await safeHostTarget(vault, prepared.path);
  let exists = false;
  try { exists = (await lstat(target)).isDirectory(); } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
  if (exists) {
    const reader = new DocumentResourceReader(new FileSystemService(vault), new PathFilter(), new ScopeAccessPolicy());
    const manifest = await reader.read(`${prepared.path}/manifest.md`);
    if (manifest.text !== prepared.content) throw guidanceError(new Error('Immutable resource bundle manifest conflict'), 'guid-52cf9e0d542ef2b3');
    for (const file of source.files) {
      const current = await reader.read(`${prepared.path}/files/${file.path}`, undefined, { decodeText: false });
      if (current.revision !== hash(file.bytes)) throw guidanceError(new Error('Immutable resource bundle original conflict'), 'guid-d4bfa73981e51a5c');
    }
  }
  const status = exists ? 'unchanged' as const : 'create' as const;
  return { path: prepared.path, revision: prepared.revision, status, files: source.files.length,
    fingerprint: hash(JSON.stringify({ revision: prepared.revision, status })) };
}
export async function applyResourceBundle(vault: string, source: ResourceBundleSource, fingerprint: string) {
  const preview = await previewResourceBundle(vault, source);
  if (preview.fingerprint !== fingerprint) throw guidanceError(new Error('Resource bundle preview fingerprint changed'), 'guid-a69c78412feab0c8');
  if (preview.status === 'unchanged') return preview;
  const prepared = validateSource(source), parent = `${RESOURCE_BUNDLE_ROOT}/${source.manifest.id}`;
  const stagingPath = `${parent}/.pending-${randomUUID()}`, staging = await safeHostTarget(vault, stagingPath);
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    for (const file of source.files) {
      const target = await safeHostTarget(vault, `${stagingPath}/files/${file.path}`);
      await mkdir(dirname(target), { recursive: true }); await safeHostTarget(vault, `${stagingPath}/files/${file.path}`);
      await writeFile(target, file.bytes, { flag: 'wx' });
      if (hash(await readFile(target)) !== hash(file.bytes)) throw guidanceError(new Error('Resource original changed during staging'), 'guid-9402b7f77e4ef543');
    }
    await writeFile(await safeHostTarget(vault, `${stagingPath}/manifest.md`), prepared.content, { flag: 'wx' });
    if ((await previewResourceBundle(vault, source)).fingerprint !== fingerprint) throw guidanceError(new Error('Resource bundle preview changed before publication'), 'guid-b4ec86101e05b32c');
    await safeHostTarget(vault, stagingPath);
    await rename(staging, await safeHostTarget(vault, prepared.path));
    const verified = await previewResourceBundle(vault, source);
    return { ...verified, status: 'created' as const };
  } finally {
    // Only this exact UUID staging tree is eligible for cleanup; never the source or Vault root.
    const target = await safeHostTarget(vault, stagingPath);
    if (target !== staging || !basename(target).startsWith('.pending-')) throw guidanceError(new Error('Unsafe resource staging cleanup'), 'guid-2081e7bc429f4258');
    await rm(target, { recursive: true, force: true });
  }
}
