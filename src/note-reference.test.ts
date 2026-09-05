import { describe, expect, test } from 'vitest';
import { buildNoteReferenceIndex, resolveNoteReference } from './note-reference.js';

describe('note reference resolver', () => {
  test('an explicit missing relative target never falls back to another folder', () => {
    const index = buildNoteReferenceIndex([{ path: 'Other/Target.md' }]);
    expect(resolveNoteReference('./Target', index, { sourcePath: 'Wiki/Source.md' })).toEqual([]);
    expect(resolveNoteReference('../Target', index, { sourcePath: 'Wiki/Nested/Source.md' })).toEqual([]);
    expect(resolveNoteReference('Target', index, { sourcePath: 'Wiki/Source.md' })).toEqual(['Other/Target.md']);
  });
  test('resolves paths, aliases, stable IDs, preferred terms, dotted aliases, and relative links', () => {
    const index = buildNoteReferenceIndex([
      { path: 'Knowledge/Canonical.md', qualifiedPaths: ['scope://model/codex/Canonical.md'], title: 'Canonical title', aliases: ['Friendly name', 'Node.js'], preferredTerm: 'Preferred concept', stableId: 'canonical-id' },
      { path: 'Knowledge/Nested/Relative.md' },
    ]);
    for (const reference of ['Canonical title', 'Friendly name', 'Node.js', 'Preferred concept', 'canonical-id', 'Knowledge/Canonical']) {
      expect(resolveNoteReference(reference, index)).toEqual(['Knowledge/Canonical.md']);
    }
    expect(resolveNoteReference('scope://model/codex/Canonical', index)).toEqual(['Knowledge/Canonical.md']);
    expect(resolveNoteReference('./Relative', index, { sourcePath: 'Knowledge/Nested/Source.md' })).toEqual(['Knowledge/Nested/Relative.md']);
    expect(resolveNoteReference('Relative.md', index, { sourcePath: 'Knowledge/Nested/Source.md', preferRelative: true })).toEqual(['Knowledge/Nested/Relative.md']);
  });

  test('preserves ambiguity and never widens an edge predicate', () => {
    const index = buildNoteReferenceIndex([
      { path: 'Public/One.md', aliases: ['Shared'] },
      { path: 'Private/Two.md', aliases: ['Shared'] },
    ]);
    expect(resolveNoteReference('Shared', index)).toEqual(['Private/Two.md', 'Public/One.md']);
    expect(resolveNoteReference('Shared', index, { sourcePath: 'Public/Source.md', canReference: (_source, target) => target.startsWith('Public/') })).toEqual(['Public/One.md']);
  });
});
