import { describe, it, expect } from 'vitest';
import { pdfDocumentStructure, pdfRangeProvenance } from './document-pdf.js';
const revision = 'a'.repeat(64), profile = `mcpvault-pdf-v1:${'b'.repeat(64)}`;
const response = () => ({ version: 1, sourceSha256: revision, profile,
  pages: [ { page: 1, text: 'First 😀\n조건', status: 'ok', gaps: [], regions: [{ startOffset: 0, endOffset: 8, bbox: [1, 2, 30, 40], kind: 'text' }] },
    { page: 2, text: '', status: 'failed', gaps: [{ code: 'no_extractable_text', severity: 'error' }], regions: [] } ],
  gaps: [], metrics: { totalPages: 2, requestedPages: 2, processedPages: 1, failedPages: 1, threads: 2, exitCode: 4, elapsedMs: 5, inputBytes: 50 } });
describe('PDF protocol and exact provenance', () => {
  it('binds original source bytes, page and bbox without inventing PDF source lines', () => {
    const doc = pdfDocumentStructure('x.pdf', revision, response());
    expect(doc.revision).toBe(revision);
    expect(doc.profile).toBe(profile);
    expect(doc.locator).toContain('extracted');
    expect(doc.gaps).toContain('page 2: no_extractable_text');
    expect(pdfRangeProvenance(doc, 0, 5)).toEqual([{ page: 1, startOffset: 0, endOffset: 5, bbox: [1, 2, 30, 40] }]);
    expect(doc.raw).toContain('First 😀');
    expect(doc.fragments.filter(f => f.kind === 'pdfPage')).toHaveLength(2);
  });
  it.each(['hash', 'profile', 'duplicate', 'missing', 'offset', 'bbox', 'surrogate'])('rejects malformed %s instead of caching it', kind => {
    const result: any = response();
    if (kind === 'hash') result.sourceSha256 = 'c'.repeat(64);
    if (kind === 'profile') result.profile = 'mcpvault-pdf-v1';
    if (kind === 'duplicate') result.pages[1].page = 1;
    if (kind === 'missing') result.pages.pop();
    if (kind === 'offset') result.pages[0].regions[0].endOffset = 900;
    if (kind === 'bbox') result.pages[0].regions[0].bbox[0] = NaN;
    if (kind === 'surrogate') result.pages[0].regions[0].endOffset = 7;
    expect(() => pdfDocumentStructure('x.pdf', revision, result)).toThrow();
  });
  it('retains failed pages as explicit gaps and deterministic structures', () => {
    expect(pdfDocumentStructure('x.pdf', revision, response())).toEqual(pdfDocumentStructure('x.pdf', revision, response()));
  });
  it('retains page-only provenance for unboxed intervals', () => {
    const result: any = response();
    result.pages[0].text = 'abcdefghij'; result.pages[0].regions = [{ startOffset: 0, endOffset: 3, bbox: [1,2,3,4], kind: 'text' }];
    expect(pdfRangeProvenance(pdfDocumentStructure('x.pdf', revision, result), 0, 10)).toEqual([
      { page: 1, startOffset: 0, endOffset: 3, bbox: [1,2,3,4] }, { page: 1, startOffset: 3, endOffset: 10 },
    ]);
  });
  it('never loses failed status merely because a warning exists', () => {
    const result: any = response(); result.pages[1].gaps = [{ code: 'reading_order_unverified', severity: 'warning' }];
    const doc = pdfDocumentStructure('x.pdf', revision, result);
    expect(doc.pdfPages?.[1]?.status).toBe('failed');
    expect(doc.gaps).toContain('page 2: page_extraction_failed');
  });
  it('bounds fragments across pages instead of resetting admission per page', () => {
    const result: any = response();
    result.pages = Array.from({ length: 4 }, (_, i) => ({ page: i+1, status: 'ok', text: 'x\n\n'.repeat(13000), gaps: [], regions: [] }));
    result.metrics.totalPages = 4;
    expect(() => pdfDocumentStructure('x.pdf', revision, result)).toThrow(/fragment.*budget/i);
  });
});
