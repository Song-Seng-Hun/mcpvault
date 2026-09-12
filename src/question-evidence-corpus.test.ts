import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import { corpusQuestions, type AnswerPacket, type CorpusLanguage } from '../tests/fixtures/question-corpus.js';
import {
  addedEvidenceNotes, addedEvidenceQuestions, evaluationNotes, evaluationQuestions,
  type EvidenceQuestion,
} from '../tests/fixtures/question-evidence-corpus.js';

// Fixed before any retrieval run/tuning. Updating gold to improve scores is forbidden.
const FROZEN_CORPUS_SHA256 = '719e175fab2f8d5d8e8dd93704b88ec145d155615db121ae3ac706baa0a19aef';
const ORIGINAL_FILE_SHA256 = '12bda4121ceb5a6aa57c42f74630790f93449dcd8137cf03b5d6d6a97d184589';
const ORIGINAL_QUERIES_SHA256 = 'c35868e415d3f8515a37f8c33127c1c44fe2181a01f7152b9520ba9fcf1c2ce8';
const languages = ['ko', 'en', 'mixed'] as const;

// Utility assertions were authored before their implementations below. Execution
// was deferred until the main owner granted a slot; no initial RED run is claimed.
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

  test('compares legacy and optional evidence mode at 4000 and 12000 chars', async () => {
    const reports = [];
    for (const maxChars of [4000, 12000]) {
      const cells = new Map<RetrievalMode, Observation[]>();
      // Alternate which mode runs first; fresh fixture/server for every cell.
      const order: RetrievalMode[] = maxChars === 4000 ? ['legacy', 'evidence'] : ['evidence', 'legacy'];
      for (const mode of order) cells.set(mode, await runCell(mode, maxChars));
      const legacy = summarize(evaluationQuestions, cells.get('legacy')!);
      const evidence = summarize(evaluationQuestions, cells.get('evidence')!);
      const decision = promotionDecision(legacy, evidence);
      reports.push({ maxChars, legacy, evidence, decision,
        cases: evaluationQuestions.map((q, i) => ({ id: q.id, language: q.language, category: q.category,
          legacy: scoreQuestion(q, cells.get('legacy')![i]!), evidence: scoreQuestion(q, cells.get('evidence')![i]!),
        })),
      });
      expect(legacy.overall.queries).toBe(80);
      expect(evidence.overall.queries).toBe(80);
      // Intentionally no expect(decision.promote).toBe(true): quality gates
      // must not turn a correctly measured unsuccessful experiment into red CI.
    }
    process.stdout.write(`\nQUESTION_EVIDENCE_EVALUATION ${JSON.stringify({
      corpusSha256: FROZEN_CORPUS_SHA256, originalQueriesSha256: ORIGINAL_QUERIES_SHA256,
      semantic: false, inference: 'untested_synthetic_lexical_only',
      promote: reports.every(report => report.decision.promote),
      reports: process.env.MCPVAULT_EVIDENCE_FULL_REPORT === '1' ? reports : reports.map(({ maxChars, legacy, evidence, decision }) => {
        const compact = (value: EvaluationSummary) => ({
          recallAt5: value.overall.recallAt5, mrr: value.overall.mrr, evidenceCoverage: value.overall.evidenceCoverage,
          negativeFalsePositiveQueries: value.overall.negativeFalsePositiveQueries,
          perLanguage: Object.fromEntries(Object.entries(value.perLanguage).map(([language, metrics]) => [language,
            { recallAt5: metrics.recallAt5, mrr: metrics.mrr, evidenceCoverage: metrics.evidenceCoverage }])),
          cost: value.overall.cost,
        });
        return { maxChars, legacy: compact(legacy), evidence: compact(evidence), decision };
      }),
    })}\n`);
  }, 120000);
});

// Evaluation-only utilities. These implementations follow the assertions above;
// no production module imports this file or its fixture.
type RetrievalMode = 'legacy' | 'evidence';
interface Observation {
  packet: AnswerPacket;
  latencyMs: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
  heapDeltaBytes: number;
  heapAfterBytes: number;
  rssAfterBytes: number;
  resultChars: number;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function observation(packet: AnswerPacket): Observation {
  return { packet, latencyMs: 0, cpuUserMicros: 0, cpuSystemMicros: 0,
    heapDeltaBytes: 0, heapAfterBytes: 0, rssAfterBytes: 0, resultChars: JSON.stringify(packet).length };
}

function allPaths(packet: AnswerPacket): string[] {
  return [...new Set([...(packet.sources || []), ...(packet.candidates || [])]
    .map(row => typeof row === 'string' ? row : row.path).filter(Boolean))];
}

function rankPaths(packet: AnswerPacket): string[] {
  return allPaths(packet).slice(0, 5);
}

function scoreQuestion(question: EvidenceQuestion, row: Observation) {
  const ranking = rankPaths(row.packet);
  const relevant = question.expectedPaths;
  const rank = allPaths(row.packet).findIndex(path => relevant.includes(path));
  let evidenceFound = 0;
  let evidenceTotal = 0;
  for (const [path, fragments] of Object.entries(question.expectedEvidence)) {
    const passages = (row.packet.sources || []).flatMap(source =>
      typeof source !== 'string' && source.path === path ? source.passages || [] : []);
    evidenceTotal += fragments.length;
    evidenceFound += fragments.filter(fragment => passages.some(passage => passage.text.includes(fragment))).length;
  }
  const returned = allPaths(row.packet);
  const noAnswerPaths = relevant.length === 0 ? returned : [];
  const forbiddenPaths = relevant.length === 0 ? [] : returned.filter(path => question.forbiddenPaths?.includes(path));
  return {
    ranking,
    recallAt5: relevant.length ? relevant.filter(path => ranking.includes(path)).length / relevant.length : null,
    mrr: relevant.length ? (rank < 0 ? 0 : 1 / (rank + 1)) : null,
    evidenceFound, evidenceTotal, noAnswerPaths, forbiddenPaths,
    falsePositiveKeys: [...noAnswerPaths, ...forbiddenPaths].map(path => JSON.stringify([question.id, path])),
    cost: { latencyMs: row.latencyMs, cpuUserMicros: row.cpuUserMicros, cpuSystemMicros: row.cpuSystemMicros,
      heapDeltaBytes: row.heapDeltaBytes, heapAfterBytes: row.heapAfterBytes, rssAfterBytes: row.rssAfterBytes, resultChars: row.resultChars },
  };
}

function groupMetrics(questions: readonly EvidenceQuestion[], rows: readonly Observation[]) {
  const scores = questions.map((q, i) => scoreQuestion(q, rows[i]!));
  const answerable = scores.filter(score => score.recallAt5 !== null);
  const evidenceTotal = scores.reduce((sum, score) => sum + score.evidenceTotal, 0);
  const evidenceFound = scores.reduce((sum, score) => sum + score.evidenceFound, 0);
  const latencies = rows.map(row => row.latencyMs).sort((a, b) => a - b);
  const percentile = (p: number) => latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] ?? null;
  const sum = (key: keyof Omit<Observation, 'packet'>) => rows.reduce((total, row) => total + row[key], 0);
  return {
    queries: questions.length,
    answerable: answerable.length,
    noAnswerCases: questions.length - answerable.length,
    recallAt5: answerable.length ? answerable.reduce((total, score) => total + score.recallAt5!, 0) / answerable.length : null,
    mrr: answerable.length ? answerable.reduce((total, score) => total + score.mrr!, 0) / answerable.length : null,
    evidenceFound, evidenceTotal,
    evidenceCoverage: evidenceTotal ? evidenceFound / evidenceTotal : null,
    noAnswerFalsePositiveQueries: scores.filter(score => score.noAnswerPaths.length).length,
    noAnswerFalsePositivePaths: scores.reduce((total, score) => total + score.noAnswerPaths.length, 0),
    forbiddenFalsePositiveQueries: scores.filter(score => score.forbiddenPaths.length).length,
    forbiddenFalsePositivePaths: scores.reduce((total, score) => total + score.forbiddenPaths.length, 0),
    negativeFalsePositiveQueries: scores.filter(score => score.falsePositiveKeys.length).length,
    cost: {
      meanLatencyMs: rows.length ? sum('latencyMs') / rows.length : null,
      p50LatencyMs: percentile(0.5), p95LatencyMs: percentile(0.95),
      cpuUserMicros: sum('cpuUserMicros'), cpuSystemMicros: sum('cpuSystemMicros'),
      totalResultChars: sum('resultChars'), maxResultChars: rows.length ? Math.max(...rows.map(row => row.resultChars)) : null,
      maxSampledHeapBytes: rows.length ? Math.max(...rows.map(row => row.heapAfterBytes)) : null,
      maxSampledRssBytes: rows.length ? Math.max(...rows.map(row => row.rssAfterBytes)) : null,
      minHeapDeltaBytes: rows.length ? Math.min(...rows.map(row => row.heapDeltaBytes)) : null,
      maxHeapDeltaBytes: rows.length ? Math.max(...rows.map(row => row.heapDeltaBytes)) : null,
    },
  };
}

function summarize(questions: readonly EvidenceQuestion[], rows: readonly Observation[]) {
  if (questions.length !== rows.length) throw new Error('Question and observation count must match');
  const forLanguage = (language: CorpusLanguage) => {
    const indices = questions.flatMap((q, i) => q.language === language ? [i] : []);
    return groupMetrics(indices.map(i => questions[i]!), indices.map(i => rows[i]!));
  };
  return {
    overall: groupMetrics(questions, rows),
    perLanguage: { ko: forLanguage('ko'), en: forLanguage('en'), mixed: forLanguage('mixed') },
    falsePositiveKeys: questions.flatMap((q, i) => scoreQuestion(q, rows[i]!).falsePositiveKeys).sort(),
  };
}
type EvaluationSummary = ReturnType<typeof summarize>;

function promotionDecision(legacy: EvaluationSummary, evidence: EvaluationSummary) {
  const reasons: string[] = [];
  const epsilon = 1e-12; // Floating-point boundary tolerance, not a score allowance.
  for (const language of languages) {
    for (const metric of ['recallAt5', 'mrr', 'evidenceCoverage'] as const) {
      const before = legacy.perLanguage[language][metric];
      const after = evidence.perLanguage[language][metric];
      if (before !== null && (after === null || after + epsilon < before)) reasons.push(`${language}.${metric}_regressed`);
    }
  }
  const before = legacy.overall.evidenceCoverage;
  const after = evidence.overall.evidenceCoverage;
  const evidenceGainPercentagePoints = before === null || after === null ? null : (after - before) * 100;
  if (evidenceGainPercentagePoints === null || evidenceGainPercentagePoints + epsilon < 5) reasons.push('overall_evidence_gain_below_5pp');
  const previousFalsePositives = new Set(legacy.falsePositiveKeys);
  if (evidence.falsePositiveKeys.some(key => !previousFalsePositives.has(key))) reasons.push('additional_false_positive');
  return { promote: reasons.length === 0, evidenceGainPercentagePoints, reasons };
}

async function runCell(mode: RetrievalMode, maxChars: number): Promise<Observation[]> {
  // This function runs only inside the explicitly scheduled integration test.
  // It never uses the live NAS Vault or writes evaluation reports into it.
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-evidence-v2-'));
  let server: ReturnType<typeof createServer> | undefined;
  let client: Client | undefined;
  try {
    for (const note of evaluationNotes) {
      const target = join(vault, note.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, note.content, 'utf8');
    }
    server = createServer(vault, { version: `evidence-eval-${mode}-${maxChars}` });
    client = new Client({ name: 'question-evidence-corpus', version: '2' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const rows: Observation[] = [];
    for (const question of evaluationQuestions) {
      const memoryBefore = process.memoryUsage();
      const cpuBefore = process.cpuUsage();
      const started = performance.now();
      const result = await client.callTool({ name: 'call_endpoint', arguments: {
        endpointId: 'wiki.answer_packet', arguments: {
          query: question.query, includeSemantic: false, maxChars,
          // Omission is the unchanged legacy API contract. No gold paths/hints
          // are supplied to retrieval; both modes see identical notes/questions.
          ...(mode === 'evidence' ? { retrievalMode: 'evidence' } : {}),
        },
      } });
      const latencyMs = performance.now() - started;
      const cpu = process.cpuUsage(cpuBefore);
      const memoryAfter = process.memoryUsage();
      const text = (result.content as Array<{ type: string; text?: string }>).filter(item => item.type === 'text').map(item => item.text || '').join('');
      expect(result.isError, `${mode}/${maxChars}/${question.id}: ${text}`).toBeFalsy();
      expect(text.length, `${mode}/${maxChars}/${question.id}: packet budget`).toBeLessThanOrEqual(maxChars);
      const packet = JSON.parse(text) as AnswerPacket & { mode: string; retrieval?: { semantic?: { state?: string } } };
      expect(packet.mode, question.id).toBe('question');
      expect(Array.isArray(packet.sources), question.id).toBe(true);
      // Compact budget/error envelopes can omit retrieval diagnostics.
      if (packet.retrieval?.semantic) expect(packet.retrieval.semantic.state, question.id).toBe('disabled');
      rows.push({ packet, latencyMs, cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system,
        heapDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed,
        heapAfterBytes: memoryAfter.heapUsed, rssAfterBytes: memoryAfter.rss, resultChars: text.length });
    }
    return rows;
  } finally {
    try { await client?.close(); }
    finally {
      try { await server?.close(); }
      finally { await rm(vault, { recursive: true, force: true }); }
    }
  }
}
