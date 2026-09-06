import { expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { FileSystemService, MAX_NOTE_CONTENT_BYTES } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { VaultMetadataIndex } from './vault-index.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';

async function fixture(run: (context: {
  wiki: LlmWikiService; fs: FileSystemService; access: ScopeAccessPolicy; root: string;
  seed: (path: string, fields?: Record<string, unknown>, content?: string) => Promise<string>;
  setup: (prefix?: string, rootName?: string, count?: number) => Promise<{ path: string; notes: string[] }>;
}) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-rebalance-', root = await mkdtemp(join(base, prefix));
  const seed = async (path: string, fields: Record<string, unknown> = {}, content = '# Source\nDo not copy this body.\n') => {
    const raw = `---\n${stringify({ note_kind: 'atomic', lifecycle: 'evergreen', domain: 'Group', ...fields })}---\n${content}`;
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), raw); return raw;
  };
  const setup = async (prefix = '', rootName = 'Map.md', count = 4) => {
    const path = `${prefix}Maps/${rootName}`, notes = [];
    for (let i = 0; i < count; i += 1) {
      const note = `${prefix}Notes/N${String(i).padStart(2, '0')}.md`;
      await seed(note); notes.push(note);
    }
    await seed(path, { note_kind: 'moc', title: 'Map' }, '# Map\n' + notes.map(note => `[[${note}]]`).join('\n'));
    return { path, notes };
  };
  try {
    const fs = new FileSystemService(root), access = new ScopeAccessPolicy();
    await run({ fs, access, root, seed, setup, wiki: new LlmWikiService(fs, access, new ReferenceService(fs, access)) });
  } finally {
    vi.restoreAllMocks();
    const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

test('rebalance resolves Markdown relative to the authored MOC, not a root namesake', async () => {
  await fixture(async ({ wiki, seed, setup }) => {
    const { path, notes } = await setup();
    await seed('Maps/Sub/Exact#1.md');
    await seed('Sub/Exact#1.md');
    await seed(path, { note_kind: 'moc', title: 'Map' }, '# Map\n[Exact](<./Sub/Exact%231.md>)\n' + notes.map(note => `[[${note}]]`).join('\n'));
    const result = await wiki.mocRebalance(undefined, path, 4, 30, 16000, 3);
    expect(result.memberTotal).toBe(5);
    const entries = result.branches.flatMap((branch: any) => branch.entries);
    expect(entries.map((entry: any) => entry.path)).toContain('Maps/Sub/Exact#1.md');
    expect(entries.map((entry: any) => entry.path)).not.toContain('Sub/Exact#1.md');
  });
});

test('rebalance uses bounded root reads and one fresh metadata admission per identity', async () => {
  await fixture(async ({ wiki, fs, seed, setup, root }) => {
    const { path, notes } = await setup();
    await seed('Notes/Support.md', { title: 'Support' });
    for (const note of notes) await seed(note, { depends_on: ['[[Notes/Support.md]]'] });
    const raw = await readFile(join(root, path), 'utf8');
    const read = vi.spyOn(fs, 'readNote'), metadata = vi.spyOn(fs, 'readNoteMetadata'), revision = vi.spyOn(fs, 'readNoteRevision');
    await wiki.mocRebalance(undefined, path, 4, 30, 16000, 3);
    expect(read.mock.calls).toEqual([[path, MAX_NOTE_CONTENT_BYTES]]);
    expect(metadata.mock.calls.filter(([paths]) => paths.includes('Notes/Support.md'))).toHaveLength(1);
    expect(metadata.mock.calls.every(([, , options]) => options?.fresh && options.strict && options.maxBytes === MAX_NOTE_CONTENT_BYTES)).toBe(true);
    for (const target of [path, ...notes, 'Notes/Support.md']) expect(revision).toHaveBeenCalledWith(target, MAX_NOTE_CONTENT_BYTES);
    expect(await readFile(join(root, path), 'utf8')).toBe(raw);
  });
});

test.each(['member', 'relation', 'destination'])('rebalance rejects %s drift after fresh admission', async kind => {
  await fixture(async ({ wiki, fs, seed, setup }) => {
    const { path, notes } = await setup();
    const target = kind === 'member' ? notes[0]! : kind === 'relation' ? 'Notes/Support.md' : 'Maps/Map - Domain- Group.md';
    if (kind === 'relation') {
      await seed(target, { title: 'Original support' });
      await seed(notes[0]!, { depends_on: [`[[${target}]]`] });
    } else if (kind === 'destination') await seed(target, { note_kind: 'moc' });
    const read = fs.readNoteMetadata.bind(fs); let changed = false;
    vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
      const result = await read(...args);
      if (!changed && args[0].includes(target)) { changed = true; await seed(target, { title: 'CHANGED' }); }
      return result;
    });
    await expect(wiki.mocRebalance(undefined, path, 4, 30, 16000, 3)).rejects.toThrow(/changed|refresh|unavailable/i);
  });
});

test.each(['hidden', 'deleted', 'root'])('rebalance rejects %s changes even on compact responses', async change => {
  await fixture(async ({ wiki, fs, seed, setup, root }) => {
    const { path, notes } = await setup();
    const read = fs.readNoteMetadata.bind(fs); let changed = false;
    vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
      const result = await read(...args);
      if (!changed && args[0].includes(notes[0]!)) {
        changed = true;
        if (change === 'deleted') await rm(join(root, notes[0]!));
        else if (change === 'root') await seed(path, { note_kind: 'moc', title: 'Changed root' });
        else await seed(notes[0]!, { moderation_status: 'hidden' });
      }
      return result;
    });
    await expect(wiki.mocRebalance(undefined, path, 4, 30, 700, 3)).rejects.toThrow(/changed|refresh|unavailable/i);
  });
});

test('inspection cannot admit more than 256 metadata identities', async () => {
  await fixture(async ({ wiki, fs, seed, setup }) => {
    const { path, notes } = await setup('', 'Map.md', 13);
    for (const [i, note] of notes.entries()) await seed(note, { depends_on: Array.from({ length: 20 }, (_, j) => `[[Missing/R${i}N${j}.md]]`) });
    const createResolver = fs.createNoteReferenceResolver.bind(fs);
    // Model paths removed after enumeration without creating hundreds of files.
    // Metadata reads remain real and return no note for these missing identities.
    vi.spyOn(fs, 'createNoteReferenceResolver').mockImplementation((...args) => {
      const resolve = createResolver(...args);
      return async (target, options) => target.startsWith('Missing/') ? [target] : resolve(target, options);
    });
    const metadata = vi.spyOn(fs, 'readNoteMetadata');
    await expect(wiki.mocRebalance(undefined, path, 4, 30, 16000, 3)).rejects.toThrow(/inspection budget/i);
    expect(metadata).toHaveBeenCalledTimes(256);
  });
});

test('request-local reference lookup reads alias metadata only through the supplied reader', async () => {
  await fixture(async ({ fs, seed, setup }) => {
    const { path, notes } = await setup();
    await seed(notes[0]!, { aliases: ['A precise term'] });
    await seed('Private.md', { aliases: ['A precise term'] });
    const reader = vi.fn(async (target: string) => (await fs.readNoteMetadata([target], () => true, { fresh: true, strict: true, maxBytes: MAX_NOTE_CONTENT_BYTES }))[0]);
    const resolve = fs.createNoteReferenceResolver(target => target !== 'Private.md', reader);
    expect(await resolve(notes[0]!, { sourcePath: path })).toEqual([notes[0]]);
    expect(await resolve('../Notes/N00.md', { sourcePath: path, syntax: 'markdown' })).toEqual([notes[0]]);
    expect(reader).not.toHaveBeenCalled();
    expect(await resolve('A precise term', { sourcePath: path })).toEqual([notes[0]]);
    expect(reader.mock.calls.map(([target]) => target)).not.toContain('Private.md');
    const reads = reader.mock.calls.length;
    await resolve('A precise term', { sourcePath: path });
    expect(reader).toHaveBeenCalledTimes(reads);
  });
});

test.each(['member', 'relation'])('indexed %s alias must still match the admitted metadata', async kind => {
  await fixture(async ({ seed, setup, root, access }) => {
    const { path, notes } = await setup();
    const target = kind === 'member' ? notes[0]! : 'Notes/Support.md';
    await seed(target, { aliases: ['Topic'] });
    if (kind === 'member') await seed(path, { note_kind: 'moc', title: 'Map' }, '# Map\n[[Topic]]\n' + notes.slice(1).map(note => `[[${note}]]`).join('\n'));
    else await seed(notes[0]!, { depends_on: ['[[Topic]]'] });
    const filter = new PathFilter(), frontmatter = new FrontmatterHandler();
    const index = new VaultMetadataIndex(root, filter, frontmatter);
    try {
      const resolve = index.resolveNoteReference.bind(index); let changed = false;
      vi.spyOn(index, 'resolveNoteReference').mockImplementation(async (...args) => {
        const result = await resolve(...args);
        if (!changed && args[0] === 'Topic') { changed = true; await seed(target, { aliases: ['Different identity'] }); }
        return result;
      });
      const fs = new FileSystemService(root, filter, frontmatter, undefined, index);
      const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
      await expect(wiki.mocRebalance(undefined, path, 4, 30, 16000, 3)).rejects.toThrow(/identity.*changed|refresh/i);
    } finally { await index.close(); }
  });
});

test('Windows separators are normalized in parent and draft links', async () => {
  await fixture(async ({ wiki, setup }) => {
    const { path } = await setup();
    const result = await wiki.mocRebalance(undefined, path.replaceAll('/', '\\'), 4, 30, 16000, 3);
    const proposal = result.branches[0].suggestedSubMoc;
    expect(proposal.frontmatter.moc_parent).toBe(`[[${path}]]`);
    expect(proposal.draftMarkdown).not.toContain('\\');
  });
});

test('root parent and member links resolve exactly despite nested namesakes', async () => {
  await fixture(async ({ wiki, fs, seed, setup }) => {
    const { notes } = await setup();
    await seed('Map.md', { note_kind: 'moc', title: 'Map' }, '# Map\n[[./Node.md]]\n' + notes.map(note => `[[${note}]]`).join('\n'));
    await seed('Other/Map.md', { note_kind: 'moc' });
    await seed('Node.md'); await seed('Other/Node.md');
    const result = await wiki.mocRebalance(undefined, 'Map.md', 4, 30, 16000, 3);
    const proposal = result.branches[0].suggestedSubMoc;
    expect(await fs.findPathForWikiLink(proposal.frontmatter.moc_parent, undefined, proposal.path)).toEqual(['Map.md']);
    const links = extractObsidianLinkOccurrences(proposal.draftMarkdown);
    const resolved = [];
    for (const link of links) resolved.push(...await (link.link.startsWith('[[')
      ? fs.findPathForWikiLink(link.target, undefined, proposal.path)
      : fs.findPathForMarkdownLink(link.target, proposal.path)));
    expect(resolved).toEqual(['Map.md', 'Node.md', ...notes]);
  });
});

test.each([false, true])('rebalance collision visible=%s remains conditional and private', async visible => {
  await fixture(async ({ wiki, seed, setup }) => {
    const { path } = await setup(), target = 'Maps/Map - Domain- Group.md';
    await seed(target, { note_kind: 'moc', title: 'COLLISION-MARKER', ...(visible ? {} : { moderation_status: 'hidden' }) });
    const result = await wiki.mocRebalance(undefined, path, 4, 30, 16000, 3);
    const proposal = result.branches[0].suggestedSubMoc;
    expect(proposal.targetExists).toBe(visible);
    if (!visible) expect(proposal.expectedRevision).toBe('missing');
    else expect(proposal.nextAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: target } });
    expect(JSON.stringify(result)).not.toContain('COLLISION-MARKER');
  });
});

test('private rebalance drafts contain safe physical links, not scope URIs or injected aliases', async () => {
  await fixture(async ({ wiki, fs, seed, setup }) => {
    const prefix = '_scopes/models/codex/', { path, notes } = await setup(prefix);
    await seed(notes[0]!, { title: 'Bad]]\n[[Injected]]' });
    const result = await wiki.mocRebalance({ accountId: 'worker', modelId: 'codex', agentId: 'worker', role: 'agent' }, path, 4, 30, 16000, 3);
    const branch = result.branches[0], proposal = branch.suggestedSubMoc;
    expect(proposal.frontmatter.moc_parent).toBe(`[[${path}]]`);
    expect(proposal.draftMarkdown).not.toContain('scope://');
    const targets = extractObsidianLinkOccurrences(proposal.draftMarkdown).map(link => link.target);
    expect(targets).toEqual([path, ...notes]);
    for (const target of targets) expect(await fs.findPathForWikiLink(target)).toEqual([target]);
  });
});

test('a special parent filename gets Markdown navigation and an explicit hierarchy warning', async () => {
  await fixture(async ({ wiki, fs, setup }) => {
    const { path } = await setup('', 'Map#1.md');
    const result = await wiki.mocRebalance(undefined, path, 4, 30, 16000, 3);
    const proposal = result.branches[0].suggestedSubMoc;
    expect(proposal.frontmatter).not.toHaveProperty('moc_parent');
    expect(proposal.parentLinkWarning).toMatch(/moc_parent|filename/i);
    const link = extractObsidianLinkOccurrences(proposal.draftMarkdown)[0]!;
    expect(await fs.findPathForMarkdownLink(link.target, proposal.path)).toEqual([path]);
  });
});

test.each([700, 1500, 3000, 5000, 8000, 16000])('budget %i keeps draft membership and dependency endpoints synchronized', async maxChars => {
  await fixture(async ({ wiki, seed, setup }) => {
    const { path, notes } = await setup('', 'Map.md', 24);
    await seed(notes[0]!, { depends_on: [`[[${notes[23]}]]`] });
    let sawTrimmedBranch = false;
    {
      const result = await wiki.mocRebalance(undefined, path, 4, 30, maxChars, 3);
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(maxChars);
      const displayed = new Set<string>();
      for (const branch of result.branches || []) {
        if (branch.entriesTruncated) sawTrimmedBranch = true;
        const links = extractObsidianLinkOccurrences(branch.suggestedSubMoc.draftMarkdown).map(link => link.target);
        expect(links).toEqual([path, ...branch.entries.map((entry: any) => entry.path)]);
        for (const entry of branch.entries) displayed.add(entry.path);
      }
      for (const dependency of result.crossBranchDependencies || []) {
        expect(displayed.has(dependency.from)).toBe(true);
        expect(displayed.has(dependency.to)).toBe(true);
      }
    }
    if (maxChars === 5000) expect(sawTrimmedBranch).toBe(true);
  });
});

test('compact response remains bounded when the root path itself is long', async () => {
  await fixture(async ({ wiki, fs, seed, setup }) => {
    const { notes } = await setup();
    const path = Array.from({ length: 7 }, () => 'x'.repeat(70)).join('/') + '/Map.md';
    await seed(path, { note_kind: 'moc', title: 'Map' }, '# Map\n' + notes.map(note => `[[${note}]]`).join('\n'));
    const result = await wiki.mocRebalance(undefined, path, 4, 30, 700, 3);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(700);
    expect(result.root.revision).toBe(await fs.readNoteRevision(path));
    expect(result.rootPathOmitted).toBe(true);
    expect(result.nextStep).toMatch(/original.*path/i);
  });
});

test('MCP exposes a bounded read-only rebalance plan through the fixed tool surface', async () => {
  await fixture(async ({ setup, root }) => {
    const { path } = await setup();
    const server = createServer(root, { version: 'rebalance-coherence' });
    const client = new Client({ name: 'rebalance-coherence', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(ct), server.connect(st)]);
      expect((await client.listTools()).tools).toHaveLength(5);
      for (const maxChars of [700, 4000, 16000]) {
        const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.moc_rebalance', arguments: { path, saturationThreshold: 3, maxChars, prettyPrint: true } } });
        expect(result.isError).not.toBe(true);
        const text = (result.content as any)[0].text;
        expect(text.length).toBeLessThanOrEqual(maxChars);
        expect(JSON.parse(text).mutates).toBe(false);
      }
    } finally { await client.close(); await server.close(); }
  });
});
