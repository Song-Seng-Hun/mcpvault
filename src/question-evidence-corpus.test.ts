import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { corpusQuestions } from '../tests/fixtures/question-corpus.js';
import { sha256, observation, rankPaths, scoreQuestion, summarize, promotionDecision,
  evaluationRequest, runEvaluationCell, compactSummary, measurementScope,
  type EvaluationSummary, type RetrievalMode } from '../tests/question-evaluation.js';
import {
  addedEvidenceNotes, addedEvidenceQuestions, evaluationNotes, evaluationQuestions,
  type EvidenceQuestion,
} from '../tests/fixtures/question-evidence-corpus.js';

// Fixed before any retrieval run/tuning. Updating gold to improve scores is forbidden.
const FROZEN_CORPUS_SHA256 = '719e175fab2f8d5d8e8dd93704b88ec145d155615db121ae3ac706baa0a19aef';
const ORIGINAL_FILE_SHA256 = '12bda4121ceb5a6aa57c42f74630790f93449dcd8137cf03b5d6d6a97d184589';
const ORIGINAL_QUERIES_SHA256 = 'c35868e415d3f8515a37f8c33127c1c44fe2181a01f7152b9520ba9fcf1c2ce8';

// Existing utility assertions are retained across extraction to the shared helper.
// New assertions precede helper changes; the main owner holds the execution slot.
describe('evidence evaluation utilities', () => {
  const a: EvidenceQuestion = { id: 'a', language: 'en', category: 'multisource', query: 'a', expectedPaths: ['a.md', 'b.md'], expectedEvidence: { 'a.md': ['Alpha'], 'b.md': ['Beta'] }, forbiddenPaths: [] };
  const none: EvidenceQuestion = { id: 'none', language: 'ko', category: 'noanswer', query: 'none', expectedPaths: [], expectedEvidence: {}, forbiddenPaths: [] };
  const b: EvidenceQuestion = { id: 'b', language: 'en', category: 'negative-condition', query: 'b', expectedPaths: ['b.md'], expectedEvidence: { 'b.md': ['Beta'] }, forbiddenPaths: ['wrong.md'] };

  test('macro recall and MRR exclude interleaved zero-relevant questions', () => {
    const result = summarize([a, none, b], [
      observation({ sources: [{ path: 'a.md', passages: [{ text: 'Alpha' }] }] }),
      observation({ sources: ['noise.md'] }),
      observation({ sources: ['noise.md', { path: 'b.md', passages: [{ text: 'Beta' }] }] }),
    ]);
    expect(result.overall.answerable).toBe(2);
    expect(result.overall.recallAt5).toBe(0.75);
    expect(result.overall.mrr).toBe(0.75);
    expect(result.overall.evidenceCoverage).toBeCloseTo(2 / 3);
    expect(result.perLanguage.en.recallAt5).toBe(0.75);
    expect(result.perLanguage.ko.answerable).toBe(0);
    expect(result.perLanguage.ko.recallAt5).toBeNull();
    expect(result.perLanguage.mixed.queries).toBe(0);
    expect(result.overall.noAnswerFalsePositiveQueries).toBe(1);
  });

  test('evidence must occur literally within one passage at its gold path', () => {
    const question: EvidenceQuestion = { ...b, expectedEvidence: { 'b.md': ['only safe requests'] } };
    for (const packet of [
      { sources: [{ path: 'wrong.md', passages: [{ text: 'only safe requests' }] }] },
      { candidates: ['b.md'], passages: [{ text: 'only safe requests' }] },
      { sources: [{ path: 'b.md', passages: [{ text: 'only safe' }, { text: 'requests' }] }] },
    ]) expect(summarize([question], [observation(packet)]).overall.evidenceCoverage).toBe(0);
    const duplicate = { path: 'b.md', passages: [{ text: 'Use only safe requests.' }] };
    expect(summarize([question], [observation({ sources: [duplicate, duplicate] })]).overall.evidenceFound).toBe(1);
  });

  test('deduplicates ranks and limits only Recall, not MRR, to five', () => {
    const question: EvidenceQuestion = { ...b, expectedPaths: ['b.md'] };
    expect(rankPaths({ sources: ['a.md', 'a.md'], candidates: ['b.md'] })).toEqual(['a.md', 'b.md']);
    const result = summarize([question], [observation({ sources: ['1', '2', '3', '4', '5', 'b.md'] })]);
    expect(result.overall.recallAt5).toBe(0);
    expect(result.overall.mrr).toBeCloseTo(1 / 6);
  });

  test('counts forbidden and no-answer paths beyond rank five without double counting', () => {
    const result = summarize([b, none], [
      observation({ sources: ['1', '2', '3', '4', '5', 'wrong.md'], candidates: ['wrong.md'] }),
      observation({ sources: ['noise.md'], candidates: ['noise.md', 'other.md'] }),
    ]);
    expect(result.overall.forbiddenFalsePositivePaths).toBe(1);
    expect(result.overall.noAnswerFalsePositivePaths).toBe(2);
    expect(result.overall.negativeFalsePositiveQueries).toBe(2);
    expect(result.falsePositiveKeys).toHaveLength(3);
  });

  test('rejects missing observations rather than silently improving denominators', () => {
    expect(() => summarize([a, b], [observation({})])).toThrow(/observation count/);
  });

  test('reports CPU, sampled memory, latency and serialized character counts', () => {
    const result = summarize([a, b], [
      { ...observation({}), latencyMs: 2, cpuUserMicros: 100, cpuSystemMicros: 50, heapDeltaBytes: -8, rssAfterBytes: 20, resultChars: 10 },
      { ...observation({}), latencyMs: 8, cpuUserMicros: 200, cpuSystemMicros: 70, heapDeltaBytes: 12, rssAfterBytes: 24, resultChars: 30 },
    ]);
    expect(result.overall.cost).toMatchObject({ meanLatencyMs: 5, p95LatencyMs: 8, cpuUserMicros: 300, cpuSystemMicros: 120, totalResultChars: 40, maxResultChars: 30, maxSampledRssBytes: 24, minHeapDeltaBytes: -8, maxHeapDeltaBytes: 12 });
  });

  test('promotion requires five percentage points, not five percent relative gain', () => {
    const base = summarize([b], [observation({ sources: ['b.md'] })]);
    const legacy = { ...base, overall: { ...base.overall, evidenceCoverage: 0.5 } };
    const candidate = (coverage: number): EvaluationSummary => ({ ...base, overall: { ...base.overall, evidenceCoverage: coverage } });
    expect(promotionDecision(legacy, candidate(0.525)).promote).toBe(false);
    expect(promotionDecision(legacy, candidate(0.55)).promote).toBe(true);
  });

  test('a language regression blocks promotion even with a large overall gain', () => {
    const base = summarize([b], [observation({ sources: ['b.md'] })]);
    for (const metric of ['recallAt5', 'mrr', 'evidenceCoverage'] as const) {
      const candidate: EvaluationSummary = { ...base,
        overall: { ...base.overall, evidenceCoverage: 1 },
        perLanguage: { ...base.perLanguage, en: { ...base.perLanguage.en, [metric]: -0.1 } },
      };
      expect(promotionDecision(base, candidate).reasons).toContain(`en.${metric}_regressed`);
    }
  });

  test('a new false positive blocks promotion even if total false positives do not grow', () => {
    const legacy = summarize([b], [observation({ sources: ['wrong.md'] })]);
    const candidate: EvaluationSummary = { ...legacy, overall: { ...legacy.overall, evidenceCoverage: 1 }, falsePositiveKeys: ['new-case:new-path'] };
    expect(promotionDecision(legacy, candidate).reasons).toContain('additional_false_positive');
  });

  test('gate failure is a report value, not an evaluation correctness assertion', () => {
    const base = summarize([b], [observation({})]);
    expect(promotionDecision(base, base)).toMatchObject({ promote: false, reasons: ['overall_evidence_gain_below_5pp'] });
  });

  test('requests compare omitted legacy, evidence without depth and opt-in depth two without gold hints', () => {
    const input = { query: 'routing token', expectedPaths: ['secret-gold.md'], path: 'secret-gold.md' };
    const common = { query: input.query, includeSemantic: false, maxChars: 4000 };
    expect(evaluationRequest('legacy', input.query, 4000)).toEqual(common);
    expect(evaluationRequest('evidence', input.query, 4000)).toEqual({ ...common, retrievalMode: 'evidence' });
    expect(evaluationRequest('graph', input.query, 4000)).toEqual({ ...common, retrievalMode: 'evidence', graphDepth: 2 });
  });
});

describe('frozen 80-question evidence evaluation', () => {
  test('preserves original bytes and questions, and freezes all notes, gold and negatives', async () => {
    const original = await readFile(new URL('../tests/fixtures/question-corpus.ts', import.meta.url));
    expect(sha256(original.toString('utf8').replace(/\r\n/g, '\n'))).toBe(ORIGINAL_FILE_SHA256);
    expect(sha256(JSON.stringify(corpusQuestions))).toBe(ORIGINAL_QUERIES_SHA256);
    expect(sha256(JSON.stringify({ notes: evaluationNotes, questions: evaluationQuestions }))).toBe(FROZEN_CORPUS_SHA256);
    expect(evaluationQuestions.slice(0, 40)).toEqual(corpusQuestions);
    expect(evaluationQuestions).toHaveLength(80);
    expect(addedEvidenceQuestions).toHaveLength(40);
    expect(new Set(evaluationQuestions.map(q => q.id)).size).toBe(80);
    expect(new Set(evaluationNotes.map(n => n.path)).size).toBe(evaluationNotes.length);
    expect([...new Set(addedEvidenceQuestions.map(q => q.category))].sort()).toEqual([
      'contradiction', 'identifier', 'multisource', 'negative-condition', 'noanswer', 'relation', 'stale', 'synonym',
    ]);
    for (const category of new Set(addedEvidenceQuestions.map(q => q.category))) {
      const group = addedEvidenceQuestions.filter(q => q.category === category);
      expect(group).toHaveLength(5);
      expect(group.filter(q => q.language === 'ko')).toHaveLength(2);
      expect(group.filter(q => q.language === 'en')).toHaveLength(2);
      expect(group.filter(q => q.language === 'mixed')).toHaveLength(1);
    }
    const paths = new Map(evaluationNotes.map(n => [n.path, n.content]));
    for (const q of evaluationQuestions) {
      expect(q.query.trim(), q.id).not.toBe('');
      expect(q.expectedPaths, q.id).toEqual([...new Set(q.expectedPaths)].sort());
      expect(Object.keys(q.expectedEvidence).sort(), q.id).toEqual(q.expectedPaths);
      for (const [path, fragments] of Object.entries(q.expectedEvidence)) {
        expect(fragments.length, q.id).toBeGreaterThan(0);
        for (const fragment of fragments) {
          expect(fragment.trim(), q.id).not.toBe('');
          expect(paths.get(path), `${q.id}: invented evidence at ${path}`).toContain(fragment);
        }
      }
      for (const forbidden of q.forbiddenPaths || []) {
        expect(paths.has(forbidden), q.id).toBe(true);
        expect(q.expectedPaths, q.id).not.toContain(forbidden);
      }
    }
    expect(addedEvidenceNotes.some(n => n.path.startsWith('_sources/'))).toBe(true);
  });

  test('compares legacy, evidence and graph depth two at 4000 and 12000 chars', async () => {
    const reports = [];
    for (const maxChars of [4000, 12000]) {
      const cells = new Map<RetrievalMode, Awaited<ReturnType<typeof runEvaluationCell>>>();
      // Alternate mode order; each cell gets a fresh fixture/server, then the
      // identical query sequence repeats on that same server.
      const order: RetrievalMode[] = maxChars === 4000 ? ['legacy', 'evidence', 'graph'] : ['graph', 'evidence', 'legacy'];
      for (const mode of order) cells.set(mode, await runEvaluationCell(mode, maxChars, evaluationNotes, evaluationQuestions));
      const passes = (['first', 'repeat'] as const).map(pass => {
        const legacy = summarize(evaluationQuestions, cells.get('legacy')![pass]);
        const evidence = summarize(evaluationQuestions, cells.get('evidence')![pass]);
        const graph = summarize(evaluationQuestions, cells.get('graph')![pass]);
        const decision = promotionDecision(legacy, evidence);
        expect(legacy.overall.queries).toBe(80);
        expect(evidence.overall.queries).toBe(80);
        expect(graph.overall.queries).toBe(80);
        return { pass, legacy, evidence, graph, decision,
          graphVsLegacy: promotionDecision(legacy, graph),
          graphVsEvidence: promotionDecision(evidence, graph),
          cases: evaluationQuestions.map((q, i) => ({ id: q.id, language: q.language, category: q.category,
            legacy: scoreQuestion(q, cells.get('legacy')![pass][i]!),
            evidence: scoreQuestion(q, cells.get('evidence')![pass][i]!),
            graph: scoreQuestion(q, cells.get('graph')![pass][i]!),
          })),
        };
      });
      // Keep the original first-pass fields and meaning for existing consumers.
      reports.push({ maxChars, order, ...passes[0]!, repeat: passes[1]!,
        setup: Object.fromEntries([...cells].map(([mode, cell]) => [mode, cell.setup])),
      });
      // Intentionally no expect(decision.promote).toBe(true): quality gates
      // must not turn a correctly measured unsuccessful experiment into red CI.
    }
    process.stdout.write(`\nQUESTION_EVIDENCE_EVALUATION ${JSON.stringify({
      corpusSha256: FROZEN_CORPUS_SHA256, originalQueriesSha256: ORIGINAL_QUERIES_SHA256,
      semantic: false, inference: 'untested_synthetic_lexical_only',
      measurement: measurementScope,
      graphContractLimits: { roots: 5, metadata: 40, bodies: 8, relations: 80, evidencePathsPerSource: 3 },
      promote: reports.every(report => report.decision.promote),
      graphPromoteVsLegacy: reports.every(report => report.graphVsLegacy.promote),
      graphPromoteVsEvidence: reports.every(report => report.graphVsEvidence.promote),
      reports: process.env.MCPVAULT_EVIDENCE_FULL_REPORT === '1' ? reports : reports.map(report => {
        const compact = (pass: typeof report.repeat) => ({
          pass: pass.pass, legacy: compactSummary(pass.legacy), evidence: compactSummary(pass.evidence), graph: compactSummary(pass.graph),
          decision: pass.decision, graphVsLegacy: pass.graphVsLegacy, graphVsEvidence: pass.graphVsEvidence,
        });
        return { maxChars: report.maxChars, order: report.order, setup: report.setup,
          ...compact(report), repeat: compact(report.repeat) };
      }),
    })}\n`);
  }, 240000);
});
