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

async function fixture(run: (wiki: LlmWikiService, fs: FileSystemService, access: ScopeAccessPolicy, seed: (path: string, fields?: Record<string, unknown>) => Promise<string>, root: string) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-moc-snapshot-', root = await mkdtemp(join(base, prefix));
  const seed = async (path: string, fields: Record<string, unknown> = {}) => {
    const raw = `---\n${stringify({ llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', domain: 'Research', ...fields })}---\n# Evidence\nKeep source content.\n`;
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), raw); return raw;
  };
  try {
    const fs = new FileSystemService(root), access = new ScopeAccessPolicy();
    await run(new LlmWikiService(fs, access, new ReferenceService(fs, access)), fs, access, seed, root);
  } finally {
    vi.restoreAllMocks();
    const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

test.each([
  ['A/B', 'A:B'],
  ['X'.repeat(100) + 'First', 'X'.repeat(100) + 'Second'],
])('candidate paths distinguish lossy labels %s and %s', async (first, second) => {
  await fixture(async (wiki, fs, _access, seed) => {
    await seed('First.md', { domain: first });
    await seed('Second.md', { domain: second });
    const result = await wiki.mocCandidates(undefined, 10, 16000);
    expect(result.candidates).toHaveLength(2);
    const paths = result.candidates.map(item => String(item.suggestedPath).toLowerCase());
    expect(new Set(paths).size).toBe(2);
    for (const item of result.candidates) {
      expect(item.pathDisambiguated).toBe(true);
      expect(item.creationPlan).toMatchObject({ endpointId: 'notes.write', arguments: { path: item.suggestedPath, expectedRevision: 'missing' } });
      expect(await fs.noteExists(String(item.suggestedPath))).toBe(false);
    }
    const limited = await wiki.mocCandidates(undefined, 1, 16000);
    expect(limited.candidates[0]?.suggestedPath).toBe(result.candidates[0]?.suggestedPath);
  });
});

test('candidate identity includes grouping kind even when titles match', async () => {
  await fixture(async (wiki, _fs, _access, seed) => {
    await seed('Domain.md', { domain: 'Research' });
    await seed('Subject.md', { domain: '', subject_terms: ['Research'] });
    const { candidates } = await wiki.mocCandidates(undefined, 10, 16000);
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map(item => item.suggestedPath)).size).toBe(2);
    expect(candidates.every(item => item.pathDisambiguated)).toBe(true);
  });
});

test.each(['visible', 'hidden'])('candidate rechecks %s disambiguated destinations without overwriting', async state => {
  await fixture(async (wiki, _fs, _access, seed, root) => {
    await seed('First.md', { domain: 'A/B' });
    await seed('Second.md', { domain: 'A:B' });
    const target = String((await wiki.mocCandidates(undefined, 10, 16000)).candidates[0]!.suggestedPath);
    const raw = await seed(target, { note_kind: 'moc', ...(state === 'hidden' && { moderation_status: 'hidden' }), title: 'EXISTING-PRIVATE-MARKER' });
    const result = await wiki.mocCandidates(undefined, 10, 16000);
    const candidate = result.candidates.find(item => item.suggestedPath === target)!;
    expect(candidate.targetExists).toBe(state === 'visible');
    expect(candidate.creationPlan).toMatchObject(state === 'visible'
      ? { endpointId: 'notes.read', arguments: { path: target } }
      : { endpointId: 'notes.write', arguments: { path: target, expectedRevision: 'missing' } });
    expect(JSON.stringify(result)).not.toContain('EXISTING-PRIVATE-MARKER');
    expect(await readFile(join(root, target), 'utf8')).toBe(raw);
  });
});

test('colliding public candidates do not rename a non-colliding private-scope proposal', async () => {
  await fixture(async (wiki, _fs, access, seed) => {
    await seed('First.md', { domain: 'A/B' });
    await seed('Second.md', { domain: 'A:B' });
    await seed('_scopes/models/codex/Private.md', { domain: 'A/B' });
    const principal = { accountId: 'worker', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
    const result = await wiki.mocCandidates(principal, 10, 16000);
    expect(result.candidates).toHaveLength(3);
    const privateItem = result.candidates.find(item => item.notePaths.includes(access.toPublicPath('_scopes/models/codex/Private.md')))!;
    expect(privateItem.suggestedPath).toBe(access.toPublicPath('_scopes/models/codex/Knowledge/MOCs/A-B.md'));
    expect(privateItem.pathDisambiguated).toBeUndefined();
    const anonymous = await wiki.mocCandidates(undefined, 10, 16000);
    expect(JSON.stringify(anonymous)).not.toContain('Private');
    expect(anonymous.candidates.map(item => item.suggestedPath)).toEqual(result.candidates.filter(item => item !== privateItem).map(item => item.suggestedPath));
  });
});

test.each(['edited', 'hidden', 'deleted', 'map'])('rejects %s source after the graph snapshot', async change => {
  await fixture(async (wiki, _fs, _access, seed, root) => {
    await seed('Note.md', { title: 'Original title' });
    const graphHealth = wiki.graphHealth.bind(wiki);
    vi.spyOn(wiki, 'graphHealth').mockImplementation(async (...args) => {
      const graph = await graphHealth(...args);
      if (change === 'deleted') await rm(join(root, 'Note.md'));
      else await seed('Note.md', { title: 'New title', ...(change === 'hidden' && { moderation_status: 'hidden' }), ...(change === 'map' && { note_kind: 'moc' }) });
      return graph;
    });
    await expect(wiki.mocCandidates(undefined, 10, 16000)).rejects.toThrow(/changed|unavailable|refresh/i);
  });
});

test('uses bounded exact metadata admission instead of a second whole-vault query scan', async () => {
  await fixture(async (wiki, fs, _access, seed, root) => {
    const raw = await seed('Note.md');
    const query = vi.spyOn(fs, 'queryNotes'), metadata = vi.spyOn(fs, 'readNoteMetadata');
    const graphHealth = wiki.graphHealth.bind(wiki); let graphQueries = 0;
    vi.spyOn(wiki, 'graphHealth').mockImplementation(async (...args) => {
      const result = await graphHealth(...args); graphQueries = query.mock.calls.length; return result;
    });
    const result = await wiki.mocCandidates(undefined, 10, 16000);
    expect(result.candidates).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(graphQueries);
    expect(metadata.mock.calls.some(([paths, _access, options]) => paths.includes('Note.md') && options?.fresh && options.strict && typeof options.maxBytes === 'number')).toBe(true);
    expect(await readFile(join(root, 'Note.md'), 'utf8')).toBe(raw);
  });
});

test('same-topic global, community, model and agent knowledge stay in separate scopes', async () => {
  await fixture(async (wiki, fs, access, seed) => {
    const principal = { accountId: 'worker', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
    const roots = ['', 'Community', '_scopes/models/codex', '_scopes/agents/worker'];
    for (const root of roots) await seed(`${root ? root + '/' : ''}Note.md`);
    await seed('Other/Note.md', { note_kind: 'moc' });
    await seed('_scopes/users/host/Secret.md', { title: 'HOST-SECRET' });
    const result = await wiki.mocCandidates(principal, 10, 16000);
    expect(result.candidates).toHaveLength(4);
    for (const root of roots) {
      const notePath = access.toPublicPath(`${root ? root + '/' : ''}Note.md`);
      const target = access.toPublicPath(`${root ? root + '/' : ''}Knowledge/MOCs/Research.md`);
      const candidate = result.candidates.find(item => item.notePaths.includes(notePath));
      expect(candidate).toMatchObject({ suggestedPath: target, notePaths: [notePath], creationPlan: { endpointId: 'notes.write', arguments: { path: target, expectedRevision: 'missing' } } });
      const links = extractObsidianLinkOccurrences(String(candidate?.draftMarkdown));
      expect(links).toHaveLength(1);
      const link = links[0]!, source = access.resolveExternalPath(target, principal);
      const resolved = await (link.link.startsWith('[[') ? fs.findPathForWikiLink(link.target, undefined, source) : fs.findPathForMarkdownLink(link.target, source));
      expect(resolved).toEqual([`${root ? root + '/' : ''}Note.md`]);
      expect(String(candidate?.draftMarkdown)).not.toContain('scope://');
    }
    expect(JSON.stringify(result)).not.toContain('HOST-SECRET');
    expect((await wiki.mocCandidates(undefined, 10, 16000)).candidates).toHaveLength(2);
  });
});

test('source title and grouping text cannot insert extra draft links', async () => {
  await fixture(async (wiki, fs, _access, seed) => {
    await seed('Note.md', { title: 'Alias]]\n[[Forged]]', domain: 'Research\n[[Injected]]' });
    const result = await wiki.mocCandidates(undefined, 10, 16000);
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0]!, links = extractObsidianLinkOccurrences(String(candidate.draftMarkdown));
    expect(links).toHaveLength(1);
    expect(await fs.findPathForMarkdownLink(links[0]!.target, String(candidate.suggestedPath))).toEqual(['Note.md']);
  });
});

test('reserved wikilink characters use a resolvable relative Markdown link', async () => {
  await fixture(async (wiki, fs, _access, seed) => {
    await seed('Note#1.md');
    const result = await wiki.mocCandidates(undefined, 10, 16000);
    const candidate = result.candidates[0]!;
    const links = extractObsidianLinkOccurrences(String(candidate.draftMarkdown));
    expect(links).toHaveLength(1);
    const resolved = await fs.findPathForMarkdownLink(links[0]!.target, String(candidate.suggestedPath));
    expect(resolved).toEqual(['Note#1.md']);
  });
});

test('fallback child-folder links cannot resolve to a root namesake', async () => {
  await fixture(async (wiki, fs, _access, seed) => {
    const source = 'Knowledge/MOCs/Sub/Note#1.md';
    await seed(source);
    await seed('Sub/Note#1.md', { note_kind: 'moc' });
    const result = await wiki.mocCandidates(undefined, 10, 16000);
    const candidate = result.candidates[0]!;
    const [link] = extractObsidianLinkOccurrences(String(candidate.draftMarkdown));
    expect(await fs.findPathForMarkdownLink(link!.target, String(candidate.suggestedPath))).toEqual([source]);
  });
});

test('draft links preserve exact extensions when supported note types share a stem', async () => {
  await fixture(async (wiki, fs, _access, seed) => {
    const paths = ['Knowledge/Proof.md', 'Knowledge/Proof.txt', 'Knowledge/Proof.markdown'];
    for (const path of paths) await seed(path);
    const items = await Promise.all(paths.map(async path => ({ path, revision: await fs.readNoteRevision(path) })));
    vi.spyOn(wiki, 'graphHealth').mockResolvedValue({ mocCoverage: { uncoveredKnowledge: { items, total: items.length, truncated: false } } } as any);
    const candidate = (await wiki.mocCandidates(undefined, 10, 16000)).candidates[0]!;
    const links = extractObsidianLinkOccurrences(String(candidate.draftMarkdown));
    expect(links).toHaveLength(3);
    for (const [i, link] of links.entries()) {
      expect(await fs.findPathForWikiLink(link.target, undefined, String(candidate.suggestedPath))).toEqual([candidate.orderedEntries[i]!.path]);
    }
  });
});

test('final snapshot validation bounds file reads after metadata admission', async () => {
  await fixture(async (wiki, fs, _access, seed) => {
    await seed('Note.md');
    const readRevision = vi.spyOn(fs, 'readNoteRevision');
    expect((await wiki.mocCandidates(undefined, 10, 16000)).candidates).toHaveLength(1);
    expect(readRevision).toHaveBeenCalledWith('Note.md', MAX_NOTE_CONTENT_BYTES);
  });
});

test.each([false, true])('destination collision visible=%s never creates an overwrite plan', async visible => {
  await fixture(async (wiki, fs, _access, seed, root) => {
    await seed('Note.md');
    const raw = await seed('Knowledge/MOCs/Research.md', { note_kind: 'moc', ...(visible ? {} : { moderation_status: 'hidden', title: 'SECRET-TARGET' }) });
    const result = await wiki.mocCandidates(undefined, 10, 16000);
    const candidate = result.candidates[0]!;
    expect(candidate.targetExists).toBe(visible);
    expect(candidate.creationPlan.endpointId).toBe(visible ? 'notes.read' : 'notes.write');
    if (!visible) {
      expect(candidate.creationPlan.arguments).toMatchObject({ expectedRevision: 'missing' });
      await expect(fs.writeNote(candidate.creationPlan.arguments as any)).rejects.toThrow();
    }
    expect(await readFile(join(root, 'Knowledge/MOCs/Research.md'), 'utf8')).toBe(raw);
    expect(JSON.stringify(result)).not.toContain('SECRET-TARGET');
  });
});

test('final validation rejects drift after metadata admission', async () => {
  await fixture(async (wiki, fs, _access, seed) => {
    await seed('Note.md');
    const readRevision = fs.readNoteRevision.bind(fs);
    vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (path, maxBytes) => {
      if (path === 'Note.md') await seed('Note.md', { title: 'Changed during proposal construction' });
      return readRevision(path, maxBytes);
    });
    await expect(wiki.mocCandidates(undefined, 10, 16000)).rejects.toThrow(/changed|unavailable|refresh/i);
  });
});

test.each([512, 1200, 4000, 7000, 16000])('complete candidate response fits %i characters', async maxChars => {
  await fixture(async (wiki, _fs, _access, seed) => {
    for (let i = 0; i < 8; i += 1) await seed(`Note${i}.md`, { domain: `Domain${i}` });
    const result = await wiki.mocCandidates(undefined, 10, maxChars);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(maxChars);
    if (maxChars === 16000) expect(result.candidates.length).toBeGreaterThan(0);
    if (result.candidates.length < 8) expect(result.truncated).toBe(true);
  });
});

test('graph admission and returned order carry the same real source revision', async () => {
  await fixture(async (wiki, fs, _access, seed) => {
    await seed('Note.md');
    const revision = await fs.readNoteRevision('Note.md');
    const graph = await wiki.graphHealth(undefined, 20, 16000);
    expect(graph.mocCoverage.uncoveredKnowledge.items).toEqual([{ path: 'Note.md', revision }]);
    const result = await wiki.mocCandidates(undefined, 10, 16000);
    expect(result.candidates[0]?.orderedEntries).toEqual([expect.objectContaining({ path: 'Note.md', revision })]);
  });
});

test('a capped group is explicitly partial even when all proposed groups fit', async () => {
  await fixture(async (wiki, fs, _access, seed) => {
    // Supply a bounded graph category backed by real source bytes; other graph
    // dashboard categories do not determine this grouping-cap contract.
    const items = [];
    for (let i = 0; i < 14; i += 1) {
      const path = `Note${i}.md`; await seed(path);
      items.push({ path, revision: await fs.readNoteRevision(path) });
    }
    vi.spyOn(wiki, 'graphHealth').mockResolvedValue({ mocCoverage: { uncoveredKnowledge: { items, total: 14, truncated: false } } } as any);
    const result = await wiki.mocCandidates(undefined, 10, 16000);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.orderedEntries).toHaveLength(12);
    expect(result.candidates[0]?.entriesTruncated).toBe(true);
    expect(result.truncated).toBe(true);
  });
});

test('authored priority selects membership before the cap and ignores sample arrival order', async () => {
  await fixture(async (wiki, fs, _access, seed) => {
    const items = [];
    for (let i = 0; i < 14; i += 1) {
      const path = `Note${String(i).padStart(2, '0')}.md`;
      await seed(path, { nav_order: i === 13 ? 0 : 10, title: `Title${String(13 - i).padStart(2, '0')}` });
      items.push({ path, revision: await fs.readNoteRevision(path) });
    }
    // Isolate selection from unrelated graph dashboard pruning; source metadata
    // and both revision checks still read the actual fixture files.
    const graph = vi.spyOn(wiki, 'graphHealth');
    graph.mockResolvedValue({ mocCoverage: { uncoveredKnowledge: { items, total: 14, truncated: false } } } as any);
    const first = (await wiki.mocCandidates(undefined, 10, 16000)).candidates[0]!;
    expect(first.orderedEntries).toHaveLength(12);
    expect(first.notePaths).toEqual(Array.from({ length: 12 }, (_, i) => `Note${String(13 - i).padStart(2, '0')}.md`));
    graph.mockResolvedValue({ mocCoverage: { uncoveredKnowledge: { items: [...items].reverse(), total: 14, truncated: false } } } as any);
    const reversed = (await wiki.mocCandidates(undefined, 10, 16000)).candidates[0]!;
    expect(reversed.notePaths).toEqual(first.notePaths);
  });
});

test.each([9, 12, 14])('all MOC projections retain the same bounded membership from %i entries', async count => {
  await fixture(async (wiki, fs, _access, seed) => {
    const items = [];
    for (let i = 0; i < count; i += 1) {
      const path = `Knowledge/Note${String(i).padStart(2, '0')}.md`;
      await seed(path, { nav_order: i });
      items.push({ path, revision: await fs.readNoteRevision(path) });
    }
    vi.spyOn(wiki, 'graphHealth').mockResolvedValue({ mocCoverage: { uncoveredKnowledge: { items, total: count, truncated: false } } } as any);
    const result = await wiki.mocCandidates(undefined, 10, 16000);
    const candidate = result.candidates[0]!;
    const targets = extractObsidianLinkOccurrences(String(candidate.draftMarkdown)).map(link => link.target);
    expect(targets).toEqual(candidate.notePaths);
    expect(candidate.orderedEntries.map((entry: any) => entry.path)).toEqual(targets);
    expect(candidate.creationPlan.arguments.content).toBe(candidate.draftMarkdown);
    expect(candidate.entryTotal).toBe(count);
    expect(candidate.entriesTruncated).toBe(count > 12);
    expect(result.truncated).toBe(count > 12);
    expect(targets).toHaveLength(Math.min(count, 12));
    for (const maxChars of [512, 1200, 4000]) {
      const bounded = await wiki.mocCandidates(undefined, 10, maxChars);
      expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(maxChars);
      if (!bounded.candidates.length) expect(bounded.truncated).toBe(true);
      for (const item of bounded.candidates) {
        expect(extractObsidianLinkOccurrences(String(item.draftMarkdown)).map(link => link.target)).toEqual(item.notePaths);
      }
    }
  });
});

test('MCP candidate discovery preserves the fixed surface, budgets and source bytes', async () => {
  await fixture(async (_wiki, _fs, _access, seed, root) => {
    const raw = await seed('Note.md');
    const server = createServer(root, { version: 'moc-candidate-snapshot' });
    const client = new Client({ name: 'moc-candidate-snapshot', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(ct), server.connect(st)]);
      expect((await client.listTools()).tools).toHaveLength(5);
      for (const maxChars of [512, 4000, 16000]) {
        const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.moc_candidates', arguments: { maxChars, prettyPrint: true } } });
        expect(result.isError).not.toBe(true);
        const text = (result.content as any)[0].text;
        expect(text.length).toBeLessThanOrEqual(maxChars);
        if (maxChars === 16000) expect(JSON.parse(text).candidates[0].creationPlan.arguments).toMatchObject({ expectedRevision: 'missing' });
      }
      expect(await readFile(join(root, 'Note.md'), 'utf8')).toBe(raw);
    } finally { await client.close(); await server.close(); }
  });
});
