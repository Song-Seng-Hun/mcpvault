// Build first. Run baseline and projection separately and sequentially:
// node --expose-gc scripts/benchmark-metadata-memory.mjs baseline
// node --expose-gc scripts/benchmark-metadata-memory.mjs projection
// Fixed safe synthetic fixture only; never reads a user's Vault.
import { mkdtemp, realpath, rm, open, readFile } from 'node:fs/promises';
import { join, relative, isAbsolute, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FrontmatterHandler } from '../dist/src/frontmatter.js';
import { readUtf8MetadataSource } from '../dist/src/streaming-metadata.js';

const mode = process.argv[2];
if (!['baseline', 'projection'].includes(mode) || process.argv.length !== 3 || !global.gc) {
  throw new Error('Use node --expose-gc with exactly baseline or projection');
}
const base = await realpath(tmpdir()), prefix = 'mcpvault-metadata-benchmark-', root = await mkdtemp(join(base, prefix));
try {
  const path = join(root, 'Note.md'), header = '---\ntitle: Safe\n---\n', block = 'x'.repeat(65536), expected = createHash('sha256').update(header);
  const writer = await open(path, 'w');
  try {
    await writer.writeFile(header);
    for (let i = 0; i < 512; i++) { await writer.writeFile(block); expected.update(block); }
  } finally { await writer.close(); }
  const expectedRevision = expected.digest('hex'), parser = new FrontmatterHandler();
  global.gc();
  const before = process.memoryUsage(), started = performance.now();
  const result = await (async () => {
    if (mode === 'baseline') {
      const raw = await readFile(path, 'utf8');
      return { frontmatter: parser.parse(raw).frontmatter, revision: createHash('sha256').update(raw, 'utf8').digest('hex') };
    }
    const source = await readUtf8MetadataSource(path);
    return { frontmatter: parser.parse(source.header).frontmatter, revision: source.revision };
  })();
  const elapsedMs = +(performance.now() - started).toFixed(2), after = process.memoryUsage();
  if (result.frontmatter.title !== 'Safe' || result.revision !== expectedRevision) throw new Error('Metadata/revision mismatch');
  process.stdout.write(JSON.stringify({ mode, node: process.version, bodyMiB: 32, fieldsMatchFixture: true, elapsedMs,
    maxRssMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(2),
    heapBeforeMiB: +(before.heapUsed / 1048576).toFixed(2), heapAfterMiB: +(after.heapUsed / 1048576).toFixed(2),
    arrayBuffersBeforeMiB: +(before.arrayBuffers / 1048576).toFixed(2), arrayBuffersAfterMiB: +(after.arrayBuffers / 1048576).toFixed(2),
    scope: 'One synthetic metadata invocation, not whole-server/steady-state performance. RSS includes startup/fixture writing; no reduction of disk bytes claimed.' }, null, 2) + '\n');
} finally {
  const target = await realpath(root), rel = relative(base, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe cleanup');
  await rm(target, { recursive: true, force: true });
}
