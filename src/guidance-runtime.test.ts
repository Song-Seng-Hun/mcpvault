import { expect, test } from 'vitest';
import { guidanceError, guidanceText, renderGuidanceError, withGuidance, projectGuidance } from './guidance-runtime.js';
import { getWikiPolicyTopic } from './wiki-policy.js';

test('explicit prose resolution is request-local and leaves unmarked content untouched', async () => {
  expect(guidanceText('greeting', 'Welcome')).toBe('Welcome');
  const a = { resolve: (_id: string, text: string) => `A:${text}`, resolveDefault: (text: string) => `A:${text}` };
  const b = { resolve: (_id: string, text: string) => `B:${text}`, resolveDefault: (text: string) => `B:${text}` };
  expect(await Promise.all([withGuidance(a, async () => { await Promise.resolve(); return guidanceText('greeting', 'Welcome'); }), withGuidance(b, async () => guidanceText('greeting', 'Welcome'))])).toEqual(['A:Welcome', 'B:Welcome']);
  const body = { content: 'Welcome', enum: ['Welcome'], description: 'Welcome' };
  expect(withGuidance(a, () => projectGuidance(body))).toEqual({ ...body, description: 'A:Welcome' });
  expect(body.description).toBe('Welcome');
});

test('annotated errors retain identity and internal messages; only presentation resolves', () => {
  const error = new TypeError('Only an editor may write');
  expect(guidanceError(error, 'permission')).toBe(error);
  withGuidance({ resolve: () => '편집자만 수정할 수 있습니다.', resolveDefault: s => s }, () => {
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe('Only an editor may write');
    expect(renderGuidanceError(error)).toBe('편집자만 수정할 수 있습니다.');
    expect(renderGuidanceError(new Error('Unmarked'))).toBe('Unmarked');
  });
});

test('resolver failure leaves original errors and trusted schema text usable', () => {
  const broken = { resolve: (): string => { throw new Error('Missing host config'); }, resolveDefault: (): string => { throw new Error('Missing host config'); } };
  withGuidance(broken, () => {
    expect(renderGuidanceError(guidanceError(new Error('Original denial'), 'denial'))).toBe('Original denial');
    expect(projectGuidance({ description: 'Original' }).description).toBe('Original');
  });
});

test('policy overview and topic receipts both change with Vault prose and remain compatible', () => {
  const before = getWikiPolicyTopic('overview').policyFingerprint;
  withGuidance({ resolve: (_id, s) => s, resolveDefault: s => s.startsWith('Read priority guidance') ? 'Revised protected notice guidance.' : s }, () => {
    const overview = getWikiPolicyTopic('overview');
    const notice = getWikiPolicyTopic('notices', 12000);
    expect(overview.policyFingerprint).not.toBe(before);
    expect(notice.policyFingerprint).toBe(overview.policyFingerprint);
    expect(notice.purpose).toBe('Revised protected notice guidance.');
  });
});
