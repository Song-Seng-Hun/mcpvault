import { guidanceError } from './guidance-runtime.js';
import { assertEnterpriseStorageFresh, assertOwnerActivityStorageAccess, prepareOwnerActivityStorageWrite } from './enterprise-storage-context.js';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, unlink, type FileHandle } from 'node:fs/promises';
import { lstatSync, realpathSync, type Stats } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const MAX_FEDERATION_FILE_BYTES = 64 * 1024 * 1024;

export interface FederationFileLimit {
  maxBytes: number;
  label?: string;
  /** Trusted logical Vault path for optional-activity authorization. Host-only
   * checkpoints omit it even when this helper supplies their confined IO. */
  ownerPath?: string;
  /** Host-only writer fencing, immediately before atomic publication. */
  beforeCommit?: () => Promise<void>;
}

function ownerPath(options: FederationFileLimit): string | undefined {
  if (options.ownerPath === undefined) return undefined;
  const path = options.ownerPath.replace(/\\/g, '/');
  if (!path || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw guidanceError(new Error('Invalid owner activity storage path'), 'guid-c151366effa760d3');
  }
  return path;
}

function checkedLimit(options: FederationFileLimit): number {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > MAX_FEDERATION_FILE_BYTES) {
    throw guidanceError(new Error(`maxBytes must be an integer between 1 and ${MAX_FEDERATION_FILE_BYTES}`), 'guid-54152e8590bede6e');
  }
  return options.maxBytes;
}

function label(options: FederationFileLimit): string {
  const value = String(options.label || 'federation file').trim();
  return value || 'federation file';
}

function isInside(root: string, target: string): boolean {
  const child = relative(root, target);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

function targetPath(root: string, target: string): string {
  const lexicalRoot = resolve(root);
  const candidate = isAbsolute(target) ? resolve(target) : resolve(lexicalRoot, target);
  if (!isInside(lexicalRoot, candidate) || candidate === lexicalRoot) {
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
    if (!isInside(root.canonical, canonical)) throw guidanceError(new Error('Federation file canonical path escapes the trusted root'), 'guid-0ff1134aa1e22677');
    const final = index === parts.length - 1;
    if (!final && !info.isDirectory()) throw guidanceError(new Error('Federation storage parent path is not a directory'), 'guid-044296553d9ce398');
    if (final && requireFile && !info.isFile()) throw guidanceError(new Error('Federation file target is not a regular file'), 'guid-9ab0b30e8106ea22');
  }
}

/** Final bounded path fence: no awaited callback may run between this check
 * and dispatching the native mutation. This is not an OS administrator lock. */
function assertFinalPath(root: { lexical: string; canonical: string }, target: string, expected?: Stats): Stats {
  if (realpathSync(root.lexical) !== root.canonical) throw new Error('Federation trusted root binding changed');
  let current = root.lexical;
  let info = lstatSync(current);
  for (const part of components(root.lexical, target)) {
    if (!info.isDirectory()) throw new Error('Federation storage parent is not a directory');
    current = join(current, part); info = lstatSync(current);
    if (info.isSymbolicLink() || !isInside(root.canonical, realpathSync(current))) throw new Error('Federation storage path changed to a symbolic link or junction');
  }
  if (expected && (info.ino !== expected.ino || info.dev !== expected.dev || info.isFile() !== expected.isFile())) throw new Error('Federation storage file binding changed');
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
    if (!isInside(root.canonical, canonical)) throw guidanceError(new Error('Federation file canonical path escapes the trusted root'), 'guid-0ff1134aa1e22677');
  }
}

export async function readFederationFile(rootInput: string, targetInput: string, options: FederationFileLimit): Promise<string> {
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

export async function ensureFederationDirectory(rootInput: string, targetInput: string): Promise<void> {
  const root = await canonicalRoot(rootInput);
  const target = targetPath(root.lexical, targetInput);
  await ensureSafeParent(root, target);
}

export async function removeFederationFile(rootInput: string, targetInput: string, beforeRemove?: () => Promise<void>): Promise<void> {
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

export async function writeFederationFileAtomic(rootInput: string, targetInput: string, content: string, options: FederationFileLimit): Promise<void> {
  assertEnterpriseStorageFresh();
  const authorizedPath = ownerPath(options);
  const maxBytes = checkedLimit(options);
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw guidanceError(new Error(`${label(options)} exceeds its size limit`), 'guid-c938dfcfcc36a984');
  }
  const root = await canonicalRoot(rootInput);
  const target = targetPath(root.lexical, targetInput);
  const parent = dirname(target);
  await ensureSafeParent(root, parent);
  const parentIdentity = await lstat(parent);
  if (authorizedPath) await prepareOwnerActivityStorageWrite(authorizedPath);
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
    try { const destination = assertFinalPath(root, target); if (!destination.isFile()) throw new Error('Federation destination is not a regular file'); }
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

/** Display prefix is advisory; full identity digest prevents delimiter/truncation collisions. */
export function federationStorageName(id: string): string {
  return `${id.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 40)}-${createHash('sha256').update(id, 'utf8').digest('hex')}`;
}
