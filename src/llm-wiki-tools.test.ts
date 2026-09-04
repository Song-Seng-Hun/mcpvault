import { describe, expect, test } from 'vitest';
import {
  CLARIFY_DISPOSITIONS,
  FOCUS_HORIZONS,
  INTERPRETATION_STATUSES,
  ISSUE_RESOLUTION_STATUSES,
  ISSUE_RETROSPECTIVE_STATUSES,
  KNOWLEDGE_POLARITIES,
  KNOWLEDGE_ROLES,
  LIFECYCLES,
  NEGATIVE_KINDS,
  NOTE_KINDS,
  RECALL_QUALITIES,
  RETENTION_EVENTS,
  RETENTION_POLICIES,
  REVIEW_CHECKS,
  REVIEW_OUTCOMES,
  REVIEW_POLICIES,
  SERVICE_CLASSES,
  TASK_STATUSES,
  TERM_STATUSES,
} from './organization.js';
import { getLlmWikiTools } from './llm-wiki-tools.js';

type SchemaProperties = Record<string, { enum?: unknown[]; items?: { enum?: unknown[] } }>;

const tools = new Map(getLlmWikiTools().map(tool => [tool.name, tool]));

function properties(toolName: string): SchemaProperties {
  const tool = tools.get(toolName);
  expect(tool, `${toolName} must remain exposed through the dynamic endpoint catalog`).toBeDefined();
  return (tool!.inputSchema as { properties: SchemaProperties }).properties;
}

function expectEnum(propertiesValue: SchemaProperties, field: string, expected: readonly string[]): void {
  expect(propertiesValue[field]?.enum, field).toEqual([...expected]);
}

describe('LLM Wiki organization vocabulary contracts', () => {
  test('uses the canonical vocabulary for publish and triage schemas', () => {
    const common = [
      ['noteKind', NOTE_KINDS],
      ['lifecycle', LIFECYCLES],
      ['knowledgeRole', KNOWLEDGE_ROLES],
      ['retentionPolicy', RETENTION_POLICIES],
      ['retentionEvent', RETENTION_EVENTS],
      ['serviceClass', SERVICE_CLASSES],
      ['taskStatus', TASK_STATUSES],
      ['reviewPolicy', REVIEW_POLICIES],
      ['reviewOutcome', REVIEW_OUTCOMES],
      ['interpretationStatus', INTERPRETATION_STATUSES],
      ['polarity', KNOWLEDGE_POLARITIES],
      ['negativeType', NEGATIVE_KINDS],
      ['termStatus', TERM_STATUSES],
      ['focusHorizon', FOCUS_HORIZONS],
    ] as const;

    for (const toolName of ['publish_knowledge', 'triage_wiki_note']) {
      const schema = properties(toolName);
      for (const [field, expected] of common) expectEnum(schema, field, expected);
    }
  });

  test('keeps workflow-specific schemas aligned with canonical vocabularies', () => {
    expectEnum(properties('clarify_wiki_note'), 'disposition', CLARIFY_DISPOSITIONS);

    const review = properties('review_wiki_note');
    expectEnum(review, 'reviewOutcome', REVIEW_OUTCOMES);
    expectEnum(review, 'nextLifecycle', LIFECYCLES);
    expect(review.reviewChecks?.items?.enum).toEqual([...REVIEW_CHECKS]);

    expectEnum(properties('record_wiki_recall'), 'recallQuality', RECALL_QUALITIES);

    const issue = properties('resolve_wiki_issue');
    expectEnum(issue, 'resolutionStatus', ISSUE_RESOLUTION_STATUSES);
    expectEnum(issue, 'retrospectiveStatus', ISSUE_RETROSPECTIVE_STATUSES);
  });
});
