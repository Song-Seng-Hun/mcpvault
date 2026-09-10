import { guidanceError, guidanceText } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { federationStorageName, ensureFederationDirectory, readFederationFile, writeFederationFileAtomic, removeFederationFile } from './public-federation-storage.js';
import { join, resolve } from 'node:path';
import { makePublicActorId, makePublicObjectId, validatePublicPublishInput, } from './public-federation.js';
import { PublicFederationClient } from './public-federation-http.js';
import { PublicFederationReplica } from './public-federation-replica.js';
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function sha256(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
function text(value, field) {
    const normalized = String(value ?? '').trim();
    if (!normalized)
        throw guidanceError(new Error(`${field} is required`), 'guid-0c6fd33ea1895f5e');
    return normalized;
}
function allowArgs(args, keys) {
    const allowed = {};
    for (const key of keys)
        if (args[key] !== undefined)
            allowed[key] = args[key];
    return allowed;
}
function assertExactKeys(value, keys, field) {
    const allowed = new Set(keys);
    const extra = Object.keys(value).find(key => !allowed.has(key));
    if (extra)
        throw guidanceError(new Error(`${field} contains unsupported field: ${extra}`), 'guid-62a6867d518c2c23');
}
function assertEnterpriseMentions(content) {
    const pattern = /(^|[^\w])@([a-z0-9][a-z0-9._:-]{0,191})\b/gi;
    for (const match of content.matchAll(pattern)) {
        if (!/^actor:[a-z0-9][a-z0-9._-]{0,127}:[a-z0-9][a-z0-9._-]{0,127}$/i.test(match[2])) {
            throw guidanceError(new Error('Enterprise mentions require an exact @actor:realm:agent ID; model names do not select a persistent agent'), 'guid-d6055bf1aadd9850');
        }
    }
}
function readBudget(value) {
    const max = value === undefined ? 6000 : Number(value);
    if (!Number.isSafeInteger(max) || max < 1 || max > 20000)
        throw guidanceError(new Error('maxChars must be an integer from 1 to 20000'), 'guid-94f925e74cea084a');
    return max;
}
const responseSize = (value, pretty) => JSON.stringify(value, null, pretty ? 2 : undefined).length;
function boundedRows(rows, limitValue, maxCharsValue, envelope, pretty) {
    const limit = Math.min(Math.max(Number(limitValue || 50), 1), 100);
    const maxChars = readBudget(maxCharsValue);
    for (let count = Math.min(limit, rows.length); count >= 0; count--) {
        const result = envelope(rows.slice(0, count), count < rows.length);
        if (responseSize(result, pretty) <= maxChars)
            return result;
    }
    throw guidanceError(new Error('maxChars cannot fit the federation response; increase the response budget'), 'guid-0a3bef85c2e19f5a');
}
const absent = (sync) => ({ found: false, absence: sync.state === 'caught_up' ? 'verified' : 'unverified', sync });
function boundedBody(body, maxChars, envelope, pretty) {
    const full = envelope(body, false);
    if (responseSize(full, pretty) <= maxChars)
        return full;
    let low = 0, high = body.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (responseSize(envelope(body.slice(0, middle), true), pretty) <= maxChars)
            low = middle;
        else
            high = middle - 1;
    }
    const result = envelope(body.slice(0, low), true);
    if (responseSize(result, pretty) > maxChars)
        throw guidanceError(new Error('maxChars cannot fit the federation response; increase the response budget'), 'guid-0a3bef85c2e19f5a');
    return result;
}
function boundedPost(post, maxValue, pretty) {
    const max = readBudget(maxValue ?? 12000), body = String(post.content || '');
    let base = post;
    if (responseSize({ ...post, content: '', truncated: true }, pretty) > max) {
        base = { path: post.path, revision: post.revision, fm: allowArgs(post.fm, ['mcpvault_type', 'post_id', 'author', 'title', 'status']),
            commentCount: post.commentCount, sync: post.sync, metadataOmitted: true,
            ...(post.federation && { federation: post.federation }), ...(post.comments && { commentsTruncated: true }) };
    }
    return boundedBody(body, max, (content, truncated) => ({ ...base, content, truncated: truncated || base !== post }), pretty);
}
function actorParts(actorId) {
    const match = actorId.match(/^actor:([a-z0-9][a-z0-9._-]{0,127}):([a-z0-9][a-z0-9._-]{0,127})$/);
    if (!match?.[1] || !match[2])
        throw guidanceError(new Error('a canonical public actor ID is required'), 'guid-05db64321958a5a2');
    return { origin: match[1], agentId: match[2] };
}
function objectIdFromActor(kind, actorId, localId) {
    const actor = actorParts(actorId);
    return makePublicObjectId(kind, actor.origin, actor.agentId, localId);
}
function intentMarkdown(intent) {
    return `---\nenterprise_federation_intent: true\nstage: ${intent.stage}\nactor_id: ${intent.actorId}\noperation: ${intent.operation}\n---\n# Federation delivery intent\n\n\`\`\`json enterprise-federation-intent\n${JSON.stringify(intent)}\n\`\`\`\n`;
}
function parseIntent(content) {
    if (Buffer.byteLength(content, 'utf8') > 128 * 1024)
        throw guidanceError(new Error('enterprise federation intent exceeds its size limit'), 'guid-5933be44d9f3a2ed');
    const match = content.match(/```json enterprise-federation-intent\r?\n([^\r\n]+)\r?\n```/);
    if (!match?.[1])
        throw guidanceError(new Error('enterprise federation intent is invalid'), 'guid-1200bd663a1a3c7d');
    const value = JSON.parse(match[1]);
    if (!isRecord(value) || value.version !== 1 || (value.stage !== 'prepared' && value.stage !== 'committed')
        || !['profile', 'post', 'delete-post', 'comment', 'edit-comment', 'delete-comment'].includes(String(value.operation)) || typeof value.id !== 'string' || value.id.length > 1024
        || typeof value.actorId !== 'string' || !isRecord(value.identity) || !isRecord(value.input)
        || typeof value.idempotencyKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.idempotencyKey)
        || !isRecord(value.local) || typeof value.createdAt !== 'string')
        throw guidanceError(new Error('enterprise federation intent fields are invalid'), 'guid-724040c02452f3fc');
    const identity = value.identity;
    if (typeof identity.origin !== 'string' || typeof identity.agentId !== 'string')
        throw guidanceError(new Error('enterprise federation intent identity is invalid'), 'guid-f4fe95d172025147');
    assertExactKeys(value, ['version', 'id', 'operation', 'actorId', 'identity', 'input', 'idempotencyKey', 'local', 'stage', 'createdAt'], 'enterprise federation intent');
    assertExactKeys(identity, ['origin', 'agentId'], 'enterprise federation intent identity');
    if (!Number.isFinite(Date.parse(value.createdAt)))
        throw guidanceError(new Error('enterprise federation intent timestamp is invalid'), 'guid-c67f639cc069dcfb');
    return value;
}
function federationRevision(input) {
    return input.expectedRevision + 1;
}
export class EnterpriseFederationAdapter {
    vaultPath;
    social;
    directory;
    config;
    statePath;
    intentsRoot;
    reader;
    publishers = new Map();
    state = { version: 1, revisions: {} };
    loaded = false;
    mutationTail = Promise.resolve();
    constructor(options) {
        this.vaultPath = resolve(options.vaultPath);
        this.social = options.social;
        this.directory = options.directory;
        this.config = options.config;
        this.statePath = join(this.vaultPath, '.mcpvault', 'public-federation', 'enterprise-state.json');
        this.intentsRoot = join(this.vaultPath, '.mcpvault', 'public-federation', 'enterprise-intents');
        const readerClient = new PublicFederationClient({ baseUrl: this.config.baseUrl });
        this.reader = new PublicFederationReplica({
            vaultPath: this.vaultPath,
            identity: { origin: 'federation-reader', agentId: 'reader' },
            client: readerClient,
            trustedHubPublicKey: this.config.trustedHubPublicKey,
            storageNamespace: 'host',
            manageLocalProjection: false,
        });
    }
    readBounded(path, maxBytes, label) {
        return readFederationFile(this.vaultPath, path, { maxBytes, label });
    }
    writeAtomic(path, content) {
        return writeFederationFileAtomic(this.vaultPath, path, content, { maxBytes: 2 * 1024 * 1024 });
    }
    async load() {
        if (this.loaded)
            return;
        try {
            const parsed = JSON.parse(await this.readBounded(this.statePath, 2 * 1024 * 1024, 'enterprise federation state'));
            if (parsed.version !== 1 || !isRecord(parsed.revisions) || Object.values(parsed.revisions).some(value => !Number.isSafeInteger(value) || Number(value) < 0)
                || (parsed.deliveries !== undefined && (!isRecord(parsed.deliveries) || Object.values(parsed.deliveries).some(value => value !== 'published' && value !== 'pending'))))
                throw guidanceError(new Error('enterprise federation state is invalid'), 'guid-3e228eb9c9363db6');
            this.state = parsed;
        }
        catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
                throw guidanceError(new Error('Enterprise federation state unavailable'), 'guid-6cb3d848338c51ec');
        }
        this.loaded = true;
    }
    async save() {
        await this.writeAtomic(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`);
    }
    async exclusive(task) {
        const previous = this.mutationTail;
        let release;
        this.mutationTail = new Promise(resolvePromise => { release = resolvePromise; });
        await previous;
        try {
            await this.load();
            return await task();
        }
        finally {
            release();
        }
    }
    authenticated(principal, capability) {
        if (!principal?.agentId || principal.enterprise?.mode !== 'public' || !principal.commandCenterId)
            throw guidanceError(new Error('an authenticated public enterprise agent is required'), 'guid-76d92532b8cdb041');
        if (principal.capabilities && !principal.capabilities.includes(capability))
            throw guidanceError(new Error(`${capability} capability is required`), 'guid-20e86a6fdd5901a1');
        const origin = principal.commandCenterId.toLowerCase();
        const agentId = principal.agentId.toLowerCase();
        if (!this.config.actors[agentId]?.authToken)
            throw guidanceError(new Error(`no public federation credential is configured for agent ${agentId}`), 'guid-19d5bcdd536f1787');
        const identity = { origin, agentId };
        return { principal: principal, identity, actorId: makePublicActorId(origin, agentId) };
    }
    publisher(identity) {
        const key = `${identity.origin}:${identity.agentId}`;
        let replica = this.publishers.get(key);
        if (!replica) {
            const credential = this.config.actors[identity.agentId]?.authToken;
            if (!credential)
                throw guidanceError(new Error(`no public federation credential is configured for agent ${identity.agentId}`), 'guid-19d5bcdd536f1787');
            replica = new PublicFederationReplica({
                vaultPath: this.vaultPath,
                identity,
                client: new PublicFederationClient({ baseUrl: this.config.baseUrl, authToken: credential }),
                trustedHubPublicKey: this.config.trustedHubPublicKey,
                storageNamespace: `actor-${federationStorageName(key)}`,
                manageLocalProjection: false,
            });
            this.publishers.set(key, replica);
        }
        return replica;
    }
    async ensureActor(identity, actorId) {
        await this.publisher(identity).publish({ type: 'actor', actorId, expectedRevision: 0 }, `actor-v1-${sha256(actorId).slice(0, 24)}`);
    }
    intentPath(intent) {
        return join(this.intentsRoot, federationStorageName(intent.actorId), `${sha256(intent.id)}.md`);
    }
    async prepareIntent(intent) {
        const value = { version: 1, stage: 'prepared', createdAt: new Date().toISOString(), ...intent };
        validatePublicPublishInput(value.input, value.identity);
        const path = this.intentPath(value);
        try {
            const existing = parseIntent(await this.readBounded(path, 128 * 1024, 'enterprise federation intent'));
            if (JSON.stringify(existing.input) !== JSON.stringify(value.input))
                throw guidanceError(new Error('bridge idempotency key is already used by another payload'), 'guid-904f66094e7c6011');
            return { value: existing, path };
        }
        catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
                throw error;
        }
        await this.writeAtomic(path, intentMarkdown(value));
        return { value, path };
    }
    async commitAndPublish(intent, path) {
        const committed = { ...intent, stage: 'committed' };
        await this.writeAtomic(path, intentMarkdown(committed));
        const result = await this.publisher(intent.identity).publish(intent.input, intent.idempotencyKey);
        const objectId = this.targetObjectId(intent.input);
        this.state.revisions[objectId] = federationRevision(intent.input);
        (this.state.deliveries ||= {})[objectId] = result.status;
        await this.save();
        await removeFederationFile(this.vaultPath, path);
        return result;
    }
    targetObjectId(input) {
        return input.type === 'profile' ? `profile:${input.actorId.slice('actor:'.length)}` : input.type === 'actor' ? input.actorId : input.type === 'update' || input.type === 'tombstone' ? input.targetObjectId : input.objectId;
    }
    expectedRevision(objectId) {
        return this.state.revisions[objectId] || 0;
    }
    mutationId(kind, identity, seed) {
        return makePublicObjectId(kind, identity.origin, identity.agentId, sha256(JSON.stringify(seed)).slice(0, 32));
    }
    async publishProfile(args, principalInput) {
        const { principal, identity, actorId } = this.authenticated(principalInput, 'profile');
        const localArgs = allowArgs(args, ['displayName', 'bio', 'interests', 'availability', 'expectedRevision']);
        await this.ensureActor(identity, actorId);
        const objectId = `profile:${identity.origin}:${identity.agentId}`;
        const expectedRevision = this.expectedRevision(objectId);
        const input = expectedRevision === 0
            ? { type: 'profile', actorId, expectedRevision: 0, displayName: text(localArgs.displayName ?? principal.agentId, 'displayName'), ...(localArgs.bio !== undefined && String(localArgs.bio).trim() && { bio: String(localArgs.bio).trim() }) }
            : { type: 'update', objectId: this.mutationId('update', identity, localArgs), actorId, targetObjectId: objectId, expectedRevision, displayName: text(localArgs.displayName ?? principal.agentId, 'displayName'), ...(localArgs.bio !== undefined && String(localArgs.bio).trim() && { bio: String(localArgs.bio).trim() }) };
        const id = `profile:${actorId}:${sha256(JSON.stringify(localArgs))}`;
        const prepared = await this.prepareIntent({ id, operation: 'profile', actorId, identity, input, idempotencyKey: sha256(id), local: { displayName: localArgs.displayName, bio: localArgs.bio, serviceArgs: localArgs } });
        let local;
        try {
            local = await this.directory.update({ ...localArgs, principal });
        }
        catch (error) {
            throw error;
        }
        const federation = await this.commitAndPublish(prepared.value, prepared.path);
        return { ...local, federation: { status: federation.status, objectId, revision: federationRevision(input) } };
    }
    async publishPost(args, principalInput) {
        const { principal, identity, actorId } = this.authenticated(principalInput, 'publish');
        const localArgs = allowArgs(args, ['slug', 'title', 'content', 'status', 'tags', 'category', 'seriesId', 'seriesTitle', 'seriesOrder', 'relatedPosts', 'duplicateOf', 'feedbackType', 'sourcePaths', 'reproduction', 'proposedChange', 'blockedTask', 'attempted', 'helpWanted', 'environment', 'expectedRevision', 'requestId']);
        if (localArgs.status !== undefined && String(localArgs.status).toLowerCase() !== 'published')
            throw guidanceError(new Error('draft and archived posts are local only and cannot enter public federation'), 'guid-ca6e7668da318029');
        await this.ensureActor(identity, actorId);
        const slug = text(localArgs.slug, 'slug').toLowerCase();
        const objectId = makePublicObjectId('post', identity.origin, identity.agentId, slug);
        const expectedRevision = this.expectedRevision(objectId);
        const creating = String(localArgs.expectedRevision || '') === 'missing';
        const requestId = creating ? String(localArgs.requestId || `federation-${sha256(`${actorId}:${slug}:${String(localArgs.title)}:${String(localArgs.content)}`).slice(0, 32)}`) : undefined;
        const input = creating
            ? { type: 'post', objectId, actorId, expectedRevision: 0, title: text(localArgs.title, 'title'), body: text(localArgs.content, 'content') }
            : { type: 'update', objectId: this.mutationId('update', identity, localArgs), actorId, targetObjectId: objectId, expectedRevision, title: text(localArgs.title, 'title'), body: text(localArgs.content, 'content') };
        const id = `post:${objectId}:${sha256(JSON.stringify(localArgs))}`;
        const serviceArgs = { ...localArgs, status: 'published', ...(requestId && { requestId }), principal };
        const prepared = await this.prepareIntent({ id, operation: 'post', actorId, identity, input, idempotencyKey: sha256(id), local: { slug, title: localArgs.title, content: localArgs.content, ...(requestId && { requestId }), serviceArgs: { ...localArgs, status: 'published', ...(requestId && { requestId }) } } });
        const local = await this.social.publishBlogPost(serviceArgs);
        const federation = await this.commitAndPublish(prepared.value, prepared.path);
        return { ...local, federation: { status: federation.status, objectId, revision: federationRevision(input) } };
    }
    async deletePost(args, principalInput) {
        const { principal, identity, actorId } = this.authenticated(principalInput, 'publish');
        const localArgs = allowArgs(args, ['slug', 'expectedRevision']);
        await this.ensureActor(identity, actorId);
        const slug = text(localArgs.slug, 'slug').toLowerCase();
        const objectId = makePublicObjectId('post', identity.origin, identity.agentId, slug);
        const expectedRevision = this.expectedRevision(objectId);
        if (!expectedRevision)
            throw guidanceError(new Error('post has no known public federation revision'), 'guid-08ae94ac48cb2ead');
        const input = { type: 'tombstone', objectId: this.mutationId('tombstone', identity, localArgs), actorId, targetObjectId: objectId, expectedRevision, reason: guidanceText('guid-a81a450688951826', 'Original author deleted the post.') };
        validatePublicPublishInput(input, identity);
        const id = `delete-post:${objectId}:${expectedRevision}`;
        const prepared = await this.prepareIntent({ id, operation: 'delete-post', actorId, identity, input, idempotencyKey: sha256(id), local: { serviceArgs: localArgs, slug } });
        const local = await this.social.deleteBlogPost({ ...localArgs, principal });
        const federation = await this.commitAndPublish(prepared.value, prepared.path);
        return { ...local, federation: { status: federation.status, objectId, revision: federationRevision(input) } };
    }
    async resolveLocalPostId(slug) {
        const post = await this.social.getBlogPost({ slug });
        return objectIdFromActor('post', text(post.fm.author, 'post author'), slug);
    }
    async publishComment(args, principalInput) {
        const { principal, identity, actorId } = this.authenticated(principalInput, 'comment');
        const localArgs = allowArgs(args, ['slug', 'content', 'replyTo', 'commentId', 'references', 'stance', 'requestId']);
        await this.ensureActor(identity, actorId);
        const slug = text(localArgs.slug, 'slug').toLowerCase();
        const remote = slug.startsWith('post:');
        const postId = remote ? slug : await this.resolveLocalPostId(slug);
        if (remote) {
            await this.reader.pull(100);
            const target = await this.reader.getObject(postId);
            if (!target || target.record.type !== 'post' || target.status !== 'active')
                throw guidanceError(new Error('remote public post is unavailable'), 'guid-fbdd70adbce5447f');
        }
        const body = text(localArgs.content, 'content');
        assertEnterpriseMentions(body);
        const requestId = String(localArgs.requestId || `federation-${sha256(`${actorId}:${postId}:${body}`).slice(0, 32)}`);
        const commentId = localArgs.commentId ? text(localArgs.commentId, 'commentId').toLowerCase() : `comment-${sha256(requestId).slice(0, 16)}`;
        const objectId = makePublicObjectId('comment', identity.origin, identity.agentId, commentId);
        let replyTo;
        if (localArgs.replyTo) {
            const raw = text(localArgs.replyTo, 'replyTo').toLowerCase();
            replyTo = raw.startsWith('comment:') ? raw : objectIdFromActor('comment', text((await this.social.getBlogComment({ slug, commentId: raw })).fm.author, 'comment author'), raw);
        }
        const input = { type: 'comment', objectId, actorId, expectedRevision: 0, postId, ...(replyTo && { replyTo }), body };
        validatePublicPublishInput(input, identity);
        const path = remote ? join(this.vaultPath, 'PublicCommunity', 'Local', 'FederatedComments', `${federationStorageName(objectId)}.md`) : undefined;
        const serviceArgs = { ...localArgs, commentId, requestId };
        const id = `comment:${objectId}:${sha256(JSON.stringify({ postId, replyTo, body }))}`;
        const prepared = await this.prepareIntent({ id, operation: 'comment', actorId, identity, input, idempotencyKey: sha256(id), local: { remote, ...(path && { path }), postId, objectId, body, serviceArgs } });
        let local;
        if (remote) {
            await this.writeAtomic(path, `---\nmcpvault_type: federated_comment\ncomment_id: ${objectId}\npost_id: ${postId}\nauthor: ${actorId}\n---\n${body}\n`);
            local = { success: true, commentId: objectId, postId, path: `PublicCommunity/Local/FederatedComments/${federationStorageName(objectId)}.md` };
        }
        else {
            local = await this.social.commentOnBlogPost({ ...serviceArgs, principal });
        }
        const federation = await this.commitAndPublish(prepared.value, prepared.path);
        return { ...local, federation: { status: federation.status, objectId, revision: 1 } };
    }
    async changeComment(args, principalInput, deletion) {
        const { principal, identity, actorId } = this.authenticated(principalInput, 'comment');
        const localArgs = allowArgs(args, deletion ? ['slug', 'commentId', 'expectedRevision'] : ['slug', 'commentId', 'content', 'references', 'stance', 'expectedRevision']);
        await this.ensureActor(identity, actorId);
        const slug = text(localArgs.slug, 'slug').toLowerCase();
        const rawCommentId = text(localArgs.commentId, 'commentId').toLowerCase();
        const remote = rawCommentId.startsWith('comment:');
        const targetObjectId = remote ? rawCommentId : makePublicObjectId('comment', identity.origin, identity.agentId, rawCommentId);
        const expectedRevision = this.expectedRevision(targetObjectId);
        if (!expectedRevision)
            throw guidanceError(new Error('comment has no known public federation revision'), 'guid-fa2d71041d844605');
        if (remote) {
            await this.reader.pull(100);
            const target = await this.reader.getObject(targetObjectId);
            if (!target || target.record.type !== 'comment' || target.record.actorId !== actorId || target.record.postId !== slug)
                throw guidanceError(new Error('remote public comment is unavailable or belongs to another actor'), 'guid-7f0746d8bbd1a793');
            if (String(localArgs.expectedRevision) !== String(target.revision) || target.revision !== expectedRevision)
                throw guidanceError(new Error('remote public comment revision conflict'), 'guid-dc19a1c902cd4f38');
        }
        const input = deletion
            ? { type: 'tombstone', objectId: this.mutationId('tombstone', identity, localArgs), actorId, targetObjectId, expectedRevision, reason: guidanceText('guid-ee215caa04f013e1', 'Original author deleted the comment.') }
            : { type: 'update', objectId: this.mutationId('update', identity, localArgs), actorId, targetObjectId, expectedRevision, body: text(localArgs.content, 'content') };
        if (!deletion)
            assertEnterpriseMentions(text(localArgs.content, 'content'));
        validatePublicPublishInput(input, identity);
        const path = remote ? join(this.vaultPath, 'PublicCommunity', 'Local', 'FederatedComments', `${federationStorageName(targetObjectId)}.md`) : undefined;
        const operation = deletion ? 'delete-comment' : 'edit-comment';
        const id = `${operation}:${targetObjectId}:${sha256(JSON.stringify(localArgs))}`;
        const prepared = await this.prepareIntent({ id, operation, actorId, identity, input, idempotencyKey: sha256(id), local: { remote, ...(path && { path }), targetObjectId, slug, serviceArgs: localArgs, ...(deletion ? {} : { body: text(localArgs.content, 'content') }) } });
        let local;
        if (remote) {
            await this.reader.pull(100);
            const target = await this.reader.getObject(targetObjectId);
            if (!target || target.record.type !== 'comment' || target.record.actorId !== actorId)
                throw guidanceError(new Error('remote public comment is unavailable or belongs to another actor'), 'guid-7f0746d8bbd1a793');
            const content = deletion ? 'Content deleted by its original author.' : text(localArgs.content, 'content');
            await this.writeAtomic(path, `---\nmcpvault_type: federated_comment\ncomment_id: ${targetObjectId}\npost_id: ${slug}\nauthor: ${actorId}\ncontent_status: ${deletion ? 'deleted' : 'published'}\n---\n${content}\n`);
            local = { success: true, commentId: targetObjectId, postId: slug, path: `PublicCommunity/Local/FederatedComments/${federationStorageName(targetObjectId)}.md`, ...(deletion && { deleted: true }) };
        }
        else if (deletion) {
            local = await this.social.deleteBlogComment({ ...localArgs, principal });
        }
        else {
            local = await this.social.editBlogComment({ ...localArgs, principal });
        }
        const federation = await this.commitAndPublish(prepared.value, prepared.path);
        return { ...local, federation: { status: federation.status, objectId: targetObjectId, revision: federationRevision(input) } };
    }
    async readSync() {
        try {
            const result = await this.reader.pull(100);
            const errors = result.errors.length > 0;
            return { state: errors ? 'unavailable' : result.hasMore ? 'partial' : 'caught_up', cursor: result.cursor,
                reasons: errors ? [result.errors.some(error => /^public federation feed (signature|cursor|does not continue|is out of order)/.test(error)) ? 'invalid_feed' : 'hub_unavailable']
                    : result.hasMore ? ['more_events'] : [] };
        }
        catch {
            let cursor;
            try {
                cursor = await this.reader.getCursor();
            }
            catch {
                throw guidanceError(new Error('Verified federation cache unavailable'), 'guid-f5ad58550b9dba89');
            }
            return { state: 'unavailable', cursor, reasons: ['cache_unavailable'] };
        }
    }
    async readLocalPost(args, principal, sync, federationId) {
        const local = await this.social.getBlogPost({ ...allowArgs(args, ['slug', 'includeComments', 'commentLimit', 'commentMaxChars', 'includeThreadContext']), ...(principal && { principal }) });
        const objectId = objectIdFromActor('post', String(local.fm.author), String(local.fm.post_id));
        const known = await this.reader.getObject(objectId, { includeUnavailable: true });
        if (known && known.status !== 'active')
            return absent(sync);
        return boundedPost({ ...local, sync, ...(federationId && { federation: { objectId: federationId,
                    status: this.state.deliveries?.[federationId] || 'pending', revision: this.state.revisions[federationId] || 0 } }) }, args.maxChars, args.prettyPrint);
    }
    async readFederatedPost(args, principal) {
        const slug = String(args.slug).toLowerCase();
        const sync = await this.readSync();
        const view = await this.reader.getObject(slug, { includeUnavailable: true });
        if (!view && principal?.agentId && principal.commandCenterId) {
            const prefix = `post:${principal.commandCenterId.toLowerCase()}:${principal.agentId.toLowerCase()}:`;
            if (slug.startsWith(prefix)) {
                return this.readLocalPost({ ...args, slug: slug.slice(prefix.length) }, principal, sync, slug);
            }
        }
        if (!view || view.record.type !== 'post' || view.status !== 'active')
            return absent(sync);
        return boundedPost({ path: `PublicCommunity/Imported/${view.origin}/Posts/${federationStorageName(view.objectId)}.md`, fm: { mcpvault_type: 'blog_post', post_id: view.objectId, author: view.record.actorId, title: view.record.title, status: 'published', federation_revision: view.revision }, content: view.record.body, revision: String(view.revision), commentCount: 0, sync }, args.maxChars, args.prettyPrint);
    }
    async listFederatedPosts(args, principal) {
        const sync = await this.readSync();
        const requestedLimit = Math.min(Math.max(Number(args.limit || 50), 1), 100);
        const localArgs = allowArgs(args, ['workflowStatus', 'author', 'category', 'seriesId', 'includeExcerpt', 'excerptMaxChars', 'maxChars']);
        const localResult = await this.social.listBlogPosts({ ...localArgs, ...(principal && { principal }), status: 'published', limit: requestedLimit });
        const localRows = (await Promise.all(localResult.posts.map(async (row) => {
            const localSlug = String(row.slug || '');
            const author = String(row.author || '');
            const objectId = objectIdFromActor('post', author, localSlug);
            const known = await this.reader.getObject(objectId, { includeUnavailable: true });
            if (known && known.status !== 'active')
                return undefined;
            return { ...row, federationObjectId: objectId, federationStatus: this.state.deliveries?.[objectId] || 'pending' };
        }))).filter((row) => row !== undefined);
        const listParams = { type: 'post', status: 'active', limit: 100 };
        if (args.authorOrigin)
            listParams.origin = String(args.authorOrigin);
        const result = await this.reader.listObjects(listParams);
        const remoteRows = result.objects.map(view => {
            const record = view.record;
            if (record.type !== 'post')
                throw guidanceError(new Error('public federation post view changed during listing'), 'guid-7d10adb3a7a4d5e3');
            return { path: `PublicCommunity/Imported/${view.origin}/Posts/${federationStorageName(view.objectId)}.md`, slug: view.objectId, title: record.title, author: record.actorId, status: 'published', federationRevision: view.revision, federationStatus: 'published' };
        });
        const localIds = new Set(localRows.map(row => String(row.federationObjectId)));
        const combined = [...localRows, ...remoteRows.filter(row => !localIds.has(row.slug))];
        return boundedRows(combined, requestedLimit, args.maxChars, (posts, truncated) => ({ posts, total: combined.length, truncated: truncated || result.truncated || localResult.truncated, sync }), args.prettyPrint);
    }
    async listFederatedComments(args) {
        const slug = text(args.slug, 'slug').toLowerCase();
        const postId = slug.startsWith('post:') ? slug : await this.resolveLocalPostId(slug);
        const maxChars = readBudget(args.maxChars), sync = await this.readSync();
        const after = typeof args.afterCommentId === 'string' ? args.afterCommentId : undefined;
        const result = await this.reader.listObjects({ type: 'comment', status: 'active', postId, limit: 100,
            ...(after && { after, contextBefore: Math.min(Math.max(Number(args.contextBefore ?? 2), 1), 20) }) });
        const limit = Math.min(Math.max(Number(args.limit || 20), 1), 100);
        const comments = result.objects.map(view => {
            const record = view.record;
            if (record.type !== 'comment')
                throw guidanceError(new Error('public federation comment view changed during listing'), 'guid-75ba010aa0dabdfb');
            return { commentId: view.objectId, postId: record.postId, content: record.body, author: record.actorId, replyTo: record.replyTo, federationRevision: view.revision };
        });
        const overlap = comments.slice(0, result.contextBefore), fresh = comments.slice(result.contextBefore);
        const envelope = (count, contextCount) => {
            const rows = fresh.slice(0, count), truncated = count < fresh.length || result.truncated;
            const nextCursor = rows.at(-1)?.commentId || after;
            const retry = truncated && count === 0;
            return { comments: [...overlap.slice(overlap.length - contextCount), ...rows], total: result.total, contextBefore: contextCount,
                truncated, ...(nextCursor && { nextCursor }), sync, ...(retry && { reason: 'budget_exhausted' }),
                ...(truncated && { nextAction: { endpointId: 'community.comments', arguments: { slug, limit,
                            maxChars: retry ? Math.min(20000, Math.max(1024, maxChars * 2)) : maxChars,
                            ...(nextCursor && { afterCommentId: nextCursor }), contextBefore: retry ? 1 : Number(args.contextBefore ?? 2),
                            ...(Boolean(args.prettyPrint) && { prettyPrint: true }) } } }) };
        };
        // Admit new comments first. Overlap may shrink, but can never consume the
        // whole budget while pretending to advance through unread comments.
        for (let count = Math.min(limit, fresh.length); count >= 0; count--) {
            for (let contextCount = count > 0 || fresh.length === 0 ? overlap.length : 0; contextCount >= 0; contextCount--) {
                const response = envelope(count, contextCount);
                if (responseSize(response, args.prettyPrint) <= maxChars) {
                    if (count === 0 && fresh.length > 0 && maxChars === 20000) {
                        const first = fresh[0], target = await this.reader.getImportedReadTarget(first.commentId, first.federationRevision);
                        const diagnostic = { ...response, reason: 'oversized_item',
                            nextAction: { endpointId: 'mcp.read_note_lines', arguments: { path: target.path, expectedRevision: target.revision,
                                    startLine: 1, endLine: target.totalLines, maxChars: 12000 } },
                            continuationAfterRead: { endpointId: 'community.comments', arguments: { slug, afterCommentId: first.commentId,
                                    contextBefore: 1, limit, maxChars, ...(Boolean(args.prettyPrint) && { prettyPrint: true }) } } };
                        if (responseSize(diagnostic, args.prettyPrint) <= maxChars)
                            return diagnostic;
                        break;
                    }
                    return response;
                }
            }
        }
        throw guidanceError(new Error('maxChars cannot fit the federation response; increase the response budget'), 'guid-0a3bef85c2e19f5a');
    }
    async getFederatedProfile(actorId) {
        actorParts(actorId);
        const sync = await this.readSync();
        const view = await this.reader.getObject(`profile:${actorId.slice('actor:'.length)}`);
        if (!view || view.record.type !== 'profile')
            return absent(sync);
        return { success: true, profile: { identity: actorId, role: 'agent', actorId, displayName: view.record.displayName, bio: view.record.bio || '', origin: view.origin, federationRevision: view.revision }, sync };
    }
    async getLocalProfile(args) {
        const sync = await this.readSync();
        const local = await this.directory.get({ role: String(args.role || ''), identity: String(args.identity || '') });
        const actorId = local.profile.actorId;
        if (typeof actorId === 'string') {
            actorParts(actorId);
            const known = await this.reader.getObject(`profile:${actorId.slice('actor:'.length)}`, { includeUnavailable: true });
            if (known && known.status !== 'active')
                return absent(sync);
        }
        return { ...local, sync };
    }
    async listFederatedProfiles(args) {
        const sync = await this.readSync();
        const result = await this.reader.listObjects({ type: 'profile', status: 'active', limit: 100 });
        const rows = result.objects.map(view => {
            if (view.record.type !== 'profile')
                throw guidanceError(new Error('public federation profile view changed during listing'), 'guid-923455edfe152d14');
            return { identity: view.record.actorId, role: 'agent', actorId: view.record.actorId, displayName: view.record.displayName, bio: view.record.bio || '', origin: view.origin, federationRevision: view.revision };
        });
        return boundedRows(rows, args.limit, args.maxChars, (profiles, truncated) => ({ profiles, total: result.total, truncated: truncated || result.truncated, sync }), args.prettyPrint);
    }
    async localMatches(intent, principal) {
        try {
            if (intent.operation === 'post') {
                if (isRecord(intent.local.serviceArgs) && typeof intent.local.requestId === 'string') {
                    await this.social.publishBlogPost({ ...intent.local.serviceArgs, principal });
                    return true;
                }
                const post = await this.social.getBlogPost({ principal, slug: String(intent.local.slug) });
                return post.fm.author === intent.actorId && post.fm.title === intent.local.title && post.content.trim() === String(intent.local.content).trim();
            }
            if (intent.operation === 'profile') {
                const profile = await this.directory.get({ role: principal.role, identity: principal.agentId || principal.modelId });
                const publicProfile = profile.profile;
                return publicProfile.actorId === intent.actorId && publicProfile.displayName === intent.local.displayName && String(publicProfile.bio || '') === String(intent.local.bio || '');
            }
            if (intent.operation === 'delete-post') {
                const post = await this.social.getBlogPost({ principal, slug: String(intent.local.slug) });
                return post.fm.author === intent.actorId && post.fm.content_status === 'deleted';
            }
            if (intent.local.remote === true) {
                const content = await this.readBounded(String(intent.local.path), 128 * 1024, 'local federated comment');
                if (!content.includes(`author: ${intent.actorId}`))
                    return false;
                return intent.operation === 'delete-comment'
                    ? content.includes('content_status: deleted')
                    : content.trim().endsWith(String(intent.local.body || '').trim());
            }
            if (intent.operation === 'comment') {
                const serviceArgs = intent.local.serviceArgs;
                await this.social.commentOnBlogPost({ ...serviceArgs, principal });
                return true;
            }
            const serviceArgs = intent.local.serviceArgs;
            const comment = await this.social.getBlogComment({ principal, slug: String(serviceArgs.slug), commentId: String(serviceArgs.commentId) });
            return intent.operation === 'delete-comment'
                ? comment.fm.content_status === 'deleted'
                : comment.content.trim() === String(intent.local.body || '').trim();
        }
        catch {
            return false;
        }
    }
    async performIntentLocal(intent, principal) {
        const serviceArgs = isRecord(intent.local.serviceArgs) ? intent.local.serviceArgs : {};
        if (intent.operation === 'profile') {
            await this.directory.update({ ...serviceArgs, principal });
        }
        else if (intent.operation === 'post') {
            await this.social.publishBlogPost({ ...serviceArgs, principal });
        }
        else if (intent.operation === 'delete-post') {
            await this.social.deleteBlogPost({ ...serviceArgs, principal });
        }
        else if (intent.local.remote === true) {
            const deletion = intent.operation === 'delete-comment';
            const content = deletion ? 'Content deleted by its original author.' : String(intent.local.body || '');
            await this.writeAtomic(String(intent.local.path), `---\nmcpvault_type: federated_comment\ncomment_id: ${String(intent.local.targetObjectId || intent.local.objectId)}\npost_id: ${String(intent.local.slug || intent.local.postId)}\nauthor: ${intent.actorId}\ncontent_status: ${deletion ? 'deleted' : 'published'}\n---\n${content}\n`);
        }
        else if (intent.operation === 'comment') {
            await this.social.commentOnBlogPost({ ...serviceArgs, principal });
        }
        else if (intent.operation === 'edit-comment') {
            await this.social.editBlogComment({ ...serviceArgs, principal });
        }
        else {
            await this.social.deleteBlogComment({ ...serviceArgs, principal });
        }
    }
    async retry(principalInput) {
        const { principal, identity, actorId } = this.authenticated(principalInput, 'publish');
        await this.ensureActor(identity, actorId);
        const root = join(this.intentsRoot, federationStorageName(actorId));
        await ensureFederationDirectory(this.vaultPath, root);
        const names = await readdir(root).catch(error => {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
                return [];
            throw error;
        });
        if (names.length > 500)
            throw guidanceError(new Error('enterprise federation intent queue exceeds its bounded recovery limit'), 'guid-390e2f9a2bdd2596');
        const recovered = [];
        const unresolved = [];
        for (const name of names.filter(name => name.endsWith('.md')).sort()) {
            const path = join(root, name);
            const intent = parseIntent(await this.readBounded(path, 128 * 1024, 'enterprise federation intent'));
            if (intent.actorId !== actorId || intent.identity.origin !== identity.origin || intent.identity.agentId !== identity.agentId)
                throw guidanceError(new Error('federation intent identity mismatch'), 'guid-01c8d4c598af46b4');
            validatePublicPublishInput(intent.input, intent.identity);
            if (intent.stage === 'prepared' && !await this.localMatches(intent, principal)) {
                try {
                    await this.performIntentLocal(intent, principal);
                }
                catch {
                    unresolved.push(this.targetObjectId(intent.input));
                    break;
                }
            }
            const result = await this.commitAndPublish(intent, path);
            if (result.status === 'published')
                recovered.push(this.targetObjectId(intent.input));
            else {
                unresolved.push(this.targetObjectId(intent.input));
                break;
            }
        }
        const outbox = await this.publisher(identity).flushOutbox();
        for (const objectId of outbox.published)
            (this.state.deliveries ||= {})[objectId] = 'published';
        for (const objectId of outbox.pending)
            (this.state.deliveries ||= {})[objectId] = 'pending';
        if (outbox.published.length || outbox.pending.length)
            await this.save();
        return { recovered: [...recovered, ...outbox.published], pending: [...unresolved, ...outbox.pending], rejected: outbox.rejected };
    }
    async dispatch(name, argsInput, principal) {
        const args = isRecord(argsInput) ? argsInput : {};
        return this.exclusive(async () => {
            switch (name) {
                case 'update_agent_profile': return this.publishProfile(args, principal);
                case 'publish_blog_post': return this.publishPost(args, principal);
                case 'delete_blog_post': return this.deletePost(args, principal);
                case 'comment_on_blog_post': return this.publishComment(args, principal);
                case 'edit_blog_comment': return this.changeComment(args, principal, false);
                case 'delete_blog_comment': return this.changeComment(args, principal, true);
                case 'public_federation_pull': return this.reader.pull(Number(args.limit || 100));
                case 'public_federation_retry': return this.retry(principal);
                case 'public_federation_get': {
                    const sync = await this.readSync();
                    const view = await this.reader.getObject(text(args.objectId, 'objectId').toLowerCase());
                    const maxChars = readBudget(args.maxChars);
                    if (!view) {
                        const result = absent(sync);
                        if (responseSize(result, args.prettyPrint) > maxChars)
                            throw guidanceError(new Error('maxChars cannot fit the federation response; increase the response budget'), 'guid-0a3bef85c2e19f5a');
                        return result;
                    }
                    if ('body' in view.record)
                        return boundedBody(view.record.body, maxChars, (body, truncated) => ({ ...view, record: { ...view.record, body }, truncated, sync }), args.prettyPrint);
                    const result = { ...view, truncated: false, sync };
                    if (responseSize(result, args.prettyPrint) > maxChars)
                        throw guidanceError(new Error('maxChars cannot fit the federation response; increase the response budget'), 'guid-0a3bef85c2e19f5a');
                    return result;
                }
                case 'public_federation_list': {
                    const sync = await this.readSync();
                    const params = { status: 'active', includeUnavailable: false };
                    if (['actor', 'profile', 'post', 'comment'].includes(String(args.type)))
                        params.type = args.type;
                    if (args.origin !== undefined)
                        params.origin = String(args.origin);
                    if (args.postId !== undefined)
                        params.postId = String(args.postId);
                    params.limit = Math.min(Math.max(Number(args.limit || 50), 1), 100);
                    if (args.after !== undefined)
                        params.after = String(args.after);
                    const result = await this.reader.listObjects(params);
                    const summaries = result.objects.map(view => ({ objectId: view.objectId, origin: view.origin, revision: view.revision, status: view.status, type: view.record.type, actorId: view.record.actorId,
                        ...(view.record.type === 'post' && { title: view.record.title }), ...(view.record.type === 'profile' && { displayName: view.record.displayName }) }));
                    return boundedRows(summaries, params.limit, args.maxChars, (objects, truncated) => ({ objects, sync,
                        truncated: truncated || result.truncated, ...((truncated || result.truncated) && objects.length > 0 && { nextCursor: objects.at(-1).objectId }) }), args.prettyPrint);
                }
                case 'list_blog_posts': return this.listFederatedPosts(args, principal);
                case 'read_blog_post':
                case 'get_blog_post': return String(args.slug || '').startsWith('post:') ? this.readFederatedPost(args, principal)
                    : this.readLocalPost(args, principal, await this.readSync());
                case 'list_blog_comments': return this.listFederatedComments(args);
                case 'get_agent_profile': return String(args.identity || '').startsWith('actor:') ? this.getFederatedProfile(String(args.identity).toLowerCase())
                    : this.getLocalProfile(args);
                case 'list_agent_profiles':
                case 'list_agents': return this.listFederatedProfiles(args);
                default: throw guidanceError(new Error(`unsupported enterprise federation operation: ${name}`), 'guid-b3545e8027ee3b60');
            }
        });
    }
}
