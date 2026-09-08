import { expect, test } from 'vitest';
import {
  FACILITATION_METHODS,
  advanceFacilitation,
  createFacilitation,
  nextFacilitationAction,
  validateFacilitationCompletion,
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

test('reads the original version-one 1-2-4-All catalogue without accepting altered steps', () => {
  const persisted = structuredClone(base('1-2-4-all'));
  const all = persisted.methods[0]!.steps.find(step => step.id === '1-2-4-all-all')!;
  all.required = ['synthesis, minority, uncertainty'];
  all.requiredFields = ['uncertainty', 'synthesis'];
  expect(createFacilitation(persisted).methods[0]!.steps).toEqual(base('1-2-4-all').methods[0]!.steps);
  all.finishCondition = 'Approve without real participants';
  expect(() => createFacilitation(persisted)).toThrow(/catalogue/);
});

test('6-3-5 cycles are independent of ordinary redo and require six real contributions in every cycle', () => {
  let state = {...base('brainwriting'), participants: ['a','b','c','d','e','f'], facilitatorAccountId:'a'};
  const history:any[]=[];
  for(let cycle=1;cycle<=6;cycle++) {
    const rows=state.participants.map((accountId,index)=>({accountId,stepId:state.currentStepId,structured:{
      variant:'6-3-5',cycle,cycleMinutes:5,
      ideaIds:Array.from({length:3},(_,i)=>({ideaId:`${accountId}-${cycle}-${i}`,origin:'Proposal',...(cycle>1?{parentIdeaId:`${state.participants[(index+1)%6]}-${cycle-1}-${i}`,extension:'Adapt peer idea'}:{})})),
      ...(cycle>1?{extension:'Adapt peer ideas',parentIdeaIds:Array.from({length:3},(_,i)=>`${state.participants[(index+1)%6]}-${cycle-1}-${i}`)}:{})
    }}));
    expect(nextFacilitationAction(state,[...history,...rows.slice(0,5)]).kind).not.toBe('record_output');
    expect(validateFacilitationCompletion(state,[...history,...rows.slice(0,5)]).complete).toBe(false);
    for(const row of rows)validateFacilitationSubmission(state,{...row,workshopRevision:'a'.repeat(64),existingSubmissions:history});
    expect(()=>validateFacilitationSubmission(state,{...rows[0]!,workshopRevision:'a'.repeat(64),existingSubmissions:[...history,rows[0]!]})).toThrow(/one.*submission/i);
    history.push(...rows);
    expect(nextFacilitationAction(state,history).kind).toBe(cycle===6?'record_output':'advance');
    if(cycle<6)state=advanceFacilitation(state,'Explicit next five-minute method cycle',history);
    expect(state.round).toBe(1);expect(state.ordinaryRedoCount).toBe(0);
  }
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
    })).toThrow(/required|contract|string/i);
  },
);

test('deduplicates one account ballot across roles and sessions', () => {
  const facilitation = base('dot-voting');
  const vote = { ...facilitation, currentStepId: facilitation.methods[0]!.steps[1]!.id };
  const stepId = vote.currentStepId;
  const first = validateFacilitationSubmission(vote, {
    accountId: 'participant-account', stepId, workshopRevision: 'b'.repeat(64),
    structured: { ballot: [{ alternativeId: 'one', rank: 1 }], ranking: 'one first' },
    existingSubmissions: [{ accountId: 'facilitator-account', stepId: 'dot-voting-freeze', structured: { alternatives: [{ id: 'one', label: 'One.' }], criteria: ['Value.'] } }],
  });
  expect(first.ballotAccountId).toBe('participant-account');
  expect(() => validateFacilitationSubmission(vote, {
    accountId: 'participant-account', stepId, workshopRevision: 'b'.repeat(64),
    structured: { ballot: [{ alternativeId: 'two', rank: 1 }], ranking: 'two first' },
    existingSubmissions: [
      { accountId: 'facilitator-account', stepId: 'dot-voting-freeze', structured: { alternatives: [{ id: 'one', label: 'One.' }], criteria: ['Value.'] } },
      { accountId: 'participant-account', stepId, structured: { ballot: [{ alternativeId: 'one', rank: 1 }], ranking: 'one first' } },
    ],
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
    structured: { timeline: [{ id: 'event-1', value: 'Avoid blame; record the observed event sequence instead.' }], impact: 'One bounded delivery was delayed.' },
  }).structured.timeline).toEqual(expect.arrayContaining([expect.objectContaining({ value: expect.stringContaining('Avoid blame') })]));
});

test('rejects boolean placeholders for typed step fields', () => {
  const facilitation = base('checklist');
  expect(() => validateFacilitationSubmission(facilitation, {
    accountId: 'participant-account', stepId: facilitation.currentStepId, workshopRevision: 'b'.repeat(64), structured: { checks: true },
  })).toThrow(/checks|array/i);
});

test('checklist records require an actor-bound explicit state and unresolved checks do not complete a step', () => {
  const facilitation = base('checklist');
  const submit = (checks: unknown) => validateFacilitationSubmission(facilitation, {
    accountId: 'participant-account', stepId: facilitation.currentStepId, workshopRevision: 'b'.repeat(64), structured: { checks, evidence: 'Observed record.', reason: 'Explicit check.' },
  });
  expect(() => submit(1)).toThrow(/typed checks|bounded array/i);
  expect(() => submit([{ itemId: 'one', status: 'pass', actor: 'other-account', evidence: 'Observed.', reason: 'Verified.' }])).toThrow(/actor/);
  const structured = submit([{ itemId: 'one', status: 'unknown', actor: 'participant-account', evidence: 'Not checked.', reason: 'Awaiting evidence.' }]).structured;
  expect(nextFacilitationAction(facilitation, [{ accountId: 'participant-account', stepId: facilitation.currentStepId, structured }]).kind).toBe('wait');
  const repaired = submit([{ itemId: 'one', status: 'pass', actor: 'participant-account', evidence: 'Now checked.', reason: 'Verified.' }]).structured;
  expect(nextFacilitationAction(facilitation, [structured, repaired].map(value => ({ accountId: 'participant-account', stepId: facilitation.currentStepId, structured: value }))).kind).toBe('advance');
});

test('the final completed step requests an output instead of impossible advancement', () => {
  const facilitation = base('brainwriting');
  facilitation.currentStepId = facilitation.methods[0]!.steps.at(-1)!.id;
  expect(nextFacilitationAction(facilitation, facilitation.participants.map(accountId => ({ accountId, stepId: facilitation.currentStepId, structured: { ideaIds: [{ ideaId: `${accountId}-idea`, origin: 'Independent.', parentIdeaId: 'prior-idea', extension: 'Build on it.' }], extension: 'Build on it.', parentIdeaIds: ['prior-idea'] } }))).kind).toBe('record_output');
});

test('ballots reject duplicate alternatives and malformed ranks', () => {
  const facilitation = base('dot-voting');
  facilitation.currentStepId = facilitation.methods[0]!.steps[1]!.id;
  const submit = (ballot: unknown) => validateFacilitationSubmission(facilitation, { accountId: 'participant-account', stepId: facilitation.currentStepId, workshopRevision: 'b'.repeat(64), structured: { ballot, ranking: 'First choice.' }, existingSubmissions: [{ accountId: 'facilitator-account', stepId: 'dot-voting-freeze', structured: { alternatives: [{ id: 'one', label: 'One.' }], criteria: ['Value.'] } }] });
  expect(() => submit([{ alternativeId: 'one', rank: 1 }, { alternativeId: 'one', rank: 2 }])).toThrow(/ballot/);
  expect(() => submit([{ alternativeId: 'one', rank: -1 }])).toThrow(/rank/);
});

test('reports explicit wait or reduced variants rather than inventing participants or elapsed consensus', () => {
  const facilitation = base('1-2-4-all');
  const action = nextFacilitationAction(facilitation, [{ accountId: 'facilitator-account', stepId: facilitation.currentStepId, structured: { ideas: ['A'] } }]);
  expect(action.kind).toBe('wait');
  expect(action.resumeCondition).toMatch(/participant|reduced/i);
});

const revision = 'a'.repeat(64);
const stepFacilitation = (methodId: string, stepId: string, participants = ['facilitator-account', 'participant-account', 'third-account', 'fourth-account']) => {
  const facilitation = base(methodId);
  facilitation.participants = participants;
  facilitation.currentStepId = stepId;
  return facilitation;
};

const structuredFor = (stepId: string): Record<string, unknown> => {
  const idea = (id: string, extra: Record<string, unknown> = {}) => ({ ideaId: id, origin: 'Independent bounded text.', ...extra });
  switch (stepId) {
    case 'page-led-frame': return { purpose: 'Choose.', scope: 'Bounded.', outcome: 'Proposal.', questions: ['How?'], sourceRevisions: [{ path: 'Evidence.md', revision }] };
    case 'page-led-read': return { acknowledgement: { path: 'Evidence.md', revision, accountId: 'participant-account' } };
    case 'page-led-discuss': return { observations: ['Observed.'], extension: 'Build on idea.', challenge: 'Retain caveat.' };
    case 'checklist-prepare': case 'checklist-progress': case 'checklist-close': return { checks: [{ itemId: 'check-1', status: 'pass', actor: 'participant-account', evidence: 'Observed.', reason: 'Verified.' }] };
    case 'how-might-we-observe': return { observations: ['Users abandon a long form.'], evidence: ['Support notes.'] };
    case 'how-might-we-question': return { questions: ['How might we shorten the form?'] };
    case 'how-might-we-refine': return { questions: ['How might we shorten the form without hiding errors?'], challenge: 'Keep error visibility.' };
    case 'brainwriting-independent': return { variant: 'async', ideaIds: [idea('idea-1')] };
    case 'ngt-independent': case 'affinity-kj-collect': case '1-2-4-all-one': return { ideaIds: [idea('idea-1')] };
    case 'brainwriting-build': return { ideaIds: [idea('idea-2', { parentIdeaId: 'idea-1', extension: 'Extend it.' })], extension: 'Extend it.', parentIdeaIds: ['idea-1'] };
    case 'six-hats-setup': return { questions: ['What improves this?'], constraints: ['Keep scope bounded.'] };
    case 'six-hats-information': return { evidence: ['Observed source.'], uncertainty: ['Unknown demand.'] };
    case 'six-hats-alternatives': return { ideaIds: [idea('idea-1')] };
    case 'six-hats-benefits': return { benefits: [{ alternativeId: 'idea-1', value: 'Faster.' }] };
    case 'six-hats-risks': return { risks: [{ alternativeId: 'idea-1', value: 'May confuse.' }], challenge: 'Check comprehension.' };
    case 'six-hats-intuition': return { preferences: ['Tentatively prefer one.'], uncertainty: ['Need evidence.'] };
    case 'six-hats-synthesis': return { adopted: ['idea-1'], rejected: ['idea-2'], minority: ['Keep alternate.'], uncertainty: ['Need pilot.'], revisit: 'After pilot.' };
    case 'scamper-substitute': case 'scamper-combine': case 'scamper-adapt': case 'scamper-modify': case 'scamper-other-use': case 'scamper-eliminate': case 'scamper-reverse': return { operator: stepId.replace('scamper-', ''), ideaIds: [idea('idea-2', { parentIdeaId: 'idea-1', extension: 'Changed.' })], parentIdeaIds: ['idea-1'] };
    case 'crazy8s-eight': return { ideaIds: Array.from({ length: 8 }, (_, index) => idea(`idea-${index + 1}`)) };
    case 'crazy8s-select': return { ranking: [{ alternativeId: 'idea-1', rank: 1 }], criteria: ['Ease.'], reason: 'Lowest risk.' };
    case '1-2-4-all-two': return { extensions: ['Pair extension.'], participantAccounts: ['facilitator-account', 'participant-account'] };
    case '1-2-4-all-four': return { synthesis: 'Group result.', participantAccounts: ['facilitator-account', 'participant-account', 'third-account', 'fourth-account'] };
    case '1-2-4-all-all': return { synthesis: 'All groups.', minority: ['Alternate.'], uncertainty: ['Pilot.'], participantAccounts: ['facilitator-account', 'participant-account'] };
    case 'affinity-kj-group': return { groups: [{ id: 'group-1', members: ['idea-1', 'idea-2'] }], unassignedIdeaIds: ['idea-3'] };
    case 'affinity-kj-name': return { names: [{ id: 'group-1', name: 'Speed', members: ['idea-1','idea-2'] }], uncertainty: ['Overlap remains.'] };
    case 'mind-map-root': return { questions: ['What should improve?'] };
    case 'mind-map-branches': return { mapNodes: [{ id: 'root', type: 'question', label: 'What?' }, { id: 'option-1', type: 'alternative', label: 'Try.' }] };
    case 'mind-map-crosslinks': return { mapEdges: [{ fromId: 'root', toId: 'option-1', reason: 'Answers.' }] };
    case 'ngt-roundrobin': return { ideaIds: [idea('idea-1')], account: 'participant-account' };
    case 'ngt-clarify': return { questions: ['What cost?'], clarifications: ['No estimate yet.'] };
    case 'ngt-rank': return { ballot: [{ alternativeId: 'idea-1', rank: 1 }], ranking: 'First.', reason: 'Best fit.' };
    case 'dot-voting-freeze': return { alternatives: [{ id: 'idea-1', label: 'Try.' }], criteria: ['Value.'] };
    case 'dot-voting-vote': return { ballot: [{ alternativeId: 'idea-1', rank: 1 }], ranking: 'One first.' };
    case 'daci-roles': return { roles: { driver: 'facilitator-account', approver: 'participant-account', contributors: ['third-account'], informed: ['fourth-account'] } };
    case 'daci-alternatives': return { alternatives: [{ id: 'idea-1', label: 'Try.' }], evidence: ['Observed.'] };
    case 'daci-reason': return { reason: 'Approver selects.', uncertainty: ['Pilot needed.'], minority: ['Keep alternate.'] };
    case 'daci-review': return { reviewConditions: ['Review after pilot.'], revisit: 'After two weeks.' };
    case 'premortem-failure': return { failureScenario: 'Adoption fails.' };
    case 'premortem-causes': return { causes: ['Onboarding unclear.'], evidence: ['Prior feedback.'] };
    case 'premortem-prioritize': return { ranking: [{ riskId: 'risk-1', rank: 1 }], risks: [{ riskId: 'risk-1', value: 'Adoption.' }], reason: 'High impact.' };
    case 'premortem-mitigate': return { mitigation: 'Pilot.', earlySignal: 'Drop-off rises.', ownerAction: { accountId: 'participant-account', value: 'Review weekly.' } };
    case 'retrospective-observe': return { retrospectiveVariant: 'start-stop-continue', observations: [{ category: 'start', value: 'Pair review.' }, { category: 'stop', value: 'Long handoffs.' }, { category: 'continue', value: 'Daily notes.' }] };
    case 'retrospective-experiment': return { experiment: 'Try a short handoff.', ownerAction: { accountId: 'participant-account', value: 'Run next week.' }, reviewConditions: ['Review after one week.'] };
    case 'blameless-postmortem-timeline': return { timeline: [{ id: 'event-1', value: 'Alert fired.' }], impact: 'One delivery delayed.' };
    case 'blameless-postmortem-factors': return { contributingFactors: ['Alert routing delayed.'], helpfulResponse: ['On-call mitigated.'] };
    case 'blameless-postmortem-prevention': return { prevention: 'Add routing check.', ownerAction: { accountId: 'participant-account', value: 'Add check.' }, reviewConditions: ['Review next incident.'] };
    default: throw new Error(`Missing valid structured fixture for ${stepId}`);
  }
};

const lineageFor = (stepId: string) => {
  const independent = (accountId: string, ideaId = `idea-${accountId}`) => ({ accountId, stepId: '1-2-4-all-one', structured: { ideaIds: [{ ideaId, origin: `Observed by ${accountId}.` }] } });
  if (stepId === 'brainwriting-build' || stepId.startsWith('scamper-')) return [{ accountId: 'facilitator-account', stepId: 'brainwriting-independent', structured: { ideaIds: [{ ideaId: 'idea-1', origin: 'Existing origin.' }] } }];
  if (stepId === '1-2-4-all-two') return [independent('facilitator-account'), independent('participant-account')];
  if (stepId === '1-2-4-all-four') return [
    independent('facilitator-account'), independent('participant-account'), independent('third-account'), independent('fourth-account'),
    { accountId: 'facilitator-account', stepId: '1-2-4-all-two', structured: { participantAccounts: ['facilitator-account', 'participant-account'] } },
    { accountId: 'third-account', stepId: '1-2-4-all-two', structured: { participantAccounts: ['third-account', 'fourth-account'] } },
  ];
  if (stepId === '1-2-4-all-all') return [{ accountId: 'facilitator-account', stepId: '1-2-4-all-four', structured: { participantAccounts: ['facilitator-account', 'participant-account'] } }];
  if (stepId === 'affinity-kj-group') return [{ accountId: 'facilitator-account', stepId: 'affinity-kj-collect', structured: {ideaIds:['idea-1','idea-2','idea-3'].map(ideaId=>({ideaId,origin:'Collected evidence'}))} }];
  if (stepId === 'affinity-kj-name') return [{ accountId: 'facilitator-account', stepId: 'affinity-kj-group', structured: structuredFor('affinity-kj-group') }];
  if (stepId === 'mind-map-crosslinks') return [{ accountId: 'facilitator-account', stepId: 'mind-map-branches', structured: structuredFor('mind-map-branches') }];
  if (stepId === 'dot-voting-vote') return [{ accountId: 'facilitator-account', stepId: 'dot-voting-freeze', structured: structuredFor('dot-voting-freeze') }];
  return [];
};

test.each(FACILITATION_METHODS.map(method => [method.methodId, method.steps.map(step => step.id)] as const))(
  '%s accepts a typed, bounded normal payload at every declared step',
  (methodId, stepIds) => {
    for (const stepId of stepIds) {
      const facilitation = stepFacilitation(methodId, stepId);
      const existingSubmissions = lineageFor(stepId);
      const structured = validateFacilitationSubmission(facilitation, { accountId: 'participant-account', stepId, workshopRevision: revision, structured: structuredFor(stepId), existingSubmissions }).structured;
      expect(structured).toEqual(structuredFor(stepId));
      const accounts = facilitation.participants.slice(0, facilitation.methods[0]!.steps.find(step => step.id === stepId)?.minimumAccounts || 1);
      const submissions = [...existingSubmissions, ...accounts.map(accountId => ({ accountId, stepId, structured }))];
      expect(nextFacilitationAction(facilitation, submissions).kind).toBe(stepId === stepIds.at(-1) ? 'record_output' : 'advance');
    }
  },
);

test.each(FACILITATION_METHODS.map(method => [method.methodId, method.steps.map(step => step.id)] as const))(
  '%s rejects an unmet or incorrectly typed contract at every declared step',
  (methodId, stepIds) => {
    for (const stepId of stepIds) {
      const facilitation = stepFacilitation(methodId, stepId);
      expect(() => validateFacilitationSubmission(facilitation, { accountId: 'participant-account', stepId, workshopRevision: revision, structured: {} })).toThrow(/missing|required|contract|bounded submission/i);
      expect(nextFacilitationAction(facilitation, []).kind).toBe('submit');
      const malformed = structuredFor(stepId);
      const key = Object.keys(malformed)[0]!;
      malformed[key] = 1;
      expect(() => validateFacilitationSubmission(facilitation, { accountId: 'participant-account', stepId, workshopRevision: revision, structured: malformed })).toThrow(/string|array|object|typed|contract|frozen/i);
    }
  },
);

test('completion helper keeps incomplete 1-2-4-All and frozen dot-voting contracts from advancing', () => {
  const pairs = stepFacilitation('1-2-4-all', '1-2-4-all-two');
  const pair = validateFacilitationSubmission(pairs, { accountId: 'participant-account', stepId: pairs.currentStepId, workshopRevision: revision,
    structured: { extensions: ['Pair extension.'], participantAccounts: ['participant-account'], reducedVariant: 'single-account async adaptation' },
    existingSubmissions: [{ accountId: 'participant-account', stepId: '1-2-4-all-one', structured: { ideaIds: [{ ideaId: 'idea-1', origin: 'Observed.' }] } }],
  }).structured;
  expect(validateFacilitationCompletion(pairs, [{ accountId: 'participant-account', stepId: pairs.currentStepId, structured: pair }]).complete).toBe(true);

  const vote = stepFacilitation('dot-voting', 'dot-voting-vote');
  const ballot = structuredFor('dot-voting-vote');
  expect(() => validateFacilitationSubmission(vote, { accountId: 'participant-account', stepId: vote.currentStepId, workshopRevision: revision, structured: ballot })).toThrow(/frozen/i);
  const frozen = { accountId: 'facilitator-account', stepId: 'dot-voting-freeze', structured: structuredFor('dot-voting-freeze') };
  expect(validateFacilitationSubmission(vote, { accountId: 'participant-account', stepId: vote.currentStepId, workshopRevision: revision, structured: ballot, existingSubmissions: [frozen] }).ballotAccountId).toBe('participant-account');
});

test('6-3-5 records six actual accounts, three ideas each, and a five-minute method cycle while async remains explicit', () => {
  const accounts = ['one', 'two', 'three', 'four', 'five', 'six'];
  const facilitation = stepFacilitation('brainwriting', 'brainwriting-independent', accounts);
  const submit = (accountId: string, cycleMinutes: number, variant: '6-3-5' | 'async' = '6-3-5') => validateFacilitationSubmission(facilitation, {
    accountId, stepId: facilitation.currentStepId, workshopRevision: revision,
    structured: {
      variant, cycle: 1, ...(variant === '6-3-5' ? { cycleMinutes } : {}),
      ideaIds: Array.from({ length: variant === '6-3-5' ? 3 : 1 }, (_, index) => ({ ideaId: `${accountId}-${index}`, origin: 'Independent idea.' })),
    },
  }).structured;
  expect(() => submit('one', 4)).toThrow(/five|minute|cycle/i);
  facilitation.brainwritingCycle = 2;
  expect(() => submit('one', 5)).toThrow(/round|cycle/i);
  facilitation.brainwritingCycle = 1;
  const contributions = accounts.map(accountId => ({ accountId, stepId: facilitation.currentStepId, structured: submit(accountId, 5) }));
  expect(validateFacilitationCompletion(facilitation, contributions).complete).toBe(true);
  expect(submit('one', 5, 'async').variant).toBe('async');
});
