import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';

const file = new URL('../tests/fixtures/retrieval-routing-v1.json', import.meta.url);
const corpus = () => {
  expect(existsSync(file), 'Freeze routing/exposure gold before implementing the new planner').toBe(true);
  return JSON.parse(readFileSync(file, 'utf8'));
};

test('routing gold contains120 multilingual cases in source-family-disjoint splits', () => {
  const c = corpus();
  expect(c.version).toBe(1); expect(c.measurement).toBe('synthetic-contract-only');
  expect(c.sources).toHaveLength(40); expect(c.cases).toHaveLength(120);
  expect(new Set(c.cases.map((x: any) => x.id)).size).toBe(120);
  expect(new Set(c.cases.map((x: any) => x.query)).size).toBe(120);
  for (const language of ['ko', 'en', 'mixed']) expect(c.cases.filter((x: any) => x.language === language)).toHaveLength(40);
  for (const split of ['development', 'holdout']) expect(c.cases.filter((x: any) => x.split === split)).toHaveLength(60);
  for (const source of c.sources) {
    const tasks = c.cases.filter((x: any) => x.family === source.family);
    expect(tasks).toHaveLength(3); expect(new Set(tasks.map((x: any) => x.split)).size).toBe(1);
    for (const task of tasks) {
      expect(task.split).toBe(source.split); expect(task.input).toBeDefined();
      expect(task.expected.allowedTools.length).toBeGreaterThan(0);
      for (const fact of task.expected.requiredEvidence) expect(source.body).toContain(fact);
      if (task.input.access === 'revoked') expect(task.expected.documents).toEqual([]);
    }
  }
  expect(new Set(c.cases.map((x: any) => x.scenario)).size).toBe(20);
});

test('exposure gold never equates sent receipts with retained context', () => {
  const tasks = corpus().cases;
  for (const x of tasks.filter((x: any) => ['unknown-context', 'compaction'].includes(x.scenario)))
    expect(x.expected.delivery).toBe('full');
  for (const x of tasks.filter((x: any) => x.scenario === 'no-skill')) expect(x.expected.optionalSkills).toBe(0);
  for (const x of tasks.filter((x: any) => x.scenario === 'mandatory-rule')) expect(x.expected.protectedFromPenalty).toBe(true);
  for (const x of tasks.filter((x: any) => x.scenario === 'ambiguous-name')) expect(x.expected.action).toBe('disambiguate');
  for (const x of tasks.filter((x: any) => x.expected.delivery === 'delta')) {
    expect(x.input.retention).toBe('host_confirmed'); expect(x.input.sameEpoch && x.input.sameWorker).toBe(true);
    expect(x.input.bothRevisionsAccessible).toBe(true);
    expect(x.input.retainedBase.endOffset - x.input.retainedBase.startOffset).toBe(x.input.retainedBase.text.length);
    expect(x.input.retainedBase.revision).toBe(x.expected.deltaBase);
    expect(x.input.retainedBase.representation).toBe(x.input.representation);
  }
  const graph = tasks.filter((x: any) => x.input.hiddenNeighbor);
  for (const x of graph) expect(x.expected.requiredEvidence.join(' ')).not.toMatch(/restricted neighbor|hidden neighbor/i);
});

test('routing gold payload is pinned independently of implementation scores', () => {
  const c = corpus();
  const hash = createHash('sha256').update(JSON.stringify({ sources: c.sources, cases: c.cases })).digest('hex');
  expect(hash).toBe(c.frozenSha256);
  expect(hash).toBe('93870ec4aa27ada8dacedd8419b5a2fb2c32ab42ffa7ad798a69dbaf43c33fb9');
});
