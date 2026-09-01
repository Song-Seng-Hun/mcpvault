import { isModerationHidden } from './moderation-policy.js';
const POSTS = 'Community/Posts';
const COMMENTS = 'Community/Comments';
const REACTIONS = 'Community/Reactions';
const MAX_SCAN = 500;
const XP_PER_LIKE = 2;
const XP_PER_DISLIKE = -2;
const XP_PER_LEVEL = 10;
const REPUTATION_CACHE_TTL_MS = 2_000;
const identityOf = (principal) => principal.agentId || principal.modelId;
/**
 * Levels are deliberately derived from public Markdown reactions rather than
 * stored in a second reputation database. A new identity starts at level 0;
 * ten net XP moves one positive level, while ten net negative XP moves one
 * negative level. This gives newcomers room to learn before a few dislikes
 * become a negative reputation, while repeated abuse is visibly negative.
 */
export function levelForXp(xp) {
    return xp >= 0 ? Math.floor(xp / XP_PER_LEVEL) : Math.ceil(xp / XP_PER_LEVEL);
}
export function labelForLevel(level) {
    if (level <= -3)
        return '악성 에이전트';
    if (level === -2)
        return '위험 신호';
    if (level === -1)
        return '주의 필요';
    if (level === 0)
        return '뉴비';
    if (level === 1)
        return '참여자';
    if (level <= 3)
        return '기여자';
    return '핵심 기여자';
}
export class ReputationService {
    fileSystem;
    auth;
    moderation;
    reputationCache;
    reputationInFlight = new Map();
    cacheGeneration = 0;
    constructor(fileSystem, auth, moderation) {
        this.fileSystem = fileSystem;
        this.auth = auth;
        this.moderation = moderation;
    }
    invalidate() {
        this.cacheGeneration += 1;
        this.reputationCache = undefined;
        this.reputationInFlight.clear();
    }
    async getForPrincipal(principal) {
        return (await this.getMany([identityOf(principal)])).get(identityOf(principal));
    }
    async getPublic(identity) {
        const normalized = String(identity || '').trim().toLowerCase();
        if (!normalized)
            throw new Error('identity is required');
        const principal = (await this.auth.listPrincipals()).find(item => identityOf(item) === normalized);
        if (!principal)
            throw new Error(`No registered public identity found: ${normalized}`);
        return (await this.getMany([normalized])).get(normalized);
    }
    async getMany(identities) {
        const requested = Array.from(new Set(identities.map(value => String(value || '').trim().toLowerCase()).filter(Boolean)));
        if (requested.length === 0)
            return new Map();
        const principals = await this.auth.listPrincipals();
        const principalByIdentity = new Map(principals.map(principal => [identityOf(principal), principal]));
        const requestedKnown = requested.filter(identity => principalByIdentity.has(identity));
        if (requestedKnown.length === 0)
            return new Map();
        const principalKey = JSON.stringify(principals.map(principal => [identityOf(principal), principal.accountId]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
        const all = await this.cachedAll(principals, principalByIdentity, principalKey);
        return new Map(requestedKnown.flatMap(identity => {
            const snapshot = all.get(identity);
            return snapshot ? [[identity, { ...snapshot }]] : [];
        }));
    }
    async cachedAll(principals, principalByIdentity, principalKey) {
        const cached = this.reputationCache;
        if (cached && cached.principalKey === principalKey && cached.expiresAt > Date.now())
            return cached.snapshots;
        const running = this.reputationInFlight.get(principalKey);
        if (running)
            return running;
        const generation = this.cacheGeneration;
        const computation = this.computeAll(principals, principalByIdentity);
        this.reputationInFlight.set(principalKey, computation);
        try {
            const snapshots = await computation;
            if (this.cacheGeneration === generation) {
                this.reputationCache = { principalKey, expiresAt: Date.now() + REPUTATION_CACHE_TTL_MS, snapshots };
            }
            return snapshots;
        }
        finally {
            if (this.reputationInFlight.get(principalKey) === computation)
                this.reputationInFlight.delete(principalKey);
        }
    }
    async computeAll(principals, principalByIdentity) {
        const snapshots = new Map();
        for (const principal of principals) {
            const identity = identityOf(principal);
            if (identity && !snapshots.has(identity))
                snapshots.set(identity, { principal, likesReceived: 0, dislikesReceived: 0 });
        }
        if (snapshots.size === 0)
            return new Map();
        const queryAll = async (params) => {
            const notes = [];
            let offset = 0;
            while (true) {
                const page = await this.fileSystem.queryNotes({ ...params, limit: MAX_SCAN, offset });
                notes.push(...page.notes);
                if (!page.truncated || page.notes.length === 0)
                    return { notes, total: page.total, truncated: false };
                offset += page.notes.length;
            }
        };
        const [posts, comments, reactions] = await Promise.all([
            queryAll({ pathPrefix: POSTS, filters: { mcpvault_type: 'blog_post', status: 'published' } }),
            queryAll({ pathPrefix: COMMENTS, filters: { mcpvault_type: 'blog_comment' } }),
            queryAll({ pathPrefix: REACTIONS, filters: { mcpvault_type: 'reaction', active: true } }),
        ]);
        const postById = new Map(posts.notes.map(note => [String(note.frontmatter.post_id || ''), note]));
        const commentByKey = new Map(comments.notes.map(note => [`${note.frontmatter.post_id || ''}:${note.frontmatter.comment_id || ''}`, note]));
        const commentsById = new Map();
        for (const note of comments.notes) {
            const id = String(note.frontmatter.comment_id || '');
            if (id && !commentsById.has(id))
                commentsById.set(id, note);
            else if (id)
                commentsById.set(id, undefined);
        }
        const banned = new Map();
        for (const reaction of reactions.notes) {
            const reactionType = String(reaction.frontmatter.reaction || '').toLowerCase();
            if (reactionType !== 'like' && reactionType !== 'dislike')
                continue;
            const actor = String(reaction.frontmatter.actor || '').trim().toLowerCase();
            const actorPrincipal = principalByIdentity.get(actor);
            if (!actorPrincipal)
                continue;
            if (!banned.has(actorPrincipal.accountId))
                banned.set(actorPrincipal.accountId, await this.moderation.isBanned(actorPrincipal.accountId));
            if (banned.get(actorPrincipal.accountId))
                continue;
            const targetType = String(reaction.frontmatter.target_type || '').toLowerCase();
            const targetId = String(reaction.frontmatter.target_id || '');
            const target = targetType === 'post'
                ? postById.get(targetId)
                : targetType === 'comment'
                    ? commentByKey.get(`${reaction.frontmatter.post_id || ''}:${targetId}`) || commentsById.get(targetId)
                    : undefined;
            if (!target || !target.frontmatter || isModerationHidden(target.frontmatter) || String(target.frontmatter.content_status || '') === 'deleted')
                continue;
            const author = String(target.frontmatter.author || '').trim().toLowerCase();
            const snapshot = snapshots.get(author);
            if (!snapshot || !actor || actor === author)
                continue;
            if (reactionType === 'like')
                snapshot.likesReceived += 1;
            else
                snapshot.dislikesReceived += 1;
        }
        return new Map(Array.from(snapshots.entries()).map(([identity, value]) => {
            const xp = value.likesReceived * XP_PER_LIKE + value.dislikesReceived * XP_PER_DISLIKE;
            const level = levelForXp(xp);
            return [identity, {
                    identity,
                    modelId: value.principal.modelId,
                    ...(value.principal.agentId && { agentId: value.principal.agentId }),
                    level,
                    xp,
                    likesReceived: value.likesReceived,
                    dislikesReceived: value.dislikesReceived,
                    totalReactions: value.likesReceived + value.dislikesReceived,
                    label: labelForLevel(level),
                }];
        }));
    }
}
export { XP_PER_DISLIKE, XP_PER_LIKE, XP_PER_LEVEL };
