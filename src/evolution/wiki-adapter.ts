import type { CompilationService } from '../compilation-service.js';
import type { CompilationJob } from '../compilation-model.js';
import type { EvolutionAdapter } from './model.js';
import { hash, object, unavailable } from './policy.js';
import type { ManagedRollback } from '../memory/rollback.js';

/** Applies an already prepared, generated and owner-checked job, never arbitrary Markdown. */
export function wikiEvolutionAdapter(service: CompilationService): EvolutionAdapter {
  const contentBasis = (job: CompilationJob) => hash({ inputs: job.inputs, operation: job.operation, output: job.outputPath,
    originalRevision: job.outputRevision, draft: job.draft, evidence: job.evidence, rule: job.ruleVersion, authority: job.authorityFingerprint });
  return {
    read: async (target, principal) => {
      if (target.kind !== 'wiki' || !target.path) return unavailable();
      const r = await service.evolutionSnapshot(target.id, principal);
      if (r.job.outputPath !== target.path) return unavailable();
      return { revision: r.revision, value: r.job };
    },
    preview: async (cycle, principal, current) => {
      const candidate = object(cycle.candidate, ['jobRevision']);
      const r = await service.evolutionSnapshot(cycle.target.id, principal); await current();
      if (candidate.jobRevision !== cycle.baseline.revision || r.revision !== candidate.jobRevision || r.job.outputPath !== cycle.target.path
        || cycle.scope.kind !== 'project' || cycle.scope.id !== r.job.projectId || r.job.status !== 'checked'
        || r.job.operation !== 'synthesize' || r.job.protection !== 'ready' || !r.job.draft || !r.job.evidence
        || !['new_knowledge', 'extend_existing'].includes(r.job.evidence.decision) || r.job.validation?.status !== 'passed') return unavailable();
      const rollback = await service.captureRollback?.(cycle.target.id, principal); await current();
      return { expectedRevision: r.revision, fingerprint: contentBasis(r.job), ...(rollback && { data: { rollback } }) };
    },
    apply: async (cycle, principal, current) => {
      const r = await service.evolutionSnapshot(cycle.target.id, principal); await current();
      if (cycle.intent?.expectedRevision !== r.revision || cycle.intent.fingerprint !== contentBasis(r.job)) return unavailable();
      const result = await service.execute({ op: 'retry', requestId: cycle.target.id, expectedJobRevision: r.revision, maxChars: 12000 }, principal);
      await current(); if (result.status !== 'completed' || !result.outputRevision) return unavailable();
      return { revision: result.outputRevision };
    },
    reconcile: async (cycle, principal, current) => {
      const r = await service.evolutionSnapshot(cycle.target.id, principal); await current();
      if (r.job.status !== 'completed' || !r.job.receipt || cycle.intent?.fingerprint !== contentBasis(r.job)) return { state: 'unknown' };
      return { state: 'applied', revision: r.job.receipt.outputRevision };
    },
    revert: async (cycle, principal, current) => {
      const rollback = (cycle.intent?.data as { rollback?: ManagedRollback } | undefined)?.rollback;
      if (!rollback || !cycle.outputRevision) return unavailable();
      return service.restoreManaged(cycle.target.id, cycle.outputRevision, rollback, principal, current);
    },
    reconcileRevert: async (cycle, principal, current) => {
      const rollback = (cycle.intent?.data as { rollback?: ManagedRollback } | undefined)?.rollback;
      if (!rollback) return { state: 'unknown' };
      const result = await service.confirmRestored(cycle.target.id, rollback, principal); await current(); return result;
    },
  };
}
