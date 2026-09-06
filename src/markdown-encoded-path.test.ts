import { expect, test } from 'vitest';
import { extractObsidianLinkOccurrences } from './backlinks.js';

test.each([
  ['../Note%231.md', '../Note#1.md', undefined, undefined],
  ['../Note%231.md#Heading', '../Note#1.md', 'Heading', undefined],
  ['../Note%231.md#%5Eproof', '../Note#1.md', undefined, 'proof'],
  ['../Note%3F1.md#Heading', '../Note?1.md', 'Heading', undefined],
  ['../Note%2523.md', '../Note%23.md', undefined, undefined],
])('Markdown path %s separates encoded filename characters from real anchors', (target, path, heading, block) => {
  const links = extractObsidianLinkOccurrences(`[Note](<${target}>)`);
  expect(links).toHaveLength(1);
  expect(links[0]?.target).toBe(path);
  expect(links[0]?.targetHeading).toBe(heading);
  expect(links[0]?.targetBlockId).toBe(block);
});
