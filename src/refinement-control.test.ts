import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { getAgentPulseTools } from './agent-pulse-tools.js';
import { FileSystemService } from './filesystem.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-refinement-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const vault = join(root, 'vault'); await mkdir(vault);
  await writeFile(join(vault, 'Welcome.md'), '# Welcome\nRead this revision once.');
  const noticeConfigPath = join(root, 'notices.json');
  await writeFile(noticeConfigPath, JSON.stringify({ version: 1, vaultPath: vault,
    notices: [{ id: 'welcome', path: 'Welcome.md', title: 'Welcome', priority: 100, topics: ['onboarding'], editors: [] }] }));
  const server = createServer(vault, { noticeConfigPath }); cleanup.push(() => server.close());
  const client = new Client({ name: 'refinement', version: '1' }); cleanup.push(() => client.close());
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
  };
  return { client, call, vault };
}

test('public pulse uses its one complete schema including notice receipts and relevant skill', async () => {
  const { client } = await fixture();
  const tools = (await client.listTools()).tools;
  expect(tools).toHaveLength(5);
  const schema = tools.find(t => t.name === 'get_agent_pulse')!.inputSchema;
  expect(schema.properties).toHaveProperty('knownNoticeRevisions');
  expect(schema.properties).toHaveProperty('noticeTopic');
  expect(schema.properties).toHaveProperty('skillId');
  expect(schema).toEqual(getAgentPulseTools()[0]!.inputSchema);
  expect(schema.properties!.maxChars).toMatchObject({ minimum: 512, default: 4000 });
});

test('an unchanged notice receipt reaches work while a changed notice is offered again', async () => {
  const { call, vault } = await fixture();
  const first = await call('orient_wiki');
  const read = await call('call_endpoint', first.primaryAction);
  const args = { purpose: 'work', knownNoticeRevisions: { welcome: read.revision }, maxChars: 3000 };
  const continued = await call('get_agent_pulse', args);
  expect(continued.protocol).not.toBe('mcpvault-notice/v1');
  expect(JSON.stringify(continued).length).toBeLessThanOrEqual(3000);
  await writeFile(join(vault, 'Welcome.md'), '# Welcome\nUpdated conditions.');
  const changed = await call('get_agent_pulse', args);
  expect(changed.primaryAction.endpointId).toBe('notice.read');
  expect(changed.primaryAction.arguments.expectedRevision).not.toBe(read.revision);
});

test('MCP projection compaction retains synthesis basis drift independently of document freshness', async () => {
  const { call, vault } = await fixture();
  const fs = new FileSystemService(vault);
  const inputs = [];
  for (const id of ['a', 'b']) {
    const path = `${id}.md`;
    const receipt = await fs.writeNoteWithReceipt({ path, frontmatter: { llm_wiki_type: 'knowledge' }, content: 'Original premise' });
    inputs.push({ id, path, revision: receipt.revision });
  }
  await fs.writeNoteWithReceipt({ path: 'Root.md', frontmatter: { llm_wiki_type: 'knowledge', knowledge_synthesis: {
    question: 'Which condition?', inputs,
    explanations: inputs.map(({ id }) => ({ id, explanation: `Explanation ${id}`, appliesWhen: `Condition ${id}`, limitations: 'Only this condition', basis: [id] })),
    choices: [], counterexamples: [], unresolvedQuestions: ['Other conditions?'],
  } }, content: 'Long source content. '.repeat(1000) });
  await fs.writeNoteWithReceipt({ path: 'a.md', frontmatter: { llm_wiki_type: 'knowledge' }, content: 'Changed premise' });
  const projection = await call('call_endpoint', { endpointId: 'wiki.read_projection', arguments: { path: 'Root.md', view: 'progressive', maxChars: 1200 } });
  expect(projection.truncated).toBe(true);
  expect(projection.synthesisBasis.state).toBe('inputs_changed');
  expect(JSON.stringify(projection).length).toBeLessThanOrEqual(1200);
});
