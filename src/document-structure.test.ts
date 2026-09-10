import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { DOCUMENT_STRUCTURE_PROFILE, fragmentText, parseDocumentStructure } from './document-structure.js';
import type { DocumentStructure } from './document-structure.js';

const parse = (raw: string) => parseDocumentStructure({ path: 'Area/문서.md', raw });
const kinds = (document: DocumentStructure, kind: string) => document.fragments.filter(f => f.kind === kind);

function verifyTree(document: DocumentStructure) {
  const byId = new Map(document.fragments.map(f => [f.id, f]));
  const lineAt = (offset: number) => 1 + [...document.raw.matchAll(/\r\n|\r|\n/g)].filter(m => m.index + m[0].length <= offset).length;
  expect(byId.size).toBe(document.fragments.length);
  for (const fragment of document.fragments) {
    expect(fragmentText(document, fragment)).toBe(document.raw.slice(fragment.startOffset, fragment.endOffset));
    expect(fragment.startLine).toBe(lineAt(fragment.startOffset));
    expect(fragment.endLine).toBe(lineAt(Math.max(fragment.startOffset, fragment.endOffset - 1)));
    expect(fragment.description.length).toBeLessThanOrEqual(240);
    if (fragment.parent) {
      const parent = byId.get(fragment.parent)!;
      expect(parent.children).toContain(fragment.id);
      expect(parent.startOffset).toBeLessThanOrEqual(fragment.startOffset);
      expect(parent.endOffset).toBeGreaterThanOrEqual(fragment.endOffset);
    }
    for (const child of fragment.children) expect(byId.get(child)?.parent).toBe(fragment.id);
    if (fragment.next) {
      const next = byId.get(fragment.next)!;
      expect(next.previous).toBe(fragment.id);
      expect(fragment.endOffset).toBeLessThanOrEqual(next.startOffset);
    }
  }
  const leaves = document.fragments.filter(f => !f.children.length && !['root', 'section'].includes(f.kind));
  for (let index = 0; index < leaves.length; index++) {
    expect(leaves[index]!.previous).toBe(leaves[index - 1]?.id);
    expect(leaves[index]!.next).toBe(leaves[index + 1]?.id);
  }
  for (const container of document.fragments.filter(f => f.children.length || ['root', 'section'].includes(f.kind))) {
    expect(container.previous).toBeUndefined();
    expect(container.next).toBeUndefined();
  }
}

test('preserves Korean/English, emoji, CRLF and physical frontmatter offsets', () => {
  const raw = '---\r\ntitle: metadata\r\n---\r\n\r\n# 제목 English 😀\r\n\r\n한글 body 😀\r\nnext line\r\n';
  const document = parse(raw);
  expect(document).toMatchObject({ path: 'Area/문서.md', raw, title: '제목 English 😀', profile: DOCUMENT_STRUCTURE_PROFILE,
    revision: createHash('sha256').update(raw).digest('hex') });
  expect(document.fragments[0]).toMatchObject({ kind: 'root', startOffset: 0, endOffset: raw.length });
  expect(kinds(document, 'frontmatter')).toHaveLength(1);
  const paragraph = kinds(document, 'paragraph')[0]!;
  expect(paragraph).toMatchObject({ startLine: 7, endLine: 8, startOffset: raw.indexOf('한글 body'), headingPath: ['제목 English 😀'] });
  expect(fragmentText(document, paragraph)).toBe('한글 body 😀\r\nnext line');
  verifyTree(document);
});

test('sections contain their headings and descendants with proper heading hierarchy', () => {
  const document = parse('Intro\n\n# A\n\nA body\n\n### B\n\nB body\n\n## C\n\nC body\n\n# D\n\nD body');
  const [a, b, c, d] = kinds(document, 'section');
  expect(a!.headingPath).toEqual(['A']);
  expect(b!.headingPath).toEqual(['A', 'B']);
  expect(c!.headingPath).toEqual(['A', 'C']);
  expect(b!.parent).toBe(a!.id);
  expect(c!.parent).toBe(a!.id);
  expect(d!.parent).toBe(document.fragments[0]!.id);
  expect(fragmentText(document, a!)).toContain('C body');
  expect(fragmentText(document, a!)).not.toContain('# D');
  verifyTree(document);
});

test('retains more than 64 paragraphs including the final searchable paragraph', () => {
  const document = parse(Array.from({ length: 130 }, (_, i) => `paragraph ${i} unique-${i}`).join('\n\n'));
  expect(kinds(document, 'paragraph')).toHaveLength(130);
  expect(fragmentText(document, document.fragments.at(-1)!)).toContain('unique-129');
  verifyTree(document);
});

test('tables retain a parent and identifiable header plus rows in reading order', () => {
  const document = parse('# Results\n\n| 이름 | Value |\n| --- | --- |\n| 가 | 1 |\n| 나 | [[Note]] |\n\nAfter');
  const table = kinds(document, 'table')[0]!;
  const rows = table.children.map(id => document.fragments.find(f => f.id === id)!);
  expect(rows.map(f => f.kind)).toEqual(['tableHeader', 'tableRow', 'tableRow']);
  expect(rows[2]!.references).toContain('Note');
  expect(fragmentText(document, table)).toContain('| --- | --- |');
  expect(rows[0]!.next).toBe(rows[1]!.id);
  verifyTree(document);
});

test('nested lists, task items, blockquotes and callouts expand through containers without overlap', () => {
  const document = parse('- [x] First\n  - Nested [[Target#^block]]\n- Second\n\n> [!NOTE] Title\n> Body\n>\n> - Inside\n\n> Ordinary quote');
  expect(kinds(document, 'list')).toHaveLength(3);
  expect(kinds(document, 'listItem')).toHaveLength(4);
  expect(kinds(document, 'callout')).toHaveLength(1);
  expect(kinds(document, 'blockquote')).toHaveLength(1);
  expect(document.fragments.flatMap(f => f.references)).toContain('Target#^block');
  verifyTree(document);
});

test('backtick, tilde, indented and inline code examples produce no fake headings or references', () => {
  const raw = '# Real\n\n```md\n# Fake\n[[Hidden]] [link](https://hidden)\n```\n\n~~~md\n## Fake2\n[[Hidden2]]\n~~~\n\n    # Indented\n    [[Hidden3]]\n\n`[[Hidden4]]` and [[Visible|alias]] and ![[Embed#Heading]] and [web](https://example.test)';
  const document = parse(raw);
  expect(kinds(document, 'code')).toHaveLength(3);
  expect(kinds(document, 'heading')).toHaveLength(1);
  expect(document.fragments.flatMap(f => f.references)).toEqual(['Visible', 'Embed#Heading', 'https://example.test']);
  verifyTree(document);
});

test('footnotes and reference links retain explicit targets and definition blocks', () => {
  const document = parse('Read [site][ref] and [^foot] and [[#^local]].\n\n[ref]: https://example.test/docs\n\n[^foot]: Footnote [[Other]]\n\nText ^local');
  expect(kinds(document, 'definition')).toHaveLength(1);
  expect(kinds(document, 'footnoteDefinition')).toHaveLength(1);
  const refs = document.fragments.flatMap(f => f.references);
  expect(refs).toEqual(expect.arrayContaining(['https://example.test/docs', '[^foot]', '#^local', 'Other']));
  verifyTree(document);
});

test('IDs are deterministic and bound to path, source revision, profile, kind and range', () => {
  const raw = 'Same\n\nSame';
  const document = parse(raw);
  const [first, second] = kinds(document, 'paragraph');
  expect(first!.id).not.toBe(second!.id);
  expect(parse(raw)).toEqual(document);
  for (const changed of [parseDocumentStructure({ path: 'Other.md', raw }), parseDocumentStructure({ path: document.path, raw, revision: 'explicit-v2' }), parse(raw + '!')]) {
    expect(changed.fragments.every(f => !document.fragments.some(old => old.id === f.id))).toBe(true);
  }
});

test('text scripts preserve exact bytes as paragraphs without interpreting markdown or commands', () => {
  const raw = '#!/bin/sh\r\n# This is a script\r\nrm -rf "$TARGET"\r\n\r\necho "[[NotALink]]"\r\n';
  const document = parseDocumentStructure({ path: 'script.sh', raw, format: 'text' });
  expect(document.raw).toBe(raw);
  expect(document.title).toBe('script.sh');
  expect(kinds(document, 'section')).toHaveLength(0);
  expect(kinds(document, 'paragraph')).toHaveLength(2);
  expect(document.fragments.flatMap(f => f.references)).toEqual([]);
  expect(fragmentText(document, document.fragments[0]!)).toBe(raw);
  verifyTree(document);
});

test('empty and whitespace documents retain a complete root and never invent content', () => {
  for (const raw of ['', ' \r\n\t\n']) {
    const document = parse(raw);
    expect(document.fragments).toHaveLength(1);
    expect(fragmentText(document, document.fragments[0]!)).toBe(raw);
    verifyTree(document);
  }
});

test('giant code remains a single exact fragment with a bounded description', () => {
  const raw = '```js\n' + 'x'.repeat(150_000) + '\n```';
  const document = parse(raw);
  expect(kinds(document, 'code')).toHaveLength(1);
  expect(fragmentText(document, kinds(document, 'code')[0]!)).toBe(raw);
  verifyTree(document);
});

test('explicitly refuses inputs above 8 MiB of UTF-8 bytes', () => {
  expect(() => parse('a'.repeat(8 * 1024 * 1024 + 1))).toThrow(/8 MiB|input.*budget/i);
  expect(() => parse('한'.repeat(3 * 1024 * 1024))).toThrow(/8 MiB|input.*budget/i);
});

test('explicitly refuses pathological node counts instead of returning a truncated document', () => {
  expect(() => parseDocumentStructure({ path: 'large.txt', raw: 'x\n\n'.repeat(50_001), format: 'text' })).toThrow(/node.*budget|too many.*nodes/i);
});

test('accepts exactly 8 MiB without splitting a giant text block', () => {
  const raw = 'x'.repeat(8 * 1024 * 1024);
  const document = parseDocumentStructure({ path: 'large.txt', raw, format: 'text' });
  expect(document.fragments).toHaveLength(2);
  expect(fragmentText(document, document.fragments[1]!)).toBe(raw);
});

test('refuses excessive Markdown AST nodes and depth with explicit budgets', () => {
  expect(() => parse('x\n\n'.repeat(50_001))).toThrow(/node.*budget/i);
  expect(() => parse('> '.repeat(130) + 'deep')).toThrow(/depth.*budget/i);
});

test('handles setext headings, thematic breaks, HTML and lone CR without interpreting examples', () => {
  const document = parse('Title\r=====\r\r---\r\r<div>\r# Fake [[Hidden]]\r</div>\r\rBody');
  expect(document.title).toBe('Title');
  expect(kinds(document, 'heading')).toHaveLength(1);
  expect(kinds(document, 'thematicBreak')).toHaveLength(1);
  expect(kinds(document, 'html')).toHaveLength(1);
  expect(document.fragments.flatMap(f => f.references)).toEqual([]);
  verifyTree(document);
});

test('heading sections inside quotes remain scoped to the containing quote', () => {
  const document = parse('# Outer\n\n> # Inner\n>\n> Body\n\nOutside\n\n## Next');
  const quote = kinds(document, 'blockquote')[0]!;
  const inner = kinds(document, 'section').find(f => f.headingPath.at(-1) === 'Inner')!;
  expect(inner.parent).toBe(quote.id);
  expect(inner.headingPath).toEqual(['Outer', 'Inner']);
  expect(fragmentText(document, inner)).not.toContain('Outside');
  const outside = kinds(document, 'paragraph').find(f => fragmentText(document, f) === 'Outside')!;
  expect(outside.headingPath).toEqual(['Outer']);
  verifyTree(document);
});

test('ignores escaped wiki links and repeated inline code while deduplicating real references', () => {
  const document = parse('\\[[Escaped]] `[[Code]]` ``[[Code2]]`` [[Real]] [[Real|alias]] [[Other#Heading]]');
  expect(kinds(document, 'paragraph')[0]!.references).toEqual(['Real', 'Other#Heading']);
});

test('a reference definition uses its first target even when later definitions repeat it', () => {
  const document = parse('[site][Ref]\n\n[ref]: https://first.test\n\n[REF]: https://second.test');
  expect(kinds(document, 'paragraph')[0]!.references).toEqual(['https://first.test']);
});

test('unclosed fenced code stays a single literal block through the end', () => {
  const raw = '~~~\n# Not a heading\n[[Not a link]]';
  const document = parse(raw);
  expect(document.fragments.map(f => f.kind)).toEqual(['root', 'code']);
  expect(document.fragments[1]!.references).toEqual([]);
  expect(fragmentText(document, document.fragments[1]!)).toBe(raw);
});

test('escaped table alias separators resolve the wiki target without a trailing backslash', () => {
  const document = parse('| Link |\n| --- |\n| [[Note\\|label]] |');
  expect(kinds(document, 'tableRow')[0]!.references).toEqual(['Note']);
});

test('wiki-shaped strings in Markdown link destinations are not additional wiki references', () => {
  const document = parse('[web](https://example.test/[[literal]])');
  expect(kinds(document, 'paragraph')[0]!.references).toEqual(['https://example.test/[[literal]]']);
});
