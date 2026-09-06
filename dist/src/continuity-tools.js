const accessToken = { type: 'string', description: 'Token from login_scope; work state is private to this model or agent scope.' };
const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
export const CONTINUITY_MUTATING_TOOLS = ['save_work_state'];
export function getContinuityTools() {
    return [
        {
            name: 'save_work_state',
            description: 'Save a compact private resume checkpoint in this authenticated model or agent scope. Use before a context limit, handoff, session end, interrupted multi-note edit, or pause in a MOC learning path. learningProgress accepts only the MOC, order, and last completed entry; the server snapshots bounded path revisions and continuity.resume detects drift. pendingEdits preserves revision guards and researchTrail preserves short findings. Returned revision identifies this save; compare with continuity.resume and inspect intervening edits before saving again. Never store passwords, tokens, note bodies, prompts, or hidden reasoning.',
            inputSchema: { type: 'object', properties: {
                    topic: { type: 'string', description: 'Short name of the work in progress' },
                    summary: { type: 'string', description: 'What has been established so far' },
                    nextAction: { type: 'string', description: 'The first concrete action the next session should take' },
                    openQuestions: { type: 'array', items: { type: 'string' }, description: 'At most 20 unresolved questions' },
                    focusQuestions: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Private top-of-mind questions for the next session' },
                    focusProjects: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Private top-of-mind projects or outcomes' },
                    focusNotes: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Private notes/links to inspect first' },
                    pendingEdits: { type: 'array', maxItems: 20, description: 'Revision guards for interrupted edits; this never reserves or locks a note', items: { type: 'object', properties: { path: { type: 'string', maxLength: 500 }, expectedRevision: { type: 'string', maxLength: 200 }, endpointId: { type: 'string', maxLength: 120 }, purpose: { type: 'string', maxLength: 500 } }, required: ['path', 'expectedRevision', 'endpointId'] } },
                    researchTrail: { type: 'array', maxItems: 20, description: 'Private compact investigation trail. Store only short conclusions and revision-stamped paths; never raw prompts, bodies, secrets, or hidden reasoning.', items: { type: 'object', properties: { kind: { type: 'string', enum: ['query', 'read', 'finding', 'decision'] }, summary: { type: 'string', maxLength: 500 }, path: { type: 'string', maxLength: 500 }, revision: { type: 'string', maxLength: 200 } }, required: ['kind', 'summary'] } },
                    learningProgress: { type: 'object', description: 'Optional private progress through one visible MOC. The server recomputes and snapshots the path; do not copy note bodies.', properties: { rootPath: { type: 'string', maxLength: 500, description: 'MOC path returned by wiki.learning_path' }, order: { type: 'string', enum: ['authored', 'recommended'], default: 'authored' }, maxDepth: { type: 'integer', minimum: 0, maximum: 6, default: 2 }, completedThrough: { type: 'string', maxLength: 500, description: 'Last fully read path from the selected order; omit before the first entry' } }, required: ['rootPath'] },
                    references: { type: 'array', items: { type: 'string' }, description: 'Note paths or scope URIs to revisit' },
                    cursors: { type: 'object', description: 'Small notification/comment/message cursors for incremental resumption' },
                    expectedRevision: { type: 'string', description: 'Revision returned by the prior checkpoint read; prevents stale overwrites' },
                    accessToken, prettyPrint,
                }, required: ['topic', 'summary', 'nextAction', 'accessToken'] },
        },
        {
            name: 'resume_work_state',
            description: 'Read the private resume checkpoint for the authenticated model or agent. maxChars caps the whole JSON response including Properties and pretty indentation. Learning progress is revalidated before a next unread note is returned. Truncated metadata arrays contain whole ordered-prefix entries, never shortened edit guards; omitted fields are not empty state. Follow nextAction for source lines or a larger resume budget. Raw checkpoint lines are historical data, not validated learning instructions; when canResume=false, use continuity.resume before advancing. Returns exists=false when no checkpoint has been saved.',
            inputSchema: { type: 'object', properties: { maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 6000, description: 'Hard total JSON response budget, including metadata and pretty indentation' }, accessToken, prettyPrint }, required: ['accessToken'] },
        },
    ];
}
