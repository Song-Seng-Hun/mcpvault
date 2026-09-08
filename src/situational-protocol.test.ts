import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, getServerRuntime } from './createServer.js';
import { FileSystemService } from './filesystem.js';
import { evaluationPrompts } from '../scripts/wiki-learning-eval-support.mjs';

const close: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const action of close.splice(0).reverse()) await action(); });
test('situation trial prompts contain task conditions but no endpoint walkthrough', () => {
  const prompts = evaluationPrompts('situation');
  expect(prompts.first).toContain('NAS'); expect(prompts.second).toContain('LOCAL');
  expect(JSON.stringify(prompts)).not.toMatch(/context_pack|context_rules|endpoint|schema|call_endpoint/);
});
test('dynamic context endpoint accepts query, preserves path-only mode and bounded schema', async () => {
  const root = await mkdtemp(join(tmpdir(), 'situation-protocol-')); close.push(() => rm(root, { recursive: true, force: true }));
  const fs = new FileSystemService(root);
  await fs.writeNote({ path: 'Knowledge/A.md', content: 'watcher only works after verification.', frontmatter: { note_kind: 'atomic', context_rules: { all: ['NAS'] } } });
  const server = createServer(root); close.push(() => server.close());
  const runtime = getServerRuntime(server)!;
  const call = async (arguments_: Record<string, unknown>) => {
    const result = await runtime.dispatchTool('call_endpoint', { endpointId: 'wiki.context_pack', arguments: arguments_ });
    const text = result.content.map((c: any) => c.text || '').join('');
    return { result, text, value: result.isError ? undefined : JSON.parse(text) };
  };
  const current = await call({ query: 'watcher', context: 'NAS', intent: 'execute', explain: true });
  expect(current.result.isError, current.text).not.toBe(true);
  expect(current.value.mode).toBe('situation'); expect(current.text.length).toBeLessThanOrEqual(4000);
  expect(current.text).toContain('only works after verification');
  const old = await call({ path: 'Knowledge/A.md' });
  expect(old.result.isError, old.text).not.toBe(true); expect(old.value.mode).not.toBe('situation');
  expect((await call({ query: 'watcher', context: 'x'.repeat(2001) })).result.isError).toBe(true);
  expect((await call({ query: 'watcher', maxChars: 12001 })).result.isError).toBe(true);
});
