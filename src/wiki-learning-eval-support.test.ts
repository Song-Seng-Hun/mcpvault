import { expect, test } from 'vitest';
import { EventEmitter } from 'node:events';
import { buildCodexArgs, buildEvalEnvironment, cleanupResources, waitForChildExit, sanitizeEvent, summarizeTrial, createReportSanitizer } from '../scripts/wiki-learning-eval-support.mjs';

test('isolates actual Codex evaluation from installed plugins, shell and production MCP', () => {
  const args = buildCodexArgs('http://127.0.0.1:34567/mcp', 'C:/temporary/work', 'gpt-5.6-luna');
  expect(args).toContain('--ignore-user-config');
  expect(args).toContain('--ephemeral');
  expect(args).toContain('read-only');
  expect(args).toContain('mcp_servers.eval.bearer_token_env_var="MCPVAULT_EVAL_TOKEN"');
  expect(args).toContain('mcp_servers.eval.default_tools_approval_mode="approve"');
  for (const name of ['plugins', 'apps', 'shell_tool', 'unified_exec', 'multi_agent', 'memories', 'hooks']) {
    expect(args.some((item: string, index: number) => item === '--disable' && args[index + 1] === name)).toBe(true);
  }
  expect(args.join(' ')).not.toContain('dangerously');
  for (const url of ['http://127.0.0.1:8788/mcp', 'https://example.com/mcp', 'http://0.0.0.0:34567/mcp']) {
    expect(() => buildCodexArgs(url, 'C:/temporary/work', 'gpt-5.6-luna')).toThrow();
  }
});

test('does not persist reasoning events or secrets nested inside serialized MCP results', () => {
  expect(sanitizeEvent({ type: 'item.completed', item: { type: 'reasoning', text: 'private' } }, ['a-secret'])).toBeUndefined();
  const value = sanitizeEvent({ type: 'item.completed', item: { type: 'mcp_tool_call', arguments: { password: 'password-secret' }, result: { content: [{ text: JSON.stringify({ accessToken: 'token-secret', nested: { password: 'secret-again' }, message: 'a-secret' }) }] } } }, ['a-secret']);
  const serialized = JSON.stringify(value);
  for (const secret of ['password-secret', 'token-secret', 'secret-again', 'a-secret']) expect(serialized).not.toContain(secret);
  expect(serialized).toContain('[REDACTED]');
});

test('redaction recursively omits reasoning from arrays and serialized objects while retaining failure observations', () => {
  const canary = 'PRIVATE-EVAL-CANARY-NOT-FOR-OUTPUT';
  const raw = { privateCanaryObserved: true, data: [{ type: 'reasoning', text: 'nested-private-reasoning' }, { text: canary }], serialized: JSON.stringify({ item: { type: 'reasoning', text: 'serialized-private-reasoning' } }) };
  const report = sanitizeEvent(raw, [canary]);
  const text = JSON.stringify(report);
  expect(text).not.toContain('nested-private-reasoning');
  expect(text).not.toContain('serialized-private-reasoning');
  expect(text).not.toContain(canary);
  expect(report.privateCanaryObserved).toBe(true);
  expect(report.data).toHaveLength(1);
});

test('artifact-only and host-response canary failures remain observable after redaction', () => {
  const canary = 'PRIVATE-EVAL-CANARY-NOT-FOR-OUTPUT';
  for (const raw of [{ before: '', after: canary }, { content: [{ text: JSON.stringify({ checkpoint: canary }) }] }, { error: canary }]) {
    const sanitizer = createReportSanitizer([canary], canary);
    expect(sanitizer.privateCanaryObserved).toBe(false);
    expect(JSON.stringify(sanitizer.sanitize(raw))).not.toContain(canary);
    expect(sanitizer.privateCanaryObserved).toBe(true);
  }
});

test('observed tool use and changed bytes do not automatically certify semantic quality', () => {
  const events = [{ type: 'item.completed', item: { type: 'mcp_tool_call', tool: 'call_endpoint', arguments: { endpointId: 'notes.patch' }, result: { isError: false } } }];
  const result = summarizeTrial(events, { before: 'A', after: 'B', beforeNotes: ['Knowledge/Cache.md'], afterNotes: ['Knowledge/Cache.md'] });
  expect(result).toMatchObject({ noteChanged: true, addedKnowledgeNotes: [], semanticAssessment: 'requires_transcript_and_artifact_review' });
  expect(result).not.toHaveProperty('passed');
  expect(result.endpoints).toEqual(['notes.patch']);
});

test('duplicate-note observations compare actual path sets, not the model claim', () => {
  const result = summarizeTrial([], { before: 'same', after: 'same', beforeNotes: ['Knowledge/Cache.md'], afterNotes: ['Knowledge/Cache.md', 'Knowledge/Cache-copy.md'] });
  expect(result.noteChanged).toBe(false);
  expect(result.addedKnowledgeNotes).toEqual(['Knowledge/Cache-copy.md']);
});

test('child environment excludes unrelated credentials and provider overrides', () => {
  const env = buildEvalEnvironment({ Path: 'node-path', SystemRoot: 'C:/Windows', USERPROFILE: 'C:/user', APPDATA: 'C:/user/app', OPENAI_API_KEY: 'unrelated', OPENAI_BASE_URL: 'https://other.invalid', NODE_OPTIONS: '--import=host-script', MCPVAULT_TOKEN: 'production' }, 'temporary');
  expect(env).toMatchObject({ Path: 'node-path', SystemRoot: 'C:/Windows', USERPROFILE: 'C:/user', MCPVAULT_EVAL_TOKEN: 'temporary' });
  for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'NODE_OPTIONS', 'MCPVAULT_TOKEN']) expect(env).not.toHaveProperty(key);
});

test('complete artifact and failure reports redact bearer secrets as well as nested events', () => {
  const report = sanitizeEvent({ before: 'token-in-note', after: 'password: generated-password', error: 'Authorization: Bearer abcdefghijklmnop', trials: [{ before: 'token-in-note' }] }, ['token-in-note']);
  for (const secret of ['token-in-note', 'generated-password', 'abcdefghijklmnop']) expect(JSON.stringify(report)).not.toContain(secret);
});

test('failed or hanging closes do not prevent remaining cleanup or exact fixture removal', async () => {
  const calls: string[] = [];
  const result = await cleanupResources([
    ['failed', async () => { calls.push('failed'); throw Error('failed'); }],
    ['hung', () => new Promise(() => {})],
    ['later', async () => { calls.push('later'); }],
  ], async () => { calls.push('remove'); }, 10);
  expect(calls).toEqual(['failed', 'later', 'remove']);
  expect(result.removed).toBe(true);
  expect(result.errors.map((entry: { resource: string }) => entry.resource)).toEqual(['failed', 'hung']);
});

test('timeout or interruption releases the trial wait even without a child close event', async () => {
  await expect(waitForChildExit(new EventEmitter(), { timeoutMs: 10 })).rejects.toThrow('time limit');
  const controller = new AbortController();
  const wait = waitForChildExit(new EventEmitter(), { timeoutMs: 1000, signal: controller.signal });
  controller.abort();
  await expect(wait).rejects.toThrow('interrupted');
});
