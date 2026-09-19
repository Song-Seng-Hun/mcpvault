import { hash } from './policy.js';
import { MEMORY_ROLES } from '../memory-contract.js';

export const MEMORY_OBSERVED_ENDPOINTS = ['memory.brief', 'memory.recall', 'memory.consolidate', 'continuity.resume'];
export interface MemoryDeliveryEvidence {
  status: 'delivered' | 'not_needed' | 'route_only' | 'no_match' | 'unavailable';
  partial: boolean;
  resources: Array<{ resourceId: string; revision: string; role: string; startLine?: number; endLine?: number; reason?: string;
    contentHash: string; returnedChars: number; truncated: boolean }>;
  snapshot?: string;
}
const revision = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const reasons = new Set(['correction_target', 'literal_or_retrieval_cue', 'semantic_candidate_not_equivalence', 'selected_memory']);
const object = (v: unknown): Record<string, any> | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : undefined;

/** Parse only server-returned fields. Never traverse source text, basis or suggested future reads. */
export function memoryObservation(endpoint: string, result: unknown): MemoryDeliveryEvidence | undefined {
  if (!MEMORY_OBSERVED_ENDPOINTS.includes(endpoint)) return;
  const evidence: MemoryDeliveryEvidence = { status: 'unavailable', partial: false, resources: [] };
  const wire = object(result);
  if (wire?.isError) return evidence;
  let data: Record<string, any> | undefined;
  try { data = object(JSON.parse(wire?.content?.[0]?.text)); } catch { return evidence; }
  if (!data) return evidence;
  evidence.partial = data.truncated === true || data.status === 'partial';
  if (endpoint === 'continuity.resume') {
    if (data.exists === false) { evidence.status = 'no_match'; return evidence; }
    if (data.exists !== true || typeof data.path !== 'string' || !revision(data.revision)) return evidence;
    if (typeof data.content !== 'string' || !data.content.length) { evidence.status = 'route_only'; return evidence; }
    evidence.resources.push({ resourceId: hash(['memory-resource-v1', data.path]), revision: data.revision, role: 'working',
      contentHash: hash(data.content), returnedChars: data.content.length, truncated: evidence.partial });
  } else {
    if (!Array.isArray(data.items)) return evidence;
    if (revision(data.snapshot)) evidence.snapshot = data.snapshot;
    if (data.items.length > 32) evidence.partial = true;
    for (const row of data.items.slice(0, 32)) {
      if (!object(row) || typeof row.path !== 'string' || !revision(row.revision) || !MEMORY_ROLES.includes(row.role)
        || !object(row.excerpt) || typeof row.excerpt.text !== 'string' || !row.excerpt.text.length
        || !Number.isSafeInteger(row.excerpt.startLine) || !Number.isSafeInteger(row.excerpt.endLine)
        || row.excerpt.startLine < 1 || row.excerpt.endLine < row.excerpt.startLine) { evidence.partial = true; continue; }
      evidence.partial ||= row.excerpt.truncated === true;
      evidence.resources.push({ resourceId: hash(['memory-resource-v1', row.path, typeof row.block_id === 'string' ? row.block_id : null]),
        revision: row.revision, role: row.role, startLine: row.excerpt.startLine, endLine: row.excerpt.endLine,
        contentHash: hash(row.excerpt.text), returnedChars: row.excerpt.text.length, truncated: row.excerpt.truncated === true,
        ...(reasons.has(row.matchReason) && { reason: row.matchReason }) });
    }
    if (!evidence.resources.length && ['not_needed', 'route_only', 'no_match'].includes(data.status)) evidence.status = data.status;
  }
  if (evidence.resources.length) evidence.status = 'delivered';
  return evidence;
}
