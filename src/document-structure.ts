import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';

/** Bump when source mapping, fragment kinds, references or identity semantics change. */
export const DOCUMENT_STRUCTURE_PROFILE = 'mcpvault-document-structure-v1';
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_FRAGMENTS = 50_000;
const MAX_AST_NODES = 100_000;
const MAX_AST_DEPTH = 128;
const DESCRIPTION_LENGTH = 240;
const markdown = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml', 'toml']).freeze();

export interface DocumentStructure {
  path: string;
  revision: string;
  profile: string;
  raw: string;
  title: string;
  fragments: DocumentFragment[];
  /** Binary resources use extracted offsets, never physical PDF source lines. */
  locator?: string;
  gaps?: string[];
  pdfPages?: { page: number; startOffset: number; endOffset: number; status: 'ok' | 'failed';
    regions: { startOffset: number; endOffset: number; bbox: [number, number, number, number] }[] }[];
}

export interface DocumentFragment {
  id: string;
  kind: string;
  /** One-based physical source lines, including frontmatter; endLine is inclusive. */
  startLine: number;
  endLine: number;
  /** Zero-based UTF-16 half-open source range. Newline bytes stay in raw. */
  startOffset: number;
  endOffset: number;
  headingPath: string[];
  description: string;
  parent?: string;
  children: string[];
  previous?: string;
  next?: string;
  /** Explicit targets, not resolved fragment IDs: wiki target, URL or [^footnote]. */
  references: string[];
}

// Only the source-oriented subset of mdast is needed; no transforms or compilers run.
interface AstNode {
  type: string;
  position?: { start: { offset?: number | undefined }; end: { offset?: number | undefined } } | undefined;
  children?: AstNode[] | undefined;
  value?: string | undefined;
  depth?: number | undefined;
  url?: string | undefined;
  identifier?: string | undefined;
  alt?: string | null | undefined;
}

function range(node: AstNode): [number, number] {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) throw guidanceError(new Error('Markdown AST is missing source offsets'), 'guid-977488c7dda55b0a');
  return [start, end];
}

function headingText(node: AstNode): string {
  return node.children?.map(child => child.value ?? child.alt ?? headingText(child)).join('') ?? '';
}

/** Pure synchronous parsing. Refuses excessive bytes/nodes/depth rather than truncating. */
export function parseDocumentStructure(input: {
  path: string;
  raw: string;
  revision?: string;
  format?: 'markdown' | 'text';
}): DocumentStructure {
  const { path, raw, format = 'markdown' } = input;
  if (Buffer.byteLength(raw, 'utf8') > MAX_INPUT_BYTES) throw guidanceError(new RangeError('Document input exceeds the 8 MiB input budget'), 'guid-84acd7979e2f09ec');
  const revision = input.revision ?? createHash('sha256').update(raw).digest('hex');
  const lineStarts = [0];
  for (let offset = 0; offset < raw.length; offset++) {
    if (raw[offset] === '\r') {
      if (raw[offset + 1] === '\n') offset++;
      lineStarts.push(offset + 1);
    } else if (raw[offset] === '\n') lineStarts.push(offset + 1);
  }
  function lineAt(offset: number): number {
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (lineStarts[middle]! <= offset) low = middle;
      else high = middle;
    }
    return low + 1;
  }

  const ast: AstNode = format === 'markdown' ? markdown.parse(raw) : { type: 'root', children: [] };
  const definitions = new Map<string, string>();
  const pending: { node: AstNode; depth: number }[] = [{ node: ast, depth: 0 }];
  let astCount = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++astCount > MAX_AST_NODES || astCount + pending.length > MAX_AST_NODES) throw guidanceError(new RangeError('Document AST node budget exceeded'), 'guid-52b9823c46dde6f9');
    if (depth > MAX_AST_DEPTH) throw guidanceError(new RangeError('Document AST depth budget exceeded'), 'guid-22d46ae5063dc341');
    if (node.type === 'definition' && node.identifier && node.url && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    // Reverse push preserves source order, including first-definition-wins semantics.
    if (node.children) {
      if (node.children.length + astCount + pending.length > MAX_AST_NODES) throw guidanceError(new RangeError('Document AST node budget exceeded'), 'guid-52b9823c46dde6f9');
      for (let index = node.children.length - 1; index >= 0; index--) pending.push({ node: node.children[index]!, depth: depth + 1 });
    }
  }

  const titleNode = ast.children?.find(node => node.type === 'heading' && node.depth === 1);
  const title = titleNode ? headingText(titleNode) : path.split(/[\\/]/).pop()?.replace(/\.md$/i, '') || path;
  const document: DocumentStructure = { path, raw, revision, profile: DOCUMENT_STRUCTURE_PROFILE, title, fragments: [] };
  // Hash the identity prefix once; caller-provided revisions are trusted opaque tokens.
  const identity = createHash('sha256').update(JSON.stringify([path, revision, DOCUMENT_STRUCTURE_PROFILE, format]));
  function add(kind: string, start: number, end: number, headingPath: string[], parent?: DocumentFragment): DocumentFragment {
    if (document.fragments.length >= MAX_FRAGMENTS) throw guidanceError(new RangeError('Document fragment node budget exceeded'), 'guid-f4abd5ae54cb10c3');
    const context = (headingPath.at(-1) || title).slice(0, 80);
    let first = start;
    while (first < end && /\s/.test(raw[first]!)) first++;
    let last = first;
    while (last < end && last - first < DESCRIPTION_LENGTH && raw[last] !== '\r' && raw[last] !== '\n') last++;
    const fragment: DocumentFragment = {
      id: identity.copy().update(JSON.stringify([kind, start, end])).digest('hex'),
      kind, startOffset: start, endOffset: end, startLine: lineAt(start), endLine: lineAt(Math.max(start, end - 1)),
      headingPath: [...headingPath], description: `${context} | ${kind} | ${raw.slice(first, last)}`.slice(0, DESCRIPTION_LENGTH),
      children: [], references: [],
    };
    if (parent) { fragment.parent = parent.id; parent.children.push(fragment.id); }
    document.fragments.push(fragment);
    return fragment;
  }

  function references(node: AstNode): string[] {
    if (['code', 'inlineCode', 'html', 'yaml', 'toml'].includes(node.type)) return [];
    const found: { offset: number; target: string }[] = [];
    const excluded: [number, number][] = [];
    const stack = [node];
    while (stack.length) {
      const current = stack.pop()!;
      const [start, end] = range(current);
      if (['code', 'inlineCode', 'html'].includes(current.type)) { excluded.push([start, end]); continue; }
      if (current.url) {
        found.push({ offset: start, target: current.url });
        // A destination/definition is an opaque target, not more Markdown.
        if (current.type === 'link' && raw[start] === '[' && current.children?.length) {
          excluded.push([start, range(current.children[0]!)[0]], [range(current.children.at(-1)!)[1], end]);
        } else { excluded.push([start, end]); continue; }
      }
      if (current.type === 'footnoteReference') found.push({ offset: start, target: `[^${current.identifier}]` });
      if (['linkReference', 'imageReference'].includes(current.type) && current.identifier) {
        const target = definitions.get(current.identifier);
        if (target) found.push({ offset: start, target });
      }
      if (current.children) for (let index = current.children.length - 1; index >= 0; index--) stack.push(current.children[index]!);
    }
    const [start, end] = range(node);
    // Scan literal source spans, not decoded mdast text: escaped brackets stay escaped.
    excluded.sort((a, b) => a[0] - b[0]);
    let cursor = start;
    const scan = (from: number, to: number) => {
      for (const match of raw.slice(from, to).matchAll(/\[\[([^\[\]\r\n]+)\]\]/g)) {
        const offset = from + match.index;
        let backslashes = 0;
        for (let index = offset - 1; index >= start && raw[index] === '\\'; index--) backslashes++;
        if (backslashes % 2) continue;
        // GFM tables require the alias separator's pipe to be escaped in raw.
        const target = match[1]!.replace(/\\\|/g, '|').split('|', 1)[0]!.trim();
        if (target) found.push({ offset, target });
      }
    };
    for (const [from, to] of excluded) {
      if (from > cursor) scan(cursor, from);
      cursor = Math.max(cursor, to);
    }
    scan(cursor, end);
    return [...new Set(found.sort((a, b) => a.offset - b.offset).map(item => item.target))];
  }

  const root = add('root', 0, raw.length, []);
  function blocks(nodes: AstNode[], parent: DocumentFragment, headingPath: string[]): void {
    // Find section ends within this block container, then emit in source/preorder order.
    const sectionEnds = new Map<AstNode, number>();
    const open: AstNode[] = [];
    for (const node of nodes) {
      if (node.type !== 'heading') continue;
      while (open.length && open.at(-1)!.depth! >= node.depth!) sectionEnds.set(open.pop()!, range(node)[0]);
      open.push(node);
    }
    for (const heading of open) sectionEnds.set(heading, parent.endOffset);
    const sections: { depth: number; fragment: DocumentFragment }[] = [];
    for (const node of nodes) {
      const [start, end] = range(node);
      if (node.type === 'heading') {
        while (sections.length && sections.at(-1)!.depth >= node.depth!) sections.pop();
        const owner = sections.at(-1)?.fragment ?? parent;
        const labels = [...(sections.at(-1)?.fragment.headingPath ?? headingPath), headingText(node)];
        const section = add('section', start, sectionEnds.get(node)!, labels, owner);
        sections.push({ depth: node.depth!, fragment: section });
      }
      const owner = sections.at(-1)?.fragment ?? parent;
      const labels = sections.at(-1)?.fragment.headingPath ?? headingPath;
      let kind = node.type;
      if (kind === 'yaml' || kind === 'toml') kind = 'frontmatter';
      if (kind === 'blockquote' && /^>\s*\[![\w-]+\]/.test(raw.slice(start, Math.min(end, start + 120)))) kind = 'callout';
      const fragment = add(kind, start, end, labels, owner);
      if (node.type === 'table') {
        for (const [index, row] of (node.children ?? []).entries()) {
          const [rowStart, rowEnd] = range(row);
          const child = add(index === 0 ? 'tableHeader' : 'tableRow', rowStart, rowEnd, labels, fragment);
          child.references = references(row);
        }
      } else if (['list', 'listItem', 'blockquote', 'footnoteDefinition'].includes(node.type) && node.children?.length) {
        blocks(node.children, fragment, labels);
      } else {
        fragment.references = references(node);
      }
    }
  }

  if (format === 'text') {
    let paragraphStart: number | undefined;
    let paragraphEnd = 0;
    for (let index = 0; index < lineStarts.length; index++) {
      const start = lineStarts[index]!;
      let end = lineStarts[index + 1] ?? raw.length;
      while (end > start && (raw[end - 1] === '\r' || raw[end - 1] === '\n')) end--;
      if (raw.slice(start, end).trim()) { paragraphStart ??= start; paragraphEnd = end; }
      else if (paragraphStart !== undefined) { add('paragraph', paragraphStart, paragraphEnd, [], root); paragraphStart = undefined; }
    }
    if (paragraphStart !== undefined) add('paragraph', paragraphStart, paragraphEnd, [], root);
  } else {
    blocks(ast.children ?? [], root, []);
  }
  const reading = document.fragments.filter(fragment => !fragment.children.length && !['root', 'section'].includes(fragment.kind));
  for (let index = 1; index < reading.length; index++) {
    const previous = reading[index - 1]!;
    const current = reading[index]!;
    if (previous.endOffset > current.startOffset) throw guidanceError(new Error('Document reading blocks overlap'), 'guid-344d9f292b5abd6b');
    previous.next = current.id;
    current.previous = previous.id;
  }
  return document;
}

export function fragmentText(document: DocumentStructure, fragment: DocumentFragment): string {
  return document.raw.slice(fragment.startOffset, fragment.endOffset);
}
