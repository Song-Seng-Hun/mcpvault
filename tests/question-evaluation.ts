import { expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './server-fixture.js';
import type { AnswerPacket, CorpusLanguage, CorpusNote } from './fixtures/question-corpus.js';
import type { EvidenceQuestion } from './fixtures/question-evidence-corpus.js';

const languages = ['ko', 'en', 'mixed'] as const;

// Scoring and promotion logic moved verbatim from the frozen80 test.
// Production never imports this helper. No gold-driven requests, model calls or live Vault access.
export type RetrievalMode = 'legacy' | 'evidence' | 'graph';
export interface Observation {
  packet: AnswerPacket;
  latencyMs: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
  heapDeltaBytes: number;
  heapAfterBytes: number;
  rssAfterBytes: number;
  resultChars: number;
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function observation(packet: AnswerPacket): Observation {
  return { packet, latencyMs: 0, cpuUserMicros: 0, cpuSystemMicros: 0,
    heapDeltaBytes: 0, heapAfterBytes: 0, rssAfterBytes: 0, resultChars: JSON.stringify(packet).length };
}

export function allPaths(packet: AnswerPacket): string[] {
  return [...new Set([...(packet.sources || []), ...(packet.candidates || [])]
    .map(row => typeof row === 'string' ? row : row.path).filter(Boolean))];
}

export function rankPaths(packet: AnswerPacket): string[] {
  return allPaths(packet).slice(0, 5);
}

export function scoreQuestion(question: EvidenceQuestion, row: Observation) {
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

export function groupMetrics(questions: readonly EvidenceQuestion[], rows: readonly Observation[]) {
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

export function summarize(questions: readonly EvidenceQuestion[], rows: readonly Observation[]) {
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
export type EvaluationSummary = ReturnType<typeof summarize>;

export function promotionDecision(legacy: EvaluationSummary, evidence: EvaluationSummary) {
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


export const measurementScope = {
  storage: 'local_temporary_filesystem',
  transport: 'in_memory_mcp',
  first: 'first_corpus_sweep_on_fresh_server; later_queries_may_use_warmed_indexes',
  repeat: 'second_identical_corpus_sweep_on_same_server',
  cache: 'OS_and_process_caches_not_flushed; not_cold_disk_measurements',
  cpu: 'process_wide_user_and_system_microseconds',
  memory: 'process_wide_samples_at_request_boundaries; not_peak_or_server_exclusive',
  resultChars: 'serialized_text_UTF16_code_units; not_network_bytes',
  nasTransfer: { status: 'unmeasured', bytes: null },
} as const;

export function compactSummary(value: EvaluationSummary) {
  return {
    recallAt5: value.overall.recallAt5, mrr: value.overall.mrr, evidenceCoverage: value.overall.evidenceCoverage,
    negativeFalsePositiveQueries: value.overall.negativeFalsePositiveQueries,
    falsePositiveKeys: value.falsePositiveKeys,
    perLanguage: Object.fromEntries(Object.entries(value.perLanguage).map(([language, metrics]) => [language,
      { recallAt5: metrics.recallAt5, mrr: metrics.mrr, evidenceCoverage: metrics.evidenceCoverage }])),
    cost: value.overall.cost,
  };
}

export function evaluationRequest(mode: RetrievalMode, query: string, maxChars: number) {
  return { query, includeSemantic: false, maxChars,
    ...(mode === 'legacy' ? {} : { retrievalMode: 'evidence' }),
    ...(mode === 'graph' ? { graphDepth: 2 } : {}),
  };
}

export async function runEvaluationCell(mode: RetrievalMode, maxChars: number,
  notes: readonly CorpusNote[], questions: readonly EvidenceQuestion[]) {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-question-eval-'));
  let server: ReturnType<typeof createServer> | undefined;
  let client: Client | undefined;
  try {
    for (const note of notes) {
      const target = join(vault, note.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, note.content, 'utf8');
    }
    // Seeding is excluded; setup records server construction plus connection.
    const setupMemory = process.memoryUsage();
    const setupCpu = process.cpuUsage();
    const setupStarted = performance.now();
    server = createServer(vault, { version: `question-eval-${mode}-${maxChars}` });
    client = new Client({ name: 'question-evaluation', version: '3' });
    const connectedClient = client;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const setupLatencyMs = performance.now() - setupStarted;
    const setupCpuUsed = process.cpuUsage(setupCpu);
    const setupAfter = process.memoryUsage();
    const setup = { latencyMs: setupLatencyMs, cpuUserMicros: setupCpuUsed.user, cpuSystemMicros: setupCpuUsed.system,
      rssBeforeBytes: setupMemory.rss, rssAfterBytes: setupAfter.rss,
      heapDeltaBytes: setupAfter.heapUsed - setupMemory.heapUsed };
    const sweep = async (): Promise<Observation[]> => {
      const rows: Observation[] = [];
      for (const question of questions) {
        const memoryBefore = process.memoryUsage();
        const cpuBefore = process.cpuUsage();
        const started = performance.now();
        const result = await connectedClient.callTool({ name: 'call_endpoint', arguments: {
          endpointId: 'wiki.answer_packet',
          arguments: evaluationRequest(mode, question.query, maxChars),
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
    };
    const first = await sweep();
    const repeat = await sweep();
    // Read-only evaluation must leave fixture originals byte-for-byte intact.
    for (const note of notes) expect(await readFile(join(vault, note.path), 'utf8'), note.path).toBe(note.content);
    return { first, repeat, setup };
  } finally {
    try { await client?.close(); }
    finally {
      try { await server?.close(); }
      finally { await rm(vault, { recursive: true, force: true }); }
    }
  }
}
