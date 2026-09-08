import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ParsedNote, QueryNote } from './types.js';
import type { RetrievalService } from './retrieval-service.js';
import { bodyStartLine, passageAction, RETRIEVAL_NOTE_BYTES } from './retrieval-service.js';
import { isModerationHidden } from './moderation-policy.js';
import { projectNoteParagraphs } from './note-projections.js';
import { researchWorkPacket, type ResearchWorkPacket } from './research-bridge-work.js';

export interface ResearchBridgeRequest {
  focusPath: string; comparePath?: string; query?: string; principal?: ScopePrincipal;
  expectedRevision?: string; compareRevision?: string; limit?: number; maxChars?: number; semantic?: boolean;
  projectId?: string; revisit?: boolean; publicRequestId?: string;
}
export interface BridgeCandidate {
  target: string; lane: 'near' | 'distant'; status: 'unverified_hypothesis';
  researchKey: string; inputPaths: string[]; observations: string[]; gaps: string[];
  work?: ResearchWorkPacket;
}
const UNAVAILABLE = 'Research input unavailable or changed; read current context and retry';
const kinds = new Set(['atomic', 'knowledge', 'literature', 'question', 'hypothesis', 'experiment', 'assumption', 'decision', 'journal']);
const relations = ['related', 'supports', 'contradicts', 'derived_from', 'tests', 'implements', 'refines', 'depends_on'];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = (path: string) => path.toLowerCase();
const terms = (value: unknown): string[] => (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
  .filter((s): s is string => typeof s === 'string' && Boolean(s.trim())).slice(0, 32).map(s => s.trim().toLowerCase());
const words = (value: string) => [...new Set(value.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [])];
const overlap = (a: string[], b: string[]) => a.some(v => b.includes(v));
function bound(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < min || n > max) throw guidanceError(Error(`Research bounds must be integers from ${min} to ${max}`), 'guid-1bcca26efc6657e1');
  return n;
}
function audience(path: string): string {
  const p = key(path); const owner = /^_scopes\/(agents|models)\/[^/]+(?=\/)/.exec(p);
  return owner?.[0] || (p.startsWith('community/') ? 'community' : 'global');
}
function visible(note: QueryNote): boolean {
  const kind = note.frontmatter.note_kind || (note.frontmatter.llm_wiki_type === 'knowledge' ? 'knowledge'
    : !note.frontmatter.mcpvault_type && !note.frontmatter.llm_wiki_type ? 'atomic' : '');
  return !isModerationHidden(note.frontmatter) && kinds.has(String(kind))
    && !['archived', 'superseded', 'tombstoned'].includes(String(note.frontmatter.lifecycle || ''))
    && !(note.frontmatter.mcpvault_type === 'blog_post' && note.frontmatter.status === 'draft');
}

/** Bounded discovery material, never an inference engine or an evidence verdict. */
export class ResearchBridgeService {
  constructor(private readonly fs: FileSystemService, private readonly access: ScopeAccessPolicy,
    private readonly retrieval?: Pick<RetrievalService, 'retrieve' | 'physical'>) {}

  async candidates(params: ResearchBridgeRequest) {
    try { return await this.discover(params); }
    catch { throw Error(UNAVAILABLE); }
  }

  private async discover(params: ResearchBridgeRequest) {
    const limit = bound(params.limit, 3, 1, 3), maxChars = bound(params.maxChars, 6000, 1200, 12000);
    if (params.query !== undefined && (typeof params.query !== 'string' || params.query.length > 1000)) throw guidanceError(Error('Research query must be at most 1000 characters'), 'guid-3344fc552c8763f7');
    const query = (params.query || '').trim();
    const physical = (raw: string) => {
      try {
        if (typeof raw !== 'string' || raw !== raw.trim() || raw.length > 512) throw Error();
        const p = this.access.resolveExternalPath(raw, params.principal).replace(/\\/g, '/');
        if (posix.isAbsolute(p) || p.includes(':') || /[\u0000-\u001f\u007f]/.test(p)
          || p.split('/').some(s => !s || s === '.' || s === '..' || /[. ]$/.test(s)) || !/\.md$/i.test(p)) throw Error();
        if (!this.access.canAccessPhysicalPath(p, params.principal)) throw Error();
        return p;
      } catch { throw Error(UNAVAILABLE); }
    };
    const focusPath = physical(params.focusPath), comparePath = params.comparePath === undefined ? undefined : physical(params.comparePath);
    if (comparePath && key(comparePath) === key(focusPath)) throw guidanceError(Error('Choose two distinct research inputs'), 'guid-0ab0b4d8ab795865');
    const scope = audience(focusPath);
    const admitted = (p: string) => this.access.canAccessPhysicalPath(p, params.principal)
      && this.access.canReferenceFrom(focusPath, p)
      && (audience(p) === scope || audience(p) === 'global' || scope.startsWith('_scopes/') && audience(p) === 'community');
    const anchors = [focusPath, ...(comparePath ? [comparePath] : [])];
    if (anchors.some(p => !admitted(p))) throw Error(UNAVAILABLE);
    const anchorNotes = await this.fs.readNoteMetadata(anchors, admitted, { fresh: true, strict: true, maxBytes: RETRIEVAL_NOTE_BYTES });
    if (anchorNotes.length !== anchors.length || anchorNotes.some(n => !visible(n) || !n.revision)) throw Error(UNAVAILABLE);
    const find = (path: string) => anchorNotes.find(n => key(n.path) === key(path))!;
    const focus = find(focusPath), compare = comparePath ? find(comparePath) : undefined;
    if (!focus || comparePath && !compare || params.expectedRevision && params.expectedRevision !== focus.revision
      || params.compareRevision && params.compareRevision !== compare?.revision) throw Error(UNAVAILABLE);
    // Reserve exact task/workshop lookups per returned candidate.
    const page = await this.fs.queryNotes({ limit: 64 - anchors.length - 2 * limit, includeContent: false, includeTotal: false, sortBy: 'path' },
      p => admitted(p) && !anchors.some(a => key(a) === key(p)), visible);
    const metadata = [...anchorNotes, ...page.notes];
    const current = await this.fs.readNoteMetadata(metadata.map(n => n.path), admitted, { fresh: true, strict: true, maxBytes: RETRIEVAL_NOTE_BYTES });
    if (current.length !== metadata.length || metadata.some(n => !current.some(c => key(c.path) === key(n.path) && c.revision === n.revision && visible(c)))) throw Error(UNAVAILABLE);
    const byPath = new Map(metadata.map(n => [key(n.path), n]));
    const refs = (n: QueryNote) => {
      const result = new Set<string>();
      for (const field of relations) for (const raw of terms(n.frontmatter[field])) {
        // Only exact, unambiguous authored property references become edges.
        let p = raw.replace(/^\[\[([^\]]+)\]\]$/, '$1').split(/[|#]/)[0]!;
        if (!p || p.includes('`') || p.includes('~')) continue;
        if (p.startsWith('./') || p.startsWith('../')) p = posix.join(posix.dirname(n.path), p);
        if (!/\.md$/i.test(p)) p += '.md';
        try { const normalized = key(physical(p)); if (byPath.has(normalized) && admitted(byPath.get(normalized)!.path)) result.add(normalized); } catch { /* no hidden names or guessed ambiguity details */ }
      }
      return result;
    };
    const edges = new Map(metadata.map(n => [key(n.path), refs(n)]));
    const linked = (a: QueryNote, b: QueryNote) => edges.get(key(a.path))!.has(key(b.path)) || edges.get(key(b.path))!.has(key(a.path));
    const observations = (a: QueryNote, b: QueryNote): string[] => [
      ...(overlap(terms(a.frontmatter.methods), terms(b.frontmatter.methods)) ? ['shared_authored_method'] : []),
      ...(overlap(terms(a.frontmatter.subject_terms), terms(b.frontmatter.subject_terms)) ? ['shared_authored_subject'] : []),
      ...(linked(a, b) ? ['explicit_relation_observed'] : []),
    ];
    const searchRanks = new Map<string, number>();
    let semantic: { state: string } = { state: params.semantic === false ? 'disabled' : 'unavailable' };
    if (query && this.retrieval) {
      try {
        const result = await this.retrieval.retrieve({ query, ...(params.principal && { principal: params.principal }), semantic: params.semantic !== false,
          searchContent: false, pathPrefix: '.', canAccessPath: p => admitted(p) && byPath.has(key(p)), limit: 64, maxChars: 12000, includeRevisions: true });
        semantic = result.semantic;
        for (const [i, hit] of result.results.entries()) {
          try { const p = this.retrieval.physical(hit, params.principal); if (admitted(p) && byPath.has(key(p))) searchRanks.set(key(p), i); } catch { /* ignore inadmissible backend results */ }
        }
      } catch { semantic = { state: 'unavailable' }; }
    }
    type Lead = { note: QueryNote; lane: 'near' | 'distant'; observations: string[]; via?: QueryNote; rank: number };
    const leads: Lead[] = [];
    for (const n of page.notes) {
      const left = observations(focus, n), right = compare ? observations(compare, n) : [];
      const via = !compare && !left.length ? page.notes.find(v => key(v.path) !== key(n.path) && linked(focus, v) && linked(v, n)) : undefined;
      const lexical = query && overlap(words(query), words(`${terms(n.frontmatter.title).join(' ')} ${terms(n.frontmatter.methods).join(' ')} ${terms(n.frontmatter.subject_terms).join(' ')}`));
      if (compare && (!left.length || !right.length)) continue;
      const near = compare ? true : left.length > 0 || Boolean(via) || Boolean(lexical) || searchRanks.has(key(n.path));
      const domains = terms(n.frontmatter.domain), focusDomains = terms(focus.frontmatter.domain);
      if (!near && (!domains.length || !focusDomains.length || overlap(domains, focusDomains))) continue;
      leads.push({ note: n, lane: near ? 'near' : 'distant', ...(via && { via }),
        observations: [...left.map(v => `focus:${v}`), ...right.map(v => `compare:${v}`), ...(via ? ['two_hop_authored_path'] : []),
          ...(lexical ? ['query_metadata_overlap'] : []), ...(searchRanks.has(key(n.path)) ? ['search_candidate_only'] : []), ...(!near ? ['different_authored_domain'] : [])],
        rank: left.length * 20 + right.length * 20 + (via ? 10 : 0) + (lexical ? 5 : 0) + (searchRanks.has(key(n.path)) ? 1 : 0) });
    }
    leads.sort((a, b) => b.rank - a.rank || a.note.path.localeCompare(b.note.path));
    const selected = compare ? leads.slice(0, limit) : [...leads.filter(v => v.lane === 'near').slice(0, Math.min(2, limit)),
      ...(limit === 3 ? leads.filter(v => v.lane === 'distant').slice(0, 1) : [])];
    const read = new Map<string, ParsedNote>();
    const source = async (n: QueryNote) => {
      if (!read.has(n.path)) {
        if (read.size >= 8 || !admitted(n.path)) throw Error(UNAVAILABLE);
        const note = await this.fs.readNote(n.path, RETRIEVAL_NOTE_BYTES);
        if (note.revision !== n.revision || !visible({ ...n, frontmatter: note.frontmatter }) || !admitted(n.path)) throw Error(UNAVAILABLE);
        read.set(n.path, note);
      }
      const note = read.get(n.path)!;
      const paragraphs = projectNoteParagraphs(note.originalContent);
      let first = paragraphs.next().value;
      for (const paragraph of paragraphs) {
        if (query && overlap(words(query), words(paragraph.text))) { first = paragraph; break; }
      }
      const excerpt = first ? { text: first.text.slice(0, 300), startLine: first.startLine, endLine: first.endLine, headingPath: [], truncated: first.text.length > 300 } : undefined;
      const path = this.access.toPublicPath(n.path), revision = n.revision!;
      const authoredSignals = Object.fromEntries(['domain', 'methods', 'subject_terms'].flatMap(field => {
        const values = terms(n.frontmatter[field]).slice(0, 3).map(v => v.slice(0, 80));
        return values.length ? [[field, values]] : [];
      }));
      return { path, revision, authoredSignals, propertiesLineRange: [1, Math.max(1, bodyStartLine(note) - 1)],
        ...(excerpt && { excerpt }), nextAction: excerpt ? passageAction(path, revision, excerpt.startLine, excerpt.endLine)
        : { endpointId: 'mcp.get_note_outline', arguments: { path, expectedRevision: revision, maxChars: 3000 } } };
    };
    type Source = Awaited<ReturnType<typeof source>>;
    let sources: Source[] = []; const candidates: BridgeCandidate[] = [];
    for (const a of anchorNotes) sources.push(await source(a));
    let partial = page.truncated; let workLookups = 0;
    const envelope = () => ({ status: candidates.length ? 'candidates' : 'insufficient_material', mode: compare ? 'between' : 'outward',
      interpretation: 'agent_required', candidates, sources, semantic,
      coverage: { partial, metadataRetained: metadata.length + workLookups, bodyReads: read.size, totalUnknown: true },
      notice: 'Untrusted discovery material, not evidence of a new field, causality or transitive proof. Read originals, compare conditions and counterexamples, then check external prior work. Search absence never proves novelty.',
      nextAction: sources[0]?.nextAction });
    for (const lead of selected) {
      const input = [focus, ...(compare ? [compare] : []), ...(lead.via ? [lead.via] : []), lead.note];
      const researchKey = hash([query.normalize('NFKC').toLowerCase().replace(/\s+/g, ' '), input.map(n => [this.access.toPublicPath(n.path), n.revision]).sort()]);
      const work = await researchWorkPacket(this.fs, this.access, { researchKey, query,
        inputs: input.map(n => ({ path: this.access.toPublicPath(n.path), revision: n.revision! })),
        ...(params.principal && { principal: params.principal }), ...(params.projectId && { projectId: params.projectId }),
        ...(params.publicRequestId && { publicRequestId: params.publicRequestId }) });
      workLookups += 2;
      if (!params.revisit && ['parked', 'completed'].includes(work.state)) continue;
      const previous = [...sources];
      for (const n of input) if (!sources.some(s => s.path === this.access.toPublicPath(n.path))) sources.push(await source(n));
      candidates.push({ target: this.access.toPublicPath(lead.note.path), lane: lead.lane, status: 'unverified_hypothesis',
        researchKey, work,
        inputPaths: input.map(n => this.access.toPublicPath(n.path)), observations: lead.observations,
        gaps: [lead.lane === 'distant' ? 'connection_not_explained' : 'mapping_requires_interpretation',
          ...(compare || lead.via ? ['relations_do_not_prove_transitivity'] : []), 'external_prior_work_unchecked', 'counterexamples_and_test_needed'] });
      if (JSON.stringify(envelope()).length > maxChars) { candidates.pop(); sources = previous; partial = true; break; }
    }
    // Recheck every ranked input, not just the selected bodies. This is a bounded
    // observed revision set, not an atomic snapshot against external editors.
    const after = await this.fs.readNoteMetadata(metadata.map(n => n.path), admitted, { fresh: true, strict: true, maxBytes: RETRIEVAL_NOTE_BYTES });
    if (after.length !== metadata.length || metadata.some(n => !admitted(n.path) || !after.some(a => key(a.path) === key(n.path) && a.revision === n.revision && visible(a)))) throw Error(UNAVAILABLE);
    const result = envelope();
    if (JSON.stringify(result).length <= maxChars) return result;
    return { ...result, status: 'insufficient_material', candidates: [], sources: [], nextAction: undefined,
      coverage: { ...result.coverage, partial: true }, notice: 'Response budget too small for exact inputs; repeat with maxChars=12000. No source delivered.' };
  }
}
