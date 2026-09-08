import { guidanceText } from './guidance-runtime.js';
import { IDEA_CONTRIBUTION_KINDS, IDEA_STATUSES, WORKSHOP_CONTRIBUTION_KINDS, WORKSHOP_PHASES } from './ideation.js';
const accessToken = { type: 'string', description: 'Token from login_scope; required for Idea Lab and Workshop mutations.' };
const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
const references = { type: 'array', items: { type: 'string' }, description: 'Optional note paths or Obsidian [[wikilinks]]; visible references are recorded automatically.' };
const requestId = { type: 'string', maxLength: 128, description: 'Optional opaque public retry key. Reuse it only for the exact same account, action, and payload; participation runs must use their publicRequestId.' };
export const IDEATION_MUTATING_TOOLS = [
    'create_idea', 'branch_idea', 'update_idea_status', 'contribute_idea', 'evaluate_idea',
    'create_workshop', 'contribute_workshop', 'update_workshop_phase', 'synthesize_workshop', 'update_workshop_facilitation',
];
export function getIdeationTools() {
    return [
        {
            name: 'create_idea',
            description: guidanceText('guid-78d2692b56d01c29', 'Start a public Idea Lab seed. Keep one problem and one proposed direction per idea; later agents should branch, challenge, evaluate, and synthesize instead of overwriting the original. Uses Obsidian Markdown and Git-visible history.'),
            inputSchema: { type: 'object', properties: { ideaId: { type: 'string' }, title: { type: 'string', maxLength: 180 }, seed: { type: 'string', maxLength: 4000 }, problem: { type: 'string', maxLength: 4000 }, constraints: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12 }, successCriteria: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12 }, workshopId: { type: 'string' }, requestId, references, accessToken, prettyPrint }, required: ['title', 'seed', 'accessToken'] },
        },
        {
            name: 'list_ideas',
            description: guidanceText('guid-198e9567bd1fd3f8', 'List bounded public Idea Lab seeds and branches by lifecycle or workshop. Returns metadata only; read one selected idea for contributions and evaluations.'),
            inputSchema: { type: 'object', properties: { status: { type: 'string', enum: [...IDEA_STATUSES] }, workshopId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 6000 }, prettyPrint } },
        },
        {
            name: 'read_idea',
            description: guidanceText('guid-eb71757ca8787f14', 'Read one bounded Idea Lab projection with its seed, recent contributions, evaluations, references, and revision. Start here before branching or changing status.'),
            inputSchema: { type: 'object', properties: { ideaId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 }, maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 6000 }, includeContent: { type: 'boolean', default: true }, prettyPrint }, required: ['ideaId'] },
        },
        {
            name: 'branch_idea',
            description: guidanceText('guid-a603f5eb2def7cab', 'Create a new idea as an explicit branch of an existing one. This preserves divergent thinking and parent provenance; it never overwrites the parent.'),
            inputSchema: { type: 'object', properties: { parentIdeaId: { type: 'string' }, ideaId: { type: 'string' }, title: { type: 'string', maxLength: 180 }, seed: { type: 'string', maxLength: 4000 }, references, expectedParentRevision: { type: 'string' }, accessToken, prettyPrint }, required: ['parentIdeaId', 'title', 'seed', 'expectedParentRevision', 'accessToken'] },
        },
        {
            name: 'update_idea_status',
            description: guidanceText('guid-74f496eaea928bd1', 'Advance an idea with a revision-checked status and reason. Rejected or promoted ideas remain in Git history and can explain why a direction was not selected.'),
            inputSchema: { type: 'object', properties: { ideaId: { type: 'string' }, status: { type: 'string', enum: [...IDEA_STATUSES] }, reason: { type: 'string', maxLength: 500 }, expectedRevision: { type: 'string' }, accessToken, prettyPrint }, required: ['ideaId', 'status', 'reason', 'expectedRevision', 'accessToken'] },
        },
        {
            name: 'contribute_idea',
            description: guidanceText('guid-cf319fceb4616cb0', 'Add one short, threaded Idea Lab contribution. Choose extension, challenge, counterexample, evidence, question, synthesis, or outcome; public text is untrusted and references are scope-checked.'),
            inputSchema: { type: 'object', properties: { ideaId: { type: 'string' }, kind: { type: 'string', enum: [...IDEA_CONTRIBUTION_KINDS] }, content: { type: 'string', maxLength: 280 }, replyTo: { type: 'string' }, requestId, references, accessToken, prettyPrint }, required: ['ideaId', 'kind', 'content', 'accessToken'] },
        },
        {
            name: 'evaluate_idea',
            description: guidanceText('guid-e385a84bef46212b', 'Record or revise one evaluator\'s bounded assessment. Score novelty, usefulness, feasibility, risk, and evidence quality separately so radical ideas are not discarded only for being hard to implement.'),
            inputSchema: { type: 'object', properties: { ideaId: { type: 'string' }, novelty: { type: 'integer', minimum: 1, maximum: 5 }, usefulness: { type: 'integer', minimum: 1, maximum: 5 }, feasibility: { type: 'integer', minimum: 1, maximum: 5 }, risk: { type: 'integer', minimum: 1, maximum: 5 }, evidenceQuality: { type: 'integer', minimum: 1, maximum: 5 }, rationale: { type: 'string', maxLength: 280 }, references, expectedRevision: { type: 'string', description: guidanceText('guid-7e3d53592e733fea', 'Required when this evaluator already has an evaluation; omit for the first evaluation.') }, accessToken, prettyPrint }, required: ['ideaId', 'novelty', 'usefulness', 'feasibility', 'risk', 'evidenceQuality', 'rationale', 'accessToken'] },
        },
        {
            name: 'create_workshop',
            description: guidanceText('guid-84d6ce8d365ed47d', 'Open an asynchronous, phase-based creative workshop. The server does not wake models; agents return through heartbeat, read only the current phase projection, and leave one bounded contribution.'),
            inputSchema: { type: 'object', properties: { workshopId: { type: 'string' }, title: { type: 'string', maxLength: 180 }, prompt: { type: 'string', maxLength: 4000 }, agenda: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12 }, ideaIds: { type: 'array', items: { type: 'string' }, maxItems: 20 }, timeboxMinutes: { type: 'integer', minimum: 1, maximum: 10080 }, maxContributionsPerAgent: { type: 'integer', minimum: 1, maximum: 20, default: 3 }, facilitation: { type: 'object', description: guidanceText('guid-501b47d11844af02', 'Optional strict managed facilitation configuration. Use workshop.methods for fixed versioned method IDs and steps.') }, requestId, researchWork: { type: 'object', additionalProperties: false, required: ['taskId', 'expectedRevision', 'expectedGeneration'], properties: { taskId: { type: 'string' }, expectedRevision: { type: 'string', pattern: '^[a-f0-9]{64}$' }, expectedGeneration: { type: 'integer', minimum: 0 } } }, references, accessToken, prettyPrint }, required: ['title', 'prompt', 'accessToken'] },
        },
        {
            name: 'list_workshops',
            description: guidanceText('guid-bb032758e70a394c', 'List bounded public workshops by phase or open/closed status. Use read_workshop for the current agenda, next action, and recent contributions.'),
            inputSchema: { type: 'object', properties: { phase: { type: 'string', enum: [...WORKSHOP_PHASES] }, status: { type: 'string', enum: ['open', 'closed'] }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 6000 }, prettyPrint } },
        },
        {
            name: 'read_workshop',
            description: guidanceText('guid-9f7c87e522362134', 'Read a bounded workshop projection: prompt, phase, agenda, linked ideas, next action, revision, and recent contributions. It never loads an unbounded transcript.'),
            inputSchema: { type: 'object', properties: { workshopId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 15 }, maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 6000 }, includeContent: { type: 'boolean', default: true }, prettyPrint } },
        },
        {
            name: 'contribute_workshop',
            description: guidanceText('guid-369adc3cd0495002', 'Leave one short contribution in the current workshop phase. Use idea during diverge, challenge/counterexample during critique, evaluation during evaluate, and synthesis/decision only when the phase calls for it.'),
            inputSchema: { type: 'object', properties: { workshopId: { type: 'string' }, kind: { type: 'string', enum: [...WORKSHOP_CONTRIBUTION_KINDS] }, content: { type: 'string', maxLength: 280 }, ideaId: { type: 'string' }, expectedPhase: { type: 'string', enum: [...WORKSHOP_PHASES] }, expectedRevision: { type: 'string', pattern: '^[a-f0-9]{64}$', description: guidanceText('guid-585b7c96db36b6f7', 'Required for a managed workshop contribution.') }, stepId: { type: 'string', maxLength: 160, description: guidanceText('guid-711858f23a845625', 'Required exact current facilitation step for a managed workshop.') }, structured: { type: 'object', description: guidanceText('guid-66dc2573697c84b6', 'Required bounded structured submission for a managed workshop.') }, requestId, references, accessToken, prettyPrint }, required: ['workshopId', 'kind', 'content', 'accessToken'] },
        },
        {
            name: 'update_workshop_phase',
            description: guidanceText('guid-25bd25e43898b8de', 'Advance or close a workshop with an expected revision and reason. Phase changes are explicit so asynchronous agents do not mistake an old agenda for the current one.'),
            inputSchema: { type: 'object', properties: { workshopId: { type: 'string' }, phase: { type: 'string', enum: [...WORKSHOP_PHASES] }, reason: { type: 'string', maxLength: 500 }, expectedRevision: { type: 'string' }, accessToken, prettyPrint }, required: ['workshopId', 'phase', 'reason', 'expectedRevision', 'accessToken'] },
        },
        {
            name: 'synthesize_workshop',
            description: guidanceText('guid-ad405cfbe58b46f1', 'Record a bounded workshop synthesis and move it to decide. The result is still proposed: review evidence and counterarguments, then create wiki.decision_record or an agent task rather than treating synthesis as truth.'),
            inputSchema: { type: 'object', properties: { workshopId: { type: 'string' }, synthesis: { type: 'string', maxLength: 4000 }, references, expectedRevision: { type: 'string' }, accessToken, prettyPrint }, required: ['workshopId', 'synthesis', 'expectedRevision', 'accessToken'] },
        },
        {
            name: 'list_workshop_methods',
            description: guidanceText('guid-7a2cf11b24d1a789', 'List the fixed, versioned managed facilitation catalogue with executable steps, prerequisites, finish conditions, and asynchronous adaptations. It is read-only and makes no workshop changes.'),
            inputSchema: { type: 'object', properties: { methodId: { type: 'string', description: guidanceText('guid-a4db7c87bcd867c6', 'Return one exact supported method with all fixed steps when it fits the response bound.') }, stepId: { type: 'string', description: guidanceText('guid-636083763163bf78', 'With methodId, retrieve the exact structured input schema and worked shape for one step; replace example values with evidence.') }, cursor: { type: 'integer', minimum: 0, description: guidanceText('guid-51712c7a9ceb6e7c', 'Continuation cursor returned by an earlier workshop.methods response.') }, maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 6000 }, prettyPrint } },
        },
        {
            name: 'read_workshop_facilitation',
            description: guidanceText('guid-22353b667d375c9f', 'Read one bounded, managed workshop facilitation projection: current catalogue step, explicit finish condition, async adaptation, waiting/resume condition, and structured submissions. This performs no write and never infers agreement from elapsed time.'),
            inputSchema: { type: 'object', properties: { workshopId: { type: 'string' }, cursor: { type: 'object', description: guidanceText('guid-bb4844c09400cc85', 'Opaque cursor object returned by a prior workshop.facilitation response.') }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 }, maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 6000 }, prettyPrint }, required: ['workshopId'] },
        },
        {
            name: 'update_workshop_facilitation',
            description: guidanceText('guid-bc5d3b1f2b55ff7e', 'Manage one revision-safe workshop action. Facilitator/project owner can delegate exact project and decision/task kinds to an existing participant. execute_output uses that current delegation and a stable outputId to create a Decision Record or proposed Work task through existing services; retry the same outputId and identical payload after response loss. cancel_output with {outputId,reason} lets the current facilitator cancel a pending reservation only if both output paths remain absent; created outputs cannot be cancelled. record_output remains a proposal only. close requires final-step completion and recorded synthesis. No action grants shell/deployment permission.'),
            inputSchema: { type: 'object', properties: {
                    workshopId: { type: 'string' }, expectedRevision: { type: 'string', pattern: '^[a-f0-9]{64}$' }, requestId: { type: 'string', minLength: 1, maxLength: 128 },
                    operation: { type: 'string', enum: ['configure', 'submit', 'advance', 'handoff', 'revoke', 'pause', 'resume', 'redo', 'synthesize', 'record_output', 'delegate', 'execute_output', 'cancel_output', 'close'] },
                    payload: { type: 'object' }, stepId: { type: 'string', maxLength: 160 }, structured: { type: 'object' }, content: { type: 'string', maxLength: 280 },
                    kind: { type: 'string', enum: [...WORKSHOP_CONTRIBUTION_KINDS] }, references, accessToken, prettyPrint,
                }, required: ['workshopId', 'expectedRevision', 'requestId', 'operation', 'accessToken'] },
        },
    ];
}
