import { afterEach, describe, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { SearchService } from './search.js';
import { PathFilter } from './pathfilter.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import { FileSystemService } from './filesystem.js';
import { CollaborationService } from './scopes.js';
import {
  corpusNotes,
  corpusQuestions,
  evaluateAnswerPackets,
  fixedLexicalBaseline,
  hasNoMetricRegression,
  meanReciprocalRank,
  recallAt5,
  type CorpusQuestion,
} from '../tests/fixtures/question-corpus.js';

let vault = '';
let search: SearchService | undefined;

afterEach(async () => {
  await search?.close();
  search = undefined;
  if (vault) await rm(vault, { recursive: true, force: true });
  vault = '';
});

async function writeCorpus(): Promise<void> {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-question-corpus-'));
  for (const note of corpusNotes) {
    const target = join(vault, note.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, note.content, 'utf8');
  }
  search = new SearchService(vault, new PathFilter());
}

describe('question retrieval evaluation sidecar', () => {
  test('defines the stable 40-question composition and gold evidence contract', () => {
    expect(corpusQuestions).toHaveLength(40);
    expect(corpusQuestions.filter(question => question.language === 'ko')).toHaveLength(20);
    expect(corpusQuestions.filter(question => question.language === 'en')).toHaveLength(10);
    expect(corpusQuestions.filter(question => question.language === 'mixed')).toHaveLength(10);
    expect(corpusNotes.length).toBeGreaterThan(0);
    for (const question of corpusQuestions) {
      expect(question.id).toMatch(/^q-/);
      expect(question.query.trim()).not.toBe('');
      expect(question.expectedPaths).toEqual([...new Set(question.expectedPaths)].sort());
      for (const path of question.expectedPaths) {
        expect(corpusNotes.some(note => note.path === path)).toBe(true);
        expect(question.expectedEvidence[path]?.length).toBeGreaterThan(0);
        for (const fragment of question.expectedEvidence[path] || []) expect(corpusNotes.find(n => n.path === path)!.content, `${question.id}: invented evidence`).toContain(fragment);
      }
    }
  });

  test('metrics keep no-answer cases outside the relevance denominator', () => {
    const questions: CorpusQuestion[] = [
      { id: 'q-a', language: 'en', category: 'answerable', query: 'a', expectedPaths: ['a.md'], expectedEvidence: { 'a.md': ['A'] } },
      { id: 'q-b', language: 'en', category: 'answerable', query: 'b', expectedPaths: ['b.md'], expectedEvidence: { 'b.md': ['B'] } },
      { id: 'q-c', language: 'en', category: 'missing-knowledge', query: 'c', expectedPaths: [], expectedEvidence: {} },
    ];
    const rankings = [['a.md'], ['noise.md', 'b.md'], ['noise.md']];
    expect(recallAt5(questions, rankings)).toBe(1);
    expect(meanReciprocalRank(questions, rankings)).toBe(0.75);
  });

  test('computes macro Recall@5 for partial multi-relevance with interleaved no-answer cases', () => {
    const questions: CorpusQuestion[] = [
      { id: 'q-a', language: 'en', category: 'answerable', query: 'a', expectedPaths: ['a.md', 'a2.md'], expectedEvidence: { 'a.md': ['A'], 'a2.md': ['A2'] } },
      { id: 'q-none', language: 'en', category: 'missing-knowledge', query: 'none', expectedPaths: [], expectedEvidence: {} },
      { id: 'q-b', language: 'en', category: 'answerable', query: 'b', expectedPaths: ['b.md'], expectedEvidence: { 'b.md': ['B'] } },
    ];
    expect(recallAt5(questions, [['a.md'], ['noise.md'], ['b.md']])).toBe(0.75);
    expect(meanReciprocalRank(questions, [['a.md'], ['noise.md'], ['noise.md', 'b.md']])).toBe(0.75);
  });

  test('records the current lexical baseline with bounded result payloads and observed calls', async () => {
    await writeCorpus();
    const rankings: string[][] = [];
    let resultChars = 0;
    let observedCalls = 0;
    for (const question of corpusQuestions) {
      const results = await search!.search({ query: question.query, limit: 5, maxChars: 1800 });
      observedCalls += 1;
      rankings.push(results.map(result => result.p));
      resultChars += JSON.stringify(results).length;
    }
    const answerable = corpusQuestions.filter(question => question.expectedPaths.length > 0);
    expect(observedCalls).toBe(40);
    expect(resultChars).toBeGreaterThan(0);
    const answerableRankings = rankings.filter((_ranking, index) => corpusQuestions[index]!.expectedPaths.length > 0);
    const baseline = {
      observedCalls,
      totalResultChars: resultChars,
      answerableCases: answerable.length,
      noAnswerCases: corpusQuestions.length - answerable.length,
      recallAt5: recallAt5(corpusQuestions, rankings),
      mrr: meanReciprocalRank(corpusQuestions, rankings),
    };
    console.log(`QUESTION_CORPUS_BASELINE ${JSON.stringify(baseline)}`);
    expect(baseline.observedCalls).toBe(corpusQuestions.length);
    expect(baseline.noAnswerCases).toBe(4);
    expect(baseline.totalResultChars).toBeGreaterThan(0);
    expect(baseline.recallAt5).toBe(fixedLexicalBaseline.recallAt5);
    expect(baseline.mrr).toBe(fixedLexicalBaseline.mrr);
  });

  test('evaluates wiki.answer_packet at packet and equal budgets without regression', async () => {
    await writeCorpus();
    const server = createServer(vault, { version: 'question-corpus-packet' });
    const client = new Client({ name: 'question-corpus-packet', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const bodyReadSpy = vi.spyOn(FileSystemService.prototype, 'readNote');
    const run = async (maxChars: number) => {
      const readsBefore = bodyReadSpy.mock.calls.length;
      const packets = [];
      const latencyMs: number[] = [];
      for (const question of corpusQuestions) {
        const started = performance.now();
        const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.answer_packet', arguments: { query: question.query, includeSemantic: false, maxChars } } });
        latencyMs.push(performance.now() - started);
        if (result.isError) throw new Error((result.content as any[]).map(item => item.text || '').join(''));
        packets.push(JSON.parse((result.content as any[]).map(item => item.text || '').join('')));
      }
      return evaluateAnswerPackets(corpusQuestions, packets, latencyMs, bodyReadSpy.mock.calls.length - readsBefore);
    };
    try {
      const packet = await run(12000);
      const equalBudget = await run(1800);
      const legacyRankings: string[][] = [];
      const originalScopedAdapter = new CollaborationService(new FileSystemService(vault), search!);
      for (const question of corpusQuestions) {
        const args = { query: question.query, limit: 5, maxChars: 1800 };
        legacyRankings.push((await search!.search(args)).map(result => result.p));
        const current = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.search', arguments: args } });
        expect(current.isError).toBeFalsy();
        const actual = JSON.parse((current.content as any[]).map(item => item.text || '').join(''));
        expect(actual, question.id).toEqual(await originalScopedAdapter.searchScopedNotes(args));
      }
      const legacy = { recallAt5: recallAt5(corpusQuestions, legacyRankings), mrr: meanReciprocalRank(corpusQuestions, legacyRankings) };
      const packetFailures = corpusQuestions.map((question, index) => {
        if (!question.expectedPaths.length) return undefined;
        const ranking = packet.rankings[index] || [];
        const found = question.expectedPaths.filter(path => ranking.slice(0, 5).includes(path));
        const firstRank = ranking.findIndex(path => question.expectedPaths.includes(path));
        return found.length < question.expectedPaths.length || firstRank !== 0
          ? { id: question.id, expectedPaths: question.expectedPaths, foundPaths: found, ranking, firstRank: firstRank < 0 ? null : firstRank + 1 }
          : undefined;
      }).filter(Boolean);
      const summary = ({ rankings: _rankings, latencyMs, ...metrics }: typeof packet) => ({ ...metrics, averageLatencyMs: latencyMs.reduce((a, b) => a + b, 0) / latencyMs.length });
      console.log(`QUESTION_PACKET_EVALUATION ${JSON.stringify({ packet: summary(packet), equalBudget: summary(equalBudget), legacy, packetFailures })}`);
      if (process.env.MCPVAULT_EVAL_REPORT === '1') process.stdout.write(`\nQUESTION_PACKET_METRICS ${JSON.stringify({ packet: summary(packet), equalBudget: summary(equalBudget), legacy })}\n`);
      expect(hasNoMetricRegression(packet)).toBe(true);
      expect(legacy.recallAt5).toBe(fixedLexicalBaseline.recallAt5);
      expect(legacy.mrr).toBe(fixedLexicalBaseline.mrr);
    } finally {
      bodyReadSpy.mockRestore();
      await client.close();
      await server.close();
    }
  // 120 real MCP queries plus legacy comparisons run serially on Windows;
  // measured ~4.95s is too close to the ordinary five-second unit-test limit.
  }, 15000);
});
