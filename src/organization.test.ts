import { describe, expect, test } from 'vitest';
import { BASES_VIEW_IDS, NOTE_TEMPLATE_IDS, getOrganizationPropertyContract, getOrganizationRelationContract, knowledgeOrganization, organizationLintIssues, organizationNoteTemplate, temporalValidity } from './organization.js';

describe('knowledge organization focus and summary metadata', () => {
  test('filing edits and partial stale projection edits cannot certify inherited summaries', () => {
    const existing = { summary: 'Old summary', key_points: ['Old point'], summary_of_content_sha256: 'a'.repeat(64) };
    const metadataOnly = knowledgeOrganization({ existing, status: 'draft', tags: ['research'], contentDigest: 'b'.repeat(64) });
    expect(metadataOnly.summary_of_content_sha256).toBe('a'.repeat(64));
    const partial = knowledgeOrganization({ existing, status: 'draft', keyPoints: ['New point'], contentDigest: 'b'.repeat(64) });
    expect(partial.summary_of_content_sha256).toBe('a'.repeat(64));
    const refreshed = knowledgeOrganization({ existing, status: 'draft', summary: 'New summary', keyPoints: ['New point'], contentDigest: 'b'.repeat(64) });
    expect(refreshed.summary_of_content_sha256).toBe('b'.repeat(64));
    expect(() => knowledgeOrganization({ status: 'draft', timeEstimateMinutes: -1 })).toThrow('timeEstimateMinutes');
  });
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

  test('keeps claim validity separate from file and workflow dates', () => {
    const organization = knowledgeOrganization({
      status: 'draft', noteKind: 'knowledge',
      validFrom: '2030-01-01T00:00:00.000Z', validUntil: '2030-02-01T00:00:00.000Z',
      observedAt: '2029-12-20T00:00:00.000Z', temporalScope: 'Applicable to the 2030 winter policy window.',
    });
    expect(organization).toMatchObject({
      valid_from: '2030-01-01T00:00:00.000Z', valid_until: '2030-02-01T00:00:00.000Z',
      observed_at: '2029-12-20T00:00:00.000Z', temporal_scope: 'Applicable to the 2030 winter policy window.',
    });
    expect(temporalValidity(organization, Date.parse('2030-01-15T00:00:00.000Z')).state).toBe('current');
    expect(temporalValidity(organization, Date.parse('2029-12-31T00:00:00.000Z')).state).toBe('not_yet_valid');
    expect(temporalValidity(organization, Date.parse('2030-02-01T00:00:00.000Z')).state).toBe('expired');
    expect(() => knowledgeOrganization({ status: 'draft', validFrom: '2030-02-01', validUntil: '2030-01-01' })).toThrow(/validUntil/);
    expect(organizationLintIssues('Knowledge/Expired.md', {
      llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', valid_until: '2029-01-01',
    }, '# Expired\n', Date.parse('2030-01-01'))).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'knowledge_validity_expired' }),
    ]));
    expect(organizationLintIssues('Knowledge/InvalidRange.md', {
      llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'active', valid_from: '2030-02-01', valid_until: '2030-01-01',
    }, '# Invalid\n', Date.parse('2030-01-01')).map(issue => issue.code)).toContain('invalid_temporal_validity_range');
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

  test('supports bounded multi-MOC membership without replacing the primary map', () => {
    expect(knowledgeOrganization({
      status: 'draft', noteKind: 'atomic', primaryMoc: '[[MOCs/Main]]',
      mocs: ['[[MOCs/Research]]', '[[MOCs/Agents]]', '[[MOCs/Research]]'],
    })).toMatchObject({
      primary_moc: '[[MOCs/Main]]',
      mocs: ['[[MOCs/Research]]', '[[MOCs/Agents]]'],
    });
    expect(organizationLintIssues('Knowledge/BadMocs.md', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', mocs: 'not-a-list',
    }, '# Bad MOCs\n').map(issue => issue.code)).toContain('invalid_mocs');
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

  test('warns when a durable note has a generic rediscovery-hostile title', () => {
    expect(organizationLintIssues('Knowledge/Draft.md', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen',
    }, '# Draft\n').map(issue => issue.code)).toContain('generic_concept_title');
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

  test('keeps archival arrangement on immutable source records only', () => {
    expect(getOrganizationPropertyContract()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'archive_collection_id', type: 'text', appliesTo: ['source'] }),
      expect.objectContaining({ name: 'archive_series', type: 'list', appliesTo: ['source'] }),
      expect.objectContaining({ name: 'archive_sequence', type: 'number', appliesTo: ['source'] }),
    ]));
    expect(organizationLintIssues('_sources/ordered.md', {
      llm_wiki_type: 'source', immutable: true, archive_collection_id: 'research-2030', archive_series: ['Interviews', 'Experts'], archive_sequence: 4,
    }, '# Source\n').map(issue => issue.code)).not.toEqual(expect.arrayContaining(['invalid_archive_series', 'invalid_archive_sequence']));
    expect(organizationLintIssues('_sources/missing-collection.md', {
      llm_wiki_type: 'source', immutable: true, archive_series: ['Interviews'], archive_sequence: 1,
    }, '# Source\n').map(issue => issue.code)).toContain('archive_collection_id_missing');
    expect(organizationLintIssues('Knowledge/wrong-place.md', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', archive_collection_id: 'research-2030',
    }, '# Wrong place\n').map(issue => issue.code)).toContain('archive_metadata_wrong_type');
  });

  test('normalizes Kanban service classes, completion criteria, and flow timestamps', () => {
    expect(knowledgeOrganization({
      status: 'draft', noteKind: 'project', lifecycle: 'active', serviceClass: 'RESEARCH',
      completionCriteria: ['A checked result exists', 'A reusable note is linked', 'A checked result exists'],
      startedAt: '2030-01-01T10:00:00.000Z', completedAt: '2030-01-02T10:00:00.000Z',
    })).toMatchObject({
      service_class: 'research',
      completion_criteria: ['A checked result exists', 'A reusable note is linked'],
      started_at: '2030-01-01T10:00:00.000Z', completed_at: '2030-01-02T10:00:00.000Z',
    });
    expect(() => knowledgeOrganization({ status: 'draft', serviceClass: 'urgent' })).toThrow(/serviceClass/);
  });

  test('warns when active project work has no observable completion condition', () => {
    expect(organizationLintIssues('Projects/Unbounded.md', {
      llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active',
      project_purpose: 'Improve the workflow', desired_outcome: 'A better workflow',
    }, '# Unbounded project\n').map(issue => issue.code)).toContain('active_project_without_completion_criteria');
    expect(organizationLintIssues('Projects/Bounded.md', {
      llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active',
      project_purpose: 'Improve the workflow', desired_outcome: 'A better workflow',
      completion_criteria: ['The workflow is tested'],
    }, '# Bounded project\n').map(issue => issue.code)).not.toContain('active_project_without_completion_criteria');
  });

  test('keeps flow timestamps explicit instead of guessing from edits', () => {
    const issues = organizationLintIssues('Tasks/Flow.md', {
      llm_wiki_type: 'knowledge', note_kind: 'task', lifecycle: 'active', task_status: 'next_action',
    }, '# Flow task\n');
    expect(issues.map(issue => issue.code)).toContain('active_work_without_started_at');
    expect(organizationLintIssues('Tasks/Blocked.md', {
      llm_wiki_type: 'knowledge', note_kind: 'task', lifecycle: 'active', task_status: 'blocked',
    }, '# Blocked task\n').map(issue => issue.code)).toContain('blocked_work_without_blocked_since');
    expect(organizationLintIssues('Tasks/Done.md', {
      llm_wiki_type: 'knowledge', note_kind: 'task', lifecycle: 'active', task_status: 'completed',
    }, '# Done task\n').map(issue => issue.code)).toContain('completed_work_without_completed_at');
  });

  test('publishes relation meaning without inventing inverse Properties', () => {
    expect(getOrganizationRelationContract()).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'supports', direction: 'directional', reciprocal: false }),
      expect.objectContaining({ field: 'tests', direction: 'directional', reciprocal: false }),
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
    expect(NOTE_TEMPLATE_IDS).toEqual(expect.arrayContaining(['concept', 'argument', 'model', 'observation', 'counterargument']));
    expect(BASES_VIEW_IDS).toEqual(expect.arrayContaining(['decisions', 'concepts', 'arguments', 'models', 'observations', 'counterarguments', 'authority', 'review_checklist', 'collections', 'archives']));
    expect(organizationNoteTemplate('question')).toMatchObject({
      templateId: 'question', noteKind: 'question',
      properties: { epistemic_status: 'open' },
    });
    expect(organizationNoteTemplate('negative')).toMatchObject({
      templateId: 'negative', noteKind: 'knowledge',
      properties: { knowledge_polarity: 'negative', negative_type: 'failure' },
    });
    expect(organizationNoteTemplate('assumption')).toMatchObject({
      templateId: 'assumption', noteKind: 'assumption',
      properties: { epistemic_status: 'active' },
    });
    expect(organizationNoteTemplate('concept')).toMatchObject({
      templateId: 'concept', noteKind: 'atomic',
      properties: { knowledge_role: 'concept' },
      markdown: expect.stringContaining('## Non-examples and boundaries'),
    });
    expect(organizationNoteTemplate('model')).toMatchObject({
      templateId: 'model', noteKind: 'knowledge',
      properties: { knowledge_role: 'model' },
      markdown: expect.stringContaining('## Limits and failure modes'),
    });
    expect(organizationNoteTemplate('observation').properties).not.toHaveProperty('observed_at');
    expect(organizationNoteTemplate('counterargument')).toMatchObject({
      templateId: 'counterargument', noteKind: 'atomic',
      properties: { knowledge_role: 'counterargument', contradicts: [] },
      markdown: expect.stringContaining('## What would change this objection'),
    });
    expect(organizationNoteTemplate('journal')).toMatchObject({ templateId: 'atomic', noteKind: 'atomic' });
    expect(organizationNoteTemplate('unknown')).toMatchObject({ templateId: 'atomic', noteKind: 'atomic' });
  });

  test('keeps Decision Record state distinct from lifecycle and knowledge status', () => {
    expect(knowledgeOrganization({ status: 'verified', noteKind: 'decision', lifecycle: 'evergreen', decisionStatus: 'accepted' })).toMatchObject({
      note_kind: 'decision', lifecycle: 'evergreen', decision_status: 'accepted',
    });
    expect(() => knowledgeOrganization({ status: 'draft', noteKind: 'atomic', decisionStatus: 'proposed' })).toThrow(/only valid for noteKind decision/);
    expect(organizationLintIssues('Knowledge/Decision.md', {
      llm_wiki_type: 'knowledge', note_kind: 'decision', lifecycle: 'evergreen', knowledge_status: 'verified',
    }, '# Decision\n').map(issue => issue.code)).toContain('decision_status_missing');
    expect(organizationLintIssues('Knowledge/Bad decision.md', {
      llm_wiki_type: 'knowledge', note_kind: 'decision', lifecycle: 'review', knowledge_status: 'draft', decision_status: 'accepted',
    }, '# Decision\n').map(issue => issue.code)).toContain('decision_status_inconsistent');
    expect(organizationLintIssues('Knowledge/Mismatched decision.md', {
      llm_wiki_type: 'knowledge', note_kind: 'decision', lifecycle: 'evergreen', knowledge_status: 'verified', decision_status: 'accepted',
    }, '# Decision\n\nDecision status: **proposed**\n').map(issue => issue.code)).toContain('decision_status_body_mismatch');
    expect(organizationLintIssues('Knowledge/Rejected decision.md', {
      llm_wiki_type: 'knowledge', note_kind: 'decision', lifecycle: 'superseded', knowledge_status: 'superseded', decision_status: 'rejected',
    }, '# Decision\n\nDecision status: **rejected**\n').map(issue => issue.code)).not.toContain('superseded_without_replacement');
    expect(organizationLintIssues('Knowledge/Not a decision.md', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', decision_status: 'accepted',
    }, '# Note\n').map(issue => issue.code)).toContain('decision_status_wrong_kind');
  });

  test('models reproducible experiments between hypotheses and durable conclusions', () => {
    expect(organizationNoteTemplate('experiment')).toMatchObject({
      templateId: 'experiment',
      noteKind: 'experiment',
      properties: { epistemic_status: 'planned', tests: [], methods: [] },
    });
    expect(knowledgeOrganization({
      status: 'draft',
      noteKind: 'experiment',
      epistemicStatus: 'reproduced',
      relations: {
        tests: ['[[Knowledge/Latency hypothesis]]'],
        version_of: ['[[Experiments/Latency run 1]]'],
      },
    })).toMatchObject({
      note_kind: 'experiment',
      epistemic_status: 'reproduced',
      tests: ['[[Knowledge/Latency hypothesis]]'],
      version_of: ['[[Experiments/Latency run 1]]'],
    });
    const complete = organizationLintIssues('Experiments/Latency run 2.md', {
      llm_wiki_type: 'knowledge',
      note_kind: 'experiment',
      lifecycle: 'review',
      epistemic_status: 'reproduced',
      tests: ['[[Knowledge/Latency hypothesis]]'],
      version_of: ['[[Experiments/Latency run 1]]'],
    }, '# Latency run 2\n\n## Protocol\nRepeat the same 100-request benchmark.\n\n## Environment\nNode 24 on Windows.\n\n## Observations\nMedian latency fell by 8 ms.\n\n## Result\nThe result reproduced.\n\n## Reproduction\nRun npm test with the benchmark fixture.\n');
    expect(complete.map(issue => issue.code)).not.toEqual(expect.arrayContaining([
      'epistemic_status_missing',
      'experiment_target_missing',
      'experiment_protocol_missing',
      'experiment_result_missing',
      'experiment_reproduction_missing',
      'experiment_reproduction_lineage_missing',
    ]));
    const incomplete = organizationLintIssues('Experiments/Incomplete.md', {
      llm_wiki_type: 'knowledge',
      note_kind: 'experiment',
      lifecycle: 'review',
      epistemic_status: 'failed',
    }, '# Incomplete\n\n## Protocol\n\n## Result\n');
    expect(incomplete.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'experiment_target_missing',
      'experiment_protocol_missing',
      'experiment_result_missing',
      'experiment_reproduction_missing',
    ]));
    expect(() => knowledgeOrganization({ status: 'draft', noteKind: 'experiment', epistemicStatus: 'supported' })).toThrow(/epistemicStatus for experiment/);
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
