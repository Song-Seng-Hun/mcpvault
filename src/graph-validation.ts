import { guidanceError } from './guidance-runtime.js';

export interface ParsedClaimReference {
  raw: string;
  document: string;
  blockId: string;
}

export function claimId(value: string | undefined, index: number): string {
  const normalized = String(value || `claim-${index + 1}`).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.slice(0, 80) || `claim-${index + 1}`;
}

export function parseClaimReference(value: unknown): ParsedClaimReference {
  const raw = String(value ?? '').trim();
  if (!raw.startsWith('[[') || !raw.endsWith(']]')) {
    throw guidanceError(new Error('claim relation targets must use an Obsidian block link such as [[Knowledge/Note#^claim-id]] or [[#^claim-id]]'), 'guid-75746bd0dc79cba3');
  }
  let inner = raw.slice(2, -2).replace(/\\\|/g, '|');
  const pipeIndex = inner.indexOf('|');
  if (pipeIndex !== -1) inner = inner.slice(0, pipeIndex);
  if (inner.includes('\\')) throw guidanceError(new Error(`invalid claim relation link: ${raw}`), 'guid-b572bdf40ce9783e');
  const marker = inner.lastIndexOf('#^');
  if (marker < 0) throw guidanceError(new Error(`claim relation target must include a #^block-id: ${raw}`), 'guid-de744cdc637a7230');
  const document = inner.slice(0, marker).trim();
  const blockId = inner.slice(marker + 2).trim().toLowerCase();
  if (!blockId || blockId.length > 80 || !/^[a-z0-9_-]+$/.test(blockId)) {
    throw guidanceError(new Error(`claim relation block id must use 1-80 letters, numbers, hyphens, or underscores: ${raw}`), 'guid-3b1e929db5d09df1');
  }
  const normalizedDocument = document.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  const documentSegments = normalizedDocument.split('/').filter(segment => segment && segment !== '.' && segment !== '..');
  if (document.includes('#') || normalizedDocument.startsWith('scope://') || documentSegments.some(segment => segment === '_scopes' || segment === '_whispers' || segment === '.mcpvault')) {
    throw guidanceError(new Error(`claim relation target must be an Obsidian note/block link, not a heading or scope URI: ${raw}`), 'guid-b05f7aeeb49a4a78');
  }
  return { raw, document, blockId };
}

export function blockAnchorLineIndex(content: string): Map<string, number[]> {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
  const matches = new Map<string, number[]>();
  let fence = '';
  let fenceLength = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fenced = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenced) {
      const markers = fenced[1]!;
      if (!fence) {
        fence = markers[0]!;
        fenceLength = markers.length;
      } else if (markers[0] === fence && markers.length >= fenceLength && fenced[2]!.trim() === '') {
        fence = '';
        fenceLength = 0;
      }
      continue;
    }
    if (!fence) {
      const anchor = /(?:^|\s)\^([a-z0-9_-]{1,80})\s*$/i.exec(line);
      if (anchor) {
        const key = anchor[1]!.toLocaleLowerCase();
        const anchorLines = matches.get(key) || [];
        anchorLines.push(index + 1);
        matches.set(key, anchorLines);
      }
    }
  }
  return matches;
}

/** Descriptive local profiles. Existing lint/preview retains severity, ACL and
 * bounded scope; this is not a SHACL engine or a new write-policy layer. */
export const GRAPH_VALIDATION_PROFILES = [
  { id: 'identity', checks: ['aliases', 'preferred_term', 'stable_id'], authority: 'existing_lint_preview' },
  { id: 'typed_target', checks: ['answers_questions', 'tests'], authority: 'existing_lint_preview' },
  { id: 'claim', checks: ['normalized_id', 'unique_id', 'block_anchor', 'relation_reference'], authority: 'existing_lint_preview' },
  { id: 'evidence', checks: ['source_revision', 'exact_locator'], authority: 'existing_lint_preview' },
  { id: 'cycles', checks: ['depends_on', 'moc_parent'], authority: 'existing_lint_preview' },
] as const;
