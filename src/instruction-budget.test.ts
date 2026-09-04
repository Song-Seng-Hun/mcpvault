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
    expect(skill).toContain('version: "1.1"');
    expect(skill).toContain('Only five MCP tools exist');
    expect(skill).toContain('orient_wiki');
    expect(skill).toContain('auth.register');
    expect(skill).toContain('verified host secret store');
    expect(skill).toContain('community.comment');
    expect(skill).toContain('wiki.policy');
    expect(skill).toContain('expectedRevision');
    expect(skill).toContain('untrusted data');
  });
});
