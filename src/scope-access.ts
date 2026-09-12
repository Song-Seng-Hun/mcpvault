import { guidanceError } from './guidance-runtime.js';
import type { ScopePrincipal } from './scope-auth.js';
import { expandScopePath, parseScopePath } from './scopes.js';
import { posix } from 'node:path';
import { assertOriginalMutation } from './original-boundary.js';
import { documentAuthorityReader, type DocumentAuthorityOptions, type DocumentAuthority } from './document-authority.js';
import { activeDocumentStorageContext } from './enterprise-storage-context.js';

const PRIVATE_ROOT = '_scopes';
const WHISPER_ROOT = '_whispers';
const COMMUNITY_ROOT = 'Community';
const LEGACY_DISCUSSION_ROOT = '_collaboration/discussions';

/** Accept vault-relative physical paths; filesystem callers must resolve first. */
export function isLegacyDiscussionPath(path: string, includeAncestors = false): boolean {
  // Collapse dot segments and duplicate separators, and account for Windows
  // trailing-dot/space aliases without confusing siblings with descendants.
  const segments = normalizePhysicalPath(path).split('/').map(segment =>
    segment === '.' || segment === '..' ? segment : segment.replace(/[. ]+$/, ''));
  const normalized = posix.normalize(segments.join('/')).replace(/\/$/, '').toLowerCase();
  return normalized === LEGACY_DISCUSSION_ROOT
    || normalized.startsWith(`${LEGACY_DISCUSSION_ROOT}/`)
    || (includeAncestors && (normalized === '.' || LEGACY_DISCUSSION_ROOT.startsWith(`${normalized}/`)));
}

export function assertLegacyDiscussionMutationAllowed(path: string, operation: string, includeAncestors = false): void {
  if (isLegacyDiscussionPath(path, includeAncestors)) {
    throw guidanceError(new Error(`${operation} cannot mutate _collaboration/discussions: historical read-only content. Use community.post, community.comment, or community.status for current discussions; use notes.read for bounded historical reads.`), 'guid-d9781b35425d9430');
  }
}

function normalizePhysicalPath(value: string): string {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function privateOwner(path: string): { kind: 'model' | 'agent' | 'user'; id: string } | undefined {
  const match = /^_scopes\/(models|agents|users)\/([^/]+)(?:\/|$)/i.exec(normalizePhysicalPath(path));
  if (!match) return undefined;
  const segment = match[1]!.toLowerCase();
  return { kind: segment === 'models' ? 'model' : segment === 'agents' ? 'agent' : 'user', id: match[2]!.toLowerCase() };
}

/** Reserved private checkpoint subtrees, including Windows path aliases. */
function modelCheckpoint(path: string): { modelId: string; accountId?: string; legacy: boolean } | undefined {
  const segments = normalizePhysicalPath(path).split('/').map(part => part === '.' || part === '..' ? part : part.replace(/[. ]+$/, ''));
  const canonical = posix.normalize(segments.join('/')).toLowerCase();
  const match = /^_scopes\/models\/([^/]+)\/_continuity\/(work-state\.md|accounts(?:\/([^/]+)(?:\/.*)?)?)$/.exec(canonical);
  if (!match) return undefined;
  return { modelId: match[1]!, ...(match[3] && { accountId: match[3] }), legacy: match[2] === 'work-state.md' };
}

export class ScopeAccessPolicy {
  private readonly documentAuthority: () => DocumentAuthority | undefined;
  private readonly localInferenceAllowed: DocumentAuthorityOptions['localInferenceAllowed'];
  private readonly commandCenterId: string;
  private readonly enterprise: { mode: 'public' | 'company'; realmId: string } | undefined;

  constructor(options: { commandCenterId?: string; enterprise?: { mode: 'public' | 'company'; realmId: string } } & DocumentAuthorityOptions = {}) {
    const configured = options.commandCenterId || process.env.MCPVAULT_COMMAND_CENTER_ID || 'local';
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(configured)) throw guidanceError(new Error('commandCenterId must be a lowercase scope id'), 'guid-4ca281d9c34ac799');
    this.commandCenterId = configured.trim().toLowerCase();
    this.enterprise = options.enterprise;
    this.documentAuthority = documentAuthorityReader(options);
    this.localInferenceAllowed = options.localInferenceAllowed;
  }

  getCommandCenterId(): string { return this.commandCenterId; }
  getEnterpriseProfile() { return this.enterprise; }
  hasDocumentPolicy(): boolean { return this.documentAuthority() !== undefined; }
  documentPolicyFingerprint(): string { return this.documentAuthority()?.fingerprint ?? 'none'; }
  /** Navigation only; the principal must originate from current host authentication. */
  defaultDepartment(principal?: ScopePrincipal): string | undefined {
    const verified = principal?.enterprise;
    return this.enterprise?.mode === 'company' && this.enterprisePrincipalAllowed(principal)
      && verified?.defaultDepartmentId && verified.departmentIds?.includes(verified.defaultDepartmentId)
      ? verified.defaultDepartmentId : undefined;
  }
  defaultNavigation(principal?: ScopePrincipal) {
    const departmentId = this.defaultDepartment(principal);
    return departmentId ? { departmentId, basis: 'administrator_verified', action: {
      endpointId: 'mcp.query_notes', arguments: { department: 'default', limit: 12, includeContent: false, includeTotal: false, maxChars: 4000 },
    } } : undefined;
  }
  isInDefaultDepartment(path: string, principal?: ScopePrincipal, recordSource = true): boolean {
    const department = this.defaultDepartment(principal);
    if (!department || !this.canAccessPhysicalPath(path, principal, recordSource)) return false;
    return this.documentAuthority()?.effectiveConstraints(path).some(rule =>
      rule.realmId === principal!.enterprise!.realmId && rule.departmentIds?.includes(department)) === true;
  }
  isConfidentialDocument(path: string): boolean {
    const context = activeDocumentStorageContext();
    return (context?.access.documentAuthority()?.effectiveConstraints(path) ?? []).some(rule => rule.confidential)
      || (this.documentAuthority()?.effectiveConstraints(path) ?? []).some(rule => rule.confidential);
  }
  /** Pin authorization, not document bodies. Revocation at any await discards
   * the outgoing result, including aggregate existence information. */
  captureDocumentBoundary(principal?: ScopePrincipal): () => void {
    const fingerprint = this.documentAuthority()?.fingerprint;
    const local = Boolean(principal && this.localInferenceAllowed?.(principal) === true);
    return () => {
      if (this.documentAuthority()?.fingerprint !== fingerprint
        || Boolean(principal && this.localInferenceAllowed?.(principal) === true) !== local) {
        throw new Error('Protected document authorization changed; retry with current authorization');
      }
    };
  }
  /** Used at physical IO independently of a service's legacy scope behavior. */
  canReadProtectedDocument(path: string, principal?: ScopePrincipal, recordSource = true): boolean {
    const authority = this.documentAuthority();
    if (authority?.canRead(path, principal, this.localInferenceAllowed) === false) return false;
    if (recordSource && path && path !== '.') for (const rule of authority?.effectiveConstraints(path) ?? []) {
      if (rule.confidential || rule.realmId || rule.accountIds || rule.departmentIds) activeDocumentStorageContext()?.observe?.(rule.path);
    }
    return true;
  }
  getCommunityRoot(): string { return this.enterprise?.mode === 'public' ? 'PublicCommunity' : COMMUNITY_ROOT; }

  private enterprisePrincipalAllowed(principal?: ScopePrincipal): boolean {
    return !this.enterprise || Boolean(principal?.enterprise
      && principal.enterprise.realmId === this.enterprise.realmId
      && principal.enterprise.mode === this.enterprise.mode
      && principal.commandCenterId === this.commandCenterId && principal.userId && principal.agentId);
  }

  userMemoryRoot(principal?: ScopePrincipal): string | undefined {
    return this.enterprise && this.enterprisePrincipalAllowed(principal) && principal?.enterprise?.sharedMemoryEnabled
      ? `_scopes/users/${principal.userId}/SharedMemory` : undefined;
  }

  isLegacyDiscussionPath(path: string, includeAncestors = false): boolean {
    return isLegacyDiscussionPath(path, includeAncestors);
  }

  assertLegacyDiscussionMutationAllowed(path: string, operation: string, includeAncestors = false): void {
    assertLegacyDiscussionMutationAllowed(path, operation, includeAncestors);
  }

  isCommunityPath(path: string): boolean {
    const normalized = normalizePhysicalPath(path).toLowerCase();
    return normalized === COMMUNITY_ROOT.toLowerCase() || normalized.startsWith(`${COMMUNITY_ROOT.toLowerCase()}/`);
  }

  canAccessPhysicalPath(path: string, principal?: ScopePrincipal, recordSource = true): boolean {
    const documentContext = activeDocumentStorageContext();
    if (documentContext?.canAccessPath?.(path) === false && documentContext.canTraversePath?.(path) !== true) return false;
    if (documentContext && !documentContext.access.canReadProtectedDocument(path, documentContext.principal, recordSource)) return false;
    if (!this.canReadProtectedDocument(path, principal, recordSource)) return false;
    if (!this.enterprisePrincipalAllowed(principal)) return false;
    // Reject aliases before classification; callers normally pass canonical paths.
    if (this.enterprise && /(?:^|\/)(?:\.{1,2}|[^/]*[. ])(?:\/|$)/.test(path.replace(/\\/g, '/'))) return false;
    const normalized = normalizePhysicalPath(path);
    if (this.enterprise?.mode === 'public' && this.isCommunityPath(normalized)) return false;
    const checkpoint = modelCheckpoint(path);
    if (checkpoint) {
      if (!principal || checkpoint.legacy || principal.modelId !== checkpoint.modelId) return false;
      if (principal.commandCenterId && principal.commandCenterId !== this.commandCenterId) return false;
      return checkpoint.accountId === undefined || checkpoint.accountId === principal.accountId;
    }
    if (!normalized) return true;
    if (normalized.toLowerCase() === PRIVATE_ROOT || normalized.toLowerCase().startsWith(`${PRIVATE_ROOT}/`)) {
      const owner = privateOwner(normalized);
      if (!owner || !principal) return false;
      if (principal.commandCenterId && principal.commandCenterId !== this.commandCenterId) return false;
      // User data is deliberately host-local.  A matching userId is useful
      // for family attribution and moderation, but it is not a capability to
      // read the server operator's private files through MCP.
      if (owner.kind === 'user') {
        const root = this.userMemoryRoot(principal)?.toLowerCase();
        return Boolean(root && owner.id === principal.userId
          && (normalized.toLowerCase() === root || normalized.toLowerCase().startsWith(`${root}/`)));
      }
      return owner.kind === 'model'
        ? !this.enterprise && principal.modelId === owner.id
        : owner.kind === 'agent'
          ? principal.agentId === owner.id
          : false;
    }
    if (normalized.toLowerCase() === WHISPER_ROOT || normalized.toLowerCase().startsWith(`${WHISPER_ROOT}/`)) return false;
    return true;
  }

  resolveExternalPath(value: string, principal?: ScopePrincipal): string {
    const raw = String(value || '').trim();
    if (/^(?:[a-z]:|[/\\]|~(?:[/\\]|$))/i.test(raw)) throw guidanceError(new Error('Access denied: use a Vault-relative path or authorized scope:// URI, not a host-absolute path'), 'guid-412bd7a9b2e65617');
    const parsed = parseScopePath(raw);
    if (parsed) {
      if (parsed.kind === 'community' && parsed.id !== this.commandCenterId) {
        throw guidanceError(new Error(`Access denied: community scope '${parsed.id}' belongs to another command center`), 'guid-2cb71ae980f3f838');
      }
      if (parsed.kind !== 'global' && principal?.commandCenterId && principal.commandCenterId !== this.commandCenterId) {
        throw guidanceError(new Error('Access denied: this identity belongs to another command center'), 'guid-76aed71db34ad3ea');
      }
      if (parsed.kind === 'user' && !this.enterprise) throw guidanceError(new Error('User scope is host-only and is not available through MCP; use the server host\'s local Obsidian/filesystem access.'), 'guid-14f1321fb9fd1f6b');
      if (parsed.kind === 'model' && principal?.modelId !== parsed.id) {
        throw guidanceError(new Error(`Access denied: model scope '${parsed.id}' is private`), 'guid-e86ecd7742fca045');
      }
      if (parsed.kind === 'agent' && principal?.agentId !== parsed.id) {
        throw guidanceError(new Error(`Access denied: agent scope '${parsed.id}' is private`), 'guid-e37fa78085e218bc');
      }
      const physical = expandScopePath(raw);
      const expanded = parsed.kind === 'community' && this.enterprise?.mode === 'public'
        ? physical.replace(/^Community(?=\/|$)/, 'PublicCommunity') : physical;
      if (parsed.kind === 'global' && this.isPrivateServicePath(expanded)) {
        throw guidanceError(new Error('Private and service paths are not addressable through the global scope'), 'guid-6a8a2febbf81a85f');
      }
      if (!this.canAccessPhysicalPath(expanded, principal)) throw guidanceError(new Error('Access denied: private checkpoint or scope is unavailable'), 'guid-728e4d408fedf2cf');
      return expanded;
    }

    const normalized = normalizePhysicalPath(raw);
    if (this.enterprise && !this.canAccessPhysicalPath(normalized, principal)) throw guidanceError(new Error('Access denied: this path is unavailable in the current enterprise realm'), 'guid-72b3279bd0003606');
    if (modelCheckpoint(raw) || this.isPrivateServicePath(posix.normalize(normalized))) {
      throw guidanceError(new Error('Access denied: direct private paths require an authorized scope:// URI'), 'guid-ab3ab07cda368052');
    }
    if (this.isPrivateServicePath(normalized)) {
      if (normalized.toLowerCase() === WHISPER_ROOT || normalized.toLowerCase().startsWith(`${WHISPER_ROOT}/`)) {
        throw guidanceError(new Error('Direct _whispers paths are private; use list_whispers'), 'guid-f6111d98d54c81a6');
      }
      throw guidanceError(new Error('Direct _scopes paths are private; use an authorized scope:// URI'), 'guid-96ad59057b9089ce');
    }
    // Legacy clients still pass physical Community paths to reference/bookmark
    // APIs. Managed community mutations are blocked separately; the canonical
    // scoped form for reads and path arguments remains
    // scope://community/<commandCenterId>/... .
    return raw;
  }

  private isPrivateServicePath(path: string): boolean {
    const normalized = normalizePhysicalPath(path).toLowerCase();
    return normalized === PRIVATE_ROOT
      || normalized.startsWith(`${PRIVATE_ROOT}/`)
      || normalized === WHISPER_ROOT
      || normalized.startsWith(`${WHISPER_ROOT}/`);
  }

  assertMutationAllowed(path: string, operation: string): void {
    assertOriginalMutation(path);
    this.assertLegacyDiscussionMutationAllowed(path, operation);
  }

  canReferenceFrom(containerPath: string, referencedPath: string): boolean {
    const documentContext = activeDocumentStorageContext();
    if (documentContext && documentContext.access.documentAuthority()?.canFlow(containerPath, referencedPath) === false) return false;
    if (this.documentAuthority()?.canFlow(containerPath, referencedPath) === false) return false;
    if (this.enterprise) {
      const containerPrivate = privateOwner(containerPath);
      const referencePrivate = privateOwner(referencedPath);
      if (!containerPrivate && referencePrivate) return false;
      if (this.isCommunityPath(referencedPath) && !containerPrivate && !this.isCommunityPath(containerPath)) return false;
      if (containerPrivate?.kind === 'user') {
        const root = `_scopes/users/${containerPrivate.id}/sharedmemory`;
        const container = normalizePhysicalPath(containerPath).toLowerCase();
        const reference = normalizePhysicalPath(referencedPath).toLowerCase();
        return container.startsWith(`${root}/`) && (!referencePrivate || reference.startsWith(`${root}/`));
      }
    }
    const checkpoint = modelCheckpoint(referencedPath);
    if (checkpoint) {
      const containerCheckpoint = modelCheckpoint(containerPath);
      if (checkpoint.legacy || !checkpoint.accountId || !containerCheckpoint || containerCheckpoint.legacy
        || containerCheckpoint.modelId !== checkpoint.modelId || containerCheckpoint.accountId !== checkpoint.accountId) return false;
    }
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

  scopeRoots(principal?: ScopePrincipal): Array<{ kind: 'agent' | 'model' | 'user' | 'community' | 'global'; root: string }> {
    if (!this.enterprisePrincipalAllowed(principal)) return [];
    const userRoot = this.userMemoryRoot(principal);
    return [
      ...(principal?.agentId ? [{ kind: 'agent' as const, root: `_scopes/agents/${principal.agentId}` }] : []),
      ...(userRoot ? [{ kind: 'user' as const, root: userRoot }] : []),
      ...(!this.enterprise && principal?.modelId ? [{ kind: 'model' as const, root: `_scopes/models/${principal.modelId}` }] : []),
      { kind: 'community' as const, root: this.getCommunityRoot() },
      { kind: 'global' as const, root: '' },
    ];
  }
}
