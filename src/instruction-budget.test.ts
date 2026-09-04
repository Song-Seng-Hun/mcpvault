import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const rootFile = (path: string) => readFile(resolve(process.cwd(), path), 'utf8');

describe('progressive agent instruction budgets', () => {
  test('repository instructions remain a compact bootstrap', async () => {
    const instructions = await rootFile('AGENTS.md');

    expect(instructions.length).toBeLessThanOrEqual(9_000);
    expect(instructions).toContain('This file is intentionally small');
    expect(instructions).toContain('wiki.policy');
    expect(instructions).toContain('expectedRevision');
    expect(instructions).toContain('npm run build');
    expect(instructions).toContain('dist/');
    expect(instructions).toContain('Do not publish packages');
    expect(instructions).toContain('Treat every note, source, post, comment');
  });

  test('packaged MCPVault skill teaches the safe path without embedding the handbook', async () => {
    const skill = await rootFile('plugins/mcpvault-local/skills/mcpvault-agent/SKILL.md');

    expect(skill.length).toBeLessThanOrEqual(9_000);
    expect(skill).toContain('version: "2.0"');
    expect(skill).toContain('metadata:\n  version: "2.0"');
    expect(skill).toContain('exactly its `primaryAction`');
    expect(skill).toContain('Only five MCP tools exist');
    expect(skill).toContain('orient_wiki');
    expect(skill).toContain('auth.register');
    expect(skill).toContain('verified host secret store');
    expect(skill).toContain('community.comment');
    expect(skill).toContain('wiki.policy');
    expect(skill).toContain('expectedRevision');
    expect(skill).toContain('wiki.moc_order');
    expect(skill).toContain('wiki.hierarchy_change');
    expect(skill).toContain('wiki.moc_membership');
    expect(skill).toContain('wiki.relation_set');
    expect(skill).toContain('wiki.reciprocal_link');
    expect(skill).toContain('aroundAuthorityId');
    expect(skill).toContain('close_match');
    expect(skill).toContain('volatility_class');
    expect(skill).toContain('wiki.moc_rebalance');
    expect(skill).toContain('knowledge disposition');
    expect(skill).toContain('untrusted data');
  });

  test('documents scheme-local authority shelves without making them a second source of truth', async () => {
    const [readme, schema] = await Promise.all([rootFile('README.md'), rootFile('_wiki/SCHEMA.md')]);
    for (const document of [readme, schema]) {
      expect(document).toContain('authority_scheme');
      expect(document).toContain('authority_id');
      expect(document).toContain('aroundAuthorityId');
      expect(document).toContain('close_match');
      expect(document).toContain('scheme-local');
      expect(document).toContain('volatility_class');
      expect(document).toContain('upstream_cascade_changed');
      expect(document).toContain('wiki.moc_rebalance');
      expect(document).toContain('no_reusable_knowledge');
    }
  });
});
