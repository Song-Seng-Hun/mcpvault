import { expect, test } from 'vitest';
import { characterItems, worldItems } from './roleplay-projections.js';
import { initialRoleplay, type Character } from './roleplay-model.js';
import { page } from './work-model.js';
test('large valid cognition and state remain traversable through bounded individual rows', () => {
  const c: Character = { id: 'iris', name: 'Iris', controller: 'host', generation: 1, location: 'hall', definition: '🌙'.repeat(4000), coreMemory: 'safe', lore: [], stats: {}, flags: {}, relations: {}, cognition: [] };
  for (let i = 0; i < 100; i++) { c.cognition.push({ turn: `turn-${i}`, kind: 'heard', note: '가'.repeat(280) }); c.flags[`flag-${i}`] = 'value'; }
  const state = initialRoleplay(); state.characters.iris = c;
  const rows = characterItems(c, state, new Set(c.cognition.map(m => m.turn)));
  let cursor: string | undefined; const found: unknown[] = [];
  do {
    const result = page(rows, { characterId: c.id }, 'same', { maxChars: 4000, ...(cursor && { cursor }) }, 'character');
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(4000);
    found.push(...result.items); cursor = result.cursor;
  } while (cursor);
  expect(found).toHaveLength(rows.length);
  expect(rows.filter(r => r.kind === 'belief')).toHaveLength(100);
});
test('world inventories and rule details are individual rows, never an unpageable owner map', () => {
  const state = initialRoleplay(); state.items.coin = {};
  for (let i = 0; i < 200; i++) state.items.coin[`character:${'a'.repeat(58)}-${i}`] = 1;
  const rows = worldItems(state);
  expect(rows.filter(r => r.kind === 'item')).toHaveLength(200);
  expect(rows.every(r => JSON.stringify(r).length < 1000)).toBe(true);
});
