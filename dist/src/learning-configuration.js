import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { configKeys, validateCapabilityGraph, validateCapabilitySelection, validateLearningPathConfiguration } from './capability-graph.js';
export function prepareLearningConfiguration(input, entries, context, allowUnpinned) {
    configKeys(input, ['definition', 'mappings', 'expectedFingerprint']);
    const value = input;
    if (!value.definition || typeof value.definition !== 'object' || JSON.stringify(value.definition).length > 6000)
        throw guidanceError(new Error('Mapped configuration definition must be an object of at most 6000 characters'), 'guid-fe50c380fd305f51');
    const check = validateLearningPathConfiguration(value.definition);
    const definition = value.definition;
    const nodes = validateCapabilityGraph(definition.nodes), selected = validateCapabilitySelection(nodes, definition.selected);
    if (!Array.isArray(value.mappings) || !value.mappings.length || value.mappings.length > 16 || value.mappings.length !== selected.length)
        throw guidanceError(new Error('Provide one mapping for every selected node, at most sixteen'), 'guid-4c85c4227b4b2491');
    const seen = new Set();
    const mappings = value.mappings.map(raw => {
        configKeys(raw, ['nodeId', 'path']);
        const nodeId = raw.nodeId, path = raw.path;
        if (typeof nodeId !== 'string' || !selected.includes(nodeId) || seen.has(nodeId) || typeof path !== 'string')
            throw guidanceError(new Error('Invalid selected node mapping'), 'guid-564f817743de7c8b');
        seen.add(nodeId);
        const entry = entries.find(entry => entry.path === path);
        if (!entry)
            throw guidanceError(new Error('Mapping must target an entry in the current complete learning route'), 'guid-ed5d26772fff8b97');
        return { nodeId, path: entry.path, revision: entry.revision };
    });
    const position = new Map(mappings.map(mapping => [mapping.nodeId, entries.findIndex(entry => entry.path === mapping.path)]));
    for (const node of nodes)
        if (position.has(node.id) && node.requires.some(id => position.get(id) > position.get(node.id)))
            throw guidanceError(new Error('Mapped prerequisite occurs after its dependent in the selected learning order'), 'guid-9bfad67f139585fa');
    const fingerprint = createHash('sha256').update(JSON.stringify({ configuration: check.fingerprint, ...context,
        mappings: [...mappings].sort((a, b) => a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0) })).digest('hex');
    if ((!allowUnpinned || value.expectedFingerprint !== undefined) && value.expectedFingerprint !== fingerprint)
        throw guidanceError(new Error('Configuration mapping fingerprint changed; repeat configuration.learning_preview'), 'guid-5659122e99ce858b');
    return { definition: structuredClone(definition), mappings, fingerprint };
}
export function isLearningConfigurationState(value) {
    try {
        configKeys(value, ['definition', 'mappings', 'fingerprint']);
        const state = value;
        if (!/^[a-f0-9]{64}$/.test(state.fingerprint) || !Array.isArray(state.mappings) || !state.mappings.length || state.mappings.length > 16
            || !state.definition || JSON.stringify(state.definition).length > 6000)
            return false;
        validateLearningPathConfiguration(state.definition);
        return state.mappings.every(m => m && typeof m.nodeId === 'string' && typeof m.path === 'string' && m.path.length <= 500 && /^[a-f0-9]{64}$/.test(m.revision));
    }
    catch {
        return false;
    }
}
export const LEARNING_CONFIGURATION_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['definition', 'mappings', 'expectedFingerprint'], properties: {
        definition: { type: 'object', description: 'Exact supplied learning-path configuration from configuration.learning_preview, at most 6000 JSON characters.' },
        mappings: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'object', additionalProperties: false, required: ['nodeId', 'path'], properties: {
                    nodeId: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' }, path: { type: 'string', maxLength: 500 },
                } } },
        expectedFingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    },
};
