import { expect, test } from 'vitest';
import { collectPlainFrontmatterReferences, isNavigationalFrontmatterReference, isReferenceSnapshotPath } from './property-references.js';

test('conditional synthesis inputs retain snapshot integrity without inventing support edges', () => {
  const refs = collectPlainFrontmatterReferences({ knowledge_synthesis: { inputs: [{ id: 'a', path: 'A.md', revision: 'a'.repeat(64) }] } });
  expect(refs).toEqual([expect.objectContaining({ propertyPath: 'knowledge_synthesis.inputs[0].path', value: 'A.md' })]);
  expect(isNavigationalFrontmatterReference(refs[0]!)).toBe(false);
  expect(isReferenceSnapshotPath(['knowledge_synthesis', 'explanations', 0, 'path'])).toBe(false);
});

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
  expect(isReferenceSnapshotPath(['learning_progress', 'root_path'])).toBe(true);
  expect(isReferenceSnapshotPath(['learning_progress', 'completed_through'])).toBe(true);
  expect(isReferenceSnapshotPath(['learning_progress', 'entries', 0, 'path'])).toBe(true);
  expect(isReferenceSnapshotPath(['learning_progress', 'extra', 'root_path'])).toBe(false);
  expect(isReferenceSnapshotPath(['learning_progress', 'entries', 'path'])).toBe(false);
  expect(isReferenceSnapshotPath(['learning_progress', 'entries', 0, 'revision'])).toBe(false);
  expect(isReferenceSnapshotPath(['learning_progress', 'structure_fingerprint'])).toBe(false);
});

test('recognizes knowledge application locators as non-navigational snapshots', () => {
  const frontmatter = {
    knowledge_applications: [{
      knowledge: { path: 'Knowledge/Result.md', revision: 'a'.repeat(64) },
      verification: { path: 'Knowledge/Check.md', revision: 'b'.repeat(64) },
    }],
  };

  expect(isReferenceSnapshotPath(['knowledge_applications', 0, 'knowledge', 'path'])).toBe(true);
  expect(isReferenceSnapshotPath(['knowledge_applications', 0, 'verification', 'path'])).toBe(true);
  const references = collectPlainFrontmatterReferences(frontmatter);
  expect(references).toEqual([
    expect.objectContaining({ propertyPath: 'knowledge_applications[0].knowledge.path', value: 'Knowledge/Result.md' }),
    expect.objectContaining({ propertyPath: 'knowledge_applications[0].verification.path', value: 'Knowledge/Check.md' }),
  ]);
  expect(references.every(reference => !isNavigationalFrontmatterReference(reference))).toBe(true);
});

test('does not treat unknown knowledge application nested paths as references', () => {
  expect(isReferenceSnapshotPath(['knowledge_applications', 0, 'knowledge', 'revision'])).toBe(false);
  expect(isReferenceSnapshotPath(['knowledge_applications', 0, 'environment'])).toBe(false);
  expect(isReferenceSnapshotPath(['knowledge_applications', 'knowledge', 'path'])).toBe(false);
});

test('source derivation snapshots protect path integrity without adding support or navigation edges', () => {
  const references = collectPlainFrontmatterReferences({ source_derivations: [{ path: '_sources/origin.md', revision: 'a'.repeat(64), relation: 'quotation' }] });
  expect(references).toEqual([expect.objectContaining({ propertyPath: 'source_derivations[0].path', value: '_sources/origin.md' })]);
  expect(isNavigationalFrontmatterReference(references[0]!)).toBe(false);
  expect(isReferenceSnapshotPath(['source_derivations', 0, 'revision'])).toBe(false);
});
