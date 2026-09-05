import { expect, test } from 'vitest';
import { isReferenceSnapshotPath } from './property-references.js';

test('snapshot paths match only the producer-defined array shapes', () => {
  for (const root of ['review_basis_links', 'pending_edits', 'research_trail']) {
    expect(isReferenceSnapshotPath([root, 0, 'path'])).toBe(true);
    expect(isReferenceSnapshotPath([root, 'extra', 0, 'path'])).toBe(false);
    expect(isReferenceSnapshotPath([root, 'path'])).toBe(false);
    expect(isReferenceSnapshotPath([root, 0, 'target'])).toBe(false);
  }
  expect(isReferenceSnapshotPath(['review_basis_upstream', 'entries', 0, 'path'])).toBe(true);
  expect(isReferenceSnapshotPath(['review_basis_upstream', 0, 'path'])).toBe(false);
  expect(isReferenceSnapshotPath(['review_basis_upstream', 'other', 0, 'path'])).toBe(false);
  expect(isReferenceSnapshotPath(['evidence', 0, 'path'])).toBe(false);
});
