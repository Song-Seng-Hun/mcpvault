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
        throw new Error(`${field} is required`);
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
        throw new Error(`${field} contains unsupported field: ${extra}`);
}
function assertEnterpriseMentions(content) {
    const pattern = /(^|[^\w])@([a-z0-9][a-z0-9._:-]{0,191})\b/gi;
    for (const match of content.matchAll(pattern)) {
        if (!/^actor:[a-z0-9][a-z0-9._-]{0,127}:[a-z0-9][a-z0-9._-]{0,127}$/i.test(match[2])) {
            throw new Error('Enterprise mentions require an exact @actor:realm:agent ID; model names do not select a persistent agent');
        }
    }
}
function boundedRows(rows, limitValue, maxCharsValue) {
    const limit = Math.min(Math.max(Number(limitValue || 50), 1), 100);
    const maxChars = Math.min(Math.max(Number(maxCharsValue || 6000), 512), 20_000);
    const selected = [];
    let used = 0;
    for (const row of rows.slice(0, limit)) {
        const length = JSON.stringify(row).length;
        if (used + length > maxChars)
            break;
        selected.push(row);
        used += length;
    }
    return { rows: selected, truncated: selected.length < rows.length };
}
function actorParts(actorId) {
    const match = actorId.match(/^actor:([a-z0-9][a-z0-9._-]{0,127}):([a-z0-9][a-z0-9._-]{0,127})$/);
    if (!match?.[1] || !match[2])
        throw new Error('a canonical public actor ID is required');
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
        throw new Error('enterprise federation intent exceeds its size limit');
    const match = content.match(/```json enterprise-federation-intent\r?\n([^\r\n]+)\r?\n```/);
    if (!match?.[1])
        throw new Error('enterprise federation intent is invalid');
    const value = JSON.parse(match[1]);
    if (!isRecord(value) || value.version !== 1 || (value.stage !== 'prepared' && value.stage !== 'committed')
        || !['profile', 'post', 'delete-post', 'comment', 'edit-comment', 'delete-comment'].includes(String(value.operation)) || typeof value.id !== 'string' || value.id.length > 1024
        || typeof value.actorId !== 'string' || !isRecord(value.identity) || !isRecord(value.input)
        || typeof value.idempotencyKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.idempotencyKey)
        || !isRecord(value.local) || typeof value.createdAt !== 'string')
        throw new Error('enterprise federation intent fields are invalid');
    const identity = value.identity;
    if (typeof identity.origin !== 'string' || typeof identity.agentId !== 'string')
        throw new Error('enterprise federation intent identity is invalid');
    assertExactKeys(value, ['version', 'id', 'operation', 'actorId', 'identity', 'input', 'idempotencyKey', 'local', 'stage', 'createdAt'], 'enterprise federation intent');
    assertExactKeys(identity, ['origin', 'agentId'], 'enterprise federation intent identity');
    if (!Number.isFinite(Date.parse(value.createdAt)))
        throw new Error('enterprise federation intent timestamp is invalid');
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
                throw new Error('enterprise federation state is invalid');
            this.state = parsed;
        }
        catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
                throw error;
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
            throw new Error('an authenticated public enterprise agent is required');
        if (principal.capabilities && !principal.capabilities.includes(capability))
            throw new Error(`${capability} capability is required`);
        const origin = principal.commandCenterId.toLowerCase();
        const agentId = principal.agentId.toLowerCase();
        if (!this.config.actors[agentId]?.authToken)
            throw new Error(`no public federation credential is configured for agent ${agentId}`);
        const identity = { origin, agentId };
        return { principal: principal, identity, actorId: makePublicActorId(origin, agentId) };
    }
    publisher(identity) {
        const key = `${identity.origin}:${identity.agentId}`;
        let replica = this.publishers.get(key);
        if (!replica) {
            const credential = this.config.actors[identity.agentId]?.authToken;
            if (!credential)
                throw new Error(`no public federation credential is configured for agent ${identity.agentId}`);
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
                throw new Error('bridge idempotency key is already used by another payload');
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
            throw new Error('draft and archived posts are local only and cannot enter public federation');
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
            throw new Error('post has no known public federation revision');
        const input = { type: 'tombstone', objectId: this.mutationId('tombstone', identity, localArgs), actorId, targetObjectId: objectId, expectedRevision, reason: 'Original author deleted the post.' };
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
                throw new Error('remote public post is unavailable');
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
            throw new Error('comment has no known public federation revision');
        if (remote) {
            await this.reader.pull(100);
            const target = await this.reader.getObject(targetObjectId);
            if (!target || target.record.type !== 'comment' || target.record.actorId !== actorId || target.record.postId !== slug)
                throw new Error('remote public comment is unavailable or belongs to another actor');
            if (String(localArgs.expectedRevision) !== String(target.revision) || target.revision !== expectedRevision)
                throw new Error('remote public comment revision conflict');
        }
        const input = deletion
            ? { type: 'tombstone', objectId: this.mutationId('tombstone', identity, localArgs), actorId, targetObjectId, expectedRevision, reason: 'Original author deleted the comment.' }
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
                throw new Error('remote public comment is unavailable or belongs to another actor');
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
    async readFederatedPost(slug, principal) {
        await this.reader.pull(100);
        const view = await this.reader.getObject(slug);
        if (!view && principal?.agentId && principal.commandCenterId) {
            const prefix = `post:${principal.commandCenterId.toLowerCase()}:${principal.agentId.toLowerCase()}:`;
            if (slug.startsWith(prefix)) {
                const local = await this.social.getBlogPost({ principal, slug: slug.slice(prefix.length) });
                return { ...local, federation: { objectId: slug, status: this.state.deliveries?.[slug] || 'pending', revision: this.state.revisions[slug] || 0 } };
            }
        }
        if (!view || view.record.type !== 'post' || view.status !== 'active')
            throw new Error('federated public post not found');
        return { path: `PublicCommunity/Imported/${view.origin}/Posts/${federationStorageName(view.objectId)}.md`, fm: { mcpvault_type: 'blog_post', post_id: view.objectId, author: view.record.actorId, title: view.record.title, status: 'published', federation_revision: view.revision }, content: view.record.body, revision: String(view.revision), commentCount: 0 };
    }
    async listFederatedPosts(args, principal) {
        await this.reader.pull(100);
        const requestedLimit = Math.min(Math.max(Number(args.limit || 50), 1), 100);
        const localArgs = allowArgs(args, ['workflowStatus', 'author', 'category', 'seriesId', 'includeExcerpt', 'excerptMaxChars', 'maxChars']);
        const localResult = await this.social.listBlogPosts({ ...localArgs, ...(principal && { principal }), status: 'published', limit: requestedLimit });
        const localRows = localResult.posts.map(row => {
            const localSlug = String(row.slug || '');
            const author = String(row.author || '');
            const objectId = objectIdFromActor('post', author, localSlug);
            return { ...row, federationObjectId: objectId, federationStatus: this.state.deliveries?.[objectId] || 'pending' };
        });
        const listParams = { type: 'post', status: 'active', limit: 100 };
        if (args.authorOrigin)
            listParams.origin = String(args.authorOrigin);
        const result = await this.reader.listObjects(listParams);
        const remoteRows = result.objects.map(view => {
            const record = view.record;
            if (record.type !== 'post')
                throw new Error('public federation post view changed during listing');
            return { path: `PublicCommunity/Imported/${view.origin}/Posts/${federationStorageName(view.objectId)}.md`, slug: view.objectId, title: record.title, author: record.actorId, status: 'published', federationRevision: view.revision, federationStatus: 'published' };
        });
        const localIds = new Set(localRows.map(row => String(row.federationObjectId)));
        const combined = [...localRows, ...remoteRows.filter(row => !localIds.has(row.slug))];
        const bounded = boundedRows(combined, requestedLimit, args.maxChars);
        return { posts: bounded.rows, total: combined.length, truncated: bounded.truncated || result.truncated || localResult.truncated };
    }
    async listFederatedComments(args) {
        const slug = text(args.slug, 'slug').toLowerCase();
        const postId = slug.startsWith('post:') ? slug : await this.resolveLocalPostId(slug);
        await this.reader.pull(100);
        const result = await this.reader.listObjects({ type: 'comment', status: 'active', postId, limit: 100, ...(typeof args.after === 'string' && { after: args.after }) });
        const limit = Math.min(Math.max(Number(args.limit || 20), 1), 100);
        const all = result.objects.filter(view => view.record.type === 'comment' && view.record.postId === postId);
        const comments = all.slice(0, limit).map(view => {
            const record = view.record;
            if (record.type !== 'comment')
                throw new Error('public federation comment view changed during listing');
            return { commentId: view.objectId, postId: record.postId, content: record.body, author: record.actorId, replyTo: record.replyTo, federationRevision: view.revision };
        });
        const bounded = boundedRows(comments, limit, args.maxChars);
        return { comments: bounded.rows, total: all.length, truncated: bounded.truncated || result.truncated };
    }
    async getFederatedProfile(actorId) {
        actorParts(actorId);
        await this.reader.pull(100);
        const view = await this.reader.getObject(`profile:${actorId.slice('actor:'.length)}`);
        if (!view || view.record.type !== 'profile')
            throw new Error('federated public profile not found');
        return { success: true, profile: { identity: actorId, role: 'agent', actorId, displayName: view.record.displayName, bio: view.record.bio || '', origin: view.origin, federationRevision: view.revision } };
    }
    async listFederatedProfiles(args) {
        await this.reader.pull(100);
        const result = await this.reader.listObjects({ type: 'profile', status: 'active', limit: 100 });
        const rows = result.objects.map(view => {
            if (view.record.type !== 'profile')
                throw new Error('public federation profile view changed during listing');
            return { identity: view.record.actorId, role: 'agent', actorId: view.record.actorId, displayName: view.record.displayName, bio: view.record.bio || '', origin: view.origin, federationRevision: view.revision };
        });
        const bounded = boundedRows(rows, args.limit, args.maxChars);
        return { profiles: bounded.rows, total: rows.length, truncated: bounded.truncated || result.truncated };
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
            throw new Error('enterprise federation intent queue exceeds its bounded recovery limit');
        const recovered = [];
        const unresolved = [];
        for (const name of names.filter(name => name.endsWith('.md')).sort()) {
            const path = join(root, name);
            const intent = parseIntent(await this.readBounded(path, 128 * 1024, 'enterprise federation intent'));
            if (intent.actorId !== actorId || intent.identity.origin !== identity.origin || intent.identity.agentId !== identity.agentId)
                throw new Error('federation intent identity mismatch');
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
                    await this.reader.pull(100);
                    const view = await this.reader.getObject(text(args.objectId, 'objectId').toLowerCase());
                    if (!view)
                        return undefined;
                    const maxChars = Math.min(Math.max(Number(args.maxChars || 6000), 512), 20_000);
                    const record = view.record.type === 'post' || view.record.type === 'comment'
                        ? { ...view.record, body: view.record.body.slice(0, maxChars) }
                        : view.record;
                    return { ...view, record, truncated: (view.record.type === 'post' || view.record.type === 'comment') && view.record.body.length > maxChars };
                }
                case 'public_federation_list': {
                    await this.reader.pull(100);
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
                    const bounded = boundedRows(summaries, params.limit, args.maxChars);
                    return { objects: bounded.rows, truncated: bounded.truncated || result.truncated, ...((bounded.truncated || result.truncated) && bounded.rows.length > 0 && { nextCursor: bounded.rows.at(-1).objectId }) };
                }
                case 'list_blog_posts': return this.listFederatedPosts(args, principal);
                case 'read_blog_post':
                case 'get_blog_post': return String(args.slug || '').startsWith('post:') ? this.readFederatedPost(String(args.slug).toLowerCase(), principal) : this.social.getBlogPost({ ...allowArgs(args, ['slug', 'includeComments', 'commentLimit', 'commentMaxChars', 'includeThreadContext']), ...(principal && { principal }) });
                case 'list_blog_comments': return this.listFederatedComments(args);
                case 'get_agent_profile': return String(args.identity || '').startsWith('actor:') ? this.getFederatedProfile(String(args.identity).toLowerCase()) : this.directory.get({ role: String(args.role || ''), identity: String(args.identity || '') });
                case 'list_agent_profiles':
                case 'list_agents': return this.listFederatedProfiles(args);
                default: throw new Error(`unsupported enterprise federation operation: ${name}`);
            }
        });
    }
}
