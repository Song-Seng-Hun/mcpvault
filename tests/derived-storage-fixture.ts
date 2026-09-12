import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { HostDerivedStorage } from '../src/host-derived-storage.js';

/** Explicit host-private fixture, not a production test-mode exception. */
export async function derivedStorageFixture(vaultPath: string) {
  const base = await realpath(tmpdir()), host = await mkdtemp(join(base, 'mcpvault-derived-fixture-'));
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [host, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
  const namespace = join(host, createHash('sha256').update(await realpath(vaultPath)).digest('hex'));
  await mkdir(namespace, { mode: 0o700 });
  return { host, storage: new HostDerivedStorage(vaultPath, host), path: (name: string) => join(namespace, name),
    close: async () => {
      const actual = await realpath(host), rel = relative(base, actual);
      if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(actual).startsWith('mcpvault-derived-fixture-')) throw new Error('Unsafe derived fixture cleanup');
      await rm(actual, { recursive: true, force: true });
    } };
}
