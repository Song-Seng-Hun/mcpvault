import { describe, expect, test } from 'vitest';
import { getRoleplayTools, ROLEPLAY_MUTATING_TOOLS } from './roleplay-tools.js';

type Schema = {
  type?: string;
  description?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  maxItems?: number;
  maxProperties?: number;
  additionalProperties?: boolean;
  default?: number;
  allOf?: Array<{ if?: Schema; then?: Schema; else?: Schema }>;
  const?: string;
};

const tools = () => new Map(getRoleplayTools().map(tool => [tool.name, tool]));
const schema = (name: string): Schema => tools().get(name)!.inputSchema as Schema;
const properties = (name: string): Record<string, Schema> => schema(name).properties ?? {};

describe('bounded roleplay schema sidecar', () => {
  test('transfer destinations accept owner references without making move destinations owners', () => {
    const effect = properties('manage_roleplay_world').effects.items as any;
    expect(effect.properties.to.anyOf.some((s: any) => new RegExp(s.pattern).test('character:iris'))).toBe(true);
    expect(effect.allOf).toBeDefined();
  });
  test('exposes exactly the eight dynamic endpoint tools and six mutating tools', () => {
    expect(getRoleplayTools().map(tool => tool.name)).toEqual([
      'manage_roleplay_world',
      'manage_roleplay_character',
      'manage_roleplay_scene',
      'read_roleplay_context',
      'submit_roleplay_action',
      'resolve_roleplay_action',
      'read_roleplay_history',
      'correct_roleplay_turn',
    ]);
    expect([...ROLEPLAY_MUTATING_TOOLS]).toEqual([
      'manage_roleplay_world',
      'manage_roleplay_character',
      'manage_roleplay_scene',
      'submit_roleplay_action',
      'resolve_roleplay_action',
      'correct_roleplay_turn',
    ]);
  });

  test('uses flat authenticated command fields without an actor argument', () => {
    for (const name of [
      'manage_roleplay_world',
      'manage_roleplay_character',
      'manage_roleplay_scene',
      'submit_roleplay_action',
      'resolve_roleplay_action',
      'correct_roleplay_turn',
    ]) {
      const s = schema(name);
      expect(s.type).toBe('object');
      expect(s.additionalProperties).toBe(false);
      expect(s.properties?.accessToken).toBeDefined();
      expect(s.properties?.requestId).toBeDefined();
      expect(s.properties?.expectedRevision).toBeDefined();
      expect(s.properties?.actor).toBeUndefined();
    }
  });

  test('allows public discovery reads while conditionally requiring mutation credentials', () => {
    for (const name of ['manage_roleplay_world', 'manage_roleplay_character', 'manage_roleplay_scene']) {
      const s = schema(name);
      expect(s.required).toEqual(['op']);
      expect(s.properties?.accessToken).toBeDefined();
      expect(s.properties?.requestId).toBeDefined();
      expect(s.properties?.expectedRevision).toBeDefined();
      expect(s.allOf).toEqual(expect.arrayContaining([
        expect.objectContaining({ if: expect.objectContaining({ properties: expect.objectContaining({ op: { const: 'read' } }) }) }),
      ]));
      for (const field of ['maxChars', 'limit', 'cursor']) expect(s.properties?.[field]).toBeDefined();
    }
    expect(schema('read_roleplay_context').required).toEqual(['characterId']);
    expect(schema('read_roleplay_context').required).not.toContain('accessToken');
    expect(schema('read_roleplay_history').required).not.toContain('accessToken');
  });

  test('bounds all read responses with the shared defaults and cursor', () => {
    for (const name of ['read_roleplay_context', 'read_roleplay_history']) {
      const p = properties(name);
      expect(p.maxChars).toMatchObject({ type: 'integer', minimum: 512, maximum: 12000, default: 4000 });
      expect(p.limit).toMatchObject({ type: 'integer', minimum: 1, maximum: 100, default: 20 });
      expect(p.cursor).toMatchObject({ type: 'string' });
    }
  });

  test('bounds world declarations and keeps item and rule data declarative', () => {
    const p = properties('manage_roleplay_world');
    expect(p.op.enum).toEqual(['read', 'initialize', 'settings', 'delegates', 'item', 'rule']);
    expect(p.title).toMatchObject({ type: 'string', maxLength: 180 });
    expect(p.places).toMatchObject({ type: 'object', maxProperties: 100, additionalProperties: expect.any(Object) });
    expect(p.places.items).toBeUndefined();
    expect(p.accounts).toMatchObject({ type: 'array', maxItems: 50 });
    expect(p.id).toMatchObject({ type: 'string', maxLength: 64 });
    expect(p.owner).toMatchObject({ type: 'string', pattern: '^(place|character):[a-z0-9][a-z0-9-]{0,63}$' });
    expect(p.quantity).toMatchObject({ type: 'integer', minimum: 1, maximum: 1_000_000 });
    expect(p.conditions).toMatchObject({ type: 'array', maxItems: 20 });
    expect(p.effects).toMatchObject({ type: 'array', maxItems: 20 });
    expect(p.effects.items?.properties?.op?.enum).toEqual(['flag', 'stat', 'relation', 'move', 'transfer']);
    expect(p.effects.items?.properties?.from?.pattern).toContain('character:\\$actor');
    expect(p.conditions.items?.properties?.characterId?.pattern).toContain('\\$actor');
    expect(p.questId).toMatchObject({ type: 'string', maxLength: 64 });
    for (const name of [
      'manage_roleplay_character', 'manage_roleplay_scene', 'read_roleplay_context',
      'submit_roleplay_action', 'resolve_roleplay_action', 'read_roleplay_history', 'correct_roleplay_turn',
    ]) expect(properties(name).questId).toBeUndefined();
    expect(p.ownerId).toBeUndefined();
  });

  test('covers character, scene, action, resolution, correction, context, and history fields', () => {
    const character = properties('manage_roleplay_character');
    expect(character.op.enum).toEqual(['read', 'character', 'definition', 'handoff', 'remember']);
    for (const field of ['id', 'characterId', 'controller', 'location', 'toAccountId']) expect(character[field]).toBeDefined();
    expect(character.definition).toMatchObject({ type: 'string', maxLength: 4000 });
    expect(character.coreMemory).toMatchObject({ type: 'string', maxLength: 600 });
    expect(character.lore).toMatchObject({ type: 'array', maxItems: 8 });
    expect(character.lore.items).toMatchObject({ type: 'string' });
    expect(character.lore.items?.description).toContain('Exact note reference');
    expect(character.kind.enum).toEqual(['known', 'witnessed', 'heard', 'inferred']);

    const scene = properties('manage_roleplay_scene');
    expect(scene.op.enum).toEqual(['read', 'scene']);
    for (const field of ['roomId', 'location', 'title', 'gm']) expect(scene[field]).toBeDefined();

    const action = properties('submit_roleplay_action');
    expect(action.op.enum).toEqual(['speak', 'ooc', 'move', 'take', 'give', 'use', 'attempt', 'cancel']);
    for (const field of ['characterId', 'roomId', 'generation', 'content', 'to', 'itemId', 'amount', 'toCharacterId', 'ruleId', 'replyTo']) expect(action[field]).toBeDefined();
    expect(action.generation).toMatchObject({ type: 'integer', minimum: 1 });
    expect(action.content).toMatchObject({ type: 'string', maxLength: 560 });

    const resolution = properties('resolve_roleplay_action');
    expect(schema('resolve_roleplay_action').properties?.op).toBeUndefined();
    expect(schema('resolve_roleplay_action').required).not.toContain('op');
    for (const field of ['pendingId', 'content', 'reason', 'effects']) expect(resolution[field]).toBeDefined();
    const correction = properties('correct_roleplay_turn');
    for (const field of ['targetTurn', 'content', 'reason', 'effects', 'previewFingerprint']) expect(correction[field]).toBeDefined();

    const context = properties('read_roleplay_context');
    expect(context.characterId).toBeDefined();
    expect(context.roomId).toBeDefined();
    expect(context.query).toMatchObject({ type: 'string', maxLength: 500 });
    const history = properties('read_roleplay_history');
    for (const field of ['characterId', 'roomId', 'turnId']) expect(history[field]).toBeDefined();
  });

  test('describes the trust, fiction, GM, reread, and correction boundaries', () => {
    const descriptions = getRoleplayTools().map(tool => tool.description).join(' ').toLowerCase();
    expect(descriptions).toContain('trusted host configuration');
    expect(descriptions).toContain('administrator');
    expect(descriptions).toContain('no reward mint');
    expect(descriptions).toContain('fiction data');
    expect(descriptions).toContain('not execution authority');
    expect(descriptions).toContain('generation');
    expect(descriptions).toContain('world revision');
    expect(descriptions).toContain('pending');
    expect(descriptions).toContain('no automatic success');
    expect(descriptions).toContain('host-only');
  });
});
