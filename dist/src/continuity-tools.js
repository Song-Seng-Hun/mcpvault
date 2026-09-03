const accessToken = { type: 'string', description: 'Token from login_scope; work state is private to this model or agent scope.' };
const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
export const CONTINUITY_MUTATING_TOOLS = ['save_work_state'];
export function getContinuityTools() {
    return [
        {
            name: 'save_work_state',
            description: 'Save a compact private resume checkpoint in this authenticated model or agent scope. Use before a context limit, handoff, session end, or interrupted multi-note edit. pendingEdits preserves only endpoint/path/expectedRevision/purpose guards; re-read every path before resuming. Never store passwords, access tokens, note bodies, or sensitive prompt text.',
            inputSchema: { type: 'object', properties: {
                    topic: { type: 'string', description: 'Short name of the work in progress' },
                    summary: { type: 'string', description: 'What has been established so far' },
                    nextAction: { type: 'string', description: 'The first concrete action the next session should take' },
                    openQuestions: { type: 'array', items: { type: 'string' }, description: 'At most 20 unresolved questions' },
                    focusQuestions: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Private top-of-mind questions for the next session' },
                    focusProjects: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Private top-of-mind projects or outcomes' },
                    focusNotes: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Private notes/links to inspect first' },
                    pendingEdits: { type: 'array', maxItems: 20, description: 'Revision guards for interrupted edits; this never reserves or locks a note', items: { type: 'object', properties: { path: { type: 'string', maxLength: 500 }, expectedRevision: { type: 'string', maxLength: 200 }, endpointId: { type: 'string', maxLength: 120 }, purpose: { type: 'string', maxLength: 500 } }, required: ['path', 'expectedRevision', 'endpointId'] } },
                    references: { type: 'array', items: { type: 'string' }, description: 'Note paths or scope URIs to revisit' },
                    cursors: { type: 'object', description: 'Small notification/comment/message cursors for incremental resumption' },
                    expectedRevision: { type: 'string', description: 'Revision returned by the prior checkpoint read; prevents stale overwrites' },
                    accessToken, prettyPrint,
                }, required: ['topic', 'summary', 'nextAction', 'accessToken'] },
        },
        {
            name: 'resume_work_state',
            description: 'Read the private resume checkpoint for the authenticated model or agent. Returns a bounded summary, next action, cursors, and references; returns exists=false when no checkpoint has been saved.',
            inputSchema: { type: 'object', properties: { maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 6000 }, accessToken, prettyPrint }, required: ['accessToken'] },
        },
    ];
}
