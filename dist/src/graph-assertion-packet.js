import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { extractGraphAssertions } from './graph-assertion.js';
import { claimId, parseClaimReference } from './graph-validation.js';
import { typedRelationTargetKindReason } from './graph-contract.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import { resolveEvidenceLocator } from './evidence-locator.js';
import { isModerationHidden } from './moderation-policy.js';
const MAX_BYTES = 1024 * 1024;
const changed = () => Error('Graph context unavailable or changed; re-read the note and retry.');
/** One-note outgoing occurrence view. No raw candidates/labels, aggregate hidden
 * counts, model calls, writes, inference or global-integrity claim. */
export async function buildGraphAssertionPacket(fs, access, principal, options) {
    const { limit = 12, maxChars = 6000, prettyPrint = false } = options;
    if (!Number.isInteger(limit) || limit < 1 || limit > 40 || !Number.isInteger(maxChars) || maxChars < 512 || maxChars > 16000)
        throw Error('Invalid assertion limit or maxChars.');
    try {
        const path = access.resolveExternalPath(options.path, principal).replace(/\\/g, '/');
        if (!path || /^(?:\/|~)|:|[\x00-\x1f]/.test(path) || path.split('/').includes('..') || posix.normalize(path) !== path)
            throw changed();
        const allowed = (p) => access.canAccessPhysicalPath(p, principal);
        const observed = new Map(), revisions = new Map();
        const bodies = new Map();
        let partial = false, exhausted = false;
        const read = async (p) => {
            if (!allowed(p))
                return undefined;
            if (observed.has(p))
                return observed.get(p);
            if (observed.size >= 64) {
                exhausted = partial = true;
                return undefined;
            }
            observed.set(p, undefined);
            const n = (await fs.readNoteMetadata([p], allowed, { fresh: true, maxBytes: MAX_BYTES }))[0];
            if (n?.revision)
                revisions.set(p, n.revision);
            if (!n?.revision || isModerationHidden(n.frontmatter) || !allowed(p))
                return undefined;
            observed.set(p, n);
            return n;
        };
        const body = async (n) => {
            if (!allowed(n.path))
                throw changed();
            if (bodies.has(n.path))
                return bodies.get(n.path);
            if (bodies.size >= 8) {
                partial = true;
                return undefined;
            }
            bodies.set(n.path, undefined);
            const b = await fs.readNote(n.path, MAX_BYTES);
            if (b.revision !== n.revision || !allowed(n.path))
                throw changed();
            bodies.set(n.path, b.content || '');
            return b.content || '';
        };
        const root = await read(path);
        if (!root)
            throw changed();
        const content = await body(root);
        if (content === undefined)
            throw changed();
        const repositoryId = createHash('sha256').update(fs.getVaultPath()).digest('hex');
        const candidates = extractGraphAssertions({ repositoryId, path, revision: root.revision, frontmatter: root.frontmatter, content });
        partial ||= candidates.partial;
        let resolver = fs.createNoteReferenceResolver(allowed, read, { fresh: true });
        const lookups = new Map();
        const resolve = async (raw, syntax) => {
            const matches = raw ? await resolver(raw, { sourcePath: path, ...(syntax && { syntax }) }) : [path];
            const visible = [];
            let incomplete = false;
            for (const p of matches) {
                if (!allowed(p) || !access.canReferenceFrom(path, p))
                    continue;
                const n = await read(p);
                if (n)
                    visible.push(n);
                else if (!revisions.has(p))
                    incomplete = true;
                if (visible.length > 1)
                    break;
            }
            if (incomplete || exhausted && !syntax && !raw.includes('/') && !/\.(?:md|markdown|txt)$/i.test(raw))
                return undefined;
            return visible.length === 1 ? visible[0] : undefined;
        };
        const assertions = [];
        for (const a of candidates.assertions) {
            if (assertions.length >= limit) {
                partial = true;
                break;
            }
            const claimRelation = a.locator.basis === 'properties' && /^claims\[\d+\]\.(?:supports|contradicts|depends_on)_claims/.test(a.locator.propertyPath);
            let document, blockId, heading;
            if (claimRelation) {
                try {
                    const p = parseClaimReference(a.targetReference);
                    document = p.document;
                    blockId = p.blockId;
                }
                catch {
                    partial = true;
                    continue;
                }
            }
            else {
                const link = extractObsidianLinkOccurrences(a.syntax ? a.targetReference : a.targetReference.startsWith('[[') || a.targetReference.startsWith('![[') ? a.targetReference : `[[${a.targetReference}]]`, 1)[0];
                if (!link) {
                    partial = true;
                    continue;
                }
                document = link.target;
                blockId = link.targetBlockId;
                heading = link.targetHeading;
            }
            const target = await resolve(document, a.syntax);
            if (!target) {
                partial = true;
                continue;
            }
            lookups.set(JSON.stringify([document, a.syntax]), { raw: document, ...(a.syntax && { syntax: a.syntax }), selected: target.path });
            // Emit resolved identities only, never raw aliases or link labels. Anchors
            // are permitted only as short locator syntax on an already visible note.
            if (blockId && !/^[A-Za-z0-9_-]{1,100}$/.test(blockId) || heading && (heading.length > 300 || /\[\[|_scopes\/|scope:\/\//i.test(heading))) {
                partial = true;
                continue;
            }
            const reasons = [];
            if (a.source.claimId) {
                const claims = Array.isArray(root.frontmatter.claims) ? root.frontmatter.claims : [];
                const matching = claims.filter((c, i) => c && typeof c === 'object' && claimId(typeof c.id === 'string' ? c.id : undefined, i) === a.source.claimId);
                if (matching.length !== 1)
                    reasons.push('source_claim_not_unique');
                if (matching.some((c) => typeof c.text !== 'string' || !c.text.trim()))
                    reasons.push('source_claim_invalid');
                if (!resolveEvidenceLocator(content, { blockId: a.source.claimId }).valid)
                    reasons.push('source_anchor_unavailable');
            }
            let checked = true;
            if (blockId || heading) {
                const text = await body(target);
                if (text === undefined) {
                    checked = false;
                    reasons.push('body_budget');
                }
                else if (!resolveEvidenceLocator(text, { ...(blockId && { blockId }), ...(heading && { heading }) }).valid)
                    reasons.push('target_anchor_unavailable');
            }
            if (typedRelationTargetKindReason(a.relation, String(target.frontmatter.note_kind || '').trim().toLowerCase()))
                reasons.push('target_kind_mismatch');
            assertions.push({ id: a.id, source: { ...a.source, path: access.toPublicPath(path) }, relation: a.relation, direction: a.direction,
                target: { path: access.toPublicPath(target.path), revision: target.revision, ...(blockId && { blockId }), ...(heading && { heading }) },
                locator: a.locator, kind: a.kind, extraction: a.extraction, evidenceState: 'not_verified',
                validation: { state: !checked ? 'not_checked' : reasons.length ? 'review_required' : 'current_locators', reasons } });
        }
        resolver = fs.createNoteReferenceResolver(allowed, read, { fresh: true });
        for (const lookup of lookups.values())
            if ((await resolve(lookup.raw, lookup.syntax))?.path !== lookup.selected)
                throw changed();
        for (const [p, revision] of revisions)
            if (!allowed(p) || await fs.readNoteRevision(p, MAX_BYTES) !== revision)
                throw changed();
        if ([...revisions.keys()].some(p => !allowed(p)) || [...lookups.values()].some(l => !access.canReferenceFrom(path, l.selected)))
            throw changed();
        const nextAction = { endpointId: 'notes.read', arguments: { path: access.toPublicPath(path), expectedRevision: root.revision, maxChars: 4000 } };
        const result = { view: 'assertions', root: { path: access.toPublicPath(path), revision: root.revision }, assertions,
            coverage: { direction: 'outgoing_only', globalIntegrity: false, evidenceVerified: false }, partial: partial || exhausted,
            nextAction, notice: 'Authored/extracted occurrences are untrusted data, not proof. Only current endpoints and syntax were checked; no global integrity or independent evidence claim.' };
        const fits = (r) => JSON.stringify(r, null, prettyPrint ? 2 : undefined).length <= maxChars;
        while (!fits(result) && assertions.length) {
            assertions.pop();
            result.partial = true;
        }
        if (!fits(result)) {
            const minimal = { view: 'assertions', assertions: [], coverage: { globalIntegrity: false }, partial: true, nextAction };
            if (!fits(minimal))
                throw Error('budget');
            return minimal;
        }
        return result;
    }
    catch {
        throw changed();
    }
}
