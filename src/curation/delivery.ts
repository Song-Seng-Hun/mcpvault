import { hash } from '../evolution/policy.js';

export interface CurationDelivery {
  actor: string; eventId: string; observedAt: number;
  documents: Array<{ document: string; revision: string }>;
}
export interface CurationDeliverySink { recordCurationDelivery(event: CurationDelivery): Promise<void> }
export interface CurationDeliveryFact { observedAt: number; revision: string }
export const curationActor = (account: string) => hash(['curation-account-v1', account]);
export const curationDocument = (path: string) => hash(['curation-document-v1', path]);

/** Positive server-result evidence only. Search cards, suggested reads and text
 * instructions never count as reading or using a document. No raw path persists. */
export function deliveredDocuments(endpoint: string, result: any): CurationDelivery['documents'] {
  if (result?.isError) return [];
  let data: any;
  try { data = JSON.parse(result?.content?.[0]?.text); } catch { return []; }
  let rows: any[] = [];
  if (endpoint === 'notes.read' || endpoint === 'continuity.resume') {
    if (typeof data?.content === 'string' && data.content.length) rows = [data];
  } else if (['memory.brief', 'memory.recall', 'memory.consolidate'].includes(endpoint) && Array.isArray(data?.items)) {
    rows = data.items.slice(0, 32).filter((r: any) => typeof r?.excerpt?.text === 'string' && r.excerpt.text.length);
  }
  return [...new Map(rows.filter(r => typeof r?.path === 'string' && r.path.length <= 1024 && /^[a-f0-9]{64}$/.test(r.revision))
    .map(r => [curationDocument(r.path), { document: curationDocument(r.path), revision: r.revision }])).values()];
}
