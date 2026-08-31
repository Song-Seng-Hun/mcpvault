import { expandScopePath, parseScopePath } from './scopes.js';
const PRIVATE_ROOT = '_scopes';
const SOURCE_SEGMENT = '_sources';
function normalizePhysicalPath(value) {
    return String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
function privateOwner(path) {
    const match = /^_scopes\/(models|agents)\/([^/]+)(?:\/|$)/i.exec(normalizePhysicalPath(path));
    if (!match)
        return undefined;
    return { kind: match[1].toLowerCase() === 'models' ? 'model' : 'agent', id: match[2].toLowerCase() };
}
export class ScopeAccessPolicy {
    canAccessPhysicalPath(path, principal) {
        const normalized = normalizePhysicalPath(path);
        if (!normalized)
            return true;
        if (normalized.toLowerCase() === PRIVATE_ROOT || normalized.toLowerCase().startsWith(`${PRIVATE_ROOT}/`)) {
            const owner = privateOwner(normalized);
            if (!owner || !principal)
                return false;
            return owner.kind === 'model'
                ? principal.modelId === owner.id
                : principal.agentId === owner.id;
        }
        return true;
    }
    resolveExternalPath(value, principal) {
        const raw = String(value || '').trim();
        const parsed = parseScopePath(raw);
        if (parsed) {
            if (parsed.kind === 'model' && principal?.modelId !== parsed.id) {
                throw new Error(`Access denied: model scope '${parsed.id}' is private`);
            }
            if (parsed.kind === 'agent' && principal?.agentId !== parsed.id) {
                throw new Error(`Access denied: agent scope '${parsed.id}' is private`);
            }
            return expandScopePath(raw);
        }
        const normalized = normalizePhysicalPath(raw);
        if (normalized.toLowerCase() === PRIVATE_ROOT || normalized.toLowerCase().startsWith(`${PRIVATE_ROOT}/`)) {
            throw new Error('Direct _scopes paths are private; use an authorized scope:// URI');
        }
        return raw;
    }
    assertMutationAllowed(path, operation) {
        const normalized = normalizePhysicalPath(path).toLowerCase();
        const isGlobalSource = normalized === SOURCE_SEGMENT || normalized.startsWith(`${SOURCE_SEGMENT}/`);
        const isPrivateSource = /^_scopes\/(?:models|agents)\/[^/]+\/_sources(?:\/|$)/.test(normalized);
        if (isGlobalSource || isPrivateSource) {
            throw new Error(`${operation} cannot mutate immutable LLM Wiki sources; use ingest_source to add a new source snapshot`);
        }
    }
    canReferenceFrom(containerPath, referencedPath) {
        const container = privateOwner(containerPath);
        const referenced = privateOwner(referencedPath);
        if (!container)
            return !referenced;
        if (!referenced)
            return true;
        if (container.kind === 'model')
            return referenced.kind === 'model' && referenced.id === container.id;
        if (referenced.kind === 'model') {
            // Agent accounts can only access their own parent model, so a model
            // reference that reached this check is the correct parent.
            return true;
        }
        return referenced.kind === 'agent' && referenced.id === container.id;
    }
    toPublicPath(path) {
        const normalized = normalizePhysicalPath(path);
        const model = /^_scopes\/models\/([^/]+)(?:\/(.*))?$/i.exec(normalized);
        if (model)
            return `scope://model/${model[1]}${model[2] ? `/${model[2]}` : '/'}`;
        const agent = /^_scopes\/agents\/([^/]+)(?:\/(.*))?$/i.exec(normalized);
        if (agent)
            return `scope://agent/${agent[1]}${agent[2] ? `/${agent[2]}` : '/'}`;
        return normalized;
    }
    scopeRoots(principal) {
        return [
            ...(principal?.agentId ? [{ kind: 'agent', root: `_scopes/agents/${principal.agentId}` }] : []),
            ...(principal?.modelId ? [{ kind: 'model', root: `_scopes/models/${principal.modelId}` }] : []),
            { kind: 'global', root: '' },
        ];
    }
}
