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
});
