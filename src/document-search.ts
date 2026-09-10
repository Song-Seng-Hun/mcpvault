import { guidanceError } from './guidance-runtime.js';
import type { DocumentIndex } from './document-index.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { RetrievalService } from './retrieval-service.js';
import { documentMedia } from './document-resource.js';
import { documentFragmentDescriptor } from './document-service.js';
import { fingerprint } from './work-model.js';
import { documentPage } from './document-page.js';
import type { DocumentFragment, DocumentStructure } from './document-structure.js';
import type { DocumentResourceSnapshot } from './document-resource.js';
export interface DocumentSearchParams { query: string; path?: string; expectedRevision?: string; principal?: ScopePrincipal; limit?: number; maxChars?: number; cursor?: string; semantic?: boolean }
export class DocumentSearch {
  constructor(readonly index: DocumentIndex, readonly retrieval?: Pick<RetrievalService, 'searchNotes' | 'skillDiscoveryAllowed'>) {}
  async search(params: DocumentSearchParams) {
    if (typeof params.query !== 'string' || !params.query.trim() || params.query.length > 500) throw guidanceError(new Error('query must contain 1..500 characters'), 'guid-d3c832557d2625c7');
    if (params.expectedRevision && !params.path) throw guidanceError(new Error('expectedRevision requires a target path'), 'guid-cc1aa6398d7ba677');
    const terms = [...new Set(params.query.toLowerCase().trim().split(/\s+/))];
    if (terms.length > 32) throw guidanceError(new Error('Search supports at most 32 terms'), 'guid-84c98edf49f577e4');
    const { reader } = this.index;
    const admitted = (path: string) => reader.filter.isAllowedForListing(path) && reader.access.canAccessPhysicalPath(path, params.principal)
      && (this.retrieval?.skillDiscoveryAllowed(path) ?? true);
    let candidates: string[];
    if (params.path) {
      const path = reader.resolve(params.path, params.principal);
      if (!admitted(path)) throw guidanceError(new Error('Document unavailable'), 'guid-9ef06b8861d9b3c6');
      candidates = [params.path];
    } else {
      if (!this.index.catalog || !this.retrieval) throw guidanceError(new Error('Global document discovery unavailable; provide path'), 'guid-ed66bc161c65360b');
      const hits = await this.retrieval.searchNotes({ query: params.query, limit: 24, maxChars: 12000, includeRevisions: true,
        semantic: params.semantic === true, canAccessPath: admitted, ...(params.principal && { principal: params.principal }) });
      const resourcePaths = (await this.index.catalog.allPathsSnapshot()).filter(path => admitted(path) && !/\.(?:md|markdown)$/i.test(path)
        && (documentMedia(path).text || /\.pdf$/i.test(path))).sort();
      // Bounded candidate discovery is explicitly NOT a whole-Vault completeness claim.
      candidates = [...new Set([...hits.map(hit => hit.p), ...resourcePaths.slice(0, 32).map(path => reader.access.toPublicPath(path))])].slice(0, 48);
    }
    const items: { doc: DocumentStructure; publicPath: string; f: DocumentFragment; score: number }[] = [];
    const generations: { path: string; revision: string; profile: string }[] = [];
    let bytes = 0;
    const snapshots: DocumentResourceSnapshot[] = [];
    for (const path of candidates) {
      if (bytes >= 16 * 1024 * 1024) break;
      let loaded;
      try { loaded = await this.index.load(path, params.principal, params.expectedRevision); }
      catch (error) { if (params.path) throw error; continue; }
      bytes += loaded.snapshot.bytes.length;
      const doc = loaded.structure, publicPath = reader.access.toPublicPath(doc.path);
      if (!admitted(doc.path)) continue;
      snapshots.push(loaded.snapshot);
      generations.push({ path: publicPath, revision: doc.revision, profile: doc.profile });
      const headingMatches = new Map<string, boolean[]>();
      const matchedHeading = (heading: string) => {
        let matches = headingMatches.get(heading);
        if (!matches) { const lower = heading.toLowerCase(); matches = terms.map(term => lower.includes(term)); headingMatches.set(heading, matches); }
        return matches;
      };
      const matches = doc.fragments.filter(f => !f.children.length && !['root', 'frontmatter'].includes(f.kind)).map(f => {
        const text = doc.raw.slice(f.startOffset, f.endOffset).toLowerCase();
        const heading = f.headingPath.map(matchedHeading);
        let score = 0;
        for (let i = 0; i < terms.length; i++) {
          const inHeading = heading.some(matches => matches[i]);
          if (inHeading || text.includes(terms[i]!)) score++;
          if (inHeading) score += 0.25;
        }
        return { f, score };
      }).filter(m => m.score > 0).sort((a, b) => b.score - a.score || a.f.startOffset - b.f.startOffset);
      for (const { f, score } of matches) {
        if (items.length >= 50000) throw guidanceError(new Error('Document match budget exceeded; narrow the query or target path'), 'guid-3b570d741924b9b6');
        items.push({ doc, publicPath, f, score });
      }
    }
    // Counts and pagination describe one revalidated generation, not whichever
    // earlier sources happened to be readable before a later await.
    for (const snapshot of snapshots) {
      if (!admitted(snapshot.path)) throw guidanceError(new Error('Document search visibility changed; repeat the query'), 'guid-3fc1b15902289614');
      await reader.assertCurrent(snapshot, params.principal);
    }
    items.sort((a, b) => b.score - a.score || a.publicPath.localeCompare(b.publicPath) || a.f.startOffset - b.f.startOffset);
    const context = { query: params.query, coverage: params.path ? 'current target document' : 'bounded discovery window; narrow path for exhaustive fragment search',
      completeInventory: Boolean(params.path), gaps: params.path ? [] : ['Global coverage is partial; unselected resources and unavailable parsers may contain relevant evidence.'],
      ranking: 'lexical fragments; optional semantic document candidates are advisory' };
    return documentPage(items, ({ doc, publicPath, f, score }) => ({ path: publicPath, revision: doc.revision, profile: doc.profile,
      ...documentFragmentDescriptor(f), score, ...(doc.locator && { locator: doc.locator }),
      readAction: { endpointId: 'documents.read', arguments: { path: publicPath, expectedRevision: doc.revision, fragmentId: f.id, maxChars: 4000 } } }),
    context, fingerprint({ generations, query: params.query, path: params.path, semantic: params.semantic === true,
      principal: params.principal ?? null }), params, 'documents.search');
  }
}
