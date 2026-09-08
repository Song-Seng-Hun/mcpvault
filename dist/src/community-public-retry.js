import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { FrontmatterHandler } from './frontmatter.js';
import { isModerationHidden } from './moderation-policy.js';
import { participationPath } from './community-participation.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { matchesParticipationTopic } from './community-participation-candidates.js';
const REQUEST_FIELDS = [
    'community_request_id', 'community_request_actor', 'community_request_action',
    'community_request_key', 'community_request_payload', 'community_request_state',
];
const OMITTED_PAYLOAD_FIELDS = new Set(['accessToken', 'expectedRevision', 'prettyPrint', 'principal', 'requestId']);
const PARTICIPATION_PREFIX = 'participation-';
const PARTICIPATION_MAX_AGE_MS = 5 * 60_000;
const PARTICIPATION_READ_BYTES = 2_000_000;
const access = new ScopeAccessPolicy();
let coordinator = Promise.resolve();
const knownRequests = new WeakMap();
function ordered(value) {
    if (Array.isArray(value))
        return value.map(ordered);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value)
            .sort()
            .filter(key => value[key] !== undefined)
            .map(key => [key, ordered(value[key])]));
    }
    return value;
}
function publicPayload(value) {
    if (Array.isArray(value))
        return value.map(publicPayload);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value)
            .filter(key => !OMITTED_PAYLOAD_FIELDS.has(key) && value[key] !== undefined)
            .map(key => [key, publicPayload(value[key])]));
    }
    return value;
}
function fingerprint(value) {
    return createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
}
function requestId(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string')
        throw guidanceError(new Error('requestId must be a string'), 'guid-4919aa05eef6f675');
    const result = value.trim();
    if (!result)
        throw guidanceError(new Error('requestId is required when supplied'), 'guid-c31f1980d108900b');
    if (result.length > 128)
        throw guidanceError(new Error('requestId exceeds 128 characters'), 'guid-5735a3f85e1259e4');
    return result;
}
function visible(note) {
    return !isModerationHidden(note.frontmatter) && note.frontmatter.content_status !== 'deleted';
}
function requestState(frontmatter, content) {
    const state = { ...frontmatter };
    for (const field of REQUEST_FIELDS)
        delete state[field];
    return fingerprint({ frontmatter: state, content });
}
function revisionConflict(error) {
    return error instanceof Error && /revision conflict/i.test(error.message);
}
export function preparePublicCreateRequest(params) {
    const id = requestId(params.requestId);
    if (!id)
        return undefined;
    const action = String(params.action || '').trim();
    if (!action)
        throw guidanceError(new Error('A public create action is required'), 'guid-32f9b959f67637d0');
    const actorFingerprint = fingerprint({ accountId: params.principal.accountId });
    const keyFingerprint = fingerprint({ accountId: params.principal.accountId, requestId: id });
    const payloadFingerprint = fingerprint(publicPayload(params.payload));
    const targetId = params.requestedTargetId || `${params.generatedPrefix}-${fingerprint({ accountId: params.principal.accountId, action, requestId: id }).slice(0, 32)}`;
    return { requestId: id, action, actorFingerprint, keyFingerprint, payloadFingerprint, targetId };
}
export function attachPublicCreateRequest(request, frontmatter, content) {
    if (!request)
        return frontmatter;
    const metadata = {
        community_request_id: request.requestId,
        community_request_actor: request.actorFingerprint,
        community_request_action: request.action,
        community_request_key: request.keyFingerprint,
        community_request_payload: request.payloadFingerprint,
    };
    return { ...frontmatter, ...metadata, community_request_state: requestState({ ...frontmatter, ...metadata }, content) };
}
async function existingRequest(fileSystem, request, targetPath) {
    if (await fileSystem.noteExists(targetPath)) {
        const direct = await fileSystem.readNote(targetPath, 100_000);
        return verifyExistingRequest(direct, request, targetPath, targetPath);
    }
    const result = await fileSystem.queryNotes({
        pathPrefix: 'Community', filters: { community_request_key: request.keyFingerprint },
        limit: 2, includeContent: false, includeTotal: false,
    }, path => access.canAccessPhysicalPath(path));
    if (result.notes.length > 1)
        throw guidanceError(new Error('Public request receipt is ambiguous; operator review is required'), 'guid-10e033664ef18b3d');
    const match = result.notes[0];
    if (!match)
        return undefined;
    return verifyExistingRequest(await fileSystem.readNote(match.path, 100_000), request, targetPath, match.path);
}
function verifyExistingRequest(note, request, targetPath, actualPath) {
    const fm = note.frontmatter;
    if (fm.community_request_actor !== request.actorFingerprint
        || fm.community_request_id !== request.requestId
        || fm.community_request_action !== request.action
        || fm.community_request_payload !== request.payloadFingerprint
        || actualPath !== targetPath) {
        throw guidanceError(new Error('requestId was already used for a different public action or payload'), 'guid-afdd2c16aceac8d9');
    }
    if (!visible(note))
        throw guidanceError(new Error('Public request result is unavailable'), 'guid-503e43625954dd85');
    if (note.frontmatter.community_request_state !== requestState(note.frontmatter, note.content)
        || new FrontmatterHandler().stringify(note.frontmatter, note.content) !== note.originalContent) {
        throw guidanceError(new Error('Public request result changed after creation; reread current public state instead of replaying the mutation'), 'guid-99e31883517cb74f');
    }
    return note;
}
async function reserveParticipationAttempt(params) {
    if (!params.request.requestId.startsWith(PARTICIPATION_PREFIX))
        return undefined;
    const path = participationPath(params.principal);
    if (!access.canAccessPhysicalPath(path, params.principal) || !await params.fileSystem.noteExists(path)) {
        throw guidanceError(new Error('Matching active participation run is required for this publicRequestId'), 'guid-221dc07d94772392');
    }
    const note = await params.fileSystem.readNote(path, PARTICIPATION_READ_BYTES);
    const state = note.frontmatter.participation;
    const run = state?.activeRun;
    const settings = state?.settings;
    if (note.frontmatter.mcpvault_type !== 'community_participation' || state?.version !== 1 || !run || !settings) {
        throw guidanceError(new Error('Matching active participation run is required for this publicRequestId'), 'guid-221dc07d94772392');
    }
    if (run.publicRequestId !== params.request.requestId || !params.participationActions.includes(run.action)) {
        throw guidanceError(new Error('publicRequestId is not authorized for this public action'), 'guid-021b1608ef5f5fd6');
    }
    if (!Array.isArray(settings.allowedActions) || !settings.allowedActions.includes(run.action)
        || !Array.isArray(settings.allowedTopics) || !settings.allowedTopics.includes(run.topic)) {
        throw guidanceError(new Error('Participation action or topic is no longer authorized'), 'guid-6b79168d8238c3e2');
    }
    if (!settings.enabled || settings.paused || (settings.pauseUntil && Date.parse(settings.pauseUntil) > Date.now())
        || !Number.isFinite(Date.parse(run.startedAt)) || Date.now() - Date.parse(run.startedAt) >= PARTICIPATION_MAX_AGE_MS) {
        throw guidanceError(new Error('Participation run is paused or expired; reconcile it before another public write'), 'guid-5068a1672a7dd34c');
    }
    if (run.target?.path && !params.parentPaths.includes(run.target.path)) {
        throw guidanceError(new Error('Participation run target does not match this public action'), 'guid-ec6deb5f82c8cf10');
    }
    if (run.action === 'initiate') {
        if (!params.topicMetadata || !matchesParticipationTopic(params.topicMetadata, run.topic)) {
            throw guidanceError(new Error('Public creation metadata does not match the authorized participation topic'), 'guid-1a36909fedfbc832');
        }
    }
    else if (!run.target?.path) {
        let topicMatches = false;
        for (const parentPath of params.parentPaths) {
            const parent = await params.fileSystem.readNote(parentPath, 100_000);
            if (visible(parent) && matchesParticipationTopic(parent.frontmatter, run.topic)) {
                topicMatches = true;
                break;
            }
        }
        if (!topicMatches)
            throw guidanceError(new Error('Public response target does not match the authorized participation topic'), 'guid-c0ccb2e5faecf0d2');
    }
    const attempt = { operation: params.request.action, payloadHash: params.request.payloadFingerprint, path: params.targetPath };
    if (run.publicAttempt) {
        if (run.publicAttempt.operation !== attempt.operation || run.publicAttempt.payloadHash !== attempt.payloadHash || run.publicAttempt.path !== attempt.path) {
            throw guidanceError(new Error('publicRequestId was already reserved for a different public action or payload'), 'guid-395988ce48cade78');
        }
        return { path, expectedRevision: note.revision };
    }
    run.publicAttempt = attempt;
    const receipt = await params.fileSystem.writeNoteWithReceipt({
        path, content: note.content, frontmatter: note.frontmatter, expectedRevision: note.revision,
    }, {
        maxBytes: PARTICIPATION_READ_BYTES,
        assertAccess: () => {
            if (!access.canAccessPhysicalPath(path, params.principal))
                throw guidanceError(new Error('Participation unavailable'), 'guid-9753bb5370f0a467');
        },
    });
    return { path, expectedRevision: receipt.revision };
}
export async function runPublicCreate(params) {
    const execute = async () => {
        const validation = await params.revalidate();
        if (!params.request)
            return params.create();
        const remembered = knownRequests.get(params.fileSystem)?.get(params.request.keyFingerprint);
        if (remembered && (remembered.action !== params.request.action || remembered.payload !== params.request.payloadFingerprint || remembered.path !== params.targetPath)) {
            throw guidanceError(new Error('requestId was already used for a different public action or payload'), 'guid-afdd2c16aceac8d9');
        }
        const existing = await existingRequest(params.fileSystem, params.request, params.targetPath);
        if (existing) {
            const cache = knownRequests.get(params.fileSystem) || new Map();
            cache.set(params.request.keyFingerprint, { action: params.request.action, payload: params.request.payloadFingerprint, path: params.targetPath });
            knownRequests.set(params.fileSystem, cache);
            return params.replay(existing);
        }
        const participationGuard = await reserveParticipationAttempt({
            fileSystem: params.fileSystem, principal: params.principal, request: params.request,
            targetPath: params.targetPath, participationActions: params.participationActions,
            parentPaths: validation.parentPaths || [],
            ...(params.topicMetadata && { topicMetadata: params.topicMetadata }),
        });
        const cache = knownRequests.get(params.fileSystem) || new Map();
        cache.set(params.request.keyFingerprint, { action: params.request.action, payload: params.request.payloadFingerprint, path: params.targetPath });
        knownRequests.set(params.fileSystem, cache);
        try {
            return await params.create(participationGuard);
        }
        catch (error) {
            if (!revisionConflict(error)) {
                cache.delete(params.request.keyFingerprint);
                throw error;
            }
            const raced = await existingRequest(params.fileSystem, params.request, params.targetPath);
            if (!raced) {
                cache.delete(params.request.keyFingerprint);
                throw error;
            }
            return params.replay(raced);
        }
    };
    if (!params.request)
        return execute();
    const previous = coordinator;
    let release;
    coordinator = new Promise(resolve => { release = resolve; });
    await previous;
    try {
        return await execute();
    }
    finally {
        release();
    }
}
