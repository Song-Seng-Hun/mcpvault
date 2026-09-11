import { roleplayAccount, roleplayHash, roleplayId, roleplayRevision, roleplayText } from './roleplay-kernel.js';
const fail = (message) => { throw new Error(message); };
const exact = (obj, keys) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).some(k => !keys.includes(k)))
        fail('Unknown evolution field');
};
export function evolutionGuardMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 128)
        return fail('Invalid evolution lore guards');
    for (const [path, revision] of Object.entries(value))
        if (path.length > 500 || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision))
            fail('Invalid evolution lore revision');
    return structuredClone(value);
}
export function configureEvolution(s, data) {
    if (data.evolutionMode !== undefined && !['fixed', 'evolving'].includes(data.evolutionMode))
        fail('Invalid evolution mode');
    if (data.evolutionMode === undefined && data.worldGmAccounts === undefined)
        return;
    if (!s.evolution)
        s.evolution = { mode: 'fixed', worldGmAccounts: [], loreGuards: evolutionGuardMap(data.loreGuards ?? {}), proposals: {} };
    if (data.evolutionMode !== undefined)
        s.evolution.mode = data.evolutionMode;
    if (data.worldGmAccounts !== undefined) {
        if (!Array.isArray(data.worldGmAccounts) || data.worldGmAccounts.length > 50)
            fail('At most 50 designated world GMs');
        s.evolution.worldGmAccounts = [...new Set(data.worldGmAccounts.map(roleplayAccount))];
    }
}
export const evolutionChangeKey = (c) => `${c.kind}:${c.target}:${c.key}`;
function receipts(s) { return Object.values(s.requests).map(r => r.receipt); }
export function evolutionSourceValid(s, p) {
    const turns = receipts(s);
    return p.sources.every(source => turns.some(t => t.id === source.turnId && t.revision === source.revision && t.roomId === p.roomId)
        && !turns.some(t => t.correctedTurn === source.turnId));
}
/** Latest committed value wins. Invalidating it never silently revives an older value. */
export function activeEvolution(s, usable = () => true) {
    const applied = Object.values(s.evolution?.proposals ?? {}).filter(p => p.status === 'applied');
    const retracted = new Set(applied.flatMap(p => p.changes.filter(c => c.kind === 'retract').map(c => c.target)));
    const latest = new Map();
    for (const p of applied)
        for (const c of p.changes)
            if (c.kind !== 'retract')
                latest.set(evolutionChangeKey(c), p.id);
    return applied.filter(p => !retracted.has(p.id) && evolutionSourceValid(s, p) && usable(p)).map(p => ({ ...p, changes: p.changes.filter(c => c.kind !== 'retract' && latest.get(evolutionChangeKey(c)) === p.id) })).filter(p => p.changes.length);
}
function approvalTargets(s, changes) {
    const expanded = changes.flatMap(c => c.kind === 'retract' ? s.evolution.proposals[c.target].changes : [c]);
    return { characters: [...new Set(expanded.filter(c => ['belief', 'attitude', 'character_core', 'character_lore'].includes(c.kind)).map(c => c.target))],
        world: expanded.some(c => ['world_core', 'world_lore', 'event_fact'].includes(c.kind)) };
}
function basis(s, p) {
    const keys = new Set(p.changes.map(evolutionChangeKey));
    const values = Object.values(s.evolution.proposals).filter(q => q.status === 'applied' && q.changes.some(c => keys.has(evolutionChangeKey(c)) || p.changes.some(change => change.kind === 'retract' && change.target === q.id))).map(q => [q.id, q.changes]);
    return roleplayHash({ values, controls: Object.keys(p.controls).map(id => [id, s.characters[id]?.controller, s.characters[id]?.generation]),
        worldGms: p.worldApproval ? s.evolution.worldGmAccounts : undefined });
}
export function evolutionPreview(s, id) {
    const p = s.evolution?.proposals[roleplayId(id)];
    if (!p)
        return fail('Evolution proposal unavailable');
    const basisValid = p.basis === basis(s, p) && evolutionSourceValid(s, p);
    return { proposalId: id, status: p.status, revision: roleplayRevision(s), basisValid,
        requiredControllers: Object.values(p.controls).map(c => c.controller), requiresWorldGm: p.worldApproval,
        designatedWorldGms: p.worldApproval ? s.evolution.worldGmAccounts : [], approvals: p.approvals,
        fingerprint: roleplayHash({ revision: roleplayRevision(s), proposalId: id, basis: basis(s, p) }) };
}
export function applyEvolution(s, command, id) {
    const e = s.evolution, d = command.data;
    if (!e || e.mode !== 'evolving')
        return fail('World evolution is fixed; explicit host opt-in required');
    if (command.op === 'evolution_propose') {
        const characterId = roleplayId(d.characterId), c = s.characters[characterId];
        if (!c || c.controller !== command.actor || c.generation !== d.generation)
            return fail('Character control or generation mismatch');
        const roomId = roleplayId(d.roomId), scene = s.scenes[roomId];
        if (!scene || scene.location !== c.location)
            fail('Evolution needs the current designated roleplay scene');
        if (Object.values(e.proposals).filter(p => p.status === 'pending').length >= 100)
            fail('Pending evolution capacity reached');
        if (!Array.isArray(d.sources) || d.sources.length < 1 || d.sources.length > 8)
            fail('Evolution needs 1..8 exact sources');
        const turns = receipts(s);
        const sources = d.sources.map((source) => {
            exact(source, ['turnId', 'revision', 'noteRevision']);
            roleplayId(source.turnId);
            if (![source.revision, source.noteRevision].every(r => typeof r === 'string' && /^[a-f0-9]{64}$/.test(r)))
                fail('Invalid evolution source revision');
            const turn = turns.find(t => t.id === source.turnId);
            if (!turn || turn.revision !== source.revision || turn.roomId !== roomId || !['speak', 'move', 'take', 'give', 'use', 'attempt', 'resolve'].includes(turn.kind)
                || !turn.witnesses.includes(characterId) || turns.some(t => t.correctedTurn === source.turnId))
                fail('Evolution source is not an uncorrected witnessed scene event');
            return structuredClone(source);
        });
        if (new Set(sources.map(source => source.turnId)).size !== sources.length)
            fail('Duplicate evolution source');
        if (!Array.isArray(d.changes) || d.changes.length < 1 || d.changes.length > 5)
            fail('Evolution requires 1..5 typed changes');
        const changes = d.changes.map((change) => {
            exact(change, ['kind', 'target', 'key', 'text', 'lore']);
            const { kind } = change, target = roleplayId(change.target), key = roleplayId(change.key);
            if (!['belief', 'attitude', 'event_fact', 'character_core', 'world_core', 'character_lore', 'world_lore', 'retract'].includes(kind))
                fail('Unregistered evolution kind requires review; not auto-classified');
            if (['belief', 'attitude', 'character_core', 'character_lore'].includes(kind) && !s.characters[target])
                fail('Evolution character unavailable');
            if (['world_core', 'world_lore', 'event_fact'].includes(kind) && target !== 'world')
                fail('World change requires world target');
            if (kind.endsWith('_core') && key !== 'definition')
                fail('Core changes require definition key');
            if (kind.endsWith('_lore') && key !== 'lore')
                fail('Lore changes require lore key');
            if (kind === 'retract') {
                const prior = e.proposals[target];
                if (!prior || prior.status !== 'applied' || prior.changes.some(c => c.kind === 'retract') || changesRetract(e, target))
                    return fail('Only an applied unretracted evolution can be withdrawn');
                if (Object.values(e.proposals).some(p => p.status === 'applied' && Number(p.id.slice(5)) > Number(target.slice(5)) && p.changes.some(c => prior.changes.some(old => evolutionChangeKey(old) === evolutionChangeKey(c)))))
                    fail('Downstream evolution prevents simple retraction');
                if (change.text !== undefined || change.lore !== undefined)
                    fail('Retraction contains no replacement prose');
                return { kind, target, key };
            }
            if (kind === 'event_fact') {
                if (change.text !== undefined || change.lore !== undefined)
                    fail('Event facts use exact registered effects, not supplied prose');
                if (!sources.every(source => { const t = turns.find(t => t.id === source.turnId); return ['use', 'resolve', 'move', 'take', 'give'].includes(t.kind) && t.effects.length > 0; }))
                    fail('Event facts require committed registered effects');
                return { kind, target, key };
            }
            if (kind.endsWith('_lore')) {
                if (change.text !== undefined || !Array.isArray(change.lore) || change.lore.length > 8 || change.lore.some((path) => typeof path !== 'string' || path.length > 500))
                    fail('Invalid evolution lore references');
                return { kind, target, key, lore: [...new Set(change.lore)] };
            }
            if (change.lore !== undefined)
                fail('Unexpected evolution lore');
            return { kind, target, key, text: roleplayText(change.text, kind.endsWith('_core') ? 4000 : 280) };
        });
        if (new Set(changes.map(evolutionChangeKey)).size !== changes.length)
            fail('Duplicate evolution change key');
        const targets = approvalTargets(s, changes);
        const controls = Object.fromEntries(targets.characters.map(id => [id, { controller: s.characters[id].controller, generation: s.characters[id].generation }]));
        const automatic = changes.every(change => (['belief', 'attitude'].includes(change.kind) && change.target === characterId) || change.kind === 'event_fact');
        const p = { id, author: command.actor, characterId, generation: c.generation, roomId, changes, sources, reason: roleplayText(d.reason),
            automatic, status: automatic ? 'applied' : 'pending', approvals: [], controls, worldApproval: targets.world, loreGuards: evolutionGuardMap(d.loreGuards ?? {}), basis: '' };
        p.basis = basis(s, p);
        e.proposals[id] = p;
        return { characterId, roomId, content: automatic ? 'Small typed evolution recorded; personal perspective is not world truth.' : 'Evolution proposed; required approvals are pending.' };
    }
    const p = e.proposals[roleplayId(d.proposalId)];
    if (!p || p.status !== 'pending')
        return fail('Pending evolution proposal unavailable');
    const currentController = Object.keys(p.controls).some(id => s.characters[id]?.controller === command.actor);
    const worldGm = p.worldApproval && e.worldGmAccounts.includes(command.actor);
    if (command.op === 'evolution_reject') {
        if (p.author !== command.actor && !currentController && !worldGm)
            fail('Evolution rejection needs its author or current approver');
        p.status = 'rejected';
        p.rejectedBy = command.actor;
        p.rejectionReason = roleplayText(d.reason);
        return { characterId: p.characterId, roomId: p.roomId, content: 'Evolution rejected or withdrawn; no changes applied.' };
    }
    if (command.op !== 'evolution_apply')
        return fail('Unknown evolution operation');
    const preview = evolutionPreview(s, p.id);
    if (!preview.basisValid)
        fail('Evolution basis or control changed; submit a new proposal');
    if (d.previewFingerprint !== preview.fingerprint)
        fail('Evolution preview fingerprint changed; preview again');
    if (!currentController && !worldGm)
        fail('Current designated evolution approver required');
    if (p.approvals.includes(command.actor))
        fail('Account already approved this proposal');
    p.approvals.push(command.actor);
    if (Object.values(p.controls).every(c => p.approvals.includes(c.controller)) && (!p.worldApproval || e.worldGmAccounts.some(account => p.approvals.includes(account))))
        p.status = 'applied';
    return { characterId: p.characterId, roomId: p.roomId, content: p.status === 'applied' ? 'Approved evolution applied; initial settings and earlier history retained.' : 'Approval recorded; other required approvals remain pending.' };
}
function changesRetract(e, id) { return Object.values(e.proposals).some(p => p.status === 'applied' && p.changes.some(c => c.kind === 'retract' && c.target === id)); }
