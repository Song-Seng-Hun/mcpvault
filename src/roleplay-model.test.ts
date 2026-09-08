import { describe, expect, it } from 'vitest';
import { applyRoleplayCommand, initialRoleplay, roleplayHash, roleplayRevision, type RoleplayCommand, type RoleplayState } from './roleplay-model.js';

const policy = { administrators: ['host'], maxCharacters: 100 };
function run(state: RoleplayState, op: string, data: Record<string, unknown>, actor = 'host') {
  return applyRoleplayCommand(state, { op, data, actor, requestId: `request-${state.sequence}`, expectedRevision: roleplayRevision(state) } as RoleplayCommand, policy);
}
function world() {
  let s = run(initialRoleplay(), 'initialize', { title: 'The Lantern Archive', places: { hall: ['garden'], garden: ['hall'] } }).state;
  s = run(s, 'character', { id: 'iris', name: 'Iris', controller: 'alice', location: 'hall' }).state;
  s = run(s, 'scene', { roomId: 'hall-chat', location: 'hall', title: 'An unopened gate', gm: 'host' }).state;
  s = run(s, 'scene', { roomId: 'garden-chat', location: 'garden', title: 'The garden', gm: 'host' }).state;
  return s;
}
describe('shared roleplay transitions', () => {
  it('updates a compact core memory without resending the definition and retires reviewed beliefs without deleting events', () => {
    const spoken = run(world(), 'speak', { characterId: 'iris', generation: 1, roomId: 'hall-chat', content: 'We found the archive.' }, 'alice');
    const remembered = run(spoken.state, 'remember', { characterId: 'iris', generation: 1, turn: spoken.receipt.id, kind: 'witnessed', note: 'An archive was found.' }, 'alice').state;
    const updated = run(remembered, 'definition', { characterId: 'iris', generation: 1, coreMemory: 'Visit the archive carefully.', retireBeliefs: [spoken.receipt.id], reason: 'Condensed into reviewed core memory.' }, 'alice').state;
    expect(updated.characters.iris.definition).toBe(remembered.characters.iris.definition);
    expect(updated.characters.iris.coreMemory).toBe('Visit the archive carefully.');
    expect(updated.characters.iris.cognition).toEqual([]);
    expect(Object.values(updated.requests).some(r => r.receipt.id === spoken.receipt.id)).toBe(true);
    expect(() => run(remembered, 'definition', { characterId: 'iris', generation: 1, retireBeliefs: [spoken.receipt.id], reason: 'Without summary' }, 'alice')).toThrow(/core memory/);
    expect(() => run(remembered, 'definition', { characterId: 'iris', generation: 1, coreMemory: 'Reviewed', retireBeliefs: ['turn-999'], reason: 'Unknown event' }, 'alice')).toThrow(/not in/);
    expect(() => run(remembered, 'definition', { characterId: 'iris', generation: 0, coreMemory: 'Forged' }, 'alice')).toThrow(/generation/);
  });
  it('blocks correcting a premise consumed by another character rule even when effects do not overlap', () => {
    let s = world();
    s = run(s, 'character', { id: 'bob', name: 'Bob', controller: 'bob', location: 'hall' }).state;
    const attempt = run(s, 'attempt', { characterId: 'iris', generation: 1, roomId: 'hall-chat', content: 'Open the gate.' }, 'alice');
    const opened = run(attempt.state, 'resolve', { pendingId: attempt.receipt.id, content: 'Gate opens.', reason: 'Unlocked', effects: [{ op: 'flag', characterId: 'iris', key: 'gate-open', value: true }] });
    s = run(opened.state, 'rule', { id: 'cross', conditions: [{ op: 'equals', characterId: 'iris', key: 'gate-open', value: true }], effects: [{ op: 'flag', characterId: '$actor', key: 'crossed', value: true }] }).state;
    s = run(s, 'use', { characterId: 'bob', generation: 1, roomId: 'hall-chat', ruleId: 'cross', content: 'Cross through the open gate.' }, 'bob').state;
    const data = { targetTurn: opened.receipt.id, effects: [{ op: 'flag', characterId: 'iris', key: 'gate-open', value: false }], content: 'Gate never opened.', reason: 'Mistaken adjudication' };
    expect(() => run(s, 'correct', { ...data, previewFingerprint: roleplayHash({ revision: roleplayRevision(s), ...data }) })).toThrow(/Downstream/);
  });
  it('keeps shared world settings editable only by the host without resetting character progress', () => {
    const before = world();
    expect(() => run(before, 'settings', { definition: 'A clockwork archive', lore: ['Lore/Archive.md'] }, 'alice')).toThrow(/administrator/);
    const next = run(before, 'settings', { definition: 'A clockwork archive', lore: ['Lore/Archive.md'], places: { hall: [], garden: [] } }).state;
    expect(next.definition).toBe('A clockwork archive'); expect(next.characters).toEqual(before.characters);
    expect(() => run(next, 'settings', { places: { garden: [] } })).toThrow(/location|place/);
  });
  it('rejects incomplete conditions rather than treating undefined equals undefined as success', () => {
    expect(() => run(world(), 'rule', { id: 'bad', conditions: [{ op: 'equals' }], effects: [] })).toThrow(/condition/);
    expect(() => run(world(), 'rule', { id: 'bad', conditions: [{ op: 'range', key: 'strength', min: 10, max: 1 }], effects: [] })).toThrow(/condition/);
  });
  it('hashes equivalent declarations independently of object key order', () => {
    expect(roleplayHash({ a: 1, b: { x: 2, y: 3 } })).toBe(roleplayHash({ b: { y: 3, x: 2 }, a: 1 }));
  });
  it('permits exact existing account IDs and rejects malformed inventory owners', () => {
    let s = world();
    s = run(s, 'handoff', { characterId: 'iris', generation: 1, toAccountId: 'peer.worker_1', reason: 'Next shift' }, 'alice').state;
    expect(() => run(s, 'speak', { characterId: 'iris', generation: 2, roomId: 'hall-chat', content: 'Ready' }, 'peer.worker_1')).not.toThrow();
    expect(() => run(s, 'item', { id: 'coin', owner: 'place:hall:forged', quantity: 1 })).toThrow();
  });
  it('allows the current controller to cancel a stale pending attempt without granting effects', () => {
    let s = world(); const attempt = run(s, 'attempt', { characterId: 'iris', generation: 1, roomId: 'hall-chat', content: 'Open the gate' }, 'alice'); s = attempt.state;
    s = run(s, 'move', { characterId: 'iris', generation: 1, roomId: 'hall-chat', content: 'Walk away', to: 'garden' }, 'alice').state;
    const result = run(s, 'cancel', { characterId: 'iris', generation: 1, pendingId: attempt.receipt.id, content: 'Withdraw my old attempt.' }, 'alice');
    expect(result.state.pending).toEqual({}); expect(result.receipt.effects).toEqual([]);
  });
  it('only host policy administrators may initialize one world', () => {
    expect(() => run(initialRoleplay(), 'initialize', { title: 'Fake', places: { hall: [] } }, 'alice')).toThrow(/administrator/);
    expect(() => run(world(), 'initialize', { title: 'Other', places: { hall: [] } })).toThrow(/already/);
  });
  it('speech changes no possessions or location and preserves real account attribution', () => {
    const s = world();
    const result = run(s, 'speak', { characterId: 'iris', generation: 1, roomId: 'hall-chat', content: 'I now have ten thousand coins.' }, 'alice');
    expect(result.state.characters.iris).toEqual(s.characters.iris);
    expect(result.receipt.actor).toBe('alice');
    expect(result.receipt.characterId).toBe('iris');
  });
  it('enforces 280 Unicode characters without splitting', () => {
    expect(() => run(world(), 'speak', { characterId: 'iris', generation: 1, roomId: 'hall-chat', content: '🌙'.repeat(280) }, 'alice')).not.toThrow();
    expect(() => run(world(), 'speak', { characterId: 'iris', generation: 1, roomId: 'hall-chat', content: '가'.repeat(281) }, 'alice')).toThrow(/280/);
  });
  it('shares positions across rooms and rejects actions from an old location', () => {
    const moved = run(world(), 'move', { characterId: 'iris', generation: 1, roomId: 'hall-chat', to: 'garden', content: 'I walk to the garden.' }, 'alice').state;
    expect(moved.characters.iris.location).toBe('garden');
    expect(() => run(moved, 'speak', { characterId: 'iris', generation: 1, roomId: 'hall-chat', content: 'Still here' }, 'alice')).toThrow(/location/);
    expect(() => run(moved, 'speak', { characterId: 'iris', generation: 1, roomId: 'garden-chat', content: 'Arrived' }, 'alice')).not.toThrow();
  });
  it('hands control to an exact account and fences former generations', () => {
    const s = run(world(), 'handoff', { characterId: 'iris', generation: 1, toAccountId: 'bob', reason: 'Next shift' }, 'alice').state;
    expect(s.characters.iris.generation).toBe(2);
    expect(() => run(s, 'speak', { characterId: 'iris', generation: 1, roomId: 'hall-chat', content: 'Late reply' }, 'alice')).toThrow(/control/);
  });
  it('creative attempts remain pending until a delegated GM resolves them', () => {
    const attempt = run(world(), 'attempt', { characterId: 'iris', generation: 1, roomId: 'hall-chat', content: 'May I open the gate?' }, 'alice');
    expect(Object.values(attempt.state.pending)).toHaveLength(1);
    const data = { pendingId: attempt.receipt.id, content: 'The latch opens.', reason: 'The latch was unfastened.', effects: [{ op: 'flag', characterId: 'iris', key: 'gate-open', value: true }] };
    expect(() => run(attempt.state, 'resolve', data, 'alice')).toThrow(/GM/);
    const resolved = run(attempt.state, 'resolve', data).state;
    expect(resolved.characters.iris.flags['gate-open']).toBe(true);
    expect(Object.values(resolved.pending)).toHaveLength(0);
  });
  it('never executes expressions or arbitrary effects', () => {
    expect(() => run(world(), 'rule', { id: 'evil', conditions: [], effects: [{ op: 'eval', code: 'process.exit()' }] })).toThrow(/effect/);
    expect(() => run(world(), 'character', { id: '__proto__', name: 'bad', controller: 'alice', location: 'hall' })).toThrow(/id/);
  });
  it('uses stable idempotency receipts but rejects key reuse with changed content', () => {
    const s = world();
    const cmd: RoleplayCommand = { op: 'speak', actor: 'alice', requestId: 'same', expectedRevision: roleplayRevision(s), data: { characterId: 'iris', generation: 1, roomId: 'hall-chat', content: 'Hello' } };
    const first = applyRoleplayCommand(s, cmd, policy);
    expect(applyRoleplayCommand(first.state, cmd, policy).receipt).toEqual(first.receipt);
    expect(() => applyRoleplayCommand(first.state, { ...cmd, data: { ...cmd.data, content: 'Changed' } }, policy)).toThrow(/requestId/);
  });
  it('rejects stale world revisions without mutating the input', () => {
    const s = world(); const before = structuredClone(s);
    expect(() => applyRoleplayCommand(s, { op: 'move', actor: 'alice', requestId: 'old', expectedRevision: 'old', data: {} }, policy)).toThrow(/revision/);
    expect(s).toEqual(before);
  });
  it('corrects a move with no downstream shared results using a preview fingerprint', () => {
    const moved = run(world(), 'move', { characterId: 'iris', generation: 1, roomId: 'hall-chat', to: 'garden', content: 'Enter garden' }, 'alice');
    const data = { targetTurn: moved.receipt.id, effects: [{ op: 'move', characterId: 'iris', to: 'hall' }], content: 'Return after correction', reason: 'Wrong destination was recorded' };
    const previewFingerprint = roleplayHash({ revision: roleplayRevision(moved.state), ...data });
    const corrected = run(moved.state, 'correct', { ...data, previewFingerprint });
    expect(corrected.state.characters.iris!.location).toBe('hall');
    expect(corrected.receipt.correctedTurn).toBe(moved.receipt.id);
  });
});
