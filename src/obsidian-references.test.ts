import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { ReferenceService } from './references.js';
import { ScopeAccessPolicy } from './scope-access.js';

const vaults: string[] = [];
afterEach(async () => { for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });

test('body Obsidian wikilinks become validated references while unresolved links remain lintable', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-obsidian-ref-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault, new PathFilter(), new FrontmatterHandler());
  await fs.writeNote({ path: 'Evidence.md', content: 'Evidence\n', expectedRevision: 'missing' });
  const refs = new ReferenceService(fs, new ScopeAccessPolicy());

  const result = await refs.validateAndNormalize(undefined, 'Community/Posts/example.md', undefined, 'See [[Evidence|the source]] and [[Future Note]].');
  expect(result).toEqual(['Evidence.md']);
});

test('explicit Obsidian references resolve headings and reject ambiguous basenames', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-obsidian-ref-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault, new PathFilter(), new FrontmatterHandler());
  await fs.writeNote({ path: 'one/Design.md', content: 'One\n', expectedRevision: 'missing' });
  await fs.writeNote({ path: 'two/Design.md', content: 'Two\n', expectedRevision: 'missing' });
  await fs.writeNote({ path: 'Basis.md', content: 'Basis\n', expectedRevision: 'missing' });
  const refs = new ReferenceService(fs, new ScopeAccessPolicy());

  await expect(refs.validateAndNormalize(['[[Basis#Conclusion|basis]]'], 'Community/Posts/example.md')).resolves.toEqual(['Basis.md']);
  await expect(refs.validateAndNormalize(['[[Design]]'], 'Community/Posts/example.md')).rejects.toThrow(/ambiguous/);
});
