import { guidanceError } from './guidance-runtime.js';
import { assertEnterpriseStorageFresh, assertOwnerActivityStorageAccess, prepareOwnerActivityStorageWrite } from './enterprise-storage-context.js';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, unlink, type FileHandle } from 'node:fs/promises';
import { lstatSync, realpathSync, type Stats } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { hostSourceRoots } from './host-source-roots.js';

// Confined host-private storage shared by every host feature: canonical local
// path validation plus bounded, fenced, atomic file IO under a trusted root.

export const isUNCPath = (path: string): boolean => /^(?:\\\\|\/\/)/.test(path);
export const pathInside = (root: string, path: string): boolean => {
  const r = relative(root, path); return !r || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r));
};

/** Inspect lexical ancestors BEFORE realpath can hide a junction. Host-provisioned
 * roots must exist; device namespaces and dot segments are not storage aliases. */
export async function canonicalHostPath(path: string, local: boolean, file = false): Promise<string> {
  if (typeof path !== 'string' || !isAbsolute(path) || /^(?:\\\\|\/\/)[?.][\\/]/.test(path)
    || path.split(/[\\/]+/).some(part => part === '.' || part === '..')) throw guidanceError(new Error('Roleplay needs canonical absolute storage paths without device aliases or dot segments'), 'guid-b778d07e4fe47825');
  if (local && isUNCPath(path)) throw guidanceError(new Error('Roleplay host storage must be local and outside Vault/source'), 'guid-12501d308b72a4de');
  const root = parse(path).root;
  let current = root;
  const parts = path.slice(root.length).split(/[\\/]+/).filter(Boolean);
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) current = join(current, parts[i]!);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw guidanceError(new Error('Roleplay storage refuses symbolic-link or junction path components'), 'guid-c214792552584bc2');
    if (file && i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()) throw guidanceError(new Error('Roleplay storage path has an invalid file type'), 'guid-79de38f9d85b981c');
  }
  const canonical = await realpath(path);
  if (local && isUNCPath(canonical)) throw guidanceError(new Error('Roleplay host storage must be canonical local storage'), 'guid-2045390514d0533e');
  return canonical;
}

let sources: Promise<string[]> | undefined;
export async function validateHostStorage(options: { vaultPath: string; hostPath: string }): Promise<{ vaultPath: string; hostPath: string }> {
  // Reject a network host root before even resolving the Vault.
  const hostPath = await canonicalHostPath(options.hostPath, true);
  const vaultPath = await canonicalHostPath(options.vaultPath, false);
  if (pathInside(vaultPath, hostPath) || pathInside(hostPath, vaultPath)
    || (await (sources ??= hostSourceRoots(import.meta.url))).some(source => pathInside(source, hostPath))) {
    throw guidanceError(new Error('Roleplay checkpoint must be local and outside Vault/source'), 'guid-febc054cac933e9e');
  }
  return { vaultPath, hostPath };
}

const MAX_HOST_FILE_BYTES = 64 * 1024 * 1024;

export interface HostFileLimit {
  maxBytes: number;
  label?: string;
  /** Trusted logical Vault path for optional-activity authorization. Host-only
   * checkpoints omit it even when this helper supplies their confined IO. */
  ownerPath?: string;
  /** Host-only writer fencing, immediately before atomic publication. */
  beforeCommit?: () => Promise<void>;
}

function ownerPath(options: HostFileLimit): string | undefined {
  if (options.ownerPath === undefined) return undefined;
  const path = options.ownerPath.replace(/\\/g, '/');
  if (!path || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw guidanceError(new Error('Invalid owner activity storage path'), 'guid-48299d78ec39bf08');
  }
  return path;
}

function checkedLimit(options: HostFileLimit): number {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > MAX_HOST_FILE_BYTES) {
    throw guidanceError(new Error(`maxBytes must be an integer between 1 and ${MAX_HOST_FILE_BYTES}`), 'guid-54152e8590bede6e');
  }
  return options.maxBytes;
}

function label(options: HostFileLimit): string {
  const value = String(options.label || 'federation file').trim();
  return value || 'federation file';
}

function targetPath(root: string, target: string): string {
  const lexicalRoot = resolve(root);
  const candidate = isAbsolute(target) ? resolve(target) : resolve(lexicalRoot, target);
  if (!pathInside(lexicalRoot, candidate) || candidate === lexicalRoot) {
    throw guidanceError(new Error('Federation file target is outside the trusted root'), 'guid-c151366effa760d3');
  }
  return candidate;
}

function components(root: string, target: string): string[] {
  return relative(root, target).split(/[\\/]+/).filter(Boolean);
}

async function canonicalRoot(root: string): Promise<{ lexical: string; canonical: string }> {
  const lexical = resolve(root);
  const canonical = await realpath(lexical);
  const info = await lstat(canonical);
  if (!info.isDirectory()) throw guidanceError(new Error('Federation trusted root must be a directory'), 'guid-35788928a9e30c35');
  return { lexical, canonical };
}

async function assertSafeExistingPath(root: { lexical: string; canonical: string }, target: string, requireFile: boolean): Promise<void> {
  let current = root.lexical;
  const parts = components(root.lexical, target);
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]!);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw guidanceError(new Error('Federation storage refuses symbolic-link or junction path components'), 'guid-d5bb8e24d56b85ab');
    const canonical = await realpath(current);
    if (!pathInside(root.canonical, canonical)) throw guidanceError(new Error('Federation file canonical path escapes the trusted root'), 'guid-0ff1134aa1e22677');
    const final = index === parts.length - 1;
    if (!final && !info.isDirectory()) throw guidanceError(new Error('Federation storage parent path is not a directory'), 'guid-044296553d9ce398');
    if (final && requireFile && !info.isFile()) throw guidanceError(new Error('Federation file target is not a regular file'), 'guid-9ab0b30e8106ea22');
  }
}

/** Final bounded path fence: no awaited callback may run between this check
 * and dispatching the native mutation. This is not an OS administrator lock. */
function assertFinalPath(root: { lexical: string; canonical: string }, target: string, expected?: Stats): Stats {
  if (realpathSync(root.lexical) !== root.canonical) throw guidanceError(new Error('Federation trusted root binding changed'), 'guid-4c04a99af8deaefc');
  let current = root.lexical;
  let info = lstatSync(current);
  for (const part of components(root.lexical, target)) {
    if (!info.isDirectory()) throw guidanceError(new Error('Federation storage parent is not a directory'), 'guid-e842f9b2e9d1b059');
    current = join(current, part); info = lstatSync(current);
    if (info.isSymbolicLink() || !pathInside(root.canonical, realpathSync(current))) throw guidanceError(new Error('Federation storage path changed to a symbolic link or junction'), 'guid-72040e96b744216d');
  }
  if (expected && (info.ino !== expected.ino || info.dev !== expected.dev || info.isFile() !== expected.isFile())) throw guidanceError(new Error('Federation storage file binding changed'), 'guid-6086c69bdbed2b02');
  return info;
}

async function ensureSafeParent(root: { lexical: string; canonical: string }, parent: string): Promise<void> {
  let current = root.lexical;
  for (const component of components(root.lexical, parent)) {
    current = join(current, component);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw guidanceError(new Error('Federation storage refuses symbolic-link or junction path components'), 'guid-d5bb8e24d56b85ab');
      if (!info.isDirectory()) throw guidanceError(new Error('Federation storage parent path is not a directory'), 'guid-044296553d9ce398');
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      try { await mkdir(current, { mode: 0o700 }); }
      catch (mkdirError) {
        if (!(mkdirError && typeof mkdirError === 'object' && 'code' in mkdirError && mkdirError.code === 'EEXIST')) throw mkdirError;
      }
      const created = await lstat(current);
      if (created.isSymbolicLink()) throw guidanceError(new Error('Federation storage refuses symbolic-link or junction path components'), 'guid-d5bb8e24d56b85ab');
      if (!created.isDirectory()) throw guidanceError(new Error('Federation storage parent path is not a directory'), 'guid-044296553d9ce398');
    }
    const canonical = await realpath(current);
    if (!pathInside(root.canonical, canonical)) throw guidanceError(new Error('Federation file canonical path escapes the trusted root'), 'guid-0ff1134aa1e22677');
  }
}

export async function readHostFile(rootInput: string, targetInput: string, options: HostFileLimit): Promise<string> {
  assertEnterpriseStorageFresh();
  const authorizedPath = ownerPath(options);
  if (authorizedPath) assertOwnerActivityStorageAccess(authorizedPath);
  const maxBytes = checkedLimit(options);
  const root = await canonicalRoot(rootInput);
  const target = targetPath(root.lexical, targetInput);
  await assertSafeExistingPath(root, target, true);
  const handle = await open(target, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maxBytes) throw guidanceError(new Error(`${label(options)} exceeds its size limit`), 'guid-c938dfcfcc36a984');
    const buffer = Buffer.allocUnsafe(Math.min(maxBytes, before.size) + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
    }
    const after = await handle.stat();
    if (bytesRead > maxBytes || after.size > maxBytes) throw guidanceError(new Error(`${label(options)} exceeds its size limit`), 'guid-c938dfcfcc36a984');
    if (authorizedPath) assertOwnerActivityStorageAccess(authorizedPath);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

export async function ensureHostDirectory(rootInput: string, targetInput: string): Promise<void> {
  const root = await canonicalRoot(rootInput);
  const target = targetPath(root.lexical, targetInput);
  await ensureSafeParent(root, target);
}

export async function removeHostFile(rootInput: string, targetInput: string, beforeRemove?: () => Promise<void>): Promise<void> {
  assertEnterpriseStorageFresh();
  const root = await canonicalRoot(rootInput);
  const target = targetPath(root.lexical, targetInput);
  try {
    await assertSafeExistingPath(root, target, true);
    const identity = await lstat(target);
    await beforeRemove?.();
    assertFinalPath(root, target, identity);
    assertEnterpriseStorageFresh();
    await unlink(target);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}

export async function writeHostFileAtomic(rootInput: string, targetInput: string, content: string, options: HostFileLimit): Promise<void> {
  assertEnterpriseStorageFresh();
  const authorizedPath = ownerPath(options);
  const maxBytes = checkedLimit(options);
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw guidanceError(new Error(`${label(options)} exceeds its size limit`), 'guid-c938dfcfcc36a984');
  }
  const root = await canonicalRoot(rootInput);
  const target = targetPath(root.lexical, targetInput);
  const parent = dirname(target);
  // Owner consent first: ensureSafeParent creates missing folders.
  if (authorizedPath) await prepareOwnerActivityStorageWrite(authorizedPath);
  await ensureSafeParent(root, parent);
  const parentIdentity = await lstat(parent);
  try { await assertSafeExistingPath(root, target, true); }
  catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }

  const temporary = join(parent, `.${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  let temporaryIdentity: Stats | undefined;
  try {
    handle = await open(temporary, 'wx', 0o600);
    temporaryIdentity = await handle.stat();
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await ensureSafeParent(root, parent);
    try { await assertSafeExistingPath(root, target, true); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    if (authorizedPath) await prepareOwnerActivityStorageWrite(authorizedPath);
    await options.beforeCommit?.();
    assertFinalPath(root, parent, parentIdentity);
    assertFinalPath(root, temporary, temporaryIdentity);
    try { const destination = assertFinalPath(root, target); if (!destination.isFile()) throw guidanceError(new Error('Federation destination is not a regular file'), 'guid-279fdb5a0071af90'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    assertEnterpriseStorageFresh();
    if (authorizedPath) assertOwnerActivityStorageAccess(authorizedPath);
    await rename(temporary, target);
    await assertSafeExistingPath(root, target, true);
  } finally {
    try {
      if (temporaryIdentity) {
        assertFinalPath(root, parent, parentIdentity);
        assertFinalPath(root, temporary, temporaryIdentity);
        await unlink(temporary);
      }
    } catch { /* Never delete a redirected, replaced or already-published file. */ }
    finally { if (handle) await handle.close().catch(() => undefined); }
  }
}
