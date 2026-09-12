import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';

let vault: string;
let server: ReturnType<typeof createServer>;
let client: Client;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-question-'));
  server = createServer(vault, { version: 'question-test' });
  client = new Client({ name: 'question-test', version: '1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
});
afterEach(async () => { await client.close(); await server.close(); await rm(vault, { recursive: true, force: true }); });
async function note(path: string, content: string) {
  await mkdir(dirname(join(vault, path)), { recursive: true }); await writeFile(join(vault, path), content);
}
async function call(endpointId: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
  const text = (result.content as any[]).map(x => x.text || '').join('');
  return { error: result.isError, text, value: result.isError ? undefined : JSON.parse(text) };
}
test('query packet reads late conditions and keeps source identity within the whole budget', async () => {
  await note('Knowledge/Retry.md', '---\nllm_wiki_type: knowledge\nnote_kind: atomic\n---\n# Guide\n\nUnrelated introduction.\n\n## Retry conditions\n\n재시도는 멱등 요청에만 허용한다. 결제 요청은 재시도하지 않는다.\n');
  const r = await call('wiki.answer_packet', { query: '재시도', includeSemantic: false, maxChars: 4000 });
  expect(r.error, r.text).toBeFalsy();
  expect(r.value.mode).toBe('question');
  expect(r.value.status).toBe('context_found');
  expect(r.text).toContain('결제 요청은 재시도하지 않는다');
  expect(r.value.sources[0]).toMatchObject({ path: 'Knowledge/Retry.md', revision: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(r.value.sources[0].passages[0].startLine).toBeGreaterThan(7);
  expect(r.text.length).toBeLessThanOrEqual(4000);
});
test('context search preserves paragraph, marks clipping and returns guarded read action', async () => {
  await note('Knowledge/Long.md', '# Conditions\n\nRetry is permitted only for safe requests. ' + 'More context. '.repeat(60));
  const r = await call('wiki.search', { query: 'Retry', excerptMode: 'context', includeRevisions: true, maxChars: 4000 });
  expect(r.error, r.text).toBeFalsy();
  expect(r.value[0].context.truncated).toBe(true);
  expect(r.value[0].ex).toContain('only for safe requests');
  expect(r.value[0].ex.length).toBeLessThanOrEqual(350);
  expect(r.value[0].nextAction.arguments.expectedRevision).toBe(r.value[0].rv);
});
test('query mode retains lexical fallback and never relaxes exact or structured searches', async () => {
  await note('Knowledge/Fallback.md', '---\nllm_wiki_type: knowledge\n---\n# Retry\n\nretry policy excludes payments.');
  const r = await call('wiki.answer_packet', { query: 'retry missing', includeSemantic: false });
  expect(r.error, r.text).toBeFalsy();
  // Existing lexical search already accepts any matching ordinary term.
  expect(r.value.retrieval.expanded).toBe(false);
  expect(r.value.retrieval.usedQuery).toBe('retry missing');
  const miss = await call('wiki.answer_packet', { query: 'unknown absent', includeSemantic: false });
  expect(miss.value.retrieval.expanded).toBe(true);
  expect(miss.value.retrieval.usedQuery).toBe('unknown OR absent');
  for (const query of ['"retry missing"', 'path:Absent retry', 'retry -payments']) {
    const x = await call('wiki.answer_packet', { query, includeSemantic: false });
    expect(x.error, x.text).toBeFalsy(); expect(x.value.retrieval.expanded).toBe(false);
    expect(x.value.status).toBe('no_match');
  }
});
test('ambiguous visible aliases require selection, hidden identities do not appear', async () => {
  for (const [name, hidden] of [['One', false], ['Two', false], ['Secret', true]] as const) {
    await note(`Knowledge/${name}.md`, `---\nllm_wiki_type: knowledge\naliases: [공유명]\n${hidden ? 'moderation_status: hidden\n' : ''}---\n# ${name}\n공유명 설명.`);
  }
  await note('_scopes/agents/other/Private.md', '---\naliases: [공유명]\n---\nPrivate needle');
  const r = await call('wiki.answer_packet', { query: '공유명', includeSemantic: false });
  expect(r.error, r.text).toBeFalsy(); expect(r.value.status).toBe('needs_selection');
  expect(r.value.candidates).toHaveLength(2);
  expect(r.text).not.toMatch(/Secret|Private|other/);
});
test('review status is not a counterpoint, social material is only a lead', async () => {
  await note('Knowledge/Review.md', '---\nllm_wiki_type: knowledge\nlifecycle: review\nsummary: obsolete\nsummary_of_content_sha256: old\nvalid_until: 2001-01-01\n---\n# Retry\nretry safely.');
  await note('Community/Posts/Lead.md', '---\nmcpvault_type: blog_post\nstatus: published\n---\n# Discussion\nretry experiences.');
  const r = await call('wiki.answer_packet', { query: 'retry', includeSemantic: false, maxChars: 12000 });
  expect(r.error, r.text).toBeFalsy();
  const root = r.value.sources.find((x: any) => x.path === 'Knowledge/Review.md');
  expect(root.role).toBe('knowledge'); expect(root.freshness.summary).toBe('stale');
  expect(root.freshness.validity.state).toBe('expired'); expect(root.freshness.review).toBe('review');
  expect(r.value.sources.find((x: any) => x.path === 'Community/Posts/Lead.md').role).toBe('lead');
});
test('one-character and no-match queries return bounded honest results', async () => {
  await note('Knowledge/A.md', '# 가\n가 '.repeat(500));
  const short = await call('wiki.answer_packet', { query: '가', includeSemantic: false, maxChars: 1024 });
  expect(short.error, short.text).toBeFalsy(); expect(short.value.status).toBe('needs_selection');
  expect(short.text.length).toBeLessThanOrEqual(1024);
  const none = await call('wiki.answer_packet', { query: 'qzxnonexistent', includeSemantic: false });
  expect(none.error, none.text).toBeFalsy(); expect(none.value.status).toBe('no_match');
  expect(none.value.nextAction).toBeDefined();
});

test('claim evidence locators select exact source context without overlapping question terms', async () => {
  const body = '# Study\n\nUnrelated introduction.\n\n## Result\n\nOnly idempotent requests are safe.\n';
  const sha = createHash('sha256').update(body).digest('hex');
  await note('_sources/Study.md', `---\nllm_wiki_type: source\nimmutable: true\nsource_work_id: original-study\ncontent_sha256: ${sha}\n---\n${body}`);
  await note('Knowledge/Claims.md', '---\nllm_wiki_type: knowledge\nclaims:\n  - id: retry-rule\n    text: 재시도 조건\n    evidence:\n      - path: _sources/Study.md\n        startLine: 7\n        endLine: 7\n---\n# 재시도\n재시도 조건은 연구 원문을 참고한다.');
  const r = await call('wiki.answer_packet', { query: '재시도', includeSemantic: false, maxChars: 12000 });
  expect(r.error, r.text).toBeFalsy();
  const source = r.value.sources.find((x: any) => x.path === '_sources/Study.md');
  expect(source, r.text).toBeDefined();
  expect(source.passages[0].text).toContain('Only idempotent');
  expect(source.evidence).toMatchObject({ workId: 'original-study', integrity: 'intact', locator: 'current' });
});

test('empty single-character search is no_match, not empty ambiguity', async () => {
  const r = await call('wiki.answer_packet', { query: '힣', includeSemantic: false });
  expect(r.error, r.text).toBeFalsy(); expect(r.value.status).toBe('no_match');
});

test('retired lifecycle and absent integrity remain explicit without promoting review to contradiction', async () => {
  await note('Knowledge/Retired.md', '---\nllm_wiki_type: knowledge\nlifecycle: retired\n---\n# Legacy\nlegacy behavior is unsupported.');
  const r = await call('wiki.answer_packet', { query: 'legacy', includeSemantic: false });
  expect(r.error, r.text).toBeFalsy();
  expect(r.value.sources[0].freshness.lifecycle).toBe('retired');
  expect(r.value.sources[0].freshness.sourceIntegrity).toBe('unspecified');
});

test('anonymous search cannot inject model or agent identities through extra arguments', async () => {
  await note('_scopes/models/victim/Secret.md', '# identitycanary\nPRIVATE_MODEL_CANARY');
  await note('_scopes/agents/victim/Secret.md', '# identitycanary\nPRIVATE_AGENT_CANARY');
  for (const id of [{ modelId: 'victim' }, { agentId: 'victim' }]) {
    const r = await call('wiki.search', { query: 'identitycanary', ...id });
    expect(r.text).not.toMatch(/PRIVATE_|victim|Secret/);
    expect(r.error, r.text).toBeFalsy(); expect(r.value).toEqual([]);
  }
});

test('ordinary task records remain at most two leads; negative knowledge preserves canonical polarity', async () => {
  for (let i = 0; i < 3; i++) await note(`Tasks/Task${i}.md`, '---\nnote_kind: task\n---\n# Task\nretry task history.');
  await note('Knowledge/Negative.md', '---\nllm_wiki_type: knowledge\nnote_kind: knowledge\nknowledge_polarity: negative\nnegative_type: failure\ntask_status: open\n---\n# Failure\nretry failed without idempotency.');
  const r = await call('wiki.answer_packet', { query: 'retry', includeSemantic: false, maxChars: 12000 });
  expect(r.error, r.text).toBeFalsy();
  expect(r.value.sources.filter((s: any) => s.role === 'lead')).toHaveLength(2);
  expect(r.value.sources.find((s: any) => s.path === 'Knowledge/Negative.md').role).toBe('counterpoint');
  expect(r.value.sources.find((s: any) => s.path === 'Knowledge/Negative.md').counterpointKind).toBe('negative_knowledge');
});

test('long question at a tiny budget never suggests the same failing budget retry', async () => {
  const r = await call('wiki.answer_packet', { query: 'qzxnonexistent'.repeat(30), includeSemantic: false, maxChars: 1024 });
  expect(r.error, r.text).toBeFalsy(); expect(r.text.length).toBeLessThanOrEqual(1024);
  expect(r.value.gaps).not.toContain('context_changed_or_unavailable');
});

test('context search retains a late match on a long single line', async () => {
  await note('Knowledge/Late.md', '# Conditions\n\n' + 'x'.repeat(2000) + ' TARGET only when safe.');
  const r = await call('wiki.search', { query: 'TARGET', excerptMode: 'context' });
  expect(r.error, r.text).toBeFalsy(); expect(r.value[0].ex).toContain('TARGET only when safe.');
});

test.each(['startLine: 0\n        endLine: 0', 'startLine: 1.5\n        endLine: 2', 'startLine: 3', 'heading: Missing\n        blockId: real'])('invalid evidence locator is never current: %s', async locator => {
  const body = '# Intro\n\nEvidence context. ^real\n';
  await note('_sources/Locator.md', `---\nllm_wiki_type: source\nimmutable: true\ncontent_sha256: ${createHash('sha256').update(body).digest('hex')}\n---\n${body}`);
  await note('Knowledge/Root.md', `---\nllm_wiki_type: knowledge\nevidence:\n  - path: _sources/Locator.md\n    ${locator.replace(/        /g, '    ')}\n---\n# locatorneedle\nlocatorneedle context.`);
  const r = await call('wiki.answer_packet', { query: 'locatorneedle', path: 'Knowledge/Root.md', includeSemantic: false, maxChars: 12000 });
  expect(r.error, r.text).toBeFalsy();
  expect(r.value.sources.find((s: any) => s.path === '_sources/Locator.md').evidence.locator).toBe('stale');
});

test('weaker related anchors never downgrade a genuine source citation', async () => {
  const body = '# Intro\n\nEvidence context.\n';
  await note('_sources/Cited.md', `---\nllm_wiki_type: source\nimmutable: true\ncontent_sha256: ${createHash('sha256').update(body).digest('hex')}\n---\n${body}`);
  await note('Knowledge/Root.md', '---\nllm_wiki_type: knowledge\nevidence_paths: [_sources/Cited.md]\nrelated: ["_sources/Cited.md#Intro"]\n---\n# citationneedle\ncitationneedle context.');
  const r = await call('wiki.answer_packet', { query: 'citationneedle', path: 'Knowledge/Root.md', includeSemantic: false, maxChars: 12000 });
  expect(r.error, r.text).toBeFalsy();
  expect(r.value.sources.find((s: any) => s.path === '_sources/Cited.md').role).toBe('source');
  expect(r.value.gaps).not.toContain('no_verified_immutable_evidence');
});

test.each([['token^real', 'stale'], ['token ^real', 'current']] as const)('block boundary %s yields %s', async (anchor, state) => {
  const body = `# Source\n\n${anchor}\n`;
  await note('_sources/Block.md', `---\nllm_wiki_type: source\nimmutable: true\ncontent_sha256: ${createHash('sha256').update(body).digest('hex')}\n---\n${body}`);
  await note('Knowledge/Root.md', '---\nllm_wiki_type: knowledge\nevidence:\n  - path: _sources/Block.md\n    blockId: real\n---\n# blockneedle\nblockneedle context.');
  const r = await call('wiki.answer_packet', { query: 'blockneedle', path: 'Knowledge/Root.md', includeSemantic: false, maxChars: 12000 });
  expect(r.error, r.text).toBeFalsy();
  expect(r.value.sources.find((s: any) => s.path === '_sources/Block.md').evidence.locator).toBe(state);
});
