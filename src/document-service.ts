import { guidanceError } from './guidance-runtime.js';
import type { DocumentIndex } from './document-index.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { DocumentStructure, DocumentFragment } from './document-structure.js';
import { documentLineAt, documentLineStarts, selectDocumentRanges, type DocumentRangeRequest, type DocumentRange } from './document-ranges.js';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fingerprint, page } from './work-model.js';
import { resourceBundleLocation, parseResourceBundleManifest } from './resource-bundle.js';
import { pdfRangeProvenance } from './document-pdf.js';
import { boundedHeadingLabel, documentPage } from './document-page.js';
import { withDocumentWork } from './document-work-memory.js';

export interface DocumentParams { path: string; expectedRevision?: string; principal?: ScopePrincipal; maxChars?: number }
export interface DocumentOutlineParams extends DocumentParams { parentId?: string; limit?: number; cursor?: string }
export interface DocumentReadParams extends DocumentParams, DocumentRangeRequest { ranges?: DocumentRangeRequest[]; cursor?: string; knownReads?: string[]; forceRead?: boolean }
export interface DocumentExportParams extends DocumentParams { startByte?: number; byteLength?: number }
export interface ResourceManifestParams extends DocumentParams { limit?: number; cursor?: string }
export interface ReadPart extends DocumentRange { text: string; startLine: number; endLine: number; receipt?: string;
  pdfProvenance?: ReturnType<typeof pdfRangeProvenance>; provenanceOmitted?: number }
export interface ReadResult {
  path: string; revision: string; profile: string; locator: string; context: string;
  parts: ReadPart[]; skippedRanges: number; truncated: boolean; pendingRanges: number;
  gaps?: string[]; gapsOmitted?: number;
  nextAction?: { endpointId: string; arguments: Omit<DocumentReadParams, 'principal'> };
}
const RANGE_KEYS = ['fragmentId', 'relation', 'edge', 'lineCount', 'startLine', 'endLine', 'startOffset', 'endOffset', 'mode'] as const;
const budget = (value?: number) => {
  const n = value ?? 4000;
  if (!Number.isSafeInteger(n) || n < 512 || n > 12000) throw guidanceError(new Error('maxChars must be 512..12000'), 'guid-4b78da01578248c7');
  return n;
};
const actor = (p?: ScopePrincipal) => p ? {
  accountId: p.accountId, modelId: p.modelId, agentId: p.agentId, userId: p.userId,
  commandCenterId: p.commandCenterId, role: p.role, sessionId: p.sessionId,
  generation: p.sessionGeneration, enterprise: p.enterprise,
} : null;
const rangeRequest = (input: DocumentRangeRequest): DocumentRangeRequest => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw guidanceError(new Error('Invalid document range'), 'guid-b823edb9533582c6');
  return Object.fromEntries(RANGE_KEYS.filter(k => input[k] !== undefined).map(k => [k, input[k]]));
};
const unicodeEnd = (raw: string, end: number) => end > 0 && end < raw.length && /[\uD800-\uDBFF]/.test(raw[end - 1]!) && /[\uDC00-\uDFFF]/.test(raw[end]!) ? end - 1 : end;
function subtract(range: DocumentRange, known: { startOffset: number; endOffset: number }[]): DocumentRange[] {
  let parts = [range];
  for (const k of known) parts = parts.flatMap(r => {
    if (k.endOffset <= r.startOffset || k.startOffset >= r.endOffset) return [r];
    return [ ...(k.startOffset > r.startOffset ? [{ ...r, endOffset: k.startOffset }] : []),
      ...(k.endOffset < r.endOffset ? [{ ...r, startOffset: k.endOffset }] : []) ];
  });
  return parts;
}
export function documentFragmentDescriptor(f: DocumentFragment) {
  return { id: f.id, kind: f.kind, startLine: f.startLine, endLine: f.endLine,
    startOffset: f.startOffset, endOffset: f.endOffset, headingPath: boundedHeadingLabel(f.headingPath), description: f.description.slice(0, 240),
    parent: f.parent, previous: f.previous, next: f.next, childrenCount: f.children.length,
    references: f.references.slice(0, 4).map(r => r.slice(0, 200)), referencesOmitted: Math.max(0, f.references.length - 4) };
}

/** Read-only projection shared by MCP and REST. Every call revalidates source and scope. */
export class DocumentService {
  private readonly signingKey = randomBytes(32);
  constructor(readonly index: DocumentIndex) {}
  private binding(doc: DocumentStructure, p?: ScopePrincipal) {
    return fingerprint({ path: doc.path, revision: doc.revision, profile: doc.profile, actor: actor(p) });
  }
  private sign(kind: string, binding: string, a: number, b: number): string {
    const payload = `${a.toString(36)}.${b.toString(36)}`;
    return `${payload}.${createHmac('sha256', this.signingKey).update(`${kind}\0${binding}\0${payload}`).digest('base64url')}`;
  }
  private verify(token: string, kind: string, binding: string): [number, number] {
    if (typeof token !== 'string' || token.length > 100 || !/^[0-9a-z]+\.[0-9a-z]+\.[A-Za-z0-9_-]{43}$/.test(token)) throw guidanceError(new Error(`Invalid ${kind}`), 'guid-972520f95c9d5dbd');
    const [first, second] = token.split('.');
    const a = parseInt(first!, 36), b = parseInt(second!, 36);
    const expected = this.sign(kind, binding, a, b);
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) throw guidanceError(new Error(`Stale or invalid ${kind}; repeat the current read`), 'guid-53dc7576cf9b1d6f');
    return [a, b];
  }
  async outline(params: DocumentOutlineParams) {
    return withDocumentWork(() => this.outlineWithinWork(params));
  }
  private async outlineWithinWork(params: DocumentOutlineParams) {
    const maxChars = budget(params.maxChars);
    if ((params.parentId || params.cursor) && !params.expectedRevision) throw guidanceError(new Error('expectedRevision is required for a fragment or cursor'), 'guid-66554315e040b071');
    const { structure: doc } = await this.index.load(params.path, params.principal, params.expectedRevision);
    if (params.parentId && !doc.fragments.some(f => f.id === params.parentId)) throw guidanceError(new Error('Stale document parent fragment'), 'guid-3c8ea2c73e83b0c4');
    const items = doc.fragments.filter(f => !params.parentId || f.parent === params.parentId);
    return documentPage(items, documentFragmentDescriptor, { path: this.index.reader.access.toPublicPath(doc.path), revision: doc.revision, profile: doc.profile,
      locator: doc.locator ?? 'source UTF-16 half-open offsets; one-based lines', title: doc.title.slice(0, 240),
      ...(doc.gaps && { gaps: doc.gaps.slice(0, 12), gapsOmitted: Math.max(0, doc.gaps.length - 12) }) },
    fingerprint({ binding: this.binding(doc, params.principal), parentId: params.parentId }), { ...params, maxChars }, 'documents.outline');
  }

  async read(params: DocumentReadParams): Promise<ReadResult> {
    return withDocumentWork(() => this.readWithinWork(params));
  }
  private async readWithinWork(params: DocumentReadParams): Promise<ReadResult> {
    const maxChars = budget(params.maxChars);
    if (params.ranges !== undefined && (!Array.isArray(params.ranges) || !params.ranges.length || params.ranges.length > 8)) throw guidanceError(new Error('ranges must contain 1..8 selections'), 'guid-b609b40e5e87ac09');
    if (params.ranges && RANGE_KEYS.some(k => params[k] !== undefined)) throw guidanceError(new Error('Use ranges or a single selection, not both'), 'guid-e6833ec64f3ace02');
    const requests = params.ranges ? params.ranges.map(rangeRequest) : [rangeRequest(params)];
    if ((requests.some(r => r.fragmentId !== undefined) || params.cursor) && !params.expectedRevision) throw guidanceError(new Error('expectedRevision is required for a fragment or cursor'), 'guid-66554315e040b071');
    if (params.knownReads !== undefined && (!Array.isArray(params.knownReads) || params.knownReads.length > 16)) throw guidanceError(new Error('knownReads must contain at most 16 receipts'), 'guid-cdfa2e99ee0ecb4d');
    if (params.forceRead !== undefined && typeof params.forceRead !== 'boolean') throw guidanceError(new Error('forceRead must be boolean'), 'guid-b27abdaedca1a1f6');
    const { structure: doc } = await this.index.load(params.path, params.principal, params.expectedRevision);
    const binding = this.binding(doc, params.principal);
    if (params.knownReads?.length && !params.principal?.sessionId) throw guidanceError(new Error('Reading receipts require an authenticated session'), 'guid-22ce2a1bdff8d193');
    const known = (params.knownReads ?? []).map(token => {
      const [startOffset, endOffset] = this.verify(token, 'receipt', binding);
      if (startOffset > endOffset || endOffset > doc.raw.length) throw guidanceError(new Error('Invalid receipt range'), 'guid-f4d91181977e148f');
      return { startOffset, endOffset };
    });
    const ranges: DocumentRange[] = []; let skippedRanges = 0;
    for (const request of requests) for (const selected of selectDocumentRanges(doc, request).ranges) {
      if (selected.startOffset === selected.endOffset) continue;
      const novel = subtract(selected, params.forceRead ? [] : known);
      if (!novel.length && selected.endOffset > selected.startOffset) skippedRanges++;
      for (const r of novel) ranges.push(...subtract(r, ranges));
    }
    ranges.sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
    const cursorBinding = fingerprint({ binding, requests, known: params.knownReads ?? [], force: params.forceRead ?? false });
    let position = 0, offset = ranges[0]?.startOffset ?? 0;
    if (params.cursor) {
      [position, offset] = this.verify(params.cursor, 'cursor', cursorBinding);
      if (position >= ranges.length || offset < ranges[position]!.startOffset || offset >= ranges[position]!.endOffset || unicodeEnd(doc.raw, offset) !== offset) throw guidanceError(new Error('Invalid read cursor range'), 'guid-520715b0cd13c871');
    }
    const starts = documentLineStarts(doc.raw);
    const publicPath = this.index.reader.access.toPublicPath(doc.path);
    const result: ReadResult = { path: publicPath, revision: doc.revision, profile: doc.profile,
      locator: doc.locator ?? 'source UTF-16 half-open offsets; one-based lines', context: 'structural only; completeness of meaning is not guaranteed',
      ...(doc.gaps && { gaps: doc.gaps.slice(0, 12), gapsOmitted: Math.max(0, doc.gaps.length - 12) }),
      parts: [], skippedRanges, truncated: false, pendingRanges: 0 };
    const continuation = (i: number, at: number) => {
      result.truncated = i < ranges.length; result.pendingRanges = Math.max(0, ranges.length - i);
      if (!result.truncated) { delete result.nextAction; return; }
      result.nextAction = { endpointId: 'documents.read', arguments: { path: publicPath, expectedRevision: doc.revision,
        ...(params.ranges ? { ranges: requests } : requests[0]), maxChars,
        ...(params.knownReads?.length && { knownReads: params.knownReads }), ...(params.forceRead && { forceRead: true }),
        cursor: this.sign('cursor', cursorBinding, i, at) } };
    };
    continuation(position, offset);
    if (!ranges.length && JSON.stringify(result).length > maxChars) throw guidanceError(new Error('maxChars is too small for the response envelope'), 'guid-e7e900d75fb8abff');
    for (; position < ranges.length; position++) {
      const range = ranges[position]!;
      offset = Math.max(offset, range.startOffset);
      const candidate = (end: number): ReadPart => {
        const provenance = pdfRangeProvenance(doc, offset, end);
        return ({ ...range, startOffset: offset, endOffset: end,
        startLine: documentLineAt(starts, offset), endLine: documentLineAt(starts, Math.max(offset, end - 1)), text: doc.raw.slice(offset, end),
        ...(provenance && { pdfProvenance: provenance.slice(0, 8), provenanceOmitted: Math.max(0, provenance.length - 8) }),
        ...(params.principal?.sessionId && { receipt: this.sign('receipt', binding, offset, end) }) });
      };
      // A terminal response drops the continuation envelope, so its size is
      // discontinuous. Probe the complete range separately before monotonic search.
      if (range.endOffset - offset <= maxChars) {
        result.parts.push(candidate(range.endOffset));
        continuation(position + 1, ranges[position + 1]?.startOffset ?? 0);
        if (JSON.stringify(result).length <= maxChars) { offset = ranges[position + 1]?.startOffset ?? 0; continue; }
        result.parts.pop();
      }
      // Count escaped text, locators, receipts and continuation together.
      let low = offset, high = Math.min(range.endOffset - 1, offset + maxChars), best = offset;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2), end = unicodeEnd(doc.raw, middle);
        result.parts.push(candidate(end));
        continuation(end === range.endOffset ? position + 1 : position, end === range.endOffset ? (ranges[position + 1]?.startOffset ?? 0) : end);
        const fits = JSON.stringify(result).length <= maxChars;
        result.parts.pop();
        if (fits) { best = end; low = middle + 1; } else high = middle - 1;
      }
      if (best === offset && range.endOffset > offset) {
        continuation(position, offset);
        if (!result.parts.length) throw guidanceError(new Error('maxChars is too small for the next source range; increase maxChars'), 'guid-225f68ff2c734005');
        return result;
      }
      result.parts.push(candidate(best));
      if (best < range.endOffset) { continuation(position, best); return result; }
      offset = ranges[position + 1]?.startOffset ?? 0;
      continuation(position + 1, offset);
    }
    return result;
  }

  async manifest(params: ResourceManifestParams) {
    return withDocumentWork(() => this.manifestWithinWork(params));
  }
  private async manifestWithinWork(params: ResourceManifestParams) {
    const maxChars = budget(params.maxChars);
    const snapshot = await this.index.reader.read(params.path, params.principal, { ...(params.expectedRevision !== undefined && { expectedRevision: params.expectedRevision }), decodeText: false });
    const bundle = resourceBundleLocation(snapshot.path);
    if (bundle?.relative === 'manifest.md') {
      const manifest = parseResourceBundleManifest(snapshot.text!, bundle.hash);
      const items = manifest.entries.map(entry => ({ ...entry, ...(entry.status === 'available' && {
        exportAction: { endpointId: 'resources.export', arguments: { path: this.index.reader.access.toPublicPath(`${bundle.root}/files/${entry.path}`), expectedRevision: entry.sha256 } },
      }) }));
      return page(items, { path: this.index.reader.access.toPublicPath(snapshot.path), revision: snapshot.revision,
        bundleRevision: bundle.hash, id: manifest.id, origin: manifest.origin, sourceVersion: manifest.sourceVersion,
        license: manifest.license, licenseFile: manifest.licenseFile, execution: 'never' },
      fingerprint({ revision: snapshot.revision, actor: actor(params.principal) }), { ...params, maxChars }, 'resources.manifest');
    }
    if (params.cursor) throw guidanceError(new Error('Resource manifest cursor requires a bundle manifest target'), 'guid-5ae513f3edc753f9');
    const result = { path: this.index.reader.access.toPublicPath(snapshot.path), revision: snapshot.revision,
      sha256: snapshot.revision, byteLength: snapshot.bytes.length, mediaType: snapshot.mediaType, execution: 'never',
      provenance: 'authoritative original bytes', license: 'not inferred; inspect the bundle license when supplied',
      exportAction: { endpointId: 'resources.export', arguments: { path: this.index.reader.access.toPublicPath(snapshot.path), expectedRevision: snapshot.revision } } };
    if (JSON.stringify(result).length > maxChars) throw guidanceError(new Error('maxChars is too small for the resource manifest'), 'guid-c771d764e17354ae');
    return result;
  }
  async export(params: DocumentExportParams) {
    return withDocumentWork(() => this.exportWithinWork(params));
  }
  private async exportWithinWork(params: DocumentExportParams) {
    const maxChars = budget(params.maxChars);
    const snapshot = await this.index.reader.read(params.path, params.principal, { ...(params.expectedRevision !== undefined && { expectedRevision: params.expectedRevision }), decodeText: false });
    const start = params.startByte ?? 0, length = params.byteLength ?? 2048;
    if (!Number.isSafeInteger(start) || start < 0 || start > snapshot.bytes.length || !Number.isSafeInteger(length) || length < 1 || length > 8192) throw guidanceError(new Error('Invalid export byte range'), 'guid-ab1318a8fc1cef67');
    if (start && !params.expectedRevision) throw guidanceError(new Error('expectedRevision is required for continuation exports'), 'guid-e5a07abfc6bd10c3');
    const path = this.index.reader.access.toPublicPath(snapshot.path);
    const make = (end: number) => ({ path, revision: snapshot.revision, mediaType: snapshot.mediaType, encoding: 'base64',
      startByte: start, endByte: end, totalBytes: snapshot.bytes.length, data: snapshot.bytes.subarray(start, end).toString('base64'),
      ...(end < snapshot.bytes.length && { nextAction: { endpointId: 'resources.export', arguments: { path,
        expectedRevision: snapshot.revision, startByte: end, byteLength: length, maxChars } } }) });
    let low = start, high = Math.min(snapshot.bytes.length, start + length), best = start;
    while (low <= high) { const middle = Math.floor((low + high) / 2); if (JSON.stringify(make(middle)).length <= maxChars) { best = middle; low = middle + 1; } else high = middle - 1; }
    const result = make(best);
    if (JSON.stringify(result).length > maxChars || (best === start && start < snapshot.bytes.length)) throw guidanceError(new Error('maxChars is too small for the export envelope'), 'guid-5b50eca9b77681cc');
    return result;
  }
}
