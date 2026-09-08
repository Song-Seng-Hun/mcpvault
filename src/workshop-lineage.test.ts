import { expect, test } from 'vitest';
import {
  validateWorkshopLineage,
  workshopLineagePrerequisites,
  type WorkshopLineageSubmission,
} from './workshop-lineage.js';

const submission = (stepId: string, structured: Record<string, unknown>, accountId = 'one'): WorkshopLineageSubmission => ({ accountId, stepId, structured });

test('returns only the bounded prerequisite step IDs needed for the current method step', () => {
  expect(workshopLineagePrerequisites('1-2-4-all-four')).toEqual(['1-2-4-all-one', '1-2-4-all-two']);
  expect(workshopLineagePrerequisites('mind-map-crosslinks')).toEqual(['mind-map-branches']);
  expect(workshopLineagePrerequisites('dot-voting-vote')).toEqual(['dot-voting-freeze']);
});

test('blocks lineage validation when a required predecessor slice is bounded rather than treating it as absent', () => {
  expect(() => validateWorkshopLineage({
    stepId: 'mind-map-crosslinks', structured: { mapEdges: [{ fromId: 'root', toId: 'option', reason: 'Connects them.' }] },
    priorSubmissions: [submission('mind-map-branches', { mapNodes: [{ id: 'root', type: 'question', label: 'Question' }] })],
    prerequisiteCoverage: [{ stepId: 'mind-map-branches', complete: false }],
  })).toThrow(/bounded|mind-map-branches/i);
});

test('requires each named 1-2-4 pair participant to have an actual individual contribution', () => {
  const structured = { extensions: ['Combine both observations.'], participantAccounts: ['one', 'two'] };
  expect(() => validateWorkshopLineage({
    stepId: '1-2-4-all-two', structured, participants: ['one', 'two'],
    priorSubmissions: [submission('1-2-4-all-one', { ideaIds: [{ ideaId: 'idea-one', origin: 'Observed by one.' }] }, 'one')],
  })).toThrow(/individual|contribution|two/i);
  expect(validateWorkshopLineage({
    stepId: '1-2-4-all-two', structured, participants: ['one', 'two'],
    priorSubmissions: [
      submission('1-2-4-all-one', { ideaIds: [{ ideaId: 'idea-one', origin: 'Observed by one.' }] }, 'one'),
      submission('1-2-4-all-one', { ideaIds: [{ ideaId: 'idea-two', origin: 'Observed by two.' }] }, 'two'),
    ],
  }).requiredPrerequisiteStepIds).toEqual(['1-2-4-all-one']);
});

test('preserves every collected KJ member while allowing multi-membership and unassigned items', () => {
  const collected = submission('affinity-kj-collect', {
    ideaIds: [
      { ideaId: 'one', origin: 'First note.' }, { ideaId: 'two', origin: 'Second note.' }, { ideaId: 'three', origin: 'Third note.' },
    ],
  });
  const valid = {
    groups: [{ id: 'speed', members: ['one', 'two'] }, { id: 'risk', members: ['two'] }],
    unassignedIdeaIds: ['three'],
  };
  expect(validateWorkshopLineage({ stepId: 'affinity-kj-group', structured: valid, priorSubmissions: [collected] }).requiredPrerequisiteStepIds).toEqual(['affinity-kj-collect']);
  expect(() => validateWorkshopLineage({
    stepId: 'affinity-kj-group', structured: { groups: [{ id: 'speed', members: ['one'] }], unassignedIdeaIds: ['three'] }, priorSubmissions: [collected],
  })).toThrow(/collected|preserve|two/i);
  expect(() => validateWorkshopLineage({
    stepId: 'affinity-kj-group', structured: { groups: [{ id: 'speed', members: ['one', 'two'] }], unassignedIdeaIds: ['two', 'three'] }, priorSubmissions: [collected],
  })).toThrow(/unassigned|grouped|two/i);
});

test('requires KJ names to retain the exact previously collected group membership', () => {
  const grouped = submission('affinity-kj-group', {
    groups: [{ id: 'speed', members: ['one', 'two'] }], unassignedIdeaIds: ['three'],
  });
  expect(() => validateWorkshopLineage({
    stepId: 'affinity-kj-name', structured: { names: [{ id: 'speed', name: 'Speed', members: ['one'] }], uncertainty: ['Overlap remains.'] }, priorSubmissions: [grouped],
  })).toThrow(/members|group/i);
});

test('requires map edges to reference actual prior nodes and parent ideas to reference existing origins', () => {
  expect(() => validateWorkshopLineage({
    stepId: 'mind-map-crosslinks', structured: { mapEdges: [{ fromId: 'root', toId: 'missing', reason: 'Claims to answer it.' }] },
    priorSubmissions: [submission('mind-map-branches', { mapNodes: [{ id: 'root', type: 'question', label: 'Question' }] })],
  })).toThrow(/node|missing/i);
  expect(() => validateWorkshopLineage({
    stepId: 'scamper-substitute', structured: { ideaIds: [{ ideaId: 'new-idea', origin: 'Changed.', parentIdeaId: 'invented', extension: 'Change it.' }], parentIdeaIds: ['invented'] },
    priorSubmissions: [],
  })).toThrow(/parent|origin|invented/i);
});

test('rejects conflicting frozen alternatives instead of silently unioning them for a ballot', () => {
  const vote = { ballot: [{ alternativeId: 'one', rank: 1 }], ranking: 'Prefer one.' };
  const freezeOne = submission('dot-voting-freeze', { alternatives: [{ id: 'one', label: 'One.' }], criteria: ['Value.'] });
  const freezeTwo = submission('dot-voting-freeze', { alternatives: [{ id: 'two', label: 'Two.' }], criteria: ['Value.'] }, 'two');
  expect(() => validateWorkshopLineage({ stepId: 'dot-voting-vote', structured: vote, priorSubmissions: [freezeOne, freezeTwo] })).toThrow(/frozen|conflict|different/i);
});
