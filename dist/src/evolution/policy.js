import { createHash } from 'node:crypto';
export const CAUSES = ['search', 'knowledge', 'procedure', 'expression', 'environment', 'tool_failure', 'unknown'];
export const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const unavailable = () => { throw Error('Evolution unavailable in the current scope'); };
export function object(v, keys) {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)))
        return unavailable();
    return v;
}
export const id = (v) => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(v) ? v : unavailable();
export const revision = (v) => v === 'missing' || typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : unavailable();
export function text(v, max = 1000) {
    if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))
        return unavailable();
    if (/\b(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|cookie)["']?\s*[:=]\s*\S|\bauthorization\s*:\s*(?:bearer|basic)\s+\S|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/i.test(v.normalize('NFKC')))
        return unavailable();
    return v;
}
export function target(v) {
    const r = object(v, ['kind', 'id', 'path']);
    if (!['skill', 'wiki', 'persona', 'computer', 'fiction'].includes(r.kind))
        return unavailable();
    return { kind: r.kind, id: id(r.id), ...(r.path === undefined ? {} : { path: text(r.path, 400) }) };
}
export function scope(v) {
    const r = object(v, ['kind', 'id']);
    if (!['account', 'owner', 'project', 'computer', 'scene', 'session'].includes(r.kind))
        return unavailable();
    return { kind: r.kind, id: id(r.id) };
}
export const STYLE_VALUES = Object.freeze({
    verbosity: ['brief', 'balanced', 'detailed'], tone: ['neutral', 'friendly', 'direct'],
    ordering: ['outcome_first', 'steps_first'], language: ['auto', 'en', 'ko'],
});
export function style(key, value) {
    if (typeof key !== 'string' || typeof value !== 'string' || !Object.hasOwn(STYLE_VALUES, key) || !STYLE_VALUES[key].includes(value))
        return unavailable();
    return { key, value };
}
export function normalizeFeedback(v, proof) {
    const r = object(v, ['id', 'taskId', 'sessionId', 'target', 'scope', 'kind', 'signal', 'key', 'value', 'summary', 'basis', 'cause']);
    const t = target(r.target), s = scope(r.scope), taskId = id(r.taskId), sessionId = id(r.sessionId);
    if (!['correction', 'preference', 'choice', 'dissatisfaction', 'fact_correction'].includes(r.kind)
        || !['explicit', 'implicit'].includes(r.signal) || !Array.isArray(r.basis) || r.basis.length > 16)
        return unavailable();
    const key = id(r.key), value = text(r.value, 600);
    const cause = r.cause ?? (t.kind === 'persona' ? 'expression' : 'unknown');
    if (!CAUSES.includes(cause))
        return unavailable();
    if (t.kind === 'persona')
        style(key, value);
    const basis = r.basis.map((b) => { const e = object(b, ['path', 'revision']); return { path: text(e.path, 400), revision: revision(e.revision) }; });
    if (basis.some((b) => b.revision === 'missing'))
        return unavailable();
    if (proof && (!['human', 'host_observation'].includes(proof.origin) || proof.taskId !== taskId || proof.sessionId !== sessionId
        || !Number.isFinite(Date.parse(proof.observedAt))))
        return unavailable();
    return { id: id(r.id), taskId, sessionId, target: t, scope: s, kind: r.kind, signal: r.signal, key, value,
        summary: text(r.summary), cause, basis, origin: proof?.origin ?? 'agent_report', eventId: proof ? id(proof.eventId) : id(r.id),
        observedAt: proof?.observedAt ?? new Date().toISOString(), withdrawn: false };
}
export const feedbackGroup = (f) => hash([f.target, f.scope, f.kind, f.key, f.value]);
export function repetitionReady(feedback, now) {
    const first = feedback[0];
    if (!first)
        return false;
    const valid = feedback.filter(f => !f.withdrawn && f.origin !== 'agent_report' && feedbackGroup(f) === feedbackGroup(first)
        && Date.parse(f.observedAt) <= now && Date.parse(f.observedAt) >= now - 30 * 86400000);
    return new Set(valid.map(f => f.eventId)).size >= 3 && new Set(valid.map(f => f.taskId)).size >= 3 && new Set(valid.map(f => f.sessionId)).size >= 2;
}
export function compareEvaluation(kind, e) {
    const result = (status, reason) => ({ status, reason });
    object(e, ['profileRevision', 'safety', 'targetCaseIds', 'cases', 'baselineTokens', 'candidateTokens', 'withoutSkillTokens', 'baselineMs', 'candidateMs', 'method', 'receiptHash']);
    if (e.method !== undefined && !['static', 'synthetic', 'agent_behavior', 'operational'].includes(e.method)
        || e.receiptHash !== undefined && !/^[a-f0-9]{64}$/.test(e.receiptHash))
        return result('review_required', 'invalid_evaluation_provenance');
    for (const c of e.cases ?? []) {
        object(c, ['id', 'split', 'baseline', 'candidate', 'withoutSkill']);
        id(c.id);
    }
    if (!e || !e.profileRevision || !Array.isArray(e.cases) || !e.cases.length || e.cases.length > 64 || !Array.isArray(e.targetCaseIds)
        || !e.targetCaseIds.length || new Set(e.cases.map(c => c.id)).size !== e.cases.length
        || e.cases.some(c => typeof c.baseline !== 'boolean' || typeof c.candidate !== 'boolean' || !['development', 'holdout'].includes(c.split))
        || e.targetCaseIds.some(id => !e.cases.some(c => c.id === id)) || !e.cases.some(c => c.split === 'holdout'))
        return result('review_required', 'incomplete_evaluation');
    if (e.safety !== true || e.cases.some(c => c.baseline && !c.candidate))
        return result('failed', 'safety_or_regression');
    if (e.cases.some(c => e.targetCaseIds.includes(c.id) && !c.candidate))
        return result('review_required', 'target_not_resolved');
    const cost = (a, b) => Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0 && b < a;
    if (kind === 'skill') {
        if (e.cases.some(c => typeof c.withoutSkill !== 'boolean'))
            return result('review_required', 'missing_skill_free_baseline');
        if (e.cases.every(c => c.withoutSkill || !c.candidate) && !cost(e.withoutSkillTokens, e.candidateTokens))
            return result('review_required', 'skill_unnecessary');
    }
    const improved = e.cases.some(c => e.targetCaseIds.includes(c.id) && !c.baseline && c.candidate);
    if (!improved && !cost(e.baselineTokens, e.candidateTokens) && !cost(e.baselineMs, e.candidateMs))
        return result('review_required', 'no_measured_improvement');
    return result('passed', 'target_or_cost_improved');
}
export function selectPreferences(items, context) {
    const rank = { owner: 0, account: 1, project: 2, computer: 2, scene: 2, session: 3 };
    const groups = new Map();
    for (const p of items) {
        if (!['owner', 'account'].includes(p.scope.kind) && context[p.scope.kind] !== p.scope.id)
            continue;
        const prior = groups.get(p.key) ?? [], best = prior[0];
        if (!best || rank[p.scope.kind] > rank[best.scope.kind])
            groups.set(p.key, [p]);
        else if (rank[p.scope.kind] === rank[best.scope.kind])
            groups.set(p.key, [...prior, p]);
    }
    const preferences = [], conflicts = [];
    for (const [key, group] of groups) {
        if (new Set(group.map(p => p.value)).size > 1)
            conflicts.push(key);
        else
            preferences.push(group[0]);
    }
    return { preferences: preferences.slice(0, 5), conflicts, partial: preferences.length > 5 };
}
