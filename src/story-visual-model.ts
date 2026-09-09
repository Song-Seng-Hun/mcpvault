import { guidanceError } from './guidance-runtime.js';
import { storyId, storyList, storyObject, storyText } from './story-model.js';

export interface StoryVisualEvent {
  id: string;
  actorId: string;
  targetId?: string;
  locationId?: string;
  action: string;
  basis: 'stated' | 'inferred' | 'uncertain';
  passage: { start: number; end: number; quote: string };
}
export interface StoryVisualModel { events: StoryVisualEvent[] }
export type StoryVisualIntent =
  | { type: 'move_entity'; eventIds: string[]; actorId: string; locationId: string }
  | { type: 'set_action'; eventIds: string[]; action: string }
  | { type: 'reorder_events'; eventIds: string[] };
export interface StoryVisualChange { eventId: string; start: number; end: number; before: string; after: string }

const fail = (message: string): never => { throw guidanceError(new Error(message), 'guid-visual-story-contract'); };
const cpLength = (value: string) => Array.from(value).length;
const boundedText = (value: unknown, field: string, max: number, required = false) => storyText(value, field, max, required);

function passageValue(value: unknown, field: string) {
  const data = storyObject(value, ['start', 'end', 'quote'], field);
  for (const key of ['start', 'end']) {
    if (!Number.isSafeInteger(data[key]) || data[key] < 0 || data[key] > 20000) fail(`${field}.${key} must be a safe offset`);
  }
  if (data.end <= data.start) fail(`${field}.end must exceed start`);
  return { start: data.start, end: data.end, quote: boundedText(data.quote, `${field}.quote`, 2000, true) };
}

function eventValue(value: unknown): StoryVisualEvent {
  const data = storyObject(value, ['id', 'actorId', 'targetId', 'locationId', 'action', 'basis', 'passage'], 'story visual event');
  const result: StoryVisualEvent = {
    id: storyId(data.id, 'event.id'),
    actorId: storyId(data.actorId, 'event.actorId'),
    action: boundedText(data.action, 'event.action', 300, true),
    basis: data.basis,
    passage: passageValue(data.passage, 'event.passage'),
  };
  if (!['stated', 'inferred', 'uncertain'].includes(result.basis)) fail('Invalid story visual event basis');
  if (data.targetId !== undefined) result.targetId = storyId(data.targetId, 'event.targetId');
  if (data.locationId !== undefined) result.locationId = storyId(data.locationId, 'event.locationId');
  return result;
}

export function parseStoryVisual(value: unknown): StoryVisualModel {
  const data = storyObject(value, ['events'], 'story visual model');
  const events = storyList(data.events, 'story visual events', 64).map(eventValue);
  if (new Set(events.map(event => event.id)).size !== events.length) fail('Duplicate story visual event id');
  return { events: structuredClone(events) };
}

function fencedRanges(content: string): Array<[number, number]> {
  const points = Array.from(content);
  const ranges: Array<[number, number]> = [];
  let lineStart = 0;
  let fence: { char: '`' | '~'; length: number } | undefined;
  const lines: Array<[number, number, string]> = [];
  for (let index = 0; index <= points.length; index++) {
    if (index === points.length || points[index] === '\n') {
      const lineEnd = index < points.length ? index + 1 : index;
      const text = points.slice(lineStart, index).join('').replace(/\r$/, '');
      lines.push([lineStart, lineEnd, text]);
      lineStart = lineEnd;
    }
  }
  for (const [start, end, line] of lines) {
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
    if (!fence && opening && !(opening[1]![0] === '`' && opening[2]!.includes('`'))) {
      fence = { char: opening[1]![0] as '`' | '~', length: opening[1]!.length };
      ranges.push([start, end]);
    } else if (fence) {
      ranges.push([start, end]);
      if (closing && closing[1]![0] === fence.char && closing[1]!.length >= fence.length) fence = undefined;
    }
  }
  return ranges;
}

export function assertStoryVisualPassages(model: StoryVisualModel, content: string): void {
  const checked = parseStoryVisual(model);
  if (typeof content !== 'string' || content.includes('\0') || cpLength(content) > 20000) fail('Story visual content exceeds 20000 Unicode characters');
  const points = Array.from(content);
  const fences = fencedRanges(content);
  for (const event of checked.events) {
    const { start, end, quote } = event.passage;
    if (end > points.length || points.slice(start, end).join('') !== quote) fail(`Story visual passage drift for ${event.id}`);
    if (fences.some(([fenceStart, fenceEnd]) => start < fenceEnd && end > fenceStart)) fail(`Story visual passage is fenced for ${event.id}`);
  }
}

function eventMap(model: StoryVisualModel) { return new Map(model.events.map(event => [event.id, event])); }
function selectedEvents(ids: string[], model: StoryVisualModel): StoryVisualEvent[] {
  const byId = eventMap(model);
  const selected = ids.map(id => byId.get(id) ?? fail(`Unknown story visual event ${id}`));
  const sorted = [...selected].sort((a, b) => a.passage.start - b.passage.start);
  for (let index = 1; index < sorted.length; index++) if (sorted[index]!.passage.start < sorted[index - 1]!.passage.end) fail('Selected story visual passages overlap');
  return selected;
}

export function parseStoryVisualIntent(value: unknown, model: StoryVisualModel): StoryVisualIntent {
  const checked = parseStoryVisual(model);
  const broad = storyObject(value, ['type', 'eventIds', 'actorId', 'locationId', 'action'], 'story visual intent');
  if (!['move_entity', 'set_action', 'reorder_events'].includes(broad.type)) fail('Invalid story visual intent type');
  const data = broad.type === 'move_entity'
    ? storyObject(value, ['type', 'eventIds', 'actorId', 'locationId'], 'move_entity intent')
    : broad.type === 'set_action'
      ? storyObject(value, ['type', 'eventIds', 'action'], 'set_action intent')
      : storyObject(value, ['type', 'eventIds'], 'reorder_events intent');
  const eventIds = storyList(data.eventIds, 'story visual eventIds', 32).map(id => storyId(id, 'intent.eventId'));
  if (new Set(eventIds).size !== eventIds.length) fail('Duplicate story visual intent eventId');
  const min = data.type === 'reorder_events' ? 2 : 1;
  if (eventIds.length < min) fail(`Story visual intent requires at least ${min} eventIds`);
  const selected = selectedEvents(eventIds, checked);
  if (data.type === 'move_entity') {
    const actorId = storyId(data.actorId, 'intent.actorId');
    const locationId = storyId(data.locationId, 'intent.locationId');
    if (selected.some(event => event.actorId !== actorId)) fail('Move actor must match every selected event');
    return { type: data.type, eventIds: [...eventIds], actorId, locationId };
  }
  if (data.type === 'set_action') return { type: data.type, eventIds: [...eventIds], action: boundedText(data.action, 'intent.action', 300, true) };
  return { type: data.type, eventIds: [...eventIds] };
}

function replacementMap(value: unknown, ids: string[]): Map<string, string> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) fail('Replacements require 1..32 entries');
  const result = new Map<string, string>();
  for (const item of storyList(value, 'replacements', 32)) {
    const data = storyObject(item, ['eventId', 'content'], 'story visual replacement');
    const id = storyId(data.eventId, 'replacement.eventId');
    if (result.has(id) || !ids.includes(id)) fail('Replacement IDs must exactly match selected events');
    result.set(id, boundedText(data.content, 'replacement.content', 20000));
  }
  if (result.size !== ids.length) fail('Replacement IDs must exactly match selected events');
  return result;
}

export function applyStoryVisualEdits(model: StoryVisualModel, content: string, intent: StoryVisualIntent, replacements?: unknown): { content: string; changes: StoryVisualChange[] } {
  const checked = parseStoryVisual(model);
  assertStoryVisualPassages(checked, content);
  const checkedIntent = parseStoryVisualIntent(intent, checked);
  const selected = selectedEvents(checkedIntent.eventIds, checked);
  const points = Array.from(content);
  const slots = [...selected].sort((a, b) => a.passage.start - b.passage.start);
  const changes: StoryVisualChange[] = [];
  const output: string[] = [];
  let cursor = 0;
  if (checkedIntent.type === 'reorder_events') {
    if (replacements !== undefined) fail('Reorder does not accept replacements');
    for (const [index, slot] of slots.entries()) {
      const after = selected[index]!.passage.quote;
      output.push(...points.slice(cursor, slot.passage.start), ...Array.from(after));
      changes.push({ eventId: slot.id, start: slot.passage.start, end: slot.passage.end, before: slot.passage.quote, after });
      cursor = slot.passage.end;
    }
  } else {
    const patch = replacementMap(replacements, checkedIntent.eventIds);
    for (const slot of slots) {
      const after = patch.get(slot.id)!;
      output.push(...points.slice(cursor, slot.passage.start), ...Array.from(after));
      changes.push({ eventId: slot.id, start: slot.passage.start, end: slot.passage.end, before: slot.passage.quote, after });
      cursor = slot.passage.end;
    }
  }
  output.push(...points.slice(cursor));
  const nextContent = output.join('');
  if (cpLength(nextContent) > 20000) fail('Edited story visual content exceeds 20000 Unicode characters');
  return { content: nextContent, changes: changes.sort((a, b) => a.start - b.start).map(change => ({ ...change })) };
}
