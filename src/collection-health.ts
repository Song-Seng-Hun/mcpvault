import type { QueryNote } from './types.js';

type ReadAction = { endpointId: 'notes.read'; arguments: { path: string; maxChars: number } };
type RepairTarget = { path: string; revision: string };
interface CollectionGroup {
  key: string;
  entryPoint: string;
  representativePath?: string;
  representativeTitle?: string;
  purpose?: string;
  scope?: string;
  questions?: string[];
  total: number;
  knowledge: number;
  inbox: number;
  reviewDue: number;
  withoutSummary: number;
  withOpenQuestions: number;
  repairTarget: RepairTarget;
  targetScore: number;
}
export interface CollectionItem {
  key?: string;
  groupKeyOmitted?: true;
  repairTarget: RepairTarget;
  entryPoint?: string;
  representativePath?: string;
  representativeTitle?: string;
  purpose?: string;
  scope?: string;
  questions?: string[];
  total?: number;
  knowledge?: number;
  inbox?: number;
  reviewDue?: number;
  withoutSummary?: number;
  withOpenQuestions?: number;
  attentionScore?: number;
  signals?: string[];
  /** Legacy intent label, not an endpoint ID. */
  nextAction?: string;
  action?: ReadAction;
}
export interface CollectionReport {
  advisory: true;
  basis: 'known_source_snapshot';
  totalNotes?: number;
  collectionTotal?: number;
  collectionCountComplete?: boolean;
  untrackedMemberships?: number;
  generatedAt?: string;
  items?: CollectionItem[];
  nextAction?: ReadAction;
  truncated: boolean;
  retry?: { endpointId: 'wiki.organization_health'; reuseOriginalArguments: true; overrides: { maxChars: 16000 } };
  unavailable?: 'exact_target_exceeds_maximum_budget';
}
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : [];

/** Consumes only the caller's coherent, visible note snapshots. No IO or writes. */
export class CollectionHealthProjection {
  private readonly groups = new Map<string, CollectionGroup>();
  private totalNotes = 0;
  private untrackedMemberships = 0;
  private nextReviewAt = Infinity;

  constructor(private readonly publicPath: (path: string) => string, private readonly evaluatedAt = Date.now()) {}

  isCurrent(at = Date.now()): boolean { return at >= this.evaluatedAt && at < this.nextReviewAt; }

  add(note: QueryNote & { revision: string }): void {
    const path = this.publicPath(note.path);
    const fm = note.frontmatter;
    const kind = text(fm.note_kind).toLowerCase() || (fm.llm_wiki_type === 'knowledge' ? 'knowledge' : '');
    const memberships = [...new Set([text(fm.primary_moc), ...strings(fm.mocs), text(fm.moc)].filter(Boolean))];
    // Public scope-qualified paths keep private filing groups out of _scopes labels.
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')).split('/').slice(0, path.startsWith('scope://') ? 5 : 1).join('/') : 'root';
    const keys = memberships.length ? memberships : [text(fm.domain) ? `domain:${text(fm.domain)}` : `folder:${folder}`];
    const lifecycle = text(fm.lifecycle).toLowerCase();
    const reviewAt = Date.parse(text(fm.review_at));
    const reviewable = !['archived', 'superseded'].includes(lifecycle);
    const due = Number.isFinite(reviewAt) && reviewable && reviewAt <= this.evaluatedAt;
    if (reviewable && Number.isFinite(reviewAt) && reviewAt > this.evaluatedAt) this.nextReviewAt = Math.min(this.nextReviewAt, reviewAt);
    const inbox = lifecycle === 'inbox';
    const missing = ['atomic', 'knowledge', 'decision'].includes(kind) && !text(fm.summary) && strings(fm.key_points).length === 0;
    const questions = strings(fm.open_questions).length > 0;
    const score = Number(due) * 3 + Number(inbox) * 2 + Number(missing) + Number(questions);
    this.totalNotes++;
    for (const key of keys) {
      let group = this.groups.get(key);
      if (!group) {
        if (this.groups.size >= 120) { this.untrackedMemberships++; continue; }
        group = { key, entryPoint: key, total: 0, knowledge: 0, inbox: 0, reviewDue: 0, withoutSummary: 0, withOpenQuestions: 0,
          repairTarget: { path, revision: note.revision }, targetScore: score };
        this.groups.set(key, group);
      }
      if (score > group.targetScore) { group.targetScore = score; group.repairTarget = { path, revision: note.revision }; }
      group.total++;
      if (['atomic', 'knowledge', 'decision', 'literature'].includes(kind)) group.knowledge++;
      if (due) group.reviewDue++;
      if (inbox) group.inbox++;
      if (missing) group.withoutSummary++;
      if (questions) group.withOpenQuestions++;
      if (kind === 'moc' && !group.representativePath) {
        group.representativePath = path;
        group.representativeTitle = (text(fm.title) || path.split('/').at(-1) || path).slice(0, 300);
        if (text(fm.moc_purpose)) group.purpose = text(fm.moc_purpose).slice(0, 500);
        if (text(fm.moc_scope)) group.scope = text(fm.moc_scope).slice(0, 300);
        if (strings(fm.moc_questions).length) group.questions = strings(fm.moc_questions).slice(0, 6).map(value => value.slice(0, 300));
      }
    }
  }

  report(limit: number, maxChars: number): CollectionReport {
    const items: CollectionItem[] = [...this.groups.values()].map(({ targetScore: _score, ...group }) => ({ ...group,
      repairTarget: { ...group.repairTarget }, ...(group.questions && { questions: [...group.questions] }),
      attentionScore: group.reviewDue * 3 + group.inbox * 2 + group.withoutSummary + group.withOpenQuestions,
      signals: [...(group.reviewDue ? ['review_due'] : []), ...(group.inbox ? ['inbox_capture'] : []), ...(group.withoutSummary ? ['missing_progressive_summary'] : []), ...(group.withOpenQuestions ? ['open_questions'] : [])],
      nextAction: group.reviewDue ? 'review_due_notes' : group.inbox ? 'clarify_inbox_captures' : group.withoutSummary ? 'add_compact_projections' : group.withOpenQuestions ? 'connect_questions_to_evidence' : 'keep_collection_healthy',
      action: { endpointId: 'notes.read' as const, arguments: { path: group.repairTarget.path, maxChars: 3000 } },
    })).sort((a, b) => b.attentionScore! - a.attentionScore! || a.key!.localeCompare(b.key!)).slice(0, limit);
    const base = { advisory: true as const, basis: 'known_source_snapshot' as const, totalNotes: this.totalNotes,
      collectionTotal: this.groups.size, collectionCountComplete: this.untrackedMemberships === 0,
      untrackedMemberships: this.untrackedMemberships, generatedAt: new Date(this.evaluatedAt).toISOString(),
      ...(items[0]?.action && { nextAction: items[0].action }) };
    const result: CollectionReport = { ...base, items, truncated: this.groups.size > items.length || this.untrackedMemberships > 0 };
    if (JSON.stringify(result).length <= maxChars) return result;
    result.items = items.map(({ purpose: _p, scope: _s, questions: _q, representativeTitle: _t, ...item }) => item);
    result.truncated = true;
    while (result.items.length > 1 && JSON.stringify(result).length > maxChars) result.items.pop();
    if (JSON.stringify(result).length <= maxChars) return result;
    const first = items[0];
    const compact: CollectionReport = { advisory: true, basis: 'known_source_snapshot', truncated: true,
      items: first ? [{ ...(first.key !== undefined && { key: first.key }), repairTarget: first.repairTarget,
        ...(first.attentionScore !== undefined && { attentionScore: first.attentionScore }),
        ...(first.nextAction && { nextAction: first.nextAction }), ...(first.signals && { signals: first.signals }) }] : [],
      ...(first?.action && { nextAction: first.action }) };
    if (JSON.stringify(compact).length <= maxChars) return compact;
    if (compact.items?.[0]) {
      delete compact.items[0].attentionScore;
      delete compact.items[0].nextAction;
      if (JSON.stringify(compact).length <= maxChars) return compact;
      delete compact.items[0].key;
      compact.items[0].groupKeyOmitted = true;
      if (JSON.stringify(compact).length <= maxChars) return compact;
    }
    if (maxChars >= 12000) return { advisory: true, basis: 'known_source_snapshot', truncated: true, unavailable: 'exact_target_exceeds_maximum_budget' };
    return { advisory: true, basis: 'known_source_snapshot', truncated: true,
      retry: { endpointId: 'wiki.organization_health', reuseOriginalArguments: true, overrides: { maxChars: 16000 } } };
  }
}
