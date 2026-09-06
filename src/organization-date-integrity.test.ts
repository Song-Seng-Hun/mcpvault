import { expect, test } from 'vitest';
import { normalizeIsoDate, normalizeReviewAt, organizationLintIssues, temporalValidity, knowledgeOrganization } from './organization.js';

const invalidDates = ['2025-02-29', '1900-02-29', '2024-02-30', '2024-04-31', '2024-06-31', '2024-02-30T12:00:00Z', '2024-02-30T23:59:00-05:00'];
const invalidValues: unknown[] = [...invalidDates, ['2024-01-01'], {}, false, 20240101, 'January 1, 2024'];
const asOf = Date.parse('2024-03-15T00:00:00Z');

test.each(invalidValues.map(value => [value]))('organization date inputs reject calendar rollover and coercion: %j', value => {
  expect(() => normalizeIsoDate(value, 'validFrom')).toThrow();
  expect(() => normalizeReviewAt(value)).toThrow();
  expect(() => knowledgeOrganization({ status: 'draft', validFrom: value })).toThrow();
});

test.each(['2000-02-29', '2024-02-29', '2024-04-30', '0000-02-29', '0096-02-29', '2024-01-01T00:30:00+14:00', '2024-02-29T23:30:00-12:00', '2024-02-29T12:30:00.123Z', ' 2024-02-29 '])('valid authored dates remain unchanged apart from trimming: %s', value => {
  expect(normalizeIsoDate(value, 'date')).toBe(value.trim());
  expect(normalizeReviewAt(value)).toBe(value.trim());
});

test('optional date input clearing remains supported', () => {
  for (const value of [undefined, null, '', '  ']) expect(normalizeIsoDate(value, 'date')).toBeUndefined();
});

test.each(['valid_from', 'valid_until', 'observed_at'])('%s cannot become current/unspecified through malformed source metadata', field => {
  for (const value of [...invalidValues, null, '']) {
    expect(temporalValidity({ [field]: value }, asOf)).toMatchObject({ state: 'invalid', reason: 'invalid_temporal_date' });
  }
});

const lintFields = ['due_at', 'scheduled_at', 'defer_until', 'started_at', 'blocked_since', 'waiting_since', 'completed_at', 'last_reviewed_at', 'review_snoozed_until', 'valid_from', 'valid_until', 'observed_at', 'last_recalled_at', 'retention_at', 'preserve_until', 'clarified_at', 'review_at'];
test.each(lintFields)('lint shares strict scalar/calendar validation for %s', field => {
  for (const value of ['2024-02-30', ['2024-01-01'], null]) {
    const issues = organizationLintIssues('Knowledge/Note.md', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'active', [field]: value }, '# Note', asOf);
    expect(issues.filter(issue => issue.code === `invalid_${field}`)).toHaveLength(1);
    if (field === 'review_at') expect(issues.some(issue => issue.code === 'knowledge_review_due')).toBe(false);
  }
});

test('validity range comparisons retain timezone and exclusive-end semantics', () => {
  const metadata = { valid_from: '2024-02-29T23:00:00-02:00', valid_until: '2024-03-01T03:00:00+01:00' };
  expect(temporalValidity(metadata, Date.parse('2024-03-01T00:59:59Z')).state).toBe('not_yet_valid');
  expect(temporalValidity(metadata, Date.parse('2024-03-01T01:00:00Z')).state).toBe('current');
  expect(temporalValidity(metadata, Date.parse('2024-03-01T02:00:00Z')).state).toBe('expired');
});
