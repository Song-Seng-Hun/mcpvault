import { expect, test } from 'vitest';
import { parseDocumentStructure } from './document-structure.js';
import { FrontmatterHandler } from './frontmatter.js';
import { renderManagedChapter, chapterFileMetrics } from './document-chapter-format.js';

const source = parseDocumentStructure({ path: 'Knowledge/Original.md', raw: '# Safety\r\nOnly after approval. 검증 required. 😀\r\n' });
const id = '9cac42de-e32d-41e2-8370-df5f19d3b19c';
const metadata = () => ({
  documentId: id, chapterId: 'f00d631d-4e24-4bc5-8e27-b29ecf0b133d', bundleId: '68399e34-efcc-4e9a-b0bc-6e9320037450',
  title: 'Safe deployment', description: 'Approval and verification before deployment.', kind: 'manual' as const,
  domain: 'software', useWhen: 'Deploying a reviewed change.', avoidWhen: 'Reading without changes.', stage: 'execute', project: 'mcpvault',
  aliases: ['deployment', '배포'], parent: 'Knowledge/Original.md', position: 1, total: 2,
  next: 'Knowledge/Chapters/next.md', prerequisites: ['Knowledge/Approval.md'], tools: ['notes.change_set'], counterexamples: [],
  sourceFamily: 'deployment-original', sourceRevision: source.revision, ruleVersion: 'chapters-v1',
  sourceRanges: [{ startOffset: 0, endOffset: source.raw.length }],
});

test('managed chapter retains searchable identity, source ranges and navigation within fifty actual lines', () => {
  const output = renderManagedChapter(source, metadata(), 'Only deploy after approval.\nVerification (검증) is required.\n\nExample: preview notes.change_set before apply.\n');
  const parsed = new FrontmatterHandler().parse(output.content);
  expect(parsed.frontmatter.context_document_id).toBe(id);
  expect(parsed.frontmatter.context_chapter_id).toBe(metadata().chapterId);
  expect(parsed.frontmatter.context_bundle_state).toBe('staged');
  expect(parsed.frontmatter.source_revision).toBe(source.revision);
  expect(parsed.frontmatter.aliases).toContain('배포');
  expect(parsed.frontmatter.context_parent).toBe('Knowledge/Original.md');
  expect(parsed.content).toContain('Verification (검증) is required.');
  expect(chapterFileMetrics(output.content).lines).toBeLessThanOrEqual(50);
  expect(output.semantic).toBe('not_assessed');
  expect(output.authorizesCutover).toBe(false);
});

test('line budget includes YAML, blank lines and CRLF; giant natural-language lines cannot evade it', () => {
  expect(chapterFileMetrics('a\r\nb\r\n').lines).toBe(2);
  expect(chapterFileMetrics('\n\n').lines).toBe(2);
  expect(() => renderManagedChapter(source, metadata(), 'Keep this condition.\n'.repeat(50))).toThrow(/50|line/i);
  expect(() => renderManagedChapter(source, metadata(), 'Words '.repeat(100))).toThrow(/line/i);
});

test('stale source or broken Unicode range cannot be asserted as provenance', () => {
  expect(() => renderManagedChapter(source, { ...metadata(), sourceRevision: 'a'.repeat(64) }, 'Preserve approval.')).toThrow(/revision/i);
  const emoji = source.raw.indexOf('😀');
  expect(() => renderManagedChapter(source, { ...metadata(), sourceRanges: [{ startOffset: emoji + 1, endOffset: source.raw.length }] }, 'Preserve approval.')).toThrow(/offset|range/i);
  expect(() => renderManagedChapter(source, { ...metadata(), sourceRanges: [{ startOffset: 0, endOffset: 4 }, { startOffset: 3, endOffset: 5 }] }, 'Preserve approval.')).toThrow(/range/i);
});

test('extra authority fields, path tricks and unsafe identity changes are rejected', () => {
  expect(() => renderManagedChapter(source, { ...metadata(), absolute: true } as never, 'Never remove approval.')).toThrow();
  for (const parent of ['../other.md', 'C:/private.md', 'Knowledge/A#B.md', 'Knowledge/[[A]].md']) {
    expect(() => renderManagedChapter(source, { ...metadata(), parent }, 'Keep approval.')).toThrow();
  }
  expect(() => renderManagedChapter(source, { ...metadata(), chapterId: '1' }, 'Keep approval.')).toThrow();
  expect(() => renderManagedChapter(source, { ...metadata(), position: 3 }, 'Keep approval.')).toThrow();
  expect(() => renderManagedChapter(source, metadata(), '---\nabsolute: true\n---\nSkip approval.')).toThrow(/frontmatter/i);
});

test('code and quote content is not compressed or trimmed by the renderer', () => {
  const body = '> Do not overwrite user edits.\n\n~~~sh\nprintf "한글\\n"\n~~~\n';
  const rendered = renderManagedChapter(source, metadata(), body);
  expect(rendered.content.endsWith(body)).toBe(true);
  expect(source.raw).toContain('Only after approval.');
});
