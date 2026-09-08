import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ScopePrincipal } from './scope-auth.js';
import type { WorkArtifact } from './agent-tasks.js';

export interface WorkBaseParams { principal?: ScopePrincipal; requestId?: string; expectedRevision?: string; expectedGeneration?: number; reason?: string }
export interface WorkProjectParams extends WorkBaseParams {
  op?: 'read' | 'create' | 'update'; projectId: string; title?: string; goal?: string; allowedWork?: string[];
  participants?: string[]; completionCriteria?: string[]; wipLimit?: number; personalWipLimit?: number; roomId?: string; maxChars?: number;
}
export interface WorkBoardParams { principal?: ScopePrincipal; projectId: string; limit?: number; maxChars?: number; cursor?: string }
export interface WorkPacketParams { principal?: ScopePrincipal; taskId: string; limit?: number; maxChars?: number; cursor?: string; knownRevision?: string }
export interface WorkClaimParams extends WorkBaseParams { op: 'claim' | 'start' | 'release'; taskId: string }
export interface WorkHandoffParams extends WorkBaseParams {
  op: 'propose' | 'accept'; taskId: string; toAccountId?: string; completed?: string; remaining?: string;
  blocker?: string; nextAction?: string; artifacts?: WorkArtifact[];
}
export interface WorkReviewParams extends WorkBaseParams {
  op: 'request' | 'approve' | 'changes_requested' | 'question' | 'override'; taskId: string; artifactFingerprint?: string;
}
export type Properties = Record<string, any>;
export const WORK_KINDS = ['general', 'security', 'permissions', 'shared_policy', 'destructive'] as const;
const canonicalStatus = (fm: Properties) => String(fm.status || '').trim().toLowerCase();
export const finished = (fm: Properties) => ['completed', 'cancelled'].includes(canonicalStatus(fm));
export const started = (fm: Properties) => !finished(fm) && Boolean(fm.started_at || ['in_progress', 'blocked', 'in_review'].includes(canonicalStatus(fm)));
export const displayIdentity = (p: ScopePrincipal) => p.agentId || p.modelId;
export const canonical = (value: unknown): string => JSON.stringify(order(value));
function order(value: any): any {
  if (Array.isArray(value)) return value.map(order);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, order(value[k])]));
  return value;
}
export const fingerprint = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const reviewBasis = (fm: Properties) => fingerprint({ description: fm.description, completionCriteria: fm.completion_criteria || [], artifacts: fm.artifacts || [], workKind: fm.work_kind, verification: fm.verification || '' });
export function textField(value: unknown, field: string, max = 500, required = false): string {
  if (value !== undefined && typeof value !== 'string') throw new Error(`${field} must be a string`);
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`${field} is required`);
  if (text.length > max) throw new Error(`${field} exceeds ${max} characters`);
  return text;
}
export function listField(value: unknown, field: string, max = 20, required = false): string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${field} must be an array of at most ${max} strings`);
  const list = [...new Set(value.map(v => textField(v, field, 500, true)))];
  if (required && !list.length) throw new Error(`${field} is required`);
  return list;
}
export function integer(value: unknown, fallback: number, max: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) throw new Error(`${field} must be an integer from 1 to ${max}`);
  return Number(value);
}

// A process-wide short queue also covers different FileSystemService instances
// for the same vault. Filesystem revision locks remain the final write gate.
let coordinator = Promise.resolve();
type CoordinationFrame = { active: boolean; children: Promise<void> };
const coordinationLease = new AsyncLocalStorage<CoordinationFrame>();
async function coordinatedFrame<T>(operation: () => Promise<T>): Promise<T> {
  const frame: CoordinationFrame = { active: true, children: Promise.resolve() };
  try { return await coordinationLease.run(frame, operation); }
  finally {
    // Stop admission before draining: a rejected Promise.all must not release
    // the root while an already admitted sibling is still writing.
    frame.active = false;
    await frame.children;
  }
}
export async function coordinate<T>(operation: () => Promise<T>): Promise<T> {
  // A paid-operation adapter can invoke the existing Work service while holding
  // the same short coordinator. Independent MCP requests never share this lease.
  const parent = coordinationLease.getStore();
  if (parent?.active) {
    const result = parent.children.then(() => coordinatedFrame(operation));
    parent.children = result.then(() => {}, () => {});
    return result;
  }
  const previous = coordinator;
  let release!: () => void;
  coordinator = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await coordinatedFrame(operation); } finally { release(); }
}

export interface WorkPage { items: Properties[]; total: number; truncated: boolean; cursor?: string; [key: string]: any }
/** Admission counts the complete JSON envelope, including the continuation. */
export function page(items: Properties[], context: Properties, signature: string, params: { limit?: number; maxChars?: number; cursor?: string }, kind: string): WorkPage {
  const limit = integer(params.limit, 20, 100, 'limit');
  const maxChars = integer(params.maxChars, 4000, 12000, 'maxChars');
  let offset = 0;
  if (params.cursor) {
    try {
      if (params.cursor.length > 1000) throw new Error();
      const decoded = JSON.parse(Buffer.from(params.cursor, 'base64url').toString('utf8'));
      if (decoded.f !== signature || decoded.k !== kind || !Number.isSafeInteger(decoded.o) || decoded.o < 0 || decoded.o >= items.length) throw new Error();
      offset = decoded.o;
    } catch { throw new Error('Cursor invalidated by changed inventory or context; restart the read'); }
  }
  const result: WorkPage = { ...context, items: [], total: items.length, truncated: offset < items.length };
  const setCursor = () => {
    result.truncated = offset + result.items.length < items.length;
    if (result.truncated) result.cursor = Buffer.from(JSON.stringify({ k: kind, f: signature, o: offset + result.items.length })).toString('base64url');
    else delete result.cursor;
  };
  setCursor();
  if (JSON.stringify(result).length > maxChars) throw new Error('maxChars is too small for the response envelope');
  for (const item of items.slice(offset, offset + limit)) {
    result.items.push(item); setCursor();
    if (JSON.stringify(result).length > maxChars) { result.items.pop(); setCursor(); break; }
  }
  if (!result.items.length && result.truncated) throw new Error('maxChars is too small for the next metadata item; increase maxChars');
  return result;
}
