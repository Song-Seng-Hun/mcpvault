import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { SearchService } from './search.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ResearchBridgeService } from './research-bridge.js';
import { isModerationHidden } from './moderation-policy.js';

type EvaluationCategory = 'known_connection' | 'plausible_analogy' | 'weak_combination' | 'incorrect_link';
type FixtureNote = { path: string; frontmatter?: Record<string, unknown>; content?: string };
export type BridgeEvaluationCase = {
  id: string;
  category: EvaluationCategory;
  focus: string;
  compare?: string;
  query?: string;
  notes: FixtureNote[];
  expectedTargets: string[];
  forbiddenTargets?: string[];
};

const note = (path: string, frontmatter: Record<string, unknown> = {}, content = 'A bounded observation with stated conditions.') => ({
  path,
  frontmatter: { note_kind: 'atomic', domain: 'research', ...frontmatter },
  content,
});

/** Twelve deterministic fixtures: three cases for each evaluation category. */
export const BRIDGE_EVALUATION_CASES: BridgeEvaluationCase[] = [
  {
    id: 'known-shared-method', category: 'known_connection', focus: 'Focus.md', query: 'graph traversal',
    notes: [note('Focus.md', { methods: ['graph traversal'] }), note('Known.md', { methods: ['graph traversal'] })],
    expectedTargets: ['Known.md'],
  },
  {
    id: 'known-authored-relation', category: 'known_connection', focus: 'Focus.md',
    notes: [note('Focus.md', { related: ['[[Known.md]]'] }), note('Known.md')],
    expectedTargets: ['Known.md'],
  },
  {
    id: 'known-two-anchor-mediator', category: 'known_connection', focus: 'A.md', compare: 'C.md',
    notes: [note('A.md', { methods: ['network'] }), note('C.md', { domain: 'physics', methods: ['flow'] }),
      note('Mediator.md', { domain: 'engineering', methods: ['network', 'flow'] })],
    expectedTargets: ['Mediator.md'],
  },
  {
    id: 'analogy-different-domain', category: 'plausible_analogy', focus: 'Focus.md',
    notes: [note('Focus.md', { domain: 'biology', subject_terms: ['resilience'] }), note('Analogy.md', { domain: 'music' })],
    expectedTargets: ['Analogy.md'],
  },
  {
    id: 'analogy-query-metadata', category: 'plausible_analogy', focus: 'Focus.md', query: 'feedback',
    notes: [note('Focus.md', { domain: 'biology' }), note('Analogy.md', { domain: 'physics', title: ['feedback'] })],
    expectedTargets: ['Analogy.md'],
  },
  {
    id: 'analogy-two-hop-authored-path', category: 'plausible_analogy', focus: 'Focus.md',
    notes: [note('Focus.md', { related: ['[[Bridge.md]]'] }), note('Bridge.md', { related: ['[[Target.md]]'] }),
      note('Target.md', { domain: 'economics' })],
    expectedTargets: ['Bridge.md', 'Target.md'],
  },
  {
    id: 'weak-no-authored-signal', category: 'weak_combination', focus: 'Focus.md',
    notes: [note('Focus.md', { domain: 'biology' }), note('Unrelated.md', { domain: 'biology' })],
    expectedTargets: [],
  },
  {
    id: 'weak-one-sided-comparison', category: 'weak_combination', focus: 'A.md', compare: 'C.md',
    notes: [note('A.md', { methods: ['network'] }), note('C.md', { methods: ['flow'] }), note('OneSide.md', { methods: ['network'] })],
    expectedTargets: [],
  },
  {
    id: 'weak-broad-query-only', category: 'weak_combination', focus: 'Focus.md', query: 'method',
    notes: [note('Focus.md', { domain: 'biology' }), note('Candidate.md', { domain: 'physics', title: ['method'] })],
    expectedTargets: ['Candidate.md'],
  },
  {
    id: 'incorrect-missing-relation-target', category: 'incorrect_link', focus: 'Focus.md',
    notes: [note('Focus.md', { related: ['[[DoesNotExist.md]]'] }), note('Visible.md')],
    expectedTargets: [], forbiddenTargets: ['DoesNotExist.md'],
  },
  {
    id: 'incorrect-hidden-target', category: 'incorrect_link', focus: 'Focus.md',
    notes: [note('Focus.md', { related: ['[[Community/Hidden.md]]'] }), note('Community/Hidden.md', { moderation_status: 'quarantined' })],
    expectedTargets: [], forbiddenTargets: ['Community/Hidden.md'],
  },
  {
    id: 'incorrect-draft-target', category: 'incorrect_link', focus: 'Focus.md',
    notes: [note('Focus.md', { related: ['[[Draft.md]]'] }), note('Draft.md', { mcpvault_type: 'blog_post', status: 'draft' })],
    expectedTargets: [], forbiddenTargets: ['Draft.md'],
  },
];

let root: string;
let fs: FileSystemService;

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'research-bridge-evaluation-')); fs = new FileSystemService(root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function materialize(fixture: BridgeEvaluationCase): Promise<ResearchBridgeService> {
  for (const entry of fixture.notes) {
    await fs.writeNote({ path: entry.path, content: `# ${fixture.id}\n\n${entry.content || 'Observation.'}\n`, frontmatter: entry.frontmatter || {} });
  }
  return new ResearchBridgeService(fs, new ScopeAccessPolicy());
}

export async function runResearchBridgeEvaluation(fixture: BridgeEvaluationCase, options: { maxChars?: number } = {}) {
  const service = await materialize(fixture);
  return service.candidates({ focusPath: fixture.focus, ...(fixture.compare ? { comparePath: fixture.compare } : {}),
    ...(fixture.query !== undefined ? { query: fixture.query } : {}), limit: 3, ...(options.maxChars !== undefined ? { maxChars: options.maxChars } : {}) });
}

/** Existing lexical search comparator over the same materialized, admitted corpus. */
export async function runExistingSearchBaseline(fixture: BridgeEvaluationCase): Promise<string[]> {
  const focus = fixture.notes.find(entry => entry.path === fixture.focus)!;
  const values = (field: string) => {
    const value = focus.frontmatter?.[field];
    return Array.isArray(value) ? value.filter(v => typeof v === 'string') : typeof value === 'string' ? [value] : [];
  };
  const query = fixture.query || values('methods')[0] || values('subject_terms')[0] || fixture.focus.replace(/\.md$/, '');
  const access = new ScopeAccessPolicy();
  const anchors = new Set([fixture.focus, ...(fixture.compare ? [fixture.compare] : [])]);
  const admissible = new Set(fixture.notes.filter(entry => !anchors.has(entry.path)
    && !isModerationHidden(entry.frontmatter || {})
    && (!entry.path.startsWith('Community/') || fixture.focus.startsWith('Community/'))
    && !(entry.frontmatter?.mcpvault_type === 'blog_post' && entry.frontmatter?.status === 'draft')).map(entry => entry.path));
  const search = new SearchService(root, new PathFilter());
  const hits = await search.search({ query, searchContent: false, searchFrontmatter: true, limit: 64,
    canAccessPath: path => access.canAccessPhysicalPath(path) && admissible.has(path) });
  return hits.map(hit => hit.p).filter(path => admissible.has(path));
}

describe('research bridge deterministic evaluation fixture', () => {
  test('contains exactly three cases in each category', () => {
    expect(BRIDGE_EVALUATION_CASES).toHaveLength(12);
    for (const category of ['known_connection', 'plausible_analogy', 'weak_combination', 'incorrect_link'] as const) {
      expect(BRIDGE_EVALUATION_CASES.filter(fixture => fixture.category === category)).toHaveLength(3);
    }
  });

  test.each(BRIDGE_EVALUATION_CASES)('$id has deterministic targets and traceable reading actions', async fixture => {
    const result = await runResearchBridgeEvaluation(fixture);
    expect(result.candidates.map(candidate => candidate.target)).toEqual(fixture.expectedTargets);
    for (const target of fixture.forbiddenTargets || []) expect(JSON.stringify(result)).not.toContain(target);
    expect(result.candidates.every(candidate => candidate.status === 'unverified_hypothesis')).toBe(true);
    expect(result.sources.every(source => source.revision.length === 64 && source.nextAction.arguments.expectedRevision === source.revision)).toBe(true);
    expect(result.candidates.every(candidate => candidate.inputPaths.length >= 2 && candidate.gaps.length > 0)).toBe(true);
    expect(new Set(result.candidates.map(candidate => candidate.researchKey)).size).toBe(result.candidates.length);
  });

  test.each(BRIDGE_EVALUATION_CASES)('$id compares against existing lexical search on the same corpus', async fixture => {
    const baseline = await (async () => { await materialize(fixture); return runExistingSearchBaseline(fixture); })();
    expect(baseline.every(path => fixture.notes.some(entry => entry.path === path))).toBe(true);
    expect(baseline).not.toContain(fixture.focus);
    if (fixture.compare) expect(baseline).not.toContain(fixture.compare);
  });

  test('existing lexical baseline and bridge remain bounded without implying evidence', async () => {
    const fixture = BRIDGE_EVALUATION_CASES.find(candidate => candidate.id === 'analogy-query-metadata')!;
    await materialize(fixture);
    const lexicalBaseline = await runExistingSearchBaseline(fixture);
    const result = await runResearchBridgeEvaluation(fixture, { maxChars: 3000 });
    expect(lexicalBaseline).toEqual(['Analogy.md']);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(3000);
    expect(result.notice).toMatch(/not evidence|untrusted|No source delivered/i);
    expect(result.candidates.every(candidate => candidate.observations.some(observation => observation.includes('query_metadata_overlap')))).toBe(true);
  });
});
