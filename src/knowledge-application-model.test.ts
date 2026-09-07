import { describe, expect, it } from 'vitest';
import {
  APPLICATION_OUTCOMES,
  KNOWLEDGE_APPLICATIONS_SCHEMA,
  normalizeKnowledgeApplications,
} from './knowledge-application-model.js';

const revision = 'A'.repeat(64);

const validApplication = {
  id: 'exp-1',
  knowledge: { path: 'Notes/회고.md', revision },
  environment: '로컬 테스트 환경',
  conditions: '동일한 입력과 설정',
  outcome: 'succeeded',
  observed: '재현되었다',
  verification: { path: 'scope://model/codex/검증.md', revision },
};

describe('normalizeKnowledgeApplications', () => {
  it('accepts the three outcomes, normalizes revisions, and preserves locators', () => {
    const input = [
      validApplication,
      (({ verification: _verification, ...application }) => application)({ ...validApplication, id: 'failed', outcome: 'failed' }),
      { ...validApplication, id: 'inconclusive', outcome: 'inconclusive' },
    ];

    const result = normalizeKnowledgeApplications(input);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      id: 'exp-1',
      outcome: 'succeeded',
      knowledge: { path: 'Notes/회고.md', revision: revision.toLowerCase() },
      verification: { path: 'scope://model/codex/검증.md', revision: revision.toLowerCase() },
    });
    expect(result[1]).not.toHaveProperty('verification');
    expect(APPLICATION_OUTCOMES).toEqual(['succeeded', 'failed', 'inconclusive']);
  });

  it('returns empty arrays for clear empty and undefined input', () => {
    expect(normalizeKnowledgeApplications([])).toEqual([]);
    expect(normalizeKnowledgeApplications(undefined)).toEqual([]);
  });

  it.each([
    ['non-array', {}],
    ['too many records', Array.from({ length: 9 }, (_, i) => ({ ...validApplication, id: `id-${i}` }))],
    ['duplicate ids', [validApplication, { ...validApplication, id: 'other' }, { ...validApplication, id: 'other' }]],
    ['unknown author spoof', [{ ...validApplication, author: 'trusted-user' }]],
    ['unknown nested locator field', [{ ...validApplication, knowledge: { ...validApplication.knowledge, author: 'x' } }]],
    ['bad id', [{ ...validApplication, id: '대문자' }]],
    ['bad revision', [{ ...validApplication, knowledge: { path: 'x.md', revision: 'not-a-revision' } }]],
    ['bad path', [{ ...validApplication, knowledge: { path: '../secret.md', revision } }]],
    ['bad URL path', [{ ...validApplication, knowledge: { path: 'https://example.com/x.md', revision } }]],
    ['bad wikilink path', [{ ...validApplication, knowledge: { path: '[[Note]].md', revision } }]],
    ['bad scope kind', [{ ...validApplication, knowledge: { path: 'scope://private/x.md', revision } }]],
    ['empty optional limitations', [{ ...validApplication, limitations: '   ' }]],
  ])('rejects %s', (_label, value) => {
    expect(() => normalizeKnowledgeApplications(value)).toThrow();
  });

  it('rejects oversized fields and total serialized input', () => {
    expect(() => normalizeKnowledgeApplications([{ ...validApplication, environment: '가'.repeat(501) }])).toThrow();
    expect(() => normalizeKnowledgeApplications([{ ...validApplication, conditions: '가'.repeat(1001) }])).toThrow();
    expect(() => normalizeKnowledgeApplications([{ ...validApplication, observed: '가'.repeat(1001) }])).toThrow();
    expect(() => normalizeKnowledgeApplications([{ ...validApplication, limitations: '가'.repeat(501) }])).toThrow();
    expect(() => normalizeKnowledgeApplications(Array.from({ length: 8 }, (_, index) => ({
      ...validApplication,
      id: `large-${index}`,
      observed: '가'.repeat(1000),
      conditions: '나'.repeat(1000),
      environment: '다'.repeat(500),
    })))).toThrow();
  });

  it('rejects malformed paths, controls, headings, blocks, and absolute paths', () => {
    for (const path of ['C:\\vault\\x.md', '/vault/x.md', 'a/../../x.md', 'x\u0000.md', 'x\n.md', 'x#Heading.md', 'x^block.md', 'x [[Note]].md']) {
      expect(() => normalizeKnowledgeApplications([{ ...validApplication, knowledge: { path, revision } }])).toThrow();
    }
  });

  it('does not mutate the input', () => {
    const input = JSON.parse(JSON.stringify([validApplication]));
    const before = JSON.stringify(input);
    normalizeKnowledgeApplications(input);
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each([' ', '\\\\server\\share\\x.md', 'C:relative.md', 'x.md:secret', 'scope://model/codex', 'scope://model/codex/a\\..\\secret.md'])('rejects nonexact locator %s', path => {
    expect(() => normalizeKnowledgeApplications([{ ...validApplication, knowledge: { path, revision } }])).toThrow();
  });
});

describe('KNOWLEDGE_APPLICATIONS_SCHEMA', () => {
  it('describes a bounded array of closed records with matching constraints', () => {
    expect(KNOWLEDGE_APPLICATIONS_SCHEMA).toMatchObject({ type: 'array', maxItems: 8 });
    expect(KNOWLEDGE_APPLICATIONS_SCHEMA.items.additionalProperties).toBe(false);
    expect(KNOWLEDGE_APPLICATIONS_SCHEMA.items.properties.outcome.enum).toEqual(APPLICATION_OUTCOMES);
    expect(KNOWLEDGE_APPLICATIONS_SCHEMA.items.properties.environment.maxLength).toBe(500);
    expect(KNOWLEDGE_APPLICATIONS_SCHEMA.items.properties.conditions.maxLength).toBe(1000);
    expect(KNOWLEDGE_APPLICATIONS_SCHEMA.items.properties.observed.maxLength).toBe(1000);
  });
});
