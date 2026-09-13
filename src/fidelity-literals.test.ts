import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkFidelityLiterals, checkFidelityPreservation } from './fidelity-literals.js';
import { fidelityDiagnosticCorpus } from '../tests/fixtures/fidelity-diagnostic-corpus.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const snapshot = (body: string) => ({ body, revision: hash(body) });
const locator = (body: string, startLine = 1, endLine = startLine) => ({
  revision: hash(body), startLine, endLine,
  quoteHash: hash(body.split('\n').slice(startLine - 1, endLine).join('\n')),
});
const pair = (source: string, output: string) => ({ source: snapshot(source), output: snapshot(output),
  sourceLocator: locator(source), outputLocator: locator(output), comparisonMode: 'exact' as const });

describe('separate verbatim preservation without semantic promotion', () => {
  it.each(['승인된 요청만 실행한다. 외부 전송은 금지한다. 🙂', 'Only approved requests may proceed.'])('preserves exact prose: %s', body => {
    expect(checkFidelityPreservation(pair(body, body), 'condition')).toMatchObject({
      preserved: true, verbatim: 'match', literal: { status: 'out_of_scope' }, semanticJudgment: 'not_assessed' });
    expect(checkFidelityLiterals(pair(body, body)).status).toBe('out_of_scope');
  });
  it.each(['condition', 'negation', 'counterexample', 'contradiction'] as const)('matching numbers do not establish %s preservation', kind => {
    expect(checkFidelityPreservation(pair('Only if approved, allow 12.', 'Allow 12.'), kind)).toMatchObject({
      preserved: false, verbatim: 'different', literal: { status: 'match' } });
  });
  it('does not promote exclusions, blank spans, or translation to verbatim approval', () => {
    for (const body of ['`Do not send.`', '    Do not send.', '']) {
      expect(checkFidelityPreservation(pair(body, body), 'negation').preserved).toBe(false);
    }
    expect(checkFidelityPreservation({ ...pair('Do not send.', 'Do not send.'), comparisonMode: 'translation' }, 'negation').preserved).toBe(false);
  });
  it('requires exact locators and emits no selected prose', () => {
    const args = pair('Do not send.', 'Do not send.');
    expect(checkFidelityPreservation({ ...args, outputLocator: { ...args.outputLocator, quoteHash: hash('other') } }, 'negation')).toMatchObject({ preserved: false, verbatim: 'unavailable' });
    expect(JSON.stringify(checkFidelityPreservation(args, 'negation'))).not.toContain('Do not send');
  });
});

describe('fixed synthetic diagnostic specification (not model-quality evaluation)', () => {
  it('keeps the reviewed 24-case diagnostic basis fixed independently of retrieval80', () => {
    expect(fidelityDiagnosticCorpus).toHaveLength(24);
    // Fixture review v2: restore four original no-literal bodies accidentally
    // changed during the worker's label correction. No checker change was made
    // to fit those inconsistent cases; the invalid first run is not an eval pass.
    expect(hash(JSON.stringify(fidelityDiagnosticCorpus))).toBe('84c2d7555b78c34c9ada9f5d8eecae623841d690a2614c2d048cef36d6bdcc9f');
  });
  it.each(fidelityDiagnosticCorpus)('$id has only the promised mechanical scope', c => {
    const result = checkFidelityLiterals({ ...pair(c.sourceBody, c.outputBody), comparisonMode: c.comparisonMode,
      sourceLocator: locator(c.sourceBody, c.sourceLine, c.sourceEnd), outputLocator: locator(c.outputBody, c.outputLine, c.outputEnd) });
    expect(result.status).toBe(c.expectedResult);
    expect(result.semanticJudgment).toBe('not_assessed');
  });
});

describe('fidelity literals are correspondence, not semantic truth', () => {
  it('checks exact Korean/emoji numeric, date, version and quote spans', () => {
    const body = '🙂 v2.3.1은 2026-09-13에 12회만 허용하며 “외부 전송 금지”를 유지한다.';
    const result = checkFidelityLiterals(pair(body, body));
    expect(result.status).toBe('match');
    expect(result.kinds).toEqual(['date', 'number', 'quote', 'version']);
    expect(result.semanticJudgment).toBe('not_assessed');
    expect(JSON.stringify(result)).not.toContain('외부 전송');
  });
  it.each([
    ['Limit 12.', 'Limit 13.'],
    ['As of 2026-09-13.', 'As of 2026-09-14.'],
    ['SDK v2.3.1.', 'SDK v2.3.2.'],
    ['Says “do not send”.', 'Says “send”.'],
    ['At least -5.', 'At least 5.'],
  ])('reports suspected divergence without claiming factual error: %s', (source, output) => {
    expect(checkFidelityLiterals(pair(source, output))).toMatchObject({ status: 'suspect', semanticJudgment: 'not_assessed' });
  });
  it('does not count a matching number outside the pinned output range', () => {
    const source = 'Limit 12.'; const output = 'Limit 13.\nUnrelated 12.';
    expect(checkFidelityLiterals(pair(source, output)).status).toBe('suspect');
  });
  it('cannot infer preserved conditions merely from matching literals', () => {
    const result = checkFidelityLiterals(pair('Only if approved, allow 12.', 'Allow 12.'));
    expect(result).toMatchObject({ status: 'match', semanticJudgment: 'not_assessed' });
  });
  it.each(['translation', 'calculation', 'ambiguous_unit'] as const)('does not hard-fail %s', comparisonMode => {
    expect(checkFidelityLiterals({ ...pair('1 day.', '24 hours.'), comparisonMode }).status).toBe('out_of_scope');
  });
  it.each([
    ['```text\nValue 12.\n```', 2],
    ['~~~~\n```\nValue 12.\n```\n~~~~', 3],
    ['    Value 12.', 1],
    ['Value `12`.', 1],
    ['---\ncollected_at: 2026-09-13\n---\nValue 12.', 2],
    ['## Examples\nValue 12.\n## Actual\nValue 13.', 2],
    ['## 수집 메타데이터\nValue 12.', 2],
    ['<!-- Value 12. -->', 1],
  ] as const)('marks excluded regions as incomplete instead of passing', (body, line) => {
    expect(checkFidelityLiterals({ ...pair(body, body), sourceLocator: locator(body, line), outputLocator: locator(body, line) }).status).toBe('out_of_scope');
  });
  it('handles CRLF locator hashes without changing original bytes', () => {
    const body = '# Body\r\nValue 12.\r\n';
    expect(checkFidelityLiterals({ ...pair(body, body), sourceLocator: locator(body, 2), outputLocator: locator(body, 2) }).status).toBe('match');
  });
  it('marks unpinned/stale/missing quote locators unavailable', () => {
    const args = pair('Value 12.', 'Value 12.');
    for (const sourceLocator of [{ ...args.sourceLocator, revision: hash('old') },
      { ...args.sourceLocator, quoteHash: hash('other') }, { startLine: 1, endLine: 1 }]) {
      expect(checkFidelityLiterals({ ...args, sourceLocator }).status).toBe('unavailable');
    }
    expect(checkFidelityLiterals({ ...args, output: undefined }).status).toBe('unavailable');
  });
  it('does not pass empty or over-budget coverage', () => {
    expect(checkFidelityLiterals(pair('No numeric claims.', 'No numeric claims.')).status).toBe('out_of_scope');
    expect(checkFidelityLiterals(pair('12 '.repeat(2000), '12 '.repeat(2000))).status).toBe('out_of_scope');
  });
  it('recognizes explicitly prefixed two-part versions', () => {
    expect(checkFidelityLiterals(pair('Use v2.3.', 'Use v2.4.')).kinds).toContain('version');
  });
  it.each([['Size 1 GB.', 'Size 1 GiB.'], ['Wait 1 day.', 'Wait 1 hour.'],
    ['Date 09/12.', 'Date 12/09.']])('does not silently approve ambiguous units or dates in exact mode', (source, output) => {
    expect(checkFidelityLiterals(pair(source, output)).status).toBe('out_of_scope');
  });
  it('does not treat link destinations as quoted factual content', () => {
    expect(checkFidelityLiterals(pair('[Reference](https://example.invalid/v2.3.1)', '[Reference](https://example.invalid/v2.3.1)')).status).toBe('out_of_scope');
  });
});
