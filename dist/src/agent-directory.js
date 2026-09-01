import { normalizeScopeId } from './scopes.js';
import { SCOPE_CAPABILITIES } from './scope-auth.js';
const ROOT = 'Community/Agents';
const now = () => new Date().toISOString();
const profilePath = (role, id) => `${ROOT}/${role}s/${normalizeScopeId(id, `${role}Id`)}.md`;
function identityOf(principal) {
    return principal.agentId || principal.modelId;
}
function normalizeText(value, field, max) {
    const text = String(value ?? '').trim();
    if (Array.from(text).length > max)
        throw new Error(`${field} must be ${max} Unicode characters or fewer`);
    return text;
}
function normalizeList(value, field, maxItems, maxItemLength) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        throw new Error(`${field} must be an array`);
    return Array.from(new Set(value.map(item => normalizeText(item, field, maxItemLength).toLowerCase()).filter(Boolean))).slice(0, maxItems);
}
export class AgentDirectoryService {
    fileSystem;
    auth;
    constructor(fileSystem, auth) {
        this.fileSystem = fileSystem;
        this.auth = auth;
    }
    async findPrincipal(role, id) {
        const normalized = normalizeScopeId(id, `${role}Id`);
        const principal = (await this.auth.listPrincipals()).find(candidate => candidate.role === role && (role === 'agent' ? candidate.agentId === normalized : candidate.modelId === normalized));
        if (!principal)
            throw new Error(`No registered ${role} identity found: ${normalized}`);
        return principal;
    }
    async profileFor(principal) {
        const role = principal.role;
        const id = identityOf(principal);
        const path = profilePath(role, id);
        const note = await this.fileSystem.noteExists(path) ? await this.fileSystem.readNote(path) : undefined;
        if (note && note.frontmatter.mcpvault_type !== 'agent_profile') {
            throw new Error(`Profile path is reserved for the agent directory: ${path}`);
        }
        return {
            identity: id,
            role,
            modelId: principal.modelId,
            ...(principal.agentId && { agentId: principal.agentId }),
            displayName: note?.frontmatter.display_name || id,
            bio: note?.frontmatter.bio || '',
            interests: Array.isArray(note?.frontmatter.interests) ? note.frontmatter.interests : [],
            availability: note?.frontmatter.availability || 'unknown',
            capabilities: principal.capabilities || [],
            path,
            revision: note?.revision,
            updatedAt: note?.frontmatter.updated_at,
        };
    }
    async get(params) {
        if (params.role !== 'model' && params.role !== 'agent')
            throw new Error('role must be model or agent');
        return { success: true, profile: await this.profileFor(await this.findPrincipal(params.role, params.identity)) };
    }
    async list(params) {
        if (params.role !== undefined && params.role !== 'model' && params.role !== 'agent')
            throw new Error('role must be model or agent');
        if (params.capability !== undefined && !SCOPE_CAPABILITIES.includes(params.capability))
            throw new Error(`capability must be one of: ${SCOPE_CAPABILITIES.join(', ')}`);
        const principals = await this.auth.listPrincipals();
        const profiles = await Promise.all(principals
            .filter(principal => !params.role || principal.role === params.role)
            .filter(principal => !params.capability || (principal.capabilities || []).includes(params.capability))
            .map(principal => this.profileFor(principal)));
        const filtered = params.availability ? profiles.filter(profile => profile.availability === params.availability) : profiles;
        const limit = Math.min(Math.max(Number(params.limit || 50), 1), 500);
        return { profiles: filtered.slice(0, limit), total: filtered.length, truncated: filtered.length > limit };
    }
    async update(params) {
        if (!params.principal)
            throw new Error('Login is required to update an agent profile');
        if (!params.expectedRevision)
            throw new Error("expectedRevision is required; use 'missing' for a new profile");
        const principal = params.principal;
        const id = identityOf(principal);
        const path = profilePath(principal.role, id);
        const existing = await this.fileSystem.noteExists(path) ? await this.fileSystem.readNote(path) : undefined;
        if (existing && existing.frontmatter.mcpvault_type !== 'agent_profile') {
            throw new Error(`Profile path is reserved for the agent directory: ${path}`);
        }
        const displayName = normalizeText(params.displayName ?? existing?.frontmatter.display_name ?? id, 'displayName', 120) || id;
        const bio = normalizeText(params.bio ?? existing?.frontmatter.bio ?? '', 'bio', 1000);
        const interests = params.interests !== undefined
            ? normalizeList(params.interests, 'interests', 20, 64)
            : (Array.isArray(existing?.frontmatter.interests) ? existing.frontmatter.interests : []);
        const availability = normalizeText(params.availability ?? existing?.frontmatter.availability ?? 'available', 'availability', 32).toLowerCase() || 'available';
        const timestamp = now();
        await this.fileSystem.writeNote({
            path,
            content: `# ${displayName}\n\n${bio}\n`,
            frontmatter: {
                ...(existing?.frontmatter || {}), mcpvault_type: 'agent_profile', identity: id, role: principal.role,
                model_id: principal.modelId, ...(principal.agentId && { agent_id: principal.agentId }), display_name: displayName,
                bio, interests, availability, capabilities: principal.capabilities || [], updated_at: timestamp,
                ...(existing ? {} : { created_at: timestamp }),
            },
            expectedRevision: params.expectedRevision,
        });
        const updated = await this.fileSystem.readNote(path);
        return { success: true, profile: await this.profileFor({ ...principal }), revision: updated.revision };
    }
    async syncCapabilities(agentId, capabilities) {
        const path = profilePath('agent', agentId);
        if (!await this.fileSystem.noteExists(path))
            return;
        const note = await this.fileSystem.readNote(path);
        if (note.frontmatter.mcpvault_type !== 'agent_profile')
            return;
        try {
            await this.fileSystem.writeNote({
                path,
                content: note.content,
                frontmatter: { ...note.frontmatter, capabilities, updated_at: now() },
                expectedRevision: note.revision,
            });
        }
        catch {
            // Auth policy is authoritative; a concurrent profile edit can leave the
            // cached display field stale until the agent updates its profile again.
        }
    }
}
