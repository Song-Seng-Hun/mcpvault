import { posix } from 'node:path';
import { isModerationHidden } from './moderation-policy.js';
import { ReferenceService } from './references.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import { parseWikiLink } from './wikilink/resolveWikiLink.js';
import { normalizeKnowledgeInvestigation } from './knowledge-investigation-model.js';
const BYTES = 8 * 1024 * 1024;
const UNAVAILABLE = 'Investigation inputs unavailable or changed; read current context and retry';
const plan = ({ result: _result, ...criteria }) => criteria;
const prose = (value) => [value.question, value.conditions, ...value.alternatives,
    ...value.decisionRules.flatMap(rule => [rule.observation, rule.consequence]), value.executionBoundary,
    ...(value.result ? [value.result.observed, value.result.interpretation, value.result.limitations] : [])];
function paths(access, container, principal) {
    const physical = (value) => {
        const expanded = value.startsWith('scope://') ? access.resolveExternalPath(value, principal) : value.replace(/\\/g, '/');
        if (posix.isAbsolute(expanded) || expanded.includes(':') || /[\u0000-\u001f\u007f]/.test(expanded))
            throw Error(UNAVAILABLE);
        const path = posix.normalize(expanded);
        if (path === '..' || path.startsWith('../') || !access.canAccessPhysicalPath(path, principal))
            throw Error(UNAVAILABLE);
        return path;
    };
    container = physical(container);
    const allowed = (path) => access.canAccessPhysicalPath(container, principal) && access.canAccessPhysicalPath(path, principal)
        && access.canReferenceFrom(container, path)
        && (!access.isCommunityPath(path) || access.isCommunityPath(container) || /^_scopes\//i.test(container));
    return { physical, allowed, container };
}
/** A result is a report against a saved plan, not permission to execute it. */
export async function prepareKnowledgeInvestigation(fs, access, value, container, existing, principal) {
    const investigation = normalizeKnowledgeInvestigation(value);
    const { physical, allowed, container: owner } = paths(access, container, principal);
    let previous;
    if (existing?.frontmatter.knowledge_investigation !== undefined)
        previous = normalizeKnowledgeInvestigation(existing.frontmatter.knowledge_investigation);
    for (const record of [investigation, previous])
        if (record)
            for (const target of record.targets) {
                const path = physical(target.path);
                if (!allowed(path))
                    throw Error(UNAVAILABLE);
                target.path = access.toPublicPath(path);
            }
    if (investigation.result) {
        if (!previous || JSON.stringify(plan(previous)) !== JSON.stringify(plan(investigation)))
            throw Error('Save the investigation plan first; result submission cannot change agreed criteria. Use a separate linked experiment for a changed plan.');
        const expected = previous.result?.planRevision ?? existing?.revision;
        if (investigation.result.planRevision !== expected)
            throw Error('Result planRevision must identify the saved plan revision');
    }
    else if (previous?.result)
        throw Error('Preserve the reported result; use a separate linked experiment for a new plan');
    const guards = new Map();
    const observe = async (path) => {
        if (!allowed(path) || path.toLowerCase() === owner.toLowerCase())
            throw Error(UNAVAILABLE);
        if (!guards.has(path.toLowerCase()) && guards.size >= 8)
            throw Error('Investigation may reference at most eight distinct related notes, including prose links');
        const meta = (await fs.readNoteMetadata([path], allowed, { fresh: true, strict: true, maxBytes: BYTES }))[0];
        if (!meta?.revision || isModerationHidden(meta.frontmatter))
            throw Error(UNAVAILABLE);
        const old = guards.get(path.toLowerCase());
        if (old && old.expectedRevision !== meta.revision)
            throw Error(UNAVAILABLE);
        guards.set(path.toLowerCase(), { path, expectedRevision: meta.revision });
        return meta;
    };
    try {
        const targetIdentities = new Set();
        for (const target of investigation.targets) {
            const path = physical(target.path);
            if (targetIdentities.has(path.toLowerCase()))
                throw Error(UNAVAILABLE);
            targetIdentities.add(path.toLowerCase());
            const meta = await observe(path);
            if (meta.frontmatter.llm_wiki_type !== 'knowledge' || (!investigation.result && meta.revision !== target.revision))
                throw Error(UNAVAILABLE);
            target.path = access.toPublicPath(path);
        }
        for (const evidence of investigation.result?.evidence || []) {
            const path = physical(evidence.path), meta = await observe(path);
            if (meta.revision !== evidence.revision)
                throw Error(UNAVAILABLE);
            evidence.path = access.toPublicPath(path);
        }
        const fields = prose(investigation), occurrences = fields.flatMap(field => extractObsidianLinkOccurrences(field));
        if (occurrences.length > 16)
            throw Error(UNAVAILABLE);
        for (const link of occurrences) {
            const raw = /^!?\[\[/.test(link.link) ? parseWikiLink(link.link.replace(/^!/, '')).document : link.target;
            const decoded = decodeURIComponent(raw).replace(/\\/g, '/');
            if (!allowed(physical(decoded.startsWith('.') ? posix.join(posix.dirname(owner), decoded) : decoded)))
                throw Error(UNAVAILABLE);
        }
        const refs = new ReferenceService(fs, access);
        for (const field of fields)
            for (const path of await refs.validateAndNormalize(undefined, owner, principal, field, { strictBodyLinks: true }))
                await observe(path);
    }
    catch {
        throw Error(UNAVAILABLE);
    }
    const assertAccess = () => { if (!allowed(owner) || [...guards.values()].some(guard => !allowed(guard.path)))
        throw Error(UNAVAILABLE); };
    assertAccess();
    return { investigation, guards: [...guards.values()], assertAccess };
}
/** Bounded metadata projection. Read progress and matching revisions are not truth. */
export async function inspectInvestigation(value, container, read, access, principal) {
    let investigation;
    try {
        investigation = normalizeKnowledgeInvestigation(value);
    }
    catch {
        return { state: 'invalid_record' };
    }
    const resultReported = Boolean(investigation.result);
    const unavailable = { state: 'inputs_unavailable', resultReported };
    try {
        const { physical, allowed } = paths(access, container, principal);
        let changedTarget, firstTarget, evidenceChanged = false;
        for (const target of investigation.targets) {
            const path = physical(target.path);
            if (!allowed(path))
                return unavailable;
            const current = await read(path);
            if (!current?.revision || isModerationHidden(current.frontmatter) || current.frontmatter.llm_wiki_type !== 'knowledge')
                return unavailable;
            firstTarget ??= current;
            if (current.revision !== target.revision)
                changedTarget ??= current;
        }
        for (const evidence of investigation.result?.evidence || []) {
            const path = physical(evidence.path);
            if (!allowed(path))
                return unavailable;
            const current = await read(path);
            if (!current?.revision || isModerationHidden(current.frontmatter))
                return unavailable;
            evidenceChanged ||= current.revision !== evidence.revision;
        }
        const next = changedTarget || firstTarget;
        return { state: changedTarget ? 'targets_changed' : evidenceChanged ? 'evidence_changed' : resultReported ? 'result_requires_review' : 'plan_recorded',
            resultReported, ...(investigation.result && { reportedOutcome: investigation.result.outcome }),
            nextAction: { endpointId: 'notes.read', arguments: { path: access.toPublicPath(next.path), expectedRevision: next.revision, maxChars: 3000 } },
            notice: 'Review the original claim using the saved plan, observed result and evidence. No automatic truth or review approval. Execution still requires user authorization.' };
    }
    catch {
        return unavailable;
    }
}
