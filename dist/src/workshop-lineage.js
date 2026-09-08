const IDEA_ORIGIN_STEPS = [
    'brainwriting-independent', 'brainwriting-build', 'six-hats-alternatives',
    'scamper-substitute', 'scamper-combine', 'scamper-adapt', 'scamper-modify',
    'scamper-other-use', 'scamper-eliminate', 'scamper-reverse', 'crazy8s-eight',
    '1-2-4-all-one', 'affinity-kj-collect', 'ngt-independent', 'ngt-roundrobin',
];
const requirements = {
    'brainwriting-independent': ['brainwriting-independent'],
    'brainwriting-build': ['brainwriting-independent', 'brainwriting-build'],
    'scamper-substitute': IDEA_ORIGIN_STEPS,
    'scamper-combine': IDEA_ORIGIN_STEPS,
    'scamper-adapt': IDEA_ORIGIN_STEPS,
    'scamper-modify': IDEA_ORIGIN_STEPS,
    'scamper-other-use': IDEA_ORIGIN_STEPS,
    'scamper-eliminate': IDEA_ORIGIN_STEPS,
    'scamper-reverse': IDEA_ORIGIN_STEPS,
    '1-2-4-all-two': ['1-2-4-all-one'],
    '1-2-4-all-four': ['1-2-4-all-one', '1-2-4-all-two'],
    '1-2-4-all-all': ['1-2-4-all-one', '1-2-4-all-two', '1-2-4-all-four'],
    'affinity-kj-group': ['affinity-kj-collect'],
    'affinity-kj-name': ['affinity-kj-group'],
    'mind-map-crosslinks': ['mind-map-branches'],
    'dot-voting-freeze': ['dot-voting-freeze'],
    'dot-voting-vote': ['dot-voting-freeze'],
};
/** The service uses this before its bounded chronological submission read. */
export function workshopLineagePrerequisites(stepId) {
    return requirements[stepId] || [];
}
function strings(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
function records(value) {
    return Array.isArray(value)
        ? value.filter((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
        : [];
}
function ideaIds(submissions) {
    const result = new Set();
    for (const submission of submissions)
        for (const idea of records(submission.structured.ideaIds)) {
            if (typeof idea.ideaId === 'string')
                result.add(idea.ideaId);
        }
    return result;
}
function sameMembers(left, right) {
    return left.length === right.length && left.every(value => right.includes(value));
}
function requireActualContributions(currentStepId, contributionStepId, accounts, priorSubmissions) {
    const contributors = new Set();
    for (const submission of priorSubmissions) {
        if (submission.stepId !== contributionStepId)
            continue;
        const declared = contributionStepId === '1-2-4-all-one'
            ? [submission.accountId]
            : strings(submission.structured.participantAccounts);
        for (const accountId of declared)
            contributors.add(accountId);
    }
    for (const accountId of accounts)
        if (!contributors.has(accountId)) {
            throw new Error(`${currentStepId} requires an actual ${contributionStepId} contribution from ${accountId}`);
        }
}
function validateIdeaLineage(structured, priorSubmissions) {
    const existing = ideaIds(priorSubmissions);
    const ideas = records(structured.ideaIds);
    const submitted = new Set();
    const linkedParents = new Set();
    for (const idea of ideas) {
        const id = typeof idea.ideaId === 'string' ? idea.ideaId : '';
        if (!id)
            continue; // The structural contract produces the precise shape error.
        if (existing.has(id) || submitted.has(id))
            throw new Error(`Idea ID ${id} already has an existing origin and may not be invented again`);
        submitted.add(id);
        if (idea.parentIdeaId !== undefined && (typeof idea.parentIdeaId !== 'string' || !existing.has(idea.parentIdeaId))) {
            throw new Error(`Idea ${id} must link to an existing parent idea origin`);
        }
        if (typeof idea.parentIdeaId === 'string')
            linkedParents.add(idea.parentIdeaId);
    }
    if (structured.parentIdeaIds !== undefined) {
        const declaredParents = new Set(strings(structured.parentIdeaIds));
        if (!sameMembers([...declaredParents], [...linkedParents]))
            throw new Error('Declared parent idea IDs must match the actual parent links');
        for (const parentId of declaredParents) {
            if (!existing.has(parentId))
                throw new Error(`Parent idea ${parentId} has no existing origin`);
        }
    }
}
function validateKjGroup(structured, priorSubmissions) {
    const collected = ideaIds(priorSubmissions.filter(item => item.stepId === 'affinity-kj-collect'));
    const assigned = new Set();
    for (const group of records(structured.groups))
        for (const member of strings(group.members)) {
            if (!collected.has(member))
                throw new Error(`Affinity member ${member} was not collected`);
            assigned.add(member); // Deliberately permits multi-membership across groups.
        }
    for (const member of strings(structured.unassignedIdeaIds)) {
        if (!collected.has(member))
            throw new Error(`Unassigned affinity member ${member} was not collected`);
        if (assigned.has(member))
            throw new Error(`Unassigned affinity member ${member} is already grouped`);
        assigned.add(member);
    }
    for (const member of collected)
        if (!assigned.has(member))
            throw new Error(`Affinity grouping must preserve collected member ${member} as grouped or unassigned`);
}
function validateKjNames(structured, priorSubmissions) {
    const groups = new Map();
    for (const submission of priorSubmissions)
        if (submission.stepId === 'affinity-kj-group')
            for (const group of records(submission.structured.groups)) {
                if (typeof group.id !== 'string')
                    continue;
                const members = strings(group.members);
                const existing = groups.get(group.id);
                if (existing && !sameMembers(existing, members))
                    throw new Error(`Affinity group ${group.id} has conflicting preserved members`);
                groups.set(group.id, members);
            }
    const named = new Set();
    for (const name of records(structured.names)) {
        if (typeof name.id !== 'string')
            continue;
        const expected = groups.get(name.id);
        if (!expected || !sameMembers(expected, strings(name.members)))
            throw new Error(`Affinity group ${name.id} must retain its collected members when named`);
        named.add(name.id);
    }
    for (const groupId of groups.keys())
        if (!named.has(groupId))
            throw new Error(`Affinity group ${groupId} must remain represented when named`);
}
function validateMindMapEdges(structured, priorSubmissions) {
    const nodes = new Set();
    for (const submission of priorSubmissions)
        if (submission.stepId === 'mind-map-branches')
            for (const node of records(submission.structured.mapNodes)) {
                if (typeof node.id === 'string')
                    nodes.add(node.id);
            }
    for (const edge of records(structured.mapEdges))
        for (const endpoint of [edge.fromId, edge.toId]) {
            if (typeof endpoint === 'string' && !nodes.has(endpoint))
                throw new Error(`Mind-map edge references unknown prior node ${endpoint}`);
        }
}
function freezeFingerprint(submission) {
    if (submission.stepId !== 'dot-voting-freeze')
        return undefined;
    const alternatives = records(submission.structured.alternatives)
        .map(item => typeof item.id === 'string' && typeof item.label === 'string' ? [item.id, item.label] : undefined);
    if (alternatives.some(item => !item))
        return undefined;
    return JSON.stringify({ alternatives, criteria: strings(submission.structured.criteria) });
}
function validateFrozenAlternatives(stepId, priorSubmissions) {
    const fingerprints = new Set();
    for (const submission of priorSubmissions) {
        const fingerprint = freezeFingerprint(submission);
        if (fingerprint)
            fingerprints.add(fingerprint);
    }
    if (stepId === 'dot-voting-vote' && !fingerprints.size)
        throw new Error('Dot voting requires one frozen alternative record');
    if (fingerprints.size > 1)
        throw new Error('Frozen alternatives conflict and cannot be changed or unioned silently');
}
export function validateWorkshopLineage(params) {
    const requiredPrerequisiteStepIds = workshopLineagePrerequisites(params.stepId);
    const bounded = new Set((params.prerequisiteCoverage || []).filter(item => !item.complete).map(item => item.stepId));
    const blocked = requiredPrerequisiteStepIds.filter(stepId => bounded.has(stepId));
    if (blocked.length)
        throw new Error(`Workshop lineage is bounded; scan required predecessor step IDs before validation: ${blocked.join(', ')}`);
    const priorSubmissions = params.priorSubmissions || [];
    if (params.stepId === 'brainwriting-independent' || params.stepId === 'brainwriting-build' || params.stepId.startsWith('scamper-')) {
        validateIdeaLineage(params.structured, priorSubmissions);
    }
    if (params.stepId === '1-2-4-all-two' || params.stepId === '1-2-4-all-four' || params.stepId === '1-2-4-all-all') {
        const accounts = strings(params.structured.participantAccounts);
        const previous = params.stepId === '1-2-4-all-two' ? '1-2-4-all-one'
            : params.stepId === '1-2-4-all-four' ? '1-2-4-all-two' : '1-2-4-all-four';
        requireActualContributions(params.stepId, previous, accounts, priorSubmissions);
    }
    if (params.stepId === 'affinity-kj-group')
        validateKjGroup(params.structured, priorSubmissions);
    if (params.stepId === 'affinity-kj-name')
        validateKjNames(params.structured, priorSubmissions);
    if (params.stepId === 'mind-map-crosslinks')
        validateMindMapEdges(params.structured, priorSubmissions);
    if (params.stepId === 'dot-voting-freeze' || params.stepId === 'dot-voting-vote')
        validateFrozenAlternatives(params.stepId, params.stepId === 'dot-voting-freeze' ? [...priorSubmissions, { accountId: 'candidate', stepId: params.stepId, structured: params.structured }] : priorSubmissions);
    return { requiredPrerequisiteStepIds };
}
