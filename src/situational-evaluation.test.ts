import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { FileSystemService } from './filesystem.js';
import { SearchService } from './search.js';
import { PathFilter } from './pathfilter.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { CollaborationService } from './scopes.js';
import { RetrievalService } from './retrieval-service.js';
import { QuestionPacketService } from './question-packet.js';

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
test('records a fixed eight-case old-question baseline before situation comparison', async () => {
  root = await mkdtemp(join(tmpdir(), 'situation-evaluation-'));
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy();
  const search = new SearchService(root, new PathFilter());
  const retrieval = new RetrievalService(search, new CollaborationService(fs, search), { search: async () => ({ available: false, results: [] }) }, access, fs);
  const packet = new QuestionPacketService(fs, access, retrieval);
  const contexts = ['NAS', 'LOCAL', '한국어', 'mixed 환경'];
  const cases: Array<{ query: string; context: string; intent: 'execute' | 'review'; expected: string; warning: string }> = [];
  const write = async (path: string, body: string) => { const absolute = join(root!, path); await mkdir(dirname(absolute), { recursive: true }); await writeFile(absolute, body); };
  for (let i = 0; i < contexts.length; i++) {
    for (const intent of ['execute', 'review'] as const) {
      const query = `signal${i}${intent}`, expected = `Knowledge/${query}-correct.md`, warning = `LIMIT_${query}`;
      cases.push({ query, context: contexts[i]!, intent, expected, warning });
      await write(expected, `---\nnote_kind: atomic\ncontext_rules:\n  all: ["${contexts[i]}"]\n  intents: [${intent}]\n---\n# Procedure\n\n${query} handles writes.\n\n## Warning\n\n${warning}: use only after reconnect validation.`);
      await write(`Knowledge/${query}-other.md`, `---\nnote_kind: atomic\ncontext_rules:\n  all: [OTHER_ENVIRONMENT]\n---\n${query} uses a different environment; not applicable here.`);
    }
  }
  let bodyReads = 0, revisionReads = 0, metadataReads = 0;
  const read = fs.readNote.bind(fs), rev = fs.readNoteRevision.bind(fs), meta = fs.readNoteMetadata.bind(fs);
  fs.readNote = async (...args) => { bodyReads++; return read(...args); };
  fs.readNoteRevision = async (...args) => { revisionReads++; return rev(...args); };
  fs.readNoteMetadata = async (...args) => { metadataReads++; return meta(...args); };
  const baseline: any[] = [];
  for (const c of cases) {
    bodyReads = revisionReads = metadataReads = 0;
    const start = performance.now();
    const r = await packet.read({ query: c.query, includeSemantic: false, maxChars: 4000 });
    baseline.push({ query: c.query, expectedFound: r.sources.some((s: any) => s.path === c.expected), warningFound: JSON.stringify(r.sources).includes(c.warning), unrelated: r.sources.filter((s: any) => s.path !== c.expected).length,
      chars: JSON.stringify(r).length, bodyReads, revisionReads, metadataReads, elapsedMs: performance.now() - start, calls: 1 });
  }
  process.stdout.write(`SITUATION_BASELINE ${JSON.stringify(baseline)}\n`);
  expect(baseline).toHaveLength(8);
  // Intentionally fails on the old API after recording the entire baseline.
  expect(typeof packet.readSituation).toBe('function');
  const situation: any[] = [];
  for (const c of cases) {
    bodyReads = revisionReads = metadataReads = 0;
    const start = performance.now();
    const r = await packet.readSituation({ query: c.query, context: c.context, intent: c.intent, includeSemantic: false, maxChars: 4000 });
    situation.push({ query: c.query, expectedFound: r.sources.some((s: any) => s.path === c.expected), warningFound: JSON.stringify(r.sources).includes(c.warning), unrelated: r.sources.filter((s: any) => s.path !== c.expected).length,
      chars: JSON.stringify(r).length, bodyReads, revisionReads, metadataReads, elapsedMs: performance.now() - start, calls: 1 });
  }
  process.stdout.write(`SITUATION_CURRENT ${JSON.stringify(situation)}\n`);
  expect(situation.every(r => r.expectedFound && r.warningFound && r.unrelated === 0 && r.chars <= 4000)).toBe(true);
});
