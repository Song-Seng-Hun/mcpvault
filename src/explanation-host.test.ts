import { afterEach, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { loadExplanationHostConfig, validateExplanationHostConfig } from './explanation-host.js';
const roots: Array<{ root: string; base: string }> = [];
afterEach(async () => {
  for (const { root, base } of roots.splice(0)) {
    const actual = await realpath(root), rel = relative(base, actual);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(actual).startsWith('explanation-host-')) throw Error('Unsafe cleanup');
    await rm(actual, { recursive: true, force: true });
  }
});
const definition = { version: 1, enabled: true, sources: [{ path: 'Guide.md' }], profiles: [
  { accountId: 'writer', family: 'gemini', version: 'host-exact', hostVerified: true, tier: 'standard', tools: [], capabilities: [] },
] };
test('strict data-only configuration has explicit sources and verified persistent accounts', () => {
  expect(validateExplanationHostConfig(definition)).toMatchObject(definition);
  for (const changed of [{ ...definition, sources: [{ path: '../private.md' }] }, { ...definition, profiles: [...definition.profiles, ...definition.profiles] }, { ...definition, execute: 'something' }]) expect(() => validateExplanationHostConfig(changed)).toThrow();
});

test('host profile identity labels are canonicalized and padded unknown stays unverified', () => {
  const configured = validateExplanationHostConfig({ ...definition, profiles: [{ ...definition.profiles[0], family: ' Gemini ', version: ' exact-v1 ' }] });
  expect(configured.profiles[0]).toMatchObject({ family: 'gemini', version: 'exact-v1' });
  for (const key of ['family', 'version']) expect(() => validateExplanationHostConfig({ ...definition, profiles: [{ ...definition.profiles[0], [key]: ' unknown ' }] })).toThrow(/verified|unknown/i);
});
test('host loader is private, Vault bound, non-mutating and invalidates changed config', async () => {
  const base = await realpath(tmpdir()), root = await mkdtemp(join(base, 'explanation-host-')); roots.push({ root, base });
  const vault = join(root, 'vault'), host = join(root, 'private');
  await mkdir(vault); await mkdir(host, { mode: 0o700 });
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [host, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
  const path = join(host, 'explanations.json');
  await writeFile(path, JSON.stringify({ ...definition, vaultPath: vault }), { mode: 0o600 });
  const config = await loadExplanationHostConfig(path, vault);
  expect(config.sources[0].path).toBe('Guide.md'); expect(await config.executionProfiles()).toHaveLength(1);
  await writeFile(path, JSON.stringify({ ...definition, vaultPath: vault, profiles: [] }), { mode: 0o600 });
  await expect(config.executionProfiles()).rejects.toThrow(/changed|restart/i);
  await expect(loadExplanationHostConfig(path, host)).rejects.toThrow();
}, 30000);
