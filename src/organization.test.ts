import { describe, expect, test } from 'vitest';
import { getOrganizationPropertyContract, getOrganizationRelationContract, knowledgeOrganization, organizationLintIssues, organizationNoteTemplate } from './organization.js';

describe('knowledge organization focus and summary metadata', () => {
  test('normalizes interpretation stages and question answer relations', () => {
    expect(knowledgeOrganization({
      status: 'draft',
      noteKind: 'atomic',
      interpretationStatus: 'synthesized',
      relations: { answers_questions: ['[[Knowledge/Questions/Why]]'] },
    })).toMatchObject({
      interpretation_status: 'synthesized',
      answers_questions: ['[[Knowledge/Questions/Why]]'],
    });
  });

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

  test('keeps project planning support separate from executable actions', () => {
    expect(knowledgeOrganization({
      status: 'draft',
      noteKind: 'project',
      projectPurpose: 'Make the shared knowledge loop easier to resume.',
      desiredOutcome: 'An agent can find and complete the next step.',
      projectSupport: ['[[Knowledge/Planning]]'],
      nextAction: 'Review the planning packet',
    })).toMatchObject({
      project_purpose: 'Make the shared knowledge loop easier to resume.',
      project_support: ['[[Knowledge/Planning]]'],
      next_action: 'Review the planning packet',
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

  test('lint surfaces pending literature interpretation and repeated review', () => {
    const issues = organizationLintIssues('Knowledge/Literature.md', {
      llm_wiki_type: 'knowledge', note_kind: 'literature', lifecycle: 'active',
      review_count: 4, review_reopen_count: 3,
    }, '# Literature\n');
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['literature_interpretation_pending']));
  });

  test('warns when MCP-managed nested metadata is awkward for core Properties editing', () => {
    const issues = organizationLintIssues('Knowledge/Claims.md', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'active',
      claims: [{ text: 'A bounded claim', evidence: [{ path: '_sources/paper.md' }] }],
    }, '# Claims\n');
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'obsidian_complex_property' }),
    ]));
  });

  test('keeps lifecycle retirement and review records explainable', () => {
    const issues = organizationLintIssues('Knowledge/Retired.md', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'superseded',
      last_review_outcome: 'superseded',
    }, '# Retired\n');
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'superseded_without_replacement', 'review_record_incomplete',
    ]));
    expect(organizationLintIssues('Knowledge/Archived.md', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'archived',
    }, '# Archived\n').map(issue => issue.code)).toContain('archived_reason_missing');
  });

  test('publishes a stable Property contract and detects managed shape drift', () => {
    expect(getOrganizationPropertyContract()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'note_kind', type: 'text' }),
      expect.objectContaining({ name: 'aliases', type: 'list' }),
      expect.objectContaining({ name: 'review_interval_days', type: 'number' }),
    ]));
    expect(knowledgeOrganization({ status: 'draft', noteKind: 'atomic', reviewIntervalDays: 30 })).toMatchObject({ review_interval_days: 30 });
    expect(organizationLintIssues('Knowledge/Drift.md', {
      llm_wiki_type: 'knowledge', note_kind: ['atomic'], lifecycle: 'evergreen', review_interval_days: 0,
    }, '# Drift\n').map(issue => issue.code)).toEqual(expect.arrayContaining(['property_contract_violation', 'invalid_review_interval_days']));
  });

  test('publishes relation meaning without inventing inverse Properties', () => {
    expect(getOrganizationRelationContract()).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'supports', direction: 'directional', reciprocal: false }),
      expect.objectContaining({ field: 'related', direction: 'mutual', reciprocal: true }),
      expect.objectContaining({ field: 'same_as', direction: 'mutual', reciprocal: true }),
    ]));
  });

  test('keeps retrieval cues optional, bounded, and separate from evidence', () => {
    expect(knowledgeOrganization({
      status: 'draft', noteKind: 'knowledge', retrievalCues: ['When the index is stale'], useWhen: 'When a search result disagrees with Markdown.',
    })).toMatchObject({ retrieval_cues: ['When the index is stale'], use_when: 'When a search result disagrees with Markdown.' });
    expect(organizationLintIssues('Knowledge/BadCues.md', {
      llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', retrieval_cues: 'not-a-list', use_when: '',
    }, '# Bad cues\n').map(issue => issue.code)).toEqual(expect.arrayContaining(['invalid_retrieval_cues', 'invalid_use_when']));
  });

  test('supports atomic roles, scoped terminology, adjacent links, and review snoozes', () => {
    expect(knowledgeOrganization({
      status: 'draft', noteKind: 'atomic', knowledgeRole: 'counterargument',
      termScopeNote: 'Only applies to the local MCPVault read model.',
      seeAlso: ['[[Knowledge/Index]]'], reviewSnoozedUntil: '2030-01-01', reviewSnoozeReason: 'Waiting for the source edition.',
    })).toMatchObject({
      knowledge_role: 'counterargument', term_scope_note: 'Only applies to the local MCPVault read model.',
      see_also: ['[[Knowledge/Index]]'], review_snoozed_until: '2030-01-01',
    });
    expect(organizationLintIssues('Knowledge/BadRole.md', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'active', knowledge_role: 'myth', see_also: 'not-a-list', review_snoozed_until: 'not-a-date',
    }, '# Bad role\n').map(issue => issue.code)).toEqual(expect.arrayContaining([
      'invalid_knowledge_role', 'invalid_see_also', 'invalid_review_snoozed_until',
    ]));
  });

  test('provides optional role templates without making them publication gates', () => {
    expect(organizationNoteTemplate('question')).toMatchObject({
      templateId: 'question', noteKind: 'question',
      properties: { epistemic_status: 'open' },
    });
    expect(organizationNoteTemplate('negative')).toMatchObject({
      templateId: 'negative', noteKind: 'knowledge',
      properties: { knowledge_polarity: 'negative', negative_type: 'failure' },
    });
    expect(organizationNoteTemplate('unknown')).toMatchObject({ templateId: 'atomic', noteKind: 'atomic' });
  });

  test('adds explainable retention metadata and warns about unsafe combinations', () => {
    expect(knowledgeOrganization({
      status: 'superseded', noteKind: 'atomic', lifecycle: 'superseded',
      retentionPolicy: 'tombstone', retentionAt: '2030-01-01',
      retentionReason: 'Keep the replacement trail.', replacedBy: '[[Knowledge/New]]',
    })).toMatchObject({
      retention_policy: 'tombstone', retention_at: '2030-01-01',
      retention_reason: 'Keep the replacement trail.', replaced_by: '[[Knowledge/New]]',
    });
    expect(organizationLintIssues('Knowledge/Tombstone.md', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'active', retention_policy: 'tombstone',
    }, '# Tombstone\n').map(issue => issue.code)).toEqual(expect.arrayContaining([
      'retention_reason_missing', 'tombstone_lifecycle_mismatch',
    ]));
  });

  test('preserves authority, relation rationale, and review checklist metadata', () => {
    expect(knowledgeOrganization({
      status: 'verified', noteKind: 'atomic', preferredTerm: 'MCPVault', disambiguation: 'Obsidian bridge',
      relations: { supports: ['[[Knowledge/Search]]'] },
      relationNotes: { supports: 'The search design uses this note as its cache invariant.' },
      relationEvidence: { supports: ['_sources/design.md'] },
      reviewChecks: ['evidence', 'links', 'freshness'], reviewOpenItems: ['Check the remote benchmark.'],
    })).toMatchObject({
      preferred_term: 'MCPVault', disambiguation: 'Obsidian bridge',
      supports: ['[[Knowledge/Search]]'],
      relation_notes: { supports: 'The search design uses this note as its cache invariant.' },
      relation_evidence: { supports: ['_sources/design.md'] },
      review_checks: ['evidence', 'links', 'freshness'], review_open_items: ['Check the remote benchmark.'],
    });
    expect(organizationLintIssues('Knowledge/BadReview.md', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'review',
      review_checks: ['not-a-check'], relation_notes: { unknown: 'bad' },
    }, '# Bad review\n').map(issue => issue.code)).toEqual(expect.arrayContaining(['invalid_review_checks', 'invalid_relation_notes']));
  });
});
