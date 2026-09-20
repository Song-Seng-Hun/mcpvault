import { createBundlePlan, type BundlePlanBasis } from './document-bundle-plan.js';
import { FrontmatterHandler } from './frontmatter.js';
import { parseDocumentStructure } from './document-structure.js';
import { compilationContentHash } from './compilation-model.js';
import { compilationHash, compilationPath, ordinaryCompilationDocument } from './compilation-policy.js';
import { chapterFileMetrics } from './document-chapter-format.js';
import { stringify } from 'yaml';

export interface VerbatimSplitPlan {
  status: 'ready'; sourceRevision: string; fingerprint: string; toc: string;
  chapters: { path: string; content: string; revision: string; startOffset: number; endOffset: number; chapterId: string }[];
}
/** Lossless structural split, not translation, semantic merging or approval.
 * Unsupported anchor/link ownership is an explicit review, never silent loss. */
export function planVerbatimSplit(path: string, raw: string, basis: BundlePlanBasis): VerbatimSplitPlan | { status: 'review_required'; reason: string } {
  const review = (reason: string) => ({ status: 'review_required' as const, reason });
  compilationPath(path);
  if (!ordinaryCompilationDocument(path) || raw.length > 24000) return review('source_kind_or_budget');
  const parsed = new FrontmatterHandler().parse(raw), fm = parsed.frontmatter;
  if (Object.keys(fm).some(k => /^(?:memory_|context_|mcpvault_|source_id$|immutable$|legal_hold$)/.test(k))
    || fm.processing_mode === 'source_only' || fm.source_only || fm.retention_policy === 'preserve' || fm.preserve_until
    || fm.llm_wiki_type !== undefined && !['knowledge', 'manual', 'tool'].includes(String(fm.llm_wiki_type))) return review('owner_adapter_required');
  const body = parsed.content;
  if (!raw.endsWith(body)) return review('source_mapping_unavailable');
  const prefix = raw.slice(0, raw.length - body.length), shift = prefix.length;
  const structure = parseDocumentStructure({ path, raw: body });
  const visible = structure.fragments.filter(f => !['root', 'section', 'code'].includes(f.kind));
  if (visible.some(f => f.references.some(r => !/^https?:\/\//i.test(r))
    || ['html', 'definition', 'footnoteDefinition', 'footnoteReference'].includes(f.kind)
    || /(?:^|\s)\^[\w-]+|^\s*[-*+] \[[ xX]\]/m.test(body.slice(f.startOffset, f.endOffset)))) return review('link_anchor_or_task_mapping_required');
  const plan = createBundlePlan(structure, basis);
  if (plan.items.length < 2 || plan.items.length > 4 || plan.items.some(i => i.kind !== 'chapter')) return review('two_to_four_bounded_chapters_required');
  const headings = structure.fragments.filter(f => f.kind === 'heading');
  const names = headings.map(f => f.headingPath.at(-1)?.normalize('NFKC').toLowerCase());
  if (new Set(names).size !== names.length) return review('ambiguous_heading_anchor');
  const sourceRevision = compilationContentHash(raw);
  const chapters = plan.items.map(item => {
    const fields = { context_document_id: basis.documentId, context_chapter_id: item.chapterId, context_bundle_id: basis.bundleId,
      context_parent: path, context_previous: item.previous ?? null, context_next: item.next ?? null,
      context_position: item.position, context_total: plan.items.length, context_kind: 'source_projection',
      title: item.title, description: item.description, use_when: 'Read this source section.', avoid_when: 'An unrelated task or version.',
      source_family: basis.documentId, source_path: path, source_revision: sourceRevision,
      source_start: item.startOffset + shift, source_end: item.endOffset + shift, generation_rule: basis.ruleVersion, language: 'source' };
    const header = Object.entries(fields).map(([k, v]) => `${k}: ${stringify(v, { collectionStyle: 'flow', lineWidth: 0 }).trimEnd()}`).join('\n');
    const content = `---\n${header}\n---\n${body.slice(item.startOffset, item.endOffset)}`;
    return { path: item.path, content, revision: compilationContentHash(content), chapterId: item.chapterId,
      startOffset: item.startOffset + shift, endOffset: item.endOffset + shift };
  });
  const landing = headings.map(h => {
    const item = plan.items.find(i => h.startOffset >= i.startOffset && h.endOffset <= i.endOffset)!;
    return `${body.slice(h.startOffset, h.endOffset)}\n[[${item.path}|Read this section]]`;
  });
  const toc = prefix + 'Source sections; exact original retained in the compilation bundle.\n'
    + plan.items.map(i => `- [[${i.path}|Section ${i.position}: ${i.title.replace(/[\[\]|\r\n]/g, ' ')}]]`).join('\n') + '\n\n' + landing.join('\n\n') + '\n';
  if ([toc, ...chapters.map(c => c.content)].some(c => chapterFileMetrics(c).lines > 50)) return review('physical_line_budget');
  if (chapters.map(c => raw.slice(c.startOffset, c.endOffset)).join('') !== body) return review('coverage_gap');
  return { status: 'ready', sourceRevision, toc, chapters,
    fingerprint: compilationHash({ rule: 'verbatim-split-v1', basis, path, sourceRevision, toc, chapters }) };
}
