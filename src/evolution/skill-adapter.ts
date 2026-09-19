import type { SkillEvolutionService } from '../skill-evolution.js';
import type { ReviewedSkillService } from '../skill-release-service.js';
import type { ScopePrincipal } from '../scope-auth.js';
import type { EvolutionAdapter, Cycle } from './model.js';
import { hash, object, id, unavailable } from './policy.js';

export interface PreparedSkillDelivery { releaseRevision: string; contentHash: string; bindingHash: string }
/** Host-only bridge to existing reviewed admission. No automatic review, privileges or quarantine bypass. */
export interface SkillEvolutionDelivery {
  read(skillId: string, principal: ScopePrincipal): Promise<{ releaseRevision: string; contentHash: string }>;
  prepare(cycle: Readonly<Cycle>, contentHash: string, principal: ScopePrincipal): Promise<PreparedSkillDelivery>;
  apply(prepared: Readonly<PreparedSkillDelivery>, cycle: Readonly<Cycle>, principal: ScopePrincipal): Promise<void>;
}
type Credentials = (principal: ScopePrincipal) => Promise<{ accessToken: string }>;

/** Exact currently reviewed procedure read, never legacy resolve's original fallback. */
export function reviewedDeliveryReader(service: ReviewedSkillService, credentials: Credentials): SkillEvolutionDelivery['read'] {
  return async (skillId, principal) => {
    let content = '', offset = 0, releaseRevision: string | undefined;
    for (let page = 0; page < 16; page++) {
      const result = await service.resolve({ ...await credentials(principal), principal, skillId, offset, maxChars: 12000,
        ...(releaseRevision && { expectedRelease: releaseRevision }) });
      if (result.executionAuthorized !== false || typeof result.content !== 'string' || result.offset !== offset) return unavailable();
      releaseRevision = result.releaseRevision; content += result.content;
      if (content.length > 32768) return unavailable();
      if (!result.partial) return { releaseRevision: releaseRevision!, contentHash: hash(content) };
      const next = result.nextAction?.arguments?.offset;
      if (!Number.isSafeInteger(next) || next <= offset) return unavailable(); offset = next;
    }
    return unavailable();
  };
}

export function skillEvolutionAdapter(service: SkillEvolutionService, credentials: Credentials, delivery: SkillEvolutionDelivery): EvolutionAdapter {
  const auth = async (principal: ScopePrincipal) => ({ ...await credentials(principal), principal, maxChars: 12000 });
  const candidate = (cycle: Readonly<Cycle>) => {
    if (cycle.target.kind !== 'skill' || cycle.target.path !== undefined) return unavailable();
    const p = object(cycle.candidate, ['candidateId', 'evaluationId', 'candidateRevision']);
    id(p.candidateId); id(p.evaluationId);
    return p;
  };
  const reconcile: EvolutionAdapter['reconcile'] = async (cycle, principal, current) => {
    const prepared = (cycle.intent?.data as any)?.delivery as PreparedSkillDelivery | undefined;
    if (!prepared) return { state: 'unknown' };
    const active = await service.resolve({ ...await auth(principal), skillId: cycle.target.id });
    const actual = await delivery.read(cycle.target.id, principal); await current();
    if (active.status !== 'active' || active.partial || typeof active.content !== 'string'
      || hash(active.content) !== prepared.contentHash || actual.contentHash !== prepared.contentHash
      || actual.releaseRevision !== prepared.releaseRevision) return { state: 'unknown' };
    return { state: 'applied', revision: actual.releaseRevision };
  };
  return {
    read: async (target, principal) => {
      if (target.kind !== 'skill' || target.path !== undefined) return unavailable();
      const actual = await delivery.read(target.id, principal);
      const native = await service.resolve({ ...await auth(principal), skillId: target.id });
      if (native.partial || !['active', 'original'].includes(native.status)) return unavailable();
      return { revision: actual.releaseRevision, value: { ...actual, currentRevision: native.currentRevision, versionRevision: native.revision } };
    },
    preview: async (cycle, principal, current) => {
      const p = candidate(cycle), basis = cycle.baseline.value as any, a = await auth(principal);
      const actual = await delivery.read(cycle.target.id, principal);
      if (actual.releaseRevision !== cycle.baseline.revision || actual.contentHash !== basis.contentHash) return unavailable();
      const data = await service.candidate({ ...a, op: 'read', skillId: cycle.target.id, candidateId: p.candidateId });
      if (data.revision !== p.candidateRevision || data.partial || typeof data.content !== 'string') return unavailable();
      const promote = await service.promote({ ...a, op: 'preview', mode: 'auto', skillId: cycle.target.id,
        candidateId: p.candidateId, evaluationId: p.evaluationId, expectedRevision: basis.currentRevision });
      const prepared = await delivery.prepare(cycle, hash(data.content), principal); await current();
      if (prepared.contentHash !== hash(data.content) || !prepared.bindingHash || !prepared.releaseRevision || promote.partial) return unavailable();
      return { expectedRevision: cycle.baseline.revision, fingerprint: hash([promote.fingerprint, prepared, p.candidateRevision]),
        data: { delivery: prepared, promoteFingerprint: promote.fingerprint, candidateRevision: p.candidateRevision } };
    },
    apply: async (cycle, principal, current) => {
      const p = candidate(cycle), intent = cycle.intent?.data as any;
      if (!intent?.delivery || intent.candidateRevision !== p.candidateRevision) return unavailable();
      const a = await auth(principal); await current();
      await service.promote({ ...a, op: 'apply', mode: 'auto', skillId: cycle.target.id, candidateId: p.candidateId, evaluationId: p.evaluationId,
        expectedRevision: (cycle.baseline.value as any).currentRevision, fingerprint: intent.promoteFingerprint,
        requestId: `evo-${hash([cycle.id, cycle.candidate]).slice(0, 40)}` });
      await current(); await delivery.apply(intent.delivery, cycle, principal); await current();
      const result = await reconcile(cycle, principal, current);
      if (result.state !== 'applied' || !result.revision) return unavailable(); return { revision: result.revision };
    },
    reconcile,
  };
}
