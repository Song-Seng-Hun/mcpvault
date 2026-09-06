import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
let vault: string, wiki: LlmWikiService;
const properties = '---\nllm_wiki_type: knowledge\nnote_kind: project\nlifecycle: active\nproject_purpose: A purpose\ndesired_outcome: A result\nnext_action: Execute a concrete experiment\n';
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-project-planning-'));
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
test.each(['```md\n', '~~~~md\n```\n', '````md\n```\n'])('fenced planning headings are examples, not readiness evidence: %s', async fence => {
  await writeFile(join(vault, 'Project.md'), properties + '---\n# Project\n' + fence + '## Brainstorm\n## Project support\n## Outcome');
  const result = await wiki.projectPacket();
  expect(result.items[0]!.planning).toMatchObject({ brainstormSection: false, projectSupport: false, outcomeCriteria: false, ready: false });
});
test('one huge project still respects a 512-character service budget', async () => {
  await writeFile(join(vault, 'Project.md'), properties + `project_support: ["${'x'.repeat(18000)}"]\n---\n# Project`);
  const result = await wiki.projectPacket(undefined, 12, 512);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
});
test('real headings after a matching closing fence remain planning evidence', async () => {
  await writeFile(join(vault, 'Project.md'), properties + '---\n# Project\n~~~~md\n## Example\n~~~~\n## Brainstorm ###\n## Project support\n## Outcome');
  const result = await wiki.projectPacket();
  expect(result.items[0]!.planning).toMatchObject({ brainstormSection: true, projectSupport: true, outcomeCriteria: true, ready: true });
});
test('a leading body thematic break is not treated as another Properties block', async () => {
  await writeFile(join(vault, 'Project.md'), properties + '---\n---\n## Brainstorm\n## Project support\n## Outcome');
  expect((await wiki.projectPacket()).items[0]!.planning.ready).toBe(true);
});
test('pre-existing list previews explicitly disclose omitted source details', async () => {
  await writeFile(join(vault, 'Project.md'), properties + `project_support: ${JSON.stringify(Array.from({ length: 10 }, (_, i) => `[[Target${i}]]`))}\n---\n# Project`);
  const row = (await wiki.projectPacket()).items[0]!;
  expect(row.projectSupport).toHaveLength(8);
  expect(row.detailsOmitted).toBe(true);
  expect(row.readAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'Project.md' } });
  expect(row.nextAction).toBe('Execute a concrete experiment');
  expect(row.readAction.arguments.expectedRevision).toBe(row.revision);
});

async function project(fields: Record<string, unknown>) {
  await writeFile(join(vault, 'Project.md'), '---\n' + stringify({ llm_wiki_type: 'knowledge', note_kind: 'project', ...fields }) + '---\n## Brainstorm\n## Outcome');
  return (await wiki.projectPacket()).items[0]!;
}

test.each([{}, [], 42, true, '   '].map(value => [value]))('project planning does not manufacture content from malformed Properties: %j', async value => {
  const row = await project({ project_purpose: value, desired_outcome: value, next_action: value, waiting_for: value, next_actions: [value], project_support: [value] });
  expect(row.planning).toMatchObject({ purpose: false, desiredOutcome: false, projectSupport: false, ready: false });
  expect(row.missing).toEqual(expect.arrayContaining(['purpose', 'desired_outcome', 'next_action', 'project_support']));
  for (const field of ['purpose', 'desiredOutcome', 'nextAction', 'nextActions', 'waitingFor', 'projectSupport']) expect(row[field]).toBeUndefined();
});

test('project preview filters blank entries before applying its eight-item limit', async () => {
  const row = await project({ project_purpose: '  Purpose  ', desired_outcome: '  Outcome  ', next_action: '   ', waiting_for: '   ', next_actions: [...Array(9).fill(''), '  Execute the experiment  '], project_support: ['', null, '  [[Evidence]]  '] });
  expect(row).toMatchObject({ purpose: 'Purpose', desiredOutcome: 'Outcome', nextActions: ['Execute the experiment'], projectSupport: ['[[Evidence]]'] });
  expect(row.waitingFor).toBeUndefined();
  expect(row.missing ?? []).not.toContain('next_action');
  expect(row.execution.ready).toBe(true);
  expect(row.readAction.arguments.expectedRevision).toBe(row.revision);
});

test.each([{}, ['open'], 'invented', '   '].map(value => [value]))('project does not mark malformed workflow state executable: %j', async task_status => {
  const row = await project({ task_status, project_purpose: 'Purpose', desired_outcome: 'Outcome', next_action: 'Execute the experiment', project_support: ['[[Evidence]]'] });
  expect(row.execution.ready).toBe(false);
  expect(row.missing).toContain('task_status');
});
