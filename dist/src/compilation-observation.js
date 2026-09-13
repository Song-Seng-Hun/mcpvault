import { compilationPath } from './compilation-policy.js';
import { compilationLocator } from './compilation-evidence.js';
export function normalizeCompilationObservation(value, inputs, operation) {
    const invalid = () => Error('Invalid compilation observation');
    const record = (v, keys) => {
        if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)))
            throw invalid();
        return v;
    };
    const report = record(value, ['kind', 'reason', 'query', 'coverage', 'matches']);
    if (!['source_only', 'already_covered'].includes(report.kind) || typeof report.reason !== 'string'
        || !report.reason.trim() || report.reason.length > 1000 || JSON.stringify(report).length > 24000
        || !Array.isArray(report.coverage) || !report.coverage.length || report.coverage.length > 128
        || operation !== (report.kind === 'source_only' ? 'index' : 'synthesize'))
        throw invalid();
    const pinned = (path, role) => {
        const canonical = compilationPath(path), input = inputs.find(i => i.path === canonical && i.role === role);
        if (!input)
            throw invalid();
        return input;
    };
    for (const value of report.coverage) {
        const item = record(value, ['sourcePath', 'locator']);
        compilationLocator(item.locator, pinned(item.sourcePath, 'source').revision);
    }
    if (report.kind === 'source_only') {
        if (report.query !== undefined || report.matches !== undefined)
            throw invalid();
    }
    else {
        if (typeof report.query !== 'string' || !report.query.trim() || report.query.length > 1000
            || !Array.isArray(report.matches) || !report.matches.length || report.matches.length > 32)
            throw invalid();
        for (const value of report.matches) {
            const item = record(value, ['sourcePath', 'sourceLocator', 'knowledgePath', 'knowledgeLocator', 'semanticJudgment']);
            if (!['covered', 'uncertain'].includes(item.semanticJudgment))
                throw invalid();
            compilationLocator(item.sourceLocator, pinned(item.sourcePath, 'source').revision);
            compilationLocator(item.knowledgeLocator, pinned(item.knowledgePath, 'member').revision);
        }
    }
    return structuredClone(report);
}
