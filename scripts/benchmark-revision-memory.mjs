// Opt-in, sequential, disposable 32 MiB comparison. Run after npm run build.
// Reports observations, not a timing threshold or whole-server memory claim.
import { mkdtemp, open, readFile, realpath, rm } from 'node:fs/promises';
import { join, relative, isAbsolute, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashUtf8Source } from '../dist/src/streaming-revision.js';

const prefix = 'mcpvault-revision-benchmark-', fixtureBytes = 32 * 1024 * 1024;
if (process.argv[2] === '--sample') {
  const mode = process.argv[3], path = process.argv[4];
  if (!['baseline', 'stream'].includes(mode) || !path || !global.gc) throw new Error('Invalid benchmark invocation');
  global.gc();
  const initial = process.memoryUsage(); let heapPeak = initial.heapUsed, bufferPeak = initial.arrayBuffers;
  const sample = () => {
    const m = process.memoryUsage(); heapPeak = Math.max(heapPeak, m.heapUsed); bufferPeak = Math.max(bufferPeak, m.arrayBuffers);
  };
  const timer = setInterval(sample, 5), start = performance.now();
  let digest;
  try {
    if (mode === 'baseline') {
      const raw = await readFile(path, 'utf8'); sample();
      digest = createHash('sha256').update(raw, 'utf8').digest('hex'); sample();
    } else { digest = await hashUtf8Source(path); sample(); }
  } finally { clearInterval(timer); }
  process.stdout.write(JSON.stringify({ mode, digest, elapsedMs: Math.round(performance.now() - start),
    maxRssMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(2),
    observedHeapPeakMiB: +(heapPeak / 1048576).toFixed(2),
    observedArrayBufferPeakMiB: +(bufferPeak / 1048576).toFixed(2) }));
} else {
  if (process.argv.length > 2) throw new Error('Run without arguments; this benchmark creates its own fixture');
  const base = await realpath(tmpdir()), root = await mkdtemp(join(base, prefix)), path = join(root, 'source.md');
  const run = mode => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--sample', mode, path],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout = (stdout + data).slice(0, 4096); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(0, 4096); });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) { reject(new Error(`Benchmark child failed (${code}): ${stderr}`)); return; }
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
  });
  try {
    const handle = await open(path, 'wx');
    try {
      const block = Buffer.from('한글🙂abc\n'.repeat(65536)); let offset = 0;
      while (offset < fixtureBytes) {
        const { bytesWritten } = await handle.write(block, 0, Math.min(block.length, fixtureBytes - offset));
        if (!bytesWritten) throw new Error('Fixture write made no progress');
        offset += bytesWritten;
      }
    } finally { await handle.close(); }
    const baseline = await run('baseline'), stream = await run('stream');
    if (baseline.digest !== stream.digest) throw new Error('Revision mismatch');
    process.stdout.write(`${JSON.stringify({ node: process.version, fixtureMiB: 32, sameRevision: true,
      notes: 'One fresh process per mode, sequential; OS maxRSS includes runtime; 5ms memory samples can miss peaks; warm filesystem cache/order affects timing.',
      results: [baseline, stream] }, null, 2)}\n`);
  } finally {
    const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe cleanup');
    await rm(target, { recursive: true, force: true });
  }
}
