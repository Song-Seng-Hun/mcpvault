import { describe, expect, test } from 'vitest';
import { explanationKey, validateExplanationDraft, validateExplanationReview, explanationApproval } from './explanation-model.js';
import type { WorkExecutionProfile } from './work-staffing.js';

const source = { path: 'Guide.md', revision: 'a'.repeat(64), content: '# Guide\nUse `notes.read` with `maxChars: 3000`.\nNever disclose passwords.\n' };
const draft = { blocks: [{ text: '문서는 `notes.read`로 읽고 `maxChars: 3000`으로 제한합니다. 비밀번호는 공개하지 마세요. 원문 제한: Never disclose passwords.', startLine: 2, endLine: 3 }] };
const profile = (accountId: string, family: string): WorkExecutionProfile => ({ accountId, family, version: '1', hostVerified: true, tier: 'standard', capabilities: [], tools: [] });
const profiles = [profile('writer', 'gemini'), profile('reviewer', 'gpt')];
const review = { checks: ['fidelity', 'coverage', 'no_invention', 'clarity'].map(criterion => ({ criterion, verdict: 'pass', reason: 'Compared the command, limit and password prohibition with the source.', blockIndices: [0] })) };

describe('source-pinned plain-language explanations', () => {
  test('preserves conditional and prohibitive source sentences verbatim alongside explanation', () => {
    const conditional = { ...source, content: 'Only if approved, proceed. Never delete the original.' };
    expect(() => validateExplanationDraft({ blocks: [{ text: 'Always proceed. Delete the original.', startLine: 1, endLine: 1 }] }, conditional)).toThrow(/constraint/i);
    expect(validateExplanationDraft({ blocks: [{ text: conditional.content + ' 승인된 경우만 진행하세요.', startLine: 1, endLine: 1 }] }, conditional).blocks).toHaveLength(1);
  });
  test('fenced commands cannot be altered while keeping numbers and API names', () => {
    const fenced = { ...source, content: '```sh\nnpm run build\n```' };
    expect(() => validateExplanationDraft({ blocks: [{ text: '```sh\nnpm run delete\n```', startLine: 1, endLine: 3 }] }, fenced)).toThrow(/code/i);
  });
  test('key is stable and changes with source revision or audience', () => {
    expect(explanationKey(source, 'ko', 'beginner')).toBe(explanationKey({ ...source }, 'ko', 'beginner'));
    expect(explanationKey(source, 'ko', 'beginner')).not.toBe(explanationKey({ ...source, revision: 'b'.repeat(64) }, 'ko', 'beginner'));
    expect(explanationKey(source, 'ko', 'beginner')).not.toBe(explanationKey(source, 'ko', 'expert'));
  });
  test('accepts bounded mapped paragraphs preserving protected literals', () => {
    expect(validateExplanationDraft(draft, source).blocks).toEqual(draft.blocks);
  });
  test.each([
    { blocks: [{ ...draft.blocks[0], text: 'Use `notes.write` with 5000.' }] },
    { blocks: [{ ...draft.blocks[0], startLine: 0 }] },
    { blocks: [{ ...draft.blocks[0], endLine: 100 }] },
    { blocks: [{ ...draft.blocks[0], text: 'x'.repeat(3001) }] },
    { blocks: [{ ...draft.blocks[0], execute: 'shell' }] },
  ])('rejects changed literals, invalid locators and unbounded or executable fields', value => {
    expect(() => validateExplanationDraft(value, source)).toThrow();
  });
  test('requires every source paragraph to be covered, not only a matching fragment', () => {
    expect(() => validateExplanationDraft({ blocks: [{ text: 'Use `notes.read` with `maxChars: 3000`.', startLine: 2, endLine: 2 }] }, source)).toThrow(/coverage/i);
  });
  test('labeled examples cannot carry unsourced commands or numeric claims', () => {
    expect(() => validateExplanationDraft({ blocks: [...draft.blocks, { text: 'Run `delete_all` 9000 times.', example: true, startLine: 2, endLine: 3 }] }, source)).toThrow(/literal/i);
  });
  test('requires criterion judgments with mapped evidence, not a read receipt', () => {
    expect(validateExplanationReview(review, 1).checks).toHaveLength(4);
    expect(() => validateExplanationReview({ checks: [] }, 1)).toThrow();
    expect(() => validateExplanationReview({ checks: review.checks.map(c => ({ ...c, blockIndices: [9] })) }, 1)).toThrow();
  });
  test('approval requires current source, independent verified family, all criteria passing', () => {
    const accepted = validateExplanationDraft(draft, source);
    const checked = validateExplanationReview(review, accepted.blocks.length);
    const input = { sourceRevision: source.revision, currentRevision: source.revision, author: 'writer', reviewer: 'reviewer', profiles, review: checked };
    expect(explanationApproval(input)).toEqual({ approved: true, reason: 'verified_cross_model' });
    expect(explanationApproval({ ...input, currentRevision: 'b'.repeat(64) })).toMatchObject({ approved: false, reason: 'source_changed' });
    expect(explanationApproval({ ...input, reviewer: 'writer' })).toMatchObject({ approved: false });
    expect(explanationApproval({ ...input, profiles: [profiles[0]!, profile('reviewer', 'gemini')] })).toMatchObject({ approved: false });
    expect(explanationApproval({ ...input, profiles: [profiles[0]!, profile('reviewer', ' Gemini ')] })).toMatchObject({ approved: false });
    expect(explanationApproval({ ...input, profiles: [profiles[0]!, profile('reviewer', ' unknown ')] })).toMatchObject({ approved: false });
    expect(explanationApproval({ ...input, profiles: [] })).toMatchObject({ approved: false });
    expect(explanationApproval({ ...input, review: { checks: checked.checks.map(c => ({ ...c, verdict: 'uncertain' as const })) } })).toMatchObject({ approved: false });
  });
});
