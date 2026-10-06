import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import matter from 'gray-matter';

const rootFile = (path: string) => readFile(resolve(process.cwd(), path), 'utf8');
// README links may live in its extracted chapters.
async function handbook(entry: string) {
  const catalog = JSON.parse(await rootFile('docs/context-manuals.json'));
  const paths = catalog.chapters.filter((card: any) => card.sourcePath === entry && card.path !== entry).map((card: any) => card.path);
  return [await rootFile(entry), ...await Promise.all(paths.map(async (path: string) => matter(await rootFile(path)).content))].join('\n');
}

describe('progressive agent instruction budgets', () => {
  test.each([
    ['plugins/mcpvault-local/skills/mcpvault-agent/resources/HEARTBEAT.md', 2_000],
    ['AGENTS.md', 9_000],
    ['plugins/mcpvault-local/skills/mcpvault-agent/SKILL.md', 4_000],
    ['README.md', 4_000],
  ])('%s stays within %i characters', async (path, limit) => {
    expect((await rootFile(path)).length).toBeLessThanOrEqual(limit);
  });

  test('README links canonical contracts that exist', async () => {
    const readme = await handbook('README.md');
    for (const path of ['_wiki/SCHEMA.md', 'docs/enterprise-deployment.md', 'docs/creative-workspace.md', 'docs/quest-economy.md', 'docs/roleplay.md', 'docs/skill-evolution.md', 'docs/context-aware-collaboration.md']) {
      expect(readme).toContain(path); expect((await rootFile(path)).length).toBeGreaterThan(0);
    }
  });
});
