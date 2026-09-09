import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
/** Story references are explicit vault-relative paths, not OS aliases. */
export function storyPath(value) {
    if (typeof value !== 'string' || !value || /[\0\r\n:]/.test(value))
        throw guidanceError(new Error('Invalid story path'), 'guid-2299689a2c78ffa7');
    const separated = value.replace(/\\/g, '/');
    if (separated.startsWith('/') || separated.split('/').some(part => part !== '.' && part !== '..' && /[. ]$/.test(part)))
        throw guidanceError(new Error('Invalid absolute or ambiguous story path'), 'guid-a07ae198de9cdc0b');
    const normalized = posix.normalize(separated);
    if (normalized === '..' || normalized.startsWith('../'))
        throw guidanceError(new Error('Story path traversal is not allowed'), 'guid-0497063b3c4246b0');
    return normalized;
}
export const STORY_KINDS = ['bible', 'character', 'place', 'outline', 'scene', 'shot', 'summary', 'alternative', 'rehearsal', 'branch_graph', 'visual_model'];
export const STORY_LAYERS = ['world_fact', 'belief', 'reader_reveal', 'author_plan'];
export const STORY_METHODS = [
    { id: 'snowflake', steps: ['premise', 'synopsis', 'characters', 'outline', 'scenes'], optional: true },
    { id: 'discovery', steps: ['free_draft', 'reverse_outline', 'structure_review', 'revision'], optional: true },
    { id: 'screenplay', steps: ['scene_purpose', 'opening_alternatives', 'blocking', 'dialogue', 'table_read'], optional: true },
    { id: 'interactive', steps: ['premise', 'choices', 'conditions_effects', 'path_test', 'revision'], optional: true },
];
export function storyId(value, field = 'id') {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value) || ['constructor', 'prototype', '__proto__'].includes(value))
        throw guidanceError(new Error(`Invalid story ${field}`), 'guid-9e4a0e979a52a008');
    return value;
}
export function storyAccount(value) {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) || ['constructor', 'prototype'].includes(value))
        throw guidanceError(new Error('Invalid story account'), 'guid-3713d4ee283d7504');
    return value;
}
export function storyText(value, field, max = 500, required = false) {
    if (typeof value !== 'string' || value.includes('\0') || Array.from(value).length > max || (required && !value.trim()))
        throw guidanceError(new Error(`${field} requires ${required ? '1' : '0'}..${max} Unicode characters`), 'guid-4e03244cd8af6884');
    return value;
}
export function storyObject(value, keys, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
        throw guidanceError(new Error(`Invalid ${field} field`), 'guid-6916f450b4345a98');
    return value;
}
export function storyList(value, field, max = 32) {
    if (!Array.isArray(value) || value.length > max)
        throw guidanceError(new Error(`${field} requires an array of at most ${max} entries`), 'guid-42775255e013dc58');
    return value;
}
export function storyIds(value, field, max = 100) {
    const ids = storyList(value, field, max).map(id => storyId(id, field));
    if (new Set(ids).size !== ids.length)
        throw guidanceError(new Error(`Duplicate ${field}`), 'guid-16f9f362c54e8592');
    return ids;
}
export function storyRevision(value, missing = false) {
    if (missing && value === 'missing')
        return value;
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
        throw guidanceError(new Error('Exact story revision required'), 'guid-2850972cf3cdf5d1');
    return value;
}
export function storyHash(value) {
    const order = (input) => Array.isArray(input) ? input.map(order) : input && typeof input === 'object'
        ? Object.fromEntries(Object.keys(input).sort().filter(k => input[k] !== undefined).map(k => [k, order(input[k])])) : input;
    return createHash('sha256').update(JSON.stringify(order(value))).digest('hex');
}
export const storyRoot = (projectId) => `Community/Stories/${storyId(projectId, 'projectId')}`;
export const storyProjectPath = (projectId) => `${storyRoot(projectId)}/Project.md`;
export const storyArtifactPath = (projectId, artifactId) => `${storyRoot(projectId)}/Artifacts/${storyId(artifactId, 'artifactId')}.md`;
export const storyReviewPath = (projectId, reviewId) => `${storyRoot(projectId)}/Reviews/${storyId(reviewId, 'reviewId')}.md`;
export function storyBrief(value) {
    const data = storyObject(value, ['medium', 'audience', 'genre', 'theme', 'style', 'targetLength', 'forbidden'], 'brief');
    if (!['novel', 'screenplay', 'interactive'].includes(data.medium))
        throw guidanceError(new Error('Invalid story medium'), 'guid-83ddae674d38649b');
    const result = { medium: data.medium };
    for (const key of ['audience', 'genre', 'theme', 'style', 'targetLength'])
        if (data[key] !== undefined)
            result[key] = storyText(data[key], `brief.${key}`, 1000);
    if (data.forbidden !== undefined)
        result.forbidden = storyList(data.forbidden, 'forbidden', 20).map(item => storyText(item, 'forbidden', 200, true));
    return result;
}
export function storySources(value) {
    return storyList(value ?? [], 'sources', 32).map(item => {
        const source = storyObject(item, ['artifactId', 'revision'], 'source');
        return { artifactId: storyId(source.artifactId, 'source.artifactId'), revision: storyRevision(source.revision) };
    });
}
/** Small optional scene/card metadata. Long prose lives in the Markdown body. */
export function storyData(value) {
    const data = storyObject(value ?? {}, ['purpose', 'pov', 'tension', 'startState', 'endState', 'reveal', 'targetLength', 'knownBy', 'layer',
        'setupIds', 'payoffIds', 'chronologyLabel', 'blocks', 'sourceSceneId', 'sourceSceneRevision', 'order', 'camera', 'action', 'dialogue', 'sound', 'durationSeconds', 'images', 'graph', 'visual', 'visualProposal'], 'artifact data');
    const result = {};
    for (const key of ['purpose', 'pov', 'tension', 'startState', 'endState', 'reveal', 'targetLength', 'chronologyLabel', 'camera', 'action', 'dialogue', 'sound']) {
        if (data[key] !== undefined)
            result[key] = storyText(data[key], key, 2000);
    }
    for (const key of ['knownBy', 'setupIds', 'payoffIds'])
        if (data[key] !== undefined)
            result[key] = storyIds(data[key], key, 32);
    if (data.layer !== undefined) {
        if (!STORY_LAYERS.includes(data.layer))
            throw guidanceError(new Error('Invalid story layer'), 'guid-1b0351dd2a19ca34');
        result.layer = data.layer;
    }
    if (data.sourceSceneId !== undefined)
        result.sourceSceneId = storyId(data.sourceSceneId);
    if (data.sourceSceneRevision !== undefined)
        result.sourceSceneRevision = storyRevision(data.sourceSceneRevision);
    for (const key of ['order', 'durationSeconds'])
        if (data[key] !== undefined) {
            if (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || data[key] < 0 || data[key] > 1_000_000)
                throw guidanceError(new Error(`Invalid ${key}`), 'guid-972520f95c9d5dbd');
            if (key === 'order' && !Number.isInteger(data[key]))
                throw guidanceError(new Error('Shot order must be an integer'), 'guid-f4713f8aededc77c');
            if (key === 'durationSeconds' && data[key] > 86400)
                throw guidanceError(new Error('Shot durationSeconds must not exceed 86400'), 'guid-afa75f2f9fd701cc');
            result[key] = data[key];
        }
    if (data.blocks !== undefined)
        result.blocks = storyList(data.blocks, 'blocks', 200).map(block => {
            const item = storyObject(block, ['type', 'text'], 'screenplay block');
            if (!['heading', 'action', 'character', 'dialogue', 'transition'].includes(item.type))
                throw guidanceError(new Error('Invalid screenplay block'), 'guid-7a93d787318585c6');
            return { type: item.type, text: storyText(item.text, 'block text', 8000, true) };
        });
    if (data.images !== undefined)
        result.images = storyList(data.images, 'images', 12).map(image => {
            const item = storyObject(image, ['path', 'revision'], 'image');
            return { path: storyText(item.path, 'image path', 500, true), ...(item.revision !== undefined && { revision: storyRevision(item.revision) }) };
        });
    // The branch module validates the full declarative schema before persistence.
    if (data.graph !== undefined)
        result.graph = structuredClone(data.graph);
    // Visual source/patch validation also needs the source bodies and runs in
    // the common artifact service, including direct artifact writes.
    for (const key of ['visual', 'visualProposal'])
        if (data[key] !== undefined)
            result[key] = structuredClone(data[key]);
    if (JSON.stringify(result).length > 64000)
        throw guidanceError(new Error('Story metadata exceeds 64000 characters'), 'guid-39b96262ec5a55cd');
    return result;
}
