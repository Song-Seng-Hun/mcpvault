import type { ScopePrincipal } from '../scope-auth.js';
import type { HostWorkStorage } from '../host-work-storage.js';
import type { Cycle, EvolutionConfig } from './model.js';
import { hash, id, normalizeFeedback, object, revision, unavailable, type FeedbackProof } from './policy.js';
import { validateHarness, type HarnessProfile } from './harness.js';

export interface DeliveryObservation {
  taskId: string; sessionId: string; cycleId: string; revision: string; representationHash: string; basis: string;
}
export interface OutcomeCheck {
  method: 'static' | 'synthetic' | 'agent_behavior' | 'operational'; checkId: string;
  /** Code-owned observer. Never deserialize a checker or a success flag from MCP/Vault data. */
  evaluate(observation: Readonly<DeliveryObservation>): Promise<{ used: boolean; success: boolean; resultHash: string }>;
}
export interface PinnedHarness { cycleId: string; revision: string; profile: HarnessProfile }
interface Receipt {
  version: 1; kind: 'feedback' | 'delivery' | 'effect' | 'task'; accountId: string; authority: string;
  fingerprint: string; proof?: FeedbackProof; delivery?: DeliveryObservation;
  effect?: NonNullable<Cycle['effect']>; checkId?: string; resultHash?: string;
  harness?: PinnedHarness | null;
}
export interface RuntimeEvidenceOptions {
  storage: HostWorkStorage<EvolutionConfig>;
  authorize(principal: ScopePrincipal): Promise<string>;
  now?: () => number;
}

/** Host-only capture surface; MCP only consumes opaque, byte-bound receipts.
 * Records contain identities/hashes and typed verdicts, never tool bodies or credentials.
 * A delivery receipt is NOT an acknowledgement of retention, understanding or success.
 */
export class EvolutionRuntimeEvidence {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: RuntimeEvidenceOptions) {}
  private async current(p: ScopePrincipal, expected?: string) {
    if (!p?.accountId || !this.options.storage.records || !(await this.options.storage.refresh()).enabled) return unavailable();
    id(p.accountId);
    const authority = await this.options.authorize(p);
    if (typeof authority !== 'string' || !authority || expected !== undefined && expected !== authority) return unavailable();
    return authority;
  }
  private key(p: ScopePrincipal, kind: string, identity: unknown) { return hash(['evolution-runtime-v1', p.accountId, kind, identity]); }
  private async read(token: string, p: ScopePrincipal) {
    if (revision(token) === 'missing') return unavailable();
    const authority = await this.current(p), r = await this.options.storage.records!.read(token);
    await this.current(p, authority);
    if (r.value === undefined) return undefined;
    const v = r.value as Receipt;
    if (!v || v.version !== 1 || v.accountId !== p.accountId || v.authority !== authority
      || !['feedback', 'delivery', 'effect', 'task'].includes(v.kind)) return unavailable();
    return v;
  }
  private async save(token: string, value: Receipt, p: ScopePrincipal) {
    const writer = await this.options.storage.acquire();
    try {
      const assert = async () => { await this.current(p, value.authority); await writer.assertHeld(); };
      await assert(); const prior = await this.options.storage.records!.read(token);
      if (prior.value !== undefined) {
        if (hash(prior.value) !== hash(value)) return unavailable();
      } else await this.options.storage.records!.write(token, value, prior.revision, assert);
      const saved = await this.options.storage.records!.read(token); await assert();
      if (hash(saved.value) !== hash(value)) return unavailable();
      return token;
    } finally { await writer.close(); }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work).catch(() => unavailable());
    this.tail = result.catch(() => undefined); return result;
  }
  pinHarness(p: ScopePrincipal, context: Record<string, unknown>, harness?: PinnedHarness): Promise<PinnedHarness | undefined> {
    const scope = Object.fromEntries(['taskId', 'sessionId', 'taskKind', 'project', 'computer', 'scene'].filter(k => context[k] !== undefined).map(k => [k, id(context[k])]));
    id(scope.taskId); id(scope.sessionId); id(scope.taskKind);
    const chosen = harness ? { cycleId: id(harness.cycleId), revision: revision(harness.revision), profile: validateHarness(harness.profile) } : null;
    if (chosen && (chosen.revision === 'missing' || chosen.profile.modelId !== p.modelId || chosen.profile.taskKind !== scope.taskKind)) return unavailable();
    return this.serial(async () => {
      const authority = await this.current(p), token = this.key(p, 'task', [scope.taskId, scope.sessionId]);
      const fingerprint = hash([scope, p.modelId]), old = await this.read(token, p);
      if (old) {
        if (old.kind !== 'task' || old.fingerprint !== fingerprint || old.harness === undefined) return unavailable();
        return old.harness ? structuredClone(old.harness) : undefined;
      }
      await this.save(token, { version: 1, kind: 'task', accountId: p.accountId, authority, fingerprint, harness: chosen }, p);
      return chosen ?? undefined;
    });
  }
  captureFeedback(p: ScopePrincipal, input: unknown, origin: FeedbackProof['origin'], eventId: string): Promise<string> {
    const raw = structuredClone(input);
    return this.serial(async () => {
      const authority = await this.current(p), normalized = normalizeFeedback(raw);
      if (!['human', 'host_observation'].includes(origin)) return unavailable();
      const proof: FeedbackProof = { origin, eventId: id(eventId), taskId: normalized.taskId, sessionId: normalized.sessionId,
        observedAt: new Date(this.options.now?.() ?? Date.now()).toISOString() };
      // Canonical object shape validated above; bind original fields as actually submitted.
      const fingerprint = hash(raw), token = this.key(p, 'feedback', [origin, proof.eventId]);
      const prior = await this.read(token, p);
      if (prior) { if (prior.kind !== 'feedback' || prior.fingerprint !== fingerprint) return unavailable(); return token; }
      return this.save(token, { version: 1, kind: 'feedback', accountId: p.accountId, authority, fingerprint, proof }, p);
    });
  }
  async attest(token: string, p: ScopePrincipal, raw: unknown): Promise<FeedbackProof | undefined> {
    const r = await this.read(token, p); if (!r) return undefined;
    if (r.kind !== 'feedback' || r.fingerprint !== hash(raw) || !r.proof) return unavailable();
    normalizeFeedback(raw, r.proof); return structuredClone(r.proof);
  }
  captureDelivery(p: ScopePrincipal, input: DeliveryObservation): Promise<string> {
    const raw = structuredClone(input);
    return this.serial(async () => {
      object(raw, ['taskId', 'sessionId', 'cycleId', 'revision', 'representationHash', 'basis']);
      for (const k of ['taskId', 'sessionId', 'cycleId'] as const) id(raw[k]);
      for (const k of ['revision', 'representationHash', 'basis'] as const) if (revision(raw[k]) === 'missing') return unavailable();
      const authority = await this.current(p), token = this.key(p, 'delivery', [raw.taskId, raw.sessionId, raw.cycleId]);
      return this.save(token, { version: 1, kind: 'delivery', accountId: p.accountId, authority, fingerprint: hash(raw), delivery: raw }, p);
    });
  }
  verifyUse(deliveryToken: string, p: ScopePrincipal, check: OutcomeCheck): Promise<string> {
    // Capture the code-owned checker before awaiting. No client-provided module path.
    const { evaluate, method, checkId } = check;
    return this.serial(async () => {
      id(checkId);
      if (!['static', 'synthetic', 'agent_behavior', 'operational'].includes(method) || typeof evaluate !== 'function') return unavailable();
      const delivery = await this.read(deliveryToken, p);
      if (delivery?.kind !== 'delivery' || !delivery.delivery) return unavailable();
      const token = this.key(p, 'effect', deliveryToken), prior = await this.read(token, p);
      if (prior) {
        if (prior.kind !== 'effect' || prior.checkId !== checkId || prior.effect?.method !== method) return unavailable();
        return token;
      }
      const result = await evaluate(Object.freeze(structuredClone(delivery.delivery)));
      await this.current(p, delivery.authority);
      object(result, ['used', 'success', 'resultHash']);
      if (result.used !== true || typeof result.success !== 'boolean' || revision(result.resultHash) === 'missing') return unavailable();
      const d = delivery.delivery;
      return this.save(token, { version: 1, kind: 'effect', accountId: p.accountId, authority: delivery.authority,
        fingerprint: hash([deliveryToken, checkId, result]), delivery: d, checkId, resultHash: result.resultHash,
        effect: { taskId: d.taskId, sessionId: d.sessionId, revision: d.revision, success: result.success, method } }, p);
    });
  }
  async proveUse(token: string, cycle: Readonly<Cycle>, p: ScopePrincipal): Promise<Cycle['effect']> {
    const r = await this.read(token, p);
    if (!r || r.kind !== 'effect') return undefined;
    if (!r.effect || r.delivery?.cycleId !== cycle.id || r.effect.revision !== cycle.outputRevision) return unavailable();
    return structuredClone(r.effect);
  }
}
