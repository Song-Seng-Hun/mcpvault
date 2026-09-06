// Opt-in synthetic parser comparison. Build first; run each mode separately:
// node --expose-gc scripts/benchmark-frontmatter-memory.mjs baseline
// node --expose-gc scripts/benchmark-frontmatter-memory.mjs projection
// The legacy oracle receives only this fixed YAML fixture, never external input.
import matter from 'gray-matter';
import { parse as parseYaml } from 'yaml';
import { FrontmatterHandler } from '../dist/src/frontmatter.js';

const mode = process.argv[2];
if (!['baseline', 'projection'].includes(mode) || process.argv.length !== 3 || !global.gc) {
  throw new Error('Use node --expose-gc with exactly baseline or projection');
}
const header = '---\ntitle: Safe\n---\n', body = 'x'.repeat(32 * 1024 * 1024), raw = header + body;
const inputBytes = Buffer.byteLength(raw, 'utf8');
const baseline = text => {
  const p = matter(text, { engines: { yaml: { parse: parseYaml } } });
  return { frontmatter: p.data, content: p.content, originalContent: text, matter: p.matter };
};
global.gc();
const before = process.memoryUsage(), start = performance.now();
const result = mode === 'baseline' ? baseline(raw) : new FrontmatterHandler().parse(raw);
const elapsedMs = +(performance.now() - start).toFixed(2), after = process.memoryUsage();
if (result.frontmatter.title !== 'Safe' || result.content !== body || result.originalContent !== raw || result.matter !== '\ntitle: Safe') {
  throw new Error('Unexpected parser projection');
}
process.stdout.write(JSON.stringify({ mode, node: process.version, inputBytes, fieldsMatchFixture: true, elapsedMs,
  maxRssMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(2),
  heapBeforeMiB: +(before.heapUsed / 1048576).toFixed(2), heapAfterMiB: +(after.heapUsed / 1048576).toFixed(2),
  arrayBuffersBeforeMiB: +(before.arrayBuffers / 1048576).toFixed(2), arrayBuffersAfterMiB: +(after.arrayBuffers / 1048576).toFixed(2),
  scope: 'One synthetic parser invocation; maxRSS includes startup and fixture construction; not whole-server or steady-state performance.' }, null, 2) + '\n');
