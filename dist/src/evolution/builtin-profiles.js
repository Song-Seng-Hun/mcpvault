import { hash, style } from './policy.js';
import { validateHarness } from './harness.js';
// Public regression IDs, NOT independent hidden model-behavior tests.
const CASES = ['representative', 'boundary', 'mixed-language', 'secret-request', 'outside-scope',
    'forged-approval', 'malicious-reference', 'quoted-identifier', 'excluded-term', 'no-answer'];
/** First operational profiles measure real retrieval, but cannot auto-adopt on server-only savings. */
export function builtinEvolutionProfiles(retrieval, access) {
    return [{ kind: 'persona', revision: 'expression-setting-conformance-v1', method: 'static', measurementScope: 'returned_context',
            cases: CASES.map((name, i) => ({ id: name, split: i >= 7 ? 'holdout' : 'development', target: i < 3,
                run: async ({ cycle, variant }) => {
                    const value = variant === 'candidate' ? cycle.candidate : cycle.baseline.value;
                    let passed = false;
                    try {
                        const p = value;
                        passed = style(p.key, p.value).key === 'ordering' && p.value === 'outcome_first' && Object.keys(p).length === 2;
                    }
                    catch { /* not admissible */ }
                    return { passed, safety: variant !== 'candidate' || passed, resultHash: hash([name, value, 'static-not-behavior']) };
                },
            })) }, { kind: 'harness', revision: 'bounded-retrieval-v1', method: 'synthetic', repetitions: 3,
            measurementScope: 'search_server', adoption: 'diagnostic', cases: CASES.map((name, i) => ({
                id: name, split: i >= 7 ? 'holdout' : 'development', target: i < 3,
                run: async ({ cycle, variant, principal, signal }) => {
                    if (!principal || !cycle.basis.length)
                        throw Error('Current readable revision basis required');
                    const source = cycle.basis[0];
                    // A path is query data, never query syntax supplied by a candidate.
                    if (/["\r\n]/.test(source.path))
                        throw Error('Unsupported evaluation path quoting');
                    const physical = access.resolveExternalPath(source.path, principal);
                    if (!access.canAccessPhysicalPath(physical, principal) || !access.canReadProtectedDocument(physical, principal))
                        throw Error('Evaluation source unavailable');
                    const candidate = validateHarness(cycle.candidate);
                    const baseline = cycle.baseline.value?.profile ?? { ...candidate, maxChars: 4000 };
                    if (candidate.modelId !== principal.modelId || candidate.maxChars !== 2000
                        || baseline.maxChars !== 4000 || hash({ ...candidate, maxChars: 4000 }) !== hash(baseline))
                        throw Error('Only the 4000 to 2000 budget hypothesis is supported');
                    const query = `path:"${source.path}"` + (i === 2 ? ' OR path:"__unmatched_한국어_identifier__"'
                        : i === 8 ? ' -"__absent_exclusion__"' : i === 9 ? ' "__absent_exact_phrase__"' : '');
                    const maxChars = variant === 'candidate' ? candidate.maxChars : baseline.maxChars;
                    const run = () => retrieval.searchNotes({ query, maxChars, limit: 5, includeRevisions: true, semantic: false, principal });
                    signal.throwIfAborted();
                    await run(); // Same warm-up policy for each variant; not measured as a task improvement.
                    signal.throwIfAborted();
                    const start = performance.now(), results = await run();
                    signal.throwIfAborted();
                    const elapsedMs = performance.now() - start;
                    const found = results.some(hit => hit.rv === source.revision);
                    const passed = i === 9 ? results.length === 0 : found;
                    return { passed, safety: JSON.stringify(results).length <= maxChars, resultHash: hash(results), elapsedMs };
                },
            })) }];
}
