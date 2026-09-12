import { guidanceText } from './guidance-runtime.js';
import { STORY_OPERATIONS } from './story-tools.js';
const reads = (alias, policy, ...ops) => Object.fromEntries(ops.map(op => [op, { alias, policy }]));
/** Code-owned mixed-operation contracts, not an authorization or plugin registry.
 * Schemas still own valid writes; services still own all final domain guards. */
const CONTRACTS = {
    ...Object.fromEntries(Object.entries(STORY_OPERATIONS).map(([name, spec]) => [spec.tool, {
            defaultOp: spec.defaultOp, story: true, summary: spec.reads.length ? 'public' : 'write',
            reads: Object.fromEntries(spec.reads.map(op => [op, { alias: spec.writes.length ? `read_story_${name}` : spec.tool,
                    policy: op === 'reconnect_preview' ? 'proof' : 'public' }])),
        }])),
    manage_skill_candidate: { defaultOp: 'read', summary: 'public', reads: reads('read_skill_candidate', 'public', 'read', 'list') },
    evaluate_skill: { defaultOp: 'read', summary: 'public', reads: reads('read_skill_evaluation', 'public', 'read') },
    promote_skill: { defaultOp: 'preview', summary: 'skill-preview', reads: reads('preview_skill_promotion', 'skill-preview', 'preview') },
    rollback_skill: { defaultOp: 'preview', summary: 'skill-preview', reads: reads('preview_skill_rollback', 'skill-preview', 'preview') },
    manage_work_project: { defaultOp: 'read', summary: 'public', reads: reads('read_work_project', 'public', 'read') },
    manage_work_group: { defaultOp: 'read', summary: 'public', reads: reads('read_work_group', 'public', 'read') },
    manage_community_participation: { defaultOp: 'read', summary: 'authenticated', reads: reads('read_community_participation', 'authenticated', 'read') },
    manage_roleplay_world: { defaultOp: 'read', summary: 'roleplay-world', reads: reads('read_roleplay_world', 'roleplay-world', 'read') },
    manage_roleplay_character: { defaultOp: 'read', summary: 'roleplay-read', reads: reads('read_roleplay_character', 'roleplay-read', 'read') },
    manage_roleplay_scene: { defaultOp: 'read', summary: 'roleplay-read', reads: reads('read_roleplay_scene', 'roleplay-read', 'read') },
    manage_roleplay_evolution: { summary: 'roleplay-read', reads: { ...reads('read_roleplay_evolution', 'roleplay-read', 'read', 'list'),
            ...reads('preview_roleplay_evolution', 'roleplay-preview', 'preview') } },
    manage_roleplay_trpg: { summary: 'roleplay-read', reads: { ...reads('read_roleplay_trpg', 'roleplay-read', 'read', 'export'),
            ...reads('preview_roleplay_trpg', 'roleplay-preview', 'respec_preview') } },
    correct_roleplay_turn: { summary: 'roleplay-preview', reads: reads('preview_roleplay_correction', 'roleplay-preview', 'preview') },
};
export function operationReadAlias(tool, op) {
    const contract = Object.hasOwn(CONTRACTS, tool) ? CONTRACTS[tool] : undefined;
    const selected = op === undefined ? contract?.defaultOp : op;
    return contract && typeof selected === 'string' && Object.hasOwn(contract.reads, selected)
        ? contract.reads[selected].alias : undefined;
}
export function operationAvailability(item, context, baseWrite) {
    const contract = Object.hasOwn(CONTRACTS, item.toolName) ? CONTRACTS[item.toolName] : undefined;
    if (!contract)
        return;
    const authority = (requires, disabled = false) => {
        const missing = requires.filter(cap => !context.capabilities.has(cap));
        const available = !disabled && context.authenticated && !missing.length;
        const reason = disabled ? 'server is read-only' : !context.authenticated ? 'authentication required'
            : missing.length ? `capability required: ${missing.join(', ')}` : undefined;
        return { available, state: disabled ? 'disabled' : available ? 'ready' : 'locked', requires, ...(reason && { reason }) };
    };
    const publicRead = { available: true, state: 'ready', requires: [] };
    const disabled = (requires, reason) => ({ available: false, state: 'disabled', requires, reason });
    const read = (policy) => {
        const hostDisabled = context.skillEvolutionEnabled === false && item.endpointId.startsWith('skill.')
            || context.roleplayConfigured === false && item.endpointId.startsWith('roleplay.');
        if (hostDisabled && baseWrite.state === 'disabled')
            return baseWrite;
        switch (policy) {
            case 'public':
            case 'roleplay-world': return publicRead;
            case 'authenticated': return { available: context.authenticated, state: context.authenticated ? 'ready' : 'locked', requires: ['authentication'],
                ...(!context.authenticated && { reason: guidanceText('guid-d85901f74db50a43', 'authentication required') }) };
            case 'proof': return authority(['write', 'task']);
            case 'skill-preview': return context.skillEvolutionEnabled === false
                ? disabled(item.requires, 'skill evolution is disabled by the host') : authority(item.requires);
            case 'roleplay-read': return context.roleplayConfigured === false ? disabled([], 'host configuration is missing') : publicRead;
            case 'roleplay-preview': return context.roleplayConfigured === false
                ? disabled(item.requires, 'host configuration is missing') : authority(item.requires);
        }
    };
    const write = contract.story ? authority(['write', 'task'], context.readOnly) : baseWrite;
    const properties = item.input.properties;
    const ops = properties?.op?.enum ?? Object.keys(contract.reads);
    return { ...(contract.summary === 'write' ? write : read(contract.summary)),
        operations: Object.fromEntries(ops.map(op => [op, Object.hasOwn(contract.reads, op) ? read(contract.reads[op].policy) : write])) };
}
