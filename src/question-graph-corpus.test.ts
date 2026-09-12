import { describe, expect, test } from 'vitest';
import matter from 'gray-matter';
import { graphNotes, graphQuestions, graphCorpusSha256, graphLocatorPins } from '../tests/fixtures/question-graph-corpus.js';
import { evaluationRequest, runEvaluationCell, sha256, summarize, promotionDecision, scoreQuestion,
  compactSummary, measurementScope, type Observation, type RetrievalMode } from '../tests/question-evaluation.js';

// This is a separate fixed evaluation corpus, never appended to frozen80.
// Routing and ranking quality are reported; production behavioral tests belong
// to the main owner. No promotion=true assertion is appropriate here.
describe('fixed graph question evaluation', () => {
  test('freezes graph notes, queries, gold, negatives and explicit locator pins', () => {
    expect(sha256(JSON.stringify({ notes: graphNotes, questions: graphQuestions, pins: graphLocatorPins }))).toBe(graphCorpusSha256);
    expect(new Set(graphNotes.map(n => n.path)).size).toBe(graphNotes.length);
    expect(new Set(graphQuestions.map(q => q.id)).size).toBe(graphQuestions.length);
    expect([...new Set(graphQuestions.map(q => q.category))].sort()).toEqual([
      'alias', 'contradiction', 'cycle-hub', 'noanswer', 'shared-source', 'strict', 'two-hop',
    ]);
    const notes = new Map(graphNotes.map(note => [note.path, note]));
    for (const note of graphNotes) {
      const parsed = matter(note.content);
      if (parsed.data.llm_wiki_type === 'source') {
        expect(parsed.data.immutable, note.path).toBe(true);
        expect(parsed.data.content_sha256, note.path).toBe(sha256(parsed.content));
      }
    }
    for (const pin of graphLocatorPins) {
      const target = notes.get(pin.path)!;
      expect(pin.revision, pin.path).toBe(sha256(target.content));
      expect(matter(target.content).content, pin.path).toContain(`## ${pin.heading}\n`);
      const declarations = matter(notes.get(pin.from)!.content).data.evidence;
      expect(declarations, pin.from).toContainEqual({ path: pin.path, revision: pin.revision, heading: pin.heading });
    }
    for (const question of graphQuestions) {
      expect(question.query.trim(), question.id).not.toBe('');
      expect(question.expectedPaths, question.id).toEqual([...new Set(question.expectedPaths)].sort());
      expect(Object.keys(question.expectedEvidence).sort(), question.id).toEqual(question.expectedPaths);
      for (const [path, fragments] of Object.entries(question.expectedEvidence)) {
        expect(fragments.length, question.id).toBeGreaterThan(0);
        for (const fragment of fragments) {
          expect(fragment.trim(), question.id).not.toBe('');
          expect(matter(notes.get(path)!.content).content, question.id).toContain(fragment);
        }
      }
      for (const path of question.forbiddenPaths || []) {
        expect(notes.has(path), question.id).toBe(true);
        expect(question.expectedPaths, question.id).not.toContain(path);
      }
      // The actual shared runner uses this builder too. Gold and fixture pins
      // can only affect scoring, never the MCP query arguments.
      expect(Object.keys(evaluationRequest('graph', question.query, 12000)).sort()).toEqual([
        'graphDepth', 'includeSemantic', 'maxChars', 'query', 'retrievalMode',
      ]);
    }
  });

  test('reports graph routing quality and local first/repeat costs at both budgets', async () => {
    const reports = [];
    for (const maxChars of [4000, 12000]) {
      const order: RetrievalMode[] = maxChars === 4000 ? ['legacy', 'evidence', 'graph'] : ['graph', 'evidence', 'legacy'];
      const cells = new Map<RetrievalMode, Awaited<ReturnType<typeof runEvaluationCell>>>();
      for (const mode of order) cells.set(mode, await runEvaluationCell(mode, maxChars, graphNotes, graphQuestions));
      // An ignored/stripped opt-in is not a valid graph measurement. Check the
      // MCP adapter acknowledgement on the small unambiguous case at 12000;
      // path selection/quality remain report values, not promotion assertions.
      if (maxChars === 12000) for (const pass of ['first', 'repeat'] as const) {
        expect(cells.get('graph')![pass][0]!.packet).toMatchObject({ retrieval: { graph: { depth: 2 } } });
      }
      const passes = (['first', 'repeat'] as const).map(pass => {
        const legacy = summarize(graphQuestions, cells.get('legacy')![pass]);
        const evidence = summarize(graphQuestions, cells.get('evidence')![pass]);
        const graph = summarize(graphQuestions, cells.get('graph')![pass]);
        for (const summary of [legacy, evidence, graph]) expect(summary.overall.queries).toBe(graphQuestions.length);
        return { pass, legacy: compactSummary(legacy), evidence: compactSummary(evidence), graph: compactSummary(graph),
          decisions: { evidenceVsLegacy: promotionDecision(legacy, evidence), graphVsLegacy: promotionDecision(legacy, graph), graphVsEvidence: promotionDecision(evidence, graph) },
          ...(process.env.MCPVAULT_EVIDENCE_FULL_REPORT === '1' ? { cases: graphQuestions.map((q, i) => ({ id: q.id, language: q.language, category: q.category,
            legacy: scoreQuestion(q, cells.get('legacy')![pass][i]!),
            evidence: scoreQuestion(q, cells.get('evidence')![pass][i]!),
            graph: { ...scoreQuestion(q, cells.get('graph')![pass][i]!),
              observedPacket: packetDetails(cells.get('graph')![pass][i]!),
            },
          })) } : {}),
        };
      });
      reports.push({ maxChars, order, setup: Object.fromEntries([...cells].map(([mode, cell]) => [mode, cell.setup])), passes });
    }
    process.stdout.write(`\nQUESTION_GRAPH_EVALUATION ${JSON.stringify({ corpusSha256: graphCorpusSha256,
      semantic: false, inference: 'untested_synthetic_lexical_only', measurement: measurementScope,
      graphContractLimits: { roots: 5, metadata: 40, bodies: 8, relations: 80, evidencePathsPerSource: 3 },
      reports,
    })}\n`);
  }, 120000);
});

// Retain returned direction/revision/locator diagnostics for reviewers without
// supplying those fields to retrieval or replacing the frozen evidence scorer.
function packetDetails(row: Observation) {
  const packet = row.packet as {
    status?: string; gaps?: string[]; retrieval?: unknown;
    sources?: Array<string | { path: string; revision?: string; graphPaths?: unknown; selectionReasons?: unknown }>;
  };
  return { status: packet.status ?? null, gaps: packet.gaps ?? [], retrieval: packet.retrieval ?? null,
    sources: (packet.sources || []).map(source => typeof source === 'string' ? { path: source } : {
      path: source.path, revision: source.revision ?? null,
      graphPaths: source.graphPaths ?? [], selectionReasons: source.selectionReasons ?? [],
    }),
  };
}
