import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_HOST_FEATURE_CONFIG } from './host-features.js';
import * as privacy from './skill-evolution-host.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const load = async (file: string | undefined, vault: string) => (await import('./host-feature-config.js')).loadHostFeatureConfig(file, vault);
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'features-vault-')), host = await mkdtemp(join(tmpdir(), 'features-host-')); roots.push(vault, host);
  return { vault, host, file: join(host, 'features.json') };
}

test('no config means a frozen explicit wiki-only selection without probing host storage', async () => {
  const check = vi.spyOn(privacy, 'assertHostPrivateStorage');
  expect(await load(undefined, 'unused')).toEqual(DEFAULT_HOST_FEATURE_CONFIG);
  expect(check).not.toHaveBeenCalled();
});
test('bounded verified host selection is loaded once and cannot be expanded by mutating the file', async () => {
  const { vault, file } = await fixture(); vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue();
  await writeFile(file, JSON.stringify({ version: 1, selected: ['wiki-core', 'document-search'] }));
  const config = await load(file, vault);
  await writeFile(file, JSON.stringify({ version: 1, selected: ['wiki-core', 'economy'] }));
  expect(config.selected).toEqual(['document-search', 'wiki-core']); expect(Object.isFrozen(config.selected)).toBe(true);
});
test('unverified host storage and Vault/source configuration are not feature authorities', async () => {
  const { vault, file } = await fixture();
  await writeFile(file, JSON.stringify(DEFAULT_HOST_FEATURE_CONFIG));
  vi.spyOn(privacy, 'assertHostPrivateStorage').mockRejectedValue(Error('private permissions unverified'));
  await expect(load(file, vault)).rejects.toThrow(/private|permissions/i);
  await writeFile(join(vault, 'features.json'), JSON.stringify(DEFAULT_HOST_FEATURE_CONFIG));
  await expect(load(join(vault, 'features.json'), vault)).rejects.toThrow(/outside|Vault|source/i);
});
test('oversized, missing, malformed and implicit all selections fail closed', async () => {
  const { vault, file } = await fixture(); vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue();
  await expect(load(file, vault)).rejects.toThrow();
  for (const content of ['x'.repeat(17000), '{', JSON.stringify({ version: 1, selected: ['all'] })]) {
    await writeFile(file, content); await expect(load(file, vault)).rejects.toThrow();
  }
});
