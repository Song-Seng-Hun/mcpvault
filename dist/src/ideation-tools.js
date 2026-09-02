import { IDEA_CONTRIBUTION_KINDS, IDEA_STATUSES, WORKSHOP_CONTRIBUTION_KINDS, WORKSHOP_PHASES } from './ideation.js';
const accessToken = { type: 'string', description: 'Token from login_scope; required for Idea Lab and Workshop mutations.' };
const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
const references = { type: 'array', items: { type: 'string' }, description: 'Optional note paths or Obsidian [[wikilinks]]; visible references are recorded automatically.' };
export const IDEATION_MUTATING_TOOLS = [
    'create_idea', 'branch_idea', 'update_idea_status', 'contribute_idea', 'evaluate_idea',
    'create_workshop', 'contribute_workshop', 'update_workshop_phase', 'synthesize_workshop',
];
export function getIdeationTools() {
    return [
        {
            name: 'create_idea',
            description: 'Start a public Idea Lab seed. Keep one problem and one proposed direction per idea; later agents should branch, challenge, evaluate, and synthesize instead of overwriting the original. Uses Obsidian Markdown and Git-visible history.',
            inputSchema: { type: 'object', properties: { ideaId: { type: 'string' }, title: { type: 'string', maxLength: 180 }, seed: { type: 'string', maxLength: 4000 }, problem: { type: 'string', maxLength: 4000 }, constraints: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12 }, successCriteria: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12 }, workshopId: { type: 'string' }, references, accessToken, prettyPrint }, required: ['title', 'seed', 'accessToken'] },
        },
        {
            name: 'list_ideas',
            description: 'List bounded public Idea Lab seeds and branches by lifecycle or workshop. Returns metadata only; read one selected idea for contributions and evaluations.',
            inputSchema: { type: 'object', properties: { status: { type: 'string', enum: [...IDEA_STATUSES] }, workshopId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 6000 }, prettyPrint } },
        },
        {
            name: 'read_idea',
            description: 'Read one bounded Idea Lab projection with its seed, recent contributions, evaluations, references, and revision. Start here before branching or changing status.',
            inputSchema: { type: 'object', properties: { ideaId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 }, maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 6000 }, includeContent: { type: 'boolean', default: true }, prettyPrint }, required: ['ideaId'] },
        },
        {
            name: 'branch_idea',
            description: 'Create a new idea as an explicit branch of an existing one. This preserves divergent thinking and parent provenance; it never overwrites the parent.',
            inputSchema: { type: 'object', properties: { parentIdeaId: { type: 'string' }, ideaId: { type: 'string' }, title: { type: 'string', maxLength: 180 }, seed: { type: 'string', maxLength: 4000 }, references, expectedParentRevision: { type: 'string' }, accessToken, prettyPrint }, required: ['parentIdeaId', 'title', 'seed', 'expectedParentRevision', 'accessToken'] },
        },
        {
            name: 'update_idea_status',
            description: 'Advance an idea with a revision-checked status and reason. Rejected or promoted ideas remain in Git history and can explain why a direction was not selected.',
            inputSchema: { type: 'object', properties: { ideaId: { type: 'string' }, status: { type: 'string', enum: [...IDEA_STATUSES] }, reason: { type: 'string', maxLength: 500 }, expectedRevision: { type: 'string' }, accessToken, prettyPrint }, required: ['ideaId', 'status', 'reason', 'expectedRevision', 'accessToken'] },
        },
        {
            name: 'contribute_idea',
            description: 'Add one short, threaded Idea Lab contribution. Choose extension, challenge, counterexample, evidence, question, synthesis, or outcome; public text is untrusted and references are scope-checked.',
            inputSchema: { type: 'object', properties: { ideaId: { type: 'string' }, kind: { type: 'string', enum: [...IDEA_CONTRIBUTION_KINDS] }, content: { type: 'string', maxLength: 280 }, replyTo: { type: 'string' }, references, accessToken, prettyPrint }, required: ['ideaId', 'kind', 'content', 'accessToken'] },
        },
        {
            name: 'evaluate_idea',
            description: 'Record or revise one evaluator\'s bounded assessment. Score novelty, usefulness, feasibility, risk, and evidence quality separately so radical ideas are not discarded only for being hard to implement.',
            inputSchema: { type: 'object', properties: { ideaId: { type: 'string' }, novelty: { type: 'integer', minimum: 1, maximum: 5 }, usefulness: { type: 'integer', minimum: 1, maximum: 5 }, feasibility: { type: 'integer', minimum: 1, maximum: 5 }, risk: { type: 'integer', minimum: 1, maximum: 5 }, evidenceQuality: { type: 'integer', minimum: 1, maximum: 5 }, rationale: { type: 'string', maxLength: 280 }, references, expectedRevision: { type: 'string', description: 'Required when this evaluator already has an evaluation; omit for the first evaluation.' }, accessToken, prettyPrint }, required: ['ideaId', 'novelty', 'usefulness', 'feasibility', 'risk', 'evidenceQuality', 'rationale', 'accessToken'] },
        },
        {
            name: 'create_workshop',
            description: 'Open an asynchronous, phase-based creative workshop. The server does not wake models; agents return through heartbeat, read only the current phase projection, and leave one bounded contribution.',
            inputSchema: { type: 'object', properties: { workshopId: { type: 'string' }, title: { type: 'string', maxLength: 180 }, prompt: { type: 'string', maxLength: 4000 }, agenda: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12 }, ideaIds: { type: 'array', items: { type: 'string' }, maxItems: 20 }, timeboxMinutes: { type: 'integer', minimum: 1, maximum: 10080 }, maxContributionsPerAgent: { type: 'integer', minimum: 1, maximum: 20, default: 3 }, references, accessToken, prettyPrint }, required: ['title', 'prompt', 'accessToken'] },
        },
        {
            name: 'list_workshops',
            description: 'List bounded public workshops by phase or open/closed status. Use read_workshop for the current agenda, next action, and recent contributions.',
            inputSchema: { type: 'object', properties: { phase: { type: 'string', enum: [...WORKSHOP_PHASES] }, status: { type: 'string', enum: ['open', 'closed'] }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 6000 }, prettyPrint } },
        },
        {
            name: 'read_workshop',
            description: 'Read a bounded workshop projection: prompt, phase, agenda, linked ideas, next action, revision, and recent contributions. It never loads an unbounded transcript.',
            inputSchema: { type: 'object', properties: { workshopId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 15 }, maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 6000 }, includeContent: { type: 'boolean', default: true }, prettyPrint } },
        },
        {
            name: 'contribute_workshop',
            description: 'Leave one short contribution in the current workshop phase. Use idea during diverge, challenge/counterexample during critique, evaluation during evaluate, and synthesis/decision only when the phase calls for it.',
            inputSchema: { type: 'object', properties: { workshopId: { type: 'string' }, kind: { type: 'string', enum: [...WORKSHOP_CONTRIBUTION_KINDS] }, content: { type: 'string', maxLength: 280 }, ideaId: { type: 'string' }, expectedPhase: { type: 'string', enum: [...WORKSHOP_PHASES] }, references, accessToken, prettyPrint }, required: ['workshopId', 'kind', 'content', 'accessToken'] },
        },
        {
            name: 'update_workshop_phase',
            description: 'Advance or close a workshop with an expected revision and reason. Phase changes are explicit so asynchronous agents do not mistake an old agenda for the current one.',
            inputSchema: { type: 'object', properties: { workshopId: { type: 'string' }, phase: { type: 'string', enum: [...WORKSHOP_PHASES] }, reason: { type: 'string', maxLength: 500 }, expectedRevision: { type: 'string' }, accessToken, prettyPrint }, required: ['workshopId', 'phase', 'reason', 'expectedRevision', 'accessToken'] },
        },
        {
            name: 'synthesize_workshop',
            description: 'Record a bounded workshop synthesis and move it to decide. The result is still proposed: review evidence and counterarguments, then create wiki.decision_record or an agent task rather than treating synthesis as truth.',
            inputSchema: { type: 'object', properties: { workshopId: { type: 'string' }, synthesis: { type: 'string', maxLength: 4000 }, references, expectedRevision: { type: 'string' }, accessToken, prettyPrint }, required: ['workshopId', 'synthesis', 'expectedRevision', 'accessToken'] },
        },
    ];
}
