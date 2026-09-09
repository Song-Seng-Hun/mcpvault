import { activeEvolution, evolutionChangeKey, evolutionSourceValid, type EvolutionProposal } from './roleplay-evolution-model.js';
import type { RoleplayState } from './roleplay-model.js';
import { textRows } from './roleplay-projections.js';

export function evolutionRows(s: RoleplayState, usable: (p: EvolutionProposal) => boolean, target?: string): Array<Record<string, any>> {
  return activeEvolution(s, usable).flatMap(p => p.changes.filter(c => !target || c.target === target || c.target === 'world').flatMap(c => {
    const info = { proposalId: p.id, target: c.target, key: c.key, changeKind: c.kind, subjective: ['belief', 'attitude'].includes(c.kind) };
    const rows: Array<Record<string, any>> = c.text ? textRows(c.kind.endsWith('_core') ? 'currentDefinition' : 'evolvingBelief', c.text).map(row => ({ ...row, ...info })) : [{ kind: c.kind === 'event_fact' ? 'confirmedEffects' : 'currentLore', ...info, ...(c.lore && { lore: c.lore }) }];
    if (c.kind === 'event_fact') for (const source of p.sources) {
      const receipt = Object.values(s.requests).find(r => r.receipt.id === source.turnId)!.receipt;
      rows.push(...receipt.effects.map(effect => ({ kind: 'confirmedEffect', ...info, sourceTurn: source.turnId, effect })));
    }
    rows.push(...p.sources.map(source => ({ kind: 'evolutionCause', ...info, ...source })));
    return rows;
  }));
}
export function evolutionProposalRows(s: RoleplayState, p: EvolutionProposal, loreValid: boolean): Array<Record<string, any>> {
  const activeKeys = new Set(activeEvolution(s).filter(q => q.id === p.id).flatMap(q => q.changes.map(evolutionChangeKey)));
  return [
    { kind: 'proposal', id: p.id, author: p.author, characterId: p.characterId, roomId: p.roomId, generation: p.generation, status: p.status, automatic: p.automatic,
      needsReview: !loreValid || !evolutionSourceValid(s, p), reason: p.reason, ...(p.rejectedBy && { rejectedBy: p.rejectedBy, rejectionReason: p.rejectionReason }) },
    ...p.approvals.map(accountId => ({ kind: 'approval', proposalId: p.id, accountId })),
    ...p.sources.map(source => ({ kind: 'source', proposalId: p.id, ...source })),
    ...p.changes.flatMap(c => {
      const info = { proposalId: p.id, changeKind: c.kind, target: c.target, key: c.key, active: loreValid && activeKeys.has(evolutionChangeKey(c)) };
      return c.text ? textRows('change', c.text).map(row => ({ ...row, ...info })) : [{ kind: 'change', ...info, ...(c.lore && { lore: c.lore }) }];
    }),
  ];
}
export function currentLore(s: RoleplayState, usable: (p: EvolutionProposal) => boolean, characterId?: string): string[] {
  let world = s.lore ?? [], character = characterId ? s.characters[characterId]!.lore : [];
  // A superseded initial reference is history, never fallback truth.
  for (const p of Object.values(s.evolution?.proposals ?? {})) if (p.status === 'applied') for (const c of p.changes) {
    if (c.kind === 'world_lore') world = [];
    if (c.kind === 'character_lore' && c.target === characterId) character = [];
  }
  for (const p of activeEvolution(s, usable)) for (const c of p.changes) {
    if (c.kind === 'world_lore') world = c.lore!;
    if (c.kind === 'character_lore' && c.target === characterId) character = c.lore!;
  }
  return [...new Set([...world, ...character])];
}
