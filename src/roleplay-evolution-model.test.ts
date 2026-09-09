import { describe, expect, it } from 'vitest';
import { applyRoleplayCommand, initialRoleplay, roleplayRevision, roleplayHash, type RoleplayState } from './roleplay-model.js';
import { evolutionPreview, activeEvolution } from './roleplay-evolution-model.js';
import { currentLore } from './roleplay-evolution-projections.js';

const policy = { administrators: ['host'] };
function run(s: RoleplayState, op: string, data: Record<string, any>, actor = 'host') {
  return applyRoleplayCommand(s, { op, data, actor, requestId: `req-${s.sequence}`, expectedRevision: roleplayRevision(s) }, policy);
}
function setup() {
  let s = run(initialRoleplay(), 'initialize', { title: 'Archive', places: { hall: [] } }).state;
  s = run(s, 'character', { id: 'iris', name: 'Iris', controller: 'alice', location: 'hall', definition: 'Initially trusting.' }).state;
  s = run(s, 'character', { id: 'moss', name: 'Moss', controller: 'bob', location: 'hall' }).state;
  s = run(s, 'scene', { roomId: 'hall-chat', title: 'Hall', location: 'hall', gm: 'host' }).state;
  s = run(s, 'settings', { evolutionMode: 'evolving', worldGmAccounts: ['host'], loreGuards: {} }).state;
  const spoken = run(s, 'speak', { characterId: 'iris', generation: 1, roomId: 'hall-chat', content: 'I heard that Moss betrayed us.' }, 'alice');
  return { s: spoken.state, source: { turnId: spoken.receipt.id, revision: spoken.receipt.revision, noteRevision: 'a'.repeat(64) } };
}
const proposal = (source: any, changes: any[]) => ({ characterId: 'iris', generation: 1, roomId: 'hall-chat', reason: 'After this experience.', sources: [source], changes, loreGuards: {} });
describe('journaled roleplay evolution', () => {
  it('keeps the exact pre-evolution empty and initialized revision hashes', () => {
    expect(roleplayRevision(initialRoleplay())).toBe('8ffce756b6cf21ec72401a727f25e40a96c35da184b7a4ef18f0a4af7e84ef70');
    const s = applyRoleplayCommand(initialRoleplay(), { op: 'initialize', actor: 'host', requestId: 'init', expectedRevision: roleplayRevision(initialRoleplay()), data: { title: 'Legacy', places: { hall: [] } } }, policy).state;
    expect(roleplayRevision(s)).toBe('d2bf23048373764886dfecf17465fdf50ddd34701391b5dd073c7e56049de99d');
    expect(s).not.toHaveProperty('evolution');
  });
  it('auto-applies only personal perspective, retaining the initial character and attribution', () => {
    const { s, source } = setup();
    const result = run(s, 'evolution_propose', proposal(source, [{ kind: 'attitude', target: 'iris', key: 'moss', text: 'I now distrust Moss.' }]), 'alice');
    expect(result.state.characters.iris.definition).toBe('Initially trusting.');
    expect(result.state.characters.moss.relations).toEqual({});
    expect(activeEvolution(result.state).map(p => p.status)).toEqual(['applied']);
    expect(activeEvolution(result.state)[0].sources).toEqual([source]);
  });
  it('requires both the designated GM and current controller for mixed core changes', () => {
    const { s, source } = setup();
    let result = run(s, 'evolution_propose', proposal(source, [{ kind: 'character_core', target: 'iris', key: 'definition', text: 'More guarded after betrayal.' }, { kind: 'world_core', target: 'world', key: 'definition', text: 'The archive has new laws.' }]), 'alice');
    const id = result.receipt.id;
    expect(result.state.evolution!.proposals[id].status).toBe('pending');
    let preview = evolutionPreview(result.state, id);
    result = run(result.state, 'evolution_apply', { proposalId: id, previewFingerprint: preview.fingerprint }, 'host');
    expect(result.state.evolution!.proposals[id].status).toBe('pending');
    preview = evolutionPreview(result.state, id);
    result = run(result.state, 'evolution_apply', { proposalId: id, previewFingerprint: preview.fingerprint }, 'alice');
    expect(result.state.evolution!.proposals[id].status).toBe('applied');
    expect(result.state.evolution!.proposals[id].approvals).toEqual(['host', 'alice']);
  });
  it('does not turn a lie into facts, or another character feelings into personal automatic changes', () => {
    const { s, source } = setup();
    expect(() => run(s, 'evolution_propose', proposal(source, [{ kind: 'event_fact', target: 'world', key: 'betrayal' }]), 'alice')).toThrow(/effects|registered/);
    const result = run(s, 'evolution_propose', proposal(source, [{ kind: 'attitude', target: 'moss', key: 'iris', text: 'Moss loves Iris.' }]), 'alice');
    expect(result.state.evolution!.proposals[result.receipt.id].status).toBe('pending');
  });
  it('rejects stale approvals, control changes, OOC and forged sources', () => {
    const { s, source } = setup();
    let result = run(s, 'evolution_propose', proposal(source, [{ kind: 'character_core', target: 'iris', key: 'definition', text: 'Changed.' }]), 'alice');
    const id = result.receipt.id, preview = evolutionPreview(result.state, id);
    result = run(result.state, 'handoff', { characterId: 'iris', generation: 1, toAccountId: 'bob', reason: 'New owner.' }, 'alice');
    expect(() => run(result.state, 'evolution_apply', { proposalId: id, previewFingerprint: preview.fingerprint }, 'alice')).toThrow(/basis|fingerprint|control/);
    expect(() => run(s, 'evolution_propose', proposal({ ...source, revision: 'f'.repeat(64) }, [{ kind: 'belief', target: 'iris', key: 'rumor', text: 'Maybe.' }]), 'alice')).toThrow(/source/);
    const ooc = run(s, 'ooc', { characterId: 'iris', generation: 1, roomId: 'hall-chat', content: 'Private planning.' }, 'alice');
    expect(() => run(ooc.state, 'evolution_propose', proposal({ ...source, turnId: ooc.receipt.id, revision: ooc.receipt.revision }, [{ kind: 'belief', target: 'iris', key: 'rumor', text: 'Maybe.' }]), 'alice')).toThrow(/source/);
  });
  it('blocks legacy core-edit bypass even after switching back to fixed', () => {
    const { s } = setup();
    expect(() => run(s, 'definition', { characterId: 'iris', generation: 1, definition: 'Rewrite.' }, 'alice')).toThrow(/evolution/);
    const fixed = run(s, 'settings', { evolutionMode: 'fixed' }).state;
    expect(() => run(fixed, 'settings', { definition: 'Rewrite laws.' })).toThrow(/evolution/);
  });
  it('rejects a pending proposal without applying it, and retains its immutable history', () => {
    const { s, source } = setup();
    let result = run(s, 'evolution_propose', proposal(source, [{ kind: 'world_core', target: 'world', key: 'definition', text: 'New law.' }]), 'alice');
    const id = result.receipt.id;
    result = run(result.state, 'evolution_reject', { proposalId: id, reason: 'Not accepted.' }, 'host');
    expect(result.state.evolution!.proposals[id].status).toBe('rejected');
    expect(activeEvolution(result.state)).toEqual([]);
  });
  it('does not restore superseded initial lore when replacement lore is withdrawn', () => {
    const f = setup(); f.s.lore = ['Initial.md'];
    let result = run(f.s, 'evolution_propose', proposal(f.source, [{ kind: 'world_lore', target: 'world', key: 'lore', lore: ['New.md'] }]), 'alice');
    const old = result.receipt.id;
    result = run(result.state, 'evolution_apply', { proposalId: old, previewFingerprint: evolutionPreview(result.state, old).fingerprint }, 'host');
    expect(currentLore(result.state, () => true)).toEqual(['New.md']);
    result = run(result.state, 'evolution_propose', proposal(f.source, [{ kind: 'retract', target: old, key: 'retract' }]), 'alice');
    const retract = result.receipt.id;
    result = run(result.state, 'evolution_apply', { proposalId: retract, previewFingerprint: evolutionPreview(result.state, retract).fingerprint }, 'host');
    expect(currentLore(result.state, () => true)).toEqual([]);
    expect(result.state.lore).toEqual(['Initial.md']);
  });
  it('invalidates derived facts after a source correction without rewriting the original proposal', () => {
    const { s } = setup();
    let next = run(s, 'rule', { id: 'open', conditions: [], effects: [{ op: 'flag', characterId: '$actor', key: 'open', value: true }] }).state;
    const opened = run(next, 'use', { characterId: 'iris', generation: 1, roomId: 'hall-chat', content: 'Open it.', ruleId: 'open' }, 'alice');
    const source = { turnId: opened.receipt.id, revision: opened.receipt.revision, noteRevision: 'a'.repeat(64) };
    const evolved = run(opened.state, 'evolution_propose', proposal(source, [{ kind: 'event_fact', target: 'world', key: 'opening' }]), 'alice');
    const data = { targetTurn: source.turnId, effects: [{ op: 'flag', characterId: 'iris', key: 'open', value: false }], content: 'It did not open.', reason: 'Correct mistaken outcome.' };
    next = run(evolved.state, 'correct', { ...data, previewFingerprint: roleplayHash({ revision: roleplayRevision(evolved.state), ...data }) }).state;
    expect(activeEvolution(next)).toEqual([]);
    expect(next.evolution!.proposals[evolved.receipt.id]!.status).toBe('applied');
    expect(next.characters.iris!.flags.open).toBe(false);
  });
  it('keeps changes awaiting missing world approvers and rejects unauthorized approval', () => {
    const { s, source } = setup();
    const noGm = run(s, 'settings', { worldGmAccounts: [] }).state;
    const p = run(noGm, 'evolution_propose', proposal(source, [{ kind: 'world_core', target: 'world', key: 'definition', text: 'Different laws.' }]), 'alice');
    expect(evolutionPreview(p.state, p.receipt.id).designatedWorldGms).toEqual([]);
    expect(() => run(p.state, 'evolution_apply', { proposalId: p.receipt.id, previewFingerprint: evolutionPreview(p.state, p.receipt.id).fingerprint }, 'host')).toThrow(/approver/);
  });
  it('fences competing core proposals and rejects an already-partially-approved bundle without applying anything', () => {
    const { s, source } = setup();
    const changes = [{ kind: 'character_core', target: 'iris', key: 'definition', text: 'Careful.' }, { kind: 'world_core', target: 'world', key: 'definition', text: 'New world.' }];
    let r = run(s, 'evolution_propose', proposal(source, changes), 'alice'); const first = r.receipt.id;
    r = run(r.state, 'evolution_propose', proposal(source, changes), 'alice'); const second = r.receipt.id;
    r = run(r.state, 'evolution_apply', { proposalId: first, previewFingerprint: evolutionPreview(r.state, first).fingerprint }, 'host');
    r = run(r.state, 'evolution_reject', { proposalId: first, reason: 'Withdraw the entire bundle.' }, 'alice');
    expect(activeEvolution(r.state)).toEqual([]);
    r = run(r.state, 'evolution_apply', { proposalId: second, previewFingerprint: evolutionPreview(r.state, second).fingerprint }, 'host');
    r = run(r.state, 'evolution_apply', { proposalId: second, previewFingerprint: evolutionPreview(r.state, second).fingerprint }, 'alice');
    expect(activeEvolution(r.state)).toHaveLength(1);
    expect(r.state.characters.iris!.definition).toBe('Initially trusting.');
  });
});
