import { describe, expect, test } from 'vitest';
import { queryAllNotes } from './paged-query.js';

describe('queryAllNotes', () => {
  test('continues past the legacy 500-row page without loading bodies by default', async () => {
    const calls: Array<{ offset?: number; includeContent?: boolean }> = [];
    const all = Array.from({ length: 1_201 }, (_, index) => ({ path: `note-${index}.md`, frontmatter: { id: index } }));
    const fileSystem = {
      queryNotes: async (params: { offset?: number; limit?: number; includeContent?: boolean }) => {
        calls.push({ offset: params.offset, includeContent: params.includeContent });
        const offset = params.offset || 0;
        const limit = params.limit || 100;
        const notes = all.slice(offset, offset + limit);
        return { notes, total: all.length, truncated: offset + limit < all.length };
      },
    } as any;

    const result = await queryAllNotes(fileSystem);

    expect(result.notes).toHaveLength(1_201);
    expect(result.truncated).toBe(false);
    expect(calls.map(call => call.offset)).toEqual([0, 500, 1_000]);
    expect(calls.every(call => call.includeContent === false)).toBe(true);
  });
});
