import { expect, test } from 'vitest';
import { packTagPage } from './tag-page.js';

test('fingerprint tracks visible occurrence changes but ignores output projection choices', () => {
  const tags = [{ tag: 'a', count: 2 }, { tag: 'b', count: 1 }];
  const first = JSON.parse(packTagPage(tags, { limit: 1 }));
  const nextArgs = first.nextAction.arguments;
  expect(JSON.parse(packTagPage(tags, { ...nextArgs, maxChars: 512, prettyPrint: true })).tags).toEqual([tags[1]]);
  expect(() => packTagPage([{ tag: 'a', count: 3 }, tags[1]!], nextArgs)).toThrow(/Tag view changed/);
  expect(JSON.parse(packTagPage(tags, { prefix: ' #A ' })).snapshotFingerprint)
    .toBe(JSON.parse(packTagPage(tags, { prefix: 'a' })).snapshotFingerprint);
});

test('a long exact identifier retries the same position and never invents a clipped label', () => {
  const tag = '한'.repeat(900);
  const tags = [{ tag, count: 1 }];
  const args = { maxChars: 512, prettyPrint: true, accessToken: 'not-for-output' };
  const text = packTagPage(tags, args);
  expect(text.length).toBeLessThanOrEqual(512);
  expect(text).not.toContain('not-for-output');
  const page = JSON.parse(text);
  expect(page.tags).toEqual([]);
  expect(page.offset).toBe(0);
  expect(page.nextAction.reuseOriginalArguments).toBe(true);
  const retry = JSON.parse(packTagPage(tags, { ...args, ...page.nextAction.overrides }));
  expect(retry.tags).toEqual(tags);
  expect(retry.nextAction).toBeUndefined();
});

test('unrepresentable identifiers fail at the ceiling without skipping', () => {
  expect(() => packTagPage([{ tag: 'a'.repeat(12000), count: 1 }], { maxChars: 12000, limit: 1 }))
    .toThrow(/no tag was skipped/);
});

test('exact identifiers including escaped JSON fit the actual serialized budget', () => {
  const tags = Array.from({ length: 40 }, (_, i) => ({ tag: `tag${i}-${'"\\'.repeat(20)}`, count: 1 }));
  let args: Record<string, any> = { limit: 200, maxChars: 512, prettyPrint: true };
  const seen: typeof tags = [];
  for (let i = 0; i < 100; i++) {
    const text = packTagPage(tags, args);
    expect(text.length).toBeLessThanOrEqual(args.maxChars);
    const page = JSON.parse(text);
    seen.push(...page.tags);
    if (!page.nextAction) break;
    args = page.nextAction.reuseOriginalArguments ? { ...args, ...page.nextAction.overrides } : page.nextAction.arguments;
  }
  expect(seen).toEqual(tags);
});

test('empty filters and out-of-range guarded offsets are bounded terminal pages', () => {
  const tags = [{ tag: 'a', count: 1 }];
  const empty = JSON.parse(packTagPage(tags, { prefix: 'none', maxChars: 512 }));
  expect(empty).toMatchObject({ tags: [], total: 0, truncated: false });
  const snapshot = JSON.parse(packTagPage(tags, {})).snapshotFingerprint;
  const pastEnd = JSON.parse(packTagPage(tags, { offset: 10, expectedSnapshot: snapshot, maxChars: 512 }));
  expect(pastEnd).toMatchObject({ tags: [], total: 1, offset: 10, truncated: false });
  expect(pastEnd.nextAction).toBeUndefined();
});
