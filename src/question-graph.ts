import type { FileSystemService } from './filesystem.js';
import type { QueryNote } from './types.js';

export type GraphRelation = 'evidence' | 'supports' | 'contradicts' | 'depends_on' | 'derived_from';
export type GraphLocator = { path: string; revision?: string; heading?: string; blockId?: string; startLine?: number; endLine?: number; quoteHash?: string; propertyPath?: string; malformed?: true };
export type GraphEdge = {
  from: string; fromRevision: string; to: string; toRevision: string;
  relation: GraphRelation; direction: 'incoming' | 'outgoing'; locator?: GraphLocator;
  authorLocator?: GraphLocator; sourceClaimId?: string;
};
export type GraphCandidate = {
  path: string; note: QueryNote; paths: GraphEdge[][]; reasons: Set<string>;
  locators: GraphLocator[]; root: boolean;
};
type Reference = { target: string; relation: GraphRelation; locator?: GraphLocator; incoming?: boolean; revision?: string; authoredTarget?: string; authorLocator?: GraphLocator; sourceClaimId?: string };
type Context = {
  fs: FileSystemService;
  roots: Array<{ path: string; note: QueryNote }>;
  metadata: (path: string) => Promise<QueryNote | undefined>;
  allowed: (path: string) => boolean;
  referenceAllowed: (from: string, to: string) => boolean;
  eligible: (path: string, note: QueryNote) => boolean;
  metadataExhausted: () => boolean;
  gap: (reason: string, path?: string, revision?: string) => void;
};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
const priority = (r: Reference) => r.relation === 'contradicts' || r.relation === 'depends_on' ? 0 : r.relation === 'evidence' ? 1 : 2;
export const isPacketCounterpoint = (fm: Record<string, any>) => fm.knowledge_polarity === 'negative' || fm.polarity === 'negative' || fm.note_kind === 'negative_knowledge' || fm.knowledge_role === 'negative_knowledge';

// Copy only the locator contract. Arbitrary author fields must never enter a packet.
function locator(value: unknown): GraphLocator | undefined {
  if (typeof value === 'string') return { path: value };
  if (!value || typeof value !== 'object' || typeof (value as any).path !== 'string') return;
  const v = value as Record<string, unknown>;
  const result: GraphLocator = { path: v.path as string };
  for (const key of ['revision', 'heading', 'blockId', 'quoteHash'] as const) {
    if (typeof v[key] === 'string') result[key] = v[key];
    else if (v[key] !== undefined) result.malformed = true;
  }
  for (const key of ['startLine', 'endLine'] as const) {
    if (Number.isSafeInteger(v[key]) && (v[key] as number) > 0) result[key] = v[key] as number;
    else if (v[key] !== undefined) result.malformed = true;
  }
  return result;
}

function declarations(note: QueryNote): { references: Reference[]; truncated: boolean } {
  const fm = note.frontmatter;
  const result: Reference[] = [];
  let truncated = false;
  const take = (value: unknown) => {
    const values = array(value);
    if (values.length > 81) truncated = true;
    return values.slice(0, 81);
  };
  const add = (value: unknown, relation: GraphRelation) => {
    const pin = locator(value);
    if (!pin) return;
    if (result.length >= 81) { truncated = true; return; }
    result.push({ target: pin.path, relation, ...(relation === 'evidence' && { locator: pin }) });
  };
  for (const field of ['contradicts', 'depends_on'] as const) for (const value of take(fm[field])) add(value, field);
  for (const field of ['evidence', 'evidence_paths']) for (const value of take(fm[field])) add(value, 'evidence');
  for (const claim of take(fm.claims)) if (claim && typeof claim === 'object') {
    for (const value of take((claim as any).evidence)) add(value, 'evidence');
    for (const value of take((claim as any).evidence_paths)) add(value, 'evidence');
    for (const value of take((claim as any).contradicts)) add(value, 'contradicts');
  }
  for (const field of ['supports', 'derived_from'] as const) for (const value of take(fm[field])) add(value, field);
  return { references: result.sort((a, b) => priority(a) - priority(b)), truncated };
}

/** Discover authored paths without hydrating bodies. Multiple edge kinds and
 * per-path direction survive; neither degree nor distance is a truth score. */
export async function discoverQuestionGraph(ctx: Context): Promise<GraphCandidate[]> {
  const candidates = new Map<string, GraphCandidate>();
  const resolve = ctx.fs.createNoteReferenceResolver(ctx.allowed, ctx.metadata, { fresh: true });
  const resolvedEdges = new Map<string, Array<{ next: string; edge: GraphEdge }>>();
  const inspectionBudget = { remaining: 80 };
  for (const root of ctx.roots) candidates.set(root.path, { ...root, paths: [], reasons: new Set(['direct_question_match', ...(isPacketCounterpoint(root.note.frontmatter) ? ['negative_knowledge'] : [])]), locators: [], root: true });
  let frontier = ctx.roots.map(root => ({ path: root.path, trail: [] as GraphEdge[], visited: [root.path] }));
  for (let depth = 0; depth < 2 && frontier.length; depth++) {
    const authors = [...new Set(frontier.map(item => item.path))];
    const pending: Array<{ path: string; ref: Reference }> = [];
    for (const path of authors) {
      if (resolvedEdges.has(path)) continue;
      const note = candidates.get(path)!.note;
      if (!note.revision) throw Error('Graph author revision unavailable');
      resolvedEdges.set(path, []);
      const declared = declarations(note);
      if (declared.truncated) ctx.gap('evidence_declaration_window_exhausted', path, note.revision);
      for (const ref of declared.references) pending.push({ path, ref });
      if (!ctx.metadataExhausted() && inspectionBudget.remaining > 0) {
        const backlinks = await ctx.fs.getBacklinks(path, 20, ctx.allowed, 0, { includeSourceRevision: true, includeSnapshot: true, expectedRevision: note.revision, relations: ['contradicts', 'claim_contradicts'],
          readMetadata: ctx.metadata, metadataExhausted: ctx.metadataExhausted, inspectionBudget, compact: true });
        for (const link of backlinks.backlinks) if (link.relation === 'contradicts' || link.relation === 'claim_contradicts') {
          if (!link.sourceRevision) { ctx.gap('reverse_relation_revision_unavailable', path, note.revision); continue; }
          const anchor = link.link.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]!.split('#')[1];
          const heading = link.targetHeading || (anchor && !anchor.startsWith('^') ? anchor : undefined);
          const blockId = link.targetBlockId || (anchor?.startsWith('^') ? anchor.slice(1) : undefined);
          pending.push({ path, ref: { target: link.path, relation: 'contradicts', incoming: true, revision: link.sourceRevision, authoredTarget: link.link,
            // Frontmatter-only references may have a synthetic line=1 in the
            // index. Their property path, not that line, is the exact locator.
            authorLocator: { path: link.path, revision: link.sourceRevision, ...(link.propertyPath ? { propertyPath: link.propertyPath } : { startLine: link.line }) },
            ...(link.sourceClaimId && { sourceClaimId: link.sourceClaimId }),
            ...((heading || blockId) && { locator: { path, revision: note.revision,
              ...(heading && { heading }), ...(blockId && { blockId }) } }) } });
        }
        if (backlinks.truncated) {
          ctx.gap('reverse_relation_window_exhausted', path, note.revision);
        }
        if (backlinks.inspectionTruncated) ctx.gap(ctx.metadataExhausted() ? 'metadata_window_exhausted' : 'graph_relation_window_exhausted', path, note.revision);
      }
    }
    pending.sort((a, b) => priority(a.ref) - priority(b.ref));
    for (const { path, ref } of pending) {
      const author = candidates.get(path)!.note;
      // Incoming occurrences already consumed this shared budget in the index,
      // before pagination. Never count a returned reverse occurrence twice.
      if (!ref.incoming) {
        if (!inspectionBudget.remaining) { ctx.gap('graph_relation_window_exhausted', path, author.revision); continue; }
        inspectionBudget.remaining--;
      }
      const [document, anchor] = ref.target.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]!.split('#');
      if (!document || (!ref.incoming && !ctx.referenceAllowed(path, document))) continue;
      const resolved = ref.incoming ? [document] : await resolve(document, { sourcePath: path });
      const visible: Array<{ path: string; note: QueryNote }> = [];
      for (const target of resolved) {
        if (!ctx.allowed(target) || !ctx.referenceAllowed(ref.incoming ? target : path, ref.incoming ? path : target)) continue;
        const note = await ctx.metadata(target);
        if (note && ctx.eligible(target, note)) visible.push({ path: target, note });
        if (visible.length > 1) break;
      }
      // An incomplete identity scan cannot prove uniqueness.
      const needsAliases = !document.includes('/') && !/\.(?:md|markdown|txt)$/i.test(document);
      if (ctx.metadataExhausted() && (needsAliases || resolved.length !== 1 || visible.length !== 1)) { ctx.gap('metadata_window_exhausted', path, author.revision); continue; }
      if (visible.length !== 1) { ctx.gap('unresolved_evidence_or_relation'); continue; }
      const next = visible[0]!;
      if (!author.revision || !next.note.revision || (ref.revision && next.note.revision !== ref.revision)) throw Error('Graph context changed');
      if (ref.incoming) {
        // Backlink indexes may match several meanings of an authored target.
        // Re-resolve the original declaration, not just its author filename.
        const targets = await resolve(ref.authoredTarget || '', { sourcePath: next.path });
        const valid: string[] = [];
        for (const target of targets) if (ctx.allowed(target) && ctx.referenceAllowed(next.path, target)) {
          const meta = await ctx.metadata(target);
          if (meta && ctx.eligible(target, meta)) valid.push(target);
        }
        const originalDocument = (ref.authoredTarget || '').replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]!.split('#')[0]!;
        const identityScanIncomplete = ctx.metadataExhausted() && (targets.length !== 1 || valid.length !== 1 || (!originalDocument.includes('/') && !/\.(?:md|markdown|txt)$/i.test(originalDocument)));
        if (identityScanIncomplete || valid.length !== 1 || valid[0] !== path) {
          ctx.gap(ctx.metadataExhausted() ? 'metadata_window_exhausted' : 'unresolved_evidence_or_relation', path, author.revision); continue;
        }
      }
      let pin = ref.locator;
      if (!ref.incoming && anchor) pin = { ...pin, path: next.path, ...(anchor.startsWith('^') ? { blockId: anchor.slice(1) } : { heading: anchor }) };
      if (pin) pin = { ...pin, path: ref.incoming ? path : next.path };
      const edge: GraphEdge = {
        from: ref.incoming ? next.path : path, to: ref.incoming ? path : next.path,
        fromRevision: ref.incoming ? next.note.revision : author.revision,
        toRevision: ref.incoming ? author.revision : next.note.revision,
        relation: ref.relation, direction: ref.incoming ? 'incoming' : 'outgoing', ...(pin && { locator: pin }),
        ...(ref.authorLocator && { authorLocator: ref.authorLocator }), ...(ref.sourceClaimId && { sourceClaimId: ref.sourceClaimId }),
      };
      resolvedEdges.get(path)!.push({ next: next.path, edge });
      if (!candidates.has(next.path)) candidates.set(next.path, { ...next, paths: [], reasons: new Set(isPacketCounterpoint(next.note.frontmatter) ? ['negative_knowledge'] : []), locators: [], root: false });
    }
    const nextFrontier: typeof frontier = [];
    for (const item of frontier) for (const { next, edge } of resolvedEdges.get(item.path) || []) {
      if (item.visited.includes(next)) continue;
      const candidate = candidates.get(next)!;
      const trail = [...item.trail, edge];
      if (candidate.paths.some(path => JSON.stringify(path) === JSON.stringify(trail))) continue;
      // Classification/discovery is independent of the three displayed paths.
      for (const relation of trail.map(edge => edge.relation)) candidate.reasons.add(relation === 'contradicts' ? 'explicit_counterpoint'
        : relation === 'depends_on' ? 'explicit_prerequisite' : relation === 'evidence' ? 'explicit_source'
          : relation === 'supports' ? 'explicit_support' : 'explicit_derivation');
      if (candidate.paths.length >= 3) {
        const pathPriority = (path: GraphEdge[]) => path.some(e => e.relation === 'contradicts' || e.relation === 'depends_on') ? 0 : path.some(e => e.relation === 'evidence') ? 1 : 2;
        let worst = candidate.paths.length - 1;
        for (let i = worst - 1; i >= 0; i--) if (pathPriority(candidate.paths[i]!) > pathPriority(candidate.paths[worst]!)) worst = i;
        if (pathPriority(trail) < pathPriority(candidate.paths[worst]!)) candidate.paths[worst] = trail;
        ctx.gap('graph_path_window_exhausted', next, candidate.note.revision);
      } else candidate.paths.push(trail);
      candidate.locators = candidate.paths.flatMap(path => {
        const last = path.at(-1)!;
        return last.direction === 'outgoing' && last.locator ? [last.locator] : [];
      });
      nextFrontier.push({ path: next, trail, visited: [...item.visited, next] });
    }
    frontier = nextFrontier;
  }
  return [...candidates.values()].filter(candidate => candidate.root || candidate.paths.length);
}

export function graphBodyPriority(candidate: GraphCandidate): number {
  if (candidate.reasons.has('explicit_counterpoint') || candidate.reasons.has('negative_knowledge') || candidate.reasons.has('explicit_prerequisite')) return 0;
  if (candidate.note.frontmatter.llm_wiki_type === 'source') return 1;
  return candidate.root ? 2 : 3;
}
