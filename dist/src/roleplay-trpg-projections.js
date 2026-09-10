import { guidanceError } from './guidance-runtime.js';
import { roleplayId, roleplayRevision } from './roleplay-model.js';
import { trpgCombat, trpgStats } from './roleplay-trpg.js';
import { createHash } from 'node:crypto';
const EMPTY_DIGEST = '0'.repeat(64);
/** Escape only platform device basenames; '_' cannot occur in a canonical ID,
 * so this mapping cannot collide with another character's ordinary filename. */
const artifactStem = (characterId) => {
    const id = roleplayId(characterId);
    return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(id) ? `_${id}` : id;
};
const digest = (content) => createHash('sha256').update(content).digest('hex');
const sealPattern = (path) => path.endsWith('.canvas') ? /("contentDigest": ")([a-f0-9]{64})(")/g : path.endsWith('.base') ? /^(# projection_digest: )([a-f0-9]{64})()$/gm : /^(projection_digest: )([a-f0-9]{64})()$/gm;
function seal(file) {
    return { ...file, content: file.content.replace(sealPattern(file.path), `$1${digest(file.content)}$3`) };
}
/** An integrity marker detects manual edits; it is not authentication or permission. */
export function trpgArtifactSource(file, characterId) {
    if (!['md', 'canvas', 'base'].some(ext => file.path === `Community/Roleplay/Sheets/${artifactStem(characterId)}.${ext}`))
        return undefined;
    const matches = [...file.content.matchAll(sealPattern(file.path))];
    if (matches.length !== 1 || matches[0][2] !== digest(file.content.replace(sealPattern(file.path), `$1${EMPTY_DIGEST}$3`)))
        return undefined;
    try {
        if (file.path.endsWith('.canvas')) {
            const m = JSON.parse(file.content).mcpvault;
            return m?.managedBy === 'roleplay_trpg' && m.characterId === characterId && /^[a-f0-9]{64}$/.test(m.sourceRevision) && /^[a-f0-9]{64}$/.test(m.rulesetFingerprint) ? m.sourceRevision : undefined;
        }
        const prefix = file.path.endsWith('.base') ? '# ' : '';
        const field = (key) => file.content.match(new RegExp(`^${prefix}${key}: (.+)$`, 'm'))?.[1];
        const source = field('source_revision');
        return field('managed_by') === 'roleplay_trpg' && field('character_id') === characterId && /^[a-f0-9]{64}$/.test(source ?? '') && /^[a-f0-9]{64}$/.test(field('ruleset_fingerprint') ?? '') ? source : undefined;
    }
    catch {
        return undefined;
    }
}
export function trpgContextRows(s, characterId, readableRooms) {
    const combat = trpgCombat(s, characterId);
    if (!combat || !readableRooms.has(combat[0]))
        return [];
    const [roomId, encounter] = combat, sheet = s.trpg.sheets[characterId], character = s.characters[characterId], current = encounter.order[encounter.turn];
    return [{ kind: 'trpg_encounter', roomId, current, round: encounter.round, actions: encounter.actions },
        ...s.trpg.ruleset.skills.filter(skill => sheet.loadouts[sheet.active].skills.includes(skill.id)).map(skill => ({
            kind: 'trpg_action', skillId: skill.id, action: skill.kind,
            eligible: current === characterId && encounter.actions > 0 && sheet.resources.hp > 0 && sheet.resources.focus >= skill.focus,
            nextAction: { endpointId: 'roleplay.trpg', arguments: { op: 'act', characterId, generation: character.generation, roomId, skillId: skill.id, ...(skill.kind === 'guard' && { targetId: characterId }) }, requires: ['targetId', 'expectedRevision', 'requestId', 'accessToken'] },
        }))];
}
export function trpgRows(s, characterId) {
    if (!s.trpg)
        return [];
    const t = s.trpg, r = t.ruleset;
    if (characterId)
        roleplayId(characterId);
    const rows = [{ kind: 'ruleset', id: r.id, version: r.version, fingerprint: t.fingerprint, actionsPerTurn: r.actionsPerTurn, switchCost: r.switchCost }];
    for (const [id, c] of Object.entries(t.sheets).filter(([id]) => !characterId || id === characterId)) {
        rows.push({ kind: 'sheet', characterId: id, growth: c.growth, active: c.active });
        for (const [key, value] of Object.entries(c.attributes))
            rows.push({ kind: 'attribute', characterId: id, key, value });
        const stats = trpgStats(s, id);
        for (const [key, value] of Object.entries(stats))
            rows.push({ kind: 'derived', characterId: id, key, value });
        for (const [key, value] of Object.entries(c.resources))
            rows.push({ kind: 'resource', characterId: id, key, value, max: stats[r.resources[key]] });
        for (const [key, value] of Object.entries(c.statuses))
            rows.push({ kind: 'status', characterId: id, key, value });
        for (const skill of r.skills) {
            rows.push({ kind: 'skill', characterId: id, id: skill.id, action: skill.kind, cost: skill.cost, focus: skill.focus, power: skill.power, attribute: skill.attribute, learned: c.learned.includes(skill.id) });
            for (const requirement of skill.requires)
                rows.push({ kind: 'prerequisite', characterId: id, skillId: skill.id, requirement });
            for (const exclusion of skill.excludes)
                rows.push({ kind: 'exclusion', characterId: id, skillId: skill.id, exclusion });
        }
        for (const [name, l] of Object.entries(c.loadouts)) {
            rows.push({ kind: 'loadout', characterId: id, name, active: name === c.active });
            for (const skillId of l.skills)
                rows.push({ kind: 'loadedSkill', characterId: id, name, skillId });
            for (const itemId of l.equipment)
                rows.push({ kind: 'equipment', characterId: id, name, itemId, owned: (s.items[itemId]?.[`character:${id}`] ?? 0) > 0 });
        }
    }
    return rows;
}
/** Pure managed artifacts, never authority. Persistence goes through project guards. */
export function trpgArtifacts(s, characterId) {
    const id = roleplayId(characterId), t = s.trpg, c = t?.sheets[id];
    if (!t || !c)
        throw guidanceError(new Error('Character sheet unavailable'), 'guid-727599723c303004');
    const revision = roleplayRevision(s), path = `Community/Roleplay/Sheets/${artifactStem(id)}.md`, stats = trpgStats(s, id), r = t.ruleset;
    const lines = ['---', 'mcpvault_type: roleplay_sheet', 'fiction_domain: roleplay', 'managed_by: roleplay_trpg', `character_id: ${id}`, `source_revision: ${revision}`, `ruleset_fingerprint: ${t.fingerprint}`, `hp: ${c.resources.hp}`, `growth: ${c.growth}`, '---', `# ${id}`, '', `Ruleset: ${r.id}@${r.version}`, '', `HP: ${c.resources.hp} / ${stats[r.resources.hp]}`, `Focus: ${c.resources.focus} / ${stats[r.resources.focus]}`, `Growth: ${c.growth}`, `Active loadout: ${c.active}`, '', '## Attributes', ...Object.entries(c.attributes).map(([k, v]) => `- ${k}: ${v}`), '', '## Derived', ...Object.entries(stats).map(([k, v]) => `- ${k}: ${v}`), '', '## Statuses', ...Object.entries(c.statuses).map(([k, v]) => `- ${k}: ${v}`), '', '## Inventory', ...Object.entries(s.items).filter(([, owners]) => (owners[`character:${id}`] ?? 0) > 0).map(([k, owners]) => `- ${k}: ${owners[`character:${id}`]}`), '', '## Loadouts'];
    for (const [name, l] of Object.entries(c.loadouts))
        lines.push(`- ${name}: skills ${l.skills.join(', ')}; equipment ${l.equipment.join(', ')}`);
    for (const skill of r.skills)
        lines.push('', `## skill-${skill.id}`, `${c.learned.includes(skill.id) ? 'Learned' : 'Locked'}; growth cost ${skill.cost}; focus ${skill.focus}; ${skill.kind} ${skill.power} + ${skill.attribute}.`, `Prerequisites: ${skill.requires.join(', ') || 'none'}. Excludes: ${skill.excludes.join(', ') || 'none'}.`);
    lines.splice(7, 0, `projection_digest: ${EMPTY_DIGEST}`);
    const edges = r.skills.flatMap(skill => skill.requires.map(req => ({ fromNode: req, toNode: skill.id, fromSide: 'right', toSide: 'left' }))).map((edge, i) => ({ id: `edge-${i}`, ...edge }));
    const canvas = { nodes: r.skills.map((skill, i) => ({ id: skill.id, type: 'file', file: path, subpath: `#skill-${skill.id}`, x: (i % 4) * 300, y: Math.floor(i / 4) * 240, width: 280, height: 200 })),
        edges: edges.slice(0, 300), mcpvault: { managedBy: 'roleplay_trpg', characterId: id, sourceRevision: revision, rulesetFingerprint: t.fingerprint, omittedEdges: Math.max(0, edges.length - 300), contentDigest: EMPTY_DIGEST } };
    return [{ path, content: lines.join('\n') + '\n' }, { path: path.replace('.md', '.canvas'), content: JSON.stringify(canvas, null, 2) + '\n' },
        { path: path.replace('.md', '.base'), content: `# managed_by: roleplay_trpg\n# character_id: ${id}\n# source_revision: ${revision}\n# ruleset_fingerprint: ${t.fingerprint}\n# projection_digest: ${EMPTY_DIGEST}\nfilters:\n  and:\n    - 'file.path == "${path}"'\nviews:\n  - type: table\n    name: Character sheet\n    order:\n      - file.name\n      - hp\n      - growth\n` }].map(seal);
}
