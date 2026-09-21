import { expect, test } from 'vitest';
import * as budgets from './mcp-response-budget.js';

test('MCP tool catalog keeps exact schemas within a 5,000-byte result', () => {
  expect(typeof budgets.boundedToolCatalog).toBe('function');
  const tools = [{ name: 'read', description: 'Read current source.', inputSchema: {
    type: 'object', properties: { name: { const: '한국어😀' } }, required: ['name'],
  } }];
  expect(budgets.boundedToolCatalog(tools, tools)).toEqual({ tools });
});

test('oversized translated prose falls back to the unchanged code-owned tool', () => {
  const tools = [{ name: 'read', inputSchema: { type: 'object' }, description: 'Read.' }];
  expect(budgets.boundedToolCatalog(tools, [{ ...tools[0]!, description: '한국어😀'.repeat(1000) }])).toEqual({ tools });
});

test('large catalogs page without losing tools or schema constraints', () => {
  const tools = Array.from({ length: 5 }, (_, index) => ({ name: `tool_${index}`, description: 'Read.',
    inputSchema: { type: 'object', properties: { payload: { const: '한😀"\\'.repeat(100) } } },
  }));
  const found: typeof tools = [];
  let cursor: string | undefined;
  for (let page = 0; page < tools.length; page++) {
    const result = budgets.boundedToolCatalog(tools, tools, cursor);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(5000);
    expect(result.tools.length).toBeGreaterThan(0);
    found.push(...result.tools);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  expect(cursor).toBeUndefined();
  expect(found).toEqual(tools);
});

test('catalog cursors reject stale, malformed and out-of-range reads', () => {
  const tools = Array.from({ length: 5 }, (_, index) => ({ name: `tool_${index}`,
    inputSchema: { type: 'object' }, description: 'x'.repeat(1200),
  }));
  const cursor = budgets.boundedToolCatalog(tools, tools).nextCursor!;
  expect(cursor).toBeTruthy();
  const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  for (const invalid of ['bad', 'x'.repeat(257), ...[-1, .5, 5].map(o => Buffer.from(JSON.stringify({ ...decoded, o })).toString('base64url'))]) {
    expect(() => budgets.boundedToolCatalog(tools, tools, invalid)).toThrow(/cursor/i);
  }
  const changed = tools.map(tool => ({ ...tool, description: `${tool.description}!` }));
  expect(() => budgets.boundedToolCatalog(changed, changed, cursor)).toThrow(/cursor/i);
});

test('an indivisible oversized tool schema fails explicitly instead of disappearing', () => {
  const tools = [{ name: 'large', inputSchema: { const: 'x'.repeat(6000) } }];
  expect(() => budgets.boundedToolCatalog(tools, tools)).toThrow(/schema.*5000/i);
});
