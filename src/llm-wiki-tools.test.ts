import { describe, expect, test } from 'vitest';
import {
  ANSWER_PACKET_INTENTS,
  CAPTURE_SOURCES,
  CATALOG_ORDERS,
  CLAIM_ROLES,
  CLAIM_STATUSES,
  CLARIFY_DISPOSITIONS,
  CONFIDENCE_LEVELS,
  EXECUTION_LEVELS,
  FOCUS_HORIZONS,
  INTERPRETATION_STATUSES,
  ISSUE_KINDS,
  ISSUE_RESOLUTION_STATUSES,
  ISSUE_RETROSPECTIVE_STATUSES,
  KNOWLEDGE_POLARITIES,
  KNOWLEDGE_ROLES,
  KNOWLEDGE_STATUSES,
  LIFECYCLES,
  NEGATIVE_KINDS,
  NOTE_KINDS,
  RECALL_QUALITIES,
  RECALL_REPAIR_STATUSES,
  RETENTION_EVENTS,
  RETENTION_POLICIES,
  REVIEW_CHECKS,
  REVIEW_OUTCOMES,
  REVIEW_POLICIES,
  SERVICE_CLASSES,
  SOURCE_TRUST_LEVELS,
  TASK_STATUSES,
  TEMPORAL_VALIDITY_STATES,
  TERM_STATUSES,
  WIKI_PROJECTION_VIEWS,
  getOrganizationPropertyContract,
} from './organization.js';
import { getLlmWikiTools } from './llm-wiki-tools.js';

interface SchemaProperty {
  type?: string;
  description?: string;
  enum?: unknown[];
  items?: SchemaProperty;
  properties?: SchemaProperties;
}
type SchemaProperties = Record<string, SchemaProperty>;

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

    const clearInapplicable = properties('triage_wiki_note').clearInapplicable;
    expect(clearInapplicable?.type).toBe('boolean');
    expect(clearInapplicable?.description).toContain('MCP-managed Properties');
    expect(clearInapplicable?.description).toContain('Custom Properties');
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

  test('keeps retrieval, provenance, and epistemic schemas aligned with runtime vocabularies', () => {
    expectEnum(properties('ingest_source'), 'trustLevel', SOURCE_TRUST_LEVELS);
    expectEnum(properties('capture_wiki_note'), 'capturedFrom', CAPTURE_SOURCES);

    const publish = properties('publish_knowledge');
    expectEnum(publish, 'confidence', CONFIDENCE_LEVELS);
    expectEnum(publish, 'status', KNOWLEDGE_STATUSES);
    expect(publish.claims?.items).toBeDefined();
    const claimProperties = publish.claims?.items?.properties;
    expect(claimProperties?.confidence?.enum).toEqual([...CONFIDENCE_LEVELS]);
    expect(claimProperties?.status?.enum).toEqual([...CLAIM_STATUSES]);
    expect(claimProperties?.claimRole?.enum).toEqual([...CLAIM_ROLES]);

    expectEnum(properties('get_wiki_catalog'), 'validity', TEMPORAL_VALIDITY_STATES);
    expectEnum(properties('get_wiki_catalog'), 'orderBy', CATALOG_ORDERS);
    expectEnum(properties('get_wiki_answer_packet'), 'intent', ANSWER_PACKET_INTENTS);
    expectEnum(properties('get_wiki_context_pack'), 'intent', ANSWER_PACKET_INTENTS);
    expectEnum(properties('read_wiki_projection'), 'view', WIKI_PROJECTION_VIEWS);
    expectEnum(properties('record_wiki_recall'), 'repairStatus', RECALL_REPAIR_STATUSES);
    expectEnum(properties('report_wiki_issue'), 'kind', ISSUE_KINDS);

    const nextActions = properties('get_wiki_next_actions');
    expectEnum(nextActions, 'energy', EXECUTION_LEVELS);
    expectEnum(nextActions, 'effort', EXECUTION_LEVELS);

    expectEnum(properties('get_wiki_canvas_view'), 'mode', ['auto', 'moc', 'neighborhood']);
    expectEnum(properties('export_wiki_canvas'), 'mode', ['auto', 'moc', 'neighborhood']);
    expect(properties('get_wiki_canvas_health').maxChars?.type).toBe('integer');
    const canvasExport = tools.get('export_wiki_canvas')!.inputSchema as { required?: string[] };
    expect(canvasExport.required).toEqual(expect.arrayContaining(['path', 'expectedRevision']));
  });

  test('derives managed Property schemas from the public contract', () => {
    const contracts = new Map(getOrganizationPropertyContract().map(contract => [contract.name, contract]));
    const bindings = [
      ['ingest_source', 'trustLevel', 'trust_level'],
      ['capture_wiki_note', 'capturedFrom', 'captured_from'],
      ['clarify_wiki_note', 'disposition', 'triage_disposition'],
      ['publish_knowledge', 'status', 'knowledge_status'],
      ['publish_knowledge', 'noteKind', 'note_kind'],
      ['publish_knowledge', 'polarity', 'knowledge_polarity'],
      ['publish_knowledge', 'negativeType', 'negative_type'],
      ['review_wiki_note', 'reviewChecks', 'review_checks'],
      ['record_wiki_recall', 'repairStatus', 'recall_repair_status'],
      ['resolve_wiki_issue', 'resolutionStatus', 'issue_resolution_status'],
    ] as const;
    const schemaType = { text: 'string', list: 'array', number: 'number', boolean: 'boolean', object: 'object' } as const;

    for (const [toolName, field, contractName] of bindings) {
      const contract = contracts.get(contractName)!;
      const schema = properties(toolName)[field]!;
      expect(schema.type, `${toolName}.${field}`).toBe(schemaType[contract.type]);
      expect(String(schema.description), `${toolName}.${field}`).toContain(contract.description);
      if (contract.allowed) {
        const actual = contract.type === 'list' ? schema.items?.enum : schema.enum;
        expect(actual, `${toolName}.${field}`).toEqual([...contract.allowed]);
      }
    }
  });
});
