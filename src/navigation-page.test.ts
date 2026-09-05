import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

let vault: string;
let client: Client;
let server: ReturnType<typeof createServer>;
const deepPath = Array.from({ length: 5 }, (_, i) => `${i}-${'segment'.repeat(9)}`).join('/') + '/Reader.md';
const heading = 'heading'.repeat(60);
const exactLink = `[[Target#${heading}|descriptive alias]]`;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-navigation-'));
  await mkdir(dirname(join(vault, deepPath)), { recursive: true });
  await writeFile(join(vault, 'Target.md'), `# ${heading}`);
  await writeFile(join(vault, deepPath), `${exactLink}\n[[Missing${'X'.repeat(350)}]]`);
  await mkdir(join(vault, '_scopes/models/codex'), { recursive: true });
  await writeFile(join(vault, '_scopes/models/codex/Target.md'), '# Target');
  await writeFile(join(vault, '_scopes/models/codex/Reader.md'), Array(12).fill('[[Target]]').join('\n'));
  server = createServer(vault, { version: 'navigation-pages' });
  client = new Client({ name: 'navigation-pages', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
});
afterEach(async () => { await client.close(); await server.close(); await rm(vault, { recursive: true, force: true }); });
async function call(endpointId: string, args: Record<string, unknown>, accessToken?: string) {
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args, ...(accessToken && { accessToken }) } });
  const text = (result.content as Array<{ text: string }>)[0]!.text;
  return { result, text, page: result.isError ? undefined : JSON.parse(text) };
}

test('public graph pages retain exact long paths, link text, heading locators and parsed revisions', async () => {
  const { page } = await call('mcp.get_backlinks', { path: 'Target.md', maxChars: 12000 });
  expect(page.backlinks[0]).toMatchObject({ path: deepPath, link: exactLink, targetHeading: heading });
  expect(page.targetRevision).toMatch(/^[a-f0-9]{64}$/);
  expect(page.backlinks[0].sourceRevision).toMatch(/^[a-f0-9]{64}$/);
  const out = await call('mcp.get_outlinks', { path: page.backlinks[0].path, maxChars: 12000 });
  expect(out.result.isError).not.toBe(true);
  expect(out.page.source).toBe(deepPath);
  expect(out.page.sourceRevision).toBe(page.backlinks[0].sourceRevision);
  expect(out.page.outlinks[0]).toMatchObject({ link: exactLink, targetHeading: heading });
  const unresolved = await call('mcp.find_unresolved_links', { maxChars: 12000 });
  expect(unresolved.page.unresolved[0]).toMatchObject({ path: deepPath, target: `Missing${'X'.repeat(350)}` });
  const orphans = await call('mcp.find_orphan_notes', { maxChars: 12000 });
  expect(orphans.page.orphans.some((item: any) => item.path === deepPath)).toBe(true);
});

test('scoped graph continuations are public callable URIs with no internal paths or tokens', async () => {
  const registration = await call('auth.register', { accountId: 'nav-reader', modelId: 'codex', password: 'temporary-navigation-password' });
  const token = registration.page.accessToken;
  expect(token).toBeTruthy();
  const first = await call('mcp.get_backlinks', { path: 'scope://model/codex/Target.md', limit: 2, maxChars: 12000, prettyPrint: true }, token);
  expect(first.page.target).toBe('scope://model/codex/Target.md');
  expect(first.page.backlinks[0].path).toBe('scope://model/codex/Reader.md');
  expect(first.text).not.toContain('_scopes');
  expect(first.text).not.toContain(token);
  expect(first.page.nextAction.arguments).toMatchObject({ path: 'scope://model/codex/Target.md', offset: 2, prettyPrint: true });
  const next = await call(first.page.nextAction.endpointId, first.page.nextAction.arguments, token);
  expect(next.result.isError).not.toBe(true);
  expect(next.page.offset).toBe(2);
  expect(next.page.backlinks[0].line).toBeGreaterThan(first.page.backlinks.at(-1).line);
  const outgoing = await call('mcp.get_outlinks', { path: first.page.backlinks[0].path, limit: 2, maxChars: 1024 }, token);
  expect(outgoing.text.length).toBeLessThanOrEqual(1024);
  expect(outgoing.page.source).toBe('scope://model/codex/Reader.md');
  expect(outgoing.page.sourceRevision).toBe(first.page.backlinks[0].sourceRevision);
  expect(outgoing.page.nextAction.arguments.path).toBe(outgoing.page.source);
  expect((await call('mcp.get_backlinks', { path: first.page.target })).result.isError).toBe(true);
});

test('public oversized locators retry at the same position instead of silently skipping', async () => {
  const longHeading = 'detail'.repeat(250);
  await writeFile(join(vault, 'Huge.md'), `[[Target#${longHeading}]]`);
  const first = await call('mcp.get_outlinks', { path: 'Huge.md', maxChars: 1024 });
  expect(first.result.isError).not.toBe(true);
  expect(first.text.length).toBeLessThanOrEqual(1024);
  expect(first.page.outlinks).toEqual([]);
  expect(first.page.nextAction.reuseOriginalArguments).toBe(true);
  const next = await call(first.page.nextAction.endpointId, { path: 'Huge.md', ...first.page.nextAction.overrides });
  expect(next.result.isError).not.toBe(true);
  expect(next.page.outlinks[0].targetHeading).toBe(longHeading);
  expect(next.page.truncated).toBe(false);
});
