import { assertEnterpriseStorageFresh } from './enterprise-storage-context.js';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const MAX_FEDERATION_FILE_BYTES = 64 * 1024 * 1024;

export interface FederationFileLimit {
  maxBytes: number;
  label?: string;
}

function checkedLimit(options: FederationFileLimit): number {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > MAX_FEDERATION_FILE_BYTES) {
    throw new Error(`maxBytes must be an integer between 1 and ${MAX_FEDERATION_FILE_BYTES}`);
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
    throw new Error('Federation file target is outside the trusted root');
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
  if (!info.isDirectory()) throw new Error('Federation trusted root must be a directory');
  return { lexical, canonical };
}

async function assertSafeExistingPath(root: { lexical: string; canonical: string }, target: string, requireFile: boolean): Promise<void> {
  let current = root.lexical;
  const parts = components(root.lexical, target);
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]!);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error('Federation storage refuses symbolic-link or junction path components');
    const canonical = await realpath(current);
    if (!isInside(root.canonical, canonical)) throw new Error('Federation file canonical path escapes the trusted root');
    const final = index === parts.length - 1;
    if (!final && !info.isDirectory()) throw new Error('Federation storage parent path is not a directory');
    if (final && requireFile && !info.isFile()) throw new Error('Federation file target is not a regular file');
  }
}

async function ensureSafeParent(root: { lexical: string; canonical: string }, parent: string): Promise<void> {
  let current = root.lexical;
  for (const component of components(root.lexical, parent)) {
    current = join(current, component);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error('Federation storage refuses symbolic-link or junction path components');
      if (!info.isDirectory()) throw new Error('Federation storage parent path is not a directory');
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      try { await mkdir(current, { mode: 0o700 }); }
      catch (mkdirError) {
        if (!(mkdirError && typeof mkdirError === 'object' && 'code' in mkdirError && mkdirError.code === 'EEXIST')) throw mkdirError;
      }
      const created = await lstat(current);
      if (created.isSymbolicLink()) throw new Error('Federation storage refuses symbolic-link or junction path components');
      if (!created.isDirectory()) throw new Error('Federation storage parent path is not a directory');
    }
    const canonical = await realpath(current);
    if (!isInside(root.canonical, canonical)) throw new Error('Federation file canonical path escapes the trusted root');
  }
}

export async function readFederationFile(rootInput: string, targetInput: string, options: FederationFileLimit): Promise<string> {
  assertEnterpriseStorageFresh();
  const maxBytes = checkedLimit(options);
  const root = await canonicalRoot(rootInput);
  const target = targetPath(root.lexical, targetInput);
  await assertSafeExistingPath(root, target, true);
  const handle = await open(target, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maxBytes) throw new Error(`${label(options)} exceeds its size limit`);
    const buffer = Buffer.allocUnsafe(Math.min(maxBytes, before.size) + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
    }
    const after = await handle.stat();
    if (bytesRead > maxBytes || after.size > maxBytes) throw new Error(`${label(options)} exceeds its size limit`);
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

export async function removeFederationFile(rootInput: string, targetInput: string): Promise<void> {
  assertEnterpriseStorageFresh();
  const root = await canonicalRoot(rootInput);
  const target = targetPath(root.lexical, targetInput);
  try {
    await assertSafeExistingPath(root, target, true);
    await unlink(target);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}

export async function writeFederationFileAtomic(rootInput: string, targetInput: string, content: string, options: FederationFileLimit): Promise<void> {
  assertEnterpriseStorageFresh();
  const maxBytes = checkedLimit(options);
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new Error(`${label(options)} exceeds its size limit`);
  }
  const root = await canonicalRoot(rootInput);
  const target = targetPath(root.lexical, targetInput);
  const parent = dirname(target);
  await ensureSafeParent(root, parent);
  try { await assertSafeExistingPath(root, target, true); }
  catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }

  const temporary = join(parent, `.${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await ensureSafeParent(root, parent);
    try { await assertSafeExistingPath(root, target, true); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await rename(temporary, target);
    await assertSafeExistingPath(root, target, true);
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

/** Display prefix is advisory; full identity digest prevents delimiter/truncation collisions. */
export function federationStorageName(id: string): string {
  return `${id.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 40)}-${createHash('sha256').update(id, 'utf8').digest('hex')}`;
}
