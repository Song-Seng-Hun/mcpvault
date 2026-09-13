import { expect, test } from 'vitest';
import { claimId, parseClaimReference, blockAnchorLineIndex, GRAPH_VALIDATION_PROFILES } from './graph-validation.js';

test('shared claim normalization preserves existing fallback, casing and truncation', () => {
  expect(claimId(' Foo Bar! ', 3)).toBe('foo-bar');
  expect(claimId('한글', 3)).toBe('claim-4');
  expect(claimId(undefined, 0)).toBe('claim-1');
  expect(claimId('a'.repeat(100), 0)).toHaveLength(80);
});
test('shared claim reference retains author spelling but normalizes block identity', () => {
  expect(parseClaimReference('[[../B#^Foo|label]]')).toEqual({ raw: '[[../B#^Foo|label]]', document: '../B', blockId: 'foo' });
  expect(parseClaimReference('[[#^SELF]]').document).toBe('');
  expect(() => parseClaimReference('B.md')).toThrow('claim relation targets must use an Obsidian block link');
  expect(() => parseClaimReference('[[_scopes/user/secret#^x]]')).toThrow('not a heading or scope URI');
});
test('anchor index preserves repeated identities and ignores matching fences', () => {
  const index = blockAnchorLineIndex('가 😀 ^x\n~~~md\nfalse ^x\n~~~\nagain ^X');
  expect(index.get('x')).toEqual([1, 5]);
});
test('validation profiles describe existing local checks, not global integrity or new write constraints', () => {
  expect(GRAPH_VALIDATION_PROFILES.map(p => p.id)).toEqual(['identity', 'typed_target', 'claim', 'evidence', 'cycles']);
  expect(GRAPH_VALIDATION_PROFILES.every(p => p.authority === 'existing_lint_preview')).toBe(true);
});
