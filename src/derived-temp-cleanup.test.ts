import { mkdtemp, mkdir, readdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupStaleDerivedTemps } from './derived-temp-cleanup.js';

test('cleans abandoned derived temp files but preserves live-process temps', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-derived-temp-'));
  try {
    const root = join(vault, '.mcpvault');
    const semantic = join(root, 'semantic-index');
    await mkdir(semantic, { recursive: true });
    await writeFile(join(root, 'metadata-index.snapshot.bin.999999999.tmp'), 'stale');
    await writeFile(join(semantic, 'pending.snapshot.gz.999999999.tmp'), 'stale');
    await writeFile(join(semantic, `pending.snapshot.gz.${process.pid}.tmp`), 'live');
    await cleanupStaleDerivedTemps(vault);
    const rootNames = await readdir(root);
    const semanticNames = await readdir(semantic);
    expect(rootNames).not.toContain('metadata-index.snapshot.bin.999999999.tmp');
    expect(semanticNames).not.toContain('pending.snapshot.gz.999999999.tmp');
    expect(semanticNames).toContain(`pending.snapshot.gz.${process.pid}.tmp`);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});
