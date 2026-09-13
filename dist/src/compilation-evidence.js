import { resolveEvidenceLocator } from './evidence-locator.js';
import { compilationHash, compilationPath } from './compilation-policy.js';
const revision = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const invalid = () => Error('Invalid compilation evidence');
function record(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
        throw invalid();
    return value;
}
function locator(value, expectedRevision) {
    const l = record(value, ['revision', 'startLine', 'endLine', 'quoteHash', 'heading', 'blockId']);
    if (!revision(l.revision) || l.revision !== expectedRevision || !revision(l.quoteHash)
        || !Number.isSafeInteger(l.startLine) || l.startLine < 1 || !Number.isSafeInteger(l.endLine) || l.endLine < l.startLine
        || l.endLine - l.startLine >= 64
        || l.heading !== undefined && (typeof l.heading !== 'string' || !l.heading.trim() || l.heading.length > 300)
        || l.blockId !== undefined && (typeof l.blockId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(l.blockId)))
        throw invalid();
    return l;
}
/** Bounds and pins reports. Actual source content, completeness and semantic
 * correspondence are checked separately; a client report is not a pass. */
export function normalizeCompilationEvidence(value, inputs, draft) {
    const e = record(value, ['query', 'decision', 'facts', 'coverage']);
    if (typeof e.query !== 'string' || !e.query.trim() || e.query.length > 1000
        || !['new_knowledge', 'extend_existing', 'already_covered', 'conflicting', 'uncertain'].includes(e.decision)
        || !Array.isArray(e.facts) || !e.facts.length || e.facts.length > 32
        || !Array.isArray(e.coverage) || !e.coverage.length || e.coverage.length > 128
        || JSON.stringify(e).length > 24000)
        throw invalid();
    const source = (path) => {
        const p = compilationPath(path);
        const input = inputs.find(input => input.path === p && input.role === 'source');
        if (!input)
            throw invalid();
        return input;
    };
    const ids = new Set();
    for (const value of e.facts) {
        const f = record(value, ['id', 'kind', 'sourcePath', 'sourceLocator', 'outputLocator', 'comparisonMode', 'semanticJudgment']);
        if (typeof f.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(f.id) || ids.has(f.id)
            || !['condition', 'negation', 'counterexample', 'contradiction', 'number', 'date', 'version', 'quote'].includes(f.kind)
            || !['exact', 'translation', 'calculation', 'ambiguous_unit'].includes(f.comparisonMode)
            || !['preserved', 'missing', 'uncertain'].includes(f.semanticJudgment))
            throw invalid();
        ids.add(f.id);
        locator(f.sourceLocator, source(f.sourcePath).revision);
        if (f.outputLocator !== undefined) {
            const output = locator(f.outputLocator, draft.fingerprint);
            if (!resolveEvidenceLocator(draft.content, output, draft.fingerprint).valid)
                throw invalid();
        }
    }
    for (const value of e.coverage) {
        const c = record(value, ['sourcePath', 'locator']);
        locator(c.locator, source(c.sourcePath).revision);
    }
    return structuredClone(e);
}
export function retainsCompilationObligations(previous, next) {
    const basis = (f) => compilationHash({ id: f.id, kind: f.kind, sourcePath: f.sourcePath, sourceLocator: f.sourceLocator });
    return previous.facts.every(old => next.facts.some(f => basis(f) === basis(old)))
        && previous.coverage.every(old => next.coverage.some(c => compilationHash(c) === compilationHash(old)));
}
