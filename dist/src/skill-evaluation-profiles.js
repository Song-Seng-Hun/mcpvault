import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { proceduralLines } from './skill-evaluation.js';
/**
 * Trusted, deterministic DOCUMENT contract evaluation for the admitted local TDD
 * skill. A true case means the specified text/ordering is present in visible
 * procedure text. It does not establish that a model follows the procedure,
 * that a command succeeded, or that a deployment is admitted by the live host.
 *
 * Exact clauses and conservative quotation handling can produce false negatives.
 * Contradictions elsewhere and arbitrary semantic edits require host-authorized
 * admin review; even six true cases cannot authorize promotion by themselves.
 * The existing host
 * approval, revision and attestation checks remain the promotion authority.
 *
 * Keep policy literals and local helpers inside this callback so the existing
 * profile fingerprint binds them. The imported parser is bound in revision.
 * Candidate text is data only: no imports, commands, model calls or file reads.
 */
const evaluateLocalTddDocument = async (input) => {
    if (!input || input.skillId !== 'local-test-driven-development'
        || typeof input.baseline !== 'string' || input.baseline.length > 32_768
        || typeof input.candidate !== 'string' || input.candidate.length > 32_768
        || !(input.signal instanceof AbortSignal)) {
        throw guidanceError(new Error('Invalid skill document evaluation input'), 'guid-abf312fb0162c3a7');
    }
    const checkAbort = () => {
        if (input.signal.aborted)
            throw guidanceError(new Error('Skill document evaluation aborted'), 'guid-6c42c7767e126ce8');
    };
    const inspect = (content) => {
        checkAbort();
        const sourceLines = content.split(/\r?\n/);
        let body = content;
        if (/^\uFEFF?---[ \t]*$/.test(sourceLines[0])) {
            const close = sourceLines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line));
            body = close < 0 ? '' : sourceLines.slice(close + 1).join('\n');
        }
        // Consume complete top-level fences before interpreting their contents as
        // comments or blockquotes. Those filters must never drop a closing delimiter
        // and accidentally expose the contents of an adjacent fenced block.
        // proceduralLines preserves blank lines outside the consumed fences.
        const unfenced = proceduralLines(body).join('\n');
        // Preserve whitespace and line boundaries when hiding comments. An unclosed
        // comment hides the tail.
        const uncommented = unfenced.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => comment.replace(/[^\n]/g, ' '));
        // A Markdown blockquote paragraph can continue without another > marker.
        // Conservatively hide its entire run until an unquoted blank line.
        let inBlockQuote = false;
        const unquotedBlocks = uncommented.split(/\r?\n/).map((line) => {
            if (/^ {0,3}>/.test(line)) {
                inBlockQuote = true;
                return '';
            }
            if (!line.trim())
                inBlockQuote = false;
            return inBlockQuote ? '' : line;
        }).join('\n');
        const visibleLines = unquotedBlocks.split(/\r?\n/).map((line) => {
            if (/^(?: {4}|\t)/.test(line))
                return '';
            return line.trim();
        });
        // Do not split quoted examples into apparently independent instructions.
        // Exclude whole paragraphs touched by a quotation; carry an open quotation
        // across line/paragraph breaks. This intentionally also excludes unquoted
        // prose sharing that paragraph. Contraction apostrophes are not delimiters.
        const quotationClosers = {
            '"': '"', "'": "'", '\u201c': '\u201d', '\u201d': '\u201d',
            '\u2018': '\u2019', '\u2019': '\u2019', '`': '`',
        };
        let closingQuote;
        const lines = visibleLines.join('\n').split(/\n\s*\n/).flatMap((paragraph) => {
            let quoted = closingQuote !== undefined;
            for (let index = 0; index < paragraph.length; index += 1) {
                const character = paragraph[index];
                if (/['\u2018\u2019]/.test(character)
                    && /[\p{L}\p{N}]/u.test(paragraph[index - 1] ?? '')
                    && /[\p{L}\p{N}]/u.test(paragraph[index + 1] ?? ''))
                    continue;
                if (closingQuote !== undefined) {
                    if (character === closingQuote)
                        closingQuote = undefined;
                }
                else if (quotationClosers[character] !== undefined) {
                    closingQuote = quotationClosers[character];
                    quoted = true;
                }
            }
            return quoted ? [''] : [...paragraph.split('\n'), ''];
        });
        const hasOrderedLines = (steps) => {
            let after = 0;
            for (const step of steps) {
                const found = lines.findIndex((line, index) => index >= after && line === step);
                if (found < 0)
                    return false;
                after = found + 1;
            }
            return true;
        };
        // Match complete unquoted sentences, including prefix and punctuation;
        // substring/keyword matches would count negated instructions.
        const sentences = new Set(lines.join('\n').split(/\n\s*\n/)
            .flatMap(paragraph => paragraph.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)));
        return [
            lines.includes('Write the test first. Watch it fail. Write minimal code to pass.'),
            hasOrderedLines([
                '### RED - Write Failing Test',
                'Write one minimal test showing what should happen.',
                '### Verify RED - Watch It Fail',
                '- Test fails (not errors)',
                '- Fails because feature missing (not typos)',
                '### GREEN - Minimal Code',
                'Write simplest code to pass the test.',
            ]),
            hasOrderedLines([
                '### GREEN - Minimal Code',
                'Write simplest code to pass the test.',
                '### Verify GREEN - Watch It Pass',
                '- Other tests still pass',
                '### REFACTOR - Clean Up',
                "Keep tests green. Don't add behavior.",
            ]),
            sentences.has('When a change depends on filesystem identity, private storage or a service account, first reproduce its local behavior with tests, then verify canonical paths and access under the actual service account before claiming deployment.'),
            sentences.has('Keep credentials out of test output.'),
            sentences.has('A passing sandbox test is not evidence of successful live admission.'),
        ];
    };
    checkAbort();
    const baseline = inspect(input.baseline);
    const candidate = inspect(input.candidate);
    checkAbort();
    return {
        risk: 'approval_required',
        cases: [
            'document-test-first',
            'document-red-before-green',
            'document-green-before-refactor',
            'document-host-identity',
            'document-credential-output',
            'document-live-evidence',
        ].map((id, index) => ({ id, baseline: baseline[index], candidate: candidate[index] })),
    };
};
/**
 * Host registration inventory, not automatic activation. Pass this list to
 * loadSkillEvolutionHostConfig; the host must explicitly select profile ID
 * `local-tdd-document-contract-v1`. No candidate can register an evaluator.
 *
 * The revision also binds the imported parser implementation, which the core
 * callback-source fingerprint cannot see. Change parser behavior or policy and
 * existing evaluations require fresh revision-bound evaluation/attestation.
 */
export function createTrustedSkillEvaluationProfiles() {
    const profile = Object.freeze({
        id: 'local-tdd-document-contract-v1',
        revision: createHash('sha256').update(JSON.stringify({
            evaluate: Function.prototype.toString.call(evaluateLocalTddDocument),
            proceduralLines: Function.prototype.toString.call(proceduralLines),
        })).digest('hex'),
        skillId: 'local-test-driven-development',
        caseIds: Object.freeze([
            'document-test-first',
            'document-red-before-green',
            'document-green-before-refactor',
            'document-host-identity',
            'document-credential-output',
            'document-live-evidence',
        ]),
        targetCaseIds: Object.freeze(['document-host-identity', 'document-credential-output', 'document-live-evidence']),
        maxDurationMs: 1_000,
        evaluate: evaluateLocalTddDocument,
    });
    return Object.freeze([profile]);
}
