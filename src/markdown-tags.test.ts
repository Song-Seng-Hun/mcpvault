import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { VaultGraphIndex } from './vault-graph.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

let vault: string;
let graph: VaultGraphIndex;
let fs: FileSystemService;
const all = () => true;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-tags-'));
  graph = new VaultGraphIndex(vault, new PathFilter(), new FrontmatterHandler());
  fs = new FileSystemService(vault);
});
afterEach(async () => { graph.close(); await rm(vault, { recursive: true, force: true }); });

test.each([
  ['matching and mismatched fences', '#real\n````md\n#example\n```\n#still_example\n````\n~~~\n#tilde_example\n~~~\n#after', ['real', 'after']],
  ['closed inline spans', '#real `#inline` ``#long ` #nested`` #after', ['real', 'after']],
  ['escaped hashes and word fragments', '#real \\#escaped word#fragment https://example.org/#anchor #after', ['real', 'after']],
  ['Unicode and nested identities', '#한국어/정리 #café #🧠 #2026년 #1984 #topic/deep #_todo', ['한국어/정리', 'café', '🧠', '2026년', 'topic/deep', '_todo']],
  ['unmatched backticks remain text', '`unclosed #real\n\n#after', ['real', 'after']],
  ['heading markers and punctuation', '# Heading\n(#real) ##subheading #after.', ['real', 'after']],
  ['adjacent Markdown delimiters', '#real`code` (#after)', ['real', 'after']],
  ['paired escapes and composed emoji', '\\\\#real #🧑🏽‍💻 #🇰🇷', ['real', '🧑🏽‍💻', '🇰🇷']],
])('%s uses the same body tags for graph and note reads', async (_name, body, expected) => {
  await writeFile(join(vault, 'Note.md'), body as string);
  const expectedTags = [...expected].sort();
  const listed = await fs.manageTags({ path: 'Note.md', operation: 'list' });
  expect(listed.success).toBe(true);
  expect(listed.tags.sort()).toEqual(expectedTags);
  expect((await graph.listAllTags(all)).map(row => row.tag).sort()).toEqual(expectedTags);
  expect((await fs.listAllTags()).map(row => row.tag).sort()).toEqual(expectedTags);
});

test('tag add never promotes literal examples or truncates nested tags into Properties', async () => {
  const body = '#topic/deep\n```md\n#example\n```\n`#inline`\n';
  await writeFile(join(vault, 'Note.md'), body);
  const result = await fs.manageTags({ path: 'Note.md', operation: 'add', tags: ['review'] });
  expect(result.success).toBe(true);
  const raw = await readFile(join(vault, 'Note.md'), 'utf8');
  const parsed = new FrontmatterHandler().parse(raw);
  expect(parsed.frontmatter.tags).toEqual(['topic/deep', 'review']);
  expect(parsed.content).toBe(body);
});

test('sharing the literal mask does not change hashes inside link aliases', () => {
  const link = '[[Target|label \\#literal]]';
  expect(extractObsidianLinkOccurrences(link)[0]!.link).toBe(link);
});

test('graph occurrence counts and warm literal edits remain consistent', async () => {
  await writeFile(join(vault, 'Note.md'), '#Tag #tag `#tag`');
  expect(await graph.listAllTags(all)).toEqual([{ tag: 'tag', count: 2 }]);
  await writeFile(join(vault, 'Note.md'), '~~~\n#Tag #tag\n~~~\n#new');
  graph.invalidate('Note.md', 'upsert');
  expect(await graph.listAllTags(all)).toEqual([{ tag: 'new', count: 1 }]);
});

test('public MCP tag discovery delivers bounded real tags, not examples', async () => {
  await writeFile(join(vault, 'Note.md'), '#한국어/정리 #real\n~~~\n#fake\n~~~\n`#inline`');
  const server = createServer(vault, { version: 'literal-tags' });
  const client = new Client({ name: 'literal-tags', version: '1' });
  try {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(ct), server.connect(st)]);
    const result = await client.callTool({ name: 'call_endpoint', arguments: {
      endpointId: 'mcp.list_all_tags', arguments: { maxChars: 1024 },
    } });
    expect(result.isError).not.toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text.length).toBeLessThanOrEqual(1024);
    expect(JSON.parse(text).map((row: { tag: string }) => row.tag).sort()).toEqual(['real', '한국어/정리']);
  } finally { await client.close(); await server.close(); }
});
