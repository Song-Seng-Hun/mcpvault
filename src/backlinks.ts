import type { BacklinkMatch, OutlinkMatch, UnresolvedLinkMatch } from './types.js';

const WIKI_LINK_PATTERN = /!?(\[\[[^\]]+\]\])/g;
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
  return extractWikiLinkOccurrences(content)
    .filter(({ target }) => matchesTarget(target, normalizedTarget, targetBasename))
    .map(({ line, link, context }) => ({ line, link, context, path: '' }));
}

export function extractWikiLinkOccurrences(content: string): Array<OutlinkMatch> {
  const matches: OutlinkMatch[] = [];
  const lines = content.split('\n');
  let fenceChar = '';
  let fenceLength = 0;

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

    WIKI_LINK_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKI_LINK_PATTERN.exec(line)) !== null) {
      const link = match[0]!;
      const document = linkDocument(link);
      if (!document) continue;

      matches.push({
        line: index + 1,
        link,
        target: document,
        context: line.trim().slice(0, 300),
      });
    }
  }

  return matches;
}

export function findUnresolvedLinkMatches(content: string, vaultFiles: string[]): UnresolvedLinkMatch[] {
  const normalizedFiles = vaultFiles.map(normalizePath);
  return extractWikiLinkOccurrences(content)
    .filter(({ target }) => resolveWikiLinkTargets(target, normalizedFiles).length === 0)
    .map(({ target, line, link, context }) => ({ target, line, link, context, path: '' }));
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

function linkDocument(rawLink: string): string {
  const bracketed = rawLink.startsWith('!') ? rawLink.slice(1) : rawLink;
  let document = bracketed.slice(2, -2).replace(/\\\|/g, '|');
  const pipeIndex = document.indexOf('|');
  if (pipeIndex !== -1) document = document.slice(0, pipeIndex);
  const hashIndex = document.indexOf('#');
  if (hashIndex !== -1) document = document.slice(0, hashIndex);
  return document.trim().replace(/^\.\//, '');
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
