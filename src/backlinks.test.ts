import { describe, expect, test } from 'vitest';
import { extractObsidianLinkOccurrences, extractWikiLinkOccurrences, findBacklinkMatches, findUnresolvedLinkMatches } from './backlinks.js';

describe('Obsidian link extraction', () => {
  test('bounded reading order preserves mixed link positions and ignores complete fences', () => {
    const content = '## Real\n~~~md\n## Example\n[[Ignore]]\n~~~\n[first](First.md#Start) [[Second#^claim]] [third](Third.md)';
    expect(extractObsidianLinkOccurrences(content, 2)).toEqual([
      expect.objectContaining({ target: 'First.md', line: 6, heading: 'Real', targetHeading: 'Start' }),
      expect.objectContaining({ target: 'Second', line: 6, heading: 'Real', targetBlockId: 'claim' }),
    ]);
  });
  test('keeps wikilinks backward compatible and adds internal Markdown links', () => {
    const content = [
      '## References\n\n[[Knowledge/Atomic]] and [the resource](Resources/Guide.md#setup) and [encoded](Resources/My%20Note.md).',
      '[external](https://example.com/Knowledge/Atomic) ![image](image.png)',
      '```md',
      '[ignored](Knowledge/Atomic.md)',
      '```',
    ].join('\n');

    expect(extractWikiLinkOccurrences(content).map(match => match.target)).toEqual(['Knowledge/Atomic']);
    expect(extractObsidianLinkOccurrences(content).map(match => match.target)).toEqual([
      'Knowledge/Atomic', 'Resources/Guide.md', 'Resources/My Note.md',
    ]);
    expect(findBacklinkMatches(content, 'Resources/Guide.md')).toEqual([
      expect.objectContaining({ line: 3, path: '', heading: 'References', context: expect.stringContaining('resource') }),
    ]);
  });

  test('reports unresolved internal Markdown links but ignores URLs and fenced examples', () => {
    const content = '[missing](Knowledge/Missing.md) [web](https://example.com)\n```\n[ignored](Knowledge/Missing.md)\n```';
    expect(findUnresolvedLinkMatches(content, ['Knowledge/Existing.md']).map(match => ({ target: match.target, line: match.line }))).toEqual([
      { target: 'Knowledge/Missing.md', line: 1 },
    ]);
  });

  test('preserves heading and block anchors for precise navigation', () => {
    const content = '[[Knowledge/Target#Design Notes]]\n[block](Knowledge/Target.md#^decision-1)';
    expect(extractObsidianLinkOccurrences(content)).toEqual([
      expect.objectContaining({ target: 'Knowledge/Target', targetHeading: 'Design Notes', line: 1 }),
      expect.objectContaining({ target: 'Knowledge/Target.md', targetBlockId: 'decision-1', line: 2 }),
    ]);
    expect(findBacklinkMatches(content, 'Knowledge/Target.md')).toEqual([
      expect.objectContaining({ targetHeading: 'Design Notes' }),
      expect.objectContaining({ targetBlockId: 'decision-1' }),
    ]);
  });

  test('ignores closed inline code while preserving adjacent real links and exact locators', () => {
    const content = '## References\n`[[Fake]]` [[Real#Section]] and `[bad](Missing.md)` [real](Real.md#^proof)';

    expect(extractObsidianLinkOccurrences(content)).toEqual([
      expect.objectContaining({ target: 'Real', line: 2, heading: 'References', targetHeading: 'Section' }),
      expect.objectContaining({ target: 'Real.md', line: 2, heading: 'References', targetBlockId: 'proof' }),
    ]);
  });

  test('handles multi-backtick and multiline code spans without hiding links after unmatched runs', () => {
    const closed = [
      '``code with ` and [[Hidden]]`` [[Visible]]',
      '`multiline',
      '[[AlsoHidden]]',
      'continues` [shown](Shown.md)',
    ].join('\n');
    expect(extractObsidianLinkOccurrences(closed).map(match => ({ target: match.target, line: match.line }))).toEqual([
      { target: 'Visible', line: 1 },
      { target: 'Shown.md', line: 4 },
    ]);

    expect(extractObsidianLinkOccurrences('`unclosed [[StillVisible]]\n[also](Still.md)').map(match => match.target)).toEqual([
      'StillVisible',
      'Still.md',
    ]);
  });

  test('ignores escaped link openers but keeps links after an even backslash run', () => {
    const content = String.raw`\[[EscapedWiki]] \[escaped](Missing.md) \\[[VisibleWiki]] [visible](Visible.md)`;
    expect(extractObsidianLinkOccurrences(content).map(match => match.target)).toEqual([
      'VisibleWiki',
      'Visible.md',
    ]);
  });

  test('keeps literal examples out of backlink and unresolved projections', () => {
    const content = '`[[Target]]` [[Target]] \n\\[[EscapedMissing]] [missing](Missing.md)';
    expect(findBacklinkMatches(content, 'Target.md')).toHaveLength(1);
    expect(findUnresolvedLinkMatches(content, ['Target.md']).map(match => match.target)).toEqual(['Missing.md']);
  });

  test('treats backslashes inside an open code span as literal text', () => {
    const single = '`[[SingleHidden]] \\` [[SingleVisible]]';
    const multiple = '``[[MultiHidden]] \\`` [[MultiVisible]]';

    expect(extractObsidianLinkOccurrences(single).map(match => match.target)).toEqual(['SingleVisible']);
    expect(extractObsidianLinkOccurrences(multiple).map(match => match.target)).toEqual(['MultiVisible']);
  });

  test.each([
    ['ATX heading', '`unclosed\n# Real Heading\n[[HeadingTarget]]\nclosing`', 'HeadingTarget'],
    ['block quote', '`unclosed\n> [[QuoteTarget]]\nclosing`', 'QuoteTarget'],
    ['bullet list', '`unclosed\n- [[ListTarget]]\nclosing`', 'ListTarget'],
    ['ordered list', '`unclosed\n1. [[OrderedTarget]]\nclosing`', 'OrderedTarget'],
    ['thematic break', '`unclosed\n---\n[[BreakTarget]]\nclosing`', 'BreakTarget'],
    ['Setext heading', '`unclosed\nHeading\n===\n[[SetextTarget]]\nclosing`', 'SetextTarget'],
    ['HTML block', '`unclosed\n<div></div>\n[[HtmlTarget]]\nclosing`', 'HtmlTarget'],
  ])('does not pair unmatched code delimiters across an interrupting %s', (_kind, content, target) => {
    expect(extractObsidianLinkOccurrences(content).map(match => match.target)).toContain(target);
  });

  test('preserves original inline markup in source heading locators', () => {
    const content = '## API `v1`\n[[Versioned]]\n## `Only code`\n[[CodeHeading]]';
    expect(extractObsidianLinkOccurrences(content)).toEqual([
      expect.objectContaining({ target: 'Versioned', heading: 'API `v1`' }),
      expect.objectContaining({ target: 'CodeHeading', heading: '`Only code`' }),
    ]);
  });

  test('preserves CRLF offsets and ignores mismatched fence-looking lines', () => {
    const content = '## Windows\r\n~~~~md\r\n[[Hidden]]\r\n~~~\r\n[[StillHidden]]\r\n```\r\n[[AlsoHidden]]\r\n~~~~\r\n`[[InlineHidden]]` [[Visible#Part]]';
    expect(extractObsidianLinkOccurrences(content)).toEqual([
      expect.objectContaining({ target: 'Visible', line: 9, heading: 'Windows', targetHeading: 'Part' }),
    ]);
  });
});
