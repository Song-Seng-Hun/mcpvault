import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { getOrganizationPropertyContract, organizationLintIssues } from './organization.js';

let root: string;
let fs: FileSystemService;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'context-rule-contract-')); fs = new FileSystemService(root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test.each([
  { all: Array(9).fill('NAS') },
  { any: ['a'.repeat(81)] },
  { exclude: [''] },
  { intents: ['administrator'] },
  { script: 'process.exit()' },
  ['NAS'],
  null,
])('common writer rejects invalid context rules: %j', async context_rules => {
  await expect(fs.writeNote({ path: 'Rule.md', content: 'Example', frontmatter: { context_rules } })).rejects.toThrow(/context.rules/i);
});

test('valid literal rules do not execute regex or template-looking strings', async () => {
  await fs.writeNote({ path: 'Rule.md', content: 'Example', frontmatter: {
    context_rules: { any: ['/NAS.*/', '${process.exit()}', '한글'], all: ['NAS'], exclude: ['Windows'], intents: ['execute'] },
  } });
  expect((await fs.readNote('Rule.md')).frontmatter.context_rules.all).toEqual(['NAS']);
});

test('raw YAML and revision-safe frontmatter updates cannot bypass the contract', async () => {
  await expect(fs.writeNote({ path: 'Escaped.md', content: '---\n"context_\\u0072ules": {script: true}\n---\nBody' })).rejects.toThrow(/context.rules/i);
  await expect(fs.writeNote({ path: 'Raw.md', content: '---\ncontext_rules:\n  unknown: true\n---\nBody' })).rejects.toThrow(/context.rules/i);
  await fs.writeNote({ path: 'Rule.md', content: 'Body' });
  const before = await fs.readNote('Rule.md');
  await expect(fs.updateFrontmatter({ path: 'Rule.md', expectedRevision: before.revision, frontmatter: { context_rules: { all: 5 } } })).rejects.toThrow(/context.rules/i);
  expect((await fs.readNote('Rule.md')).revision).toBe(before.revision);
});

test('Properties contract and lint describe the same bounded rule object', () => {
  const contract = getOrganizationPropertyContract().find(p => p.name === 'context_rules');
  expect(contract).toMatchObject({ type: 'object', schema: { additionalProperties: false, properties: { all: { maxItems: 8, items: { maxLength: 80 } } } } });
  expect(organizationLintIssues('Rule.md', { context_rules: { script: 'x' } }, '').some(i => i.code === 'invalid_context_rules')).toBe(true);
});
