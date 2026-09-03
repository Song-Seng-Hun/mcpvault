import { randomUUID } from 'node:crypto';
import { boundSearchResults, normalizeSearchLimit, normalizeSearchMaxChars } from './search-limits.js';
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const DISCUSSION_STATUSES = new Set(['open', 'resolved', 'rejected', 'superseded']);
const DISCUSSION_STANCES = new Set(['support', 'challenge', 'alternative', 'question']);
export function normalizeScopeId(value, field) {
    const id = String(value || '').trim().toLowerCase();
    if (!ID_PATTERN.test(id)) {
        throw new Error(`${field} must be 1-64 lowercase letters, numbers, dots, underscores, or hyphens`);
    }
    return id;
}
export function parseScopePath(value) {
    const raw = String(value || '').trim();
    if (!raw.toLowerCase().startsWith('scope://'))
        return undefined;
    const match = /^scope:\/\/(global|community|user|model|agent)(?:\/([^/]+))?(?:\/(.*))?$/i.exec(raw.replace(/\\/g, '/'));
    if (!match)
        throw new Error(`Invalid scope path: ${raw}`);
    const kind = match[1].toLowerCase();
    if (kind === 'global') {
        return { kind, logicalPath: [match[2], match[3]].filter(Boolean).join('/') };
    }
    return {
        kind,
        id: normalizeScopeId(match[2] || '', `${kind}Id`),
        logicalPath: match[3] || '',
    };
}
function normalizeLogicalPath(value) {
    const path = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!path || path.split('/').some(part => part === '..' || part === '.')) {
        throw new Error('path must be a non-empty vault-relative path without . or .. segments');
    }
    return path;
}
/** Convert a durable scope URI into the ordinary vault path used by every existing tool. */
export function expandScopePath(value) {
    const raw = String(value || '').trim();
    if (!raw.toLowerCase().startsWith('scope://'))
        return raw;
    const parsed = parseScopePath(raw);
    const kind = parsed.kind;
    if (kind === 'global') {
        const logical = parsed.logicalPath;
        return logical ? normalizeLogicalPath(logical) : '';
    }
    const id = parsed.id;
    const logical = parsed.logicalPath ? normalizeLogicalPath(parsed.logicalPath) : '';
    if (kind === 'community') {
        // Community notes predate command-center scopes and are intentionally kept
        // in their ordinary Obsidian tree. ScopeAccessPolicy verifies that the
        // URI targets this server's command center before this path is used.
        return `Community${logical ? `/${logical}` : ''}`;
    }
    return `_scopes/${kind}s/${id}${logical ? `/${logical}` : ''}`;
}
export function scopeRoot(kind, id) {
    if (kind === 'global')
        return '';
    if (kind === 'community')
        return 'Community';
    return `_scopes/${kind}s/${normalizeScopeId(id || '', `${kind}Id`)}`;
}
const now = () => new Date().toISOString();
const discussionPath = (id) => `_collaboration/discussions/${normalizeScopeId(id, 'discussionId')}.md`;
const identityPath = (agentId) => `${scopeRoot('agent', agentId)}/_identity.md`;
function evidenceLines(evidence) {
    if (!evidence?.length)
        return '- Evidence: none supplied';
    return evidence.map(item => `- Evidence: ${String(item).trim()}`).join('\n');
}
export class CollaborationService {
    fileSystem;
    searchService;
    constructor(fileSystem, searchService) {
        this.fileSystem = fileSystem;
        this.searchService = searchService;
    }
    async inferModelId(agentId, explicitModelId) {
        if (explicitModelId)
            return normalizeScopeId(explicitModelId, 'modelId');
        if (!agentId)
            return undefined;
        const path = identityPath(agentId);
        if (!await this.fileSystem.noteExists(path))
            return undefined;
        const identity = await this.fileSystem.readNote(path);
        return identity.frontmatter.model_id ? normalizeScopeId(String(identity.frontmatter.model_id), 'modelId') : undefined;
    }
    getScopeContext(modelId, agentId, userId, commandCenterId = 'local') {
        const model = modelId ? normalizeScopeId(modelId, 'modelId') : undefined;
        const agent = agentId ? normalizeScopeId(agentId, 'agentId') : undefined;
        const user = userId ? normalizeScopeId(userId, 'userId') : undefined;
        const center = normalizeScopeId(commandCenterId, 'commandCenterId');
        return {
            precedence: ['agent', 'model', 'community', 'global'],
            global: { uri: 'scope://global/', root: '' },
            community: { id: center, uri: `scope://community/${center}/`, root: scopeRoot('community', center), sync: 'command-center-only' },
            ...(user && { user: { id: user, uri: `scope://user/${user}/`, root: scopeRoot('user', user), access: 'host-only' } }),
            ...(model && { model: { id: model, uri: `scope://model/${model}/`, root: scopeRoot('model', model) } }),
            ...(agent && { agent: { id: agent, uri: `scope://agent/${agent}/`, root: scopeRoot('agent', agent), identityPath: identityPath(agent) } }),
            access: model || agent ? 'authenticated-private-legacy-and-global' : 'public-global-community',
            note: 'Global is the cross-command-center knowledge layer. Community is public only inside this command center. User storage is host-only and not exposed through MCP; model and agent namespaces provide private agent access.',
        };
    }
    async createAgentScope(params) {
        const agentId = normalizeScopeId(params.agentId, 'agentId');
        const modelId = normalizeScopeId(params.modelId, 'modelId');
        const sessionId = String(params.sessionId || '').trim();
        if (!sessionId)
            throw new Error('sessionId is required');
        const path = identityPath(agentId);
        if (await this.fileSystem.noteExists(path))
            throw new Error(`Agent scope already exists: ${agentId}`);
        const timestamp = now();
        const frontmatter = {
            mcpvault_type: 'agent-identity', agent_id: agentId, model_id: modelId,
            display_name: params.displayName?.trim() || agentId, status: 'active', generation: 1,
            current_session: sessionId, created_at: timestamp, updated_at: timestamp,
        };
        const content = `# Agent identity: ${frontmatter.display_name}\n\n## Purpose\n\n${params.purpose?.trim() || 'Persistent working identity for this agent.'}\n\n## Continuity log\n\n- ${timestamp} — Created by session \`${sessionId}\` on model \`${modelId}\`.\n`;
        await this.fileSystem.writeNote({ path, content, frontmatter, expectedRevision: 'missing' });
        return { success: true, agentId, modelId, sessionId, generation: 1, path, scopeUri: `scope://agent/${agentId}/` };
    }
    async handoffAgentScope(params) {
        const agentId = normalizeScopeId(params.agentId, 'agentId');
        const path = identityPath(agentId);
        const note = await this.fileSystem.readNote(path);
        const generation = Number(note.frontmatter.generation);
        if (note.frontmatter.current_session !== params.fromSessionId) {
            throw new Error(`fromSessionId does not hold this agent scope; current holder is ${note.frontmatter.current_session}`);
        }
        if (generation !== params.expectedGeneration)
            throw new Error(`Stale agent generation: expected ${params.expectedGeneration}, current ${generation}`);
        if (!params.toSessionId?.trim() || !params.reason?.trim())
            throw new Error('toSessionId and reason are required');
        const timestamp = now();
        const nextGeneration = generation + 1;
        await this.fileSystem.writeNote({
            path,
            content: `${note.content.trimEnd()}\n- ${timestamp} — Handoff from session \`${params.fromSessionId}\` to \`${params.toSessionId}\`: ${params.reason.trim()}\n`,
            frontmatter: { ...note.frontmatter, status: 'active', generation: nextGeneration, previous_session: params.fromSessionId, current_session: params.toSessionId, updated_at: timestamp },
            expectedRevision: note.revision,
        });
        return { success: true, agentId, generation: nextGeneration, currentSession: params.toSessionId, path };
    }
    async resumeAgentScope(params) {
        const agentId = normalizeScopeId(params.agentId, 'agentId');
        const path = identityPath(agentId);
        const note = await this.fileSystem.readNote(path);
        const generation = Number(note.frontmatter.generation);
        if (generation !== params.expectedGeneration)
            throw new Error(`Stale agent generation: expected ${params.expectedGeneration}, current ${generation}`);
        if (!params.newSessionId?.trim() || !params.reason?.trim())
            throw new Error('newSessionId and reason are required');
        const previous = String(note.frontmatter.current_session || 'unknown');
        const timestamp = now();
        const nextGeneration = generation + 1;
        await this.fileSystem.writeNote({
            path,
            content: `${note.content.trimEnd()}\n- ${timestamp} — Recovery by session \`${params.newSessionId}\` from \`${previous}\`: ${params.reason.trim()}\n`,
            frontmatter: { ...note.frontmatter, status: 'active', generation: nextGeneration, previous_session: previous, current_session: params.newSessionId, updated_at: timestamp },
            expectedRevision: note.revision,
        });
        return { success: true, agentId, generation: nextGeneration, currentSession: params.newSessionId, recoveredFrom: previous, path };
    }
    async readScopedNote(params) {
        const logical = normalizeLogicalPath(params.path);
        const modelId = await this.inferModelId(params.agentId, params.modelId);
        const candidates = [];
        if (params.agentId)
            candidates.push({ scope: 'agent', path: `${scopeRoot('agent', params.agentId)}/${logical}` });
        if (modelId)
            candidates.push({ scope: 'model', path: `${scopeRoot('model', modelId)}/${logical}` });
        candidates.push({ scope: 'community', path: `${scopeRoot('community', params.commandCenterId || 'local')}/${logical}` });
        candidates.push({ scope: 'global', path: logical });
        for (const candidate of candidates) {
            if (!await this.fileSystem.noteExists(candidate.path))
                continue;
            const note = await this.fileSystem.readNote(candidate.path);
            return { scope: candidate.scope, logicalPath: logical, physicalPath: candidate.path, fm: note.frontmatter, content: note.content, revision: note.revision };
        }
        throw new Error(`Scoped note not found in ${candidates.map(item => item.scope).join(' > ')} precedence: ${logical}`);
    }
    async searchScopedNotes(params) {
        const limit = normalizeSearchLimit(params.limit);
        const maxChars = normalizeSearchMaxChars(params.maxChars);
        const modelId = await this.inferModelId(params.agentId, params.modelId);
        const scopes = [];
        if (params.agentId)
            scopes.push({ scope: 'agent', root: scopeRoot('agent', params.agentId) });
        if (modelId)
            scopes.push({ scope: 'model', root: scopeRoot('model', modelId) });
        scopes.push({ scope: 'community', root: scopeRoot('community', params.commandCenterId || 'local') });
        scopes.push({ scope: 'global', root: '' });
        const found = new Set();
        const merged = [];
        for (const item of scopes) {
            const results = await this.searchService.search({
                query: params.query, limit: 20,
                ...(params.searchContent !== undefined && { searchContent: params.searchContent }),
                ...(params.searchFrontmatter !== undefined && { searchFrontmatter: params.searchFrontmatter }),
                ...(params.caseSensitive !== undefined && { caseSensitive: params.caseSensitive }),
                ...(params.includeRevisions !== undefined && { includeRevisions: params.includeRevisions }),
                ...(params.expandAuthority !== undefined && { expandAuthority: params.expandAuthority }),
                ...(item.root ? { pathPrefix: item.root } : { excludePaths: ['_scopes', '_collaboration', '_whispers'] }),
            });
            for (const result of results) {
                const logicalPath = item.root ? result.p.slice(item.root.length + 1) : result.p;
                if (found.has(logicalPath))
                    continue;
                found.add(logicalPath);
                merged.push({
                    value: { ...result, p: logicalPath, physicalPath: result.p, scope: item.scope },
                    wiki: result.wk === true,
                    scopeRank: scopes.indexOf(item),
                    order: merged.length,
                });
            }
        }
        merged.sort((a, b) => Number(b.wiki) - Number(a.wiki) || a.scopeRank - b.scopeRank || a.order - b.order);
        return boundSearchResults(merged.slice(0, limit).map(item => item.value), maxChars);
    }
    async createDiscussion(params) {
        const title = String(params.title || '').trim();
        const actor = String(params.createdBy || '').trim();
        const position = String(params.initialPosition || '').trim();
        if (!title || !actor || !position)
            throw new Error('title, createdBy, and initialPosition are required');
        const generated = `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
        const id = normalizeScopeId(params.discussionId || generated, 'discussionId');
        const path = discussionPath(id);
        const timestamp = now();
        const subject = params.subjectPath?.trim();
        const frontmatter = {
            mcpvault_type: 'discussion', discussion_id: id, title, status: 'open',
            created_by: actor, participants: [actor], ...(subject && { subject_path: subject }), created_at: timestamp, updated_at: timestamp,
        };
        const content = `# ${title}\n\n${subject ? `Subject: \`${subject}\`\n\n` : ''}## Arguments\n\n### ${timestamp} · ${actor} · proposal\n\n${position}\n\n${evidenceLines(params.evidence)}\n\n## Decision log\n`;
        await this.fileSystem.writeNote({ path, content, frontmatter, expectedRevision: 'missing' });
        const note = await this.fileSystem.readNote(path);
        return { success: true, discussionId: id, path, status: 'open', revision: note.revision };
    }
    async addDiscussionArgument(params) {
        const path = discussionPath(params.discussionId);
        const actor = String(params.actor || '').trim();
        const stance = String(params.stance || '').trim();
        const argument = String(params.argument || '').trim();
        if (!actor || !argument || !DISCUSSION_STANCES.has(stance))
            throw new Error('actor, argument, and a valid stance are required');
        if (!params.expectedRevision)
            throw new Error('expectedRevision is required; read the discussion before arguing');
        const note = await this.fileSystem.readNote(path);
        const timestamp = now();
        const participants = Array.from(new Set([...(Array.isArray(note.frontmatter.participants) ? note.frontmatter.participants : []), actor]));
        const entry = `\n### ${timestamp} · ${actor} · ${stance}\n\n${argument}\n\n${evidenceLines(params.evidence)}\n`;
        const marker = '\n## Decision log';
        const content = note.content.includes(marker) ? note.content.replace(marker, `${entry}${marker}`) : `${note.content.trimEnd()}${entry}`;
        await this.fileSystem.writeNote({ path, content, frontmatter: { ...note.frontmatter, participants, updated_at: timestamp }, expectedRevision: params.expectedRevision });
        const updated = await this.fileSystem.readNote(path);
        return { success: true, discussionId: params.discussionId, status: updated.frontmatter.status, revision: updated.revision };
    }
    async updateDiscussionStatus(params) {
        const path = discussionPath(params.discussionId);
        const actor = String(params.actor || '').trim();
        const status = String(params.status || '').trim();
        const reason = String(params.reason || '').trim();
        if (!actor || !reason || !DISCUSSION_STATUSES.has(status))
            throw new Error('actor, reason, and a valid status are required');
        if (!params.expectedRevision)
            throw new Error('expectedRevision is required; read the discussion before changing status');
        const note = await this.fileSystem.readNote(path);
        const timestamp = now();
        const participants = Array.from(new Set([...(Array.isArray(note.frontmatter.participants) ? note.frontmatter.participants : []), actor]));
        const content = `${note.content.trimEnd()}\n\n- ${timestamp} — **${status}** by ${actor}: ${reason}\n`;
        await this.fileSystem.writeNote({ path, content, frontmatter: { ...note.frontmatter, status, participants, updated_at: timestamp }, expectedRevision: params.expectedRevision });
        const updated = await this.fileSystem.readNote(path);
        return { success: true, discussionId: params.discussionId, status, revision: updated.revision };
    }
    async getDiscussion(discussionId) {
        const id = normalizeScopeId(discussionId, 'discussionId');
        const path = discussionPath(id);
        const note = await this.fileSystem.readNote(path);
        return { discussionId: id, path, fm: note.frontmatter, content: note.content, revision: note.revision };
    }
}
