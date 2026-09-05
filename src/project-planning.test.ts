import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
});
