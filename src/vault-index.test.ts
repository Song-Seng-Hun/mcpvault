import { afterEach, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { VaultMetadataIndex } from './vault-index.js';

let vaultPath: string | undefined;

afterEach(async () => {
  if (vaultPath) await rm(vaultPath, { recursive: true, force: true }).catch(() => undefined);
  vaultPath = undefined;
});

async function writeNote(path: string, content: string): Promise<void> {
  const fullPath = join(vaultPath!, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf8');
}

describe('VaultMetadataIndex', () => {
  test('refreshes only invalidated metadata while preserving revisions', async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'mcpvault-index-'));
    await writeNote('Community/Post.md', '---\nstatus: published\n---\n\nold');
    const index = new VaultMetadataIndex(vaultPath, new PathFilter(), new FrontmatterHandler());

    const first = await index.list();
    expect(first).toHaveLength(1);
    expect(first[0]!.frontmatter.status).toBe('published');
    const oldRevision = first[0]!.revision;

    await writeNote('Community/Post.md', '---\nstatus: closed\n---\n\nnew');
    index.invalidate('Community/Post.md', 'upsert');
    const second = await index.list();
    expect(second[0]!.frontmatter.status).toBe('closed');
    expect(second[0]!.revision).not.toBe(oldRevision);

    await rm(join(vaultPath, 'Community/Post.md'));
    index.invalidate('Community/Post.md', 'delete');
    expect(await index.list()).toHaveLength(0);
  });

  test('matches a revision without requiring a note-body read', async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'mcpvault-index-'));
    await writeNote('Stable.md', 'unchanged');
    const index = new VaultMetadataIndex(vaultPath, new PathFilter(), new FrontmatterHandler());
    const entry = (await index.list())[0]!;
    expect(await index.matchesRevision('Stable.md', entry.revision)).toBe(true);
    expect(await index.matchesRevision('Stable.md', 'wrong-revision')).toBe(false);
  });
});
