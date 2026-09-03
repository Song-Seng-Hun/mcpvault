import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContinuityService } from './continuity.js';
import { FileSystemService } from './filesystem.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';

const vaults: string[] = [];
afterEach(async () => { for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });

test('continuity checkpoint is private, revisioned, and bounded', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-continuity-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault, new PathFilter(), new FrontmatterHandler());
  const continuity = new ContinuityService(fs);
  const principal = { accountId: 'codex-account', modelId: 'codex', agentId: 'codex-worker', role: 'agent' as const, capabilities: ['journal'] as const };

  const saved = await continuity.save({ principal, topic: 'Search review', summary: 'The lexical search is bounded.', nextAction: 'Review semantic fallback.', openQuestions: ['Should the index be warmed lazily?'], focusQuestions: ['Which cache is authoritative?'], focusProjects: ['MCPVault scale-up'], focusNotes: ['[[Knowledge/Search]]'], pendingEdits: [{ path: 'Knowledge/Search.md', expectedRevision: 'a'.repeat(64), endpointId: 'notes.patch', purpose: 'Apply the reviewed summary without overwriting a peer edit.' }], cursors: { mention: 'mention-2' } });
  const resumed = await continuity.read({ principal, maxChars: 1200 });

  expect(saved.path).toBe('scope://agent/codex-worker/_continuity/work-state.md');
  expect(resumed.exists).toBe(true);
  expect(resumed.fm.topic).toBe('Search review');
  expect(resumed.fm.cursors).toEqual({ mention: 'mention-2' });
  expect(resumed.fm.focus_questions).toEqual(['Which cache is authoritative?']);
  expect(resumed.fm.focus_projects).toEqual(['MCPVault scale-up']);
  expect(resumed.fm.focus_notes).toEqual(['[[Knowledge/Search]]']);
  expect(resumed.fm.pending_edits).toEqual([{ path: 'Knowledge/Search.md', expectedRevision: 'a'.repeat(64), endpointId: 'notes.patch', purpose: 'Apply the reviewed summary without overwriting a peer edit.' }]);
  expect(resumed.content).toContain('Review semantic fallback.');
  expect(resumed.content).toContain('Top-of-mind questions');
  expect(resumed.content).toContain('Pending revision-checked edits');
  expect(await fs.noteExists('_scopes/agents/codex-worker/_continuity/work-state.md')).toBe(true);
});

test('continuity rejects incomplete pending edit guards', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-continuity-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault, new PathFilter(), new FrontmatterHandler());
  const continuity = new ContinuityService(fs);
  const principal = { accountId: 'codex-account', modelId: 'codex', agentId: 'codex-worker', role: 'agent' as const, capabilities: ['journal'] as const };
  await expect(continuity.save({ principal, topic: 'Interrupted edit', summary: 'One path was selected.', nextAction: 'Resume safely.', pendingEdits: [{ path: '../escape.md', expectedRevision: 'a'.repeat(64), endpointId: 'notes.patch' }] })).rejects.toThrow(/pendingEdit\.path/);
  await expect(continuity.save({ principal, topic: 'Interrupted edit', summary: 'One path was selected.', nextAction: 'Resume safely.', pendingEdits: [{ path: 'Knowledge/A.md', endpointId: 'notes.patch' }] })).rejects.toThrow(/expectedRevision/);
});
