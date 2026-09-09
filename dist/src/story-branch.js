import { guidanceError, guidanceText } from './guidance-runtime.js';
export const STORY_BRANCH_LIMITS = Object.freeze({
    nodes: 256, variables: 128, choices: 2048, choicesPerNode: 64,
    rulesPerChoice: 32, rules: 8192, stringChars: 4096,
    choiceSequence: 4096, steps: 256, diagnostics: 256,
    // Includes trace snapshots, so large strings cannot multiply into huge output.
    outputChars: 2_000_000,
});
function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function shape(value, keys) {
    return object(value) && Object.keys(value).every(key => keys.includes(key));
}
function identifier(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 128
        && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}
function valueMatches(type, value) {
    return typeof value === type && (type !== 'number' || Number.isFinite(value))
        && (type !== 'string' || value.length <= STORY_BRANCH_LIMITS.stringChars);
}
/** Validate untrusted JSON-shaped input without running it. Malformed or overlarge
 * graphs return error diagnostics; cycles, unreachable nodes and dead ends are
 * warnings. Results contain at most 256 diagnostics.
 */
export function validateStoryBranchGraph(graph) {
    const diagnostics = [];
    let hasError = false;
    let diagnosticsTruncated = false;
    const add = (diagnostic) => {
        if (diagnostic.severity === 'error')
            hasError = true;
        if (diagnostics.length < STORY_BRANCH_LIMITS.diagnostics)
            diagnostics.push(diagnostic);
        else
            diagnosticsTruncated = true;
    };
    const error = (code, message, location = {}) => {
        add({ ...location, code, message, severity: 'error' });
    };
    const result = () => ({ valid: !hasError, diagnostics, diagnosticsTruncated });
    if (!shape(graph, ['revision', 'startNodeId', 'variables', 'nodes']) || !identifier(graph.revision)
        || !identifier(graph.startNodeId) || !Array.isArray(graph.variables) || !Array.isArray(graph.nodes)) {
        error('invalid_structure', 'Graph requires revision, startNodeId, variables and nodes.');
        return result();
    }
    if (graph.nodes.length === 0 || graph.nodes.length > STORY_BRANCH_LIMITS.nodes || graph.variables.length > STORY_BRANCH_LIMITS.variables) {
        error('bound_exceeded', 'Graph node or variable bound exceeded.');
        return result();
    }
    const variables = new Map();
    for (const variable of graph.variables) {
        if (!shape(variable, ['id', 'type', 'initialValue']) || !identifier(variable.id)
            || ['__proto__', 'prototype', 'constructor'].includes(variable.id)
            || !['boolean', 'number', 'string'].includes(variable.type)) {
            error('invalid_structure', 'Invalid variable definition.');
            continue;
        }
        if (variables.has(variable.id))
            error('duplicate_variable', 'Variable IDs must be unique.', { variableId: variable.id });
        if (!valueMatches(variable.type, variable.initialValue))
            error('type_mismatch', 'Invalid initial variable value.', { variableId: variable.id });
        variables.set(variable.id, variable);
    }
    const nodes = new Map();
    const choices = new Set();
    let choiceCount = 0;
    let ruleCount = 0;
    for (const node of graph.nodes) {
        if (!shape(node, ['id', 'end', 'choices']) || !identifier(node.id) || !Array.isArray(node.choices)
            || (node.end !== undefined && typeof node.end !== 'boolean')) {
            error('invalid_structure', 'Invalid node definition.');
            continue;
        }
        if (node.choices.length > STORY_BRANCH_LIMITS.choicesPerNode || (choiceCount += node.choices.length) > STORY_BRANCH_LIMITS.choices) {
            error('bound_exceeded', 'Graph choice bound exceeded.');
            return result();
        }
        if (nodes.has(node.id))
            error('duplicate_node', 'Node IDs must be unique.', { nodeId: node.id });
        nodes.set(node.id, node);
        if (node.end && node.choices.length)
            error('end_choices', 'End nodes cannot have outgoing choices.', { nodeId: node.id });
        for (const choice of node.choices) {
            if (!shape(choice, ['id', 'label', 'targetId', 'conditions', 'effects']) || !identifier(choice.id) || !identifier(choice.targetId)
                || typeof choice.label !== 'string' || !choice.label.trim() || choice.label.length > 1024) {
                error('invalid_structure', 'Invalid choice definition.', { nodeId: node.id });
                continue;
            }
            const location = { nodeId: node.id, choiceId: choice.id };
            if (choices.has(choice.id))
                error('duplicate_choice', 'Choice IDs must be globally unique.', location);
            choices.add(choice.id);
            for (const [kind, rules] of [['conditions', choice.conditions], ['effects', choice.effects]]) {
                if (rules === undefined)
                    continue;
                if (!Array.isArray(rules)) {
                    error('invalid_structure', 'Choice rules must be arrays.', location);
                    continue;
                }
                if (rules.length > STORY_BRANCH_LIMITS.rulesPerChoice || (ruleCount += rules.length) > STORY_BRANCH_LIMITS.rules) {
                    error('bound_exceeded', 'Graph rule bound exceeded.', location);
                    return result();
                }
                for (const rule of rules) {
                    const condition = kind === 'conditions';
                    if (!shape(rule, ['variableId', condition ? 'operator' : 'operation', 'value']) || !identifier(rule.variableId)) {
                        error('invalid_structure', 'Invalid declarative rule.', location);
                        continue;
                    }
                    const op = condition ? rule.operator : rule.operation;
                    if (!(condition ? ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] : ['set', 'add']).includes(op)) {
                        error('invalid_structure', 'Unsupported declarative operation.', location);
                        continue;
                    }
                    const variable = variables.get(rule.variableId);
                    if (!variable)
                        error('unknown_variable', 'Rule references an undeclared variable.', { ...location, variableId: rule.variableId });
                    else if (!valueMatches(variable.type, rule.value) || (['add', 'gt', 'gte', 'lt', 'lte'].includes(op) && variable.type !== 'number')) {
                        error('type_mismatch', 'Rule operand or operation does not match variable type.', { ...location, variableId: variable.id });
                    }
                }
            }
        }
    }
    if (!nodes.has(graph.startNodeId))
        error('broken_start', 'Start node does not exist.');
    const adjacency = new Map();
    for (const node of nodes.values()) {
        const targets = [];
        for (const choice of node.choices) {
            if (!object(choice) || !identifier(choice.targetId))
                continue;
            if (!nodes.has(choice.targetId))
                error('broken_target', 'Choice target does not exist.', { nodeId: node.id, ...(identifier(choice.id) ? { choiceId: choice.id } : {}) });
            else
                targets.push(choice.targetId);
        }
        adjacency.set(node.id, targets);
        if (!node.end && node.choices.length === 0)
            add({ code: 'dead_end', severity: 'warning', message: guidanceText('guid-ecd08c74e017d651', 'Non-end node has no choices.'), nodeId: node.id });
    }
    const reached = new Set();
    const pending = nodes.has(graph.startNodeId) ? [graph.startNodeId] : [];
    while (pending.length) {
        const id = pending.pop();
        if (reached.has(id))
            continue;
        reached.add(id);
        pending.push(...(adjacency.get(id) ?? []));
    }
    for (const id of nodes.keys())
        if (!reached.has(id))
            add({ code: 'unreachable', severity: 'warning', message: guidanceText('guid-e5c417b59e26f844', 'Node is unreachable from start.'), nodeId: id });
    // Tarjan SCCs distinguish real cycles from ordinary branch reconvergence.
    let nextIndex = 0;
    const indices = new Map();
    const low = new Map();
    const stack = [];
    const onStack = new Set();
    const visit = (id) => {
        indices.set(id, nextIndex);
        low.set(id, nextIndex++);
        stack.push(id);
        onStack.add(id);
        for (const target of adjacency.get(id) ?? []) {
            if (!indices.has(target)) {
                visit(target);
                low.set(id, Math.min(low.get(id), low.get(target)));
            }
            else if (onStack.has(target))
                low.set(id, Math.min(low.get(id), indices.get(target)));
        }
        if (low.get(id) !== indices.get(id))
            return;
        const component = [];
        let member;
        do {
            member = stack.pop();
            onStack.delete(member);
            component.push(member);
        } while (member !== id);
        if (component.length > 1 || adjacency.get(id)?.includes(id))
            add({
                code: 'cycle', severity: 'warning', message: guidanceText('guid-b17869f5723da32f', 'Cycle allowed; play is step-bounded.'), nodeIds: component.sort(),
            });
    };
    for (const id of nodes.keys())
        if (!indices.has(id))
            visit(id);
    return result();
}
function conditionHolds(condition, state) {
    const value = state[condition.variableId];
    switch (condition.operator) {
        case 'eq': return value === condition.value;
        case 'ne': return value !== condition.value;
        case 'gt': return value > condition.value;
        case 'gte': return value >= condition.value;
        case 'lt': return value < condition.value;
        case 'lte': return value <= condition.value;
    }
}
/** Replay from start on the supplied exact graph revision. Throws on invalid
 * graph/state/consumed choice. Caller supplies a trustworthy graph revision;
 * this pure function compares it but does not mint, hash or persist revisions.
 * A step cap returns a partial trace and consumedChoices for explicit resumption
 * by replay. Input objects are never modified; returned snapshots are detached.
 */
export function runStoryBranch(input) {
    if (!object(input))
        throw guidanceError(new Error('Invalid branch run input.'), 'guid-8a2cf81b3a17a9a3');
    if (!validateStoryBranchGraph(input.graph).valid)
        throw guidanceError(new Error('Invalid branch graph.'), 'guid-5e055f6c29756447');
    if (input.expectedRevision !== input.graph.revision)
        throw guidanceError(new Error('Stale graph revision.'), 'guid-14e62bb43a9b24ad');
    const maxSteps = input.maxSteps === undefined ? 64 : input.maxSteps;
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > STORY_BRANCH_LIMITS.steps)
        throw guidanceError(new Error('maxSteps bound must be 1..256.'), 'guid-35f9c39b65be5077');
    if (!Array.isArray(input.choiceIds) || input.choiceIds.length > STORY_BRANCH_LIMITS.choiceSequence || !input.choiceIds.every(identifier))
        throw guidanceError(new Error('Choice sequence bound or ID invalid.'), 'guid-488e9b0372d356ae');
    if (!object(input.initialState))
        throw guidanceError(new Error('Invalid initial state.'), 'guid-bbd5af4cdafa0930');
    const definitions = new Map(input.graph.variables.map(variable => [variable.id, variable]));
    const state = {};
    for (const variable of input.graph.variables)
        state[variable.id] = variable.initialValue;
    for (const key of Object.keys(input.initialState)) {
        const definition = definitions.get(key);
        if (!definition || !valueMatches(definition.type, input.initialState[key]))
            throw guidanceError(new Error('Invalid initial state key or value.'), 'guid-e2cdb3ee11ac3b6e');
        state[key] = input.initialState[key];
    }
    const nodes = new Map(input.graph.nodes.map(node => [node.id, node]));
    let current = nodes.get(input.graph.startNodeId);
    const trace = [];
    let outputChars = JSON.stringify(state).length;
    const enabled = () => current.end ? [] : current.choices.filter(choice => (choice.conditions ?? []).every(condition => conditionHolds(condition, state)));
    for (const choiceId of input.choiceIds.slice(0, maxSteps)) {
        const choice = enabled().find(candidate => candidate.id === choiceId);
        if (!choice)
            throw guidanceError(new Error('Invalid, disabled or wrong-node choice.'), 'guid-015d8876563455bf');
        for (const effect of choice.effects ?? []) {
            const value = effect.operation === 'set' ? effect.value : state[effect.variableId] + effect.value;
            if (!valueMatches(definitions.get(effect.variableId).type, value))
                throw guidanceError(new Error('Effect arithmetic overflow: values must remain finite and bounded.'), 'guid-71c3be81a2186032');
            state[effect.variableId] = value;
        }
        const step = { step: trace.length + 1, choiceId, fromNodeId: current.id, toNodeId: choice.targetId, state: { ...state } };
        outputChars += JSON.stringify(step).length;
        if (outputChars > STORY_BRANCH_LIMITS.outputChars)
            throw guidanceError(new Error('Branch output bound exceeded.'), 'guid-37ba60f2a097b446');
        trace.push(step);
        current = nodes.get(choice.targetId);
    }
    const availableChoices = enabled().map(({ id, label, targetId }) => ({ id, label, targetId }));
    const result = {
        graphRevision: input.graph.revision, currentNodeId: current.id, state: { ...state }, trace, availableChoices,
        consumedChoices: trace.length, stepLimitReached: input.choiceIds.length > trace.length,
        ended: current.end === true, deadEnd: !current.end && availableChoices.length === 0,
    };
    if (JSON.stringify(result).length > STORY_BRANCH_LIMITS.outputChars)
        throw guidanceError(new Error('Branch output bound exceeded.'), 'guid-37ba60f2a097b446');
    return result;
}
