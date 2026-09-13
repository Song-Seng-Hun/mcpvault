import { guidanceError } from './guidance-runtime.js';
import { stringify } from 'yaml';
import { compilationPath } from './compilation-policy.js';
import { parseDocumentStructure, type DocumentStructure } from './document-structure.js';
import { selectDocumentRanges } from './document-ranges.js';
import { isDocumentBundleId } from './document-bundle-identities.js';

export interface ManagedChapterMetadata {
  documentId: string; chapterId: string; bundleId: string;
  title: string; description: string; kind: 'knowledge' | 'manual' | 'tool'; domain: string;
  useWhen: string; avoidWhen: string; stage: string; project?: string; aliases: string[];
  parent: string; previous?: string; next?: string; position: number; total: number;
  prerequisites: string[]; tools: string[]; counterexamples: string[];
  sourceFamily: string; sourceRevision: string; ruleVersion: string;
  sourceRanges: { startOffset: number; endOffset: number }[];
}
const FIELDS = ['documentId', 'chapterId', 'bundleId', 'title', 'description', 'kind', 'domain', 'useWhen', 'avoidWhen', 'stage', 'project',
  'aliases', 'parent', 'previous', 'next', 'position', 'total', 'prerequisites', 'tools', 'counterexamples', 'sourceFamily', 'sourceRevision', 'ruleVersion', 'sourceRanges'];
const invalid = () => guidanceError(new Error('Invalid managed chapter metadata'), 'guid-dbd6bb096045db67');
const text = (value: unknown, max = 160): string => {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw invalid();
  return value;
};
const path = (value: unknown) => {
  const checked = compilationPath(value);
  if (/[#\[\]^]/.test(checked)) throw invalid();
  return checked;
};
const array = (values: unknown, check: (value: unknown) => string, max = 4): string[] => {
  if (!Array.isArray(values) || values.length > max) throw invalid();
  const items = values.map(check);
  if (new Set(items).size !== items.length) throw invalid(); return items;
};

/** Physical lines, including metadata and blank lines; a final EOL terminates
 * the last line rather than manufacturing another empty line. */
export function chapterFileMetrics(content: string) {
  const lines = content ? content.split(/\r\n|\r|\n/) : [];
  if (lines.at(-1) === '') lines.pop();
  return { lines: lines.length, chars: content.length, longestLine: lines.reduce((max, line) => Math.max(max, line.length), 0) };
}

/** Pure candidate rendering only. The owner adapter must separately verify
 * authorization, immutable backup, meaning, links and staged-bundle visibility.
 * The staged property below is NOT a security or search-exclusion mechanism. */
export function renderManagedChapter(source: DocumentStructure, input: ManagedChapterMetadata, body: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !FIELDS.includes(k))) throw invalid();
  for (const id of [input.documentId, input.chapterId, input.bundleId]) if (!isDocumentBundleId(id)) throw invalid();
  if (!['knowledge', 'manual', 'tool'].includes(input.kind) || !Number.isSafeInteger(input.position) || !Number.isSafeInteger(input.total)
    || input.position < 1 || input.total < input.position || input.total > 4096) throw invalid();
  if (input.sourceRevision !== source.revision) throw guidanceError(new Error('Chapter source revision changed'), 'guid-66c9a4aa1306a849');
  if (!Array.isArray(input.sourceRanges) || !input.sourceRanges.length || input.sourceRanges.length > 8) throw invalid();
  let end = -1;
  for (const range of input.sourceRanges) {
    if (!range || Object.keys(range).some(k => !['startOffset', 'endOffset'].includes(k)) || range.startOffset < end || range.startOffset >= range.endOffset) throw guidanceError(new Error('Invalid chapter source ranges'), 'guid-8171371e41608907');
    selectDocumentRanges(source, { ...range, mode: 'exact' }); end = range.endOffset;
    for (const fragment of source.fragments) if (['code', 'table', 'list', 'blockquote', 'frontmatter'].includes(fragment.kind)
      && [range.startOffset, range.endOffset].some(offset => offset > fragment.startOffset && offset < fragment.endOffset)) throw guidanceError(new Error('Chapter source range splits an indivisible block'), 'guid-3cb3437f271baf0b');
  }
  if (typeof body !== 'string' || !body.trim() || body.length > 24000) throw guidanceError(new Error('Invalid chapter body size'), 'guid-45e54f3fd76e0b46');
  const structure = parseDocumentStructure({ path: 'candidate.md', raw: body });
  if (structure.fragments.some(f => f.kind === 'frontmatter')) throw guidanceError(new Error('Chapter body must not supply frontmatter'), 'guid-bc6fbbe76da04754');
  const protectedLines = new Set<number>();
  for (const fragment of structure.fragments) if (['code', 'blockquote'].includes(fragment.kind)) {
    for (let line = fragment.startLine; line <= fragment.endLine; line++) protectedLines.add(line);
  }
  if (body.split(/\r\n|\r|\n/).some((line, index) => line.length > 240 && !protectedLines.has(index + 1))) throw guidanceError(new Error('Chapter natural-language line exceeds 240 characters'), 'guid-1351a0fd57dc13dd');
  const meta = {
    context_document_id: input.documentId, context_chapter_id: input.chapterId, context_bundle_id: input.bundleId, context_bundle_state: 'staged',
    title: text(input.title, 120), description: text(input.description), context_kind: input.kind, domain: text(input.domain, 60),
    use_when: text(input.useWhen), avoid_when: text(input.avoidWhen), task_stage: text(input.stage, 40),
    ...(input.project !== undefined && { project: text(input.project, 80) }), aliases: array(input.aliases, v => text(v, 60)),
    context_parent: path(input.parent), ...(input.previous !== undefined && { context_previous: path(input.previous) }),
    ...(input.next !== undefined && { context_next: path(input.next) }), context_position: input.position, context_total: input.total,
    prerequisites: array(input.prerequisites, path), tools: array(input.tools, v => {
      const name = text(v, 100); if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(name)) throw invalid(); return name;
    }), counterexamples: array(input.counterexamples, path),
    source_family: text(input.sourceFamily), source_revision: source.revision, source_path: source.path,
    source_ranges: input.sourceRanges, generation_rule: text(input.ruleVersion, 100), language: 'en', semantic_review: 'not_assessed',
  };
  // Keep each metadata field independently readable; bounded flow collections
  // save boilerplate without folding natural-language paragraphs into long lines.
  const header = Object.entries(meta).map(([key, value]) => `${key}: ${stringify(value, { collectionStyle: 'flow', lineWidth: 0 }).trimEnd()}`).join('\n');
  if (header.split('\n').some(line => line.length > 400)) throw guidanceError(new Error('Chapter metadata line exceeds its bounded field budget'), 'guid-a23d7b06ffbef938');
  const content = `---\n${header}\n---\n# ${input.title}\n\n${body}`;
  const metrics = chapterFileMetrics(content);
  if (metrics.lines > 50) throw guidanceError(new Error('Managed chapter exceeds 50 physical lines including metadata'), 'guid-cddc1659224cc9da');
  return { content, metrics, semantic: 'not_assessed' as const, authorizesCutover: false as const };
}
