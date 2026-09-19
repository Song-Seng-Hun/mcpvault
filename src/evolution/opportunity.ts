import type { ScopePrincipal } from '../scope-auth.js';
import type { EvolutionService } from './service.js';
import { hash, id } from './policy.js';

interface Progress { status: string; attempts?: number; revision?: string; [key: string]: unknown }
export interface EvolutionSession {
  /** Trusted host code attests the existing approved session; client parameters cannot construct this callback. */
  authorize(signal: AbortSignal): Promise<void>;
  current(cycleId: string, signal: AbortSignal): Promise<Progress>;
  generate(progress: Readonly<Progress>, signal: AbortSignal): Promise<{ candidate: Record<string, unknown> }>;
  evaluate(cycleId: string, progress: Progress, candidate: Record<string, unknown>, signal: AbortSignal): Promise<Progress>;
  apply(cycleId: string, progress: Progress, signal: AbortSignal): Promise<Progress>;
}
/** No timer schedules new work. This bounds one explicitly supplied existing-session opportunity. */
export class EvolutionOpportunity {
  private busy = false;
  async run(request: { cycleId: string; newEvidence: boolean; planMode?: boolean; signal?: AbortSignal }, session?: EvolutionSession): Promise<Progress> {
    if (request.planMode || !request.newEvidence || !session) return { status: 'diagnostic_only' };
    id(request.cycleId);
    if (this.busy) return { status: 'deferred' };
    if (request.signal?.aborted) return { status: 'interrupted', partial: true };
    this.busy = true;
    const controller = new AbortController(), signal = controller.signal;
    let interrupt!: () => void;
    const stopped = new Promise<Progress>(resolve => { interrupt = () => { controller.abort(); resolve({ status: 'interrupted', partial: true, cycleId: request.cycleId }); }; });
    const timer = setTimeout(interrupt, 300000);
    request.signal?.addEventListener('abort', interrupt, { once: true });
    const current = async () => { signal.throwIfAborted(); await session.authorize(signal); signal.throwIfAborted(); };
    const work = (async () => {
      try {
        await current(); let progress = await session.current(request.cycleId, signal); await current();
        if (['applying', 'reverting', 'applied', 'effect_verified', 'withdrawn', 'invalid'].includes(progress.status)) return progress;
        if (['unverified_or_insufficient_signal', 'owner_adapter_unavailable', 'evaluator_unavailable', 'evaluation_interrupted'].includes(String(progress.reason))) return progress;
        if (!Number.isInteger(progress.attempts) || progress.attempts! < 0 || progress.attempts! > 2) return { status: 'review_required' };
        for (let attempt = progress.attempts!; attempt < 2; attempt++) {
          const generated = await session.generate(Object.freeze(structuredClone(progress)), signal); await current();
          progress = await session.evaluate(request.cycleId, progress, generated.candidate, signal); await current();
          if (progress.status === 'evaluated') return await session.apply(request.cycleId, progress, signal);
          if (progress.status !== 'review_required') return progress;
        }
        return progress;
      } catch { return { status: signal.aborted ? 'interrupted' : 'review_required', partial: true, cycleId: request.cycleId }; }
      finally { this.busy = false; clearTimeout(timer); request.signal?.removeEventListener('abort', interrupt); }
    })();
    // A non-cooperative generator cannot write through the bridge after cancellation.
    // Its occupied slot remains busy until it settles; no second background task starts.
    return Promise.race([work, stopped]);
  }
}

export function evolutionSessionBridge(service: EvolutionService, principal: ScopePrincipal,
  host: Pick<EvolutionSession, 'authorize' | 'generate'>): EvolutionSession {
  const assert = (signal: AbortSignal) => async () => { signal.throwIfAborted(); await host.authorize(signal); signal.throwIfAborted(); };
  const call = (args: Record<string, unknown>, signal: AbortSignal) => service.execute('cycle', args, principal, assert(signal));
  return { ...host, current: (cycleId, signal) => call({ op: 'read', cycleId }, signal),
    evaluate: async (cycleId, progress, candidate, signal) => {
      const next = await call({ op: 'advance', cycleId, candidate, expectedRevision: progress.revision, requestId: hash(['generate', cycleId, progress.attempts]) }, signal);
      return call({ op: 'check', cycleId, expectedRevision: next.revision, requestId: hash(['evaluate', cycleId, next.attempts]) }, signal);
    },
    apply: async (cycleId, progress, signal) => {
      const preview = await call({ op: 'preview', cycleId }, signal);
      return call({ op: 'apply', cycleId, expectedRevision: progress.revision, fingerprint: preview.fingerprint, requestId: hash(['apply', cycleId]) }, signal);
    } };
}
