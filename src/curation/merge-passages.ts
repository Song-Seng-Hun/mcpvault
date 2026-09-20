import { posix } from 'node:path';
import { buildMarkdownLiteralMask, extractObsidianLinkOccurrences } from '../backlinks.js';
import { projectNoteOutline } from '../note-projections.js';
import { archiveCoverage } from './archive.js';
import { curationPath } from './policy.js';

interface Input { path: string; content: string; revision: string; frontmatter: Record<string, unknown> }
export interface PassageMapping { path: string; revision: string; sourceStart: number; sourceEnd: number; outputStart: number; outputEnd: number }
const review = (reason: string) => ({ status: 'review_required' as const, reason });
function visibleText(body: string) {
  const mask = buildMarkdownLiteralMask(body);
  return Array.from({ length: body.length }, (_, i) => mask[i] ? ' ' : body[i]).join('');
}
function anchors(body: string) {
  const visible = visibleText(body);
  return new Set([...projectNoteOutline(body).map(h => `h:${h.text.toLowerCase()}`),
    ...Array.from(visible.matchAll(/(?:^|\s)\^([\w-]+)(?=\s|$)/g), m => `b:${m[1]!.toLowerCase()}`)]);
}
function closedBlocks(body: string): boolean {
  let marker = '', width = 0;
  for (const line of body.split(/\r?\n/)) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fence) continue;
    if (!marker) { marker = fence[1]![0]!; width = fence[1]!.length; }
    else if (fence[1]![0] === marker && fence[1]!.length >= width && !fence[2]!.trim()) marker = '';
  }
  // Raw HTML requires a real HTML binding review. A closed Markdown code
  // example is masked and is not mistaken for an active tag/comment.
  return !marker && !/<(?:!|\?|\/?[a-z][\w:-]*(?:\s|>|\/))/i.test(visibleText(body));
}

/** Lossless, locally checkable union. No free-text synthesis or semantic claim.
 * Existing canonical bytes stay first, preserving their original anchor order.
 * Wider metadata/link migrations use review rather than guessing equivalence. */
export function mergePassages(source: Input, canonical: Input) {
  curationPath(source.path); curationPath(canonical.path);
  if (source.path.toLowerCase() === canonical.path.toLowerCase() || [source, canonical].some(n => !/^[a-f0-9]{64}$/.test(n.revision)))
    return review('invalid_merge_basis');
  if (!archiveCoverage({ ...source, content: 'metadata comparison' }, { ...canonical, content: 'metadata comparison' }))
    return review('metadata_mapping_required');
  if (!source.content.trim() || !canonical.content.trim()) return review('empty_passage');
  if (![source, canonical].every(n => closedBlocks(n.content))) return review('block_boundary_mapping_required');
  const a = anchors(source.content), b = anchors(canonical.content);
  if ([...a].some(anchor => b.has(anchor))) return review('anchor_mapping_required');
  // Definitions, local links and footnotes can change binding after concatenation.
  // A code example remains literal and is not treated as a live dependency.
  for (const note of [source, canonical]) if (/\[[^\]\n]+\]:|\[\^|\[\[#|\]\(\s*#/.test(visibleText(note.content)))
    return review('local_reference_mapping_required');
  const links = extractObsidianLinkOccurrences(source.content, 201, true);
  if (links.length > 200) return review('reference_budget');
  // The graph extractor intentionally omits images and non-note assets; they
  // still have path-dependent meaning and must participate in relocation.
  if (posix.dirname(source.path) !== posix.dirname(canonical.path)
    && (links.length || /\]\(/.test(visibleText(source.content)))) return review('relocation_mapping_required');
  const key = (path: string) => posix.normalize(path).replace(/\.md$/i, '').toLowerCase();
  const cycleKeys = new Set([source.path, canonical.path].flatMap(path => [key(path), key(posix.basename(path))]));
  if (links.some(l => {
    const target = l.target.split('#')[0]!;
    return cycleKeys.has(key(target)) || cycleKeys.has(key(posix.join(posix.dirname(source.path), target)));
  })) return review('self_reference_after_merge');
  const separator = canonical.content.endsWith('\n\n') ? '' : canonical.content.endsWith('\n') ? '\n' : '\n\n';
  const offset = canonical.content.length + separator.length, content = canonical.content + separator + source.content;
  if (content.length > 20000) return review('chapter_bundle_required');
  const coverage: PassageMapping[] = [
    { path: canonical.path, revision: canonical.revision, sourceStart: 0, sourceEnd: canonical.content.length, outputStart: 0, outputEnd: canonical.content.length },
    { path: source.path, revision: source.revision, sourceStart: 0, sourceEnd: source.content.length, outputStart: offset, outputEnd: content.length },
  ];
  return { status: 'ready' as const, content, coverage, semanticJudgment: 'not_inferred' as const };
}
