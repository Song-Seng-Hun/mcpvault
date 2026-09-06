import { afterEach, expect, test, vi } from 'vitest';
import { FrontmatterHandler } from './frontmatter.js';
import matter from 'gray-matter';
import { parse as parseYaml } from 'yaml';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join, relative, basename, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';

const handler = new FrontmatterHandler();
const marker = '__mcpvault_inert_frontmatter_probe__';
const globals = globalThis as unknown as Record<string, unknown>;
afterEach(() => { delete globals[marker]; vi.restoreAllMocks(); });

test.each(['javascript', 'js', 'JAVASCRIPT', 'Js'])('frontmatter label %s cannot execute a benign process-local marker', language => {
  const raw = `---${language}\n({ probe: (globalThis[${JSON.stringify(marker)}] = true) })\n---\nKeep as text.\n`;
  const result = handler.parse(raw);
  expect(globals[marker]).toBeUndefined();
  expect(result).toEqual({ frontmatter: {}, content: raw, originalContent: raw, matter: '' });
});

test.each([false, true])('large body is not copied into a parser input Buffer (header=%s)', hasHeader => {
  const body = '# Body\n' + 'x'.repeat(2 * 1024 * 1024);
  const raw = hasHeader ? `---\ntitle: Safe\n---\n${body}` : body;
  const copies = vi.spyOn(Buffer, 'from');
  const result = handler.parse(raw);
  expect(result.content).toBe(body);
  expect(result.originalContent).toBe(raw);
  expect(result.frontmatter).toEqual(hasHeader ? { title: 'Safe' } : {});
  expect(copies.mock.calls.filter(([value]) => value === raw).length).toBe(0);
  expect(Math.max(0, ...copies.mock.calls.map(([value]) => typeof value === 'string' ? value.length : 0))).toBeLessThan(256);
});

// Only hand-constructed data/non-executable fixtures go through this legacy
// oracle. Never feed a document-selected JavaScript engine into it.
function oldDataParse(raw: string) {
  try {
    const parsed = matter(raw, { engines: { yaml: { parse: parseYaml } } });
    return { frontmatter: parsed.data, content: parsed.content, originalContent: raw, matter: parsed.matter };
  } catch { return { frontmatter: {}, content: raw, originalContent: raw, matter: '' }; }
}

test('data parsing matches legacy fields across delimiter, language, BOM and malformed cases', () => {
  const cases = ['', '# Plain\n[[A]]', '\uFEFF# Plain', '\uFEFF\uFEFF# Plain',
    '---', '----\nnot properties', '---yaml', '---\ntitle: Unclosed', '---json\n{"title":"Unclosed"}',
    '```yaml\n---\ntitle: Example\n---\n```', '\n---\ntitle: Not leading\n---', '---\n#\n---',
    '---\n# Comments only\n  \n---\nBody', '---\n- a\n- b\n---\nBody', '---\nnull\n---\nBody'];
  for (const bom of ['', '\uFEFF']) for (const eol of ['\n', '\r\n']) {
    for (const language of ['', 'yaml', 'yml', 'YAML', 'json', 'JSON']) {
      for (const data of ['title: 한글\ntags: [a, b]\ndate: 2026-09-07', '{"title":"한글", "n":2}', 'bad: [', '']) {
        for (const close of ['---', '---\n', '---\r\n', '---suffix\n', '----\n']) {
          cases.push(`${bom}---${language}${eol}${data.replaceAll('\n', eol)}${eol}${close}# Body\n[[A]]\n`);
        }
      }
    }
  }
  for (const raw of cases) expect(handler.parse(raw), JSON.stringify(raw)).toStrictEqual(oldDataParse(raw));
});

test.each(['constructor', '__proto__', 'toString', 'javascript', 'js', 'toml', 'xml'])('unsupported engine %s is preserved as inert text across helpers', language => {
  const raw = `\uFEFF---${language}\r\n({ probe: (globalThis[${JSON.stringify(marker)}] = true) })\r\n---\r\nBody`;
  expect(handler.extractFrontmatter(raw)).toEqual({});
  const updated = handler.updateFrontmatter(raw, { title: 'Safe metadata' });
  expect(handler.parse(updated).frontmatter).toEqual({ title: 'Safe metadata' });
  // Existing stringify adds the final newline when the body has none.
  expect(handler.parse(updated).content).toBe(raw + '\n');
  expect(globals[marker]).toBeUndefined();
});

test.each(['toml', 'xml', 'js'])('even an empty %s header is unsupported text, not a data-language exception', language => {
  const raw = `---${language}\n\n---\nBody`;
  expect(handler.parse(raw)).toEqual({ frontmatter: {}, content: raw, originalContent: raw, matter: '' });
});

test('real note and fresh metadata reads do not execute document code', async () => {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-data-frontmatter-', root = await mkdtemp(join(base, prefix));
  try {
    const raw = `---js\n({ probe: (globalThis[${JSON.stringify(marker)}] = true) })\n---\nBody`;
    await writeFile(join(root, 'Note.md'), raw);
    const fs = new FileSystemService(root);
    expect(await fs.readNote('Note.md')).toMatchObject({ frontmatter: {}, content: raw });
    expect(await fs.readNoteMetadata(['Note.md'], () => true, { fresh: true, strict: true, maxBytes: 1024 }))
      .toEqual([expect.objectContaining({ path: 'Note.md', frontmatter: {} })]);
    expect(globals[marker]).toBeUndefined();
  } finally {
    const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe cleanup');
    await rm(target, { recursive: true, force: true });
  }
});
