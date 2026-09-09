import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  researchFingerprint,
  validateResearchConfig,
  validateResearchReview,
  validateResearchSubmission,
} from './independent-research-model.js';

const evidence = { path: 'Sources/one.md', revision: 'a'.repeat(64) };
const config = {
  question: 'What is true?',
  constraints: ['Use primary sources'],
  participants: ['agent.one', 'agent-two'],
  budgetMinutes: 30,
};

test('omitted constraints default to an empty list without weakening other required fields', () => {
  const { constraints: _constraints, ...withoutConstraints } = config;
  expect(validateResearchConfig(withoutConstraints).constraints).toEqual([]);
});

test('a no-result submission requires both failed searches and uncertainty', () => {
  const base = { candidate: 'No result', conditions: '', failedSearches: 'Attempted sources', uncertainties: 'Still unknown', evidence: [] };
  expect(validateResearchSubmission(base)).toEqual(base);
  expect(() => validateResearchSubmission({ ...base, failedSearches: '' })).toThrow();
  expect(() => validateResearchSubmission({ ...base, uncertainties: '' })).toThrow();
});
const submission = {
  candidate: 'The candidate answer',
  conditions: 'Only under condition C.',
  failedSearches: '',
  uncertainties: '',
  evidence: [evidence],
};
const review = {
  targetAccountId: 'agent.one',
  targetFingerprint: 'b'.repeat(64),
  disposition: 'support' as const,
  rationale: 'The evidence supports the candidate.',
  evidence: [evidence],
};

describe('independent research model', () => {
  test('normalizes valid config, submission, and review without coercion', () => {
    expect(validateResearchConfig({ ...config, question: '  What is true?  ', constraints: ['  Use primary sources  '] })).toEqual({
      ...config,
      question: 'What is true?',
      constraints: ['Use primary sources'],
    });
    expect(validateResearchSubmission({ ...submission, candidate: '  The candidate answer  ' })).toEqual({
      ...submission,
      candidate: 'The candidate answer',
    });
    expect(validateResearchReview({ ...review, rationale: '  The evidence supports the candidate.  ' })).toEqual({
      ...review,
      rationale: 'The evidence supports the candidate.',
    });
  });

  test.each([
    [validateResearchConfig, config],
    [validateResearchSubmission, submission],
    [validateResearchReview, review],
  ])('rejects null, arrays, primitives, and unknown keys', (validator, value) => {
    expect(() => validator(null)).toThrow();
    expect(() => validator([])).toThrow();
    expect(() => validator('text')).toThrow();
    expect(() => validator({ ...value, unexpected: true })).toThrow();
  });

  test('enforces config limits, account IDs, and exact types', () => {
    expect(() => validateResearchConfig({ ...config, question: '😀'.repeat(1001) })).toThrow();
    expect(() => validateResearchConfig({ ...config, constraints: ['x'.repeat(281)] })).toThrow();
    expect(() => validateResearchConfig({ ...config, constraints: Array.from({ length: 9 }, () => 'x') })).toThrow();
    expect(() => validateResearchConfig({ ...config, participants: ['agent.one', 'agent.one'] })).toThrow();
    expect(() => validateResearchConfig({ ...config, participants: ['Agent.one', 'agent-two'] })).toThrow();
    expect(() => validateResearchConfig({ ...config, participants: ['agent.one'] })).toThrow();
    expect(() => validateResearchConfig({ ...config, budgetMinutes: 1.5 })).toThrow();
    expect(() => validateResearchConfig({ ...config, budgetMinutes: '30' })).toThrow();
    expect(() => validateResearchConfig({ ...config, question: 'bad\u0000text' })).toThrow();
  });

  test('enforces submission evidence and bounded prose rules', () => {
    expect(validateResearchSubmission({ ...submission, failedSearches: '  no result  ', uncertainties: '  unknown  ', evidence: [] })).toMatchObject({ evidence: [], failedSearches: 'no result', uncertainties: 'unknown' });
    expect(() => validateResearchSubmission({ ...submission, evidence: [] })).toThrow();
    expect(() => validateResearchSubmission({ ...submission, candidate: '😀'.repeat(1201) })).toThrow();
    expect(() => validateResearchSubmission({ ...submission, conditions: 'x'.repeat(701) })).toThrow();
    expect(() => validateResearchSubmission({ ...submission, candidate: 'x\u0000y' })).toThrow();
    expect(() => validateResearchSubmission({ ...submission, evidence: Array.from({ length: 9 }, () => evidence) })).toThrow();
    expect(() => validateResearchSubmission({ ...submission, evidence: [{ ...evidence, revision: 'g'.repeat(64) }] })).toThrow();
    expect(() => validateResearchSubmission({ ...submission, evidence: [{ ...evidence, path: '' }] })).toThrow();
    expect(() => validateResearchSubmission({ ...submission, evidence: [{ ...evidence, unexpected: 'x' }] })).toThrow();
  });

  test('validates review disposition, fingerprint, and limits', () => {
    expect(() => validateResearchReview({ ...review, disposition: 'reject' })).toThrow();
    expect(() => validateResearchReview({ ...review, targetFingerprint: 'A'.repeat(64) })).toThrow();
    expect(() => validateResearchReview({ ...review, targetAccountId: 'agent one' })).toThrow();
    expect(() => validateResearchReview({ ...review, rationale: '😀'.repeat(1001) })).toThrow();
    expect(() => validateResearchReview({ ...review, evidence: Array.from({ length: 9 }, () => evidence) })).toThrow();
  });

  test('keeps malicious-looking prose inert and permits newline/tab prose', () => {
    const value = validateResearchSubmission({ ...submission, candidate: '<script>eval("bad")</script>\n\tdata' });
    expect(value.candidate).toBe('<script>eval("bad")</script>\n\tdata');
  });

  test('hashes canonical object keys while preserving array order', () => {
    const left = { b: [2, { z: true, a: 'x' }], a: 'value' };
    const right = { a: 'value', b: [2, { a: 'x', z: true }] };
    const expected = createHash('sha256').update('{"a":"value","b":[2,{"a":"x","z":true}]}').digest('hex');
    expect(researchFingerprint(left)).toBe(expected);
    expect(researchFingerprint(left)).toBe(researchFingerprint(right));
    expect(researchFingerprint({ ...left, b: [{ z: true, a: 'x' }, 2] })).not.toBe(expected);
  });
});
