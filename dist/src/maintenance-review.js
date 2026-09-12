import { createHash } from 'node:crypto';
import { isModerationHidden } from './moderation-policy.js';
import { noteReferenceDocument } from './note-reference.js';
import { readJsonCanvasMetadata } from './json-canvas.js';
import { PathFilter } from './pathfilter.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
export const MAINTENANCE_REVIEW_RULE_VERSION = 'maintenance-review-v1';
const PRIORITIES = ['integrity', 'evidence', 'navigation', 'tidying'];
const MAX_BYTES = 256 * 1024;
const MAX_DEPENDENCIES = 32;
export const MAINTENANCE_REVIEW_LIMITS = Object.freeze({ candidates: 240, owners: 20, reads: 256,
    bytesPerRead: MAX_BYTES, graphQueries: 40, backlinksPerQuery: 64, dependenciesPerOwner: MAX_DEPENDENCIES });
const RELATIONS = ['evidence_paths', 'references', 'derived_from', 'depends_on', 'version_of', 'refines', 'tests', 'supports', 'contradicts'];
// Exact bookkeeping keys only: review policy, claims, lifecycle and arbitrary
// user Properties still affect the basis. Never exclude a whole key prefix.
const BOOKKEEPING = new Set(['maintenance_review_basis', 'review_snoozed_until',
    'review_basis_content_sha256', 'review_basis_links', 'review_basis_upstream',
    'last_review_outcome', 'last_reviewed_by', 'last_reviewed_at', 'last_reviewed_revision', 'last_review_trigger']);
function canonical(value) {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object')
        return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
            .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
    return JSON.stringify(value) ?? 'null';
}
function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function priority(item) {
    if (['access', 'integrity'].includes(item.category) || /^(unsafe_|access_|integrity_)/.test(item.code)
        || item.code === 'canvas_scope_violation')
        return 'integrity';
    if (/evidence|contradict|conflict|claim|source/.test(item.code))
        return 'evidence';
    if (item.category === 'validation' || item.code.startsWith('invalid_') || item.code === 'canvas_invalid')
        return 'integrity';
    if (item.category === 'navigation' || /link|moc|orphan|canvas/.test(item.code))
        return 'navigation';
    return 'tidying';
}
const GUIDANCE = {
    integrity: 'Check access and document integrity before attempting any repair.',
    evidence: 'Read current sources and competing claims before changing the conclusion.',
    navigation: 'Verify the exact target and anchors before repairing navigation.',
    tidying: 'Review the current note and make only a necessary, revision-safe cleanup.',
};
function explanation(item) {
    if (item.code === 'canvas_invalid')
        return 'The Canvas could not be validated; inspect its current health.';
    if (item.code.startsWith('canvas_'))
        return 'The derived Canvas has a reported freshness or boundary issue.';
    if (/contradict|conflict/.test(item.code))
        return 'A conflict or competing claim still requires source review.';
    if (/evidence|source/.test(item.code))
        return 'Supporting evidence is missing, broken, or no longer current.';
    return { integrity: 'An access or document-integrity check reported a problem.',
        evidence: 'An argument or supporting claim requires verification.',
        navigation: 'A link, map, or navigation relationship requires verification.',
        tidying: 'A document organization or maintenance check requires review.' }[priority(item)];
}
function rankedIssues(items) {
    const unique = new Map();
    for (const item of items) {
        const prior = unique.get(item.code);
        if (!prior || PRIORITIES.indexOf(priority(item)) < PRIORITIES.indexOf(priority(prior))
            || priority(item) === priority(prior) && item.severity === 'error')
            unique.set(item.code, item);
    }
    return [...unique.values()].sort((a, b) => PRIORITIES.indexOf(priority(a)) - PRIORITIES.indexOf(priority(b))
        || Number(b.severity === 'error') - Number(a.severity === 'error') || a.code.localeCompare(b.code));
}
/** Read-only projection over already selected findings, not a new linter or a
 * Vault census. A successful write/review is never interpreted as resolution. */
export class MaintenanceReviewService {
    fs;
    access;
    constructor(fs, access) {
        this.fs = fs;
        this.access = access;
    }
    path(raw, principal) {
        try {
            const path = this.access.resolveExternalPath(raw, principal).trim().replace(/\\/g, '/');
            if (!path || path.split('/').some(part => !part || part === '.' || part === '..') || !new PathFilter().isAllowed(path) || /^(?:\/|~|[a-z][a-z0-9+.-]*:)/i.test(path)
                || !this.access.canAccessPhysicalPath(path, principal))
                return undefined;
            return path;
        }
        catch {
            return undefined;
        }
    }
    async read(path, principal, work) {
        if (!this.access.canAccessPhysicalPath(path, principal))
            return undefined;
        if (work.reads >= MAINTENANCE_REVIEW_LIMITS.reads) {
            work.exhausted = true;
            return undefined;
        }
        work.reads++;
        try {
            const note = await this.fs.readNote(path, MAX_BYTES);
            return this.access.canAccessPhysicalPath(path, principal) && !isModerationHidden(note.frontmatter) ? note : undefined;
        }
        catch {
            work.readFailed = true;
            return undefined;
        }
    }
    async dependencies(path, note, principal, work) {
        const result = { revisions: new Map(), complete: true };
        const canAccess = (target) => this.access.canAccessPhysicalPath(target, principal)
            && this.access.canReferenceFrom(path, target);
        const references = [];
        const addValues = (value) => {
            if (value === undefined)
                return;
            if (!Array.isArray(value)) {
                result.complete = false;
                return;
            }
            if (value.length > MAX_DEPENDENCIES)
                result.complete = false;
            for (const entry of value.slice(0, MAX_DEPENDENCIES)) {
                if (typeof entry !== 'string' || !entry.trim()) {
                    result.complete = false;
                    continue;
                }
                if (references.length < MAX_DEPENDENCIES)
                    references.push(entry);
                else
                    result.complete = false;
            }
        };
        for (const relation of RELATIONS)
            addValues(note.frontmatter[relation]);
        const links = extractObsidianLinkOccurrences(note.content, MAX_DEPENDENCIES + 1, true);
        if (links.length > MAX_DEPENDENCIES)
            result.complete = false;
        const markdown = new Set();
        for (const link of links.slice(0, MAX_DEPENDENCIES)) {
            const wiki = /^!?\[\[/.test(link.link);
            const target = wiki ? link.link : link.target;
            if (/^(?:https?|mailto|data):/i.test(target) || target.startsWith('#'))
                continue;
            if (references.length >= MAX_DEPENDENCIES) {
                result.complete = false;
                break;
            }
            references.push(target);
            if (!wiki)
                markdown.add(target);
        }
        const claims = note.frontmatter.claims;
        if (claims !== undefined && !Array.isArray(claims))
            result.complete = false;
        if (Array.isArray(claims)) {
            if (claims.length > MAX_DEPENDENCIES)
                result.complete = false;
            for (const claim of claims.slice(0, MAX_DEPENDENCIES)) {
                if (!claim || typeof claim !== 'object') {
                    result.complete = false;
                    continue;
                }
                addValues(claim.evidence_paths);
                for (const key of ['depends_on_claims', 'contradicts_claims', 'supports_claims'])
                    addValues(claim[key]);
            }
        }
        if (references.length > MAX_DEPENDENCIES)
            result.complete = false;
        const capture = async (target, expectedRevision) => {
            if (target === path)
                return;
            if (!canAccess(target) || result.revisions.size >= MAX_DEPENDENCIES && !result.revisions.has(target)) {
                result.complete = false;
                return;
            }
            const current = await this.read(target, principal, work);
            if (!current || expectedRevision !== undefined && current.revision !== expectedRevision) {
                result.complete = false;
                return;
            }
            result.revisions.set(target, current.revision);
        };
        for (const reference of references.slice(0, MAX_DEPENDENCIES)) {
            const document = noteReferenceDocument(reference);
            if (!document && /#\^/.test(reference))
                continue; // same-note claim: owner revision covers it
            try {
                // Do not launch an alias/basename census. Only an explicitly qualified
                // path or a literal root filename with extension is admitted here.
                // Other references remain review-required, without guessing a target.
                if (!/\.(md|markdown|txt)$/i.test(document)) {
                    result.complete = false;
                    continue;
                }
                // Reuse one path-only resolver for this bounded review. The extension
                // gate above prevents an alias/body census, and ambiguity stays open.
                work.resolver ??= this.fs.createNoteReferenceResolver(target => this.access.canAccessPhysicalPath(target, principal), async () => undefined, { fresh: true });
                const matches = await work.resolver(reference, { sourcePath: path, ...(markdown.has(reference) && { syntax: 'markdown' }) });
                if (matches.length !== 1) {
                    result.complete = false;
                    continue;
                }
                const target = this.path(matches[0], principal);
                if (!target || !canAccess(target)) {
                    result.complete = false;
                    continue;
                }
                await capture(target);
            }
            catch {
                result.complete = false;
            }
        }
        // Reuse the existing current, ACL-filtered graph. Never fingerprint its global
        // snapshot/total: unrelated or hidden incoming authors must not be observable.
        try {
            if (work.graphs >= MAINTENANCE_REVIEW_LIMITS.graphQueries) {
                work.exhausted = true;
                result.complete = false;
                return result;
            }
            work.graphs++;
            const incoming = await this.fs.getBacklinks(path, MAINTENANCE_REVIEW_LIMITS.backlinksPerQuery, canAccess, 0, { includeSourceRevision: true, expectedRevision: note.revision });
            if (incoming.truncated)
                result.complete = false;
            for (const link of incoming.backlinks) {
                if (!['supports', 'claim_supports', 'contradicts', 'claim_contradicts'].includes(link.relation ?? ''))
                    continue;
                if (!link.sourceRevision) {
                    result.complete = false;
                    continue;
                }
                await capture(link.path, link.sourceRevision);
            }
        }
        catch {
            result.complete = false;
        }
        return result;
    }
    async canvasGroup(path, entries, principal, work) {
        if (!this.access.canAccessPhysicalPath(path, principal))
            return undefined;
        if (work.reads >= MAINTENANCE_REVIEW_LIMITS.reads) {
            work.exhausted = true;
            return undefined;
        }
        work.reads++;
        let revision;
        let document;
        let invalid = false;
        try {
            const canvas = await this.fs.readCanvasFile(path, MAX_BYTES);
            revision = canvas.revision;
            document = canvas.document;
        }
        catch (error) {
            // The filesystem reports this bounded classification without a parsed
            // revision. Do not forward its error/path or pretend the bytes are pinned.
            if (error instanceof Error && error.message.startsWith('Canvas is not valid JSON:'))
                invalid = true;
            else {
                work.readFailed = true;
                return undefined;
            }
        }
        if (!this.access.canAccessPhysicalPath(path, principal))
            return undefined;
        const valid = entries.filter(item => item.code.startsWith('canvas_')
            && (item.revision ? item.revision === revision : invalid ? item.code === 'canvas_invalid' : true));
        if (!valid.length)
            return undefined;
        const dependencies = { revisions: new Map(), complete: !invalid };
        if (!invalid) {
            try {
                const metadata = readJsonCanvasMetadata(document);
                if (!metadata)
                    return undefined; // unmanaged user Canvas, never a repair candidate
                const nodes = document.nodes;
                const sourceIds = Object.keys(metadata.revisions);
                if (sourceIds.length > MAX_DEPENDENCIES)
                    dependencies.complete = false;
                for (const id of sourceIds.slice(0, MAX_DEPENDENCIES)) {
                    const node = nodes.find(node => node.type === 'file' && node.id === id);
                    const target = node?.file ? this.path(node.file, principal) : undefined;
                    if (!target || !this.access.canReferenceFrom(path, target)) {
                        dependencies.complete = false;
                        continue;
                    }
                    const source = await this.read(target, principal, work);
                    if (!source) {
                        dependencies.complete = false;
                        continue;
                    }
                    dependencies.revisions.set(target, source.revision);
                }
            }
            catch {
                // Malformed managed metadata must stay visible for health inspection,
                // without copying its arbitrary text, file nodes, or forged revisions.
                invalid = true;
                dependencies.complete = false;
            }
        }
        const ranked = rankedIssues(valid);
        const issues = ranked.map(item => ({ code: item.code, severity: item.severity, explanation: explanation(item) }));
        const publicPath = this.access.toPublicPath(path);
        const affectedEvidence = [...dependencies.revisions].sort(([a], [b]) => a.localeCompare(b))
            .map(([target, sourceRevision]) => ({ path: this.access.toPublicPath(target), revision: sourceRevision }));
        const ruleVersion = MAINTENANCE_REVIEW_RULE_VERSION;
        const sourceState = revision && !invalid && valid.every(item => item.revision === revision) ? 'snapshot_matched' : 'recheck_required';
        return { path: publicPath, ...(revision && { revision }), sourceState, ruleVersion,
            issueId: digest({ ruleVersion, path: publicPath, issues, revision, affectedEvidence }),
            reviewBasis: digest({ ruleVersion, path: publicPath, issues, revision, affectedEvidence }),
            priority: priority(ranked[0]), reviewState: sourceState === 'recheck_required' || !dependencies.complete ? 'recheck_required' : 'open',
            dependenciesComplete: dependencies.complete, affectedEvidence, issues, reviewGuidance: GUIDANCE[priority(ranked[0])],
            // canvas_health has no per-path/expectedRevision input. The exact observed
            // revision is carried above; do not fabricate an unsupported guarded read.
            nextAction: { endpointId: 'wiki.canvas_health', arguments: { limit: 20, maxChars: 12000 } } };
    }
    async group(items, principal, limit = 20, maxChars = 4000, sourceTruncated = false) {
        const assertBoundary = this.access.captureDocumentBoundary(principal);
        const work = { reads: 0, graphs: 0, exhausted: false, readFailed: false };
        const boundedLimit = Math.floor(Math.min(60, Math.max(1, Number(limit) || 20)));
        const budget = Math.floor(Math.min(16000, Math.max(512, Number(maxChars) || 4000)));
        const candidates = new Map();
        let truncated = sourceTruncated || items.length > MAINTENANCE_REVIEW_LIMITS.candidates;
        for (const item of items.slice(0, MAINTENANCE_REVIEW_LIMITS.candidates)) {
            if (!/^[a-z][a-z0-9_]{0,95}$/.test(item.code)) {
                truncated = true;
                continue;
            }
            const path = this.path(item.path, principal);
            if (!path)
                continue;
            if (!item.revision && !/\.canvas$/i.test(path)) {
                truncated = true;
                continue;
            }
            const group = candidates.get(path) ?? [];
            group.push(item);
            candidates.set(path, group);
        }
        const staged = [];
        const canvases = [];
        const owners = [...candidates].sort(([a, ai], [b, bi]) => Math.min(...ai.map(item => PRIORITIES.indexOf(priority(item)))) - Math.min(...bi.map(item => PRIORITIES.indexOf(priority(item))))
            || a.localeCompare(b));
        const ownerLimit = Math.min(boundedLimit, MAINTENANCE_REVIEW_LIMITS.owners);
        let reservedValidationReads = 0;
        for (const [path, entries] of owners.slice(0, ownerLimit)) {
            // Leave room for both revalidation passes before admitting another owner.
            // A smaller validated subset is useful; an exhausted empty retry is not.
            if (work.reads + reservedValidationReads + 3 * MAX_DEPENDENCIES + 4 > MAINTENANCE_REVIEW_LIMITS.reads) {
                truncated = true;
                break;
            }
            const readsBeforeOwner = work.reads;
            if (/\.canvas$/i.test(path)) {
                const group = await this.canvasGroup(path, entries, principal, work);
                if (group) {
                    canvases.push({ path, entries, group });
                    reservedValidationReads += work.reads - readsBeforeOwner;
                }
                continue;
            }
            const note = await this.read(path, principal, work);
            if (!note)
                continue;
            const valid = entries.filter(item => item.revision === note.revision);
            if (!valid.length) {
                truncated = true;
                continue;
            }
            const ranked = rankedIssues(valid);
            const issues = ranked.map(item => ({ code: item.code, severity: item.severity, explanation: explanation(item) }));
            const dependencies = await this.dependencies(path, note, principal, work);
            const affectedEvidence = [...dependencies.revisions].sort(([a], [b]) => a.localeCompare(b))
                .map(([target, revision]) => ({ path: this.access.toPublicPath(target), revision }));
            const ruleVersion = MAINTENANCE_REVIEW_RULE_VERSION;
            const publicPath = this.access.toPublicPath(path);
            const properties = Object.fromEntries(Object.entries(note.frontmatter).filter(([key]) => !BOOKKEEPING.has(key)));
            const reviewBasis = digest({ ruleVersion, path: publicPath, issues, content: note.content, properties, affectedEvidence });
            const stamp = note.frontmatter.maintenance_review_basis;
            const snooze = note.frontmatter.review_snoozed_until;
            const snoozeTime = typeof snooze === 'string' ? Date.parse(snooze) : NaN;
            const reviewState = !dependencies.complete || (stamp !== undefined && stamp !== reviewBasis)
                || (snooze !== undefined && (!Number.isFinite(snoozeTime) || stamp !== reviewBasis))
                ? 'recheck_required' : snoozeTime > Date.now() ? 'snoozed' : 'open';
            staged.push({ path, dependencies, group: { path: publicPath, revision: note.revision, ruleVersion,
                    sourceState: valid.every(item => item.sourceState === 'snapshot_matched') ? 'snapshot_matched' : 'recheck_required',
                    issueId: digest({ ruleVersion, path: publicPath, issues, revision: note.revision, affectedEvidence }), reviewBasis,
                    priority: priority(ranked[0]), reviewState, dependenciesComplete: dependencies.complete, affectedEvidence, issues,
                    reviewGuidance: GUIDANCE[priority(ranked[0])],
                    nextAction: { endpointId: 'notes.read', arguments: { path: publicPath, expectedRevision: note.revision, maxChars: 3000 } } } });
            reservedValidationReads += 2 * (work.reads - readsBeforeOwner) + 2;
        }
        if (candidates.size > ownerLimit)
            truncated = true;
        const groups = [];
        for (const entry of staged) {
            const current = await this.read(entry.path, principal, work);
            if (!current || current.revision !== entry.group.revision) {
                truncated = true;
                continue;
            }
            const now = await this.dependencies(entry.path, current, principal, work);
            if (digest([...now.revisions].sort()) !== digest([...entry.dependencies.revisions].sort())
                || now.complete !== entry.dependencies.complete) {
                truncated = true;
                continue;
            }
            const final = await this.read(entry.path, principal, work);
            if (!final || final.revision !== current.revision) {
                truncated = true;
                continue;
            }
            groups.push(entry.group);
        }
        // Later groups may have awaited IO after earlier groups. Recheck their source
        // revisions and current access before publishing even aggregate information.
        for (let index = groups.length - 1; index >= 0; index--) {
            const group = groups[index];
            const paths = [{ path: group.path, revision: group.revision }, ...group.affectedEvidence];
            for (const source of paths) {
                const physical = this.path(source.path, principal);
                const current = physical ? await this.read(physical, principal, work) : undefined;
                if (!current || current.revision !== source.revision) {
                    groups.splice(index, 1);
                    truncated = true;
                    break;
                }
            }
        }
        for (const entry of canvases) {
            const current = await this.canvasGroup(entry.path, entry.entries, principal, work);
            if (!current || digest(current) !== digest(entry.group)) {
                truncated = true;
                continue;
            }
            groups.push(current);
        }
        assertBoundary();
        // No awaits below this final scope check: later Canvas/source IO must not
        // leave an earlier group's now-revoked identity in the outgoing response.
        for (let index = groups.length - 1; index >= 0; index--) {
            const group = groups[index];
            const owner = this.path(group.path, principal);
            if (!owner || group.affectedEvidence.some(source => {
                const target = this.path(source.path, principal);
                return !target || !this.access.canReferenceFrom(owner, target);
            })) {
                groups.splice(index, 1);
                truncated = true;
            }
        }
        groups.sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || a.path.localeCompare(b.path));
        const selected = groups.slice(0, boundedLimit);
        const result = { advisory: true, coverage: 'partial', countScope: 'validated_candidates',
            groups: selected, truncated: truncated || work.exhausted || work.readFailed || groups.length > selected.length };
        while (result.groups.length && JSON.stringify(result).length > budget) {
            result.groups.pop();
            result.truncated = true;
        }
        if (result.truncated)
            result.retry = { endpointId: 'wiki.exception_board', reuseOriginalArguments: true, overrides: { maxChars: 16000 } };
        while (result.groups.length && JSON.stringify(result).length > budget)
            result.groups.pop();
        return result;
    }
}
