import { describe, expect, test } from 'vitest';
import { knowledgeOrganization, organizationLintIssues } from './organization.js';

describe('knowledge organization focus and summary metadata', () => {
  test('normalizes GTD horizon and progressive summary layers', () => {
    expect(knowledgeOrganization({
      status: 'draft',
      noteKind: 'project',
      focusHorizon: 'project',
      focusParent: '[[Goals/MCPVault]]',
      focusSupports: ['[[Areas/Knowledge]]'],
      summaryLayer: 4,
      summaryHighlights: [{ text: 'The durable conclusion.', startLine: 8, endLine: 8, quoteHash: 'a'.repeat(64) }],
    })).toMatchObject({
      focus_horizon: 'project',
      focus_parent: '[[Goals/MCPVault]]',
      focus_supports: ['[[Areas/Knowledge]]'],
      summary_layer: 4,
      summary_highlights: [{ text: 'The durable conclusion.', startLine: 8, endLine: 8, quoteHash: 'a'.repeat(64) }],
    });
  });

  test('lint rejects invalid values without requiring optional metadata', () => {
    const issues = organizationLintIssues('Knowledge/Bad.md', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen',
      focus_horizon: 'someday', summary_layer: 5,
      summary_highlights: [{ text: 'x', startLine: 4, endLine: 2 }],
    }, '# Bad\n');
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['invalid_focus_horizon', 'invalid_summary_layer', 'invalid_summary_highlights']));
  });
});
