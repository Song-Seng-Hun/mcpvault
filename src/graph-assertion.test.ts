import { expect, test } from 'vitest';
import { extractGraphAssertions, projectAssertionPairs } from './graph-assertion.js';

const basis = { repositoryId: 'repo-fixture', path: 'A.md', revision: 'a'.repeat(64) };
const extract = (frontmatter: Record<string, unknown>, content = '') => extractGraphAssertions({ ...basis, frontmatter, content });

test('preserves different relations and repeated authored property occurrences', () => {
  const { assertions } = extract({ supports: ['B.md', 'B.md'], contradicts: ['B.md'] });
  expect(assertions.map(a => [a.relation, a.locator])).toEqual([
    ['supports', { basis: 'properties', propertyPath: 'supports[0]' }],
    ['supports', { basis: 'properties', propertyPath: 'supports[1]' }],
    ['contradicts', { basis: 'properties', propertyPath: 'contradicts[0]' }],
  ]);
  expect(new Set(assertions.map(a => a.id)).size).toBe(3);
  expect(assertions.every(a => a.direction === 'source_to_target' && a.kind === 'authored')).toBe(true);
  expect(projectAssertionPairs(assertions)).toHaveLength(1);
  expect(assertions).toHaveLength(3);
});

test('path identity is independent of revision and never uses unchecked stable_id', () => {
  const first = extract({ supports: ['B.md'], stable_id: 'collision' }).assertions[0]!;
  const second = extractGraphAssertions({ ...basis, path: 'C.md', frontmatter: { supports: ['B.md'], stable_id: 'collision' }, content: '' }).assertions[0]!;
  const updated = extractGraphAssertions({ ...basis, revision: 'b'.repeat(64), frontmatter: { supports: ['B.md'] }, content: '' }).assertions[0]!;
  expect(second.source.documentId).not.toBe(first.source.documentId);
  expect(updated.source.documentId).toBe(first.source.documentId);
  expect(updated.source.versionId).not.toBe(first.source.versionId);
  expect(updated.id).not.toBe(first.id);
  expect(first.source.identityBasis).toBe('repository_path_not_rename_stable');
});

test('body locators are explicitly body-relative and distinguish repeated same-line links', () => {
  const result = extract({}, '# Links\r\n[[B]] [[B]]\r\n~~~md\r\n[[private]]\r\n~~~\r\n`[[example]]`');
  expect(result.assertions.map(a => a.locator)).toEqual([
    { basis: 'markdown_body', line: 2, occurrence: 0 },
    { basis: 'markdown_body', line: 2, occurrence: 1 },
  ]);
  expect(result.assertions.map(a => a.kind)).toEqual(['extracted', 'extracted']);
});

test('claim identity and exact property position are separate from document identity', () => {
  const result = extract({ claims: [{ id: 'c1', supports_claims: ['[[B#^c2]]'], contradicts_claims: ['[[#^c1]]'] }] }, 'Claim ^c1');
  expect(result.assertions.map(a => [a.source.claimId, a.relation, a.targetReference, a.locator])).toEqual([
    ['c1', 'supports', '[[B#^c2]]', { basis: 'properties', propertyPath: 'claims[0].supports_claims[0]' }],
    ['c1', 'contradicts', '[[#^c1]]', { basis: 'properties', propertyPath: 'claims[0].contradicts_claims[0]' }],
  ]);
});

test('source and claim evidence paths retain occurrences without counting them as independent evidence', () => {
  const result = extract({ evidence_paths: ['Source.md'], claims: [{ id: 'x', evidence_paths: ['Source.md'] }] });
  expect(result.assertions.map(a => a.relation)).toEqual(['evidence', 'evidence']);
  expect(result.assertions.every(a => a.evidenceState === 'not_verified')).toBe(true);
});

test('bounded extraction stops property and body occurrence admission', () => {
  const result = extractGraphAssertions({ ...basis, frontmatter: { supports: Array(100).fill('B.md') }, content: '[[C]]', limit: 3 });
  expect(result.assertions).toHaveLength(3); expect(result.partial).toBe(true);
});

test.each([{ path: '../A.md' }, { revision: 'bad' }, { limit: 0 }, { repositoryId: '' }])('rejects invalid basis %j', change => {
  expect(() => extractGraphAssertions({ ...basis, frontmatter: {}, content: '', ...change })).toThrow();
});
