// Synthetic watcher CPU benchmark. No Vault reads, listeners or source writes.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { VaultFileCatalog } from '../dist/src/vault-catalog.js';
import { PathFilter } from '../dist/src/pathfilter.js';

const implementation = createHash('sha256').update(await readFile(new URL('../dist/src/vault-catalog.js', import.meta.url))).digest('hex');
for (const count of [100_000, 1_000_000]) {
  const paths = Array.from({ length: count - 1 }, (_, i) => `Earlier/N${i}.md`);
  paths.push('Late/Note.md');
  for (const folder of ['Late', 'Missing']) {
    const times = [];
    for (let trial = 0; trial < 5; trial++) {
      const catalog = new VaultFileCatalog('synthetic-not-opened', new PathFilter());
      // Exercise the actual event handler with an already-published inventory.
      catalog.allPaths = paths;
      const start = performance.now();
      try {
        for (let event = 0; event < 100; event++) catalog.onFilesystemEvent(folder, 'change');
        times.push(performance.now() - start);
      } finally { catalog.close(); }
    }
    times.sort((a, b) => a - b);
    console.log(JSON.stringify({ implementation, documents: count, folder, events: 100,
      medianMs: Number(times[2].toFixed(2)), maximumMs: Number(times[4].toFixed(2)),
      scope: 'synthetic event classification only; no NAS IO or desktop latency' }));
  }
}
