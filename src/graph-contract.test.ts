import { describe, expect, test } from 'vitest';
import { RELATION_FIELDS, RECIPROCAL_RELATIONS, RELATION_SEMANTICS, getOrganizationRelationContract } from './organization.js';

// Characterization of the pre-extraction public contract, not generated from it.
const fields = ['supports', 'contradicts', 'supersedes', 'derived_from', 'depends_on', 'implements', 'blocked_by', 'answers_questions', 'tests', 'related', 'same_as', 'close_match', 'version_of', 'refines'];
const targets = [
  'A claim, decision, or note supported by this note.',
  'A claim or conclusion challenged by this note.',
  'An older or replaced note.',
  'The source or note from which this note was derived.',
  'A prerequisite note, decision, or project.',
  'The design, decision, or requirement implemented here.',
  'The note or dependency currently blocking this note.',
  'A question note answered by this note.',
  'A question, hypothesis, or assumption tested by this experiment.',
  'A materially related note without a stronger claim.',
  'The same concept represented by another note or alias.',
  'A near-equivalent concept useful for discovery but not safe to merge or treat as exact identity.',
  'The conceptual note this version belongs to.',
  'A note made more precise or useful by this note.',
];

describe('graph contract characterization', () => {
  test('keeps all fourteen names, order, exact public semantics and reciprocal flags', () => {
    expect(RELATION_FIELDS).toEqual(fields);
    expect(new Set(RELATION_FIELDS).size).toBe(14);
    expect(RECIPROCAL_RELATIONS).toEqual(['related', 'same_as', 'close_match']);
    expect(getOrganizationRelationContract()).toEqual(fields.map((field, index) => ({
      field, target: targets[index],
      direction: [9, 10, 11].includes(index) ? 'mutual' : 'directional',
      reciprocal: [9, 10, 11].includes(index),
    })));
  });

  test('returns fresh public copies without version or internal rule fields', () => {
    const first = getOrganizationRelationContract();
    const second = getOrganizationRelationContract();
    expect(first).not.toBe(second);
    first.forEach((entry, index) => {
      expect(entry).not.toBe(second[index]);
      expect(entry).not.toBe(RELATION_SEMANTICS[index]);
      expect(Object.keys(entry)).toEqual(['field', 'direction', 'target', 'reciprocal']);
    });
  });
});

describe('shared graph contract', () => {
  // Dynamic loading lets the characterization above run before extraction exists.
  const load = () => import('./graph-contract.js');

  test('shares compatibility exports by identity with a separate contract version', async () => {
    const shared = await load();
    expect(shared.GRAPH_CONTRACT_VERSION).toBe(1);
    expect(shared.RELATION_FIELDS).toBe(RELATION_FIELDS);
    expect(shared.RECIPROCAL_RELATIONS).toBe(RECIPROCAL_RELATIONS);
    expect(shared.RELATION_SEMANTICS).toBe(RELATION_SEMANTICS);
    expect(shared.RELATION_SEMANTICS.map(entry => entry.field)).toEqual(fields);
  });

  test('keeps three claim input/property mappings and their backlink projection', async () => {
    const shared = await load();
    expect(shared.CLAIM_RELATION_FIELDS).toEqual([
      { input: 'supportsClaims', property: 'supports_claims', relation: 'supports' },
      { input: 'contradictsClaims', property: 'contradicts_claims', relation: 'contradicts' },
      { input: 'dependsOnClaims', property: 'depends_on_claims', relation: 'depends_on' },
    ]);
    expect(shared.CLAIM_GRAPH_RELATIONS).toEqual([
      { field: 'supports_claims', relation: 'claim_supports' },
      { field: 'contradicts_claims', relation: 'claim_contradicts' },
      { field: 'depends_on_claims', relation: 'claim_depends_on' },
    ]);
    expect(new Set(shared.CLAIM_RELATION_FIELDS.map(entry => entry.property)).size).toBe(3);
    expect(shared.CLAIM_RELATION_FIELDS.every(entry => fields.includes(entry.relation))).toBe(true);
  });

  test('retains only the two existing target-kind restrictions and exact errors', async () => {
    const { typedRelationTargetKindReason: reason, RELATION_TARGET_KIND_RULES: rules } = await load();
    expect(rules.map(rule => rule.relation)).toEqual(['answers_questions', 'tests']);
    const kinds = ['question', 'hypothesis', 'assumption', 'atomic', 'experiment', '', 'Question', ' question '];
    for (const relation of [...fields, 'unknown', '__proto__', 'constructor']) {
      for (const kind of kinds) {
        const expected = relation === 'answers_questions' && kind !== 'question'
          ? 'answers_questions targets must have note_kind: question.'
          : relation === 'tests' && !['question', 'hypothesis', 'assumption'].includes(kind)
            ? 'tests targets must have note_kind: question, hypothesis, or assumption.' : undefined;
        expect(reason(relation, kind)).toBe(expected);
      }
    }
  });

  test('keeps evidence virtual and preserves narrow retrieval profiles and priority order', async () => {
    const { QUESTION_GRAPH_PROFILE: profile } = await load();
    expect(profile.relations).toEqual(['evidence', 'supports', 'contradicts', 'depends_on', 'derived_from']);
    expect(profile.priorityRelations).toEqual(['contradicts', 'depends_on']);
    expect(profile.contextRelations).toEqual(['supports', 'derived_from']);
    expect(profile.reverseRelations).toEqual(['contradicts', 'claim_contradicts']);
    expect(new Set(profile.relations).size).toBe(5);
    expect(['evidence', ...profile.priorityRelations, ...profile.contextRelations].sort()).toEqual([...profile.relations].sort());
    expect(fields).not.toContain('evidence');
  });
});
