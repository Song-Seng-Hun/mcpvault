import type { BacklinkMatch, OutlinkMatch, UnresolvedLinkMatch } from './types.js';

const WIKI_LINK_PATTERN = /!?(\[\[[^\]]+\]\])/g;
// Obsidian also indexes ordinary Markdown links whose destination is a note.
// Keep this intentionally small: external URLs, images, and anchor-only links
// are not vault graph edges.
const MARKDOWN_LINK_PATTERN = /(?<!!)(?:\[([^\]]*)\])\(\s*(<[^>]+>|[^\s)]+)(?:\s+['"][^)]*['"])?\s*\)/g;
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Find Obsidian wikilinks in a note that refer to a target note.
 *
 * This deliberately works on raw lines so the result can point an agent to
 * an exact line without returning the source note's full content. Fenced code
 * blocks are ignored because links shown as examples there are not graph
 * edges. Inline code is left alone: Obsidian can still index a wikilink that
 * appears in inline code, and deciding otherwise would require a Markdown
 * parser with different semantics from Obsidian.
 */
export function findBacklinkMatches(content: string, targetPath: string): BacklinkMatch[] {
  const normalizedTarget = normalizeTarget(targetPath);
  const targetBasename = basenameWithoutExtension(normalizedTarget);
  return extractObsidianLinkOccurrences(content)
    .filter(({ target }) => matchesTarget(target, normalizedTarget, targetBasename))
    .map(({ line, link, context, heading, targetHeading, targetBlockId }) => ({
      line,
      link,
      context,
      path: '',
      ...(heading && { heading }),
      ...(targetHeading && { targetHeading }),
      ...(targetBlockId && { targetBlockId }),
    }));
}

export function extractWikiLinkOccurrences(content: string): Array<OutlinkMatch> {
  return extractLinkOccurrences(content, false);
}

/**
 * Extract the two Obsidian-compatible internal link forms that can create a
 * graph edge: wikilinks and relative Markdown links. The result stays line
 * based and bounded so callers can provide a useful locator without loading
 * the source note again.
 */
export function extractObsidianLinkOccurrences(content: string): Array<OutlinkMatch> {
  return extractLinkOccurrences(content, true);
}

function extractLinkOccurrences(content: string, includeMarkdown: boolean): Array<OutlinkMatch> {
  const matches: OutlinkMatch[] = [];
  const lines = content.split('\n');
  let fenceChar = '';
  let fenceLength = 0;
  let currentHeading: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.replace(/\r$/, '');
    const fence = FENCE_PATTERN.exec(line);
    if (fence) {
      const markers = fence[1]!;
      const trailing = fence[2]!;
      const char = markers[0]!;
      if (!fenceChar) {
        fenceChar = char;
        fenceLength = markers.length;
      } else if (char === fenceChar && markers.length >= fenceLength && trailing.trim() === '') {
        fenceChar = '';
        fenceLength = 0;
      }
      continue;
    }
    if (fenceChar) continue;

    const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) currentHeading = heading[1]!.trim();

    WIKI_LINK_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKI_LINK_PATTERN.exec(line)) !== null) {
      const link = match[0]!;
      const parsed = linkDocument(link);
      if (!parsed.document) continue;

      matches.push({
        line: index + 1,
        link,
        target: parsed.document,
        context: line.trim().slice(0, 300),
        ...(currentHeading && { heading: currentHeading }),
        ...(parsed.targetHeading && { targetHeading: parsed.targetHeading }),
        ...(parsed.targetBlockId && { targetBlockId: parsed.targetBlockId }),
      });
    }

    if (includeMarkdown) {
      MARKDOWN_LINK_PATTERN.lastIndex = 0;
      while ((match = MARKDOWN_LINK_PATTERN.exec(line)) !== null) {
        const link = match[0]!;
        const parsed = markdownLinkDocument(match[2]!);
        if (!parsed.document) continue;
        matches.push({
          line: index + 1,
          link,
          target: parsed.document,
          context: line.trim().slice(0, 300),
          ...(currentHeading && { heading: currentHeading }),
          ...(parsed.targetHeading && { targetHeading: parsed.targetHeading }),
          ...(parsed.targetBlockId && { targetBlockId: parsed.targetBlockId }),
        });
      }
    }
  }

  return matches;
}

export function findUnresolvedLinkMatches(content: string, vaultFiles: string[]): UnresolvedLinkMatch[] {
  const normalizedFiles = vaultFiles.map(normalizePath);
  return extractObsidianLinkOccurrences(content)
    .filter(({ target }) => resolveWikiLinkTargets(target, normalizedFiles).length === 0)
    .map(({ target, line, link, context, heading, targetHeading, targetBlockId }) => ({
      target,
      line,
      link,
      context,
      path: '',
      ...(heading && { heading }),
      ...(targetHeading && { targetHeading }),
      ...(targetBlockId && { targetBlockId }),
    }));
}

export function resolveWikiLinkTargets(target: string, vaultFiles: string[]): string[] {
  const normalizedTarget = normalizePath(target);
  if (!normalizedTarget) return [];

  const hasExtension = /(^|\/)[^/]+\.[^/]+$/.test(normalizedTarget);
  return vaultFiles.filter((file) => {
    const normalizedFile = normalizePath(file);
    if (hasExtension) {
      return normalizedTarget.includes('/')
        ? normalizedFile === normalizedTarget
        : basenameWithoutExtension(normalizedFile) === normalizedTarget;
    }

    const fileWithoutExtension = normalizedFile.replace(/\.[^/.]+$/, '');
    return normalizedTarget.includes('/')
      ? fileWithoutExtension === normalizedTarget
      : basenameWithoutExtension(fileWithoutExtension) === normalizedTarget;
  });
}

interface ParsedLinkTarget {
  document: string;
  targetHeading?: string;
  targetBlockId?: string;
}

function parseAnchor(document: string): ParsedLinkTarget {
  const hashIndex = document.indexOf('#');
  if (hashIndex === -1) return { document: document.trim().replace(/^\.\//, '') };
  const target = document.slice(hashIndex + 1).trim();
  const result: ParsedLinkTarget = { document: document.slice(0, hashIndex).trim().replace(/^\.\//, '') };
  if (!target) return result;
  let decodedTarget = target;
  try { decodedTarget = decodeURIComponent(target); } catch { /* retain the safe raw anchor */ }
  if (decodedTarget.startsWith('^')) result.targetBlockId = decodedTarget.slice(1).trim();
  else result.targetHeading = decodedTarget;
  return result;
}

function linkDocument(rawLink: string): ParsedLinkTarget {
  const bracketed = rawLink.startsWith('!') ? rawLink.slice(1) : rawLink;
  let document = bracketed.slice(2, -2).replace(/\\\|/g, '|');
  const pipeIndex = document.indexOf('|');
  if (pipeIndex !== -1) document = document.slice(0, pipeIndex);
  return parseAnchor(document);
}

function markdownLinkDocument(rawDestination: string): ParsedLinkTarget {
  let document = rawDestination.trim();
  if (document.startsWith('<') && document.endsWith('>')) document = document.slice(1, -1).trim();
  if (!document || /^[a-z][a-z0-9+.-]*:/i.test(document) || document.startsWith('#')) return { document: '' };
  let anchor = '';
  const hashIndex = document.indexOf('#');
  if (hashIndex !== -1) {
    anchor = document.slice(hashIndex);
    document = document.slice(0, hashIndex);
  }
  const queryIndex = document.indexOf('?');
  if (queryIndex !== -1) document = document.slice(0, queryIndex);
  try { document = decodeURIComponent(document); } catch { /* retain the raw safe path */ }
  return parseAnchor(`${document}${anchor}`);
}

function normalizeTarget(path: string): string {
  return normalizePath(path).replace(/\.md$/i, '');
}

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .toLowerCase();
}

function basenameWithoutExtension(path: string): string {
  const slash = path.lastIndexOf('/');
  return path.slice(slash + 1);
}

function matchesTarget(document: string, normalizedTarget: string, targetBasename: string): boolean {
  const normalizedDocument = normalizeTarget(document);
  if (!normalizedDocument) return false;
  return normalizedDocument.includes('/')
    ? normalizedDocument === normalizedTarget
    : normalizedDocument === targetBasename;
}
