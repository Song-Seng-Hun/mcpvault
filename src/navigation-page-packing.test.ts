import { expect, test } from 'vitest';
import { packNavigationPage } from './navigation-page.js';

const endpoint = 'mcp.get_backlinks';
const page = { offset: 0, limit: 100, maxChars: 1024 };
const row = (path: string) => ({ path, line: 1, link: '[[Target]]', context: 'context '.repeat(100), sourceRevision: 'a'.repeat(64) });
test('an exact long locator retries without returning a zero-progress continuation', () => {
  const result = { target: 'Target.md', backlinks: [row('folder/'.repeat(200) + 'Note.md')], total: 1, truncated: false };
  const text = packNavigationPage('backlinks', endpoint, result, page, { accessToken: 'never-echo' });
  expect(text.length).toBeLessThanOrEqual(1024);
  expect(text).not.toContain('never-echo');
  const retry = JSON.parse(text);
  expect(retry.backlinks).toEqual([]);
  expect(retry.nextAction.reuseOriginalArguments).toBe(true);
  const expanded = JSON.parse(packNavigationPage('backlinks', endpoint, result,
    { ...page, ...retry.nextAction.overrides }, retry.nextAction.overrides));
  expect(expanded.backlinks[0].path).toBe(result.backlinks[0]!.path);
});
test('a locator larger than the maximum budget fails explicitly without a fake shortened path', () => {
  expect(() => packNavigationPage('backlinks', endpoint, { target: 'Target.md', backlinks: [row('x'.repeat(12000))], total: 1 },
    { offset: 0, limit: 1, maxChars: 12000 }, {})).toThrow(/No navigation item was skipped/);
});
test('projection happens before admission and every budget page advances by emitted entries', () => {
  const rows = Array.from({ length: 18 }, (_, i) => row(`_private/Note${i}.md`));
  let offset = 0;
  const seen: string[] = [];
  while (offset < rows.length) {
    const text = packNavigationPage('backlinks', endpoint, { target: '_private/Target.md', backlinks: rows.slice(offset), total: rows.length },
      { ...page, offset }, { prettyPrint: true }, p => p.replace('_private/', 'scope://agent/a/'));
    expect(text.length).toBeLessThanOrEqual(1024);
    expect(text).not.toContain('_private');
    const result = JSON.parse(text);
    expect(result.backlinks.length).toBeGreaterThan(0);
    seen.push(...result.backlinks.map((item: any) => item.path));
    offset += result.backlinks.length;
    if (result.nextAction) expect(result.nextAction.arguments).toMatchObject({ offset, path: 'scope://agent/a/Target.md', prettyPrint: true });
  }
  expect(seen).toEqual(rows.map(r => r.path.replace('_private/', 'scope://agent/a/')));
});
test('the existing offset ceiling never emits an invalid next action', () => {
  const result = JSON.parse(packNavigationPage('backlinks', endpoint,
    { target: 'Target.md', backlinks: [row('A.md')], total: 100002 }, { offset: 100000, limit: 1, maxChars: 12000 }, {}));
  expect(result).toMatchObject({ truncated: true, paginationLimited: true });
  expect(result.nextAction).toBeUndefined();
});

test('prefix admission accounts for smaller continuation metadata beyond the offset ceiling', () => {
  const result = JSON.parse(packNavigationPage('backlinks', endpoint,
    { target: 'T'.repeat(700), backlinks: Array.from({ length: 10 }, () => ({ path: 'x'.repeat(20) })), total: 100100 },
    { offset: 99994, limit: 10, maxChars: 1200 }, {}));
  expect(result.backlinks.length).toBeGreaterThan(6);
  expect(result.paginationLimited).toBe(true);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(1200);
});
