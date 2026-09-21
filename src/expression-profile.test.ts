import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { EXPRESSION_CHAPTERS, EXPRESSION_REVISION, expressionChapter, expressionPolicy, expressionReference } from './expression-profile.js';

describe('bounded, non-authoritative expression profile', () => {
  test('chapter files match runtime text and include navigation within50 physical lines', async () => {
    for (const id of EXPRESSION_CHAPTERS) {
      const text = expressionChapter(id);
      expect(text.split(/\r?\n/).length).toBeLessThanOrEqual(50);
      expect(text).toContain('parent: SKILL.md');
      expect(text).toContain('previous:'); expect(text).toContain('next:');
      expect(await readFile(`docs/skills/vault-dense-english/${id}.md`, 'utf8')).toBe(text);
    }
  });
  test('index exposes cards only; full selected chapter never loses safety to fit a budget', () => {
    const index = expressionPolicy({ maxChars: 4000 });
    expect(index.items).toHaveLength(3); expect(index.body).toBeUndefined();
    for (const chapter of EXPRESSION_CHAPTERS) for (const prettyPrint of [true, false]) {
      const small = expressionPolicy({ chapter, maxChars: 512, prettyPrint });
      expect(JSON.stringify(small, null, prettyPrint ? 2 : undefined).length).toBeLessThanOrEqual(512);
      expect(small.partial).toBe(true); expect(small.body).toBeUndefined();
      const full = expressionPolicy({ chapter, maxChars: 4000, expectedProfileRevision: EXPRESSION_REVISION, prettyPrint });
      expect(full.body).toBe(expressionChapter(chapter)); expect(full.partial).toBe(false);
      expect(full.executionAuthority).toBe(false);
      expect(full.navigation.parent.arguments).toMatchObject({ topic: 'expression' });
      expect(expressionPolicy(full.navigation.next.arguments).partial).toBe(false);
    }
  });
  test('unknown/stale selectors fail closed; returned data cannot modify the compiled profile', () => {
    expect(() => expressionPolicy({ chapter: '../private' })).toThrow('Expression profile unavailable');
    expect(() => expressionPolicy({ chapter: 'language', expectedProfileRevision: '0'.repeat(64) })).toThrow('Expression profile unavailable');
    const result = expressionPolicy({ maxChars: 4000 }); result.items[0].description = 'changed';
    expect(expressionPolicy({ maxChars: 4000 }).items[0].description).not.toBe('changed');
    expect(expressionReference()).toMatchObject({ profileId: 'vault-dense-english', executionAuthority: false });
  });
  test('pinned upstream originals retain exact bytes; engine and compression executables are absent', async () => {
    const manifest = JSON.parse(await readFile('docs/skills/caveman-source/manifest.json', 'utf8'));
    expect(manifest.commit).toBe('15581d14007fd01fb3f132016741962f34936ca2');
    expect(manifest.files.map((f: any) => f.path)).toEqual(['SKILL.md', 'LICENSING.md', 'LICENSE']);
    for (const file of manifest.files) expect(createHash('sha256').update(await readFile(`docs/skills/caveman-source/${file.path}`)).digest('hex')).toBe(file.sha256);
    expect(manifest.execution).toBe('forbidden');
  });
});
