import assert from 'node:assert/strict';
import { lstat, realpath, mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function safeFile(path) {
  const info = await lstat(path);
  assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= 32 * 1024 * 1024, 'Unsafe or oversized input');
  return readFile(path);
}
async function safeDirectory(path) {
  const info = await lstat(path); assert(info.isDirectory() && !info.isSymbolicLink() && resolve(await realpath(path)) === resolve(path), 'Unsafe directory');
}
async function makeDirectories(root, parts) {
  await safeDirectory(root); let current = root;
  for (const part of parts) {
    assert(/^[a-zA-Z0-9_.-]+$/.test(part) && !['.', '..'].includes(part), 'Unsafe directory component');
    current = join(current, part); try { await mkdir(current); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    await safeDirectory(current);
  }
  return current;
}
export async function sourceBasis(root, files) {
  await safeDirectory(root);
  const inputs = new Set(['package.json', 'package-lock.json', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.build.json', 'node_modules/vitest/package.json']);
  for (const entry of await readdir(root, { withFileTypes: true })) if (entry.isFile() && /\.(ts|md)$/.test(entry.name)) inputs.add(entry.name);
  for (const tree of ['src', 'tests', 'scripts', 'dist', 'docs/architecture']) {
    try { await safeDirectory(join(root, tree)); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const pending = [tree];
    for (const dir of pending) for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      if (['__pycache__', 'node_modules'].includes(entry.name)) continue;
      assert(!entry.isSymbolicLink(), 'Linked source refused'); const path = dir + '/' + entry.name;
      if (entry.isDirectory()) { await safeDirectory(join(root, path)); pending.push(path); }
      else if (entry.isFile() && !/\.(pyc|log|tmp)$/.test(entry.name)) inputs.add(path);
    }
  }
  for (const arm of ['free', 'managed']) {
    const path = `docs/research/workshop-evaluation-${arm}.json`;
    try { await safeFile(join(root, path)); inputs.add(path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const digest = createHash('sha256'); digest.update(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, files, heapMiB: 512 }));
  for (const path of [...inputs].sort()) { digest.update(path + '\0'); digest.update(await safeFile(join(root, path))); }
  return digest.digest('hex');
}
export async function ensureRunDirectory(root, id, resume) {
  assert(/^[a-z0-9][a-z0-9-]{0,63}$/.test(id), 'Unsafe run ID');
  const parent = await makeDirectories(root, ['.mcpvault', 'test-runs']); const dir = join(parent, id);
  if (!resume) await mkdir(dir); await safeDirectory(dir); return dir;
}
function recordPath(dir, name) { assert(/^[a-z0-9][a-z0-9.-]*\.json$/.test(name) && !name.includes('..'), 'Unsafe record name'); return join(dir, name); }
export async function writeRecord(dir, name, value) {
  await safeDirectory(dir); const bytes = JSON.stringify(value);
  assert(Buffer.byteLength(bytes) <= 32 * 1024 * 1024, 'Record oversized');
  await writeFile(recordPath(dir, name), bytes, { flag: 'wx', mode: 0o600 });
}
export async function readRecord(dir, name) { await safeDirectory(dir); return JSON.parse((await safeFile(recordPath(dir, name))).toString('utf8')); }
export async function acquireWorker(root) {
  const dir = await makeDirectories(root, ['.mcpvault', 'test-runs']);
  const value = { pid: process.pid, nonce: randomUUID() };
  await writeRecord(dir, 'worker.json', value);
  return async () => { assert.deepEqual(await readRecord(dir, 'worker.json'), value, 'Worker ownership changed; preserve lock'); await unlink(join(dir, 'worker.json')); };
}
