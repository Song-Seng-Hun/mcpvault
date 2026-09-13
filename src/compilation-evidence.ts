import type { EvidenceLocator } from './evidence-locator.js';
import { resolveEvidenceLocator } from './evidence-locator.js';
import type { FidelityFact } from './fidelity-service.js';
import type { CompilationInput } from './compilation-model.js';
import { compilationHash, compilationPath } from './compilation-policy.js';

export interface CompilationEvidence {
  query: string; decision: 'new_knowledge' | 'extend_existing' | 'already_covered' | 'conflicting' | 'uncertain';
  facts: Array<FidelityFact & { sourcePath: string }>;
  coverage: Array<{ sourcePath: string; locator: EvidenceLocator }>;
  rationale?: { constraints: string[]; rejectedAlternatives: Array<{ option: string; reason: string }>; failureConditions: string[] };
}
const revision = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const invalid = () => Error('Invalid compilation evidence');
function record(value: unknown, keys: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
  return value as Record<string, any>;
}
export function compilationLocator(value: unknown, expectedRevision: string): EvidenceLocator {
  const l = record(value, ['revision', 'startLine', 'endLine', 'quoteHash', 'heading', 'blockId']);
  if (!revision(l.revision) || l.revision !== expectedRevision || !revision(l.quoteHash)
    || !Number.isSafeInteger(l.startLine) || l.startLine < 1 || !Number.isSafeInteger(l.endLine) || l.endLine < l.startLine
    || l.endLine - l.startLine >= 64
    || l.heading !== undefined && (typeof l.heading !== 'string' || !l.heading.trim() || l.heading.length > 300)
    || l.blockId !== undefined && (typeof l.blockId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(l.blockId))) throw invalid();
  return l;
}
/** Bounds and pins reports. Actual source content, completeness and semantic
 * correspondence are checked separately; a client report is not a pass. */
export function normalizeCompilationEvidence(value: unknown, inputs: readonly CompilationInput[], draft: { content: string; fingerprint: string }): CompilationEvidence {
  const e = record(value, ['query', 'decision', 'facts', 'coverage', 'rationale']);
  if (typeof e.query !== 'string' || !e.query.trim() || e.query.length > 1000
    || !['new_knowledge', 'extend_existing', 'already_covered', 'conflicting', 'uncertain'].includes(e.decision)
    || !Array.isArray(e.facts) || !e.facts.length || e.facts.length > 32
    || !Array.isArray(e.coverage) || !e.coverage.length || e.coverage.length > 128
    || JSON.stringify(e).length > 24000) throw invalid();
  if (e.rationale !== undefined) {
    const r = record(e.rationale, ['constraints', 'rejectedAlternatives', 'failureConditions']);
    const text = (v: unknown) => typeof v === 'string' && Boolean(v.trim()) && v.length <= 300;
    for (const key of ['constraints', 'failureConditions']) if (!Array.isArray(r[key]) || r[key].length > 8 || !r[key].every(text)) throw invalid();
    if (!Array.isArray(r.rejectedAlternatives) || r.rejectedAlternatives.length > 8) throw invalid();
    for (const value of r.rejectedAlternatives) { const alternative = record(value, ['option', 'reason']);
      if (!text(alternative.option) || !text(alternative.reason)) throw invalid(); }
  }
  const source = (path: unknown) => {
    const p = compilationPath(path); const input = inputs.find(input => input.path === p && input.role === 'source');
    if (!input) throw invalid(); return input;
  };
  const ids = new Set<string>();
  for (const value of e.facts) {
    const f = record(value, ['id', 'kind', 'sourcePath', 'sourceLocator', 'outputLocator', 'comparisonMode', 'semanticJudgment']);
    if (typeof f.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(f.id) || ids.has(f.id)
      || !['condition', 'negation', 'counterexample', 'contradiction', 'number', 'date', 'version', 'quote'].includes(f.kind)
      || !['exact', 'translation', 'calculation', 'ambiguous_unit'].includes(f.comparisonMode)
      || !['preserved', 'missing', 'uncertain'].includes(f.semanticJudgment)) throw invalid();
    ids.add(f.id); compilationLocator(f.sourceLocator, source(f.sourcePath).revision);
    if (f.outputLocator !== undefined) {
      const output = compilationLocator(f.outputLocator, draft.fingerprint);
      if (!resolveEvidenceLocator(draft.content, output, draft.fingerprint).valid) throw invalid();
    }
  }
  for (const value of e.coverage) {
    const c = record(value, ['sourcePath', 'locator']); compilationLocator(c.locator, source(c.sourcePath).revision);
  }
  return structuredClone(e) as CompilationEvidence;
}
export function retainsCompilationObligations(previous: CompilationEvidence, next: CompilationEvidence): boolean {
  const basis = (f: CompilationEvidence['facts'][number]) => compilationHash({ id: f.id, kind: f.kind, sourcePath: f.sourcePath, sourceLocator: f.sourceLocator });
  return previous.facts.every(old => next.facts.some(f => basis(f) === basis(old)))
    && previous.coverage.every(old => next.coverage.some(c => compilationHash(c) === compilationHash(old)));
}
