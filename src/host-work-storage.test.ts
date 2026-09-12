import { afterEach, beforeEach, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { loadHostWorkStorage, type HostWorkWriter } from './host-work-storage.js';

type FixtureState = { version: 1; marker: string };
const validate = (value: unknown): FixtureState & { enabled: boolean } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid fixture state');
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || typeof raw.marker !== 'string' || typeof raw.enabled !== 'boolean') throw new Error('invalid fixture state');
  return { version: 1, marker: raw.marker, enabled: raw.enabled };
};

let root: string, vault: string, hostRoot: string, config: string, identity: string;
const writers: HostWorkWriter[] = [];

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'host-work-storage-')));
  vault = join(root, 'Vault'); hostRoot = join(root, 'Host'); config = join(hostRoot, 'config.json');
  await mkdir(vault); await mkdir(hostRoot, { mode: 0o700 });
  identity = createHash('sha256').update((await realpath(vault)).toLowerCase()).digest('hex');
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [hostRoot, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
  await writeFile(config, JSON.stringify({ version: 1, enabled: true, marker: 'config', vaultPath: vault }), { mode: 0o600 });
});

afterEach(async () => {
  for (const writer of writers) await writer.close().catch(() => {});
  writers.length = 0;
  await rm(root, { recursive: true, force: true });
});

test('maintenance and compilation use isolated state and leases', async () => {
  const maintenance = await loadHostWorkStorage(config, vault, { namespace: 'maintenance', maxStateBytes: 4096, validate });
  const compilation = await loadHostWorkStorage(config, vault, { namespace: 'compilation', maxStateBytes: 4096, validate });
  const maintenanceWriter = await maintenance.acquire();
  const compilationWriter = await compilation.acquire();
  writers.push(maintenanceWriter, compilationWriter);
  await maintenance.readState(); await compilation.readState();
  await maintenance.writeState({ version: 1, enabled: true, marker: 'maintenance' });
  await compilation.writeState({ version: 1, enabled: true, marker: 'compilation' });
  await expect(maintenance.readState()).resolves.toMatchObject({ marker: 'maintenance' });
  await expect(compilation.readState()).resolves.toMatchObject({ marker: 'compilation' });
  await maintenanceWriter.close(); await compilationWriter.close();
  expect(await readdir(hostRoot)).toEqual(expect.arrayContaining([
    `maintenance-${identity}.json`, `compilation-${identity}.json`,
  ]));
});

test('a namespace lease does not block the other namespace', async () => {
  const maintenance = await loadHostWorkStorage(config, vault, { namespace: 'maintenance', maxStateBytes: 4096, validate });
  const compilation = await loadHostWorkStorage(config, vault, { namespace: 'compilation', maxStateBytes: 4096, validate });
  const maintenanceWriter = await maintenance.acquire();
  const compilationWriter = await compilation.acquire();
  writers.push(maintenanceWriter, compilationWriter);
  await maintenanceWriter.close(); await compilationWriter.close();
});

test('captures namespace, limit, and validator before and after asynchronous loading', async () => {
  let options: { namespace: 'maintenance' | 'compilation'; maxStateBytes: number; validate: typeof validate } = {
    namespace: 'maintenance', maxStateBytes: 4096, validate,
  };
  const loading = loadHostWorkStorage(config, vault, options);
  options.namespace = 'compilation'; options.maxStateBytes = 1;
  options.validate = () => { throw new Error('mutated validator must not run'); };
  const storage = await loading;
  expect((await storage.refresh()).enabled).toBe(true);
  options.namespace = 'compilation'; options.maxStateBytes = 1;
  options.validate = () => { throw new Error('post-load validator must not run'); };
  const writer = await storage.acquire();
  writers.push(writer);
  await storage.readState();
  await storage.writeState({ version: 1, enabled: true, marker: 'stable' });
  await writer.close();
  expect(await readdir(hostRoot)).toEqual(expect.arrayContaining([`maintenance-${identity}.json`].map(name => name)));
});

test.each([
  ['maintenance', `maintenance-${'x'.repeat(64)}.json`],
  ['compilation', `compilation-${'x'.repeat(64)}.writer.lock`],
] as const)('rejects config collision with managed %s storage', async (namespace, filename) => {
  const target = join(hostRoot, filename.replace('x'.repeat(64), identity));
  await writeFile(target, '{}', { mode: 0o600 });
  await expect(loadHostWorkStorage(target, vault, { namespace, maxStateBytes: 4096, validate })).rejects.toThrow(/overlaps managed host storage/i);
});

test('rejects an invalid namespace at runtime', async () => {
  await expect(loadHostWorkStorage(config, vault, { namespace: 'maintenance\u0000' as never, maxStateBytes: 4096, validate })).rejects.toThrow(/namespace/i);
});
