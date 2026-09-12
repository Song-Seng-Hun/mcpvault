import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditService } from './audit.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const principal = { accountId: 'alice', agentId: 'worker', modelId: 'model', role: 'agent' as const };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'audit-authority-')); roots.push(root);
  return { root, audit: new AuditService(root) };
}
test('filtered audit does not echo unchecked identifiers or error references', async () => {
  const { audit } = await fixture();
  await audit.record({ tool: 'write_note', principal, args: { path: 'Public.md', slug: 'SECRET_SLUG' }, outcome: 'error', error: 'Reference unavailable: SECRET_PATH' });
  await audit.record({ tool: 'search_notes', principal, outcome: 'error', error: 'SECRET_SEARCH_PATH' });
  const result = await audit.list({ principal, includeErrors: true, canAccessPath: path => path === 'Public.md' });
  expect(result.events).toHaveLength(2);
  expect(JSON.stringify(result)).not.toMatch(/SECRET_/);
});
test('structured audit path metadata remains bounded even before request validation', async () => {
  const { root, audit } = await fixture();
  await audit.record({ tool: 'read_note', principal, args: { path: 'x'.repeat(100_000) }, outcome: 'attempt' });
  expect(Buffer.byteLength(await readFile(join(root, '.mcpvault', 'audit.ndjson'), 'utf8'))).toBeLessThan(1500);
});
