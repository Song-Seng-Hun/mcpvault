import { guidanceError } from './guidance-runtime.js';
import { posix } from 'node:path';
import { FrontmatterHandler } from './frontmatter.js';
import { fingerprint } from './work-model.js';
import { isModerationHidden } from './moderation-policy.js';
import { ReferenceService } from './references.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import { normalizeKnowledgeInvestigation, normalizeInvestigationEvidence } from './knowledge-investigation-model.js';
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
export async function prepareKnowledgeInvestigation(fs, access, value, container, existing, principal, readMetadata) {
    const investigation = normalizeKnowledgeInvestigation(value);
    const refs = new ReferenceService(fs, access), read = readMetadata ?? refs.createMetadataReader(principal);
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
            throw guidanceError(Error('Save the investigation plan first; result submission cannot change agreed criteria. Use a separate linked experiment for a changed plan.'), 'guid-1820b8102bfa288d');
        const expected = previous.result?.planRevision ?? existing?.revision;
        if (investigation.result.planRevision !== expected)
            throw guidanceError(Error('Result planRevision must identify the saved plan revision'), 'guid-262914bbf2ddd747');
    }
    else if (previous?.result)
        throw guidanceError(Error('Preserve the reported result; use a separate linked experiment for a new plan'), 'guid-ca82eae7ad1e5b34');
    const guards = new Map();
    const observe = async (path) => {
        if (!allowed(path) || path.toLowerCase() === owner.toLowerCase())
            throw Error(UNAVAILABLE);
        if (!guards.has(path.toLowerCase()) && guards.size >= 8)
            throw guidanceError(Error('Investigation may reference at most eight distinct related notes, including prose links'), 'guid-724e69325898fd7d');
        const meta = await read(path, allowed);
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
        for (const path of await refs.validateBodyLinks(occurrences, owner, principal, value => {
            if (!allowed(physical(value)))
                throw Error(UNAVAILABLE);
        }))
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
// Review bookkeeping is not a new claim. Everything else, including claim
// wording/status, authored relations and body, invalidates this review basis.
const REVIEW_BOOKKEEPING = new Set(['review_basis_content_sha256', 'review_basis_links', 'review_basis_upstream',
    'last_review_outcome', 'last_reviewed_by', 'last_reviewed_at', 'last_reviewed_revision', 'last_review_trigger',
    'review_count', 'review_reopen_count', 'review_at', 'review_interval_days', 'review_note', 'review_checks',
    'review_open_items', 'review_investigation_evidence', 'claim_reviews', 'updated_by', 'updated_at']);
export function investigationReviewBasis(content, frontmatter) {
    return fingerprint({ content, frontmatter: Object.fromEntries(Object.entries(frontmatter).filter(([key]) => !REVIEW_BOOKKEEPING.has(key))) });
}
/** Extend the existing review write with bounded related-note guards, not a workflow. */
export async function writeInvestigationReview(fs, access, params, note, changes, claimId) {
    if (params.investigationEvidence === undefined)
        return fs.updateFrontmatterWithReceipt({ path: params.path, expectedRevision: params.expectedRevision, frontmatter: changes, merge: true });
    const ref = normalizeInvestigationEvidence(params.investigationEvidence);
    const { physical, allowed, container: target } = paths(access, params.path, params.principal);
    const resultPath = physical(ref.path);
    if (!allowed(resultPath) || resultPath.toLowerCase() === target.toLowerCase() || isModerationHidden(note.frontmatter))
        throw Error(UNAVAILABLE);
    const result = (await fs.readNoteMetadata([resultPath], allowed, { fresh: true, strict: true, maxBytes: BYTES }))[0];
    if (!result || result.revision !== ref.revision || result.frontmatter.llm_wiki_type !== 'knowledge' || isModerationHidden(result.frontmatter))
        throw Error(UNAVAILABLE);
    const prepared = await prepareKnowledgeInvestigation(fs, access, result.frontmatter.knowledge_investigation, resultPath, result, params.principal);
    if (!prepared.investigation.result || !prepared.investigation.targets.some(row => physical(row.path).toLowerCase() === target.toLowerCase()))
        throw Error(UNAVAILABLE);
    const frontmatter = { ...note.frontmatter, ...changes };
    const receipt = { path: access.toPublicPath(resultPath), revision: result.revision, target_basis_sha256: investigationReviewBasis(note.content, frontmatter) };
    if (claimId)
        frontmatter.claim_reviews[claimId].investigation_evidence = receipt;
    else
        frontmatter.review_investigation_evidence = receipt;
    const fields = { ...changes, ...(claimId ? { claim_reviews: frontmatter.claim_reviews } : { review_investigation_evidence: receipt }) };
    const handler = new FrontmatterHandler();
    const content = note.matter ? handler.preserveStringify(note.matter, fields, note.content) : handler.stringify(frontmatter, note.content);
    const guards = [{ path: resultPath, expectedRevision: result.revision }, ...prepared.guards.filter(row => row.path.toLowerCase() !== target.toLowerCase())];
    const written = await fs.writeNoteWithRevisionGuardsAndReceipt({ path: target, expectedRevision: params.expectedRevision, content }, guards, {
        maxBytes: BYTES, assertAccess: () => { prepared.assertAccess(); if (!allowed(resultPath))
            throw Error(UNAVAILABLE); },
    });
    return { ...written, frontmatter };
}
/** Bounded projection. Read progress and matching revisions are not truth. */
export async function inspectInvestigation(value, container, read, access, principal, review) {
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
        let changedTarget, firstTarget, evidenceChanged = false, reviewedTargets = 0, unassessed = false;
        for (const target of investigation.targets) {
            const path = physical(target.path);
            if (!allowed(path))
                return unavailable;
            const current = await read(path);
            if (!current?.revision || isModerationHidden(current.frontmatter) || current.frontmatter.llm_wiki_type !== 'knowledge')
                return unavailable;
            firstTarget ??= current;
            const claimIds = new Set(Array.isArray(current.frontmatter.claims) ? current.frontmatter.claims.map((claim) => String(claim?.id)) : []);
            const receipts = [current.frontmatter.review_investigation_evidence,
                ...Object.entries(current.frontmatter.claim_reviews || {}).filter(([id]) => claimIds.has(id)).map(([, row]) => row?.investigation_evidence)];
            const matching = resultReported && review?.revision && receipts.filter(receipt => {
                try {
                    return receipt && physical(receipt.path).toLowerCase() === physical(container).toLowerCase() && receipt.revision === review.revision && /^[a-f0-9]{64}$/.test(receipt.target_basis_sha256);
                }
                catch {
                    return false;
                }
            });
            let reviewed = false;
            if (matching && matching.length) {
                const basis = await review.readBasis(current);
                unassessed ||= basis === undefined;
                reviewed = matching.some(receipt => receipt.target_basis_sha256 === basis);
            }
            if (reviewed)
                reviewedTargets++;
            else if (current.revision !== target.revision)
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
        if (unassessed)
            return { state: 'unassessed', resultReported };
        if (!evidenceChanged && reviewedTargets === investigation.targets.length)
            return { state: 'result_reviewed', resultReported, reportedOutcome: investigation.result.outcome,
                notice: 'Review of this result is recorded for each target. This is not truth approval; substantive target or evidence drift requires another review.' };
        return { state: changedTarget ? 'targets_changed' : evidenceChanged ? 'evidence_changed' : resultReported ? 'result_requires_review' : 'plan_recorded',
            resultReported, ...(investigation.result && { reportedOutcome: investigation.result.outcome }),
            nextAction: { endpointId: 'notes.read', arguments: { path: access.toPublicPath(next.path), expectedRevision: next.revision, maxChars: 3000 } },
            notice: 'Review the original claim using the saved plan, observed result and evidence. No automatic truth or review approval. Execution still requires user authorization.' };
    }
    catch {
        return unavailable;
    }
}
