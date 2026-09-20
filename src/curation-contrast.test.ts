import { expect, test } from 'vitest';
import { RELATION_FIELDS, RECIPROCAL_RELATIONS, RELATION_SEMANTICS, QUESTION_GRAPH_PROFILE } from './graph-contract.js';
import { collectPlainFrontmatterReferences, isNavigationalFrontmatterReference } from './property-references.js';
import { extractGraphAssertions } from './graph-assertion.js';

test('contrast is a mutual comparison, never contradiction or an identity expansion', () => {
  expect(RELATION_FIELDS).toContain('contrasts_with');
  expect(RECIPROCAL_RELATIONS).toContain('contrasts_with');
  expect(RELATION_SEMANTICS.find(r => r.field === 'contrasts_with')).toMatchObject({ direction: 'mutual', reciprocal: true });
  expect(QUESTION_GRAPH_PROFILE.priorityRelations).not.toContain('contrasts_with');
  expect(QUESTION_GRAPH_PROFILE.reverseRelations).not.toContain('contrasts_with');
});

test('plain contrast references participate in move/delete integrity and graph navigation', () => {
  const refs = collectPlainFrontmatterReferences({ contrasts_with: ['Knowledge/분산화.md'], close_match: ['Knowledge/Near.md'] });
  expect(refs.map(r => [r.propertyPath, r.value])).toEqual([
    ['contrasts_with[0]', 'Knowledge/분산화.md'], ['close_match[0]', 'Knowledge/Near.md'],
  ]);
  expect(refs.every(isNavigationalFrontmatterReference)).toBe(true);
});

test('contrast occurrences retain exact authored locators and do not become contradicts', () => {
  const result = extractGraphAssertions({ repositoryId: 'synthetic', path: 'Central.md', revision: 'a'.repeat(64),
    frontmatter: { contrasts_with: ['Distributed.md'], contradicts: ['False.md'] }, content: '' });
  expect(result.assertions.map(a => [a.relation, a.targetReference, a.locator])).toEqual([
    ['contradicts', 'False.md', { basis: 'properties', propertyPath: 'contradicts[0]' }],
    ['contrasts_with', 'Distributed.md', { basis: 'properties', propertyPath: 'contrasts_with[0]' }],
  ]);
});
