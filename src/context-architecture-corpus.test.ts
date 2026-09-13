import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { contextArchitectureSources as sources, contextArchitectureTasks as tasks } from '../tests/fixtures/context-architecture-v1.js';

test('fixed synthetic gold has 180 tasks, balanced languages and source-family-disjoint splits', () => {
  expect(sources).toHaveLength(60); expect(tasks).toHaveLength(180);
  expect(new Set(tasks.map(t => t.id)).size).toBe(180);
  expect(new Set(tasks.map(t => t.query)).size).toBe(180);
  for (const language of ['ko', 'en', 'mixed']) expect(tasks.filter(t => t.language === language)).toHaveLength(60);
  for (const split of ['development', 'holdout']) expect(tasks.filter(t => t.split === split)).toHaveLength(90);
  for (const source of sources) {
    const family = tasks.filter(t => t.family === source.family);
    expect(family).toHaveLength(3);
    expect(new Set(family.map(t => t.split)).size).toBe(1);
    for (const task of family) {
      for (const text of task.requiredEvidence) expect(source.body).toContain(text);
      if (source.access !== 'allowed') expect(task.expectedDocuments).toEqual([]);
      if (!task.noAnswer) { expect(task.requiredEvidence.length).toBeGreaterThan(0); expect(task.allowedTools.length).toBeGreaterThan(0); }
    }
  }
  expect(new Set(tasks.map(t => t.category)).size).toBe(10);
});

test('gold hash is fixed before routing and librarian tuning', () => {
  const hash = createHash('sha256').update(JSON.stringify({ sources, tasks })).digest('hex');
  expect(hash).toBe('cf494f5e7bde6224c3d1a2155e92c47fe5691b723413e202f4275dbcf9508c64');
});
