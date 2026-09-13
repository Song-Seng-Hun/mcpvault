import type { CompilationOptions, CompilationParams } from './compilation-service.js';
import type { ScopePrincipal } from './scope-auth.js';
import { compilationId, compilationJobRevision, isCompilationRevision, parseCompilationHistory, type CompilationJob } from './compilation-model.js';
import { withEnterpriseStorageContext } from './enterprise-storage-context.js';

export interface CompilationSession {
  signal: AbortSignal; deadline: number;
  /** Host-selected only. apply_verified requires actual quality/operation grants;
   * this value is never accepted from MCP arguments or a generated response. */
  application?: 'check_only' | 'apply_verified';
  assertCurrent(): Promise<void>;
  /** The existing authorized session reads exact inputs and produces data only.
   * This module never starts a model, process, scheduler, or provider. */
  generate(job: Readonly<CompilationJob>, assertCurrent: () => Promise<void>): Promise<
    { content: string; evidence: unknown } | { observation: unknown }>;
}
export interface CompilationSessionRequest { requestId: string; expectedJobRevision: string }

/** Called under CompilationService's single-worker lease. Durable generation
 * reservations prevent uncertain generation from being repeated after restart.
 * Persistence and publication continue through the existing job services. */
export async function runCompilationSession(options: CompilationOptions, request: CompilationSessionRequest,
  principal: ScopePrincipal, context: CompilationSession, execute: (params: CompilationParams) => Promise<any>): Promise<any> {
  const unavailable = () => Error('Compilation session unavailable');
  try {
    if (options.readOnly || !options.host || !options.runtime || !options.adapter
      || !compilationId(request.requestId) || !isCompilationRevision(request.expectedJobRevision)
      || !context || !Number.isFinite(context.deadline) || context.deadline > Date.now() + 300000
      || !['check_only', 'apply_verified'].includes(context.application ?? 'check_only')) throw unavailable();
    const boundary = options.access.captureDocumentBoundary(principal);
    const active = () => { if (context.signal.aborted || Date.now() >= context.deadline) throw unavailable(); boundary(); };
    let expected = request.expectedJobRevision;
    const current = async () => {
      active(); await context.assertCurrent(); active();
      const result = await execute({ op: 'read', requestId: request.requestId, maxChars: 4000 });
      if (result.jobRevision !== expected || result.status === 'review_required' || result.status === 'diagnostic_only') throw unavailable();
      active(); return result;
    };
    let result = await current();
    if (['completed', 'stopped'].includes(result.status)) return result;
    const host = options.host;
    const load = async () => {
      const state = parseCompilationHistory(await host.readState());
      const job = state.jobs.find(j => j.requestId === request.requestId && j.accountId === principal.accountId);
      if (!job || compilationJobRevision(job) !== expected) throw unavailable();
      return { state, job };
    };
    let { job } = await load(); await current();
    if (job.operation !== 'synthesize' || job.protection !== 'ready') throw unavailable();
    const paths = [job.outputPath, ...job.inputs.map(i => i.path)];
    let publication = false;
    const apply = async () => {
      await current(); publication = true;
      try {
        const done = await execute({ op: 'retry', requestId: request.requestId, expectedJobRevision: expected, maxChars: 4000 });
        expected = done.jobRevision; await current(); return done;
      } finally { publication = false; }
    };
    return await withEnterpriseStorageContext({ access: options.access, principal, assertFresh: active,
      canAccessPath: path => paths.includes(path),
      canTraversePath: path => path === '.' || path === '' || paths.some(p => p.startsWith(path + '/')),
      beforeWrite: async () => { if (!publication) throw unavailable(); active(); await context.assertCurrent(); active(); },
    }, async () => {
      // Existing drafts are checked before considering the single refinement.
      // In-flight writes are reconciled by retry, never regenerated here.
      if (job.draft || job.observation || job.intent) {
        if (job.intent) {
          if (context.application !== 'apply_verified') return result;
          return apply();
        }
        result = await execute({ op: 'check', requestId: request.requestId, expectedJobRevision: expected, maxChars: 4000 });
        expected = result.jobRevision; await current(); ({ job } = await load());
      }
      if (!job.draft && !job.observation || result.status === 'partial' && job.validation?.status === 'partial'
        && job.draft && job.evidence && (job.refinements ?? 0) < 1) {
        const priorDraftRevision = job.draft?.fingerprint ?? 'missing';
        if (job.generation?.priorDraftRevision === priorDraftRevision) throw unavailable();
        const writer = await host.acquire();
        let generated: Awaited<ReturnType<CompilationSession['generate']>>;
        try {
          await current(); const loaded = await load(); job = loaded.job;
          job.generation = { basis: expected, priorDraftRevision };
          parseCompilationHistory(loaded.state); await writer.assertHeld();
          await host.writeState(loaded.state); expected = compilationJobRevision(job);
          await writer.assertHeld(); await current(); await load();
          // Async descendants retain this immutable denial even after the
          // parent enters publication; a mutable phase flag is insufficient.
          generated = await withEnterpriseStorageContext({ access: options.access, principal, assertFresh: active,
            beforeWrite: async () => { throw unavailable(); },
          }, () => context.generate(structuredClone(job), async () => { await writer.assertHeld(); await current(); }));
          await writer.assertHeld(); await current(); await load();
          if (!generated || typeof generated !== 'object' || Array.isArray(generated)
            || Object.keys(generated).some(k => !['content', 'evidence', 'observation'].includes(k))) throw unavailable();
        } finally { await writer.close(); }
        await current();
        result = await execute({ op: 'submit', requestId: request.requestId, expectedJobRevision: expected, ...generated!, maxChars: 4000 });
        expected = result.jobRevision; await current();
        result = await execute({ op: 'check', requestId: request.requestId, expectedJobRevision: expected, maxChars: 4000 });
        expected = result.jobRevision; await current();
      }
      if (result.status !== 'checked' || context.application !== 'apply_verified') return result;
      await current();
      return apply();
    });
  } catch {
    // Preserve reservations and uncertain outcomes. No provider/body/path errors.
    return { status: 'review_required', reason: 'session_interrupted_or_unavailable', partial: true };
  }
}
