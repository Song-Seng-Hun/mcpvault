import { describe, expect, test } from 'vitest';
import { queryAllNotes } from './paged-query.js';

describe('queryAllNotes', () => {
  test('continues past the legacy 500-row page without loading bodies by default', async () => {
    const calls: Array<{ after?: number; includeContent?: boolean }> = [];
    const all = Array.from({ length: 1_201 }, (_, index) => ({ path: `note-${index}.md`, frontmatter: { id: index } }));
    const fileSystem = {
      queryNotes: async (params: { after?: { value?: string | number | boolean | null }; limit?: number; includeContent?: boolean }) => {
        const offset = typeof params.after?.value === 'number' ? params.after.value + 1 : 0;
        calls.push({ after: params.after?.value as number | undefined, includeContent: params.includeContent });
        const limit = params.limit || 100;
        const notes = all.slice(offset, offset + limit);
        const truncated = offset + notes.length < all.length;
        return {
          notes,
          total: all.length,
          truncated,
          nextCursor: truncated ? { path: notes.at(-1)!.path, value: offset + notes.length - 1 } : undefined,
        };
      },
    } as any;

    const result = await queryAllNotes(fileSystem);

    expect(result.notes).toHaveLength(1_201);
    expect(result.truncated).toBe(false);
    expect(calls.map(call => call.after)).toEqual([undefined, 499, 999]);
    expect(calls.every(call => call.includeContent === false)).toBe(true);
  });
});
