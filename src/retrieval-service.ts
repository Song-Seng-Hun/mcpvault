import { guidanceError } from './guidance-runtime.js';
import type { SearchService } from './search.js';
import type { CollaborationService } from './scopes.js';
import type { SemanticSearchService, SemanticSearchOutcome, MemorySemanticSearchOutcome } from './semantic-search.js';
import type { SearchParams, SearchResult, ParsedNote, MemorySearchParams, QueryNotesCursor } from './types.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { FileSystemService } from './filesystem.js';
import { boundSearchResults, normalizeSearchMaxChars, normalizeSearchLimit } from './search-limits.js';
import { isModerationHidden } from './moderation-policy.js';
import { selectContextPassages } from './context-passages.js';
import { endpointIdForTool } from './endpoint-registry.js';
import { posix } from 'node:path';
import { positiveSearchTerms, memoryCandidateLimit } from './search.js';
import { isFictionDomain, type FictionDomainSelection } from './fiction-domain.js';

export const RETRIEVAL_NOTE_BYTES = 8 * 1024 * 1024;
export type RetrievalParams = SearchParams & { principal?: ScopePrincipal; excerptMode?: 'compact' | 'context'; fictionDomain?: FictionDomainSelection };
export type RetrievalHit = SearchResult & { physicalPath?: string; scope?: string; context?: unknown; nextAction?: unknown };
export type RetrievalOutcome = { results: RetrievalHit[]; usedQuery: string; expanded: boolean; semantic: { state: 'disabled' | 'filtered' | 'available' | 'unavailable' } };
export type MemoryCandidateParams = MemorySearchParams & { principal?: ScopePrincipal };
export type MemoryCandidateOutcome = RetrievalOutcome & { complete: boolean };
export function constrainedQuery(query: string): boolean {
  return /["'\[\]:()]|(?:^|\s)-\S|(?:^|\s)OR(?:\s|$)/i.test(query);
}
export function plainQueryExpansion(query: string): string | undefined {
  if (constrainedQuery(query)) return;
  const terms = [...new Set(query.trim().replace(/[?？]+$/, '').split(/\s+/))];
  if (terms.length < 2 || terms.length > 12 || terms.some(t => !/^[\p{L}\p{N}_]+$/u.test(t))) return;
  return terms.join(' OR ');
}
export function bodyStartLine(note: ParsedNote): number {
  const suffix = note.originalContent.length - note.content.length;
  return note.originalContent.slice(0, Math.max(0, suffix)).split('\n').length;
}
export function passageAction(path: string, revision: string, startLine: number, endLine: number) {
  return { endpointId: endpointIdForTool('read_note_lines'), arguments: { path, startLine, endLine, expectedRevision: revision, maxChars: 4000 } };
}

/** Shared adapter-independent retrieval. Indexes discover; current Markdown
 * supplies excerpt content. No persistent question/answer cache or model. */
export class RetrievalService {
  private skillEvolution?: {
    discoveryAllowed(path: string): boolean;
    projectDiscovery(hits: RetrievalHit[], principal?: ScopePrincipal, admitted?: (path: string) => boolean): Promise<RetrievalHit[]>;
  };
  attachSkillEvolution(service: NonNullable<RetrievalService['skillEvolution']>): void { this.skillEvolution = service; }
  async projectSkillDiscovery(hits: RetrievalHit[], principal?: ScopePrincipal, admitted?: (path: string) => boolean): Promise<RetrievalHit[]> {
    return this.skillEvolution ? this.skillEvolution.projectDiscovery(hits, principal, admitted) : hits;
  }
  skillDiscoveryAllowed(path: string): boolean { return this.skillEvolution?.discoveryAllowed(path) ?? true; }
  constructor(private readonly search: SearchService, private readonly collaboration: CollaborationService,
    private readonly semantic: Pick<SemanticSearchService, 'search'> & Partial<Pick<SemanticSearchService, 'memoryCandidates'>>, private readonly access: ScopeAccessPolicy,
    private readonly fs: FileSystemService) {}

  physical(hit: RetrievalHit, principal?: ScopePrincipal): string {
    const raw = hit.physicalPath || hit.p;
    const expanded = raw.startsWith('scope://') ? this.access.resolveExternalPath(raw, principal) : raw.replace(/\\/g, '/');
    if (posix.isAbsolute(expanded) || expanded.includes(':')) throw guidanceError(new Error('Search target is unavailable'), 'guid-41fae17fff5e5a9b');
    const path = posix.normalize(expanded);
    if (path === '..' || path.startsWith('../')) throw guidanceError(new Error('Search target is unavailable'), 'guid-41fae17fff5e5a9b');
    if (!this.access.canAccessPhysicalPath(path, principal)) throw guidanceError(new Error('Search target is unavailable'), 'guid-41fae17fff5e5a9b');
    return path;
  }

  /** Capture domain admission before index ranking/limits. This is content
   * routing only; the caller's existing scope predicate remains authoritative. */
  private async fictionAdmission(params: RetrievalParams, admitted: (path: string) => boolean) {
    if (!params.fictionDomain) return admitted;
    const accepted = new Set<string>(); let after: QueryNotesCursor | undefined; let count = 0;
    const prefix = params.pathPrefix ? this.physical({ p: params.pathPrefix } as RetrievalHit, params.principal) : undefined;
    do {
      const batch = await this.fs.queryNotes({ limit: 500, includeContent: false, includeTotal: false, sortBy: 'path', ...(prefix && prefix !== '.' && { pathPrefix: prefix }), ...(after && { after }) }, admitted,
        note => (params.fictionDomain === 'only') === isFictionDomain(note.frontmatter));
      for (const note of batch.notes) {
        if (++count > 10000) throw guidanceError(new Error('Fiction-domain metadata window exhausted'), 'guid-4c9fde591525f971');
        accepted.add(note.path);
      }
      after = batch.truncated ? batch.nextCursor : undefined;
      if (batch.truncated && !after) throw guidanceError(new Error('Fiction-domain metadata changed'), 'guid-8afbb59f1a2fac1f');
    } while (after);
    return (path: string) => admitted(path) && accepted.has(path);
  }

  /** Shared memory discovery only: up to 10,000 metadata hits, ex='', indexed
   * rv, no source hydration and no display/JSON cap. The caller owns bounded
   * current-revision body reads, exact matching and final response serialization.
   * complete=false forbids treating this result window as a lossless inventory. */
  async memoryCandidates(params: MemoryCandidateParams): Promise<MemoryCandidateOutcome> {
    if (typeof params.canAccessPath !== 'function') throw guidanceError(new Error('Memory candidates require a visibility predicate'), 'guid-829812a0c3932d67');
    const limit = memoryCandidateLimit(params.limit);
    const admitted = (path: string) => this.access.canAccessPhysicalPath(path, params.principal) && params.canAccessPath(path) && (this.skillEvolution?.discoveryAllowed(path) ?? true);
    const prefix = params.pathPrefix ? this.physical({ p: params.pathPrefix } as RetrievalHit, params.principal) : '';
    const safe: MemorySearchParams = {
      query: params.query, limit, canAccessPath: admitted, pathPrefix: prefix === '.' ? '' : prefix,
      ...(params.candidateRevisions && { candidateRevisions: params.candidateRevisions }),
    };
    for (const key of ['searchContent', 'searchFrontmatter', 'caseSensitive', 'excludePaths'] as const) {
      if (params[key] !== undefined) Object.assign(safe, { [key]: params[key] });
    }
    let usedQuery = params.query; let expanded = false;
    let lexical: Awaited<ReturnType<SearchService['memoryCandidates']>>;
    try {
      lexical = await this.search.memoryCandidates(safe);
      if (lexical.complete && !lexical.results.length) {
        const expansion = plainQueryExpansion(usedQuery);
        if (expansion) {
          usedQuery = expansion; expanded = true;
          lexical = await this.search.memoryCandidates({ ...safe, query: usedQuery });
        }
      }
    } catch { lexical = { results: [], complete: false }; }
    let complete = lexical.complete;
    let semantic: RetrievalOutcome['semantic'] = { state: 'disabled' };
    const byPath = new Map<string, RetrievalHit>(lexical.results.map(hit => [hit.p, hit]));
    if (params.semantic === true) {
      if (constrainedQuery(params.query) || params.caseSensitive) semantic = { state: 'filtered' };
      else {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let outcome: MemorySemanticSearchOutcome | undefined;
        try {
          if (this.semantic.memoryCandidates) outcome = await Promise.race([
            this.semantic.memoryCandidates({ ...safe,
              ...(params.queryVector !== undefined && { queryVector: params.queryVector }),
              ...(params.principal && { principal: params.principal }),
            }),
            new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 2000); timer.unref?.(); }),
          ]);
        } catch { /* Only bounded states escape the backend boundary. */ }
        finally { if (timer) clearTimeout(timer); }
        semantic = { state: outcome?.available ? 'available' : 'unavailable' };
        complete = complete && outcome?.available === true && outcome.complete;
        for (const hit of outcome?.results || []) {
          if (!admitted(hit.p)) continue;
          const prior = byPath.get(hit.p);
          if (prior && prior.rv !== hit.rv) { complete = false; continue; }
          byPath.set(hit.p, prior ? { ...prior, vs: true,
            ...(hit.semanticDistance !== undefined && { semanticDistance: hit.semanticDistance }),
            why: [...(prior.why || []), 'semantic_candidate'] } : hit);
        }
      }
    }
    const results = [...byPath.values()];
    if (results.some(hit => !admitted(hit.p))) return { results: [], usedQuery, expanded, semantic, complete: false };
    if (results.length > limit) complete = false;
    return { results: results.slice(0, limit), usedQuery, expanded, semantic, complete };
  }

  async retrieve(params: RetrievalParams, allowExpansion = false): Promise<RetrievalOutcome> {
    const scopeAdmitted = (path: string) => this.access.canAccessPhysicalPath(path, params.principal) && (!params.canAccessPath || params.canAccessPath(path)) && (this.skillEvolution?.discoveryAllowed(path) ?? true);
    const admitted = await this.fictionAdmission(params, scopeAdmitted);
    // Runtime payloads are not typed: only the authenticated principal supplies identity.
    const safe: SearchParams = { query: params.query };
    for (const key of ['limit', 'maxChars', 'searchContent', 'searchFrontmatter', 'caseSensitive', 'includeRevisions', 'expandAuthority', 'excludePaths'] as const) {
      if (params[key] !== undefined) Object.assign(safe, { [key]: params[key] });
    }
    const lexical = async (query: string): Promise<RetrievalHit[]> => {
      if (params.pathPrefix) {
        const prefix = this.physical({ p: params.pathPrefix } as RetrievalHit, params.principal);
        const excludePaths = [...(safe.excludePaths || []), ...(prefix.toLowerCase().startsWith('_scopes/') ? [] : ['_scopes']), '_whispers'];
        return (await this.search.search({ ...safe, query, pathPrefix: prefix === '.' ? '' : prefix, excludePaths, canAccessPath: admitted }))
          .filter(hit => admitted(hit.p));
      }
      return this.collaboration.searchScopedNotes({ ...safe, query, ...(params.principal?.modelId && { modelId: params.principal.modelId }), ...(params.principal?.agentId && { agentId: params.principal.agentId }) }, admitted);
    };
    let usedQuery = params.query; let results = await lexical(usedQuery); let expanded = false;
    if (!results.length && allowExpansion) {
      const expansion = plainQueryExpansion(usedQuery);
      if (expansion) { usedQuery = expansion; results = await lexical(usedQuery); expanded = true; }
    }
    let semantic: RetrievalOutcome['semantic'] = { state: 'disabled' };
    if (params.semantic === true) {
      // Preserve exact phrases and exclusions as well as structured filters.
      if (constrainedQuery(params.query)) semantic = { state: 'filtered' };
      else {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let outcome: SemanticSearchOutcome | undefined;
        try {
          outcome = await Promise.race([
            this.semantic.search({ ...safe, canAccessPath: admitted, ...(params.pathPrefix !== undefined && { pathPrefix: this.physical({ p: params.pathPrefix } as RetrievalHit, params.principal) }), ...(params.queryVector !== undefined && { queryVector: params.queryVector }), ...(params.principal && { principal: params.principal }) }),
            new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 2000); timer.unref?.(); }),
          ]);
        } catch { /* Optional backend failures never erase lexical results. */ }
        finally { if (timer) clearTimeout(timer); }
        semantic = { state: outcome?.available ? 'available' : 'unavailable' };
        const byPath = new Map(results.map(hit => [this.physical(hit, params.principal), hit]));
        for (const hit of outcome?.results || []) {
          if (!admitted(hit.p)) continue;
          const physical = this.physical(hit, params.principal); const prior = byPath.get(physical);
          byPath.set(physical, prior ? { ...prior, vs: true, why: [...new Set([...(prior.why || []), 'semantic_match'])] } : hit);
        }
        results = [...byPath.values()].sort((a, b) => Number(Boolean(b.wk)) - Number(Boolean(a.wk))).slice(0, normalizeSearchLimit(params.limit));
        results = boundSearchResults(results, normalizeSearchMaxChars(params.maxChars));
      }
    }
    if (allowExpansion) {
      const terms = positiveSearchTerms(params.query).map(t => t.toLocaleLowerCase());
      const score = (hit: RetrievalHit) => {
        const preview = `${hit.t}\n${hit.ex}`.toLocaleLowerCase();
        return terms.reduce((n, term) => n + Number(preview.includes(term)), 0);
      };
      // Only query packets favor candidate previews covering more of the question;
      // ordinary search ordering and its compact compatibility contract stay intact.
      results = [...results].sort((a, b) => Number(Boolean(b.wk)) - Number(Boolean(a.wk)) || score(b) - score(a));
    }
    const within = (path: string, prefix: string) => {
      const normalize = (v: string) => v.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
      const p = normalize(path), root = normalize(prefix);
      return !root || p === root || p.startsWith(`${root}/`);
    };
    const prefix = params.pathPrefix ? this.physical({ p: params.pathPrefix } as RetrievalHit, params.principal) : '';
    const exactMatches = constrainedQuery(params.query) ? new Set(results.map(h => this.physical(h, params.principal))) : undefined;
    const projected = await this.projectSkillDiscovery(results, params.principal, path => admitted(path)
      && (!prefix || prefix === '.' || within(path, prefix))
      && !(params.excludePaths || []).some(exclude => within(path, exclude))
      && (!exactMatches || exactMatches.has(path)));
    return { results: boundSearchResults(projected, normalizeSearchMaxChars(params.maxChars)), usedQuery, expanded, semantic };
  }

  async searchNotes(params: RetrievalParams): Promise<RetrievalHit[]> {
    if (params.excerptMode !== undefined && !['compact', 'context'].includes(params.excerptMode)) throw guidanceError(new Error('Invalid excerptMode'), 'guid-aeb6cd862871ecc0');
    const outcome = await this.retrieve(params);
    let results = outcome.results;
    if (params.excerptMode === 'context') {
      const expanded: RetrievalHit[] = [];
      for (const hit of results) {
        const path = this.physical(hit, params.principal);
        const metadata = (await this.fs.readNoteMetadata([path], p => this.access.canAccessPhysicalPath(p, params.principal), { fresh: true, strict: true, maxBytes: RETRIEVAL_NOTE_BYTES }))[0];
        if (!metadata || isModerationHidden(metadata.frontmatter)) continue;
        const note = await this.fs.readNote(path, RETRIEVAL_NOTE_BYTES);
        if (isModerationHidden(note.frontmatter)) continue;
        if (metadata.revision !== note.revision || (hit.rv && hit.rv !== note.revision)) throw guidanceError(new Error('Search context changed; repeat the same query'), 'guid-2cb5da2fceb83adc');
        const chosen = selectContextPassages({ content: note.content, query: params.query, maxChars: 350, maxPassages: 1, startLine: bodyStartLine(note), ...(hit.ln && { preferredLine: hit.ln }) });
        const passage = chosen.passages[0];
        if (!this.access.canAccessPhysicalPath(path, params.principal) || await this.fs.readNoteRevision(path, RETRIEVAL_NOTE_BYTES) !== note.revision) throw guidanceError(new Error('Search context changed; repeat the same query'), 'guid-2cb5da2fceb83adc');
        const publicPath = this.access.toPublicPath(path);
        expanded.push({ ...hit, p: publicPath, rv: note.revision,
          ex: passage?.text || '', ln: passage?.startLine || 0,
          context: { headingPath: passage?.headingPath || [], truncated: chosen.truncated, ...(passage && { endLine: passage.endLine }) },
          nextAction: passage ? passageAction(publicPath, note.revision, passage.startLine, passage.endLine)
            : { endpointId: endpointIdForTool('get_note_outline'), arguments: { path: publicPath, expectedRevision: note.revision } },
        });
      }
      results = boundSearchResults(expanded, normalizeSearchMaxChars(params.maxChars));
    }
    this.search.recordUsage(params.principal?.accountId || params.principal?.agentId || 'anonymous', params.query, results.length);
    return results;
  }
}
