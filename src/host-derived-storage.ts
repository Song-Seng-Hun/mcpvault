import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, rename, unlink, open, opendir, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { readSnapshotBytes } from './snapshot-read.js';
import { writeGzipSnapshotHandle } from './snapshot-write.js';
import { canonicalRoleplayPath, validateRoleplayStorage } from './roleplay-storage-host.js';
import { assertHostPrivateStorage } from './skill-evolution-host.js';

/** Host-only disposable snapshots. Missing configuration means memory-only. */
export class HostDerivedStorage {
  constructor(readonly vaultPath: string, readonly cacheDir?: string) {}

  private name(name: string): void {
    if (!/^[a-z0-9][a-z0-9.-]{0,119}$/.test(name) || name.includes('..') || name.endsWith('.')) throw new Error('Invalid derivative snapshot name');
  }

  private async namespace(create = false): Promise<string> {
    if (!this.cacheDir) throw new Error('Private host derivative storage is not configured');
    const { vaultPath, hostPath } = await validateRoleplayStorage({ vaultPath: this.vaultPath, hostPath: this.cacheDir });
    await assertHostPrivateStorage([hostPath]);
    const namespace = createHash('sha256').update(vaultPath).digest('hex');
    const directory = join(hostPath, namespace);
    if (create) await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await canonicalRoleplayPath(directory, true);
    await assertHostPrivateStorage([hostPath, directory]);
    return directory;
  }

  /** A private child directory for a database backend, not a Vault path. */
  async directory(name: string, create = false): Promise<string> {
    this.name(name);
    const root = await this.namespace(create), path = join(root, name);
    if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await canonicalRoleplayPath(path, true);
    await assertHostPrivateStorage([root, path]);
    return path;
  }

  /** Native database backends also read descendants; a private parent alone is insufficient. */
  async verifiedTree(name: string, create = false): Promise<string> {
    const root = await this.directory(name, create), pending = [root], paths: string[] = [];
    let count = 0;
    for (let index = 0; index < pending.length; index++) {
      const directory = pending[index]!;
      for await (const entry of await opendir(directory)) {
        if (++count > 4096) throw new Error('Private derivative storage tree exceeds verification budget');
        const path = join(directory, entry.name), info = await lstat(path);
        if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || (info.isFile() && info.nlink !== 1)) throw new Error('Private derivative storage refuses linked files or directories');
        paths.push(path);
        if (info.isDirectory()) pending.push(path);
      }
    }
    for (let offset = 0; offset < paths.length; offset += 32) await assertHostPrivateStorage(paths.slice(offset, offset + 32));
    if (await this.directory(name) !== root) throw new Error('Private derivative storage changed during verification');
    return root;
  }

  private async assertFile(path: string): Promise<void> {
    await canonicalRoleplayPath(path, true, true);
    if ((await lstat(path)).nlink !== 1) throw new Error('Derivative snapshots cannot use shared file links');
    await assertHostPrivateStorage([path]);
  }

  async read(name: string, options: Parameters<typeof readSnapshotBytes>[1]): Promise<Buffer> {
    this.name(name);
    const directory = await this.namespace(), path = join(directory, name);
    await this.assertFile(path);
    const bytes = await readSnapshotBytes(path, options);
    if (await this.namespace() !== directory) throw new Error('Derivative storage changed during read');
    await this.assertFile(path);
    return bytes;
  }

  async write(name: string, bytes: Buffer, maxBytes: number): Promise<void> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || bytes.byteLength > maxBytes) throw new Error('Derivative snapshot byte limit exceeded');
    await this.publish(name, handle => handle.writeFile(bytes));
  }

  async writeGzip(name: string, chunks: Iterable<string | Uint8Array>, limits: Parameters<typeof writeGzipSnapshotHandle>[2]): Promise<void> {
    await this.publish(name, handle => writeGzipSnapshotHandle(handle, chunks, limits));
  }

  private async publish(name: string, write: (handle: FileHandle) => Promise<void>): Promise<void> {
    this.name(name);
    const directory = await this.namespace(true), destination = join(directory, name);
    const temporary = join(directory, `${name}.${randomUUID()}.tmp`);
    let written = false;
    let handle: FileHandle | undefined;
    try {
      handle = await open(temporary, 'wx', 0o600); written = true;
      if (await this.namespace() !== directory) throw new Error('Derivative storage changed before write');
      await this.assertFile(temporary);
      await write(handle);
      if (await this.namespace() !== directory) throw new Error('Derivative storage changed during write');
      await this.assertFile(temporary);
      try { await this.assertFile(destination); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await rename(temporary, destination); written = false;
      await this.assertFile(destination);
    } finally {
      // Only our exact, newly created temporary is eligible for cleanup.
      if (written) {
        try { if (await this.namespace() === directory) {
          await this.assertFile(temporary);
          const held = await handle!.stat(), current = await lstat(temporary);
          if (held.ino === current.ino && held.dev === current.dev) await unlink(temporary);
        } }
        catch { /* Changed storage is left for explicit host inspection. */ }
      }
      await handle?.close();
    }
  }
}
