import { resolveEvidenceLocator } from './evidence-locator.js';
import { buildMarkdownLiteralMask } from './backlinks.js';
import { parseDocumentStructure } from './document-structure.js';
const MAX_BODY_CHARS = 512 * 1024;
const result = (status, kinds = []) => ({ status, kinds, semanticJudgment: 'not_assessed' });
/** Pure local correspondence only. The caller must first establish current ACL,
 * immutable source integrity and revision. This never emits source text, decides
 * semantic preservation, grants publication, or invokes an external provider. */
export function checkFidelityLiterals(input) {
    const source = select(input.source, input.sourceLocator);
    const output = select(input.output, input.outputLocator);
    if (source.status === 'unavailable' || output.status === 'unavailable')
        return result('unavailable');
    if (source.status !== 'ready' || output.status !== 'ready' || input.comparisonMode !== 'exact')
        return result('out_of_scope');
    if (/\d\s*\/\s*\d/.test(source.text) || /\d\s*\/\s*\d/.test(output.text)
        || JSON.stringify(units(source.text)) !== JSON.stringify(units(output.text)))
        return result('out_of_scope');
    const a = literals(source.text), b = literals(output.text);
    const kinds = [...new Set([...a, ...b].map(value => value.slice(0, value.indexOf(':'))))].sort();
    if (!kinds.length)
        return result('out_of_scope');
    return result(JSON.stringify(a) === JSON.stringify(b) ? 'match' : 'suspect', kinds);
}
/** Verbatim preservation is distinct from literal correspondence and semantic
 * understanding. Natural-language obligations require the entire selected span
 * to survive unchanged; matching a number cannot establish a condition/negation.
 * This does not broaden the literal checker's scope or certify omitted facts. */
export function checkFidelityPreservation(input, kind) {
    const literal = checkFidelityLiterals(input);
    const source = select(input.source, input.sourceLocator), output = select(input.output, input.outputLocator);
    const verbatim = source.status === 'unavailable' || output.status === 'unavailable' ? 'unavailable'
        : source.status !== 'ready' || output.status !== 'ready' || input.comparisonMode !== 'exact'
            || !source.text?.trim() || !output.text?.trim() ? 'out_of_scope'
            : source.text === output.text ? 'match' : 'different';
    const prose = ['condition', 'negation', 'counterexample', 'contradiction'].includes(kind);
    const preserved = prose ? verbatim === 'match' : ['number', 'date', 'version', 'quote'].includes(kind) && literal.status === 'match';
    return { literal, verbatim, preserved, semanticJudgment: 'not_assessed' };
}
function select(snapshot, locator) {
    const unavailable = { status: 'unavailable' };
    const excluded = { status: 'out_of_scope' };
    if (!snapshot || typeof snapshot.body !== 'string' || !locator?.revision || !locator.quoteHash
        || !Number.isSafeInteger(locator.startLine) || !Number.isSafeInteger(locator.endLine))
        return unavailable;
    if (snapshot.body.length > MAX_BODY_CHARS)
        return excluded;
    const resolution = resolveEvidenceLocator(snapshot.body, locator, snapshot.revision);
    if (!resolution.valid || !resolution.startLine || !resolution.endLine)
        return unavailable;
    if (resolution.endLine - resolution.startLine >= 64)
        return excluded;
    let start = 0;
    for (let line = 1; line < resolution.startLine; line++)
        start = snapshot.body.indexOf('\n', start) + 1;
    let end = start;
    for (let line = resolution.startLine; line <= resolution.endLine; line++) {
        const next = snapshot.body.indexOf('\n', end);
        end = next < 0 ? snapshot.body.length : next;
        if (line < resolution.endLine)
            end++;
    }
    if (end - start > 4000)
        return excluded;
    try {
        const structure = parseDocumentStructure({ path: 'fidelity.md', raw: snapshot.body, revision: snapshot.revision });
        const mask = buildMarkdownLiteralMask(snapshot.body);
        for (const fragment of structure.fragments) {
            if (['code', 'frontmatter', 'html', 'definition'].includes(fragment.kind) || fragment.references.length
                || fragment.headingPath.some(heading => /^(?:examples?|samples?|예제|예시|metadata|source metadata|collection metadata|수집 메타데이터|메타데이터)(?:\s|$|:)/i.test(heading.trim()))) {
                mask.fill(1, fragment.startOffset, fragment.endOffset);
            }
        }
        // Never silently drop part of a requested span and label the remainder a pass.
        for (let offset = start; offset < end; offset++)
            if (mask[offset] && !/\s/.test(snapshot.body[offset]))
                return excluded;
        return { status: 'ready', text: snapshot.body.slice(start, end) };
    }
    catch {
        return excluded;
    }
}
function literals(text) {
    const found = new Set();
    // Mask previously recognized literals so dates/versions/quoted numbers aren't
    // also counted as independent numeric corroboration. No locale/unit coercion.
    let remaining = text;
    for (const [kind, pattern] of [
        ['quote', /"[^"\r\n]+"|“[^”\r\n]+”|«[^»\r\n]+»|「[^」\r\n]+」/g],
        ['date', /\d{4}-\d{2}-\d{2}|\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g],
        ['version', /(?:v\d+(?:\.\d+)+|\d+(?:\.\d+){2,})(?:-[A-Za-z0-9.-]+)?/g],
        ['number', /[+-]?\d+(?:,\d{3})*(?:\.\d+)?(?:[eE][+-]?\d+)?%?/g],
    ]) {
        remaining = remaining.replace(pattern, value => { found.add(`${kind}:${value}`); return ' '.repeat(value.length); });
    }
    return [...found].sort();
}
/** Different explicit units require an agent's unit/conversion review. The
 * conservative vocabulary is deliberately not a universal unit normalizer. */
function units(text) {
    const result = new Set();
    const pattern = /[+-]?\d+(?:\.\d+)?\s*(GiB|MiB|KiB|GB|MB|KB|bytes?|km|cm|mm|ms|seconds?|minutes?|hours?|days?|kg|mg|g|m|s|h|%)(?![A-Za-z])/g;
    for (const match of text.matchAll(pattern))
        result.add(match[1]);
    return [...result].sort();
}
