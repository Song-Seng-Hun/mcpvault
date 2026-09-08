import { guidanceText } from './guidance-runtime.js';
export function getResearchBridgeTools() {
    return [{ name: 'get_wiki_bridge_candidates',
            description: guidanceText('guid-da05844e9cf96782', 'Read at most two nearby connection leads and one unexplained distant-domain exploration material from a bounded authorized metadata window. Two inputs find possible mediators. Includes exact source revisions, prose locators and read actions; no relation, causality, novelty or evidence verdict is inferred. Interpret mappings/counterexamples and check external prior work on the host. Existing research work is resumed, parked inputs are omitted unless revisit=true. Read-only; no scheduler or external execution.'),
            inputSchema: { type: 'object', properties: {
                    focusPath: { type: 'string', maxLength: 512 }, comparePath: { type: 'string', maxLength: 512 },
                    query: { type: 'string', maxLength: 1000 }, expectedRevision: { type: 'string' }, compareRevision: { type: 'string' },
                    limit: { type: 'integer', minimum: 1, maximum: 3, default: 3 },
                    maxChars: { type: 'integer', minimum: 1200, maximum: 12000, default: 6000 }, semantic: { type: 'boolean', default: true },
                    projectId: { type: 'string', description: guidanceText('guid-1ac365c25b7c3150', 'Optional existing public project for a creation draft. A draft grants no permission; use existing work creation and claim APIs.') },
                    publicRequestId: { type: 'string', maxLength: 128, description: guidanceText('guid-3c6c2e6158069efb', 'During a participation run, pass its publicRequestId unchanged for the one selected workshop creation draft.') },
                    revisit: { type: 'boolean', default: false, description: guidanceText('guid-6839a256b8cfe018', 'Explicitly reconsider unchanged parked/completed research; never silently recreate its task.') },
                    accessToken: { type: 'string' }, prettyPrint: { type: 'boolean', default: false },
                }, required: ['focusPath'] },
        }];
}
