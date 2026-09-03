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
});
