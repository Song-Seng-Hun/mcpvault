import type { Character, RoleplayState } from './roleplay-model.js';

export function textRows(kind: string, text: string): Array<Record<string, any>> {
  const characters = Array.from(text);
  return Array.from({ length: Math.ceil(characters.length / 400) }, (_, index) => ({ kind, offset: index * 400, text: characters.slice(index * 400, (index + 1) * 400).join(''), continued: (index + 1) * 400 < characters.length }));
}

/** Read projections only: never split a submitted message into multiple posts. */
export function characterItems(c: Character, state: RoleplayState, availableTurns: ReadonlySet<string>): Array<Record<string, any>> {
  const identity = { characterId: c.id };
  const rows: Array<Record<string, any>> = [{ kind: 'character', ...identity, name: c.name, controller: c.controller, generation: c.generation, location: c.location }];
  for (const kind of ['stats', 'flags', 'relations'] as const) for (const [key, value] of Object.entries(c[kind])) rows.push({ kind, ...identity, key, value });
  for (const [id, owners] of Object.entries(state.items)) if (owners[`character:${c.id}`]) rows.push({ kind: 'inventory', ...identity, id, quantity: owners[`character:${c.id}`] });
  for (const [kind, text] of [['coreMemory', c.coreMemory], ['definition', c.definition]] as const) {
    const characters = Array.from(text);
    for (let offset = 0; offset < characters.length; offset += 400) rows.push({ kind, ...identity, text: characters.slice(offset, offset + 400).join(''), offset, continued: offset + 400 < characters.length });
  }
  for (const belief of c.cognition) if (availableTurns.has(belief.turn)) rows.push({ ...belief, ...identity, kind: 'belief', knowledgeKind: belief.kind });
  return rows;
}

export function worldItems(state: RoleplayState): Array<Record<string, any>> {
  return [
    ...textRows('worldDefinition', state.definition ?? ''),
    ...Object.entries(state.places).map(([id, links]) => ({ kind: 'place', id, links })),
    ...Object.values(state.rules).flatMap(rule => [
      { kind: 'rule', id: rule.id, conditionCount: rule.conditions.length, effectCount: rule.effects.length, ...(rule.questId && { questId: rule.questId }) },
      ...rule.conditions.map((condition, index) => ({ kind: 'ruleCondition', ruleId: rule.id, index, condition })),
      ...rule.effects.map((effect, index) => ({ kind: 'ruleEffect', ruleId: rule.id, index, effect })),
    ]),
    ...Object.entries(state.items).flatMap(([id, owners]) => Object.entries(owners).filter(([, quantity]) => quantity > 0).map(([owner, quantity]) => ({ kind: 'item', id, owner, quantity }))),
  ];
}
