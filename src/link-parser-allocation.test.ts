import { afterEach, expect, test, vi } from 'vitest';
import { extractObsidianLinkOccurrences } from './backlinks.js';

afterEach(() => vi.restoreAllMocks());

test.each([false, true])('long line masking avoids character arrays (masked=%s)', masked => {
  const body = '가🙂'.repeat(32_768), content = masked ? `\`${body}\` [[Visible]]` : `${body} [[Visible]]`;
  const split = vi.spyOn(String.prototype, 'split');
  let result: ReturnType<typeof extractObsidianLinkOccurrences>, copies: number;
  try {
    result = extractObsidianLinkOccurrences(content, 1);
    copies = split.mock.calls.filter(([separator]) => separator === '').length;
  } finally { split.mockRestore(); }
  expect(result.map(item => item.target)).toEqual(['Visible']); expect(copies).toBe(0);
});

test('small prefix extraction does not split the whole source into lines', () => {
  const content = '[[First]]\r\n' + 'ordinary line\r\n'.repeat(10_000);
  const split = vi.spyOn(String.prototype, 'split');
  let result: ReturnType<typeof extractObsidianLinkOccurrences>, copies: number;
  try {
    result = extractObsidianLinkOccurrences(content, 1);
    copies = split.mock.calls.filter(([separator], index) => separator === '\n' && String(split.mock.contexts[index]) === content).length;
  } finally { split.mockRestore(); }
  expect(result[0]).toMatchObject({ target: 'First', line: 1 }); expect(copies).toBe(0);
});

test('finite extraction retains only the needed prefix of each link syntax', () => {
  const content = Array.from({ length: 300 }, (_, i) => `[m${i}](M${i}.md) [[W${i}]]`).join(' ');
  const original = Array.prototype.sort; let largestCandidateArray = 0;
  const sort = vi.spyOn(Array.prototype, 'sort').mockImplementation(function (this: any[], compare?: any) {
    if (this[0]?.item?.target && typeof this[0]?.offset === 'number') largestCandidateArray = Math.max(largestCandidateArray, this.length);
    return original.call(this, compare);
  });
  let result: ReturnType<typeof extractObsidianLinkOccurrences>;
  try { result = extractObsidianLinkOccurrences(content, 2); } finally { sort.mockRestore(); }
  expect(result.map(item => item.target)).toEqual(['M0.md', 'W0']);
  expect(largestCandidateArray).toBeLessThanOrEqual(4);
});

test.each([
  '[bad](https://example.com) [[#anchor]] [first](First.md) [[Second]] [third](Third.md)',
  '[[First]] [anchor](#only) [second](Second.md) [[Third]]',
  '## Heading\r\n`[[literal]]` [first](First.md#Part)\r\n[[Second#^block|alias]]\r\n',
  '~~~~md\n[[literal]]\n~~~\n[[also literal]]\n~~~~\n[[First]] [second](Second.md)',
  '`multiline [[literal]]\r\n[also literal](Hidden.md)` [[First]]\n[second](Second.md)',
  '\\[[escaped]] [[First]] ![image](Image.png) [second](Second.md)',
  '🙂가\ud800 `🙂\ud800 [[literal]]` [[First]] ``hidden`` [second](Second.md)\udfff',
  '[[First]]\n## Next\n[second](Second.md)\n[[Third]]',
])('bounded mixed extraction matches the complete authored prefix: %s', content => {
  const full = extractObsidianLinkOccurrences(content);
  for (const limit of [0.5, 1, 2, 3, 10, Infinity]) {
    expect(extractObsidianLinkOccurrences(content, limit)).toEqual(full.slice(0, Math.ceil(limit)));
  }
  expect(['First', 'First.md']).toContain(full[0]!.target);
});

test.each([0, -1, NaN])('nonpositive or unordered limit %s retains empty-result behavior', limit => {
  expect(extractObsidianLinkOccurrences('[[Ignored]]', limit)).toEqual([]);
});

test('empty/trailing lines and repeated calls preserve line locators and regex state', () => {
  for (let repeat = 0; repeat < 3; repeat++) {
    expect(extractObsidianLinkOccurrences('')).toEqual([]);
    expect(extractObsidianLinkOccurrences('\r\n\r\n[[A]]\r\n', 1)).toEqual([
      { line: 3, link: '[[A]]', target: 'A', context: '[[A]]' },
    ]);
    expect(extractObsidianLinkOccurrences('[[X]] [[Y]] [z](Z.md)', 1).map(row => row.target)).toEqual(['X']);
    expect(extractObsidianLinkOccurrences('[a](A.md) [[B]]').map(row => row.target)).toEqual(['A.md', 'B']);
  }
});
