import { describe, expect, test } from 'vitest';
import { compareSourceBodies } from './source-delta.js';

describe('compareSourceBodies', () => {
  test('reports added, deleted, and changed body lines with line locations', () => {
    expect(compareSourceBodies('a\n', 'a\nb\n')).toEqual({
      changed: true,
      granularity: 'line_hunks',
      truncated: false,
      hunks: [{
        old: { startLine: 2, endLine: 1, text: '', truncated: false },
        new: { startLine: 2, endLine: 2, text: 'b', truncated: false },
      }],
    });
    expect(compareSourceBodies('a\nb\n', 'a\n')).toEqual({
      changed: true,
      granularity: 'line_hunks',
      truncated: false,
      hunks: [{
        old: { startLine: 2, endLine: 2, text: 'b', truncated: false },
        new: { startLine: 2, endLine: 1, text: '', truncated: false },
      }],
    });
    expect(compareSourceBodies('a\nb\n', 'a\nc\n')).toEqual({
      changed: true,
      granularity: 'line_hunks',
      truncated: false,
      hunks: [{
        old: { startLine: 2, endLine: 2, text: 'b', truncated: false },
        new: { startLine: 2, endLine: 2, text: 'c', truncated: false },
      }],
    });
  });

  test('omits unchanged lines and keeps separate changes as separate hunks', () => {
    const result = compareSourceBodies('zero\none\ntwo\nthree\nfour\nfive\n', 'zero\nONE\ntwo\nthree\nFOUR\nfive\n');
    expect(result).toMatchObject({ changed: true, granularity: 'line_hunks', truncated: false });
    expect(result.hunks).toEqual([
      { old: { startLine: 2, endLine: 2, text: 'one', truncated: false }, new: { startLine: 2, endLine: 2, text: 'ONE', truncated: false } },
      { old: { startLine: 5, endLine: 5, text: 'four', truncated: false }, new: { startLine: 5, endLine: 5, text: 'FOUR', truncated: false } },
    ]);
  });

  test('detects identical bodies and normalizes CRLF for comparison', () => {
    expect(compareSourceBodies('a\nb\n', 'a\nb\n')).toEqual({ changed: false, granularity: 'line_hunks', truncated: false, hunks: [] });
    expect(compareSourceBodies('a\r\nb\r\n', 'a\nb\n')).toEqual({ changed: false, granularity: 'line_hunks', truncated: false, hunks: [] });
  });

  test('bounds returned text by maxChars while preserving span locations', () => {
    const result = compareSourceBodies('o'.repeat(120), 'n'.repeat(120), { maxChars: 200 });
    expect(result.changed).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.hunks[0]).toEqual({
      old: { startLine: 1, endLine: 1, text: 'o'.repeat(120), truncated: false },
      new: { startLine: 1, endLine: 1, text: 'n'.repeat(80), truncated: true },
    });
  });

  test('limits hunks and marks omitted changes as truncated', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n');
    const after = ['A', 'b', 'C', 'd', 'E', 'f'].join('\n');
    const result = compareSourceBodies(before, after, { maxHunks: 2 });
    expect(result.hunks).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  test('uses a bounded enclosing range for huge line-oriented input', () => {
    const before = 'same\n' + 'x'.repeat(200_000) + '\nend';
    const after = 'same\n' + 'y'.repeat(200_000) + '\nend';
    const result = compareSourceBodies(before, after, { maxChars: 200 });
    expect(result.granularity).toBe('enclosing_range');
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].old.startLine).toBe(2);
    expect(result.hunks[0].old.endLine).toBe(2);
    expect(result.hunks[0].old.text).toBe('x'.repeat(200));
    expect(result.truncated).toBe(true);
  });

  test('keeps a changed single-line large-input range non-empty', () => {
    const result = compareSourceBodies('before', 'after'.repeat(20_000));
    expect(result.granularity).toBe('enclosing_range');
    expect(result.hunks[0].old).toMatchObject({ startLine: 1, endLine: 1 });
    expect(result.hunks[0].new).toMatchObject({ startLine: 1, endLine: 1 });
  });
  test('million-line fallback retains bounded literal output and exact changed location', () => {
    const before = '\n'.repeat(500_000) + 'old\n' + '\n'.repeat(500_000);
    const after = '\n'.repeat(500_000) + 'new\n' + '\n'.repeat(500_000);
    const r = compareSourceBodies(before, after, { maxChars: 200 });
    expect(r.granularity).toBe('enclosing_range');
    expect(r.hunks[0]?.old).toMatchObject({ startLine: 500001, endLine: 500001, text: 'old', truncated: false });
    expect(r.hunks[0]?.new.text).toBe('new');
    expect(JSON.stringify(r).length).toBeLessThan(600);
  });
});
