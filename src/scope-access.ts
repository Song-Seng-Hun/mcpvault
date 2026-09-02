import type { ScopePrincipal } from './scope-auth.js';
import { expandScopePath, parseScopePath } from './scopes.js';

const PRIVATE_ROOT = '_scopes';
const SOURCE_SEGMENT = '_sources';
const WHISPER_ROOT = '_whispers';
const COMMUNITY_ROOT = 'Community';

function normalizePhysicalPath(value: string): string {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function privateOwner(path: string): { kind: 'model' | 'agent' | 'user'; id: string } | undefined {
  const match = /^_scopes\/(models|agents|users)\/([^/]+)(?:\/|$)/i.exec(normalizePhysicalPath(path));
  if (!match) return undefined;
  const segment = match[1]!.toLowerCase();
  return { kind: segment === 'models' ? 'model' : segment === 'agents' ? 'agent' : 'user', id: match[2]!.toLowerCase() };
}

export class ScopeAccessPolicy {
  private readonly commandCenterId: string;

  constructor(options: { commandCenterId?: string } = {}) {
    const configured = options.commandCenterId || process.env.MCPVAULT_COMMAND_CENTER_ID || 'local';
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(configured)) throw new Error('commandCenterId must be a lowercase scope id');
    this.commandCenterId = configured.trim().toLowerCase();
  }

  getCommandCenterId(): string { return this.commandCenterId; }

  isCommunityPath(path: string): boolean {
    const normalized = normalizePhysicalPath(path).toLowerCase();
    return normalized === COMMUNITY_ROOT.toLowerCase() || normalized.startsWith(`${COMMUNITY_ROOT.toLowerCase()}/`);
  }

  canAccessPhysicalPath(path: string, principal?: ScopePrincipal): boolean {
    const normalized = normalizePhysicalPath(path);
    if (!normalized) return true;
    if (normalized.toLowerCase() === PRIVATE_ROOT || normalized.toLowerCase().startsWith(`${PRIVATE_ROOT}/`)) {
      const owner = privateOwner(normalized);
      if (!owner || !principal) return false;
      if (principal.commandCenterId && principal.commandCenterId !== this.commandCenterId) return false;
      // User data is deliberately host-local.  A matching userId is useful
      // for family attribution and moderation, but it is not a capability to
      // read the server operator's private files through MCP.
      if (owner.kind === 'user') return false;
      return owner.kind === 'model'
        ? principal.modelId === owner.id
        : owner.kind === 'agent'
          ? principal.agentId === owner.id
          : false;
    }
    if (normalized.toLowerCase() === WHISPER_ROOT || normalized.toLowerCase().startsWith(`${WHISPER_ROOT}/`)) return false;
    return true;
  }

  resolveExternalPath(value: string, principal?: ScopePrincipal): string {
    const raw = String(value || '').trim();
    const parsed = parseScopePath(raw);
    if (parsed) {
      if (parsed.kind === 'community' && parsed.id !== this.commandCenterId) {
        throw new Error(`Access denied: community scope '${parsed.id}' belongs to another command center`);
      }
      if (parsed.kind !== 'global' && principal?.commandCenterId && principal.commandCenterId !== this.commandCenterId) {
        throw new Error('Access denied: this identity belongs to another command center');
      }
      if (parsed.kind === 'user') throw new Error('User scope is host-only and is not available through MCP; use the server host\'s local Obsidian/filesystem access.');
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
    if (normalized.toLowerCase() === WHISPER_ROOT || normalized.toLowerCase().startsWith(`${WHISPER_ROOT}/`)) {
      throw new Error('Direct _whispers paths are private; use list_whispers');
    }
    // Legacy clients still pass physical Community paths to reference/bookmark
    // APIs. Managed community mutations are blocked separately; the canonical
    // scoped form for reads and path arguments remains
    // scope://community/<commandCenterId>/... .
    return raw;
  }

  assertMutationAllowed(path: string, operation: string): void {
    const normalized = normalizePhysicalPath(path).toLowerCase();
    const isGlobalSource = normalized === SOURCE_SEGMENT || normalized.startsWith(`${SOURCE_SEGMENT}/`);
    const isPrivateSource = /^_scopes\/(?:models|agents)\/[^/]+\/_sources(?:\/|$)/.test(normalized);
    if (isGlobalSource || isPrivateSource) {
      throw new Error(`${operation} cannot mutate immutable LLM Wiki sources; use ingest_source to add a new source snapshot`);
    }
  }

  canReferenceFrom(containerPath: string, referencedPath: string): boolean {
    const container = privateOwner(containerPath);
    const referenced = privateOwner(referencedPath);
    if (!container) return !referenced;
    if (!referenced) return true;
    if (container.kind === 'user') return false;
    if (container.kind === 'model') return referenced.kind === 'model' && referenced.id === container.id;
    if (referenced.kind === 'model') {
      // Agent accounts can only access their own parent model, so a model
      // reference that reached this check is the correct parent.
      return true;
    }
    if (container.kind === 'agent') return referenced.kind === 'agent' && referenced.id === container.id;
    return false;
  }

  toPublicPath(path: string): string {
    const normalized = normalizePhysicalPath(path);
    const model = /^_scopes\/models\/([^/]+)(?:\/(.*))?$/i.exec(normalized);
    if (model) return `scope://model/${model[1]}${model[2] ? `/${model[2]}` : '/'}`;
    const agent = /^_scopes\/agents\/([^/]+)(?:\/(.*))?$/i.exec(normalized);
    if (agent) return `scope://agent/${agent[1]}${agent[2] ? `/${agent[2]}` : '/'}`;
    const user = /^_scopes\/users\/([^/]+)(?:\/(.*))?$/i.exec(normalized);
    if (user) return `scope://user/${user[1]}${user[2] ? `/${user[2]}` : '/'}`;
    return normalized;
  }

  scopeRoots(principal?: ScopePrincipal): Array<{ kind: 'agent' | 'model' | 'community' | 'global'; root: string }> {
    return [
      ...(principal?.agentId ? [{ kind: 'agent' as const, root: `_scopes/agents/${principal.agentId}` }] : []),
      ...(principal?.modelId ? [{ kind: 'model' as const, root: `_scopes/models/${principal.modelId}` }] : []),
      { kind: 'community' as const, root: COMMUNITY_ROOT },
      { kind: 'global' as const, root: '' },
    ];
  }
}
