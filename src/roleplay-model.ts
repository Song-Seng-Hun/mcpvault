import { createHash } from 'node:crypto';

export interface RoleplayPolicy { administrators: string[]; maxCharacters?: number }
export interface Character {
  id: string; name: string; controller: string; generation: number; location: string;
  definition: string; lore: string[]; coreMemory: string;
  stats: Record<string, number>; flags: Record<string, string | boolean>; relations: Record<string, number>;
  cognition: Array<{ turn: string; kind: 'known' | 'witnessed' | 'heard' | 'inferred'; note: string }>;
}
export interface Scene { roomId: string; location: string; title: string; gm?: string }
export type Effect =
  | { op: 'flag'; characterId: string; key: string; value: string | boolean }
  | { op: 'stat' | 'relation'; characterId: string; key: string; value: number; mode?: 'set' | 'increment' }
  | { op: 'move'; characterId: string; to: string }
  | { op: 'transfer'; itemId: string; from: string; to: string; amount: number };
export interface Condition { op: 'exists' | 'equals' | 'range' | 'location' | 'quantity'; characterId?: string; key?: string; value?: string | boolean | number; min?: number; max?: number; itemId?: string; owner?: string }
export interface Rule { id: string; conditions: Condition[]; effects: Effect[]; questId?: string }
export interface RoleplayCommand { op: string; actor: string; requestId: string; expectedRevision: string; data: Record<string, any> }
export interface RoleplayReceipt { id: string; sequence: number; actor: string; characterId?: string; roomId?: string; kind: string; content: string; effects: Effect[]; revision: string; correctedTurn?: string; witnesses: string[]; questId?: string; dependencies?: string[] }
export interface Pending { id: string; characterId: string; generation: number; location: string; roomId: string; characterFingerprint: string; content: string }
export interface RoleplayState {
  sequence: number; title?: string; definition?: string; lore?: string[]; places: Record<string, string[]>; delegates: string[];
  characters: Record<string, Character>; scenes: Record<string, Scene>; rules: Record<string, Rule>;
  items: Record<string, Record<string, number>>; pending: Record<string, Pending>;
  requests: Record<string, { fingerprint: string; receipt: RoleplayReceipt }>;
}
export const initialRoleplay = (): RoleplayState => ({ sequence: 0, places: {}, delegates: [], characters: {}, scenes: {}, rules: {}, items: {}, pending: {}, requests: {} });
export const roleplayHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
// Requests contain receipts with revisions; avoid circular revision definitions.
export const roleplayRevision = (s: RoleplayState): string => roleplayHash({ ...s, requests: undefined });
export function roleplayId(value: unknown, label = 'id'): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value) || ['constructor', 'prototype'].includes(value)) throw new Error(`Invalid ${label}`);
  return value;
}
export function roleplayAccount(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) || ['constructor', 'prototype'].includes(value)) throw new Error('Invalid account id');
  return value;
}
export function roleplayText(value: unknown, max = 280): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max) throw new Error(`Text requires 1..${max} Unicode characters`);
  return value.trim();
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > 1_000_000) throw new Error('State number outside safe integer range');
  return value;
}
function keys(value: object, allowed: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new Error('Unknown declarative condition/effect field');
}
export function validateEffects(input: unknown): Effect[] {
  if (!Array.isArray(input) || input.length > 20) throw new Error('At most 20 effects allowed');
  return input.map(e => {
    if (!e || typeof e !== 'object') throw new Error('Invalid effect');
    if (e.op === 'transfer') {
      keys(e, ['op', 'itemId', 'from', 'to', 'amount']); roleplayId(e.itemId); owner(e.from); owner(e.to);
      if (number(e.amount) <= 0 || e.from === e.to) throw new Error('Invalid transfer quantity or destination');
    } else if (e.op === 'move') { keys(e, ['op', 'characterId', 'to']); actorId(e.characterId); roleplayId(e.to); }
    else if (e.op === 'flag') {
      keys(e, ['op', 'characterId', 'key', 'value']); actorId(e.characterId); roleplayId(e.key);
      if (typeof e.value !== 'boolean') roleplayText(e.value, 80);
    } else if (e.op === 'stat' || e.op === 'relation') {
      keys(e, ['op', 'characterId', 'key', 'value', 'mode']); actorId(e.characterId); roleplayId(e.key); number(e.value);
      if (e.mode !== undefined && !['set', 'increment'].includes(e.mode)) throw new Error('Invalid effect mode');
    } else throw new Error('Unknown effect; executable rules are not supported');
    return structuredClone(e) as Effect;
  });
}
function actorId(id: unknown): string { return id === '$actor' ? id : roleplayId(id, 'character id'); }
function owner(value: unknown): string {
  if (value === 'character:$actor') return value;
  if (typeof value !== 'string' || !/^(character|place):[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new Error('Invalid item owner');
  roleplayId(value.split(':')[1]); return value;
}
function conditionList(input: unknown): Condition[] {
  if (!Array.isArray(input) || input.length > 20) throw new Error('At most 20 conditions allowed');
  for (const c of input) {
    keys(c, ['op', 'characterId', 'key', 'value', 'min', 'max', 'itemId', 'owner']);
    if (!['exists', 'equals', 'range', 'location', 'quantity'].includes(c.op)) throw new Error('Unknown condition');
    if (c.characterId !== undefined) actorId(c.characterId);
    if (c.key !== undefined) roleplayId(c.key);
    if (c.itemId !== undefined) roleplayId(c.itemId);
    if (c.owner !== undefined) owner(c.owner);
    if (c.min !== undefined) number(c.min);
    if (c.max !== undefined) number(c.max);
    if (c.value !== undefined && typeof c.value !== 'boolean' && typeof c.value !== 'number') roleplayText(c.value, 80);
    if (typeof c.value === 'number') number(c.value);
    if ((['exists', 'equals', 'range'].includes(c.op) && !c.key) || (c.op === 'equals' && c.value === undefined)
      || (c.op === 'location' && typeof c.value !== 'string') || (c.op === 'quantity' && (!c.itemId || !c.owner))
      || (c.min !== undefined && c.max !== undefined && c.min > c.max)) throw new Error('Incomplete or inverted condition');
  }
  return structuredClone(input);
}
function character(s: RoleplayState, id: string): Character {
  const c = s.characters[roleplayId(id)]; if (!c) throw new Error('Character unavailable'); return c;
}
function location(s: RoleplayState, id: string): string {
  if (!s.places[roleplayId(id)]) throw new Error('Unknown location'); return id;
}
function ownerLocation(s: RoleplayState, id: string): string {
  owner(id); const [kind, key] = id.split(':'); return kind === 'place' ? location(s, key!) : character(s, key!).location;
}
function resolveEffects(effects: Effect[], id: string): Effect[] {
  return effects.map(e => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v === '$actor' ? id : v === 'character:$actor' ? `character:${id}` : v])) as unknown as Effect);
}
function applyEffects(s: RoleplayState, effects: Effect[], place: string): void {
  for (const e of effects) {
    if (e.op === 'transfer') {
      if (ownerLocation(s, e.from) !== place || ownerLocation(s, e.to) !== place) throw new Error('Item transfer requires the same scene location');
      const balances = s.items[e.itemId];
      if (!balances || (balances[e.from] || 0) < e.amount) throw new Error('Insufficient item quantity');
      balances[e.from] = number((balances[e.from] || 0) - e.amount);
      balances[e.to] = number((balances[e.to] || 0) + e.amount);
    } else {
      const c = character(s, e.characterId);
      if (c.location !== place) throw new Error('Effect target is outside the scene location');
      if (e.op === 'move') { c.location = location(s, e.to); }
      else if (e.op === 'flag') c.flags[e.key] = e.value;
      else {
        const values = e.op === 'stat' ? c.stats : c.relations;
        values[e.key] = number(e.mode === 'increment' ? (values[e.key] || 0) + e.value : e.value);
      }
    }
  }
}
function checkConditions(s: RoleplayState, rule: Rule, id: string): void {
  for (const c of rule.conditions) {
    const target = character(s, c.characterId === '$actor' || !c.characterId ? id : c.characterId);
    const value = c.key ? target.flags[c.key] ?? target.stats[c.key] : undefined;
    const count = c.itemId && c.owner ? s.items[c.itemId]?.[c.owner === 'character:$actor' ? `character:${id}` : c.owner] || 0 : undefined;
    const passes = c.op === 'location' ? target.location === c.value
      : c.op === 'exists' ? value !== undefined
      : c.op === 'equals' ? value === c.value
      : c.op === 'quantity' ? typeof count === 'number' && count >= (c.min ?? 1) && count <= (c.max ?? 1_000_000)
      : typeof value === 'number' && value >= (c.min ?? -1_000_000) && value <= (c.max ?? 1_000_000);
    if (!passes) throw new Error('Registered rule condition not satisfied');
  }
}

/** Advisory only: execution rechecks conditions, effects, control and revisions. */
export function roleplayRuleConditionsMatch(s: RoleplayState, rule: Rule, id: string): boolean {
  try { checkConditions(s, rule, id); return true; } catch { return false; }
}

/** Pure transition: no wall clock, generated prose, script evaluator or actual economy. */
export function applyRoleplayCommand(before: RoleplayState, command: RoleplayCommand, policy: RoleplayPolicy): { state: RoleplayState; receipt: RoleplayReceipt } {
  roleplayAccount(command.actor); roleplayId(command.requestId, 'requestId');
  if (Buffer.byteLength(JSON.stringify(command)) > 32768) throw new Error('Roleplay command exceeds size limit');
  const key = roleplayHash([command.actor, command.requestId]), fingerprint = roleplayHash({ ...command, expectedRevision: undefined });
  const replay = before.requests[key];
  if (replay) {
    if (replay.fingerprint !== fingerprint) throw new Error('requestId already used with different arguments');
    return { state: before, receipt: replay.receipt };
  }
  if (command.expectedRevision !== roleplayRevision(before)) throw new Error('World revision conflict; read current state before retrying');
  if (before.sequence >= 10000) throw new Error('World turn capacity reached; host maintenance required');
  // Historical receipts are immutable; do not deep-copy the growing ledger on each turn.
  const s: RoleplayState = { ...structuredClone({ ...before, requests: {} }), requests: { ...before.requests } }, d = command.data, admin = policy.administrators.includes(command.actor);
  const requireAdmin = () => { if (!admin) throw new Error('Host-configured world administrator required'); };
  const id = `turn-${s.sequence + 1}`;
  let effects: Effect[] = [], characterId: string | undefined, roomId: string | undefined, content = '', questId: string | undefined, correctedTurn: string | undefined;
  let dependencies: string[] = [];
  const controlled = () => {
    const c = character(s, d.characterId);
    if (c.controller !== command.actor || c.generation !== d.generation) throw new Error('Character control or generation mismatch');
    characterId = c.id; return c;
  };
  const inScene = () => {
    const c = controlled(), scene = s.scenes[roleplayId(d.roomId, 'roomId')];
    if (!scene || scene.location !== c.location) throw new Error('Character location does not match this scene');
    roomId = scene.roomId; return { c, scene };
  };
  if (command.op !== 'initialize' && !s.title) throw new Error('World is not initialized by its host');
  switch (command.op) {
    case 'initialize': {
      requireAdmin(); if (s.title) throw new Error('World already initialized');
      s.title = roleplayText(d.title, 180);
      if (!d.places || typeof d.places !== 'object' || Array.isArray(d.places) || Object.keys(d.places).length < 1 || Object.keys(d.places).length > 100) throw new Error('World needs 1..100 places');
      for (const [place, links] of Object.entries(d.places)) {
        roleplayId(place); if (!Array.isArray(links) || links.length > 20) throw new Error('Invalid place connections');
        s.places[place] = links.map(link => roleplayId(link));
      }
      for (const links of Object.values(s.places)) links.forEach(link => location(s, link));
      content = 'World initialized by its host administrator.'; break;
    }
    case 'delegates': {
      requireAdmin(); if (!Array.isArray(d.accounts) || d.accounts.length > 50) throw new Error('At most 50 delegates');
      s.delegates = d.accounts.map(roleplayAccount); content = 'World GM delegations changed.'; break;
    }
    case 'settings': {
      requireAdmin();
      if (d.title !== undefined) s.title = roleplayText(d.title, 180);
      if (d.definition !== undefined) s.definition = roleplayText(d.definition, 4000);
      if (d.lore !== undefined) {
        if (!Array.isArray(d.lore) || d.lore.length > 8 || d.lore.some((p: unknown) => typeof p !== 'string' || p.length > 500)) throw new Error('At most eight lore references');
        s.lore = [...new Set<string>(d.lore)];
      }
      if (d.places !== undefined) {
        if (!d.places || typeof d.places !== 'object' || Array.isArray(d.places) || !Object.keys(d.places).length || Object.keys(d.places).length > 100) throw new Error('Invalid places');
        const places: Record<string, string[]> = {};
        for (const [id, links] of Object.entries(d.places)) {
          roleplayId(id); if (!Array.isArray(links) || links.length > 20) throw new Error('Invalid place connections');
          places[id] = links.map(link => roleplayId(link));
        }
        s.places = places;
        for (const links of Object.values(places)) links.forEach(link => location(s, link));
        for (const c of Object.values(s.characters)) location(s, c.location);
        for (const scene of Object.values(s.scenes)) location(s, scene.location);
        for (const balances of Object.values(s.items)) for (const [id, quantity] of Object.entries(balances)) if (quantity > 0) ownerLocation(s, id);
        for (const p of Object.values(s.pending)) location(s, p.location);
      }
      content = 'World settings updated without resetting progress.'; break;
    }
    case 'character': {
      requireAdmin(); const cid = roleplayId(d.id); const existing = s.characters[cid];
      if (!existing && Object.keys(s.characters).length >= (policy.maxCharacters ?? 100)) throw new Error('Character capacity reached');
      if (existing) throw new Error('Existing character requires explicit definition or handoff operation');
      s.characters[cid] = { id: cid, name: roleplayText(d.name, 120), controller: roleplayAccount(d.controller), generation: 1, location: location(s, d.location),
        definition: d.definition ? roleplayText(d.definition, 4000) : '', lore: [], coreMemory: '', stats: {}, flags: {}, relations: {}, cognition: [] };
      characterId = cid; content = 'Character registered.'; break;
    }
    case 'definition': {
      const c = controlled();
      if (d.definition !== undefined) c.definition = roleplayText(d.definition, 4000);
      if (d.coreMemory !== undefined) c.coreMemory = d.coreMemory ? roleplayText(d.coreMemory, 600) : '';
      if (d.retireBeliefs !== undefined) {
        if (!Array.isArray(d.retireBeliefs) || d.retireBeliefs.length > 100 || !d.coreMemory) throw new Error('Belief retirement needs a reviewed core memory and at most 100 turn IDs');
        roleplayText(d.reason);
        const retired = new Set(d.retireBeliefs.map((turn: unknown) => roleplayId(turn)));
        if ([...retired].some(turn => !c.cognition.some(belief => belief.turn === turn))) throw new Error('Retired belief is not in this character memory');
        c.cognition = c.cognition.filter(belief => !retired.has(belief.turn));
      }
      if (d.lore !== undefined) {
        if (!Array.isArray(d.lore) || d.lore.length > 8 || d.lore.some((p: unknown) => typeof p !== 'string' || p.length > 500)) throw new Error('At most eight lore references');
        c.lore = [...new Set<string>(d.lore)];
      }
      content = 'Character definition updated; state unchanged.'; break;
    }
    case 'handoff': {
      const c = controlled(); roleplayText(d.reason); c.controller = roleplayAccount(d.toAccountId); c.generation++;
      content = roleplayText(d.reason); break;
    }
    case 'scene': {
      requireAdmin(); const rid = roleplayId(d.roomId); const gm = d.gm ? roleplayAccount(d.gm) : undefined;
      if (gm && !policy.administrators.includes(gm) && !s.delegates.includes(gm)) throw new Error('GM must be an explicit delegate');
      if (!s.scenes[rid] && Object.keys(s.scenes).length >= 100) throw new Error('Scene capacity reached');
      s.scenes[rid] = { roomId: rid, location: location(s, d.location), title: roleplayText(d.title, 180), ...(gm && { gm }) };
      roomId = rid; content = 'Scene binding updated.'; break;
    }
    case 'item': {
      requireAdmin(); const iid = roleplayId(d.id); if (s.items[iid]) throw new Error('Item already initialized');
      if (Object.keys(s.items).length >= 500) throw new Error('Item capacity reached');
      ownerLocation(s, d.owner); if (number(d.quantity) < 1) throw new Error('Positive item quantity required');
      s.items[iid] = { [d.owner]: d.quantity }; content = 'Fictional item initialized; no real XP created.'; break;
    }
    case 'rule': {
      requireAdmin(); const rid = roleplayId(d.id);
      if (!s.rules[rid] && Object.keys(s.rules).length >= 100) throw new Error('Rule capacity reached');
      s.rules[rid] = { id: rid, conditions: conditionList(d.conditions), effects: validateEffects(d.effects), ...(d.questId && { questId: roleplayId(d.questId) }) }; content = 'Declarative action rule updated.'; break;
    }
    case 'speak': case 'ooc': case 'move': case 'take': case 'give': case 'use': case 'attempt': {
      if (command.op === 'ooc' && !d.characterId) {
        const scene = s.scenes[roleplayId(d.roomId)]; if (!scene) throw new Error('Roleplay scene unavailable');
        roomId = scene.roomId; content = roleplayText(d.content); break;
      }
      const { c, scene } = inScene(); content = roleplayText(d.content);
      if (command.op === 'move') {
        if (!s.places[c.location]?.includes(d.to)) throw new Error('No registered route to destination');
        effects = [{ op: 'move', characterId: c.id, to: d.to }];
      } else if (command.op === 'take' || command.op === 'give') {
        effects = validateEffects([{ op: 'transfer', itemId: d.itemId, from: command.op === 'take' ? `place:${c.location}` : `character:${c.id}`, to: command.op === 'take' ? `character:${c.id}` : `character:${roleplayId(d.toCharacterId)}`, amount: d.amount ?? 1 }]);
      } else if (command.op === 'use') {
        const rule = s.rules[roleplayId(d.ruleId)]; if (!rule) throw new Error('Registered rule not found');
        checkConditions(s, rule, c.id); effects = resolveEffects(rule.effects, c.id); questId = rule.questId;
        dependencies = [...new Set(rule.conditions.flatMap(condition => [
          `character:${!condition.characterId || condition.characterId === '$actor' ? c.id : condition.characterId}`,
          ...(condition.itemId ? [`item:${condition.itemId}`] : []),
          ...(condition.owner ? [condition.owner === 'character:$actor' ? `character:${c.id}` : condition.owner] : []),
        ]))];
        // A player rule cannot take another character's possessions without its controller's consent.
        if (effects.some(e => e.op === 'transfer' && e.from.startsWith('character:') && e.from !== `character:${c.id}`)) throw new Error('Rule cannot take another character inventory');
      } else if (command.op === 'attempt') {
        if (Object.keys(s.pending).length >= 100) throw new Error('Pending action capacity reached');
        s.pending[id] = { id, characterId: c.id, generation: c.generation, location: c.location, roomId: scene.roomId, characterFingerprint: roleplayHash(c), content };
      }
      applyEffects(s, effects, scene.location); break;
    }
    case 'cancel': {
      const c = controlled(), p = s.pending[roleplayId(d.pendingId)];
      if (!p || p.characterId !== c.id) throw new Error('Pending action is not controlled by this character');
      content = roleplayText(d.content); roomId = p.roomId; delete s.pending[p.id]; break;
    }
    case 'resolve': {
      const p = s.pending[roleplayId(d.pendingId)], scene = p && s.scenes[p.roomId];
      if (!p || !scene) throw new Error('Pending action unavailable');
      if (scene.gm !== command.actor || (!admin && !s.delegates.includes(command.actor))) throw new Error('Current delegated scene GM required');
      const c = character(s, p.characterId);
      if (c.generation !== p.generation || roleplayHash(c) !== p.characterFingerprint || c.location !== scene.location) throw new Error('Pending action basis changed; resubmit after reading current state');
      roleplayText(d.reason); content = roleplayText(d.content); effects = validateEffects(d.effects);
      if (effects.some(e => JSON.stringify(e).includes('$actor'))) throw new Error('Resolution requires exact character IDs');
      applyEffects(s, effects, scene.location); delete s.pending[p.id]; characterId = c.id; roomId = scene.roomId; break;
    }
    case 'remember': {
      const c = controlled();
      if (c.cognition.length >= 100) throw new Error('Character cognition capacity reached; summarize explicitly');
      if (!['known', 'witnessed', 'heard', 'inferred'].includes(d.kind)) throw new Error('Invalid cognition kind');
      const turn = Object.values(s.requests).find(r => r.receipt.id === d.turn)?.receipt;
      if (!turn || !turn.roomId || (d.kind === 'witnessed' && !turn.witnesses.includes(c.id))) throw new Error('Cognition needs an accessible committed event; witnessing cannot be invented');
      c.cognition.push({ turn: turn.id, kind: d.kind, note: roleplayText(d.note) }); content = 'Character belief recorded, not an objective fact.'; break;
    }
    case 'correct': {
      requireAdmin(); roleplayText(d.reason); content = roleplayText(d.content);
      const target = Object.values(s.requests).find(r => r.receipt.id === d.targetTurn)?.receipt;
      if (!target?.roomId || !target.effects.length) throw new Error('Correction requires a state-changing scene turn');
      const scene = s.scenes[target.roomId]; if (!scene) throw new Error('Correction scene unavailable');
      effects = validateEffects(d.effects);
      const touched = (es: Effect[]) => new Set(es.flatMap(e => e.op === 'transfer' ? [`item:${e.itemId}`, e.from, e.to] : [`character:${e.characterId}`]));
      const affected = touched(target.effects);
      const later = Object.values(s.requests).map(r => r.receipt).filter(r => r.sequence > target.sequence && r.effects.length > 0 && [...touched(r.effects), ...(r.dependencies ?? [])].some(k => affected.has(k)));
      if (later.length || Object.values(s.requests).some(r => r.receipt.correctedTurn === target.id)) throw new Error('Downstream shared results prevent a simple correction; explicit host reconciliation required');
      if ([...touched(effects)].some(k => !affected.has(k))) throw new Error('Correction exceeds the original affected entities');
      const expected = roleplayHash({ revision: roleplayRevision(before), targetTurn: target.id, effects, content, reason: d.reason });
      if (d.previewFingerprint !== expected) throw new Error('Correction preview fingerprint changed; preview again');
      // Compensation targets the current affected entities, not their former scene.
      // The footprint/downstream gates above prevent rewriting peers' later outcomes.
      for (const effect of effects) applyEffects(s, [effect], effect.op === 'transfer' ? ownerLocation(s, effect.from) : character(s, effect.characterId).location);
      correctedTurn = target.id; roomId = scene.roomId; break;
    }
    default: throw new Error('Unsupported roleplay operation');
  }
  s.sequence++;
  const place = roomId && (before.scenes[roomId] ?? s.scenes[roomId])?.location;
  const witnesses = place ? Object.values(before.characters).filter(c => c.location === place).map(c => c.id) : [];
  const receipt: RoleplayReceipt = { id, sequence: s.sequence, actor: command.actor, ...(characterId && { characterId }), ...(roomId && { roomId }), kind: command.op, content, effects, witnesses, ...(dependencies.length && { dependencies }), ...(questId && { questId }), ...(correctedTurn && { correctedTurn }), revision: roleplayRevision(s) };
  s.requests[key] = { fingerprint, receipt };
  return { state: s, receipt };
}
