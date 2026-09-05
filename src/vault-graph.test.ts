import { afterEach, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { VaultGraphIndex } from './vault-graph.js';

let vaultPath: string | undefined;
let graph: VaultGraphIndex | undefined;

afterEach(async () => {
  graph?.close();
  graph = undefined;
  if (vaultPath) await rm(vaultPath, { recursive: true, force: true }).catch(() => undefined);
  vaultPath = undefined;
});

async function writeNote(path: string, content: string): Promise<void> {
  const fullPath = join(vaultPath!, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf8');
}

describe('VaultGraphIndex', () => {
  test('ordinary Markdown siblings resolve locally and hidden neighbors are redacted', async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'mcpvault-markdown-graph-'));
    await writeNote('Wiki/Target.md', '# Actual\n');
    await writeNote('Other/Target.md', '# Other\n');
    await writeNote('Wiki/Secret.md', '# Hidden\n');
    await writeNote('Other/Secret.md', '# Not the hidden target\n');
    await writeNote('Wiki/Source.md', '## [secret](Secret.md)\n[local](Target.md) [secret](Secret.md)\n');
    graph = new VaultGraphIndex(vaultPath, new PathFilter(), new FrontmatterHandler());
    const visible = (path: string) => path !== 'Wiki/Secret.md';
    expect((await graph.getBacklinks('Other/Target.md', 10, visible)).total).toBe(0);
    const actual = await graph.getBacklinks('Wiki/Target.md', 10, visible);
    expect(actual.total).toBe(1);
    expect(JSON.stringify(actual)).not.toContain('Secret.md');
    expect((await graph.getOutlinks('Wiki/Source.md', 10, visible)).total).toBe(1);
    await writeNote('Wiki/Source.md', '[local](Target) [root](Other/Target.md)\n');
    graph.invalidate('Wiki/Source.md', 'upsert');
    expect((await graph.getBacklinks('Wiki/Target.md', 10, visible)).total).toBe(1);
    expect((await graph.getBacklinks('Other/Target.md', 10, visible)).total).toBe(1);
  });
  test('relative sibling links do not create backlinks to same-name notes elsewhere', async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'mcpvault-relative-graph-'));
    await writeNote('Wiki/Target.md', '# Actual target\n');
    await writeNote('Other/Target.md', '# Unrelated target\n');
    await writeNote('Wiki/Source.md', '[[./Target#^proof|alias]]\n[local](./Target.md)\n');
    graph = new VaultGraphIndex(vaultPath, new PathFilter(), new FrontmatterHandler());
    expect((await graph.getBacklinks('Wiki/Target.md', 10, () => true)).total).toBe(2);
    expect((await graph.getBacklinks('Other/Target.md', 10, () => true)).total).toBe(0);
    expect((await graph.findOrphanNotes(10, () => true)).orphans.map(item => item.path)).toContain('Other/Target.md');
    expect((await graph.getOutlinks('Wiki/Source.md', 10, path => path !== 'Wiki/Target.md')).outlinks).toEqual([]);
    await writeNote('Wiki/Source.md', '[[../Other/Target]]\n');
    graph.invalidate('Wiki/Source.md', 'upsert');
    expect((await graph.getBacklinks('Wiki/Target.md', 10, () => true)).total).toBe(0);
    expect((await graph.getBacklinks('Other/Target.md', 10, () => true)).total).toBe(1);
    await writeNote('Wiki/Source.md', '[[./Missing]]\n');
    await writeNote('Other/Missing.md', '# Not a fallback\n');
    graph.invalidate('Wiki/Source.md', 'upsert');
    graph.invalidate('Other/Missing.md', 'upsert');
    expect((await graph.getBacklinks('Other/Missing.md', 10, () => true)).total).toBe(0);
    expect((await graph.findUnresolvedLinks(10, () => true)).unresolved).toEqual([expect.objectContaining({ path: 'Wiki/Source.md', target: './Missing' })]);
  });
  test('builds bounded graph queries and refreshes only changed notes', async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'mcpvault-graph-'));
    await writeNote('Wiki/Target.md', 'target\n');
    await writeNote('Wiki/Source.md', 'See [[Wiki/Target]] and [[Missing]].\n\n#Research #research\n');
    await writeNote('Wiki/Orphan.md', 'orphan\n');
    await writeNote('asset.png', 'binary attachment\n');
    await writeNote('Private/Secret.md', '[[Wiki/Target]]\n#private\n');
    graph = new VaultGraphIndex(vaultPath, new PathFilter(), new FrontmatterHandler());

    const publicOnly = (path: string) => !path.startsWith('Private/');
    await expect(graph.getBacklinks('Wiki/Target.md', 10, publicOnly)).resolves.toMatchObject({
      backlinks: [{ path: 'Wiki/Source.md', line: 1 }],
      total: 1,
      truncated: false,
    });
    await expect(graph.findUnresolvedLinks(10, publicOnly)).resolves.toMatchObject({
      unresolved: [{ path: 'Wiki/Source.md', target: 'Missing' }],
      total: 1,
    });
    await expect(graph.listAllTags(publicOnly)).resolves.toEqual([
      { tag: 'research', count: 2 },
    ]);
    await expect(graph.findOrphanNotes(10, publicOnly)).resolves.toMatchObject({
      orphans: [
        { path: 'Wiki/Orphan.md', incomingLinks: 0 },
        { path: 'Wiki/Source.md', incomingLinks: 0 },
      ],
    });

    await writeNote('Wiki/Source.md', 'Source no longer links to the target.\n');
    graph.invalidate('Wiki/Source.md', 'upsert');
    await expect(graph.getBacklinks('Wiki/Target.md', 10, publicOnly)).resolves.toMatchObject({
      backlinks: [],
      total: 0,
    });
    await expect(graph.listAllTags(publicOnly)).resolves.toEqual([]);
    await expect(graph.getBacklinks('Wiki/Target.md', 10, path => path === 'Wiki/Target.md')).resolves.toMatchObject({
      backlinks: [],
    });
    await expect(graph.getBacklinks('Wiki/Target.md', 10, () => false)).rejects.toThrow(/Access denied/);
  });

  test('keeps claim-level Obsidian links in backlinks with their argument meaning', async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'mcpvault-claim-graph-'));
    await writeNote('Wiki/Target.md', '# Target\n\nConclusion. ^conclusion\n');
    await writeNote('Wiki/Source.md', [
      '---',
      'claims:',
      '  - id: premise',
      '    supports_claims:',
      '      - "[[Wiki/Target#^conclusion]]"',
      '---',
      '# Source',
      '',
      'Premise. ^premise',
      '',
    ].join('\n'));
    graph = new VaultGraphIndex(vaultPath, new PathFilter(), new FrontmatterHandler());

    const backlinks = await graph.getBacklinks('Wiki/Target.md', 10, () => true);
    expect(backlinks).toMatchObject({ total: 1, truncated: false });
    expect(backlinks.backlinks).toEqual([
      expect.objectContaining({ path: 'Wiki/Source.md', relation: 'claim_supports', sourceClaimId: 'premise', targetBlockId: 'conclusion', context: 'claims.premise.supports_claims: [[Wiki/Target#^conclusion]]' }),
    ]);
    const outlinks = await graph.getOutlinks('Wiki/Source.md', 10, () => true);
    expect(outlinks.outlinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: 'claim_supports', sourceClaimId: 'premise', targetBlockId: 'conclusion' }),
    ]));
  });

  test('indexes path-like Obsidian Properties as explainable backlinks', async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'mcpvault-property-graph-'));
    await writeNote('Wiki/Target.md', '# Target\n');
    await writeNote('Wiki/Source.md', [
      '---',
      'primary_moc: Wiki/Target',
      'evidence_paths: [Wiki/Target.md]',
      'supports: [Wiki/Target.md]',
      'review_basis_links:',
      '  - path: Wiki/Target.md',
      '    revision: old-review-snapshot',
      '---',
      '# Source',
      '',
    ].join('\n'));
    graph = new VaultGraphIndex(vaultPath, new PathFilter(), new FrontmatterHandler());

    const backlinks = await graph.getBacklinks('Wiki/Target.md', 10, () => true);
    expect(backlinks).toMatchObject({ total: 3, truncated: false });
    expect(backlinks.backlinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Wiki/Source.md', propertyPath: 'primary_moc', context: 'primary_moc: Wiki/Target' }),
      expect.objectContaining({ path: 'Wiki/Source.md', propertyPath: 'evidence_paths[0]', context: 'evidence_paths[0]: Wiki/Target.md' }),
      expect.objectContaining({ path: 'Wiki/Source.md', propertyPath: 'supports[0]', relation: 'supports' }),
    ]));
    const outlinks = await graph.getOutlinks('Wiki/Source.md', 10, () => true);
    expect(outlinks.outlinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ propertyPath: 'primary_moc' }),
      expect.objectContaining({ propertyPath: 'evidence_paths[0]' }),
      expect.objectContaining({ propertyPath: 'supports[0]', relation: 'supports' }),
    ]));
    expect(outlinks.outlinks).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ propertyPath: 'review_basis_links[0].path' }),
    ]));
  });

  test('resolves Obsidian aliases, stable IDs, and explicit relative links without crossing visibility', async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'mcpvault-authority-graph-'));
    await writeNote('Wiki/Canonical.md', [
      '---',
      'title: Canonical concept',
      'aliases: [Friendly name, Node.js]',
      'stable_id: canonical-id',
      'preferred_term: Preferred concept',
      '---',
      '# Canonical',
      '',
    ].join('\n'));
    await writeNote('Wiki/Nested/Relative target.md', '# Relative target\n');
    await writeNote('Wiki/Nested/Source.md', '[[Friendly name]] [[Node.js]] [[canonical-id]] [[Preferred concept]] [[./Relative target]]\n');
    await writeNote('Private/Secret.md', '---\naliases: [Hidden alias]\n---\n# Secret\n');
    await writeNote('Wiki/Public source.md', '[[Hidden alias]]\n');
    graph = new VaultGraphIndex(vaultPath, new PathFilter(), new FrontmatterHandler());

    const publicOnly = (path: string) => !path.startsWith('Private/');
    const canonical = await graph.getBacklinks('Wiki/Canonical.md', 10, publicOnly);
    expect(canonical).toMatchObject({ total: 4, truncated: false });
    expect(canonical.backlinks).toEqual([
      expect.objectContaining({ path: 'Wiki/Nested/Source.md' }),
      expect.objectContaining({ path: 'Wiki/Nested/Source.md' }),
      expect.objectContaining({ path: 'Wiki/Nested/Source.md' }),
      expect.objectContaining({ path: 'Wiki/Nested/Source.md' }),
    ]);
    await expect(graph.getBacklinks('Wiki/Nested/Relative target.md', 10, publicOnly)).resolves.toMatchObject({ total: 1 });

    const unresolved = await graph.findUnresolvedLinks(10, publicOnly);
    // Known private-only aliases are not public broken-link repair tasks,
    // matching the outlink visibility rule; their candidates remain private.
    expect(unresolved.unresolved).toEqual([]);
    await expect(graph.findOrphanNotes(10, publicOnly)).resolves.toMatchObject({
      orphans: expect.not.arrayContaining([expect.objectContaining({ path: 'Wiki/Canonical.md' }), expect.objectContaining({ path: 'Wiki/Nested/Relative target.md' })]),
    });
  });
});
