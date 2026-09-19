import { hash, id, median, revision, unavailable, type Evaluation, type EvaluationTrial, type Target, type TargetKind } from './policy.js';
import type { Cycle } from './model.js';

export interface CaseOutcome { passed: boolean; safety: boolean; resultHash: string; tokens?: number; elapsedMs?: number }
export interface EvaluationCase {
  id: string; split: 'development' | 'holdout'; target?: boolean;
  /** Code-owned implementation; private inputs/answers live in this closure, never in profile metadata. */
  run(input: { variant: 'baseline' | 'candidate' | 'withoutSkill'; cycle: Readonly<Cycle>; signal: AbortSignal; trial: number }): Promise<CaseOutcome>;
}
export interface EvaluationProfile {
  kind: TargetKind; revision: string; method: NonNullable<Evaluation['method']>; cases: readonly EvaluationCase[];
}

/** Runs checks, not model self-reports. Sequential trials avoid parallel memory spikes.
 * The host must install actual, reviewed checks; absent checks remain unavailable.
 */
export class EvolutionEvaluator {
  private readonly profiles = new Map<TargetKind, EvaluationProfile>();
  constructor(profiles: readonly EvaluationProfile[]) {
    for (const p of profiles) {
      id(p.revision);
      if (this.profiles.has(p.kind) || !['static', 'synthetic', 'agent_behavior', 'operational'].includes(p.method)
        || p.cases.length < 2 || p.cases.length > 64 || new Set(p.cases.map(c => c.id)).size !== p.cases.length
        || !p.cases.some(c => c.target) || !p.cases.some(c => c.split === 'holdout')) return unavailable();
      for (const c of p.cases) { id(c.id); if (!['development', 'holdout'].includes(c.split) || typeof c.run !== 'function') return unavailable(); }
      this.profiles.set(p.kind, Object.freeze({ ...p, cases: Object.freeze(p.cases.map(c => Object.freeze({ ...c }))) }));
    }
  }
  profile(target: Target) {
    const p = this.profiles.get(target.kind); if (!p) return undefined;
    return { revision: p.revision, caseIds: p.cases.map(c => c.id), targetCaseIds: p.cases.filter(c => c.target).map(c => c.id),
      holdoutCaseIds: p.cases.filter(c => c.split === 'holdout').map(c => c.id) };
  }
  async evaluate(input: Readonly<Cycle>, signal: AbortSignal): Promise<Evaluation> {
    const cycle = structuredClone(input), profile = this.profiles.get(cycle.target.kind);
    if (!profile) return unavailable();
    const trials: EvaluationTrial[] = [], receiptHashes: string[] = [];
    const count = ['agent_behavior', 'operational'].includes(profile.method) ? 3 : 1;
    for (let trial = 0; trial < count; trial++) {
      const cases: Evaluation['cases'] = [], totals: Record<string, number | undefined> = {};
      let safety = true;
      for (const c of profile.cases) {
        const outcomes: Partial<Record<'baseline' | 'candidate' | 'withoutSkill', CaseOutcome>> = {};
        const variants = cycle.target.kind === 'skill' ? ['baseline', 'candidate', 'withoutSkill'] as const : ['baseline', 'candidate'] as const;
        for (const variant of variants) {
          signal.throwIfAborted();
          const output = await c.run({ variant, cycle: structuredClone(cycle), signal, trial }); signal.throwIfAborted();
          if (typeof output.passed !== 'boolean' || typeof output.safety !== 'boolean' || revision(output.resultHash) === 'missing') return unavailable();
          for (const field of ['tokens', 'elapsedMs'] as const) {
            const value = output[field];
            if (value !== undefined && (!Number.isFinite(value) || value < 0)) return unavailable();
            const key = `${variant}${field === 'tokens' ? 'Tokens' : 'Ms'}`;
            totals[key] = value === undefined || Object.hasOwn(totals, key) && totals[key] === undefined ? undefined : (totals[key] ?? 0) + value;
          }
          outcomes[variant] = output; safety &&= output.safety;
          receiptHashes.push(hash([trial, c.id, variant, output]));
        }
        cases.push({ id: c.id, split: c.split, baseline: outcomes.baseline!.passed, candidate: outcomes.candidate!.passed,
          ...(outcomes.withoutSkill && { withoutSkill: outcomes.withoutSkill.passed }) });
      }
      trials.push({ cases, safety, ...Object.fromEntries(Object.entries(totals).filter(([k, v]) => k !== 'withoutSkillMs' && v !== undefined)) });
    }
    const aggregate: Record<string, number> = {};
    for (const key of ['baselineTokens', 'candidateTokens', 'withoutSkillTokens', 'baselineMs', 'candidateMs'] as const) {
      if (trials.every(t => t[key] !== undefined)) aggregate[key] = median(trials.map(t => t[key]!));
    }
    return { cases: profile.cases.map((c, i) => ({ id: c.id, split: c.split,
      baseline: trials.some(t => t.cases[i]!.baseline), candidate: trials.every(t => t.cases[i]!.candidate),
      ...(cycle.target.kind === 'skill' && { withoutSkill: trials.every(t => t.cases[i]!.withoutSkill) }) })),
      profileRevision: profile.revision, safety: trials.every(t => t.safety), method: profile.method,
      targetCaseIds: profile.cases.filter(c => c.target).map(c => c.id), receiptHash: hash(receiptHashes),
      ...aggregate, ...(count === 3 && { trials }) } as Evaluation;
  }
}
