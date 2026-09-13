import { COMPILATION_OPERATIONS } from './compilation-policy.js';
import { getFidelityTools } from './fidelity-tools.js';
/** Dynamic registration only. These arguments cannot approve processing or runtime access. */
export function getCompilationTools() {
    const text = (maxLength) => ({ type: 'string', maxLength });
    const fidelity = getFidelityTools()[0].inputSchema.properties;
    const fact = fidelity.facts.items;
    const evidence = { type: 'object', additionalProperties: false, required: ['query', 'decision', 'facts', 'coverage'], properties: {
            rationale: { type: 'object', additionalProperties: false, required: ['constraints', 'rejectedAlternatives', 'failureConditions'],
                description: 'Attributed agent analysis only. Record actual constraints and rejected alternatives; never invent user decisions or consent.', properties: {
                    constraints: { type: 'array', maxItems: 8, items: text(300) }, failureConditions: { type: 'array', maxItems: 8, items: text(300) },
                    rejectedAlternatives: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['option', 'reason'],
                            properties: { option: text(300), reason: text(300) } } },
                } },
            query: text(1000), decision: { type: 'string', enum: ['new_knowledge', 'extend_existing', 'already_covered', 'conflicting', 'uncertain'] },
            facts: { type: 'array', minItems: 1, maxItems: 32, items: { ...fact, required: [...fact.required, 'sourcePath'], properties: { ...fact.properties, sourcePath: text(400) } } },
            coverage: { type: 'array', minItems: 1, maxItems: 128, items: { type: 'object', additionalProperties: false, required: ['sourcePath', 'locator'],
                    properties: { sourcePath: text(400), locator: fact.properties.sourceLocator } } },
        } };
    const observation = { type: 'object', additionalProperties: false, required: ['kind', 'reason', 'coverage'], properties: {
            kind: { type: 'string', enum: ['source_only', 'already_covered'] }, reason: text(1000), query: text(1000),
            coverage: evidence.properties.coverage,
            matches: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', additionalProperties: false,
                    required: ['sourcePath', 'sourceLocator', 'knowledgePath', 'knowledgeLocator', 'semanticJudgment'], properties: {
                        sourcePath: text(400), sourceLocator: fact.properties.sourceLocator, knowledgePath: text(400), knowledgeLocator: fact.properties.sourceLocator,
                        semanticJudgment: { type: 'string', enum: ['covered', 'uncertain'] },
                    } } },
        } };
    return [{ name: 'manage_wiki_compilation',
            description: 'Diagnose or manage one host-approved, revision-pinned compilation. No host configuration means diagnosis only. Read does not expose draft bodies. Prepare pins explicit dependencies; submit stores a draft with preservation evidence OR a no-write observation, never both. source_only observations require index operation; already_covered requires synthesize, agent reason and paired source/member locators. They record verification, not publication or semantic truth. Check records actual verification; retry reconciles uncertain application before any new write. No model is started. Existing user edits, revoked authority and damaged history require review. Actual writing requires a separately verified host adapter; a client approval assertion is never permission.',
            inputSchema: { type: 'object', additionalProperties: false, properties: {
                    op: { type: 'string', enum: ['diagnose', 'prepare', 'read', 'submit', 'check', 'retry'], default: 'diagnose' },
                    requestId: text(100), projectId: text(100), operation: { type: 'string', enum: [...COMPILATION_OPERATIONS] },
                    inputs: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false,
                            required: ['path', 'expectedRevision', 'role'], properties: { path: text(400), expectedRevision: text(64),
                                role: { type: 'string', enum: ['source', 'member', 'concept', 'topic'] } } } },
                    outputPath: text(400), expectedOutputRevision: text(64), expectedJobRevision: text(64), content: text(24000), evidence, observation,
                    includeInspection: { type: 'boolean', description: 'Read only: return bounded pinned facts and checkpoints, not draft bodies or semantic guarantees.' },
                    inspectionCursor: { type: 'integer', minimum: 0, description: 'Read inspection continuation; nonzero cursors require expectedJobRevision from the previous page.' },
                    maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 4000 }, accessToken: text(4096),
                } } }];
}
