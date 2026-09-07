import { describe, expect, it } from 'vitest';
import { normalizeSourceDerivations, traceSourceOrigins, type SourceOriginNode } from './source-provenance-model.js';

const revision = (hex: string) => hex.repeat(64).slice(0, 64);
const derivation = (path: string, rev = revision('a'), relation: 'quotation' | 'adaptation' | 'republication' = 'quotation') => ({ path, revision: rev, relation });
const node = (path: string, rev = revision('a'), extra: Partial<SourceOriginNode> = {}): SourceOriginNode => ({ path, revision: rev, derivations: [], integrity: true, ...extra });

function loader(nodes: SourceOriginNode[], missing: string[] = []) {
  const map = new Map(nodes.map(item => [item.path, item]));
  return async (path: string) => missing.includes(path) ? undefined : map.get(path);
}

describe('normalizeSourceDerivations', () => {
  it('returns empty for undefined and normalizes separators and revisions', () => {
    expect(normalizeSourceDerivations(undefined)).toEqual([]);
    expect(normalizeSourceDerivations([derivation('folder\\Source.md', revision('a'))])).toEqual([{ path: 'folder/Source.md', revision: revision('a'), relation: 'quotation' }]);
  });

  it('rejects malformed, non-canonical, oversized, duplicate, or extra data', () => {
    const valid = derivation('Source.md');
    for (const value of [
      {}, 'x', [valid, { ...valid, path: 'source.md' }],
      [{ ...valid, extra: true }], [{ ...valid, revision: 'a' }],
      [{ ...valid, relation: 'cite' }], [{ ...valid, path: '' }],
      [{ ...valid, path: '/absolute.md' }], [{ ...valid, path: 'a/../secret.md' }],
      [{ ...valid, path: 'https://example.com/x.md' }], [{ ...valid, path: 'C:relative.md' }],
      [{ ...valid, path: 'bad\u0000.md' }], Array.from({ length: 9 }, () => valid),
      [{ ...valid, path: 'x'.repeat(501) }],
      [{ ...valid, revision: revision('A') }],
      [{ ...valid, path: ' Source.md' }],
      [{ ...valid, path: 'Source.md ' }],
      [{ ...valid, path: '   ' }],
    ]) expect(() => normalizeSourceDerivations(value)).toThrow();
  });
});

describe('traceSourceOrigins', () => {
  it('groups same-work editions and exposes successfully loaded seed origins', async () => {
    const a = node('A.md', revision('a'), { workId: 'Work-1' });
    const b = node('B.md', revision('b'), { workId: 'work-1' });
    const result = await traceSourceOrigins(['A.md', 'B.md'], loader([a, b]));
    expect(result.status).toBe('shared_origin_observed');
    expect(result.groups).toEqual([{ sourcePaths: ['A.md', 'B.md'], sharedOrigins: [
      { path: 'A.md', revision: revision('a'), workId: 'Work-1' },
      { path: 'B.md', revision: revision('b'), workId: 'work-1' },
    ] }]);
    expect(result.unresolved).toBe(true);
  });

  it('follows quotation chains and shared parents', async () => {
    const parent = node('Parent.md', revision('c'), { workId: 'parent' });
    const a = node('A.md', revision('a'), { derivations: [derivation('Parent.md', revision('c'), 'adaptation')] });
    const b = node('B.md', revision('b'), { derivations: [derivation('Parent.md', revision('c'), 'republication')] });
    const result = await traceSourceOrigins(['A.md', 'B.md'], loader([a, b, parent]));
    expect(result.groups[0]?.sourcePaths).toEqual(['A.md', 'B.md']);
    expect(result.groups[0]?.sharedOrigins).toEqual([{ path: 'Parent.md', revision: revision('c'), workId: 'parent' }]);
  });

  it('keeps independent experiment records separate and makes no independence claim', async () => {
    const result = await traceSourceOrigins(['one.md', 'two.md'], loader([
      node('one.md', revision('a'), { derivations: [{ path: 'exp-one.md', revision: revision('b'), relation: 'adaptation' }] }),
      node('two.md', revision('c'), { derivations: [{ path: 'exp-two.md', revision: revision('d'), relation: 'adaptation' }] }),
      node('exp-one.md', revision('b')), node('exp-two.md', revision('d')),
    ]));
    expect(result.status).toBe('separately_recorded_origins');
    expect(result.groups).toHaveLength(2);
    expect(result.notice).toContain('not claim-specific proof');
  });

  it('omits failed or stale ancestors, reports cycles, and never exposes hidden paths', async () => {
    const a = node('A.md', revision('a'), { derivations: [derivation('hidden.md', revision('b'))] });
    const stale = node('stale.md', revision('d'), { derivations: [derivation('A.md', revision('b'))] });
    const cycleA = node('cycle-a.md', revision('a'), { derivations: [derivation('cycle-b.md', revision('b'))] });
    const cycleB = node('cycle-b.md', revision('b'), { derivations: [derivation('cycle-a.md', revision('a'))] });
    const result = await traceSourceOrigins(['A.md', 'stale.md', 'cycle-a.md'], loader([a, stale, cycleA, cycleB], ['hidden.md']));
    expect(result.unresolved).toBe(true);
    expect(result.status).toBe('partial');
    expect(result.groups.flatMap(group => group.sharedOrigins).some(origin => origin.path === 'hidden.md')).toBe(false);
    expect(result.cautions).toEqual(expect.arrayContaining(['ancestor_unavailable', 'stale_revision', 'cycle_detected']));
  });

  it('marks absent ancestry unresolved without calling it partial', async () => {
    const result = await traceSourceOrigins(['A.md'], loader([node('A.md')]));
    expect(result).toMatchObject({ status: 'separately_recorded_origins', unresolved: true });
    expect(result.cautions).toContain('ancestry_not_recorded');
  });

  it('enforces seed, load, depth, group, and origin bounds', async () => {
    const seeds = Array.from({ length: 13 }, (_, i) => `s${i}.md`);
    const many = Array.from({ length: 12 }, (_, i) => node(`s${i}.md`, revision('a'), { workId: `w${i}` }));
    let loadCount = 0;
    const exact = await traceSourceOrigins(seeds, async path => { loadCount++; return loader(many)(path); });
    expect(exact.truncated).toBe(true);
    expect(exact.groups).toHaveLength(12);
    expect(exact.groups.every(group => group.sourcePaths.length <= 12 && group.sharedOrigins.length <= 4)).toBe(true);

    const chain: SourceOriginNode[] = [];
    const hex = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let i = 0; i < 6; i++) chain.push(node(`d${i}.md`, revision(hex[i]!), { derivations: i === 5 ? [] : [derivation(`d${i + 1}.md`, revision(hex[i + 1]!))] }));
    const deep = await traceSourceOrigins(['d0.md'], loader(chain));
    expect(deep.cautions).toContain('depth_limit');
    expect(deep.truncated).toBe(true);
  });

  it('accepts exact eight derivations and twenty unique loads', async () => {
    const parents = Array.from({ length: 8 }, (_, i) => `p${i}.md`);
    const rootHex = ['b', 'c', 'd', 'e', 'f', 'a', 'b', 'c'];
    const root = node('root.md', revision('a'), { derivations: parents.map((path, i) => derivation(path, revision(rootHex[i]!))) });
    let loadCount = 0;
    const hex = ['b', 'c', 'd', 'e', 'f', 'a', 'b', 'c'];
    const result = await traceSourceOrigins(['root.md', ...Array.from({ length: 11 }, (_, i) => `seed${i}.md`)], async path => { loadCount++; return loader([root, ...parents.map((parent, i) => node(parent, revision(hex[i]!))), ...Array.from({ length: 11 }, (_, i) => node(`seed${i}.md`, revision('f')))])(path); });
    expect(result.truncated).toBe(false);
    expect(loadCount).toBe(20);
  });

  it('uses separately recorded status when one inspected source has no overlap', async () => {
    const result = await traceSourceOrigins(['solo.md'], loader([node('solo.md')]));
    expect(result.status).toBe('separately_recorded_origins');
  });

  it('does not promote a stale cached ancestor when it is later requested as a seed', async () => {
    const a = node('A.md', revision('a'), { derivations: [derivation('P.md', revision('b'))] });
    const b = node('B.md', revision('d'), { derivations: [derivation('P.md', revision('c'))] });
    const stale = node('P.md', revision('c'));
    const result = await traceSourceOrigins(['A.md', 'B.md', 'P.md'], loader([a, b, stale]));
    expect(result.groups.flatMap(group => group.sourcePaths)).toEqual(['A.md', 'B.md', 'P.md']);
    expect(result.groups.some(group => group.sourcePaths.includes('B.md') && group.sourcePaths.includes('P.md'))).toBe(true);
    expect(result.groups.some(group => group.sourcePaths.includes('A.md') && group.sourcePaths.includes('P.md'))).toBe(false);
    expect(result.cautions).toContain('stale_revision');
    expect(result.status).toBe('partial');
  });

  it('retains a bounded warning when shared origins exceed the result limit', async () => {
    const parents = Array.from({ length: 8 }, (_, index) => `P${index}.md`);
    const a = node('A.md', revision('a'), { derivations: parents.map(path => derivation(path, revision('b'))) });
    const b = node('B.md', revision('c'), { derivations: parents.map(path => derivation(path, revision('b'))) });
    const result = await traceSourceOrigins(['A.md', 'B.md'], loader([
      a,
      b,
      ...parents.map(path => node(path, revision('b'))),
    ]));
    expect(result.groups[0]?.sharedOrigins).toHaveLength(4);
    expect(result.truncated).toBe(true);
    expect(result.unresolved).toBe(true);
    expect(result.cautions).toContain('origin_limit');
  });

  it('groups seeds whose distinct ancestors share a work', async () => {
    const a = node('A.md', revision('a'), { derivations: [derivation('P1.md', revision('b'))] });
    const b = node('B.md', revision('c'), { derivations: [derivation('P2.md', revision('d'))] });
    const p1 = node('P1.md', revision('b'), { workId: 'Shared-Work' });
    const p2 = node('P2.md', revision('d'), { workId: 'shared-work' });
    const result = await traceSourceOrigins(['A.md', 'B.md'], loader([a, b, p1, p2]));
    expect(result.status).toBe('shared_origin_observed');
    expect(result.groups[0]?.sharedOrigins.map(origin => origin.path)).toEqual(['P1.md', 'P2.md']);
  });

  it('deduplicates canonical path variants before loading', async () => {
    let loadCount = 0;
    const result = await traceSourceOrigins(['Folder\\A.md', 'folder/a.md'], async path => { loadCount++; return node(path); });
    expect(loadCount).toBe(1);
    expect(result.groups[0]?.sourcePaths).toEqual(['Folder/A.md']);
  });

  it('does not expose a malformed cached node on a later duplicate request', async () => {
    let loadCount = 0;
    const bad = { path: 'bad.md', revision: revision('a'), derivations: [], integrity: false } satisfies SourceOriginNode;
    const result = await traceSourceOrigins(['bad.md', 'BAD.md'], async () => { loadCount++; return bad; });
    expect(loadCount).toBe(1);
    expect(result.groups).toEqual([]);
    expect(result.cautions).toContain('integrity_failed');
  });
});
