import { guidanceError } from './guidance-runtime.js';
import { isModerationHidden } from './moderation-policy.js';
/** Keep the original response and guards intact; an optional link is the first
 * thing omitted at the response ceiling. No draft text is ever requested. */
export async function attachExplanationHint(params) {
    const guards = new Map(params.guards.map(g => [g.path, g.revision]));
    guards.set(params.target.path, params.target.revision);
    const watched = new Set([...guards.keys()].map(path => params.fs.noteChangeIdentity(path)));
    let changed = false;
    const dispose = params.fs.observeNoteChanges(path => { if (watched.has(params.fs.noteChangeIdentity(path)))
        changed = true; });
    try {
        for (const [path, revision] of guards) {
            const note = (await params.fs.readNoteMetadata([path], params.admitted, { fresh: true, strict: true, maxBytes: 8 * 1024 * 1024 }))[0];
            if (!note || note.revision !== revision || isModerationHidden(note.frontmatter))
                throw guidanceError(new Error('Original reading context changed; retry'), 'guid-a224c80ed8a87d35');
        }
        const action = await params.approvedAction();
        if (changed || [...guards.keys()].some(path => !params.admitted(path)))
            throw guidanceError(new Error('Original reading context changed; retry'), 'guid-a224c80ed8a87d35');
        if (!action)
            return params.result;
        const result = { ...params.result, explanationAction: action };
        return JSON.stringify(result, null, params.prettyPrint ? 2 : undefined).length <= params.maxChars ? result : params.result;
    }
    finally {
        dispose();
    }
}
