import type { CompilationJob } from './compilation-model.js';
import { compilationJobRevision } from './compilation-model.js';
import { endpointIdForTool } from './endpoint-registry.js';

/** Only call after authorizing every dependency. No draft bodies or semantic
 * guarantees: these are revision-pinned agent reports for the next read. */
export function compilationInspection(job: CompilationJob, base: Record<string, unknown>, maxChars: number,
  cursor: number, publicPath: (path: string) => string): Record<string, any> {
  const records: Array<Record<string, unknown>> = job.inputs.map(input => ({ type: 'input', role: input.role,
    path: publicPath(input.path), revision: input.revision, readAction: { endpointId: endpointIdForTool('get_note_outline'),
      arguments: { path: publicPath(input.path), expectedRevision: input.revision, maxChars: 4000 } } }));
  // Claims about decisions are attributed reports, never invented user consent.
  if (job.evidence) records.push({ type: 'assessment', attribution: 'agent_report', query: job.evidence.query,
    decision: job.evidence.decision, ...(job.evidence.rationale && { rationale: job.evidence.rationale }) });
  if (job.observation) records.push({ type: 'assessment', attribution: 'agent_report', kind: job.observation.kind,
    reason: job.observation.reason, ...(job.observation.query && { query: job.observation.query }) });
  for (const fact of job.evidence?.facts ?? []) records.push({ type: 'fact', ...fact, sourcePath: publicPath(fact.sourcePath) });
  for (const checkpoint of (job.evidence ?? job.observation)?.coverage ?? []) records.push({ type: 'checkpoint',
    ...checkpoint, sourcePath: publicPath(checkpoint.sourcePath) });
  for (const match of job.observation?.matches ?? []) records.push({ type: 'match', ...match,
    sourcePath: publicPath(match.sourcePath), knowledgePath: publicPath(match.knowledgePath) });
  if (cursor > records.length) throw Error('Invalid compilation inspection cursor');
  const selected: Array<Record<string, unknown>> = [];
  const revision = compilationJobRevision(job);
  const result = (next: number): Record<string, any> => {
    const { partial: _partial, nextAction: _action, ...status } = base;
    return { ...status, inspection: { attribution: 'agent_report', records: selected },
      ...(next < records.length && { partial: true, omissionReason: 'response_budget', nextAction: {
        endpointId: 'wiki.compilation', arguments: { op: 'read', requestId: job.requestId, includeInspection: true,
          inspectionCursor: next, expectedJobRevision: revision, maxChars: 12000 } } }) };
  };
  let next = cursor;
  while (next < records.length && selected.length < 24) {
    selected.push(records[next]!);
    if (JSON.stringify(result(next + 1)).length > maxChars) { selected.pop(); break; }
    next++;
  }
  const page = result(next);
  if (JSON.stringify(page).length <= maxChars) return page;
  // Keep the same cursor when an entry cannot fit. A larger budget resumes it;
  // never skip an obligation or expose an unbounded path to make progress.
  return { status: base.status, partial: true, omissionReason: 'response_budget', nextAction: {
    endpointId: 'wiki.compilation', arguments: { op: 'read', requestId: job.requestId, includeInspection: true,
      inspectionCursor: cursor, expectedJobRevision: revision, maxChars: 12000 } } };
}
