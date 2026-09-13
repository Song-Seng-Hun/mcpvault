import { createHash } from 'node:crypto';
import { GRAPH_CONTRACT_VERSION } from './graph-contract.js';
import { normalizeCompilationEvidence, type CompilationEvidence } from './compilation-evidence.js';
import { normalizeCompilationObservation, type CompilationObservation } from './compilation-observation.js';
import { compilationHash, compilationPath, COMPILATION_OPERATIONS, type CompilationOperation } from './compilation-policy.js';

export const COMPILATION_STATUSES = ['prepared', 'generated', 'checked', 'applying', 'applied', 'completed', 'partial', 'failed', 'review_required', 'stopped'] as const;
export type CompilationStatus = typeof COMPILATION_STATUSES[number];
export interface CompilationInput { path: string; revision: string; role: 'source' | 'member' | 'concept' | 'topic' }
export interface CompilationIntent { fingerprint: string; revision: string }
export interface CompilationJob {
  requestId: string; requestFingerprint: string; projectId: string; accountId: string; operation: CompilationOperation;
  inputs: CompilationInput[]; outputPath: string; outputRevision: string; ruleVersion: string;
  graphContractVersion: number; authorityFingerprint: string; status: CompilationStatus; attempts: number;
  protection: 'pending' | 'ready';
  reason?: string; draft?: { content: string; fingerprint: string; generatedAt?: string };
  evidence?: CompilationEvidence; refinements?: number;
  observation?: CompilationObservation;
  noWriteReceipt?: { kind: CompilationObservation['kind']; basis: string };
  validation?: { status: 'passed' | 'partial'; ruleVersion: string; basis: string };
  intent?: CompilationIntent;
  applied?: { outputRevision: string; basis: string };
  receipt?: { outputRevision: string; basis: string };
}
export interface CompilationHistory { version: 1; jobs: CompilationJob[] }
export const compilationContentHash = (content: string) => createHash('sha256').update(content).digest('hex');
export const isCompilationRevision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const compilationJobRevision = (job: CompilationJob) => compilationHash(job);
export const compilationValidationBasis = (job: CompilationJob) => compilationHash({ inputs: job.inputs, authority: job.authorityFingerprint,
  rule: job.ruleVersion, graph: job.graphContractVersion, draft: job.draft?.fingerprint, evidence: job.evidence, generatedAt: job.draft?.generatedAt, observation: job.observation });
export const compilationReceiptBasis = (job: CompilationJob) => compilationHash({ inputs: job.inputs, authority: job.authorityFingerprint,
  rule: job.ruleVersion, graph: job.graphContractVersion, draft: job.draft?.fingerprint, validation: job.validation, intent: job.intent,
  evidence: job.evidence, generatedAt: job.draft?.generatedAt, observation: job.observation });
export const compilationId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(value);

/** Strict bounded receipts. Unknown or damaged history is never silently reset. */
export function parseCompilationHistory(value: unknown): CompilationHistory {
  if (value === undefined) return { version: 1, jobs: [] };
  const invalid = () => Error('Compilation history unavailable; preserve it for host review');
  const record = (v: unknown, keys: string[]): Record<string, any> => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) throw invalid();
    return v as Record<string, any>;
  };
  try {
    const state = record(value, ['version', 'jobs']);
    if (state.version !== 1 || !Array.isArray(state.jobs) || state.jobs.length > 64) throw invalid();
    const ids = new Set<string>();
    for (const value of state.jobs) {
      const job = record(value, ['requestId', 'requestFingerprint', 'projectId', 'accountId', 'operation', 'inputs', 'outputPath', 'outputRevision',
        'ruleVersion', 'graphContractVersion', 'authorityFingerprint', 'status', 'attempts', 'protection', 'reason', 'draft', 'validation', 'intent', 'applied', 'receipt', 'evidence', 'refinements', 'observation', 'noWriteReceipt']);
      if (![job.requestId, job.projectId, job.accountId, job.ruleVersion].every(compilationId) || ids.has(job.requestId)
        || !isCompilationRevision(job.requestFingerprint) || !isCompilationRevision(job.authorityFingerprint)
        || !COMPILATION_OPERATIONS.includes(job.operation) || !COMPILATION_STATUSES.includes(job.status)
        || !Number.isInteger(job.attempts) || job.attempts < 0 || job.attempts > 3 || job.graphContractVersion !== GRAPH_CONTRACT_VERSION
        || !['pending', 'ready'].includes(job.protection) || job.reason !== undefined && !compilationId(job.reason)) throw invalid();
      ids.add(job.requestId); compilationPath(job.outputPath);
      if (job.outputRevision !== 'missing' && !isCompilationRevision(job.outputRevision)) throw invalid();
      if (!Array.isArray(job.inputs) || !job.inputs.length || job.inputs.length > 8) throw invalid();
      const paths = new Set<string>();
      for (const value of job.inputs) {
        const input = record(value, ['path', 'revision', 'role']); const path = compilationPath(input.path).toLowerCase();
        if (!isCompilationRevision(input.revision) || !['source', 'member', 'concept', 'topic'].includes(input.role)
          || paths.has(path) || path === job.outputPath.toLowerCase()) throw invalid();
        paths.add(path);
      }
      if (job.draft) {
        const draft = record(job.draft, ['content', 'fingerprint', 'generatedAt']);
        if (job.protection !== 'ready' || typeof draft.content !== 'string' || !draft.content.trim() || draft.content.length > 24000
          || draft.fingerprint !== compilationContentHash(draft.content)
          || draft.generatedAt !== undefined && (typeof draft.generatedAt !== 'string' || new Date(draft.generatedAt).toISOString() !== draft.generatedAt)) throw invalid();
      }
      if (job.refinements !== undefined && (!job.evidence || !Number.isInteger(job.refinements) || job.refinements < 0 || job.refinements > 1)) throw invalid();
      if (job.evidence) {
        if (!job.draft) throw invalid(); normalizeCompilationEvidence(job.evidence, job.inputs, job.draft);
      }
      if (job.observation) {
        if (job.protection !== 'ready' || job.draft || job.evidence || job.refinements !== undefined || job.intent || job.applied || job.receipt || job.attempts !== 0) throw invalid();
        normalizeCompilationObservation(job.observation, job.inputs, job.operation);
      }
      if (job.validation) {
        const validation = record(job.validation, ['status', 'ruleVersion', 'basis']);
        if (!['passed', 'partial'].includes(validation.status) || !compilationId(validation.ruleVersion)
          || validation.basis !== compilationValidationBasis(job as CompilationJob)) throw invalid();
      }
      if (job.intent) {
        const intent = record(job.intent, ['fingerprint', 'revision']);
        if (!isCompilationRevision(intent.fingerprint) || !isCompilationRevision(intent.revision) || !job.draft || job.validation?.status !== 'passed') throw invalid();
      }
      for (const proof of [job.applied, job.receipt]) if (proof) {
        const receipt = record(proof, ['outputRevision', 'basis']);
        if (!isCompilationRevision(receipt.outputRevision) || receipt.basis !== compilationReceiptBasis(job as CompilationJob)
          || receipt.outputRevision !== job.intent?.revision) throw invalid();
      }
      if (job.noWriteReceipt) {
        const receipt = record(job.noWriteReceipt, ['kind', 'basis']);
        if (!job.observation || job.validation?.status !== 'passed' || receipt.kind !== job.observation.kind
          || receipt.basis !== compilationReceiptBasis(job as CompilationJob)) throw invalid();
      }
      if (['generated', 'checked', 'completed'].includes(job.status) && !job.draft && !job.observation
        || ['checked', 'applying', 'applied', 'completed'].includes(job.status) && job.validation?.status !== 'passed'
        || ['applying', 'applied'].includes(job.status) && !job.intent
        || (job.status === 'applied' || job.receipt) && !job.applied
        || job.status === 'completed' && !job.receipt && !job.noWriteReceipt) throw invalid();
    }
    return structuredClone(state) as CompilationHistory;
  } catch { throw invalid(); }
}
