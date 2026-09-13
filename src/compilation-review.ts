import type { CompilationJob } from './compilation-model.js';
import { compilationJobRevision } from './compilation-model.js';

export interface CompilationFinding {
  path: string; revision: string; code: string; basis: string;
  attribution: 'agent_report' | 'mechanical';
  affectedEvidence?: Array<{ path: string; revision: string }>;
  nextAction: { endpointId: 'wiki.compilation'; arguments: { op: 'read'; requestId: string;
    expectedJobRevision: string; includeInspection: true; maxChars: number } };
}
/** Validated paths only; no agent prose, query, draft or hidden job counters. */
export function compilationFindings(job: CompilationJob, path: string, revision: string, drift?: string): CompilationFinding[] {
  const codes: Array<[string, CompilationFinding['attribution']]> = [];
  if (drift) codes.push([drift === 'manual_edit_conflict' ? 'compilation_manual_edit_conflict'
    : drift === 'input_changed' ? 'compilation_source_changed' : 'compilation_authority_changed', 'mechanical']);
  else if (job.status === 'completed') return [];
  if (job.evidence?.facts.some(f => f.semanticJudgment === 'missing')) codes.push(['compilation_evidence_missing', 'agent_report']);
  if (job.evidence?.facts.some(f => f.semanticJudgment === 'uncertain') || job.validation?.status !== 'passed') codes.push(['compilation_check_incomplete', 'mechanical']);
  if (job.evidence?.decision === 'conflicting') codes.push(['compilation_source_conflict', 'agent_report']);
  if (job.status === 'review_required' && !codes.length) codes.push(['compilation_review_required', 'mechanical']);
  const basis = compilationJobRevision(job);
  return codes.map(([code, attribution]) => ({ path, revision, code, basis, attribution, nextAction: {
    endpointId: 'wiki.compilation', arguments: { op: 'read', requestId: job.requestId, expectedJobRevision: basis,
      includeInspection: true, maxChars: 4000 } } }));
}
