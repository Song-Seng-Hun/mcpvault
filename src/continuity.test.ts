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

  const saved = await continuity.save({ principal, topic: 'Search review', summary: 'The lexical search is bounded.', nextAction: 'Review semantic fallback.', openQuestions: ['Should the index be warmed lazily?'], cursors: { mention: 'mention-2' } });
  const resumed = await continuity.read({ principal, maxChars: 1200 });

  expect(saved.path).toBe('scope://agent/codex-worker/_continuity/work-state.md');
  expect(resumed.exists).toBe(true);
  expect(resumed.fm.topic).toBe('Search review');
  expect(resumed.fm.cursors).toEqual({ mention: 'mention-2' });
  expect(resumed.content).toContain('Review semantic fallback.');
  expect(await fs.noteExists('_scopes/agents/codex-worker/_continuity/work-state.md')).toBe(true);
});
