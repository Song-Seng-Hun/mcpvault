import { createHash } from 'node:crypto';
interface MemoryGroundingItem {
  path: string; revision: string; role: string; validity: string; state: string;
  basis: Array<{ path?: string; revision?: string; state: string }>;
}
/** Typed, read-only handoff. Mechanical revision checks are not semantic or environment verification. */
export function memoryGrounding(item: MemoryGroundingItem) {
  const verified = item.basis.filter(b => b.state === 'current_revision' && b.path && b.revision);
  const reasons = [
    ...(!item.basis.length ? ['support_not_recorded'] : []),
    ...(verified.length !== item.basis.length ? ['support_requires_current_read'] : []),
    ...(['expired', 'not_yet_valid'].includes(item.validity) ? ['outside_declared_validity'] : []),
    ...(item.state !== 'active' ? ['historical_interpretation'] : []),
  ];
  const sourceFamily = createHash('sha256').update(JSON.stringify(verified.length === item.basis.length && verified.length
    ? [...new Set(verified.map(b => `${b.path}\0${b.revision}`))].sort() : [item.path, item.revision])).digest('hex');
  return { state: reasons.length ? 'verification_required' : 'ready_for_comparison', reasons, sourceFamily,
    sourceIntegrity: 'current_revision', environment: 'not_verified', semanticJudgment: 'agent_required', automaticApplication: false,
    nextAction: { endpointId: 'evolution.cycle', arguments: { op: 'diagnose', maxChars: 2000 } },
    workflow: 'Pin current support in an existing compilation job. Compare before applying; only managed updates with guarded rollback qualify for automatic application. No original or preference edits.' };
}
