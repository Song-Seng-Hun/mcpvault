import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkPluginGuidance } from '../scripts/check-plugin-guidance.mjs';

const roots: string[] = [];
const files = ['skills/mcpvault-agent/SKILL.md', 'skills/mcpvault-agent/resources/HEARTBEAT.md'];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!root.startsWith(join(resolve(tmpdir()), 'mcpvault-guidance-'))) throw new Error('Unsafe fixture cleanup');
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(resolve(tmpdir()), 'mcpvault-guidance-'));
  roots.push(root);
  const source = join(root, 'source');
  const installed = join(root, 'installed');
  for (const directory of [source, installed]) {
    await mkdir(join(directory, 'skills/mcpvault-agent/resources'), { recursive: true });
    for (const path of files) await writeFile(join(directory, path), `current ${path}\n`);
  }
  return { source, installed };
}

test('matching guidance reports current without reading or modifying transport secrets', async () => {
  const { source, installed } = await fixture();
  const config = 'fixture transport: do not expose or replace';
  await writeFile(join(installed, '.mcp.json'), config);
  const report = await checkPluginGuidance(source, installed);
  expect(report.current).toBe(true);
  expect(report.files.map(item => item.status)).toEqual(['current', 'current']);
  expect(JSON.stringify(report)).not.toContain(config);
  expect(await readFile(join(installed, '.mcp.json'), 'utf8')).toBe(config);
});

test('same plugin version cannot conceal stale instruction content', async () => {
  const { source, installed } = await fixture();
  await writeFile(join(installed, files[0]!), 'old onboarding: always register');
  const report = await checkPluginGuidance(source, installed);
  expect(report.current).toBe(false);
  expect(report.files[0]!.status).toBe('different');
  expect(report.files[1]!.status).toBe('current');
  expect(JSON.stringify(report)).not.toContain('always register');
  expect(await readFile(join(installed, files[0]!), 'utf8')).toBe('old onboarding: always register');
});

test('missing installed guide is explicit and is not created by checking', async () => {
  const { source, installed } = await fixture();
  await rm(join(installed, files[1]!));
  const report = await checkPluginGuidance(source, installed);
  expect(report.current).toBe(false);
  expect(report.files[1]!.status).toBe('missing');
  await expect(readFile(join(installed, files[1]!))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('oversized guidance is rejected with bounded diagnostic output', async () => {
  const { source, installed } = await fixture();
  await writeFile(join(installed, files[0]!), 'x'.repeat(100_000));
  const report = await checkPluginGuidance(source, installed);
  expect(report.current).toBe(false);
  expect(report.files[0]!.status).toBe('oversized');
  expect(JSON.stringify(report).length).toBeLessThan(1500);
});

test('missing source guidance fails closed instead of accepting a matching absent file', async () => {
  const { source, installed } = await fixture();
  await rm(join(source, files[0]!));
  await rm(join(installed, files[0]!));
  const report = await checkPluginGuidance(source, installed);
  expect(report.current).toBe(false);
  expect(report.files[0]!.status).toBe('source-missing');
});

test('a junction in the guidance path cannot expose a target fingerprint', async () => {
  const { source, installed } = await fixture();
  const elsewhere = join(installed, 'elsewhere');
  await mkdir(elsewhere);
  await writeFile(join(elsewhere, 'SKILL.md'), 'unrelated fixture content');
  await rm(join(installed, 'skills/mcpvault-agent'), { recursive: true });
  await symlink(elsewhere, join(installed, 'skills/mcpvault-agent'), 'junction');
  try {
    const report = await checkPluginGuidance(source, installed);
    expect(report.current).toBe(false);
    expect(report.files[0]!.status).toBe('linked-path');
    expect(report.files[0]!.installedSha256).toBeUndefined();
    expect(report.files[1]!.status).toBe('linked-path');
  } finally {
    // Remove only this link, never recursively traverse its target.
    await rm(join(installed, 'skills/mcpvault-agent'));
  }
});

test('CLI uses the packaged source regardless of cwd and returns nonzero on drift', async () => {
  const { installed } = await fixture();
  for (const path of files) {
    await writeFile(join(installed, path), await readFile(resolve('plugins/mcpvault-local', path)));
  }
  const run = () => promisify(execFile)(process.execPath, [
    resolve('scripts/check-plugin-guidance.mjs'), '--installed-root', installed,
  ], { cwd: installed, windowsHide: true, timeout: 10_000, maxBuffer: 8192 });
  const result = await run();
  expect(JSON.parse(result.stdout).current).toBe(true);
  await writeFile(join(installed, files[0]!), 'stale');
  await expect(run()).rejects.toMatchObject({ code: 1 });
});

test('CLI rejects implicit or relative install locations', async () => {
  await expect(promisify(execFile)(process.execPath, [
    resolve('scripts/check-plugin-guidance.mjs'), '--installed-root', '.',
  ], { windowsHide: true, timeout: 10_000, maxBuffer: 8192 })).rejects.toMatchObject({ code: 2 });
});
