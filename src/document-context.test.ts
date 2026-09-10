import { expect, test } from 'vitest';
import { selectStructuredContextPassages } from './document-context.js';
test('preserves conditions and exact source parts using the common structure', () => {
  const content = '# 결정\r\n\r\n승인하지 않는다. 단, 검증된 경우에만 재검토한다.\r\n\r\n무관한 문단.';
  const result = selectStructuredContextPassages({ content, query: '검증', maxChars: 200, startLine: 10 });
  expect(result.passages).toHaveLength(1);
  expect(result.passages[0]!.text).toContain('승인하지 않는다.');
  const parts = (result.passages[0] as any).sourceRanges;
  expect(parts.some((p: any) => p.role === 'heading')).toBe(true);
  for (const p of parts) expect(content.slice(p.contentStartOffset, p.contentEndOffset)).toBe(result.passages[0]!.text.slice(p.textStartOffset, p.textEndOffset));
  expect(parts.find((p: any) => p.role === 'requested').startLine).toBe(12);
});
test('table snippets preserve the header but omit irrelevant prior rows', () => {
  const content = '# Limits\n\n| Kind | Count |\n| --- | --- |\n| irrelevant | 9 |\n| target | 3 |';
  const result = selectStructuredContextPassages({ content, query: 'target', maxChars: 180 });
  expect(result.passages[0]!.text).toContain('| Kind | Count |');
  expect(result.passages[0]!.text).toContain('| target | 3 |');
  expect(result.passages[0]!.text).not.toContain('irrelevant');
});
test('huge relevant prose is explicitly partial with exact clipped Unicode locators', () => {
  const content = '# Topic\n\n' + '한😀'.repeat(500) + 'needle' + '후😀'.repeat(500);
  const result = selectStructuredContextPassages({ content, query: 'needle', maxChars: 70 });
  expect(result.truncated).toBe(true);
  expect(result.passages[0]!.text).toContain('needle');
  expect(result.passages[0]!.text.length).toBeLessThanOrEqual(70);
  for (const p of (result.passages[0] as any).sourceRanges) expect(content.slice(p.contentStartOffset, p.contentEndOffset)).toBe(result.passages[0]!.text.slice(p.textStartOffset, p.textEndOffset));
  expect((result.passages[0] as any).gaps.length).toBeGreaterThan(0);
});
test('preferred heading locator resolves its paragraph rather than code-fenced headings', () => {
  const content = '# Topic\n\nTarget paragraph\n\n```md\n# Fake\n```';
  const result = selectStructuredContextPassages({ content, query: '', preferredLine: 1, maxChars: 200, maxPassages: 1 });
  expect(result.passages[0]!.text).toContain('Target paragraph');
  expect(result.passages[0]!.headingPath).toEqual(['Topic']);
});
