import { expect, test } from 'vitest';

const imported = await import('./story-visual-model.js').catch(() => ({} as Record<string, unknown>));
const parseStoryVisual = imported.parseStoryVisual as (value: unknown) => any;
const assertStoryVisualPassages = imported.assertStoryVisualPassages as (model: any, content: string) => void;
const parseStoryVisualIntent = imported.parseStoryVisualIntent as (value: unknown, model: any) => any;
const applyStoryVisualEdits = imported.applyStoryVisualEdits as (model: any, content: string, intent: any, replacements?: unknown) => any;

const passage = (quote: string, start = 0) => ({ start, end: start + Array.from(quote).length, quote });
const event = (id: string, quote: string, start = 0, extra: Record<string, unknown> = {}) => ({
  id, actorId: 'hero', action: 'waits', basis: 'stated', passage: passage(quote, start), ...extra,
});
const model = (events = [event('e1', 'Hero waits.', 0), event('e2', 'Hero waits.', 12)]): any => ({ events });

test('exports the pure story visual contract functions', () => {
  expect(parseStoryVisual).toEqual(expect.any(Function));
  expect(assertStoryVisualPassages).toEqual(expect.any(Function));
  expect(parseStoryVisualIntent).toEqual(expect.any(Function));
  expect(applyStoryVisualEdits).toEqual(expect.any(Function));
});

test('parses valid bounded events without mutating input', () => {
  const input = model([event('e1', 'Hero waits.', 0, { targetId: 'door', locationId: 'hall' })]);
  const output = parseStoryVisual(input);
  expect(output).toEqual(input);
  expect(output).not.toBe(input);
  expect(output.events[0]).not.toBe(input.events[0]);
});

test.each([
  ['unknown model field', { events: [], extra: true }],
  ['unknown event field', { events: [event('e1', 'x', 0, { extra: true })] }],
  ['duplicate IDs', model([event('e1', 'x'), event('e1', 'y', 1)])],
  ['oversize event list', { events: Array.from({ length: 65 }, (_, i) => event(`e${i}`, 'x', i)) }],
  ['bad ID', { events: [event('E1', 'x')] }],
  ['bad basis', { events: [{ ...event('e1', 'x'), basis: 'guess' }] }],
  ['oversize action', { events: [event('e1', 'x', 0, { action: 'a'.repeat(301) })] }],
  ['empty quote', { events: [event('e1', '')] }],
  ['bad passage range', { events: [event('e1', 'x', 0, { passage: { start: 1.5, end: 2, quote: 'x' } })] }],
] as const)('rejects %s', (_name, value) => {
  expect(() => parseStoryVisual(value)).toThrow();
});

test('uses Unicode codepoint offsets and permits repeated quotes at distinct offsets', () => {
  const content = '😀 hero waits.😀 hero waits.';
  const parsed = parseStoryVisual(model([event('e1', '😀 hero waits.', 0), event('e2', '😀 hero waits.', 13)]));
  expect(() => assertStoryVisualPassages(parsed, content)).not.toThrow();
});

test.each([
  ['drifted quote', 'Hero waits.', model([event('e1', 'Hero waits.', 0, { passage: passage('Hero leaves.', 0) })])],
  ['overlapping fenced line', '```\nHero waits.\n```', model([event('e1', 'Hero waits.', 4)])],
  ['oversize content', 'x'.repeat(20001), model([])],
] as const)('rejects %s in passage assertions', (_name, content, value) => {
  expect(() => assertStoryVisualPassages(parseStoryVisual(value), content)).toThrow();
});

test('a mismatched character closer does not end a fence', () => {
  const content = ['```', 'inside', '~~~', 'still inside', '```', 'outside'].join('\n');
  const insideStart = content.indexOf('still inside');
  const outsideStart = content.lastIndexOf('outside');
  expect(() => assertStoryVisualPassages(parseStoryVisual(model([event('e1', 'still inside', insideStart)])), content)).toThrow();
  expect(() => assertStoryVisualPassages(parseStoryVisual(model([event('e1', 'outside', outsideStart)])), content)).not.toThrow();
});

test('a shorter matching-character closer does not end a longer fence', () => {
  const content = ['````', 'inside', '```', 'still inside', '````', 'outside'].join('\n');
  const insideStart = content.indexOf('still inside');
  const outsideStart = content.lastIndexOf('outside');
  expect(() => assertStoryVisualPassages(parseStoryVisual(model([event('e1', 'still inside', insideStart)])), content)).toThrow();
  expect(() => assertStoryVisualPassages(parseStoryVisual(model([event('e1', 'outside', outsideStart)])), content)).not.toThrow();
});

test('recognizes up-to-three-space fence indentation but not four-space indentation', () => {
  const three = ['   ```', 'inside', '   ```', 'outside'].join('\n');
  const four = ['    ```', 'inside', '    ```', 'outside'].join('\n');
  const insideThree = three.indexOf('inside');
  const insideFour = four.indexOf('inside');
  expect(() => assertStoryVisualPassages(parseStoryVisual(model([event('e1', 'inside', insideThree)])), three)).toThrow();
  expect(() => assertStoryVisualPassages(parseStoryVisual(model([event('e1', 'inside', insideFour)])), four)).not.toThrow();
});

test.each([
  ['negative offset', { start: -1, end: 0, quote: 'x' }],
  ['offset beyond bound', { start: 0, end: 20001, quote: 'x' }],
  ['quote beyond bound', { start: 0, end: 2001, quote: 'x'.repeat(2001) }],
  ['NUL quote', { start: 0, end: 1, quote: '\0' }],
] as const)('rejects %s in visual schema', (_name, visualPassage) => {
  expect(() => parseStoryVisual({ events: [event('e1', 'x', 0, { passage: visualPassage })] })).toThrow();
});

test('rejects NUL content during passage assertion', () => {
  expect(() => assertStoryVisualPassages(parseStoryVisual(model([])), '\0')).toThrow();
});

test.each([
  ['unknown intent field', { type: 'set_action', eventIds: ['e1'], action: 'runs', extra: true }],
  ['reorder type-specific field', { type: 'reorder_events', eventIds: ['e1', 'e2'], action: 'runs' }],
  ['move type-specific field', { type: 'move_entity', eventIds: ['e1'], actorId: 'hero', locationId: 'hall', action: 'runs' }],
  ['set_action type-specific field', { type: 'set_action', eventIds: ['e1'], action: 'runs', actorId: 'hero' }],
  ['missing event', { type: 'set_action', eventIds: ['missing'], action: 'runs' }],
  ['move actor mismatch', { type: 'move_entity', eventIds: ['e1', 'e2'], actorId: 'villain', locationId: 'hall' }],
  ['move location bad ID', { type: 'move_entity', eventIds: ['e1'], actorId: 'hero', locationId: 'Bad' }],
  ['reorder too short', { type: 'reorder_events', eventIds: ['e1'] }],
] as const)('rejects %s', (_name, value) => {
  expect(() => parseStoryVisualIntent(value, model())).toThrow();
});

test('rejects missing required model, event, passage, and intent fields', () => {
  expect(() => parseStoryVisual({})).toThrow();
  expect(() => parseStoryVisual({ events: [{}] })).toThrow();
  expect(() => parseStoryVisual({ events: [event('e1', 'x', 0, { passage: {} })] })).toThrow();
  expect(() => parseStoryVisualIntent({ type: 'move_entity', eventIds: ['e1'], actorId: 'hero' }, model())).toThrow();
});

test('accepts inclusive contract bounds for events and text', () => {
  const quote = 'q'.repeat(2000);
  const events = Array.from({ length: 64 }, (_, index) => event(`e${index}`, 'x', index));
  events[0] = event('e0', quote, 0, { action: 'a'.repeat(300) });
  expect(parseStoryVisual({ events })).toEqual({ events });
});

test('accepts the maximum intent event count and action length', () => {
  const events = Array.from({ length: 32 }, (_, index) => event(`e${index}`, 'x', index * 2));
  const parsed = parseStoryVisual({ events });
  expect(parseStoryVisualIntent({ type: 'set_action', eventIds: events.map(item => item.id), action: 'a'.repeat(300) }, parsed)).toMatchObject({ type: 'set_action' });
});

test('rejects overlapping selected edit spans during intent parsing', () => {
  const value = { events: [event('e1', 'abc', 0), event('e2', 'bcd', 1)] };
  expect(() => parseStoryVisualIntent({ type: 'set_action', eventIds: ['e1', 'e2'], action: 'runs' }, parseStoryVisual(value))).toThrow();
});

test('applies an exact replacement patch set with no outside changes', () => {
  const content = 'Hero waits. Then rests.';
  const parsed = parseStoryVisual(model([event('e1', 'Hero waits.', 0)]));
  const intent = parseStoryVisualIntent({ type: 'set_action', eventIds: ['e1'], action: 'runs' }, parsed);
  const result = applyStoryVisualEdits(parsed, content, intent, [{ eventId: 'e1', content: 'Hero runs.' }]);
  expect(result.content).toBe('Hero runs. Then rests.');
  expect(result.changes).toEqual([{ eventId: 'e1', start: 0, end: 11, before: 'Hero waits.', after: 'Hero runs.' }]);
  expect(content).toBe('Hero waits. Then rests.');
});

test('rejects incomplete, duplicate, extra, and oversized exact target-set patches', () => {
  const parsed = parseStoryVisual(model([event('e1', 'abc', 0), event('e2', 'xyz', 4)]));
  const intent = parseStoryVisualIntent({ type: 'set_action', eventIds: ['e1', 'e2'], action: 'runs' }, parsed);
  for (const replacements of [
    [{ eventId: 'e1', content: 'a' }],
    [{ eventId: 'e1', content: 'a' }, { eventId: 'e1', content: 'b' }],
    [{ eventId: 'e1', content: 'a' }, { eventId: 'e2', content: 'b' }, { eventId: 'e3', content: 'c' }],
    [{ eventId: 'e1', content: 'x'.repeat(20001) }, { eventId: 'e2', content: 'b' }],
  ]) expect(() => applyStoryVisualEdits(parsed, 'abc xyz', intent, replacements)).toThrow();
});

test('apply revalidates malformed typed intents and untrusted models', () => {
  const parsed = parseStoryVisual(model([event('e1', 'abc', 0)]));
  expect(() => applyStoryVisualEdits(parsed, 'abc', { type: 'set_action', eventIds: ['e1'], action: 'runs', extra: true } as any,
    [{ eventId: 'e1', content: 'x' }])).toThrow();
  expect(() => applyStoryVisualEdits({ events: [{}] } as any, 'abc',
    { type: 'set_action', eventIds: ['e1'], action: 'runs' } as any,
    [{ eventId: 'e1', content: 'x' }])).toThrow();
});

test('reorders selected passages by requested event order and preserves gaps', () => {
  const content = 'A one. gap B two.';
  const parsed = parseStoryVisual(model([event('e1', 'A one.', 0), event('e2', 'B two.', 11)]));
  const intent = parseStoryVisualIntent({ type: 'reorder_events', eventIds: ['e2', 'e1'] }, parsed);
  const result = applyStoryVisualEdits(parsed, content, intent);
  expect(result.content).toBe('B two. gap A one.');
  expect(result.changes.map((change: any) => change.eventId)).toEqual(['e1', 'e2']);
  expect(() => applyStoryVisualEdits(parsed, content, intent, [])).toThrow();
});

test('enforces the final content codepoint bound', () => {
  const parsed = parseStoryVisual(model([event('e1', 'x', 0)]));
  const intent = parseStoryVisualIntent({ type: 'set_action', eventIds: ['e1'], action: 'runs' }, parsed);
  expect(() => applyStoryVisualEdits(parsed, 'x'.repeat(20000), intent, [{ eventId: 'e1', content: '😀'.repeat(20000) }])).toThrow();
});
