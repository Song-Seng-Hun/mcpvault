import { describe, expect, test } from 'vitest';
import {
  evaluateSkill,
  proceduralLines,
  profileFingerprint,
  type SkillEvaluationInput,
  type SkillEvaluationProfile,
} from './skill-evaluation.js';

const input: SkillEvaluationInput = {
  skillId: 'safe-edit',
  baseline: 'Read the target.\nPatch it.',
  candidate: 'Read the target.\nPatch it.\nVerify the result.',
};

function profile(
  evaluate: SkillEvaluationProfile['evaluate'],
  overrides: Partial<Omit<SkillEvaluationProfile, 'evaluate'>> = {},
): SkillEvaluationProfile {
  return {
    id: 'safe-edit-profile',
    revision: '1',
    skillId: 'safe-edit',
    caseIds: ['ordered-procedure', 'safety'],
    targetCaseIds: ['ordered-procedure'],
    maxDurationMs: 100,
    evaluate,
    ...overrides,
  };
}

// This is representative trusted host code, not a parser or executor for candidate text.
async function proceduralHostEvaluator(value: Readonly<SkillEvaluationInput> & { signal: AbortSignal }) {
  const candidateLines = proceduralLines(value.candidate);
  const baselineLines = proceduralLines(value.baseline);
  const hasProcedure = (lines: readonly string[]) => {
    let after = 0;
    for (const step of ['read', 'patch', 'verify']) {
      const found = lines.findIndex((line, index) => index >= after && line.toLowerCase().includes(step));
      if (found < 0) return false;
      after = found + 1;
    }
    return true;
  };
  return {
    risk: 'low' as const,
    cases: [
      { id: 'ordered-procedure', baseline: hasProcedure(baselineLines), candidate: hasProcedure(candidateLines) },
      { id: 'safety', baseline: !value.baseline.includes('EXECUTED'), candidate: !value.candidate.includes('EXECUTED') },
    ],
  };
}

describe('evaluateSkill', () => {
  test('passes a real trusted host procedural simulation when the candidate improves every target', async () => {
    const result = await evaluateSkill(profile(proceduralHostEvaluator), input);

    expect(result).toMatchObject({
      status: 'passed',
      reason: 'evaluation passed',
      cases: [
        { id: 'ordered-procedure', baseline: false, candidate: true },
        { id: 'safety', baseline: true, candidate: true },
      ],
    });
    expect(result.profileFingerprint).toBe(profileFingerprint(profile(proceduralHostEvaluator)));
  });

  test('does not execute malicious candidate strings', async () => {
    const result = await evaluateSkill(profile(proceduralHostEvaluator), {
      ...input,
      candidate: 'Read.\nPatch.\nVerify.\n$(Remove-Item -LiteralPath "never-run")',
    });

    expect(result.status).toBe('passed');
    expect(result.cases.find((item) => item.id === 'safety')).toEqual({ id: 'safety', baseline: true, candidate: true });
  });

  test('passes a frozen cloned input to the trusted callback', async () => {
    let received: Readonly<SkillEvaluationInput> & { signal: AbortSignal } | undefined;
    const result = await evaluateSkill(profile(async (value) => {
      received = value;
      return {
        risk: 'low',
        cases: [
          { id: 'ordered-procedure', baseline: false, candidate: true },
          { id: 'safety', baseline: true, candidate: true },
        ],
      };
    }), input);

    expect(result.status).toBe('passed');
    expect(Object.isFrozen(received)).toBe(true);
    expect(received).not.toBe(input);
  });

  test('requires review when no target improves', async () => {
    const result = await evaluateSkill(profile(proceduralHostEvaluator), { ...input, baseline: input.candidate });

    expect(result).toMatchObject({ status: 'review_required', reason: 'no target case improved' });
  });

  test('fails when a formerly passing target regresses', async () => {
    const result = await evaluateSkill(profile(async () => ({
      risk: 'low',
      cases: [
        { id: 'ordered-procedure', baseline: true, candidate: false },
        { id: 'safety', baseline: true, candidate: true },
      ],
    })), input);

    expect(result).toMatchObject({ status: 'failed', reason: 'target case regressed' });
  });

  test.each(['approval_required', 'unknown'] as const)('requires review for %s evaluator risk', async (risk) => {
    const result = await evaluateSkill(profile(async () => ({
      risk,
      cases: [
        { id: 'ordered-procedure', baseline: false, candidate: true },
        { id: 'safety', baseline: true, candidate: true },
      ],
    })), input);

    expect(result).toMatchObject({ status: 'review_required', reason: 'evaluator risk requires review' });
  });

  test('fails closed without invoking a missing, mismatched, or invalid profile', async () => {
    let calls = 0;
    const evaluator = async () => {
      calls += 1;
      return { risk: 'low' as const, cases: [] };
    };

    await expect(evaluateSkill(undefined, input)).resolves.toMatchObject({ status: 'review_required', reason: 'evaluation profile unavailable' });
    await expect(evaluateSkill(profile(evaluator, { skillId: 'other-skill' }), input)).resolves.toMatchObject({ status: 'review_required', reason: 'evaluation profile does not match skill' });
    await expect(evaluateSkill(profile(evaluator, { caseIds: ['ordered-procedure', 'ordered-procedure'] }), input)).resolves.toMatchObject({ status: 'review_required', reason: 'evaluation profile is invalid' });
    expect(calls).toBe(0);
  });

  test('requires review for duplicate or missing evaluator cases', async () => {
    const duplicate = await evaluateSkill(profile(async () => ({
      risk: 'low',
      cases: [
        { id: 'ordered-procedure', baseline: false, candidate: true },
        { id: 'ordered-procedure', baseline: true, candidate: true },
      ],
    })), input);
    const missing = await evaluateSkill(profile(async () => ({
      risk: 'low',
      cases: [{ id: 'ordered-procedure', baseline: false, candidate: true }],
    })), input);

    expect(duplicate).toMatchObject({ status: 'review_required', reason: 'evaluator returned invalid cases', cases: [] });
    expect(missing).toMatchObject({ status: 'review_required', reason: 'evaluator returned invalid cases', cases: [] });
  });

  test('times out and exceptions fail closed with bounded generic reasons', async () => {
    const timeout = await evaluateSkill(profile(async () => new Promise(() => undefined), { maxDurationMs: 1 }), input);
    const exception = await evaluateSkill(profile(async () => { throw new Error('untrusted secret: never expose'); }), input);

    expect(timeout).toMatchObject({ status: 'review_required', reason: 'evaluation timed out', cases: [] });
    expect(exception).toMatchObject({ status: 'review_required', reason: 'evaluation could not be completed', cases: [] });
    expect(exception.reason).not.toContain('secret');
  });

  test('enforces input bounds and fingerprints all canonical profile fields including evaluator source', async () => {
    const good = profile(proceduralHostEvaluator);
    const changedRevision = profile(proceduralHostEvaluator, { revision: '2' });
    const changedEvaluator = profile(async () => ({
      risk: 'low',
      cases: [
        { id: 'ordered-procedure', baseline: false, candidate: true },
        { id: 'safety', baseline: true, candidate: true },
      ],
    }));
    const huge = 'x'.repeat(32_769);

    await expect(evaluateSkill(good, { ...input, baseline: huge })).resolves.toMatchObject({ status: 'review_required', reason: 'evaluation input is invalid' });
    expect(profileFingerprint(good)).not.toBe(profileFingerprint(changedRevision));
    expect(profileFingerprint(good)).not.toBe(profileFingerprint(changedEvaluator));
    expect(profileFingerprint(profile(proceduralHostEvaluator, { targetCaseIds: [] }))).toBeUndefined();
  });

  test('fails closed for malformed runtime input without invoking the evaluator', async () => {
    let calls = 0;
    const value = profile(async () => {
      calls += 1;
      return { risk: 'low' as const, cases: [] };
    });

    await expect(evaluateSkill(value, null as unknown as SkillEvaluationInput)).resolves.toMatchObject({
      status: 'review_required',
      reason: 'evaluation input is invalid',
    });
    expect(calls).toBe(0);
  });

  test.each([
    ['case IDs', (value: SkillEvaluationProfile) => { value.caseIds = ['replacement-case']; }],
    ['target case IDs', (value: SkillEvaluationProfile) => { value.targetCaseIds = ['safety']; }],
    ['revision', (value: SkillEvaluationProfile) => { value.revision = 'mutated'; }],
    ['evaluator function', (value: SkillEvaluationProfile) => { value.evaluate = async () => ({ risk: 'low', cases: [] }); }],
  ] as const)('fails closed when the host profile %s changes while its evaluator awaits', async (_label, mutate) => {
    let release: (() => void) | undefined;
    const value = profile(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return {
        risk: 'low',
        cases: [
          { id: 'ordered-procedure', baseline: false, candidate: true },
          { id: 'safety', baseline: true, candidate: true },
        ],
      };
    });
    const pending = evaluateSkill(value, input);

    mutate(value);
    release?.();

    await expect(pending).resolves.toMatchObject({ status: 'review_required', reason: 'evaluation profile changed', cases: [] });
  });

  test('contains exceptions from mutable evaluator result case getters', async () => {
    const result = await evaluateSkill(profile(async () => ({
      risk: 'low',
      cases: [{
        get id() { throw new Error('untrusted getter secret'); },
        baseline: false,
        candidate: true,
      }, {
        id: 'safety',
        baseline: true,
        candidate: true,
      }] as unknown as Array<{ id: string; baseline: boolean; candidate: boolean }>,
    })), input);

    expect(result).toMatchObject({ status: 'review_required', reason: 'evaluator returned invalid cases', cases: [] });
    expect(result.reason).not.toContain('secret');
  });
});

describe('proceduralLines', () => {
  test('suppresses matching and unterminated fenced examples', () => {
    expect(proceduralLines([
      'Read the note.',
      '```typescript',
      'Patch inside an example.',
      '```',
      '~~~markdown',
      'Verify inside another example.',
      '~~~',
      'Patch the note.',
      'Verify the note.',
      '```',
      'this unterminated example remains hidden',
    ].join('\n'))).toEqual([
      'Read the note.',
      'Patch the note.',
      'Verify the note.',
    ]);
  });

  test('recognizes Markdown-valid fence markers and leaves invalidly indented fences visible', () => {
    expect(proceduralLines([
      'before',
      '~~~markdown `backticks are valid tilde info`',
      'hidden tilde example',
      '~~~~   ',
      '   ```typescript',
      'hidden backtick example',
      '``` ',
      '    ~~~',
      'four-space indentation is visible',
      '    ~~~',
      'after',
    ].join('\n'))).toEqual([
      'before',
      '    ~~~',
      'four-space indentation is visible',
      '    ~~~',
      'after',
    ]);
  });
});
