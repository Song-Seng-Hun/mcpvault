import { expect, test } from 'vitest';
import { applyRoleplayCommand, initialRoleplay, roleplayRevision, type RoleplayState } from './roleplay-model.js';
import * as trpg from './roleplay-trpg.js';

const policy = { administrators: ['host'] };
function act(s: RoleplayState, op: string, data: any = {}, actor = 'host', rolls?: number[]) {
  return applyRoleplayCommand(s, { op, data, actor, requestId: `r-${s.sequence}`, expectedRevision: roleplayRevision(s), ...(rolls && { rolls }) }, policy).state;
}
function world() {
  let s = act(initialRoleplay(), 'initialize', { title: 'Test', places: { hall: [], away: [] } });
  for (const id of ['alice', 'bob']) s = act(s, 'character', { id, name: id, controller: id, location: 'hall' });
  return act(s, 'scene', { roomId: 'hall', title: 'Hall', location: 'hall', gm: 'host' });
}
const control = { characterId: 'alice', generation: 1 };
const adopt = (s = world()) => act(s, 'trpg_adopt', { ruleset: trpg.defaultTrpgRuleset() });
test('legacy worlds require explicit host adoption of a strict version-pinned declarative preset', () => {
  const s = world(); expect(s.trpg).toBeUndefined();
  expect(() => act(s, 'trpg_learn', { ...control, skillId: 'guard' }, 'alice')).toThrow(/adopt/);
  expect(() => act(s, 'trpg_adopt', { ruleset: trpg.defaultTrpgRuleset() }, 'alice')).toThrow(/administrator/);
  const next = adopt(s); expect(next.trpg?.ruleset.version).toBe('1.0.0');
  expect(next.trpg!.ruleset.skills.map(skill => [skill.id, skill.requires])).toEqual([['attack', []], ['guard', ['attack']], ['heal', ['attack']]]);
  expect(next.trpg?.sheets.alice).toMatchObject({ attributes: { strength: 2, agility: 1, intellect: 1 }, resources: { hp: 12, focus: 4 }, growth: 3, learned: ['attack'] });
  expect(() => adopt(next)).toThrow(/already/);
  expect(() => trpg.validateTrpgRuleset({ ...trpg.defaultTrpgRuleset(), script: 'eval()' })).toThrow();
  expect(() => trpg.validateTrpgRuleset({ ...trpg.defaultTrpgRuleset(), version: 'latest' })).toThrow();
});
test('custom DAG growth purchases are atomic, prerequisite checked, generation guarded and respec unloads dependants', () => {
  const ruleset = trpg.defaultTrpgRuleset(); ruleset.skills.find(skill => skill.id === 'heal')!.requires = ['guard'];
  let s = act(world(), 'trpg_adopt', { ruleset }); const before = roleplayRevision(s);
  expect(() => act(s, 'trpg_learn', { ...control, skillId: 'heal' }, 'alice')).toThrow(/prerequisite/);
  expect(() => act(s, 'trpg_learn', { ...control, generation: 0, skillId: 'guard' }, 'alice')).toThrow(/generation/);
  expect(roleplayRevision(s)).toBe(before);
  s = act(s, 'trpg_learn', { ...control, skillId: 'guard' }, 'alice');
  s = act(s, 'trpg_learn', { ...control, skillId: 'heal' }, 'alice');
  expect(s.trpg!.sheets.alice!.growth).toBe(0);
  s = act(s, 'trpg_loadout', { ...control, name: 'support', skills: ['attack', 'guard', 'heal'], equipment: [] }, 'alice');
  s = act(s, 'trpg_switch', { ...control, name: 'support' }, 'alice');
  const preview = trpg.trpgRespecPreview(s, 'alice', ['guard']);
  expect(preview.removed).toEqual(['guard', 'heal']); expect(preview.unload).toEqual([{ name: 'support', skills: ['guard', 'heal'] }]);
  expect(preview.dependencies).toEqual([{ skillId: 'heal', requires: 'guard' }]);
  expect(() => act(s, 'trpg_respec', { ...control, remove: ['guard'], previewFingerprint: 'stale' }, 'alice')).toThrow(/fingerprint/);
  s = act(s, 'trpg_respec', { ...control, remove: ['guard'], previewFingerprint: preview.fingerprint }, 'alice');
  expect(s.trpg!.sheets.alice!.learned).toEqual(['attack']); expect(s.trpg!.sheets.alice!.growth).toBe(3);
  expect(s.trpg!.sheets.alice!.loadouts.support!.skills).toEqual(['attack']);
});
test('encounters have recorded initiative, deterministic attack, action budgets, rounds and explicit end', () => {
  let s = adopt();
  s = act(s, 'trpg_encounter_start', { roomId: 'hall', participants: ['alice', 'bob'] }, 'host', [20, 1]);
  expect(s.trpg!.encounters.hall).toMatchObject({ order: ['alice', 'bob'], round: 1, turn: 0, actions: 1 });
  const data = { ...control, roomId: 'hall', skillId: 'attack', targetId: 'bob' };
  expect(() => act(s, 'trpg_act', { ...data, generation: 2 }, 'alice', [20])).toThrow(/generation/);
  expect(() => act(s, 'trpg_act', data, 'bob', [20])).toThrow(/control/);
  expect(() => act(s, 'trpg_act', data, 'alice')).toThrow(/recorded/);
  const first = act(s, 'trpg_act', data, 'alice', [20]); expect(act(s, 'trpg_act', data, 'alice', [20])).toEqual(first);
  expect(first.trpg!.sheets.bob!.resources.hp).toBe(8);
  expect(() => act(first, 'trpg_act', data, 'alice', [20])).toThrow(/action/);
  s = act(first, 'trpg_turn_end', { ...control, roomId: 'hall' }, 'alice');
  s = act(s, 'trpg_turn_end', { characterId: 'bob', generation: 1, roomId: 'hall' }, 'bob');
  expect(s.trpg!.encounters.hall!.round).toBe(2);
  expect(() => act(s, 'trpg_encounter_end', { roomId: 'hall' }, 'alice')).toThrow(/GM/);
  s = act(s, 'trpg_encounter_end', { roomId: 'hall' }); expect(s.trpg!.encounters.hall!.ended).toBe(true);
});
test('canonical receipts expose bounded checks, paid costs and resulting resource changes', () => {
  const s = act(adopt(), 'trpg_encounter_start', { roomId: 'hall', participants: ['alice', 'bob'] }, 'host', [20, 1]);
  const command = { op: 'trpg_act', data: { ...control, roomId: 'hall', skillId: 'attack', targetId: 'bob' }, actor: 'alice', requestId: `r-${s.sequence}`, expectedRevision: roleplayRevision(s), rolls: [20] };
  const hit = applyRoleplayCommand(s, command, policy).receipt;
  expect(hit.mechanics).toMatchObject({ check: { die: 20, modifier: 2, total: 22, defense: 11, success: true }, resources: [{ characterId: 'bob', resource: 'hp', before: 12, after: 8 }], encounter: { actions: 0 } });
  const miss = applyRoleplayCommand(s, { ...command, rolls: [1] }, policy).receipt;
  expect(miss.mechanics).toMatchObject({ check: { success: false }, resources: [], encounter: { actions: 0 } });
});
test('equipment constraints, inventory ownership and combat loadout switches cannot bypass costs', () => {
  let s = adopt();
  expect(() => act(s, 'trpg_loadout', { ...control, name: 'armed', skills: ['attack'], equipment: ['shield'] }, 'alice')).toThrow(/inventory/);
  s = act(s, 'item', { id: 'shield', owner: 'character:alice', quantity: 1 });
  s = act(s, 'trpg_loadout', { ...control, name: 'armed', skills: ['attack'], equipment: ['shield'] }, 'alice');
  s = act(s, 'trpg_encounter_start', { roomId: 'hall', participants: ['alice', 'bob'] }, 'host', [20, 1]);
  expect(() => act(s, 'trpg_loadout', { ...control, name: 'default', skills: ['attack'], equipment: [] }, 'alice')).toThrow(/combat/);
  s = act(s, 'trpg_switch', { ...control, name: 'armed' }, 'alice'); expect(s.trpg!.encounters.hall!.actions).toBe(0);
  expect(trpg.trpgStats(s, 'alice').defense).toBe(13);
  expect(() => act(s, 'give', { ...control, roomId: 'hall', content: 'Give shield', itemId: 'shield', amount: 1, toCharacterId: 'bob' }, 'alice')).toThrow(/combat|equipment/);
});
test('creative combat attempts use the existing GM, consume one action and bind their mechanical basis', () => {
  let s = act(adopt(), 'trpg_encounter_start', { roomId: 'hall', participants: ['alice', 'bob'] }, 'host', [20, 1]);
  expect(() => act(s, 'attempt', { characterId: 'bob', generation: 1, roomId: 'hall', content: 'Knock over a shelf.' }, 'bob')).toThrow(/turn/);
  s = act(s, 'attempt', { ...control, roomId: 'hall', content: 'Distract the opponent.' }, 'alice');
  const pendingId = Object.keys(s.pending)[0]!;
  const resolution = { pendingId, content: 'Distracted.', reason: 'GM ruling', effects: [{ op: 'flag', characterId: 'bob', key: 'distracted', value: true }] };
  const resolved = act(s, 'resolve', resolution);
  expect(resolved.trpg!.encounters.hall!.actions).toBe(0); expect(resolved.characters.bob!.flags.distracted).toBe(true);
  s = act(s, 'trpg_act', { ...control, roomId: 'hall', skillId: 'attack', targetId: 'bob' }, 'alice', [20]);
  expect(() => act(s, 'resolve', resolution)).toThrow(/basis|action/);
});
test('guard expires at the next own turn; focus costs and incapacitation never cause permanent death', () => {
  let s = adopt();
  for (const skillId of ['guard', 'heal']) s = act(s, 'trpg_learn', { ...control, skillId }, 'alice');
  s = act(s, 'trpg_loadout', { ...control, name: 'all', skills: ['attack', 'guard', 'heal'], equipment: [] }, 'alice');
  s = act(s, 'trpg_switch', { ...control, name: 'all' }, 'alice');
  s = act(s, 'trpg_encounter_start', { roomId: 'hall', participants: ['alice', 'bob'] }, 'host', [20, 1]);
  s = act(s, 'trpg_act', { ...control, roomId: 'hall', skillId: 'guard', targetId: 'alice' }, 'alice');
  expect(trpg.trpgStats(s, 'alice').defense).toBe(14);
  s = act(s, 'trpg_turn_end', { ...control, roomId: 'hall' }, 'alice');
  s = act(s, 'trpg_turn_end', { characterId: 'bob', generation: 1, roomId: 'hall' }, 'bob');
  expect(trpg.trpgStats(s, 'alice').defense).toBe(11);
  for (let i = 0; i < 3; i++) {
    s = act(s, 'trpg_act', { ...control, roomId: 'hall', skillId: 'attack', targetId: 'bob' }, 'alice', [20]);
    s = act(s, 'trpg_turn_end', { ...control, roomId: 'hall' }, 'alice');
    if (i < 2) s = act(s, 'trpg_turn_end', { characterId: 'bob', generation: 1, roomId: 'hall' }, 'bob');
  }
  expect(s.trpg!.sheets.bob!.resources.hp).toBe(0); expect(s.trpg!.sheets.bob!.statuses.incapacitated).toBe(1); expect(s.characters.bob).toBeDefined();
  s = act(s, 'trpg_act', { ...control, roomId: 'hall', skillId: 'heal', targetId: 'bob' }, 'alice');
  expect(s.trpg!.sheets.bob!.resources.hp).toBe(4); expect(s.trpg!.sheets.alice!.resources.focus).toBe(2); expect(s.trpg!.sheets.bob!.statuses.incapacitated).toBeUndefined();
  s = act(s, 'trpg_encounter_end', { roomId: 'hall' });
  s = act(s, 'trpg_rest', { ...control }, 'alice'); expect(s.trpg!.sheets.alice!.resources.focus).toBe(4);
});
test('ruleset limits, skill exclusions, equipment slots and insufficient growth reject atomically', () => {
  const r = trpg.defaultTrpgRuleset(); r.skills[2]!.requires = ['attack']; r.skills[2]!.excludes = ['guard']; r.items.armor = { slot: 'hand', defense: 1 };
  let s = act(world(), 'trpg_adopt', { ruleset: r }); s = act(s, 'trpg_learn', { ...control, skillId: 'guard' }, 'alice');
  const before = roleplayRevision(s); expect(() => act(s, 'trpg_learn', { ...control, skillId: 'heal' }, 'alice')).toThrow(/exclusion/); expect(roleplayRevision(s)).toBe(before);
  for (const id of ['shield', 'armor']) s = act(s, 'item', { id, owner: 'character:alice', quantity: 1 });
  expect(() => act(s, 'trpg_loadout', { ...control, name: 'bad', skills: ['attack'], equipment: ['shield', 'armor'] }, 'alice')).toThrow(/slot/);
  const costly = trpg.defaultTrpgRuleset(); costly.skills[1]!.cost = 4;
  const poor = act(world(), 'trpg_adopt', { ruleset: costly }); expect(() => act(poor, 'trpg_learn', { ...control, skillId: 'guard' }, 'alice')).toThrow(/growth/);
  for (const bad of [{ ...r, actionsPerTurn: 0 }, { ...r, switchCost: 0 }, { ...r, attributes: { constructor: 1 } }, { ...r, skills: [{ ...r.skills[0], effect: 'script' }] }]) expect(() => trpg.validateTrpgRuleset(bad)).toThrow();
});
test('a nonparticipant cannot use legacy rules to move a participant or bypass encounter costs', () => {
  let s = adopt();
  s = act(s, 'character', { id: 'charlie', name: 'Charlie', controller: 'charlie', location: 'hall' });
  s = act(s, 'rule', { id: 'push', conditions: [], effects: [{ op: 'move', characterId: 'alice', to: 'away' }] });
  s = act(s, 'trpg_encounter_start', { roomId: 'hall', participants: ['alice', 'bob'] }, 'host', [20, 1]);
  expect(() => act(s, 'use', { characterId: 'charlie', generation: 1, roomId: 'hall', ruleId: 'push', content: 'Move Alice.' }, 'charlie')).toThrow(/combat/);
  expect(s.characters.alice!.location).toBe('hall');
});
