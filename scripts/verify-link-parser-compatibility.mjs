// Read-only differential check against the trusted pre-allocation-change parser.
// Requires this repository's history and a current `npm run build`; no Vault IO.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as current from '../dist/src/backlinks.js';

const baseline = '84de8c78aba7fc6663f51192815b5c063ce06746';
const cwd = fileURLToPath(new URL('../', import.meta.url));
const source = execFileSync('git', ['show', `${baseline}:dist/src/backlinks.js`], {
  cwd, encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true,
});
if (/^import\s/m.test(source)) throw new Error('Baseline must remain a standalone trusted parser');
const previous = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const fragments = [
  '', 'plain 가🙂\ud800 text', '[[Target]]', '[[A#^proof|alias]]', '![[A]]',
  '[A](A.md)', '[encoded](<A%23B.md#Heading>)', '[external](https://example.com)',
  '[[#anchor]] [anchor](#only)', '\\[[escaped]]', '`[[literal]]`', '``[literal](Hidden.md)``',
  '`unclosed [[Target]]', '`open\n[[literal]]\nclose`', '## Heading `code`',
  '~~~md\n[[literal]]\n~~~', '````\n[[literal]]\n```\n[[still literal]]\n````',
  '~~~\n[[unclosed]]', '> [[Target]]', '- [[A]]', 'paragraph\n---\n[[Target]]',
  '<!-- comment\n[[A]]', '[local](../A.md?query#part)', '[[A]] [B](B.md) [[Target]]',
];
const limits = [0, -1, NaN, 0.5, 1, 2, 3, 10, Infinity];
let cases = 0, comparisons = 0;
const equal = (actual, expected, kind) => {
  comparisons++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Parser mismatch: case ${cases}, ${kind}`);
};
for (const first of fragments) for (const second of fragments) for (const newline of ['\n', '\r\n']) {
  const content = `# Root\n${first}\n${second}\n[[After]]\n`.replace(/\n/g, newline);
  cases++;
  for (const limit of limits) equal(current.extractObsidianLinkOccurrences(content, limit), previous.extractObsidianLinkOccurrences(content, limit), `limit=${limit}`);
  equal(current.extractWikiLinkOccurrences(content), previous.extractWikiLinkOccurrences(content), 'wiki-only');
  equal(current.findBacklinkMatches(content, 'Target.md'), previous.findBacklinkMatches(content, 'Target.md'), 'backlinks');
  equal(current.findUnresolvedLinkMatches(content, ['Target.md', 'A.md']), previous.findUnresolvedLinkMatches(content, ['Target.md', 'A.md']), 'unresolved');
}
console.log(JSON.stringify({ baseline, cases, comparisons, matched: true }));
