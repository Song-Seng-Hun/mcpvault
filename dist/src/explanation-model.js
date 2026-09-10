import { guidanceError } from './guidance-runtime.js';
import { fingerprint, textField } from './work-model.js';
export const EXPLANATION_CRITERIA = ['fidelity', 'coverage', 'no_invention', 'clarity'];
const object = (input, allowed) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k)))
        throw guidanceError(Error('Invalid explanation fields'), 'guid-e88ddeba59a5d72a');
    return input;
};
const normalized = (value) => value.replace(/\r\n?/g, '\n');
const sourceLines = (source) => {
    if (!source || typeof source.path !== 'string' || !source.path || source.path.length > 500 || !/^[a-f0-9]{64}$/.test(source.revision)
        || typeof source.content !== 'string' || source.content.length > 64_000)
        throw guidanceError(Error('Invalid or oversized explanation source'), 'guid-4c4190550bcf410c');
    return normalized(source.content).split('\n');
};
/** Revision is authoritative. Content is checked separately by the source reader. */
export function explanationKey(source, language = 'ko', audience = 'beginner') {
    sourceLines(source);
    return fingerprint({ source: source.path, revision: source.revision, language: textField(language, 'language', 32, true), audience: textField(audience, 'audience', 80, true) });
}
/** Conservative protected-literal comparison, not a semantic truth detector.
 * All prose, including quoted examples, remains untrusted data. No expressions run.
 * Source commands/code must remain verbatim; numeric/API/path additions fail closed.
 */
function literals(value) {
    const found = new Set();
    for (const match of value.matchAll(/`([^`\n]+)`|\b\d+(?:[.:-]\d+)*\b|\b[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*\b|(?:https?:\/\/|(?:[A-Za-z]:)?[\\/])[\w./\\:-]+/g))
        found.add(match[1] ?? match[0]);
    return found;
}
function protectedCode(content) {
    const blocks = [];
    let fence;
    for (const line of normalized(content).split('\n')) {
        if (fence) {
            fence.lines.push(line);
            const end = line.match(/^ {0,3}(`+|~+)\s*$/);
            if (end && end[1][0] === fence.marker && end[1].length >= fence.length) {
                blocks.push(fence.lines.join('\n'));
                fence = undefined;
            }
        }
        else {
            const start = line.match(/^ {0,3}(`{3,}|~{3,})/);
            if (start)
                fence = { marker: start[1][0], length: start[1].length, lines: [line] };
        }
    }
    if (fence)
        blocks.push(fence.lines.join('\n'));
    return blocks;
}
export function validateExplanationDraft(input, source) {
    const value = object(input, ['blocks']), lines = sourceLines(source);
    if (!Array.isArray(value.blocks) || value.blocks.length < 1 || value.blocks.length > 24)
        throw guidanceError(Error('Explanation requires 1..24 mapped blocks'), 'guid-1a90aff603ddf4ae');
    const covered = new Set();
    let size = 0;
    const blocks = value.blocks.map(raw => {
        const b = object(raw, ['text', 'startLine', 'endLine', 'example']);
        const text = textField(b.text, 'explanation block', 3000, true);
        size += text.length;
        if (size > 24_000 || !Number.isInteger(b.startLine) || !Number.isInteger(b.endLine) || b.startLine < 1 || b.endLine < b.startLine || b.endLine > lines.length)
            throw guidanceError(Error('Invalid explanation source locator or size'), 'guid-4322d307a62703b3');
        if (b.example !== undefined && typeof b.example !== 'boolean')
            throw guidanceError(Error('Invalid example label'), 'guid-743c21d5b1cce717');
        const context = lines.slice(b.startLine - 1, b.endLine).join('\n');
        const expected = literals(context), actual = literals(text);
        if ([...actual].some(token => !expected.has(token)) || (!b.example && [...expected].some(token => !actual.has(token))))
            throw guidanceError(Error('Protected source literal changed, omitted or invented'), 'guid-83de2cbd405e28dc');
        // Conservative mechanical guard, not semantic verification. Keep the original
        // constraint beside its translation so a reviewer can check its exact meaning.
        const constraints = context.split(/(?<=[.!?])\s+|\n/).map(s => s.trim()).filter(s => /\b(?:if|unless|only|must|never|shall|cannot|prohibit|do not)\b|금지|해야|하지\s*마|경우|때만/.test(s.toLowerCase()));
        if (!b.example && constraints.some(s => !text.includes(s)))
            throw guidanceError(Error('Protected source constraint must remain verbatim beside the explanation'), 'guid-a0bb466d35c0c051');
        if (!b.example)
            for (let line = b.startLine; line <= b.endLine; line++)
                covered.add(line);
        const block = { text, startLine: b.startLine, endLine: b.endLine, ...(b.example !== undefined && { example: b.example }) };
        // JSON escapes controls and lone surrogates; character count alone does not
        // guarantee a block fits a bounded read together with its source envelope.
        if (JSON.stringify(block).length > 4000)
            throw guidanceError(Error('Explanation block serialized budget exceeded'), 'guid-50c37fcc579f19e9');
        return block;
    });
    // Headings can be represented by the explanation title. All substantive source
    // lines must be mapped; omission requires an explicitly smaller imported source.
    if (lines.some((line, index) => line.trim() && !/^\s*#{1,6}\s/.test(line) && !covered.has(index + 1)))
        throw guidanceError(Error('Explanation source coverage is incomplete'), 'guid-9cc164e7f30ba754');
    const rendered = blocks.filter(b => !b.example).map(b => b.text).join('\n');
    if (protectedCode(source.content).some(code => !rendered.includes(code)))
        throw guidanceError(Error('Protected source code block changed or omitted'), 'guid-78561fa1b6cafa4f');
    return { blocks };
}
export function validateExplanationReview(input, blockCount) {
    const value = object(input, ['checks']);
    if (!Number.isInteger(blockCount) || blockCount < 1 || blockCount > 24 || !Array.isArray(value.checks) || value.checks.length !== EXPLANATION_CRITERIA.length)
        throw guidanceError(Error('All explanation review criteria are required'), 'guid-6cd712c8c23e1925');
    const checks = value.checks.map(raw => {
        const c = object(raw, ['criterion', 'verdict', 'reason', 'blockIndices']);
        if (!EXPLANATION_CRITERIA.includes(c.criterion) || !['pass', 'changes', 'uncertain'].includes(c.verdict)
            || !Array.isArray(c.blockIndices) || !c.blockIndices.length || c.blockIndices.length > blockCount
            || new Set(c.blockIndices).size !== c.blockIndices.length || c.blockIndices.some((n) => !Number.isInteger(n) || Number(n) < 0 || Number(n) >= blockCount))
            throw guidanceError(Error('Invalid explanation review judgment or mapped evidence'), 'guid-6e0ad5923681e336');
        return { criterion: c.criterion, verdict: c.verdict, reason: textField(c.reason, 'review reason', 1200, true), blockIndices: [...c.blockIndices] };
    });
    if (new Set(checks.map(c => c.criterion)).size !== EXPLANATION_CRITERIA.length)
        throw guidanceError(Error('Duplicate or missing explanation criterion'), 'guid-ffadd35adb365dce');
    if (checks.some(c => c.verdict === 'pass' && c.blockIndices.length !== blockCount))
        throw guidanceError(Error('Passing criteria must cover every explanation block'), 'guid-0d29e009d634ef83');
    return { checks };
}
export function verifiedExplanationProfile(profiles, account) {
    const matches = profiles.filter(p => p.accountId === account), p = matches.length === 1 ? matches[0] : undefined;
    const family = p?.family?.trim().toLowerCase(), version = p?.version?.trim();
    return p?.hostVerified && family && family !== 'unknown' && version && version.toLowerCase() !== 'unknown' ? { ...p, family, version } : undefined;
}
/** Pin the execution identity/policy, not volatile prices or remaining budget. */
export function explanationProfileFingerprint(profiles, account) {
    const p = verifiedExplanationProfile(profiles, account);
    return p ? fingerprint({ policy: 'explanation-review-v1', accountId: p.accountId,
        provider: p.provider?.trim().toLowerCase() ?? '', family: p.family, version: p.version,
        reasoning: p.reasoning?.trim().toLowerCase() ?? '', tier: p.tier,
        tools: [...p.tools].sort(), capabilities: [...p.capabilities].sort() }) : undefined;
}
export function explanationApproval(input) {
    if (input.sourceRevision !== input.currentRevision)
        return { approved: false, reason: 'source_changed' };
    const profile = (account) => verifiedExplanationProfile(input.profiles, account);
    const author = profile(input.author), reviewer = profile(input.reviewer);
    if (input.author === input.reviewer || !author || !reviewer || author.family.toLowerCase() === reviewer.family.toLowerCase())
        return { approved: false, reason: 'independent_verified_family_required' };
    if (input.review.checks.length !== EXPLANATION_CRITERIA.length || new Set(input.review.checks.map(c => c.criterion)).size !== EXPLANATION_CRITERIA.length
        || input.review.checks.some(c => !EXPLANATION_CRITERIA.includes(c.criterion) || c.verdict !== 'pass'))
        return { approved: false, reason: 'review_incomplete_or_uncertain' };
    return { approved: true, reason: 'verified_cross_model' };
}
