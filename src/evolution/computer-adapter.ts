import type { ComputerWorldService, ComputerFact } from '../computer-worlds.js';
import type { ScopePrincipal } from '../scope-auth.js';
import type { Cycle, EvolutionAdapter, ResourceSnapshot } from './model.js';
import { hash, object, text, unavailable, type Target } from './policy.js';

/** One existing hardware/software fact only. No world registration, paths, authority or fictional event writes. */
export function computerEvolutionAdapter(service: ComputerWorldService): EvolutionAdapter {
  const read = async (target: Target, principal: ScopePrincipal): Promise<ResourceSnapshot> => {
    if (target.kind !== 'computer') return unavailable();
    let offset = 0, revision: string | undefined, title: string | undefined;
    const facts: ComputerFact[] = [];
    for (let page = 0; page < 33; page++) {
      const result = await service.execute({ op: 'read', worldId: target.id, catalogPath: target.path, maxChars: 12000,
        offset, ...(revision && { expectedCatalogRevision: revision }) }, principal);
      revision = result.revision;
      for (const item of result.items) { title ??= item.title; facts.push(...item.facts); }
      if (!result.partial) return { revision: revision!, value: { title, facts } };
      const next = result.nextAction?.arguments?.offset;
      if (!Number.isSafeInteger(next) || next <= offset || facts.length > 32) return unavailable(); offset = next;
    }
    return unavailable();
  };
  const parameters = (cycle: Readonly<Cycle>) => {
    if (cycle.target.kind !== 'computer' || cycle.scope.kind !== 'computer' || cycle.scope.id !== cycle.target.id || !cycle.basis.length) return unavailable();
    const { fact } = object(cycle.candidate, ['fact']);
    const f = object(fact, ['key', 'category', 'value', 'basis', 'source', 'observedAt']);
    if (!['hardware', 'software'].includes(f.category) || !['observed', 'reported'].includes(f.basis)) return unavailable();
    text(f.value, 600); text(f.source, 240);
    const before = cycle.baseline.value as { title: string; facts: ComputerFact[] };
    const old = before.facts.find(x => x.key === f.key);
    if (!old || old.category !== f.category || !Number.isFinite(Date.parse(f.observedAt)) || Date.parse(f.observedAt) < Date.parse(old.observedAt)) return unavailable();
    return { op: 'update', worldId: cycle.target.id, catalogPath: cycle.target.path, title: before.title,
      facts: before.facts.map(x => x.key === f.key ? f : x), expectedRevision: cycle.baseline.revision,
      requestId: `evo-${hash([cycle.id, cycle.candidate]).slice(0, 40)}`, maxChars: 12000 };
  };
  return { read,
    preview: async (cycle, principal, current) => {
      const params = parameters(cycle); const actual = await read(cycle.target, principal); await current();
      if (actual.revision !== cycle.baseline.revision || hash(actual.value) !== hash(cycle.baseline.value)) return unavailable();
      return { expectedRevision: actual.revision, fingerprint: hash(params) };
    },
    apply: async (cycle, principal, current) => {
      const params = parameters(cycle); await current();
      if (cycle.intent?.fingerprint !== hash(params) || cycle.intent.expectedRevision !== cycle.baseline.revision) return unavailable();
      const result = await service.execute(params, principal); await current();
      return { revision: result.revision };
    },
    reconcile: async (cycle, principal, current) => {
      const revision = await service.verifyUpdate(parameters(cycle), principal); await current();
      return revision ? { state: 'applied', revision } : { state: 'unknown' };
    },
  };
}
