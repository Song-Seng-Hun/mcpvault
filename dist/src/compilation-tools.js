import { COMPILATION_OPERATIONS } from './compilation-policy.js';
/** Dynamic registration only. These arguments cannot approve processing or runtime access. */
export function getCompilationTools() {
    const text = (maxLength) => ({ type: 'string', maxLength });
    return [{ name: 'manage_wiki_compilation',
            description: 'Diagnose or manage one host-approved, revision-pinned compilation. No host configuration means diagnosis only. Read does not expose draft bodies. Prepare pins explicit dependencies; submit stores one generated draft; check records actual verification; retry reconciles uncertain application before any new write. No model is started. Existing user edits, revoked authority and damaged history require review. Actual writing requires a separately verified host adapter; a client approval assertion is never permission.',
            inputSchema: { type: 'object', additionalProperties: false, properties: {
                    op: { type: 'string', enum: ['diagnose', 'prepare', 'read', 'submit', 'check', 'retry'], default: 'diagnose' },
                    requestId: text(100), projectId: text(100), operation: { type: 'string', enum: [...COMPILATION_OPERATIONS] },
                    inputs: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false,
                            required: ['path', 'expectedRevision', 'role'], properties: { path: text(400), expectedRevision: text(64),
                                role: { type: 'string', enum: ['source', 'member', 'concept', 'topic'] } } } },
                    outputPath: text(400), expectedOutputRevision: text(64), expectedJobRevision: text(64), content: text(24000),
                    maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 4000 }, accessToken: text(4096),
                } } }];
}
