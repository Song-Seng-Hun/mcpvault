import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { SearchService } from './search.js';
import { PathFilter } from './pathfilter.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { CollaborationService } from './scopes.js';
import { RetrievalService } from './retrieval-service.js';
import { selectSituationCandidates } from './context-selection.js';

let root: string, fs: FileSystemService, access: ScopeAccessPolicy, retrieval: RetrievalService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'context-quota-'));
  fs = new FileSystemService(root); access = new ScopeAccessPolicy();
  const search = new SearchService(root, new PathFilter());
  retrieval = new RetrievalService(search, new CollaborationService(fs, search), undefined, access, fs);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function note(path: string, body: string) {
  await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), body);
}
const select = () => selectSituationCandidates(fs, access, retrieval, 'watcher', { context: 'NAS', intent: 'execute', explain: true });

test.each([0, 1, 2, 3])('reserves at most two of twelve slots for %i condition-only candidates', async count => {
  for (let i = 0; i < 12; i++) await note(`Knowledge/A${String(i).padStart(2, '0')}.md`, '---\nnote_kind: atomic\n---\nwatcher regular');
  for (let i = 0; i < count; i++) await note(`Knowledge/Z${i}.md`, '---\nnote_kind: atomic\ncontext_rules:\n  all: [NAS]\n---\nSpecific reconnect prerequisite.');
  await note('_scopes/agents/other/Hidden.md', '---\ncontext_rules:\n  all: [NAS]\n---\nHIDDEN_CANARY');
  await note('Knowledge/Unmatched.md', '---\ncontext_rules:\n  all: [OTHER]\n---\nwatcher');
  const reads = vi.spyOn(fs, 'readNote');
  const result = await select();
  expect(result.results).toHaveLength(12);
  const paths = result.results.map(h => h.p);
  expect(paths.filter(p => p?.startsWith('Knowledge/Z'))).toHaveLength(Math.min(count, 2));
  expect(paths.filter(p => p?.startsWith('Knowledge/A'))).toHaveLength(12 - Math.min(count, 2));
  expect(new Set(paths).size).toBe(12);
  expect(JSON.stringify(result)).not.toMatch(/Hidden|HIDDEN_CANARY/);
  expect(paths).not.toContain('Knowledge/Unmatched.md');
  expect(reads).not.toHaveBeenCalled();
});

test('already retrieved activation is not duplicated and sparse windows remain usable', async () => {
  await note('Knowledge/A.md', '---\nnote_kind: atomic\ncontext_rules:\n  all: [NAS]\n---\nwatcher active');
  await note('Knowledge/B.md', '---\nnote_kind: atomic\n---\nwatcher ordinary');
  const result = await select();
  expect(result.results.map(h => h.p).sort()).toEqual(['Knowledge/A.md', 'Knowledge/B.md']);
});
