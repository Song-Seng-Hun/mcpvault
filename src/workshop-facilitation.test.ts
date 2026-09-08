import { expect, test } from 'vitest';
import {
  FACILITATION_METHODS,
  createFacilitation,
  nextFacilitationAction,
  validateFacilitationSubmission,
} from './workshop-facilitation.js';

const base = (methodId: string) => createFacilitation({
  version: 1,
  methods: [{ methodId }],
  purpose: 'Choose a bounded improvement.',
  scope: 'Public workshop contributions only.',
  successCriteria: ['A recorded, reviewable next action.'],
  sourceRevisions: [{ path: 'Evidence.md', revision: 'a'.repeat(64) }],
  facilitatorAccountId: 'facilitator-account',
  participants: ['facilitator-account', 'participant-account'],
  decisionAuthority: { approverAccountId: 'facilitator-account' },
});

test.each(FACILITATION_METHODS.map(method => [method.methodId, method] as const))(
  '%s has bounded executable steps and reports missing prerequisites',
  (methodId, method) => {
    const facilitation = base(methodId);
    expect(facilitation.methods[0]?.steps.length).toBeGreaterThan(1);
    expect(facilitation.methods[0]?.steps.length).toBeLessThanOrEqual(32);
    expect(method.adaptation.length).toBeGreaterThan(30);
    const action = nextFacilitationAction(facilitation, []);
    expect(action.kind).toBe('submit');
    expect(action.stepId).toBe(facilitation.currentStepId);
    expect(action.required).toContain('structured submission');
  },
);

test('rejects a late contribution from a different method step', () => {
  const facilitation = base('six-hats');
  expect(() => validateFacilitationSubmission(facilitation, {
    accountId: 'participant-account', stepId: 'six-hats-alternatives',
    workshopRevision: 'b'.repeat(64), structured: { observations: ['A'] },
  })).toThrow(/step/i);
});

test.each(FACILITATION_METHODS.map(method => [method.methodId] as const))(
  '%s rejects an arbitrary structured reason when the current step fields are missing',
  methodId => {
    const facilitation = base(methodId);
    expect(() => validateFacilitationSubmission(facilitation, {
      accountId: 'participant-account', stepId: facilitation.currentStepId,
      workshopRevision: 'b'.repeat(64), structured: { reason: 'A reason alone cannot complete this step.' },
    })).toThrow(/missing required/i);
  },
);

test('deduplicates one account ballot across roles and sessions', () => {
  const facilitation = base('dot-voting');
  const vote = { ...facilitation, currentStepId: facilitation.methods[0]!.steps[1]!.id };
  const stepId = vote.currentStepId;
  const first = validateFacilitationSubmission(vote, {
    accountId: 'participant-account', stepId, workshopRevision: 'b'.repeat(64),
    structured: { ballot: [{ alternativeId: 'one', rank: 1 }], ranking: 'one first' },
  });
  expect(first.ballotAccountId).toBe('participant-account');
  expect(() => validateFacilitationSubmission(vote, {
    accountId: 'participant-account', stepId, workshopRevision: 'b'.repeat(64),
    structured: { ballot: [{ alternativeId: 'two', rank: 1 }], ranking: 'two first' },
    existingSubmissions: [{ accountId: 'participant-account', stepId, structured: { ballot: [{ alternativeId: 'one', rank: 1 }], ranking: 'one first' } }],
  })).toThrow(/ballot/i);
});

test('requires exact current revision, bounded structured fields, and strict managed configuration', () => {
  expect(() => createFacilitation({ version: 2 } as any)).toThrow(/version/i);
  const facilitation = base('brainwriting');
  expect(() => validateFacilitationSubmission(facilitation, {
    accountId: 'participant-account', stepId: facilitation.currentStepId,
    workshopRevision: 'not-a-revision', structured: { ideas: Array.from({ length: 17 }, (_, index) => `idea-${index}`) },
  })).toThrow(/revision/i);
  expect(() => validateFacilitationSubmission(facilitation, {
    accountId: 'participant-account', stepId: facilitation.currentStepId,
    workshopRevision: 'b'.repeat(64), structured: { unknown: 'not allowed' },
  })).toThrow(/unknown/i);
  expect(() => createFacilitation({ ...facilitation, forgedAuthority: 'no' } as any)).toThrow(/unknown/i);
  expect(() => createFacilitation({ ...facilitation, outputs: [{ type: 'facilitation_receipt', status: 'accepted' }] } as any)).toThrow(/proposed|unverified/i);
  expect(() => validateFacilitationSubmission(facilitation, {
    accountId: 'participant-account', stepId: facilitation.currentStepId,
    workshopRevision: 'b'.repeat(64), structured: { questions: [{ unknownNested: 'no' }] },
  })).toThrow(/unknown/i);
  expect(() => validateFacilitationSubmission(facilitation, {
    accountId: 'participant-account', stepId: facilitation.currentStepId,
    workshopRevision: 'b'.repeat(64), structured: { questions: [[[[['too deep']]]]] },
  })).toThrow(/depth/i);
});

test('allows blameless guidance language without keyword censorship', () => {
  const facilitation = base('blameless-postmortem');
  expect(validateFacilitationSubmission(facilitation, {
    accountId: 'participant-account', stepId: facilitation.currentStepId, workshopRevision: 'b'.repeat(64),
    structured: { timeline: 'Avoid blame; record the observed event sequence instead.', impact: 'One bounded delivery was delayed.' },
  }).structured.timeline).toContain('Avoid blame');
});

test('rejects boolean placeholders for typed step fields', () => {
  const facilitation = base('checklist');
  expect(() => validateFacilitationSubmission(facilitation, {
    accountId: 'participant-account', stepId: facilitation.currentStepId, workshopRevision: 'b'.repeat(64), structured: { checks: true },
  })).toThrow(/typed checks/i);
});

test('checklist records require an actor-bound explicit state and unresolved checks do not complete a step', () => {
  const facilitation = base('checklist');
  const submit = (checks: unknown) => validateFacilitationSubmission(facilitation, {
    accountId: 'participant-account', stepId: facilitation.currentStepId, workshopRevision: 'b'.repeat(64), structured: { checks, evidence: 'Observed record.', reason: 'Explicit check.' },
  });
  expect(() => submit(1)).toThrow(/typed checks/);
  expect(() => submit([{ itemId: 'one', status: 'pass', actor: 'other-account', evidence: 'Observed.', reason: 'Verified.' }])).toThrow(/actor/);
  const structured = submit([{ itemId: 'one', status: 'unknown', actor: 'participant-account', evidence: 'Not checked.', reason: 'Awaiting evidence.' }]).structured;
  expect(nextFacilitationAction(facilitation, [{ accountId: 'participant-account', stepId: facilitation.currentStepId, structured }]).kind).toBe('wait');
  const repaired = submit([{ itemId: 'one', status: 'pass', actor: 'participant-account', evidence: 'Now checked.', reason: 'Verified.' }]).structured;
  expect(nextFacilitationAction(facilitation, [structured, repaired].map(value => ({ accountId: 'participant-account', stepId: facilitation.currentStepId, structured: value }))).kind).toBe('advance');
});

test('the final completed step requests an output instead of impossible advancement', () => {
  const facilitation = base('brainwriting');
  facilitation.currentStepId = facilitation.methods[0]!.steps.at(-1)!.id;
  expect(nextFacilitationAction(facilitation, facilitation.participants.map(accountId => ({ accountId, stepId: facilitation.currentStepId, structured: { synthesis: 'Reviewable proposal.' } }))).kind).toBe('record_output');
});

test('ballots reject duplicate alternatives and malformed ranks', () => {
  const facilitation = base('dot-voting');
  facilitation.currentStepId = facilitation.methods[0]!.steps[1]!.id;
  const submit = (ballot: unknown) => validateFacilitationSubmission(facilitation, { accountId: 'participant-account', stepId: facilitation.currentStepId, workshopRevision: 'b'.repeat(64), structured: { ballot, ranking: 'First choice.' } });
  expect(() => submit([{ alternativeId: 'one', rank: 1 }, { alternativeId: 'one', rank: 2 }])).toThrow(/ballot/);
  expect(() => submit([{ alternativeId: 'one', rank: -1 }])).toThrow(/rank/);
});

test('reports explicit wait or reduced variants rather than inventing participants or elapsed consensus', () => {
  const facilitation = base('1-2-4-all');
  const action = nextFacilitationAction(facilitation, [{ accountId: 'facilitator-account', stepId: facilitation.currentStepId, structured: { ideas: ['A'] } }]);
  expect(action.kind).toBe('wait');
  expect(action.resumeCondition).toMatch(/participant|reduced/i);
});
