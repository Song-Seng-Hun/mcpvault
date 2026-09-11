import { guidanceError } from './guidance-runtime.js';
import { capabilityRemoval, configId, configIds, configKeys, configNumber, validateCapabilityGraph, validateCapabilitySelection, type CapabilityNode } from './capability-graph.js';
import { roleplayHash, roleplayRevision } from './roleplay-kernel.js';
import type { RoleplayCommand, RoleplayPolicy, RoleplayState } from './roleplay-model.js';

interface Formula { base: number; terms: Record<string, number> }
interface Skill extends CapabilityNode { kind: 'attack' | 'guard' | 'heal'; attribute: string; power: number; focus: number }
interface Equipment { slot: string; defense: number }
export interface TrpgRuleset {
  id: string; version: string; attributes: Record<string, number>; derived: Record<string, Formula>;
  resources: Record<string, string>; skills: Skill[]; initialSkills: string[]; growth: number;
  items: Record<string, Equipment>; slots: string[]; loadoutSize: number;
  actionsPerTurn: number; switchCost: number; initiative: string;
}
export interface TrpgSheet {
  attributes: Record<string, number>; resources: Record<string, number>; growth: number; learned: string[];
  loadouts: Record<string, { skills: string[]; equipment: string[] }>; active: string;
  statuses: Record<string, number>;
}
export interface TrpgEncounter { order: string[]; initiative: Record<string, number>; round: number; turn: number; actions: number; ended: boolean }
export interface RoleplayTrpg { ruleset: TrpgRuleset; fingerprint: string; sheets: Record<string, TrpgSheet>; encounters: Record<string, TrpgEncounter> }
/** Bounded trusted route provenance, never caller-supplied or a permission grant. */
export const ROLEPLAY_REGISTERED_ROUTE = {
  kind: 'registered_action', reason: 'Registered declarative mechanics resolved under the canonical writer.',
  skipped: ['gm_dispatch', 'model_dispatch'],
} as const;
export interface TrpgOutcome {
  ruleset: string;
  resources: Array<{ characterId: string; resource: string; before: number; after: number }>;
  growth: Array<{ characterId: string; before: number; after: number }>;
  check?: { die: number; modifier: number; total: number; defense: number; success: boolean };
  encounter?: { round: number; current: string; actions: number; ended: boolean };
}
export function trpgOutcome(before: RoleplayState, after: RoleplayState, command: RoleplayCommand, roomId?: string): TrpgOutcome {
  const t = after.trpg!, result: TrpgOutcome = { ruleset: `${t.ruleset.id}@${t.ruleset.version}`, resources: [], growth: [] };
  for (const [id, old] of Object.entries(before.trpg?.sheets ?? {})) {
    const next = t.sheets[id]!;
    for (const [resource, value] of Object.entries(old.resources)) if (next.resources[resource] !== value) result.resources.push({ characterId: id, resource, before: value, after: next.resources[resource]! });
    if (old.growth !== next.growth) result.growth.push({ characterId: id, before: old.growth, after: next.growth });
  }
  if (command.op === 'trpg_act' && command.rolls?.length === 1) {
    const skill = t.ruleset.skills.find(k => k.id === command.data.skillId)!;
    const die = command.rolls[0]!, modifier = before.trpg!.sheets[command.data.characterId]!.attributes[skill.attribute]!, defense = trpgStats(before, command.data.targetId).defense!;
    result.check = { die, modifier, total: die + modifier, defense, success: die + modifier >= defense };
  }
  const encounter = roomId && t.encounters[roomId];
  if (encounter) result.encounter = { round: encounter.round, current: encounter.order[encounter.turn]!, actions: encounter.actions, ended: encounter.ended };
  return result;
}
export const TRPG_FIELDS: Record<string, string[]> = {
  trpg_adopt: ['ruleset'], trpg_learn: ['characterId', 'generation', 'skillId'],
  trpg_loadout: ['characterId', 'generation', 'name', 'skills', 'equipment'], trpg_switch: ['characterId', 'generation', 'name'],
  trpg_respec: ['characterId', 'generation', 'remove', 'previewFingerprint'], trpg_rest: ['characterId', 'generation'],
  trpg_growth: ['characterId', 'amount'], trpg_encounter_start: ['roomId', 'participants'],
  trpg_encounter_end: ['roomId'], trpg_turn_end: ['characterId', 'generation', 'roomId'],
  trpg_act: ['characterId', 'generation', 'roomId', 'skillId', 'targetId'],
};
export function defaultTrpgRuleset(): TrpgRuleset {
  return {
    id: 'mcpvault-adventure', version: '1.0.0', attributes: { strength: 2, agility: 1, intellect: 1 },
    derived: { hp: { base: 8, terms: { strength: 2 } }, focus: { base: 3, terms: { intellect: 1 } }, defense: { base: 10, terms: { agility: 1 } } },
    resources: { hp: 'hp', focus: 'focus' }, initialSkills: ['attack'], growth: 3,
    skills: [
      { id: 'attack', requires: [], excludes: [], cost: 0, kind: 'attack', attribute: 'strength', power: 2, focus: 0 },
      { id: 'guard', requires: ['attack'], excludes: [], cost: 1, kind: 'guard', attribute: 'agility', power: 2, focus: 0 },
      { id: 'heal', requires: ['attack'], excludes: [], cost: 2, kind: 'heal', attribute: 'intellect', power: 3, focus: 2 },
    ], items: { shield: { slot: 'hand', defense: 2 } }, slots: ['hand', 'body'], loadoutSize: 3,
    actionsPerTurn: 1, switchCost: 1, initiative: 'agility',
  };
}
function map(value: any, max: number): Array<[string, any]> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).length > max) throw guidanceError(new Error('Configuration map outside bounds'), 'guid-8a999c8a1362e5c8');
  return Object.entries(value).map(([key, val]) => [configId(key), val]);
}
const graphOf = (r: TrpgRuleset) => r.skills.map(({ id, requires, excludes, cost }) => ({ id, requires, excludes, cost }));
export function validateTrpgRuleset(input: unknown): TrpgRuleset {
  const r = input as TrpgRuleset;
  configKeys(r, ['id', 'version', 'attributes', 'derived', 'resources', 'skills', 'initialSkills', 'growth', 'items', 'slots', 'loadoutSize', 'actionsPerTurn', 'switchCost', 'initiative']);
  configId(r.id);
  if (typeof r.version !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(r.version)) throw guidanceError(new Error('Exact ruleset version required'), 'guid-da61e81fe3496db8');
  const attrs = map(r.attributes, 12); if (!attrs.length) throw guidanceError(new Error('Attributes required'), 'guid-82b1f9308ecb2128');
  attrs.forEach(([, v]) => configNumber(v, 0, 20));
  for (const [, f] of map(r.derived, 16)) {
    configKeys(f, ['base', 'terms']); configNumber(f.base, 0, 100);
    for (const [key, coefficient] of map(f.terms, 12)) { if (!Object.hasOwn(r.attributes, key)) throw guidanceError(new Error('Unknown formula attribute'), 'guid-3444675870b011af'); configNumber(coefficient, 0, 10); }
  }
  for (const [, stat] of map(r.resources, 8)) if (!Object.hasOwn(r.derived, configId(stat))) throw guidanceError(new Error('Unknown resource maximum'), 'guid-df6b0d539f0a8232');
  if (!Object.hasOwn(r.resources, 'hp') || !Object.hasOwn(r.resources, 'focus') || !Object.hasOwn(r.derived, 'defense')) throw guidanceError(new Error('hp, focus and defense required'), 'guid-ccccdc531d67c604');
  if (!Array.isArray(r.skills) || !r.skills.length || r.skills.length > 64) throw guidanceError(new Error('Skill list outside bounds'), 'guid-4964e07b211c4997');
  for (const skill of r.skills) {
    configKeys(skill, ['id', 'requires', 'excludes', 'cost', 'kind', 'attribute', 'power', 'focus']);
    if (!['attack', 'guard', 'heal'].includes(skill.kind) || !Object.hasOwn(r.attributes, configId(skill.attribute))) throw guidanceError(new Error('Invalid declarative skill'), 'guid-de006af384608f23');
    configNumber(skill.power, 0, 30); configNumber(skill.focus, 0, 100);
  }
  const graph = validateCapabilityGraph(graphOf(r)); validateCapabilitySelection(graph, r.initialSkills);
  configNumber(r.growth, 0, 100); configNumber(r.loadoutSize, 1, 8);
  if (r.initialSkills.length > r.loadoutSize) throw guidanceError(new Error('Initial loadout capacity exceeded'), 'guid-efa1627e57cdd8dd');
  configIds(r.slots, 8);
  for (const [, item] of map(r.items, 64)) { configKeys(item, ['slot', 'defense']); if (!r.slots.includes(configId(item.slot))) throw guidanceError(new Error('Unknown equipment slot'), 'guid-d7dcf038adf0e986'); configNumber(item.defense, 0, 10); }
  configNumber(r.actionsPerTurn, 1, 4); configNumber(r.switchCost, 1, r.actionsPerTurn);
  if (!Object.hasOwn(r.attributes, configId(r.initiative))) throw guidanceError(new Error('Unknown initiative attribute'), 'guid-b1b97d9c34b85bda');
  if (formula(r.derived[r.resources.hp!]!, r.attributes) < 1) throw guidanceError(new Error('Positive maximum hp required'), 'guid-08f6ebbe959d9997');
  return structuredClone(r);
}
function formula(f: Formula, attributes: Record<string, number>): number { return f.base + Object.entries(f.terms).reduce((sum, [k, v]) => sum + attributes[k]! * v, 0); }
export function newTrpgSheet(r: TrpgRuleset): TrpgSheet {
  return { attributes: { ...r.attributes }, resources: Object.fromEntries(Object.entries(r.resources).map(([id, stat]) => [id, formula(r.derived[stat]!, r.attributes)])),
    growth: r.growth, learned: [...r.initialSkills], loadouts: { default: { skills: [...r.initialSkills], equipment: [] } }, active: 'default', statuses: {} };
}
function adopted(s: RoleplayState): RoleplayTrpg { if (!s.trpg) throw guidanceError(new Error('Explicit ruleset adoption required'), 'guid-d25865e3de15a912'); return s.trpg; }
function sheet(s: RoleplayState, id: string): TrpgSheet { const c = adopted(s).sheets[configId(id)]; if (!c) throw guidanceError(new Error('Character sheet unavailable'), 'guid-727599723c303004'); return c; }
export function trpgStats(s: RoleplayState, id: string): Record<string, number> {
  const t = adopted(s), c = sheet(s, id), stats = Object.fromEntries(Object.entries(t.ruleset.derived).map(([k, f]) => [k, formula(f, c.attributes)]));
  for (const item of c.loadouts[c.active]!.equipment) if ((s.items[item]?.[`character:${id}`] ?? 0) > 0) stats.defense! += t.ruleset.items[item]!.defense;
  stats.defense! += c.statuses.guarding ?? 0;
  return stats;
}
export function trpgCombat(s: RoleplayState, id: string): [string, TrpgEncounter] | undefined { return Object.entries(s.trpg?.encounters ?? {}).find(([, e]) => !e.ended && e.order.includes(id)); }
function outOfCombat(s: RoleplayState, id: string): void { if (trpgCombat(s, id)) throw guidanceError(new Error('Operation unavailable in combat'), 'guid-73e839c8a7f9ce46'); }
function loadout(s: RoleplayState, id: string, skills: unknown, equipment: unknown) {
  const t = adopted(s), c = sheet(s, id), selected = configIds(skills, t.ruleset.loadoutSize), items = configIds(equipment, t.ruleset.slots.length);
  if (selected.some(k => !c.learned.includes(k))) throw guidanceError(new Error('Loadout skill not learned'), 'guid-556e4162b8700042');
  validateCapabilitySelection(graphOf(t.ruleset), c.learned);
  const slots = new Set<string>();
  for (const idItem of items) {
    const item = t.ruleset.items[idItem]; if (!item || !(s.items[idItem]?.[`character:${id}`] ?? 0)) throw guidanceError(new Error('Equipment inventory unavailable'), 'guid-22b8d58b699418b2');
    if (slots.has(item.slot)) throw guidanceError(new Error('Equipment slot conflict'), 'guid-db4086b660357b92'); slots.add(item.slot);
  }
  return { skills: selected, equipment: items };
}
export function trpgRespecPreview(s: RoleplayState, id: string, remove: unknown) {
  const t = adopted(s), c = sheet(s, id); outOfCombat(s, id);
  const removed = capabilityRemoval(graphOf(t.ruleset), c.learned, remove);
  if (!removed.length || removed.some(k => t.ruleset.initialSkills.includes(k))) throw guidanceError(new Error('Initial skills cannot be removed'), 'guid-e981f4eccccb8a81');
  const refund = t.ruleset.skills.filter(k => removed.includes(k.id)).reduce((sum, k) => sum + k.cost, 0);
  configNumber(c.growth + refund, 0, 100000);
  const unload = Object.entries(c.loadouts).map(([name, l]) => ({ name, skills: l.skills.filter(k => removed.includes(k)) })).filter(l => l.skills.length);
  const dependencies = t.ruleset.skills.filter(k => removed.includes(k.id)).flatMap(k => k.requires.filter(req => removed.includes(req)).map(requires => ({ skillId: k.id, requires })));
  const result = { characterId: id, removed, dependencies, refund, unload, revision: roleplayRevision(s) };
  return { ...result, fingerprint: roleplayHash(result) };
}
/** Count is only a sizing hint: the reducer validates the complete request before the host draws dice. */
export function trpgRollCount(s: RoleplayState, command: RoleplayCommand): number {
  if (command.op === 'trpg_encounter_start') return Array.isArray(command.data.participants) ? Math.min(command.data.participants.length, 20) : 0;
  return command.op === 'trpg_act' && s.trpg?.ruleset.skills.find(k => k.id === command.data.skillId)?.kind === 'attack' ? 1 : 0;
}
export function applyTrpg(s: RoleplayState, command: RoleplayCommand, policy: RoleplayPolicy): { characterId?: string; roomId?: string; content: string } {
  const d = command.data, op = command.op, admin = policy.administrators.includes(command.actor);
  configKeys(d, TRPG_FIELDS[op] ?? []);
  const rolls = command.rolls ?? [], count = trpgRollCount(s, command);
  if (!Array.isArray(rolls) || rolls.length !== count || rolls.some(n => !Number.isInteger(n) || n < 1 || n > 20)) throw guidanceError(new Error('Exact host recorded d20 outcomes required'), 'guid-11c0fad935a619eb');
  const requireAdmin = () => { if (!admin) throw guidanceError(new Error('Host administrator required'), 'guid-a593c69d919878b6'); };
  if (op === 'trpg_adopt') {
    requireAdmin(); if (s.trpg) throw guidanceError(new Error('Ruleset already adopted; migration requires a separate reviewed contract'), 'guid-6c8060b0cc82fe69');
    const ruleset = validateTrpgRuleset(d.ruleset);
    s.trpg = { ruleset, fingerprint: roleplayHash(ruleset), sheets: Object.fromEntries(Object.keys(s.characters).map(id => [id, newTrpgSheet(ruleset)])), encounters: {} };
    return { content: `Adopted fictional ruleset ${ruleset.id}@${ruleset.version}.` };
  }
  const t = adopted(s), r = t.ruleset;
  let roomId: string | undefined, characterId: string | undefined;
  const gm = () => {
    roomId = configId(d.roomId); const scene = s.scenes[roomId];
    if (!scene || scene.gm !== command.actor || (!admin && !s.delegates.includes(command.actor))) throw guidanceError(new Error('Current delegated scene GM required'), 'guid-cb6b101e35799584');
    return scene;
  };
  if (op === 'trpg_encounter_start') {
    const scene = gm(), participants = configIds(d.participants, 20);
    if (participants.length < 2 || t.encounters[roomId!]?.ended === false) throw guidanceError(new Error('Encounter needs 2..20 participants and no active encounter'), 'guid-3e93582109684763');
    for (const id of participants) if (!s.characters[id] || s.characters[id]!.location !== scene.location || sheet(s, id).resources.hp! <= 0 || trpgCombat(s, id)) throw guidanceError(new Error('Encounter participant unavailable'), 'guid-a05d2c1604496fc9');
    const initiative = Object.fromEntries(participants.map((id, i) => [id, rolls[i]! + sheet(s, id).attributes[r.initiative]!]));
    const order = [...participants].sort((a, b) => initiative[b]! - initiative[a]! || (a < b ? -1 : 1));
    for (const id of participants) delete sheet(s, id).statuses.guarding;
    t.encounters[roomId!] = { order, initiative, round: 1, turn: 0, actions: r.actionsPerTurn, ended: false };
  } else if (op === 'trpg_encounter_end') {
    gm(); const e = t.encounters[roomId!]; if (!e || e.ended) throw guidanceError(new Error('Active encounter unavailable'), 'guid-3a7df4be40ae6d7b');
    e.ended = true; e.actions = 0; for (const id of e.order) delete sheet(s, id).statuses.guarding;
  } else if (op === 'trpg_growth') {
    requireAdmin(); characterId = configId(d.characterId); const c = sheet(s, characterId);
    c.growth = configNumber(c.growth + configNumber(d.amount, 1, 100), 0, 100000);
  } else {
    characterId = configId(d.characterId); const actor = s.characters[characterId];
    if (!actor || actor.controller !== command.actor || actor.generation !== d.generation) throw guidanceError(new Error('Character control or generation mismatch'), 'guid-13ba67aa03ef781a');
    const c = sheet(s, characterId), combat = trpgCombat(s, characterId);
    const turn = () => {
      roomId = combat?.[0]; const e = combat?.[1];
      if (!roomId || !e || e.order[e.turn] !== characterId || actor.location !== s.scenes[roomId]?.location || (d.roomId !== undefined && d.roomId !== roomId)) throw guidanceError(new Error('Current encounter turn required'), 'guid-663be2b98af80d39');
      return e;
    };
    if (op === 'trpg_learn') {
      outOfCombat(s, characterId); const skill = r.skills.find(k => k.id === configId(d.skillId));
      if (!skill || c.learned.includes(skill.id)) throw guidanceError(new Error('New registered skill required'), 'guid-7611478739f1044f');
      validateCapabilitySelection(graphOf(r), [...c.learned, skill.id]);
      if (c.growth < skill.cost) throw guidanceError(new Error('Insufficient growth points'), 'guid-88a3c6cdf1f30357');
      c.growth -= skill.cost; c.learned.push(skill.id);
    } else if (op === 'trpg_loadout') {
      outOfCombat(s, characterId); const name = configId(d.name);
      if (!c.loadouts[name] && Object.keys(c.loadouts).length >= 8) throw guidanceError(new Error('Loadout capacity reached'), 'guid-2812be13ba1e4476');
      c.loadouts[name] = loadout(s, characterId, d.skills, d.equipment);
    } else if (op === 'trpg_switch') {
      const name = configId(d.name), l = c.loadouts[name]; if (!l || name === c.active) throw guidanceError(new Error('Different named loadout required'), 'guid-aaaf3aa99e5d5929');
      loadout(s, characterId, l.skills, l.equipment);
      if (combat) { const e = turn(); if (c.resources.hp! <= 0 || e.actions < r.switchCost) throw guidanceError(new Error('Insufficient actions or incapacitated'), 'guid-471ec78d7282d830'); e.actions -= r.switchCost; }
      c.active = name;
    } else if (op === 'trpg_respec') {
      const p = trpgRespecPreview(s, characterId, d.remove);
      if (p.fingerprint !== d.previewFingerprint) throw guidanceError(new Error('Respec preview fingerprint changed'), 'guid-faf0995b17db5783');
      c.learned = c.learned.filter(k => !p.removed.includes(k)); c.growth += p.refund;
      for (const l of Object.values(c.loadouts)) l.skills = l.skills.filter(k => !p.removed.includes(k));
    } else if (op === 'trpg_rest') {
      outOfCombat(s, characterId); c.resources = newTrpgSheet(r).resources; c.statuses = {};
    } else if (op === 'trpg_turn_end') {
      const e = turn();
      if (!e.order.some(id => sheet(s, id).resources.hp! > 0)) { e.ended = true; e.actions = 0; }
      else {
        do { e.turn = (e.turn + 1) % e.order.length; if (e.turn === 0) e.round = configNumber(e.round + 1, 1, 10000); } while (sheet(s, e.order[e.turn]!).resources.hp! <= 0);
        e.actions = r.actionsPerTurn; delete sheet(s, e.order[e.turn]!).statuses.guarding;
      }
    } else if (op === 'trpg_act') {
      const e = turn(), skill = r.skills.find(k => k.id === configId(d.skillId));
      if (!skill || !c.learned.includes(skill.id) || !c.loadouts[c.active]!.skills.includes(skill.id)) throw guidanceError(new Error('Action requires a learned loaded skill; creative actions use GM attempt'), 'guid-7e56a02b99887e4c');
      loadout(s, characterId, c.loadouts[c.active]!.skills, c.loadouts[c.active]!.equipment);
      const targetId = configId(d.targetId), target = sheet(s, targetId);
      if (!e.order.includes(targetId) || s.characters[targetId]?.location !== actor.location) throw guidanceError(new Error('Target unavailable in this encounter'), 'guid-bf393b84e4615f99');
      if (skill.kind === 'guard' && targetId !== characterId) throw guidanceError(new Error('Guard targets self'), 'guid-3858a9c4374e8fe7');
      if (skill.kind === 'attack' && (targetId === characterId || target.resources.hp! <= 0)) throw guidanceError(new Error('Attack target unavailable'), 'guid-6b3e08d8a9818ff2');
      if (c.resources.hp! <= 0 || e.actions < 1 || c.resources.focus! < skill.focus) throw guidanceError(new Error('Insufficient action/resource or incapacitated'), 'guid-7aa0faef003a6b47');
      e.actions--; c.resources.focus! -= skill.focus;
      const power = skill.power + c.attributes[skill.attribute]!;
      if (skill.kind === 'attack' && rolls[0]! + c.attributes[skill.attribute]! >= trpgStats(s, targetId).defense!) target.resources.hp = Math.max(0, target.resources.hp! - power);
      if (skill.kind === 'guard') c.statuses.guarding = power;
      if (skill.kind === 'heal') target.resources.hp = Math.min(trpgStats(s, targetId)[r.resources.hp!]!, target.resources.hp! + power);
      if (target.resources.hp! === 0) target.statuses.incapacitated = 1; else delete target.statuses.incapacitated;
    } else throw guidanceError(new Error('Unsupported TRPG operation'), 'guid-94b5ea81f5895611');
  }
  return { ...(characterId && { characterId }), ...(roomId && { roomId }), content: `Fictional ${op.slice(5)} recorded${rolls.length ? ` (d20: ${rolls.join(', ')})` : ''}.` };
}

/** Prevent legacy mechanics from silently bypassing encounter costs or separating equipped inventory. */
export function guardTrpgLegacy(s: RoleplayState, command: RoleplayCommand): void {
  if (!s.trpg || command.op.startsWith('trpg_')) return;
  const d = command.data;
  const effects = command.op === 'use' ? s.rules[d.ruleId]?.effects ?? [] : Array.isArray(d.effects) ? d.effects : [];
  const ids = [d.characterId, d.toCharacterId, ...effects.flatMap((e: any) => [e.characterId, ...[e.from, e.to].filter(v => typeof v === 'string' && v.startsWith('character:')).map(v => v.slice(10))])].filter(Boolean).map(id => id === '$actor' ? d.characterId : id);
  if (['move', 'give', 'take', 'use', 'correct'].includes(command.op) && ids.some(id => trpgCombat(s, id))) throw guidanceError(new Error('Legacy mechanical effects unavailable in combat; use encounter actions'), 'guid-47491366c8521668');
  if (command.op === 'attempt' || command.op === 'resolve') {
    const pending = command.op === 'resolve' ? s.pending[d.pendingId] : undefined;
    if (pending?.trpgBasis && pending.trpgBasis !== roleplayHash(s.trpg)) throw guidanceError(new Error('Pending mechanical basis changed; resubmit the creative attempt'), 'guid-e0d389c27292425f');
    const characterId = pending?.characterId ?? d.characterId, combat = trpgCombat(s, characterId);
    if (combat) {
      const [room, encounter] = combat;
      if (ids.some(id => { const target = trpgCombat(s, id); return target && target[0] !== room; })) throw guidanceError(new Error('Creative action cannot affect another combat'), 'guid-141ce7e304b06bb0');
      if (encounter.order[encounter.turn] !== characterId || (pending?.roomId ?? d.roomId) !== room) throw guidanceError(new Error('Creative action requires current encounter turn'), 'guid-d86fc003f5dc0621');
      if (encounter.actions < 1 || sheet(s, characterId).resources.hp! <= 0) throw guidanceError(new Error('Insufficient action/resource or incapacitated'), 'guid-7aa0faef003a6b47');
      if (command.op === 'resolve') {
        if (!pending?.trpgBasis) throw guidanceError(new Error('Pending mechanical basis changed; resubmit'), 'guid-4e17232750343875');
        if ((d.effects ?? []).some((e: any) => e.op === 'move' && trpgCombat(s, e.characterId))) throw guidanceError(new Error('End encounter before moving a participant'), 'guid-c6c8e64fd8a6f1fc');
        encounter.actions--;
      }
    } else if (command.op === 'resolve' && ids.some(id => trpgCombat(s, id))) throw guidanceError(new Error('Creative action cannot affect another combat'), 'guid-141ce7e304b06bb0');
  }
  if (command.op === 'scene' && s.trpg.encounters[d.roomId]?.ended === false) throw guidanceError(new Error('Cannot rebind a scene in combat'), 'guid-1c56853dc65e1ca6');
  if (['give', 'use', 'resolve', 'correct'].includes(command.op)) {
    const transfers = command.op === 'give' ? [{ itemId: d.itemId, from: `character:${d.characterId}` }] : command.op === 'use' ? s.rules[d.ruleId]?.effects ?? [] : d.effects ?? [];
    for (const e of transfers) if (typeof e.from === 'string' && e.from.startsWith('character:')) {
      const id = e.from.slice(10), c = s.trpg.sheets[id === '$actor' ? d.characterId : id];
      if (c?.loadouts[c.active]?.equipment.includes(e.itemId)) throw guidanceError(new Error('Unload equipped inventory before transfer'), 'guid-f0d451451473c56c');
    }
  }
}
