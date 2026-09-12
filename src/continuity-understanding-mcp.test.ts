import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import { FileSystemService } from './filesystem.js';
import { getWikiPolicyTopic } from './wiki-policy.js';
import { getContinuityTools } from './continuity-tools.js';
import { collectPlainFrontmatterReferences, isNavigationalFrontmatterReference } from './property-references.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test('progressive memory policy teaches reported understanding, pinned evidence and safe resume', () => {
  const text = JSON.stringify(getWikiPolicyTopic('memory', 12000));
  expect(text).toContain('understanding');
  expect(text).toContain('expectedRevision');
  expect(text).toContain('peer_check_report');
  expect(getContinuityTools().find(tool => tool.name === 'save_work_state')!.description).toContain('understanding');
});

test('understanding locators are historical path references, not authored graph evidence', () => {
  const refs = collectPlainFrontmatterReferences({ learning_understanding: [{ supports: [{ path: 'A.md', revision: 'a'.repeat(64) }], checks: [{ evidence: [{ path: 'B.md', revision: 'b'.repeat(64) }] }] }] });
  expect(refs.map(ref => ref.value)).toEqual(['A.md', 'B.md']);
  expect(refs.every(ref => !isNavigationalFrontmatterReference(ref))).toBe(true);
});

test('real MCP adapters preserve five tools and support private understanding with callable pinned reads', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'understanding-mcp-')); roots.push(vault);
  const fs = new FileSystemService(vault);
  await fs.writeNote({ path: 'Knowledge/Cache.md', content: '# Conditions\nReliable events are required.\nEvent loss is not covered.', frontmatter: { note_kind: 'atomic' } });
  const revision = await fs.readNoteRevision('Knowledge/Cache.md');
  const server = createServer(vault, { version: 'understanding-test' });
  const client = new Client({ name: 'understanding-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const call = async (endpointId: string, args: Record<string, unknown> = {}, accessToken?: string) => {
    const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args, ...(accessToken && { accessToken }) } });
    const text = (result.content as any[]).map(item => item.text || '').join('');
    let value: any; try { value = JSON.parse(text); } catch { /* errors are text */ }
    return { value, text, error: result.isError };
  };
  try {
    await Promise.all([client.connect(a), server.connect(b)]);
    expect((await client.listTools()).tools).toHaveLength(5);
    const auth = await call('auth.register', { accountId: 'learner', userId: 'fixture', modelId: 'codex', agentId: 'learner', password: randomUUID() });
    expect(auth.error, auth.text).toBeFalsy(); const token = auth.value.accessToken;
    const malformed = await call('continuity.save', { understanding: 'Do not guess the array schema.' }, token);
    expect(malformed.error).toBe(true);
    expect(malformed.text.length).toBeLessThanOrEqual(512);
    expect(malformed.value?.nextAction).toMatchObject({ tool: 'search_capabilities', arguments: { query: 'continuity.save', maxChars: 12000 } });
    const recoveredSchema = await client.callTool({ name: malformed.value.nextAction.tool, arguments: { ...malformed.value.nextAction.arguments, accessToken: token } });
    const saveInput = JSON.parse((recoveredSchema.content as any[])[0].text).endpoints[0].input;
    expect(saveInput.properties.understanding.type).toBe('array');
    expect(saveInput.properties.understanding.items.properties.supports).toBeDefined();
    expect(saveInput.required).not.toContain('accessToken');
    expect((await call('continuity.resume', {}, token)).value.exists).toBe(false);
    expect((await call('continuity.resume')).error).toBe(true);
    const pulse = await client.callTool({ name: 'get_agent_pulse', arguments: { accessToken: token } });
    const pulseText = JSON.stringify(pulse.content);
    expect(pulseText).toContain('continuity.save');
    expect(pulseText).toContain('understanding');
    expect(pulseText).toContain('Do not publish private follow-up notes');
    expect(JSON.parse((pulse.content as any[])[0].text).cadence.length).toBeLessThanOrEqual(600);
    const compactPulse = await client.callTool({ name: 'get_agent_pulse', arguments: { accessToken: token, maxChars: 3000, prettyPrint: true } });
    const compactText = (compactPulse.content as any[])[0].text;
    expect(compactText.length).toBeLessThanOrEqual(3000);
    expect(compactText).toContain('continuity.save');
    const tinyPulse = await client.callTool({ name: 'get_agent_pulse', arguments: { accessToken: token, maxChars: 512 } });
    const tinyText = (tinyPulse.content as any[])[0].text;
    expect(tinyText.length).toBeLessThanOrEqual(512);
    const tiny = JSON.parse(tinyText);
    if (!tiny.cadence?.includes('continuity.save')) {
      expect(tiny.guidanceOmitted).toBe(true);
      expect(tiny.nextAction.tool).toBe('get_agent_pulse');
      expect(tiny.nextAction.arguments.maxChars).toBeGreaterThan(512);
      const retry = await client.callTool({ name: tiny.nextAction.tool, arguments: { ...tiny.nextAction.arguments, accessToken: token } });
      expect(JSON.stringify(retry.content)).toContain('continuity.save');
    }
    for (const query of ['session handoff', '세션 인계']) {
      const discovered = await client.callTool({ name: 'search_capabilities', arguments: { query, accessToken: token, maxChars: 20000 } });
      expect(JSON.stringify(discovered.content)).toContain('continuity.save');
    }
    const writeHelp = await client.callTool({ name: 'search_capabilities', arguments: { query: 'notes.write', accessToken: token, maxChars: 12000 } });
    expect(JSON.stringify(writeHelp.content)).toContain('continuity.save');
    expect(JSON.stringify(writeHelp.content)).toContain('complete Markdown file including YAML Properties');
    expect(JSON.stringify(writeHelp.content)).toContain('omitted Properties are deleted');
    expect(JSON.stringify(writeHelp.content)).toContain('notes.patch');
    expect(JSON.stringify(writeHelp.content)).toContain('evidence_paths');
    const readHelp = await client.callTool({ name: 'search_capabilities', arguments: { query: 'notes.read', maxChars: 12000 } });
    expect(JSON.stringify(readHelp.content)).toContain('not local client paths');
    const namedHelp = await client.callTool({ name: 'search_capabilities', arguments: { query: 'continuity.save next-session handoff', accessToken: token, maxChars: 4000 } });
    const namedCatalog = JSON.parse((namedHelp.content as any[])[0].text);
    expect(namedCatalog.endpoints[0].endpointId).toBe('continuity.save');
    expect(namedCatalog.endpoints.some((endpoint: any) => endpoint.endpointId === 'notes.write')).toBe(false);
    for (const query of ['continuity.save.', 'continuity.save:', '(continuity.save).', 'Use `continuity.save`: next-session handoff']) {
      const help = await client.callTool({ name: 'search_capabilities', arguments: { query, accessToken: token, maxChars: 4000 } });
      const catalog = JSON.parse((help.content as any[])[0].text);
      expect(catalog.endpoints.map((endpoint: any) => endpoint.endpointId), query).toEqual(['continuity.save']);
    }
    const args = { topic: 'Cache conditions', summary: 'Conditional understanding', nextAction: 'Examine event-loss recovery.', understanding: [{ explanation: 'Reliable events are a prerequisite, not optional.', supports: [{ path: 'scope://global/Knowledge/Cache.md', revision, startLine: 2, endLine: 3 }], openQuestions: ['How does reconciliation recover?'], nextStep: 'Inspect the recovery algorithm.' }] };
    expect((await call('continuity.save', args)).error).toBe(true);
    const saved = await call('continuity.save', args, token);
    expect(saved.error, saved.text).toBeFalsy();
    const resumed = await call('continuity.resume', { maxChars: 4000, prettyPrint: true }, token);
    expect(resumed.error, resumed.text).toBeFalsy(); expect(resumed.text.length).toBeLessThanOrEqual(4000);
    expect(resumed.value.understanding.state).toBe('current_references');
    const next = resumed.value.understanding.nextAction;
    const read = await call(next.endpointId, next.arguments, token);
    expect(read.error, read.text).toBeFalsy(); expect(read.text).toContain('Event loss is not covered.');
    const anon = await call('notes.read', { path: saved.value.path, maxChars: 4000 });
    expect(anon.error).toBe(true);
    await fs.writeNote({ path: 'Knowledge/Cache.md', content: '# Changed\nNeeds periodic reconciliation.' });
    const stale = await call('continuity.resume', { maxChars: 4000 }, token);
    expect(stale.error, stale.text).toBeFalsy(); expect(stale.value.understanding.canResume).toBe(false);
    expect(stale.value.understanding.state).toBe('stale_references');
    expect((await call(next.endpointId, next.arguments, token)).error).toBe(true);
  } finally { await client.close(); await server.close(); }
});
