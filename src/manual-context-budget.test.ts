import { expect, test } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import matter from 'gray-matter';

const originals = JSON.parse(await readFile('tests/fixtures/manual-context-originals.json', 'utf8'));
const group = (path: string) => path === 'AGENTS.md' || path.startsWith('docs/agent-rules/') ? 'repository'
  : path === 'README.md' || path.startsWith('docs/getting-started/') ? 'getting-started' : 'client';
const normalize = (text: string) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replaceAll('`', '').replace(/\s+/g, ' ').trim();
// User-approved 2026-09-21 workflow amendment. The immutable source bytes/hash
// stay unchanged; only this exact superseded requirement has a new expectation.
const currentProse = (path: string, text: string) => {
  if (path === 'AGENTS.md') return text.replace(
    '5. Run targeted tests, `npm run build`, the full `npm test`, and\n   `git diff --check`.',
    '5. Use [risk-scoped validation](validation.md): targets during work, full regression at integration.\n   Run `npm run build` for code changes and `git diff --check` before staging.',
  ).replace(
    'Only five MCP tools are stable: `orient_wiki`, `get_agent_pulse`,\n`list_active_capabilities`, `search_capabilities`, and `call_endpoint`.\nOther names are dynamic endpoint IDs. Use `call_endpoint`, not documented REST\nURLs; never bypass locked/hidden endpoints with obsolete internal tool names.',
    'Five control tools remain stable: `orient_wiki`, `get_agent_pulse`,\n`list_active_capabilities`, `search_capabilities`, and `call_endpoint`.\nDirect recording tools also include `get_wiki_policy`, `memory_brief`,\n`search_notes`, `read_note`, `list_journal_entries`, `read_journal_entry`,\n`create_journal_entry`, `update_journal_entry`, `create_note`, `patch_note`,\nand `update_note_properties`. Use private journal tools for an agent\'s own\nexperience; use note tools for authorized shared research and Wiki knowledge.\nSearch/read before writing, use the current revision for edits, and reread the\nsame item afterward. Other names are dynamic endpoint IDs; use `call_endpoint`\nfor those advanced endpoints, not documented REST URLs. Never bypass\nlocked/hidden endpoints with obsolete internal tool names.',
  );
  if (path === 'plugins/mcpvault-local/skills/mcpvault-agent/SKILL.md') return text.replace(
    'Only five MCP tools exist: `orient_wiki`, `get_agent_pulse`,\n`list_active_capabilities`, `search_capabilities`, and `call_endpoint`.',
    'The five control tools are `orient_wiki`, `get_agent_pulse`, `list_active_capabilities`, `search_capabilities`, and `call_endpoint`.\nDirect recording tools include `create_journal_entry` for private logs and `create_note` for authorized shared research or Wiki knowledge.',
  );
  return text;
};

// Admission test precedes chapter promotion. Count blank lines and metadata, too.
test.each(['AGENTS.md', 'README.md', 'plugins/mcpvault-local/skills/mcpvault-agent/SKILL.md'])(
  '%s offers a physical entry chapter of at most fifty lines', async path => {
    const lines = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n').split('\n');
    if (lines.at(-1) === '') lines.pop();
    expect(lines.length).toBeLessThanOrEqual(50);
    expect(lines.every(line => line.length <= 240)).toBe(true);
  },
);

test('manual inventory retains exact source evidence and every original prose block', async () => {
  const catalog = JSON.parse(await readFile('docs/context-manuals.json', 'utf8'));
  expect(catalog.version).toBe(1);
  expect(catalog.authority).toBe('discovery-only');
  // Exact tree coverage and unique IDs below replace a stale fixed chapter count.
  const texts = new Map<string, string>();
  for (const card of catalog.chapters) texts.set(card.path, matter(await readFile(card.path, 'utf8')).content);
  for (const source of originals.files) {
    const bytes = Buffer.from(source.base64, 'base64');
    expect(bytes.length).toBe(source.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.sha256);
    const original = matter(bytes.toString('utf8')).content.replaceAll('\r\n', '\n');
    const combined = [...texts].filter(([path]) => group(path) === group(source.path)).map(([, text]) => text).join('\n');
    for (const block of original.split(/\n\s*\n/)) {
      if (!block.trim() || /^#+ /.test(block)) continue;
      expect(normalize(combined), `${source.path}: ${block.slice(0, 80)}`).toContain(normalize(currentProse(source.path, block)));
    }
    for (const heading of original.match(/^#{1,6} .+$/gm) ?? []) expect(combined).toContain(heading);
    for (const code of original.matchAll(/^(`{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm)) expect(combined).toContain(code[0].trimEnd());
  }
});

test('each chapter has bounded content, scoped discovery metadata and resolvable navigation', async () => {
  const catalog = JSON.parse(await readFile('docs/context-manuals.json', 'utf8'));
  const ids = new Set();
  for (const card of catalog.chapters) {
    expect(ids.has(card.id)).toBe(false); ids.add(card.id);
    const raw = (await readFile(card.path, 'utf8')).replaceAll('\r\n', '\n');
    const lines = raw.split('\n'); if (lines.at(-1) === '') lines.pop();
    expect(lines.length, card.path).toBeLessThanOrEqual(50);
    expect(lines.every(line => line.length <= 240), card.path).toBe(true);
    const parsed = matter(raw), meta = parsed.data.metadata ?? parsed.data;
    expect(meta.id).toBe(card.id);
    for (const key of ['description', 'useWhen', 'skipWhen', 'phase', 'project', 'genre', 'domain', 'position', 'ruleVersion'])
      expect(typeof card[key], `${card.path}:${key}`).toBe('string');
    expect(card.keywords.length).toBeGreaterThan(2);
    expect(card.sourceCommit).toBe(originals.sourceCommit);
    expect(originals.files.some((source: any) => source.path === card.sourcePath && source.sha256 === card.sourceHash)).toBe(true);
    expect(card.sourceFamily).toBe(card.sourcePath);
    const source = originals.files.find((source: any) => source.path === card.sourcePath);
    const sourceText = Buffer.from(source.base64, 'base64').toString('utf8');
    for (const range of card.sourceRanges) {
      expect(range.startOffset).toBeGreaterThanOrEqual(0);
      expect(range.endOffset).toBeGreaterThan(range.startOffset);
      expect(range.endOffset).toBeLessThanOrEqual(sourceText.length);
      expect(normalize(raw)).toContain(normalize(currentProse(source.path, sourceText.slice(range.startOffset, range.endOffset))));
    }
    for (const link of [card.parent, card.previous, card.next, ...[...raw.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1])]) {
      if (!link || /^[a-z]+:|^#/.test(link)) continue;
      const target = resolve(dirname(card.path), link.split('#')[0]), rel = relative(process.cwd(), target);
      expect(isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')).toBe(false);
      await readFile(target);
    }
  }
});

test('catalog covers the full explicit manual trees and retains entry anchors', async () => {
  const catalog = JSON.parse(await readFile('docs/context-manuals.json', 'utf8'));
  for (const tree of ['docs/agent-rules', 'docs/getting-started', 'plugins/mcpvault-local/skills/mcpvault-agent/resources']) {
    const paths = (await readdir(tree)).filter(path => path.endsWith('.md')).map(path => tree + '/' + path).sort();
    expect(catalog.chapters.filter((card: any) => dirname(card.path).replaceAll('\\', '/') === tree).map((card: any) => card.path).sort()).toEqual(paths);
  }
  for (const source of originals.files) {
    const current = await readFile(source.path, 'utf8');
    for (const heading of Buffer.from(source.base64, 'base64').toString('utf8').match(/^#{1,6} .+$/gm) ?? [])
      expect(current).toContain(heading);
  }
});
