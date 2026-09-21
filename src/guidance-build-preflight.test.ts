import { expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('guidance generation rejects conflicts; catalog-only refresh leaves source untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidance-preflight-'));
  try {
    await mkdir(join(root, 'src'));
    const first = "export function check() { throw new Error('First source needs instrumentation'); }\n";
    const collision = "export function check() { guidanceError(new Error('One'), 'guid-collision'); guidanceError(new Error('Two'), 'guid-collision'); }\n";
    await writeFile(join(root, 'src/a.ts'), first);
    await writeFile(join(root, 'src/b.ts'), collision);
    await writeFile(join(root, 'src/guidance-defaults.generated.ts'), 'original catalog\n');
    const result = spawnSync(process.execPath, ['--max-old-space-size=384', resolve('node_modules/tsx/dist/cli.mjs'), resolve('scripts/guidance-build.ts'), '--write'], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Conflicting guidance ID guid-collision');
    expect(await readFile(join(root, 'src/a.ts'), 'utf8')).toBe(first);
    expect(await readFile(join(root, 'src/guidance-defaults.generated.ts'), 'utf8')).toBe('original catalog\n');
    await writeFile(join(root, 'src/b.ts'), '');
    const refreshed = spawnSync(process.execPath, ['--max-old-space-size=384', resolve('node_modules/tsx/dist/cli.mjs'), resolve('scripts/guidance-build.ts'), '--write-catalog'], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
    });
    expect(refreshed.status).toBe(0);
    expect(await readFile(join(root, 'src/a.ts'), 'utf8')).toBe(first);
    expect(await readFile(join(root, 'src/guidance-defaults.generated.ts'), 'utf8')).toContain('First source needs instrumentation');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 35000);
