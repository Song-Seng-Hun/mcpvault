import { createHash, randomUUID } from 'node:crypto';
import { normalizeScopeId } from './scopes.js';
import { isClosedWorkflowStatus, matchesWorkflowFilter, workflowStatus } from './community-status.js';
import { isModerationHidden, moderationStatus } from './moderation-policy.js';
import { boundItems } from './search-limits.js';
import { iterateNotes, queryWindow } from './paged-query.js';
import { readNotesInBatches } from './batch-read.js';
import { endpointIdForTool } from './endpoint-registry.js';
import { attachPublicCreateRequest, preparePublicCreateRequest, runPublicCreate } from './community-public-retry.js';
const JOURNAL_ROOT = '_journal/entries';
const BLOG_ROOT = 'Community/Posts';
const COMMENTS_ROOT = 'Community/Comments';
const JOURNAL_KINDS = new Set(['diary', 'log', 'reflection']);
const POST_STATUSES = new Set(['draft', 'published', 'archived']);
export const COMMUNITY_POST_CATEGORIES = ['question', 'discussion', 'proposal', 'announcement', 'bug', 'research', 'showcase', 'agora', 'feedback', 'forum'];
export const AGORA_STANCES = ['for', 'against', 'neutral'];
export const MAX_COMMUNITY_TEXT_LENGTH = 280;
const MAX_JOURNAL_TEXT_LENGTH = 20_000;
const DEFAULT_JOURNAL_LIMIT = 20;
const MAX_JOURNAL_LIMIT = 100;
const DEFAULT_JOURNAL_MAX_CHARS = 4_000;
const MAX_JOURNAL_MAX_CHARS = 12_000;
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const agentJournalRoot = (agentId) => `_scopes/agents/${normalizeScopeId(agentId, 'agentId')}/${JOURNAL_ROOT}`;
const blogPath = (slug) => `${BLOG_ROOT}/${normalizeScopeId(slug, 'slug')}.md`;
function publicPostReference(value) {
    const raw = String(value || '').trim().replace(/\\/g, '/');
    const match = new RegExp(`^${BLOG_ROOT}/([^/]+)\\.md$`, 'i').exec(raw);
    return match ? blogPath(match[1]) : blogPath(raw);
}
const commentsRoot = (slug) => `${COMMENTS_ROOT}/${normalizeScopeId(slug, 'slug')}`;
const commentPath = (slug, commentId) => `${commentsRoot(slug)}/${normalizeScopeId(commentId, 'commentId')}.md`;
function cleanTags(tags) {
    if (!Array.isArray(tags))
        return [];
    return Array.from(new Set(tags.map(tag => String(tag).trim().toLowerCase()).filter(Boolean))).slice(0, 30);
}
function cleanFeedbackSourcePaths(value) {
    if (!Array.isArray(value))
        return [];
    const paths = value.map(item => String(item).trim().replace(/\\/g, '/')).filter(Boolean);
    if (paths.some(path => /^(?:[a-z]:[\\/]|\\\\|\/|https?:)/i.test(path) || path.split('/').includes('..'))) {
        throw new Error('sourcePaths must contain repository-relative paths and cannot contain absolute paths or .. segments');
    }
    return Array.from(new Set(paths)).slice(0, 20);
}
export function extractMentions(content) {
    const mentions = new Set();
    const pattern = /(^|[^\w])@([a-z0-9][a-z0-9._-]{0,63})\b/gi;
    for (const match of content.matchAll(pattern))
        mentions.add(match[2].toLowerCase());
    return Array.from(mentions);
}
function requireShortCommunityText(content) {
    const normalized = String(content ?? '').trim();
    if (!normalized)
        throw new Error('content is required');
    const length = Array.from(normalized).length;
    if (length > MAX_COMMUNITY_TEXT_LENGTH)
        throw new Error(`content must be ${MAX_COMMUNITY_TEXT_LENGTH} Unicode characters or fewer (received ${length})`);
    return normalized;
}
function requireJournalText(content) {
    const normalized = String(content ?? '').trim();
    if (!normalized)
        throw new Error('content is required');
    const length = Array.from(normalized).length;
    if (length > MAX_JOURNAL_TEXT_LENGTH)
        throw new Error(`journal content must be ${MAX_JOURNAL_TEXT_LENGTH} Unicode characters or fewer (received ${length})`);
    return normalized;
}
function journalWindowNumber(value, fallback, maximum) {
    const parsed = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1)
        throw new Error('journal window limits must be positive integers');
    return Math.min(parsed, maximum);
}
function journalResponseBudget(value, fallback) {
    const parsed = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1_000)
        throw new Error('journal maxChars must be an integer of at least 1000');
    return Math.min(parsed, MAX_JOURNAL_MAX_CHARS);
}
function journalCursorEncode(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
function journalCursorDecode(value) {
    if (typeof value !== 'string' || !value)
        throw new Error('cursor must be a journal cursor returned by list_journal_entries');
    try {
        const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        if (typeof parsed.fingerprint !== 'string' || typeof parsed.path !== 'string')
            throw new Error('invalid cursor');
        return { fingerprint: parsed.fingerprint, path: parsed.path };
    }
    catch {
        throw new Error('cursor must be a journal cursor returned by list_journal_entries');
    }
}
function fitJournalResponse(base, content, maxChars, continuation) {
    const full = { ...base, content };
    if (JSON.stringify(full).length <= maxChars)
        return full;
    const withoutContent = { ...base, content: '', truncated: true, nextAction: continuation };
    if (JSON.stringify(withoutContent).length > maxChars) {
        return { path: base.path, revision: base.revision, frontmatterOmitted: true, content: '', truncated: true, nextAction: continuation };
    }
    const codepoints = Array.from(content);
    let low = 0;
    let high = codepoints.length;
    let best = { ...base, content: '', truncated: true, nextAction: continuation };
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = { ...base, content: codepoints.slice(0, middle).join(''), truncated: true, nextAction: continuation };
        if (JSON.stringify(candidate).length <= maxChars) {
            best = candidate;
            low = middle + 1;
        }
        else
            high = middle - 1;
    }
    return best;
}
function windowNumber(value, fallback, maximum) {
    const number = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(number) || number < 1)
        throw new Error('window limits must be positive integers');
    return Math.min(number, maximum);
}
function identity(principal) {
    return principal.agentId || principal.modelId;
}
function ownershipMetadata(principal) {
    return {
        ...(principal.userId && { user_id: principal.userId, family_id: principal.userId }),
        command_center_id: principal.commandCenterId || 'local',
    };
}
async function* mergeMentionNotes(fileSystem, targets, includeClosed) {
    const sources = [
        iterateNotes(fileSystem, { pathPrefix: 'Community/Comments', filters: { mcpvault_type: 'blog_comment' }, sortBy: 'created_at', sortOrder: 'desc' }),
        iterateNotes(fileSystem, { pathPrefix: 'Community/ChatMessages', filters: { mcpvault_type: 'chat_message' }, sortBy: 'created_at', sortOrder: 'desc' }),
    ];
    const nextMatching = async (source) => {
        while (true) {
            const next = await source.next();
            if (next.done)
                return undefined;
            const note = next.value;
            if (isModerationHidden(note.frontmatter)
                || (!includeClosed && isClosedWorkflowStatus(note.frontmatter.workflow_status))
                || !Array.isArray(note.frontmatter.mentions)
                || !note.frontmatter.mentions.some((mention) => targets.has(String(mention).toLowerCase())))
                continue;
            return note;
        }
    };
    let current = await Promise.all(sources.map(nextMatching));
    while (current.some(Boolean)) {
        const index = current[1] === undefined
            || (current[0] !== undefined && String(current[0].frontmatter.created_at).localeCompare(String(current[1].frontmatter.created_at)) >= 0)
            ? 0 : 1;
        const note = current[index];
        if (note)
            yield note;
        current[index] = await nextMatching(sources[index]);
    }
}
function requireAgent(principal) {
    if (!principal?.agentId)
        throw new Error('An authenticated agent scope is required for private journal entries');
    return principal;
}
function requirePublisher(principal) {
    if (!principal)
        throw new Error('Login is required to publish or comment in the public community');
    return principal;
}
function debateStance(value, isAgora) {
    if (value === undefined || value === null || String(value).trim() === '') {
        if (isAgora)
            throw new Error("Agora comments require stance='for', 'against', or 'neutral'");
        return undefined;
    }
    const stance = String(value).trim().toLowerCase();
    if (!AGORA_STANCES.includes(stance))
        throw new Error("stance must be for, against, or neutral");
    if (!isAgora)
        throw new Error("stance is only available on Agora topics");
    return stance;
}
function validateDate(value) {
    const date = String(value || today()).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new Error('date must use YYYY-MM-DD format');
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date)
        throw new Error('date is invalid');
    return date;
}
export class SocialService {
    fileSystem;
    access;
    references;
    reputation;
    notifications;
    constructor(fileSystem, access, references, reputation, notifications) {
        this.fileSystem = fileSystem;
        this.access = access;
        this.references = references;
        this.reputation = reputation;
        this.notifications = notifications;
    }
    async findJournalEntry(agentId, entryId) {
        const normalizedId = normalizeScopeId(entryId, 'entryId');
        const root = agentJournalRoot(agentId);
        const result = await this.fileSystem.queryNotes({
            pathPrefix: root,
            filters: { mcpvault_type: 'journal_entry', entry_id: normalizedId },
            limit: 2,
            includeContent: false,
        }, path => this.access.canAccessPhysicalPath(path, { accountId: '', modelId: '', agentId, role: 'agent' }));
        const found = result.notes[0];
        if (!found)
            throw new Error(`Journal entry not found: ${normalizedId}`);
        return { ...(await this.fileSystem.readNote(found.path)), path: found.path };
    }
    async writeJournalEntry(params) {
        const principal = requireAgent(params.principal);
        const content = requireJournalText(params.content);
        const requestedEntryId = params.entryId
            ? normalizeScopeId(params.entryId, 'entryId')
            : undefined;
        const existing = requestedEntryId ? await this.findJournalEntry(principal.agentId, requestedEntryId) : undefined;
        const date = params.date === undefined
            ? (existing ? validateDate(existing.frontmatter.date) : validateDate(undefined))
            : validateDate(params.date);
        const kind = String(params.kind ?? existing?.frontmatter.kind ?? 'diary').trim().toLowerCase();
        if (!JOURNAL_KINDS.has(kind))
            throw new Error('kind must be diary, log, or reflection');
        const resolvedEntryId = requestedEntryId || `${date}-${randomUUID().slice(0, 8)}`;
        if (existing && !params.expectedRevision)
            throw new Error("expectedRevision is required for a journal update; read the entry first");
        if (existing && String(existing.frontmatter.date) !== date)
            throw new Error('date cannot change when updating a journal entry');
        const path = existing?.path || `${agentJournalRoot(principal.agentId)}/${date}/${resolvedEntryId}.md`;
        const timestamp = now();
        const existingFrontmatter = existing?.frontmatter || {};
        const references = await this.references.validateAndNormalize(params.references ?? existingFrontmatter.references, path, principal, content);
        const expectedRevision = existing ? params.expectedRevision : (params.expectedRevision || 'missing');
        await this.fileSystem.writeNote({
            path,
            content: params.title?.trim() ? `# ${params.title.trim()}\n\n${content}\n` : `${content}\n`,
            frontmatter: {
                ...existingFrontmatter,
                mcpvault_type: 'journal_entry', entry_id: resolvedEntryId, date, kind,
                author: identity(principal), author_role: principal.role, ...ownershipMetadata(principal),
                ...(params.title?.trim() && { title: params.title.trim() }),
                ...(params.mood?.trim() && { mood: params.mood.trim() }),
                ...(params.tags !== undefined && { tags: cleanTags(params.tags) }),
                ...(params.memory_entries !== undefined && { memory_entries: params.memory_entries }),
                references,
                ...(existing ? { updated_at: timestamp } : { created_at: timestamp, updated_at: timestamp }),
            },
            expectedRevision,
        });
        const written = await this.fileSystem.readNote(path);
        return {
            success: true,
            created: !existing,
            entryId: resolvedEntryId,
            date,
            kind,
            path: this.access.toPublicPath(path),
            revision: written.revision,
        };
    }
    async listJournalEntries(params) {
        const principal = requireAgent(params.principal);
        const filters = { mcpvault_type: 'journal_entry' };
        if (params.date !== undefined)
            filters.date = validateDate(params.date);
        const dateFrom = params.dateFrom === undefined ? undefined : validateDate(params.dateFrom);
        const dateTo = params.dateTo === undefined ? undefined : validateDate(params.dateTo);
        if (dateFrom && dateTo && dateFrom > dateTo)
            throw new Error('dateFrom must not be after dateTo');
        const kind = params.kind === undefined ? undefined : String(params.kind).trim().toLowerCase();
        if (kind !== undefined && !JOURNAL_KINDS.has(kind))
            throw new Error('kind must be diary, log, or reflection');
        const tags = params.tags === undefined ? [] : cleanTags(params.tags).sort();
        const limit = journalWindowNumber(params.limit, DEFAULT_JOURNAL_LIMIT, MAX_JOURNAL_LIMIT);
        const maxChars = journalResponseBudget(params.maxChars, DEFAULT_JOURNAL_MAX_CHARS);
        const access = (path) => this.access.canAccessPhysicalPath(path, principal);
        // Metadata and revision form the cursor snapshot; bodies are never read for a list.
        const captured = [];
        for await (const note of iterateNotes(this.fileSystem, {
            pathPrefix: agentJournalRoot(principal.agentId), filters,
            sortBy: 'date', sortOrder: 'desc', includeContent: false,
        }, access))
            captured.push(note);
        const notes = captured.filter(note => {
            const date = String(note.frontmatter.date || '');
            const noteTags = Array.isArray(note.frontmatter.tags) ? note.frontmatter.tags.map(tag => String(tag).toLowerCase()) : [];
            return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo)
                && (!kind || note.frontmatter.kind === kind) && tags.every(tag => noteTags.includes(tag));
        });
        const fingerprint = createHash('sha256').update(JSON.stringify([
            principal.agentId, params.date, dateFrom, dateTo, kind, tags,
            notes.map(note => [note.path, note.revision]),
        ])).digest('hex');
        let start = 0;
        if (params.cursor !== undefined) {
            const cursor = journalCursorDecode(params.cursor);
            if (cursor.fingerprint !== fingerprint)
                throw new Error('Journal snapshot changed; repeat the query without a cursor');
            start = notes.findIndex(note => note.path === cursor.path) + 1;
            if (start === 0)
                throw new Error('Journal cursor is outside the current snapshot');
        }
        const rows = notes.map(note => ({
            path: this.access.toPublicPath(note.path), entryId: note.frontmatter.entry_id, date: note.frontmatter.date,
            kind: note.frontmatter.kind, title: note.frontmatter.title, mood: note.frontmatter.mood,
            tags: note.frontmatter.tags || [], updatedAt: note.frontmatter.updated_at, revision: note.revision,
        }));
        let end = start;
        while (end < rows.length && end - start < limit) {
            const nextEnd = end + 1;
            const hasMore = nextEnd < rows.length;
            const candidate = {
                entries: rows.slice(start, nextEnd), total: rows.length, truncated: hasMore,
                ...(hasMore && { nextCursor: journalCursorEncode({ fingerprint, path: notes[nextEnd - 1].path }) }),
            };
            if (JSON.stringify(candidate).length > maxChars)
                break;
            end = nextEnd;
        }
        const hasMore = end < rows.length;
        return {
            entries: rows.slice(start, end), total: rows.length, truncated: hasMore,
            ...(hasMore && end > start && { nextCursor: journalCursorEncode({ fingerprint, path: notes[end - 1].path }) }),
        };
    }
    async readJournalEntry(params) {
        const principal = requireAgent(params.principal);
        const entry = await this.findJournalEntry(principal.agentId, params.entryId);
        if (params.expectedRevision !== undefined && params.expectedRevision !== entry.revision) {
            throw new Error('Journal entry revision changed; reread the entry before continuing');
        }
        const path = this.access.toPublicPath(entry.path);
        const prefix = entry.originalContent.slice(0, entry.originalContent.length - entry.content.length);
        const startLine = (prefix.match(/\n/g) || []).length + 1;
        const endLine = startLine + (entry.content.match(/\n/g) || []).length;
        return fitJournalResponse({
            path,
            fm: entry.frontmatter,
            revision: entry.revision,
        }, entry.content, journalResponseBudget(params.maxChars, DEFAULT_JOURNAL_MAX_CHARS), {
            endpointId: endpointIdForTool('read_note_lines'),
            arguments: { path, startLine, endLine, expectedRevision: entry.revision, maxChars: DEFAULT_JOURNAL_MAX_CHARS },
        });
    }
    async readBlogPost(slug) {
        const path = blogPath(slug);
        const note = await this.fileSystem.readNote(path);
        if (note.frontmatter.mcpvault_type !== 'blog_post')
            throw new Error(`Not a community blog post: ${slug}`);
        if (isModerationHidden(note.frontmatter))
            throw new Error('This community post is unavailable because it was hidden by moderation');
        return { path, note };
    }
    async publishBlogPost(params) {
        const principal = requirePublisher(params.principal);
        const slug = normalizeScopeId(params.slug, 'slug');
        const title = String(params.title || '').trim();
        const content = String(params.content ?? '').trim();
        const status = String(params.status || 'published').trim().toLowerCase();
        if (!title || !content)
            throw new Error('title and content are required');
        if (!POST_STATUSES.has(status))
            throw new Error('status must be draft, published, or archived');
        if (!params.expectedRevision)
            throw new Error("expectedRevision is required; use 'missing' for a new post");
        const path = blogPath(slug);
        let existing;
        if (await this.fileSystem.noteExists(path))
            existing = await this.readBlogPost(slug);
        if (existing && existing.note.frontmatter.author !== identity(principal)) {
            throw new Error('Only the original post author can update this post');
        }
        const category = String(params.category ?? existing?.note.frontmatter.category ?? 'discussion').trim().toLowerCase();
        if (!COMMUNITY_POST_CATEGORIES.includes(category))
            throw new Error(`category must be one of: ${COMMUNITY_POST_CATEGORIES.join(', ')}`);
        const sourcePaths = params.sourcePaths === undefined
            ? cleanFeedbackSourcePaths(existing?.note.frontmatter.source_paths)
            : cleanFeedbackSourcePaths(params.sourcePaths);
        if (category === 'feedback' && sourcePaths.length === 0) {
            throw new Error('feedback posts must include sourcePaths with one or more repository-relative source code locations');
        }
        if (category === 'forum' && !String(params.blockedTask ?? existing?.note.frontmatter.blocked_task ?? '').trim()) {
            throw new Error('forum posts must include blockedTask so other agents know what is blocked');
        }
        const seriesId = params.seriesId === undefined ? existing?.note.frontmatter.series_id : (params.seriesId ? normalizeScopeId(params.seriesId, 'seriesId') : undefined);
        const seriesOrder = params.seriesOrder === undefined ? existing?.note.frontmatter.series_order : Number(params.seriesOrder);
        if (seriesId && (!Number.isInteger(seriesOrder) || Number(seriesOrder) < 1))
            throw new Error('seriesOrder must be a positive integer when seriesId is set');
        const relatedPosts = params.relatedPosts === undefined ? (existing?.note.frontmatter.related_posts || []) : (Array.isArray(params.relatedPosts) ? params.relatedPosts.map(value => publicPostReference(String(value))) : []);
        const duplicateOf = params.duplicateOf === undefined ? existing?.note.frontmatter.duplicate_of : (params.duplicateOf ? publicPostReference(params.duplicateOf) : undefined);
        let guards = [];
        const validateRelated = async () => {
            const byPath = new Map();
            for (const related of relatedPosts) {
                const relatedNote = await this.fileSystem.readNote(String(related));
                if (relatedNote.frontmatter.mcpvault_type !== 'blog_post' || isModerationHidden(relatedNote.frontmatter))
                    throw new Error(`related post is unavailable: ${related}`);
                byPath.set(String(related), { path: String(related), expectedRevision: relatedNote.revision });
            }
            if (duplicateOf) {
                const duplicateNote = await this.fileSystem.readNote(String(duplicateOf));
                if (duplicateNote.frontmatter.mcpvault_type !== 'blog_post' || isModerationHidden(duplicateNote.frontmatter))
                    throw new Error('duplicateOf is unavailable');
                byPath.set(String(duplicateOf), { path: String(duplicateOf), expectedRevision: duplicateNote.revision });
            }
            guards = Array.from(byPath.values());
        };
        await validateRelated();
        let normalizedReferences = await this.references.validateAndNormalize(params.references ?? existing?.note.frontmatter.references, path, principal, content);
        const tags = cleanTags(params.tags ?? existing?.note.frontmatter.tags);
        const seriesTitle = seriesId && (params.seriesTitle || existing?.note.frontmatter.series_title)
            ? String(params.seriesTitle || existing?.note.frontmatter.series_title).trim().slice(0, 180)
            : undefined;
        const feedbackType = params.feedbackType === undefined ? undefined : String(params.feedbackType).trim().slice(0, 120);
        const reproduction = params.reproduction === undefined ? undefined : String(params.reproduction).trim().slice(0, 1000);
        const proposedChange = params.proposedChange === undefined ? undefined : String(params.proposedChange).trim().slice(0, 1000);
        const blockedTask = category === 'forum' ? String(params.blockedTask ?? existing?.note.frontmatter.blocked_task ?? '').trim().slice(0, 500) : undefined;
        const attempted = params.attempted === undefined ? undefined : String(params.attempted).trim().slice(0, 1000);
        const helpWanted = params.helpWanted === undefined ? undefined : String(params.helpWanted).trim().slice(0, 1000);
        const environment = params.environment === undefined ? undefined : String(params.environment).trim().slice(0, 500);
        const request = preparePublicCreateRequest({
            principal, requestId: params.requestId, action: 'community.post', generatedPrefix: 'post', requestedTargetId: slug,
            payload: { slug, title, content, status, tags, references: normalizedReferences, category, seriesId, seriesTitle, seriesOrder,
                relatedPosts, duplicateOf, feedbackType, sourcePaths, reproduction, proposedChange, blockedTask, attempted, helpWanted, environment },
        });
        const body = `${content}\n`;
        const makeFrontmatter = (timestamp) => ({
            ...(existing?.note.frontmatter || {}), mcpvault_type: 'blog_post', post_id: slug, title,
            author: existing?.note.frontmatter.author || identity(principal), author_role: existing?.note.frontmatter.author_role || principal.role, ...ownershipMetadata(principal),
            status, tags, category,
            ...(seriesId && { series_id: seriesId, ...(seriesTitle && { series_title: seriesTitle }), series_order: Number(seriesOrder) }),
            ...(!seriesId && existing?.note.frontmatter.series_id && { series_id: null, series_title: null, series_order: null }),
            related_posts: relatedPosts, ...(duplicateOf ? { duplicate_of: duplicateOf } : {}),
            ...(category === 'feedback' && { source_paths: sourcePaths, ...(feedbackType !== undefined && { feedback_type: feedbackType }),
                ...(reproduction !== undefined && { reproduction }), ...(proposedChange !== undefined && { proposed_change: proposedChange }) }),
            ...(category === 'forum' && { blocked_task: blockedTask, ...(attempted !== undefined && { attempted }),
                ...(helpWanted !== undefined && { help_wanted: helpWanted }), ...(environment !== undefined && { environment }) }),
            references: normalizedReferences,
            ...(existing ? { updated_at: timestamp } : { created_at: timestamp, updated_at: timestamp, workflow_status: 'open' }),
        });
        const resultFor = (revision, frontmatter, created) => ({
            success: true, created, slug, path, status, category,
            ...(category === 'feedback' && { sourcePaths }), ...(category === 'forum' && { blockedTask: frontmatter.blocked_task }), revision,
        });
        if (!request) {
            const frontmatter = makeFrontmatter(now());
            const receipt = await this.fileSystem.writeNoteWithReceipt({ path, content: body, frontmatter, expectedRevision: params.expectedRevision });
            return resultFor(receipt.revision, frontmatter, !existing);
        }
        return runPublicCreate({
            fileSystem: this.fileSystem, principal, request, targetPath: path, participationActions: ['initiate'], topicMetadata: { title, tags },
            revalidate: async () => {
                await validateRelated();
                normalizedReferences = await this.references.validateAndNormalize(params.references ?? existing?.note.frontmatter.references, path, principal, content);
                if (await this.fileSystem.noteExists(path)) {
                    const current = await this.readBlogPost(slug);
                    if (current.note.frontmatter.author !== identity(principal))
                        throw new Error('Only the original post author can update this post');
                }
                else if (params.expectedRevision !== 'missing') {
                    throw new Error("requestId is only available for creation with expectedRevision='missing'");
                }
                return { parentPaths: guards.map(guard => guard.path) };
            },
            create: async (participationGuard) => {
                if (existing)
                    throw new Error('requestId cannot be used to update a community post');
                const frontmatter = attachPublicCreateRequest(request, makeFrontmatter(now()), body);
                const allGuards = [...guards, ...(participationGuard ? [participationGuard] : [])];
                const receipt = allGuards.length
                    ? await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt({ path, content: body, frontmatter, expectedRevision: 'missing' }, allGuards)
                    : await this.fileSystem.writeNoteWithReceipt({ path, content: body, frontmatter, expectedRevision: 'missing' });
                return resultFor(receipt.revision, frontmatter, true);
            },
            replay: note => {
                if (note.frontmatter.mcpvault_type !== 'blog_post' || note.frontmatter.post_id !== slug || note.frontmatter.author !== identity(principal)) {
                    throw new Error('Public request result is unavailable');
                }
                return resultFor(note.revision, note.frontmatter, true);
            },
        });
    }
    async deleteBlogPost(params) {
        const principal = requirePublisher(params.principal);
        const slug = normalizeScopeId(params.slug, 'slug');
        const { path, note } = await this.readBlogPost(slug);
        if (note.frontmatter.author !== identity(principal))
            throw new Error('Only the original post author can delete this post');
        if (!params.expectedRevision)
            throw new Error('expectedRevision is required; read the post first');
        const timestamp = now();
        await this.fileSystem.writeNote({
            path,
            content: '[deleted]\n',
            frontmatter: {
                ...note.frontmatter,
                status: 'archived',
                content_status: 'deleted',
                workflow_status: 'closed',
                deleted_at: timestamp,
                updated_at: timestamp,
            },
            expectedRevision: params.expectedRevision,
        });
        const updated = await this.fileSystem.readNote(path);
        return { success: true, slug, path, deleted: true, status: 'archived', revision: updated.revision };
    }
    async listBlogPosts(params) {
        const requestedStatus = String(params.status || 'published').trim().toLowerCase();
        if (requestedStatus !== 'all' && !POST_STATUSES.has(requestedStatus))
            throw new Error('status must be published, draft, archived, or all');
        const filters = {
            mcpvault_type: 'blog_post',
            ...(requestedStatus !== 'all' && { status: requestedStatus }),
            ...(params.author && { author: String(params.author).trim().toLowerCase() }),
            ...(params.category && { category: String(params.category).trim().toLowerCase() }),
            ...(params.seriesId && { series_id: normalizeScopeId(params.seriesId, 'seriesId') }),
        };
        const caller = params.principal ? identity(params.principal) : undefined;
        const visible = (note) => {
            if (isModerationHidden(note.frontmatter))
                return false;
            const status = String(note.frontmatter.status || 'published');
            if (requestedStatus !== 'all' && status !== requestedStatus)
                return false;
            if (status === 'draft' && caller !== note.frontmatter.author)
                return false;
            return matchesWorkflowFilter(note.frontmatter, params.workflowStatus || 'active');
        };
        const limit = Math.min(Math.max(Number(params.limit || 50), 1), 500);
        const window = await queryWindow(this.fileSystem, {
            pathPrefix: BLOG_ROOT, filters,
            sortBy: 'updated_at', sortOrder: 'desc',
            limit,
        }, visible);
        const total = await this.fileSystem.countNotes({ pathPrefix: BLOG_ROOT, filters }, undefined, visible);
        return this.formatBlogPosts(window.notes, params, window.truncated || total > window.notes.length, total);
    }
    /** Read the published post set once for pulse's own-post and active-post signals. */
    async pulsePosts(params) {
        const snapshot = this.notifications ? await this.notifications.discoverySnapshot() : undefined;
        let ownPublishedPosts = 0;
        let activeTotal = 0;
        let activeNotes = [];
        let queryTruncated = false;
        if (snapshot) {
            const visibleNotes = snapshot.posts.filter(note => !isModerationHidden(note.frontmatter) && String(note.frontmatter.status || 'published') === 'published');
            ownPublishedPosts = visibleNotes.filter(note => String(note.frontmatter.author || '').toLowerCase() === params.author.toLowerCase()).length;
            activeNotes = visibleNotes.filter(note => matchesWorkflowFilter(note.frontmatter, 'active'));
            activeTotal = activeNotes.length;
        }
        else {
            const activeLimit = Math.min(Math.max(params.limit, 1), 500);
            for await (const note of iterateNotes(this.fileSystem, { pathPrefix: BLOG_ROOT, filters: { mcpvault_type: 'blog_post', status: 'published' }, sortBy: 'updated_at', sortOrder: 'desc' })) {
                if (isModerationHidden(note.frontmatter))
                    continue;
                if (String(note.frontmatter.author || '').toLowerCase() === params.author.toLowerCase())
                    ownPublishedPosts += 1;
                if (matchesWorkflowFilter(note.frontmatter, 'active')) {
                    activeTotal += 1;
                    if (activeNotes.length < activeLimit)
                        activeNotes.push(note);
                }
            }
            queryTruncated = activeNotes.length < activeTotal;
        }
        const active = await this.formatBlogPosts(activeNotes, {
            principal: params.principal,
            limit: params.limit,
            maxChars: Math.min(params.maxChars, 6000),
            includeExcerpt: true,
            excerptMaxChars: 240,
        }, queryTruncated, activeTotal);
        const feedbackNotes = activeNotes.filter(note => String(note.frontmatter.category || '').toLowerCase() === 'feedback');
        const forumNotes = activeNotes.filter(note => String(note.frontmatter.category || '').toLowerCase() === 'forum');
        const [feedback, forum] = await Promise.all([
            this.formatBlogPosts(feedbackNotes, { principal: params.principal, limit: Math.min(params.limit, 3), maxChars: Math.min(params.maxChars, 2500), includeExcerpt: true, excerptMaxChars: 240 }, false, feedbackNotes.length),
            this.formatBlogPosts(forumNotes, { principal: params.principal, limit: Math.min(params.limit, 3), maxChars: Math.min(params.maxChars, 2500), includeExcerpt: true, excerptMaxChars: 240 }, false, forumNotes.length),
        ]);
        return {
            ownPublishedPosts,
            activePosts: active.posts,
            activeTotal: active.total,
            activeTruncated: active.truncated,
            feedbackPosts: feedback.posts,
            feedbackTotal: feedbackNotes.length,
            forumPosts: forum.posts,
            forumTotal: forumNotes.length,
        };
    }
    async formatBlogPosts(visibleNotes, params, queryTruncated, total = visibleNotes.length) {
        const limit = Math.min(Math.max(Number(params.limit || 50), 1), 500);
        const selectedNotes = visibleNotes.slice(0, limit);
        const excerptByPath = new Map();
        if (params.includeExcerpt) {
            const excerptLength = Math.min(Math.max(Number(params.excerptMaxChars ?? 280), 1), 1000);
            const excerpts = await Promise.all(selectedNotes.map(async (note) => {
                try {
                    const full = await this.fileSystem.readNote(note.path);
                    return [note.path, full.content.slice(0, excerptLength)];
                }
                catch {
                    return [note.path, ''];
                }
            }));
            for (const [path, excerpt] of excerpts)
                excerptByPath.set(path, excerpt);
        }
        const reputations = await this.reputation.getMany(selectedNotes.map(note => String(note.frontmatter.author || '')));
        const viewerReputation = params.principal ? await this.reputation.getForPrincipal(params.principal) : undefined;
        const entries = selectedNotes.map(note => ({
            path: note.path,
            slug: note.frontmatter.post_id,
            title: note.frontmatter.title,
            author: note.frontmatter.author,
            status: note.frontmatter.status,
            tags: note.frontmatter.tags || [],
            category: note.frontmatter.category || 'discussion',
            seriesId: note.frontmatter.series_id,
            seriesTitle: note.frontmatter.series_title,
            seriesOrder: note.frontmatter.series_order,
            relatedPosts: note.frontmatter.related_posts || [],
            duplicateOf: note.frontmatter.duplicate_of,
            ...(note.frontmatter.category === 'feedback' && {
                sourcePaths: Array.isArray(note.frontmatter.source_paths) ? note.frontmatter.source_paths : [],
                feedbackType: note.frontmatter.feedback_type,
                reproduction: note.frontmatter.reproduction,
                proposedChange: note.frontmatter.proposed_change,
            }),
            ...(note.frontmatter.category === 'forum' && {
                blockedTask: note.frontmatter.blocked_task,
                attempted: note.frontmatter.attempted,
                helpWanted: note.frontmatter.help_wanted,
                environment: note.frontmatter.environment,
            }),
            createdAt: note.frontmatter.created_at,
            updatedAt: note.frontmatter.updated_at,
            workflowStatus: workflowStatus(note.frontmatter),
            workflowStatusBy: note.frontmatter.workflow_status_by,
            workflowStatusReason: note.frontmatter.workflow_status_reason,
            workflowStatusUpdatedAt: note.frontmatter.workflow_status_updated_at,
            moderationStatus: moderationStatus(note.frontmatter),
            authorLevel: reputations.get(String(note.frontmatter.author || '').toLowerCase())?.level ?? 0,
            authorLevelLabel: reputations.get(String(note.frontmatter.author || '').toLowerCase())?.label ?? '뉴비',
            ...(params.includeExcerpt && { excerpt: excerptByPath.get(note.path) || '' }),
        }));
        const bounded = boundItems(entries, Math.min(Math.max(Number(params.maxChars ?? 6000), 512), 20000));
        return { posts: bounded.items, ...(viewerReputation && { viewerLevel: viewerReputation.level, viewerXp: viewerReputation.xp, viewerLevelLabel: viewerReputation.label }), total, truncated: queryTruncated || total > visibleNotes.length || bounded.truncated };
    }
    async getBlogPost(params) {
        const { path, note } = await this.readBlogPost(params.slug);
        const caller = params.principal ? identity(params.principal) : undefined;
        if (note.frontmatter.status === 'draft' && caller !== note.frontmatter.author) {
            throw new Error('This draft is private to its author');
        }
        const comments = await this.listBlogComments({ slug: params.slug, ...(params.principal && { principal: params.principal }), limit: params.includeComments ? (params.commentLimit ?? 10) : 1, maxChars: params.commentMaxChars ?? 4000, includeThreadContext: params.includeThreadContext !== false });
        const authorReputation = (await this.reputation.getMany([String(note.frontmatter.author || '')])).get(String(note.frontmatter.author || '').toLowerCase());
        const viewerReputation = params.principal ? await this.reputation.getForPrincipal(params.principal) : undefined;
        return { path, fm: note.frontmatter, content: note.content, revision: note.revision, commentCount: comments.total,
            authorLevel: authorReputation?.level ?? 0,
            authorLevelLabel: authorReputation?.label ?? '뉴비',
            ...(viewerReputation && { viewerLevel: viewerReputation.level, viewerXp: viewerReputation.xp, viewerLevelLabel: viewerReputation.label }),
            workflowStatus: workflowStatus(note.frontmatter),
            ...(params.includeComments && { comments: comments.comments, commentsTruncated: comments.truncated }),
            resolvedReferences: await this.references.resolve(note.frontmatter.references, params.principal), };
    }
    /** Read one comment directly so context-oriented callers do not need to scan a timeline. */
    async getBlogComment(params) {
        const slug = normalizeScopeId(params.slug, 'slug');
        const commentId = normalizeScopeId(params.commentId, 'commentId');
        const post = await this.readBlogPost(slug);
        const caller = params.principal ? identity(params.principal) : undefined;
        if (post.note.frontmatter.status === 'draft' && caller !== post.note.frontmatter.author) {
            throw new Error('This draft is private to its author');
        }
        const path = commentPath(slug, commentId);
        const note = await this.fileSystem.readNote(path);
        if (note.frontmatter.mcpvault_type !== 'blog_comment')
            throw new Error(`Not a blog comment: ${commentId}`);
        if (isModerationHidden(note.frontmatter))
            throw new Error('This community comment is unavailable because it was hidden by moderation');
        const authorReputation = (await this.reputation.getMany([String(note.frontmatter.author || '')])).get(String(note.frontmatter.author || '').toLowerCase());
        return {
            path,
            fm: note.frontmatter,
            commentId,
            postId: slug,
            content: note.content,
            revision: note.revision,
            authorLevel: authorReputation?.level ?? 0,
            authorLevelLabel: authorReputation?.label ?? '뉴비',
            ...(params.includeReferences !== false && { resolvedReferences: await this.references.resolve(note.frontmatter.references, params.principal) }),
        };
    }
    async commentOnBlogPost(params) {
        const principal = requirePublisher(params.principal);
        const slug = normalizeScopeId(params.slug, 'slug');
        const post = await this.readBlogPost(slug);
        if (post.note.frontmatter.status !== 'published')
            throw new Error('Comments are available only on published posts');
        const content = requireShortCommunityText(params.content);
        const stance = debateStance(params.stance, post.note.frontmatter.category === 'agora');
        const replyTo = params.replyTo ? normalizeScopeId(params.replyTo, 'replyTo') : undefined;
        const requestedCommentId = params.commentId ? normalizeScopeId(params.commentId, 'commentId') : undefined;
        const request = preparePublicCreateRequest({
            principal, requestId: params.requestId, action: 'community.comment', generatedPrefix: 'comment',
            ...(requestedCommentId && { requestedTargetId: requestedCommentId }),
            payload: { slug, content, stance, replyTo, commentId: requestedCommentId, references: params.references },
        });
        const commentId = request?.targetId || requestedCommentId || `comment-${randomUUID().slice(0, 10)}`;
        const path = commentPath(slug, commentId);
        let references = [];
        let guards = [];
        return runPublicCreate({
            fileSystem: this.fileSystem, principal, request, targetPath: path, participationActions: ['respond'],
            revalidate: async () => {
                const currentPost = await this.readBlogPost(slug);
                if (currentPost.note.frontmatter.status !== 'published')
                    throw new Error('Comments are available only on published posts');
                if (debateStance(params.stance, currentPost.note.frontmatter.category === 'agora') !== stance)
                    throw new Error('Post category changed; reread before commenting');
                guards = [{ path: currentPost.path, expectedRevision: currentPost.note.revision }];
                if (replyTo) {
                    const parentPath = commentPath(slug, replyTo);
                    const parent = await this.fileSystem.readNote(parentPath);
                    if (parent.frontmatter.mcpvault_type !== 'blog_comment' || parent.frontmatter.post_id !== slug || isModerationHidden(parent.frontmatter)) {
                        throw new Error('Reply target is unavailable');
                    }
                    guards.push({ path: parentPath, expectedRevision: parent.revision });
                }
                references = await this.references.validateAndNormalize(params.references, path, principal, content);
                return { parentPaths: guards.map(guard => guard.path) };
            },
            create: async (participationGuard) => {
                const timestamp = now();
                const body = `${content}\n`;
                const frontmatter = attachPublicCreateRequest(request, {
                    mcpvault_type: 'blog_comment', comment_id: commentId, post_id: slug,
                    author: identity(principal), author_role: principal.role, ...ownershipMetadata(principal), created_at: timestamp, updated_at: timestamp,
                    mentions: extractMentions(content), references, workflow_status: 'open', ...(stance && { stance }), ...(replyTo && { reply_to: replyTo }),
                }, body);
                const receipt = await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt({ path, content: body, frontmatter, expectedRevision: 'missing' }, [...guards, ...(participationGuard ? [participationGuard] : [])]);
                return { success: true, commentId, postId: slug, path, revision: receipt.revision };
            },
            replay: note => {
                if (note.frontmatter.mcpvault_type !== 'blog_comment' || note.frontmatter.comment_id !== commentId
                    || note.frontmatter.post_id !== slug || note.frontmatter.author !== identity(principal))
                    throw new Error('Public request result is unavailable');
                return { success: true, commentId, postId: slug, path, revision: note.revision };
            },
        });
    }
    async editBlogComment(params) {
        const principal = requirePublisher(params.principal);
        const slug = normalizeScopeId(params.slug, 'slug');
        const commentId = normalizeScopeId(params.commentId, 'commentId');
        const path = commentPath(slug, commentId);
        const note = await this.fileSystem.readNote(path);
        if (note.frontmatter.mcpvault_type !== 'blog_comment')
            throw new Error(`Not a blog comment: ${commentId}`);
        if (note.frontmatter.author !== identity(principal))
            throw new Error('Only the original comment author can edit this comment');
        if (!params.expectedRevision)
            throw new Error('expectedRevision is required; read the comment first');
        const text = requireShortCommunityText(params.content);
        const post = await this.readBlogPost(slug);
        const stance = debateStance(params.stance ?? note.frontmatter.stance, post.note.frontmatter.category === 'agora');
        const references = await this.references.validateAndNormalize(params.references ?? note.frontmatter.references, path, principal, text);
        await this.fileSystem.writeNote({ path, content: `${text}\n`, frontmatter: { ...note.frontmatter, content_status: 'published', mentions: extractMentions(text), references, ...(stance ? { stance } : {}), updated_at: now() }, expectedRevision: params.expectedRevision });
        const updated = await this.fileSystem.readNote(path);
        return { success: true, commentId, postId: slug, revision: updated.revision };
    }
    async deleteBlogComment(params) {
        const principal = requirePublisher(params.principal);
        const slug = normalizeScopeId(params.slug, 'slug');
        const commentId = normalizeScopeId(params.commentId, 'commentId');
        const path = commentPath(slug, commentId);
        const note = await this.fileSystem.readNote(path);
        if (note.frontmatter.mcpvault_type !== 'blog_comment')
            throw new Error(`Not a blog comment: ${commentId}`);
        if (note.frontmatter.author !== identity(principal))
            throw new Error('Only the original comment author can delete this comment');
        if (!params.expectedRevision)
            throw new Error('expectedRevision is required; read the comment first');
        await this.fileSystem.writeNote({ path, content: '[deleted]\n', frontmatter: { ...note.frontmatter, content_status: 'deleted', deleted_at: now(), updated_at: now() }, expectedRevision: params.expectedRevision });
        const updated = await this.fileSystem.readNote(path);
        return { success: true, commentId, postId: slug, deleted: true, revision: updated.revision };
    }
    async listBlogComments(params) {
        const slug = normalizeScopeId(params.slug, 'slug');
        const limit = windowNumber(params.limit, 20, 100);
        const maxChars = windowNumber(params.maxChars, 6000, 20000);
        const contextBefore = windowNumber(params.contextBefore, 2, 20) - 1;
        const filters = { mcpvault_type: 'blog_comment' };
        const visible = (note) => !isModerationHidden(note.frontmatter) && matchesWorkflowFilter(note.frontmatter, params.workflowStatus || 'all');
        let notes;
        let total;
        let queryTruncated;
        if (params.afterCommentId) {
            const commentId = normalizeScopeId(params.afterCommentId, 'afterCommentId');
            const cursorResult = await this.fileSystem.queryNotes({
                pathPrefix: commentsRoot(slug), filters: { ...filters, comment_id: commentId },
                sortBy: 'created_at', sortOrder: 'asc', limit: 1, includeTotal: false,
            });
            const cursorNote = cursorResult.notes[0];
            if (!cursorNote || !visible(cursorNote))
                throw new Error(`afterCommentId was not found in post: ${params.afterCommentId}`);
            const cursor = cursorNote.frontmatter.created_at === undefined
                ? { path: cursorNote.path, missing: true }
                : { path: cursorNote.path, value: cursorNote.frontmatter.created_at };
            const before = contextBefore > 0
                ? await queryWindow(this.fileSystem, { pathPrefix: commentsRoot(slug), filters, sortBy: 'created_at', sortOrder: 'desc', limit: contextBefore, after: cursor }, visible)
                : { notes: [], truncated: false };
            // Keep the requested number of new comments independent from the
            // context overlap. Otherwise limit=1 can return an older context item
            // and hand the caller a backwards cursor.
            const forwardLimit = limit;
            const forward = await queryWindow(this.fileSystem, { pathPrefix: commentsRoot(slug), filters, sortBy: 'created_at', sortOrder: 'asc', limit: forwardLimit, after: cursor }, visible);
            notes = [...before.notes].reverse();
            notes.push(cursorNote, ...forward.notes);
            total = await this.fileSystem.countNotes({ pathPrefix: commentsRoot(slug), filters }, undefined, visible);
            queryTruncated = before.truncated || forward.truncated;
        }
        else {
            const window = await queryWindow(this.fileSystem, {
                pathPrefix: commentsRoot(slug), filters,
                sortBy: 'created_at', sortOrder: 'asc', limit,
            }, visible);
            notes = window.notes;
            total = await this.fileSystem.countNotes({ pathPrefix: commentsRoot(slug), filters }, undefined, visible);
            queryTruncated = window.truncated;
        }
        const reputations = await this.reputation.getMany(notes.map(note => String(note.frontmatter.author || '')));
        const viewerReputation = params.principal ? await this.reputation.getForPrincipal(params.principal) : undefined;
        const cursorIndex = params.afterCommentId
            ? notes.findIndex(note => note.frontmatter.comment_id === normalizeScopeId(params.afterCommentId, 'afterCommentId'))
            : -1;
        if (params.afterCommentId && cursorIndex < 0)
            throw new Error(`afterCommentId was not found in post: ${params.afterCommentId}`);
        const start = cursorIndex >= 0 ? Math.max(0, cursorIndex - contextBefore) : Math.max(0, notes.length - limit);
        const selected = [];
        const selectedLimit = cursorIndex >= 0 ? limit + contextBefore + 1 : limit;
        let usedChars = 0;
        const candidates = notes.slice(start);
        let stop = false;
        for (let batchStart = 0; batchStart < candidates.length && selected.length < selectedLimit && !stop; batchStart += 10) {
            const batchNotes = candidates.slice(batchStart, batchStart + 10);
            const fullByPath = await readNotesInBatches(this.fileSystem, batchNotes.map(note => note.path));
            for (const note of batchNotes) {
                if (selected.length >= selectedLimit)
                    break;
                const full = fullByPath.get(note.path);
                if (!full)
                    continue;
                const contentLength = Array.from(full.content).length;
                if (selected.length > 0 && usedChars + contentLength > maxChars) {
                    stop = true;
                    break;
                }
                selected.push({ note, content: full.content, revision: full.revision });
                usedChars += contentLength;
            }
        }
        const last = selected.at(-1)?.note.frontmatter.comment_id;
        const selectedByPath = new Map(selected.map(item => [item.note.path, {
                path: item.note.path,
                frontmatter: item.note.frontmatter,
                content: item.content,
                revision: item.revision,
            }]));
        const parentPaths = params.includeThreadContext === false
            ? []
            : Array.from(new Set(selected
                .map(({ note }) => note.frontmatter.reply_to ? commentPath(slug, String(note.frontmatter.reply_to)) : undefined)
                .filter((path) => Boolean(path))))
                .filter(path => !selectedByPath.has(path));
        const parentByPath = new Map(selectedByPath);
        for (const [path, parent] of await readNotesInBatches(this.fileSystem, parentPaths))
            parentByPath.set(path, parent);
        return {
            comments: selected.map(({ note, content, revision }) => ({
                path: note.path,
                commentId: note.frontmatter.comment_id,
                postId: note.frontmatter.post_id,
                author: note.frontmatter.author,
                replyTo: note.frontmatter.reply_to,
                createdAt: note.frontmatter.created_at,
                content,
                revision,
                references: note.frontmatter.references || [],
                stance: note.frontmatter.stance,
                workflowStatus: workflowStatus(note.frontmatter),
                workflowStatusBy: note.frontmatter.workflow_status_by,
                workflowStatusReason: note.frontmatter.workflow_status_reason,
                workflowStatusUpdatedAt: note.frontmatter.workflow_status_updated_at,
                moderationStatus: moderationStatus(note.frontmatter),
                authorLevel: reputations.get(String(note.frontmatter.author || '').toLowerCase())?.level ?? 0,
                authorLevelLabel: reputations.get(String(note.frontmatter.author || '').toLowerCase())?.label ?? '뉴비',
                ...(params.includeThreadContext !== false && note.frontmatter.reply_to && { parent: this.commentContextFromNote(slug, String(note.frontmatter.reply_to), parentByPath.get(commentPath(slug, String(note.frontmatter.reply_to)))) }),
            })),
            ...(viewerReputation && { viewerLevel: viewerReputation.level, viewerXp: viewerReputation.xp, viewerLevelLabel: viewerReputation.label }),
            total,
            truncated: start > 0 || queryTruncated || start + selected.length < notes.length || total > notes.length,
            nextCursor: last,
            contextBefore: cursorIndex >= 0 ? contextBefore + 1 : 0,
        };
    }
    commentContextFromNote(slug, commentId, parent) {
        const path = commentPath(slug, commentId);
        if (!parent)
            throw new Error(`Reply target was not readable: ${commentId}`);
        if (parent.frontmatter.mcpvault_type !== 'blog_comment')
            throw new Error(`Reply target is not a blog comment: ${commentId}`);
        if (isModerationHidden(parent.frontmatter))
            return { path, commentId: parent.frontmatter.comment_id, postId: parent.frontmatter.post_id, author: parent.frontmatter.author, createdAt: parent.frontmatter.created_at, content: '[moderated]', replyTo: parent.frontmatter.reply_to, workflowStatus: workflowStatus(parent.frontmatter), moderated: true };
        return { path, commentId: parent.frontmatter.comment_id, postId: parent.frontmatter.post_id, author: parent.frontmatter.author, createdAt: parent.frontmatter.created_at, content: parent.content, replyTo: parent.frontmatter.reply_to, workflowStatus: workflowStatus(parent.frontmatter) };
    }
    async listMentions(params) {
        const principal = requirePublisher(params.principal);
        const targets = new Set([identity(principal), principal.modelId, ...(principal.agentId ? [principal.agentId] : [])]);
        const notes = this.notifications
            ? await this.notifications.mentionCandidates(targets, params.includeClosed === true)
            : undefined;
        const noteStream = notes
            ? (async function* () { yield* notes; }())
            : mergeMentionNotes(this.fileSystem, targets, params.includeClosed === true);
        const limit = windowNumber(params.limit, 20, 100);
        const maxChars = windowNumber(params.maxChars, 6000, 20000);
        const mentions = [];
        let usedChars = 0;
        let total = 0;
        let cursorFound = !params.afterMentionId;
        let outputExhausted = false;
        const contextBefore = Math.min(Math.max(Number(params.contextBefore ?? 1), 0), 3);
        const contextAfter = Math.min(Math.max(Number(params.contextAfter ?? 1), 0), 3);
        const hydrated = new Map();
        const timelines = new Map();
        const hydrate = async (paths) => {
            const missing = Array.from(new Set(paths)).filter(path => !hydrated.has(path));
            for (const [path, note] of await readNotesInBatches(this.fileSystem, missing))
                hydrated.set(path, note);
        };
        const timelineFor = async (note) => {
            const isChat = note.frontmatter.mcpvault_type === 'chat_message';
            const root = isChat
                ? `Community/ChatMessages/${note.frontmatter.room_id}`
                : `Community/Comments/${note.frontmatter.post_id}`;
            const key = isChat ? 'message_id' : 'comment_id';
            const id = note.frontmatter[key];
            const cacheKey = `${root}|${key}|${String(id || '')}`;
            const cached = timelines.get(cacheKey);
            if (cached)
                return cached;
            const cursor = { path: note.path, value: note.frontmatter.created_at };
            const filters = { mcpvault_type: isChat ? 'chat_message' : 'blog_comment' };
            const [before, forward] = await Promise.all([
                contextBefore > 0
                    ? queryWindow(this.fileSystem, { pathPrefix: root, filters, sortBy: 'created_at', sortOrder: 'desc', limit: contextBefore, after: cursor }, item => !isModerationHidden(item.frontmatter))
                    : Promise.resolve({ notes: [], truncated: false }),
                contextAfter > 0
                    ? queryWindow(this.fileSystem, { pathPrefix: root, filters, sortBy: 'created_at', sortOrder: 'asc', limit: contextAfter, after: cursor }, item => !isModerationHidden(item.frontmatter))
                    : Promise.resolve({ notes: [], truncated: false }),
            ]);
            const timeline = { key, notes: [...before.notes.reverse(), note, ...forward.notes] };
            timelines.set(cacheKey, timeline);
            return timeline;
        };
        for await (const note of noteStream) {
            total += 1;
            const noteId = note.frontmatter.message_id || note.frontmatter.comment_id;
            if (!cursorFound) {
                if (noteId === params.afterMentionId)
                    cursorFound = true;
                continue;
            }
            if (outputExhausted || mentions.length >= limit)
                continue;
            const full = hydrated.get(note.path) || await this.fileSystem.readNote(note.path);
            hydrated.set(note.path, full);
            const length = Array.from(full.content).length;
            const item = {
                path: note.path,
                kind: note.frontmatter.mcpvault_type === 'chat_message' ? 'chat_message' : 'blog_comment',
                roomId: note.frontmatter.room_id,
                postId: note.frontmatter.post_id,
                messageId: note.frontmatter.message_id,
                commentId: note.frontmatter.comment_id,
                author: note.frontmatter.author,
                createdAt: note.frontmatter.created_at,
                content: full.content,
                revision: full.revision,
                references: note.frontmatter.references || [],
                workflowStatus: workflowStatus(note.frontmatter),
                workflowStatusBy: note.frontmatter.workflow_status_by,
                workflowStatusReason: note.frontmatter.workflow_status_reason,
                workflowStatusUpdatedAt: note.frontmatter.workflow_status_updated_at,
            };
            if (contextBefore || contextAfter) {
                const timeline = await timelineFor(note);
                const id = note.frontmatter[timeline.key];
                const at = timeline.notes.findIndex(item => item.frontmatter[timeline.key] === id);
                const neighborPaths = [];
                for (let index = Math.max(0, at - contextBefore); index <= Math.min(timeline.notes.length - 1, at + contextAfter); index += 1) {
                    if (index !== at)
                        neighborPaths.push(timeline.notes[index].path);
                }
                await hydrate(neighborPaths);
                const context = [];
                for (let index = Math.max(0, at - contextBefore); index <= Math.min(timeline.notes.length - 1, at + contextAfter); index += 1) {
                    if (index === at || context.length >= contextBefore + contextAfter)
                        continue;
                    const neighbor = hydrated.get(timeline.notes[index].path);
                    if (!neighbor)
                        continue;
                    context.push({ path: timeline.notes[index].path, id: neighbor.frontmatter[timeline.key], author: neighbor.frontmatter.author, createdAt: neighbor.frontmatter.created_at, content: neighbor.content });
                }
                item.context = context;
            }
            const itemLength = length + (Array.isArray(item.context) ? item.context.reduce((sum, entry) => sum + Array.from(String(entry.content || '')).length, 0) : 0);
            if (mentions.length > 0 && usedChars + itemLength > maxChars) {
                outputExhausted = true;
                continue;
            }
            mentions.push(item);
            usedChars += itemLength;
        }
        if (params.afterMentionId && !cursorFound)
            throw new Error(`afterMentionId was not found in mention results: ${params.afterMentionId}`);
        const nextCursor = mentions.at(-1)?.messageId || mentions.at(-1)?.commentId;
        return { mentions, total, truncated: Boolean(params.afterMentionId) || total > mentions.length, nextCursor, targets: Array.from(targets) };
    }
}
