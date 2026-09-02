import { describe, expect, test } from 'vitest';
import { extractObsidianLinkOccurrences, extractWikiLinkOccurrences, findBacklinkMatches, findUnresolvedLinkMatches } from './backlinks.js';

describe('Obsidian link extraction', () => {
  test('keeps wikilinks backward compatible and adds internal Markdown links', () => {
    const content = [
      '[[Knowledge/Atomic]] and [the resource](Resources/Guide.md#setup) and [encoded](Resources/My%20Note.md).',
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
      expect.objectContaining({ line: 1, path: '', context: expect.stringContaining('resource') }),
    ]);
  });

  test('reports unresolved internal Markdown links but ignores URLs and fenced examples', () => {
    const content = '[missing](Knowledge/Missing.md) [web](https://example.com)\n```\n[ignored](Knowledge/Missing.md)\n```';
    expect(findUnresolvedLinkMatches(content, ['Knowledge/Existing.md']).map(match => ({ target: match.target, line: match.line }))).toEqual([
      { target: 'Knowledge/Missing.md', line: 1 },
    ]);
  });
});
