import { createHash } from 'node:crypto';

export type TargetKind = 'skill' | 'wiki' | 'persona' | 'computer' | 'fiction' | 'harness';
export interface Target { kind: TargetKind; id: string; path?: string }
export interface Scope { kind: 'account' | 'owner' | 'project' | 'computer' | 'scene' | 'session'; id: string }
export interface Evidence { path: string; revision: string }
export interface FeedbackProof { origin: 'human' | 'host_observation'; eventId: string; taskId: string; sessionId: string; observedAt: string }
export const CAUSES = ['search', 'knowledge', 'procedure', 'expression', 'environment', 'tool_failure', 'unknown'] as const;
export interface Feedback {
  id: string; taskId: string; sessionId: string; target: Target; scope: Scope; kind: string;
  signal: 'explicit' | 'implicit'; key: string; value: string; summary: string; basis: Evidence[];
  origin: FeedbackProof['origin'] | 'agent_report'; eventId: string; observedAt: string; withdrawn: boolean;
  cause: typeof CAUSES[number];
}
export interface Preference { key: string; value: string; scope: Scope; cycleId: string }
export const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const unavailable = (): never => { throw Error('Evolution unavailable in the current scope'); };
export function object(v: unknown, keys: readonly string[]): Record<string, any> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) return unavailable();
  return v as Record<string, any>;
}
export const id = (v: unknown): string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(v) ? v : unavailable();
export const revision = (v: unknown): string => v === 'missing' || typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : unavailable();
export function text(v: unknown, max = 1000): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)) return unavailable();
  if (/\b(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|cookie)["']?\s*[:=]\s*\S|\bauthorization\s*:\s*(?:bearer|basic)\s+\S|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/i.test(v.normalize('NFKC'))) return unavailable();
  return v;
}
export function target(v: unknown): Target {
  const r = object(v, ['kind', 'id', 'path']);
  if (!['skill', 'wiki', 'persona', 'computer', 'fiction', 'harness'].includes(r.kind)) return unavailable();
  return { kind: r.kind, id: id(r.id), ...(r.path === undefined ? {} : { path: text(r.path, 400) }) };
}
export function scope(v: unknown): Scope {
  const r = object(v, ['kind', 'id']);
  if (!['account', 'owner', 'project', 'computer', 'scene', 'session'].includes(r.kind)) return unavailable();
  return { kind: r.kind, id: id(r.id) };
}
export const STYLE_VALUES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  verbosity: ['brief', 'balanced', 'detailed'], tone: ['neutral', 'friendly', 'direct'],
  ordering: ['outcome_first', 'steps_first'], language: ['auto', 'en', 'ko'],
});
export function style(key: unknown, value: unknown): { key: string; value: string } {
  if (typeof key !== 'string' || typeof value !== 'string' || !Object.hasOwn(STYLE_VALUES, key) || !STYLE_VALUES[key]!.includes(value)) return unavailable();
  return { key, value };
}
export function normalizeFeedback(v: unknown, proof?: FeedbackProof): Feedback {
  const r = object(v, ['id', 'taskId', 'sessionId', 'target', 'scope', 'kind', 'signal', 'key', 'value', 'summary', 'basis', 'cause']);
  const t = target(r.target), s = scope(r.scope), taskId = id(r.taskId), sessionId = id(r.sessionId);
  if (!['correction', 'preference', 'choice', 'dissatisfaction', 'fact_correction'].includes(r.kind)
    || !['explicit', 'implicit'].includes(r.signal) || !Array.isArray(r.basis) || r.basis.length > 16) return unavailable();
  const key = id(r.key), value = text(r.value, 600);
  const cause = r.cause ?? (t.kind === 'persona' ? 'expression' : 'unknown');
  if (!CAUSES.includes(cause)) return unavailable();
  if (t.kind === 'persona') style(key, value);
  const basis = r.basis.map((b: unknown) => { const e = object(b, ['path', 'revision']); return { path: text(e.path, 400), revision: revision(e.revision) }; });
  if (basis.some((b: Evidence) => b.revision === 'missing')) return unavailable();
  if (proof && (!['human', 'host_observation'].includes(proof.origin) || proof.taskId !== taskId || proof.sessionId !== sessionId
    || !Number.isFinite(Date.parse(proof.observedAt)))) return unavailable();
  return { id: id(r.id), taskId, sessionId, target: t, scope: s, kind: r.kind, signal: r.signal, key, value,
    summary: text(r.summary), cause, basis, origin: proof?.origin ?? 'agent_report', eventId: proof ? id(proof.eventId) : id(r.id),
    observedAt: proof?.observedAt ?? new Date().toISOString(), withdrawn: false };
}
export const feedbackGroup = (f: Feedback): string => hash([f.target, f.scope, f.kind, f.key, f.value]);
export function repetitionReady(feedback: readonly Feedback[], now: number): boolean {
  const first = feedback[0]; if (!first) return false;
  const valid = feedback.filter(f => !f.withdrawn && f.origin !== 'agent_report' && feedbackGroup(f) === feedbackGroup(first)
    && Date.parse(f.observedAt) <= now && Date.parse(f.observedAt) >= now - 30 * 86400000);
  return new Set(valid.map(f => f.eventId)).size >= 3 && new Set(valid.map(f => f.taskId)).size >= 3 && new Set(valid.map(f => f.sessionId)).size >= 2;
}
export interface Evaluation {
  profileRevision: string; safety: boolean; targetCaseIds: string[];
  /** Host evaluator provenance. Missing provenance never counts as an operational trial. */
  method?: 'static' | 'synthetic' | 'agent_behavior' | 'operational';
  receiptHash?: string;
  cases: { id: string; split: string; baseline: boolean; candidate: boolean; withoutSkill?: boolean }[];
  baselineTokens?: number; candidateTokens?: number; withoutSkillTokens?: number;
  baselineMs?: number; candidateMs?: number;
  trials?: EvaluationTrial[];
}
export type EvaluationTrial = Pick<Evaluation, 'cases' | 'safety' | 'baselineTokens' | 'candidateTokens' | 'withoutSkillTokens' | 'baselineMs' | 'candidateMs'>;
export const median = (values: number[]): number => { const v = [...values].sort((a, b) => a - b); return v[Math.floor(v.length / 2)]!; };
export function compareEvaluation(kind: TargetKind, e: Evaluation): { status: 'passed' | 'failed' | 'review_required'; reason: string } {
  const result = (status: 'passed' | 'failed' | 'review_required', reason: string) => ({ status, reason });
  object(e, ['profileRevision', 'safety', 'targetCaseIds', 'cases', 'baselineTokens', 'candidateTokens', 'withoutSkillTokens', 'baselineMs', 'candidateMs', 'method', 'receiptHash', 'trials']);
  if (e.method !== undefined && !['static', 'synthetic', 'agent_behavior', 'operational'].includes(e.method)
    || e.receiptHash !== undefined && !/^[a-f0-9]{64}$/.test(e.receiptHash)) return result('review_required', 'invalid_evaluation_provenance');
  for (const c of e.cases ?? []) { object(c, ['id', 'split', 'baseline', 'candidate', 'withoutSkill']); id(c.id); }
  if (!e || !e.profileRevision || !Array.isArray(e.cases) || !e.cases.length || e.cases.length > 64 || !Array.isArray(e.targetCaseIds)
    || !e.targetCaseIds.length || new Set(e.cases.map(c => c.id)).size !== e.cases.length
    || e.cases.some(c => typeof c.baseline !== 'boolean' || typeof c.candidate !== 'boolean' || !['development', 'holdout'].includes(c.split))
    || e.targetCaseIds.some(id => !e.cases.some(c => c.id === id)) || !e.cases.some(c => c.split === 'holdout')) return result('review_required', 'incomplete_evaluation');
  if (e.safety !== true || e.cases.some(c => c.baseline && !c.candidate)) return result('failed', 'safety_or_regression');
  if (e.cases.some(c => e.targetCaseIds.includes(c.id) && !c.candidate)) return result('review_required', 'target_not_resolved');
  const cost = (a?: number, b?: number) => Number.isFinite(a) && Number.isFinite(b) && a! > 0 && b! >= 0 && b! <= a! * 0.9;
  if (e.method === 'agent_behavior' || e.method === 'operational') {
    if (!Array.isArray(e.trials) || e.trials.length !== 3) return result('review_required', 'paired_trials_required');
    for (const trial of e.trials) {
      object(trial, ['cases', 'safety', 'baselineTokens', 'candidateTokens', 'withoutSkillTokens', 'baselineMs', 'candidateMs']);
      if (!Array.isArray(trial.cases) || hash(trial.cases.map(c => [c.id, c.split])) !== hash(e.cases.map(c => [c.id, c.split]))) return result('review_required', 'paired_trials_required');
      const verdict = compareEvaluation(kind, { ...trial, profileRevision: e.profileRevision, targetCaseIds: e.targetCaseIds, method: 'synthetic' });
      if (verdict.status === 'failed') return verdict;
      if (verdict.reason === 'missing_skill_free_baseline' || verdict.reason === 'incomplete_evaluation') return verdict;
      if (trial.cases.some(c => e.targetCaseIds.includes(c.id) && !c.candidate)) return result('review_required', 'target_not_resolved');
    }
    const measured = (key: keyof EvaluationTrial): number | undefined => {
      const values = e.trials!.map(t => t[key]);
      return values.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0) ? median(values as number[]) : undefined;
    };
    // Never trust self-reported aggregate metrics in place of paired observations.
    const measuredEvaluation: Evaluation = { ...e, cases: e.cases.map(c => ({ ...c,
      baseline: e.trials!.some(t => t.cases.find(x => x.id === c.id)!.baseline),
      candidate: e.trials!.every(t => t.cases.find(x => x.id === c.id)!.candidate),
      ...(kind === 'skill' && { withoutSkill: e.trials!.every(t => t.cases.find(x => x.id === c.id)!.withoutSkill === true) }),
    })) };
    for (const key of ['baselineTokens', 'candidateTokens', 'withoutSkillTokens', 'baselineMs', 'candidateMs'] as const) {
      delete measuredEvaluation[key]; const value = measured(key); if (value !== undefined) measuredEvaluation[key] = value;
    }
    e = measuredEvaluation;
  }
  if (kind === 'skill') {
    if (e.cases.some(c => typeof c.withoutSkill !== 'boolean')) return result('review_required', 'missing_skill_free_baseline');
    if (e.cases.every(c => c.withoutSkill || !c.candidate) && !cost(e.withoutSkillTokens, e.candidateTokens)) return result('review_required', 'skill_unnecessary');
  }
  const improved = e.cases.some(c => e.targetCaseIds.includes(c.id) && !c.baseline && c.candidate);
  if (!improved && !cost(e.baselineTokens, e.candidateTokens) && !cost(e.baselineMs, e.candidateMs)) return result('review_required', 'no_measured_improvement');
  return result('passed', 'target_or_cost_improved');
}
export function selectPreferences(items: readonly Preference[], context: Record<string, string>) {
  const rank: Record<string, number> = { owner: 0, account: 1, project: 2, computer: 2, scene: 2, session: 3 };
  const groups = new Map<string, Preference[]>();
  for (const p of items) {
    if (!['owner', 'account'].includes(p.scope.kind) && context[p.scope.kind] !== p.scope.id) continue;
    const prior = groups.get(p.key) ?? [], best = prior[0];
    if (!best || rank[p.scope.kind]! > rank[best.scope.kind]!) groups.set(p.key, [p]);
    else if (rank[p.scope.kind] === rank[best.scope.kind]) groups.set(p.key, [...prior, p]);
  }
  const preferences: Preference[] = [], conflicts: string[] = [];
  for (const [key, group] of groups) {
    if (new Set(group.map(p => p.value)).size > 1) conflicts.push(key);
    else preferences.push(group[0]!);
  }
  return { preferences: preferences.slice(0, 5), conflicts, partial: preferences.length > 5 };
}
