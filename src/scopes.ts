import { guidanceError, guidanceText } from './guidance-runtime.js';
import type { FileSystemService } from './filesystem.js';
import type { SearchService } from './search.js';
import { boundSearchResults, normalizeSearchLimit, normalizeSearchMaxChars } from './search-limits.js';

/**
 * Scope hierarchy:
 *
 * - global: content that is safe to replicate between command centers
 * - community: public content owned by one command center (currently backed
 *   by the existing Community/ tree for Obsidian compatibility)
 * - user: host-only private content; never exposed through MCP
 * - model/agent: legacy private namespaces retained for old vaults and
 *   per-agent continuity
 */
export type ScopeKind = 'global' | 'community' | 'user' | 'model' | 'agent';

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export function normalizeScopeId(value: string, field: string): string {
  const id = String(value || '').trim().toLowerCase();
  if (!ID_PATTERN.test(id)) {
    throw guidanceError(new Error(`${field} must be 1-64 lowercase letters, numbers, dots, underscores, or hyphens`), 'guid-2313453cde190a0f');
  }
  return id;
}

export function parseScopePath(value: string): { kind: ScopeKind; id?: string; logicalPath: string } | undefined {
  const raw = String(value || '').trim();
  if (!raw.toLowerCase().startsWith('scope://')) return undefined;
  const match = /^scope:\/\/(global|community|user|model|agent)(?:\/([^/]+))?(?:\/(.*))?$/i.exec(raw.replace(/\\/g, '/'));
  if (!match) throw guidanceError(new Error(`Invalid scope path: ${raw}`), 'guid-b67964f904bbf640');
  const kind = match[1]!.toLowerCase() as ScopeKind;
  if (kind === 'global') {
    return { kind, logicalPath: [match[2], match[3]].filter(Boolean).join('/') };
  }
  return {
    kind,
    id: normalizeScopeId(match[2] || '', `${kind}Id`),
    logicalPath: match[3] || '',
  };
}

function normalizeLogicalPath(value: string): string {
  const path = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!path || path.split('/').some(part => part === '..' || part === '.')) {
    throw guidanceError(new Error('path must be a non-empty vault-relative path without . or .. segments'), 'guid-95a7029bb620cceb');
  }
  return path;
}

/** Convert a durable scope URI into the ordinary vault path used by every existing tool. */
export function expandScopePath(value: string): string {
  const raw = String(value || '').trim();
  if (!raw.toLowerCase().startsWith('scope://')) return raw;
  const parsed = parseScopePath(raw)!;
  const kind = parsed.kind;
  if (kind === 'global') {
    const logical = parsed.logicalPath;
    return logical ? normalizeLogicalPath(logical) : '';
  }
  const id = parsed.id!;
  const logical = parsed.logicalPath ? normalizeLogicalPath(parsed.logicalPath) : '';
  if (kind === 'community') {
    // Community notes predate command-center scopes and are intentionally kept
    // in their ordinary Obsidian tree. ScopeAccessPolicy verifies that the
    // URI targets this server's command center before this path is used.
    return `Community${logical ? `/${logical}` : ''}`;
  }
  return `_scopes/${kind}s/${id}${logical ? `/${logical}` : ''}`;
}

export function scopeRoot(kind: ScopeKind, id?: string): string {
  if (kind === 'global') return '';
  if (kind === 'community') return 'Community';
  return `_scopes/${kind}s/${normalizeScopeId(id || '', `${kind}Id`)}`;
}

const now = () => new Date().toISOString();
const identityPath = (agentId: string) => `${scopeRoot('agent', agentId)}/_identity.md`;

export class CollaborationService {
  constructor(private fileSystem: FileSystemService, private searchService: SearchService) {}

  private async inferModelId(agentId?: string, explicitModelId?: string): Promise<string | undefined> {
    if (explicitModelId) return normalizeScopeId(explicitModelId, 'modelId');
    if (!agentId) return undefined;
    const path = identityPath(agentId);
    if (!await this.fileSystem.noteExists(path)) return undefined;
    const identity = await this.fileSystem.readNote(path);
    return identity.frontmatter.model_id ? normalizeScopeId(String(identity.frontmatter.model_id), 'modelId') : undefined;
  }

  getScopeContext(modelId?: string, agentId?: string, userId?: string, commandCenterId = 'local') {
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
      note: guidanceText('guid-291a0ea15ddc3033', 'Global is the cross-command-center knowledge layer. Community is public only inside this command center. User storage is host-only and not exposed through MCP; model and agent namespaces provide private agent access.'),
    };
  }

  async createAgentScope(params: { agentId: string; modelId: string; sessionId: string; displayName?: string; purpose?: string }) {
    const agentId = normalizeScopeId(params.agentId, 'agentId');
    const modelId = normalizeScopeId(params.modelId, 'modelId');
    const sessionId = String(params.sessionId || '').trim();
    if (!sessionId) throw guidanceError(new Error('sessionId is required'), 'guid-17efc95442af7d0e');
    const path = identityPath(agentId);
    if (await this.fileSystem.noteExists(path)) throw guidanceError(new Error(`Agent scope already exists: ${agentId}`), 'guid-2076531205eafb36');
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

  async handoffAgentScope(params: { agentId: string; fromSessionId: string; toSessionId: string; reason: string; expectedGeneration: number }) {
    const agentId = normalizeScopeId(params.agentId, 'agentId');
    const path = identityPath(agentId);
    const note = await this.fileSystem.readNote(path);
    const generation = Number(note.frontmatter.generation);
    if (note.frontmatter.current_session !== params.fromSessionId) {
      throw guidanceError(new Error(`fromSessionId does not hold this agent scope; current holder is ${note.frontmatter.current_session}`), 'guid-c8861af646ed865c');
    }
    if (generation !== params.expectedGeneration) throw guidanceError(new Error(`Stale agent generation: expected ${params.expectedGeneration}, current ${generation}`), 'guid-3bcd0d8ecdb6b932');
    if (!params.toSessionId?.trim() || !params.reason?.trim()) throw guidanceError(new Error('toSessionId and reason are required'), 'guid-516a10054e778adb');
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

  async resumeAgentScope(params: { agentId: string; newSessionId: string; reason: string; expectedGeneration: number }) {
    const agentId = normalizeScopeId(params.agentId, 'agentId');
    const path = identityPath(agentId);
    const note = await this.fileSystem.readNote(path);
    const generation = Number(note.frontmatter.generation);
    if (generation !== params.expectedGeneration) throw guidanceError(new Error(`Stale agent generation: expected ${params.expectedGeneration}, current ${generation}`), 'guid-3bcd0d8ecdb6b932');
    if (!params.newSessionId?.trim() || !params.reason?.trim()) throw guidanceError(new Error('newSessionId and reason are required'), 'guid-e7e33f934fc670f8');
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

  async readScopedNote(params: { path: string; modelId?: string; agentId?: string; userId?: string; commandCenterId?: string }, canAccessPath: (path: string) => boolean = () => true) {
    const logical = normalizeLogicalPath(params.path);
    const modelId = await this.inferModelId(params.agentId, params.modelId);
    const candidates: Array<{ scope: ScopeKind; path: string }> = [];
    if (params.agentId) candidates.push({ scope: 'agent', path: `${scopeRoot('agent', params.agentId)}/${logical}` });
    if (modelId) candidates.push({ scope: 'model', path: `${scopeRoot('model', modelId)}/${logical}` });
    candidates.push({ scope: 'community', path: `${scopeRoot('community', params.commandCenterId || 'local')}/${logical}` });
    candidates.push({ scope: 'global', path: logical });
    for (const candidate of candidates) {
      if (!canAccessPath(candidate.path)) continue;
      if (!await this.fileSystem.noteExists(candidate.path)) continue;
      const note = await this.fileSystem.readNote(candidate.path);
      if (!canAccessPath(candidate.path)) throw guidanceError(new Error('Scoped note unavailable'), 'guid-ca482c5c3b127652');
      return { scope: candidate.scope, logicalPath: logical, physicalPath: candidate.path, fm: note.frontmatter, content: note.content, revision: note.revision };
    }
    throw guidanceError(new Error(`Scoped note not found in ${candidates.map(item => item.scope).join(' > ')} precedence: ${logical}`), 'guid-8812af248f36e652');
  }

  async searchScopedNotes(params: { query: string; modelId?: string; agentId?: string; userId?: string; commandCenterId?: string; limit?: number; maxChars?: number; searchContent?: boolean; searchFrontmatter?: boolean; caseSensitive?: boolean; includeRevisions?: boolean; expandAuthority?: boolean; fictionDomain?: import('./fiction-domain.js').FictionDomainSelection }, canAccessPath?: (path: string) => boolean) {
    const limit = normalizeSearchLimit(params.limit);
    const maxChars = normalizeSearchMaxChars(params.maxChars);
    const modelId = await this.inferModelId(params.agentId, params.modelId);
    const scopes: Array<{ scope: ScopeKind; root: string }> = [];
    if (params.agentId) scopes.push({ scope: 'agent', root: scopeRoot('agent', params.agentId) });
    if (modelId) scopes.push({ scope: 'model', root: scopeRoot('model', modelId) });
    scopes.push({ scope: 'community', root: scopeRoot('community', params.commandCenterId || 'local') });
    scopes.push({ scope: 'global', root: '' });
    const found = new Set<string>();
    const merged: Array<{ value: any; wiki: boolean; scopeRank: number; order: number }> = [];
    for (const item of scopes) {
      const results = await this.searchService.search({
        query: params.query, limit: 20,
        ...(canAccessPath && { canAccessPath }),
        ...(params.searchContent !== undefined && { searchContent: params.searchContent }),
        ...(params.searchFrontmatter !== undefined && { searchFrontmatter: params.searchFrontmatter }),
        ...(params.caseSensitive !== undefined && { caseSensitive: params.caseSensitive }),
        ...(params.includeRevisions !== undefined && { includeRevisions: params.includeRevisions }),
        ...(params.expandAuthority !== undefined && { expandAuthority: params.expandAuthority }),
        ...(params.fictionDomain !== undefined && { fictionDomain: params.fictionDomain }),
        ...(item.root ? { pathPrefix: item.root } : { excludePaths: ['_scopes', '_collaboration', '_whispers'] }),
      });
      for (const result of results) {
        if (canAccessPath && !canAccessPath(result.p)) throw guidanceError(new Error('Scoped search access changed; retry'), 'guid-ae8f8924c50d1db1');
        const logicalPath = item.root ? result.p.slice(item.root.length + 1) : result.p;
        if (found.has(logicalPath)) continue;
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
    if (canAccessPath && merged.some(item => !canAccessPath(item.value.physicalPath))) throw guidanceError(new Error('Scoped search access changed; retry'), 'guid-ae8f8924c50d1db1');
    return boundSearchResults(merged.slice(0, limit).map(item => item.value), maxChars);
  }

}
