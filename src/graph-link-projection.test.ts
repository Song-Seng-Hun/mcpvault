import { expect, test, vi } from 'vitest';
import * as links from './backlinks.js';
import { createGraphLinkProjector } from './graph-link-projection.js';

const row = (heading: string) => ({ target: 'Target', line: 2, link: '[[Target]]', context: '[[Private]] [[Target]]', heading });
const hidden = { target: 'Private', line: 2, link: '[[Private]]', context: '[[Private]] [[Target]]' };

test('memoized projections never cross source identity or caller predicates', () => {
  const item = row('Heading [[Private]]');
  const entry = { path: 'A.md', links: [hidden, item] };
  const privateView = createGraphLinkProjector(target => target === 'Private');
  const ownerView = createGraphLinkProjector(() => false);
  expect(privateView(entry, item)).toMatchObject({ context: '[unavailable link] [[Target]]', heading: 'Heading [unavailable link]' });
  expect(ownerView(entry, item)).toEqual(item);
  expect(entry.links[1]).toBe(item);
  expect(item.heading).toBe('Heading [[Private]]');
  const relative = createGraphLinkProjector((target, source) => target === 'Private' && source === 'A.md');
  expect(relative(entry, item).heading).toBe('Heading [unavailable link]');
  expect(relative({ ...entry, path: 'B.md' }, item)).toEqual(item);
  // A replacement entry at the same path is a different parsed source.
  expect(privateView({ path: 'A.md', links: [item] }, item).context).toBe(item.context);
});

test.each([['entry', 300, 10], ['character', 10, 10000]] as const)('%s limits evict old previews without changing output', (_kind, count, length) => {
  const projector = createGraphLinkProjector(target => target === 'Private');
  const first = row(`First [[Private]] ${'x'.repeat(length)}`);
  const entry = { path: 'A.md', links: [hidden, first] };
  const spy = vi.spyOn(links, 'extractObsidianLinkOccurrences');
  try {
    const initial = projector(entry, first);
    expect(projector(entry, first)).toEqual(initial);
    expect(spy.mock.calls.filter(([text]) => text === first.heading).length).toBe(1);
    for (let i = 0; i < count; i++) projector(entry, row(`Other ${i} [[Private]] ${'x'.repeat(length)}`));
    expect(projector(entry, first)).toEqual(initial);
    expect(spy.mock.calls.filter(([text]) => text === first.heading).length).toBe(2);
  } finally { spy.mockRestore(); }
});

test('oversized cache entries bypass retention but keep exact visible text', () => {
  const projector = createGraphLinkProjector(target => target === 'Private');
  const item = row(`[[Private]] ${'x'.repeat(70000)}`);
  const entry = { path: 'A.md', links: [hidden, item] };
  const spy = vi.spyOn(links, 'extractObsidianLinkOccurrences');
  try {
    expect(projector(entry, item).heading).toBe(`[unavailable link] ${'x'.repeat(70000)}`);
    expect(projector(entry, item).heading).toBe(`[unavailable link] ${'x'.repeat(70000)}`);
    expect(spy.mock.calls.filter(([text]) => text === item.heading).length).toBe(2);
  } finally { spy.mockRestore(); }
});
