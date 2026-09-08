import { guidanceError } from './guidance-runtime.js';
import { assertEnterpriseStorageFresh } from './enterprise-storage-context.js';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { federationStorageName, ensureFederationDirectory, readFederationFile, writeFederationFileAtomic, removeFederationFile } from './public-federation-storage.js';
import { join, resolve } from 'node:path';
import { makePublicActorId, verifyPublicFederationFeed, verifyPublicFederationEvent, validatePublicPublishInput, } from './public-federation.js';
const DEFAULT_MAX_OUTBOX_RECORDS = 500;
const DEFAULT_MAX_OUTBOX_BYTES = 16 * 1024 * 1024;
function sha256(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
function canonical(value) {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
function objectIdOf(input) {
    return input.type === 'profile' ? `profile:${input.actorId.slice('actor:'.length)}` : input.type === 'actor' ? input.actorId : input.type === 'update' || input.type === 'tombstone' ? input.targetObjectId : input.objectId;
}
function recordObjectId(record) {
    return record.type === 'actor' ? record.actorId : record.type === 'profile' ? record.recordId : record.type === 'update' || record.type === 'tombstone' ? record.targetObjectId : record.objectId;
}
function actorOrigin(actorId) {
    const match = actorId.match(/^actor:([a-z0-9._-]+):[a-z0-9._-]+$/);
    if (!match?.[1])
        throw guidanceError(new Error('public actor ID is invalid'), 'guid-d837747f3f39a8c2');
    return match[1];
}
function localCategory(input) {
    if (input.type === 'actor')
        return 'Actors';
    if (input.type === 'profile')
        return 'Profiles';
    if (input.type === 'post')
        return 'Posts';
    if (input.type === 'comment')
        return 'Comments';
    return 'Activity';
}
function importedCategory(object) {
    if (object.base.type === 'actor')
        return 'Actors';
    if (object.base.type === 'profile')
        return 'Profiles';
    if (object.base.type === 'post')
        return 'Posts';
    return 'Comments';
}
function markdownForLocal(input, status) {
    const id = objectIdOf(input);
    const title = input.type === 'post' ? input.title : `${input.type} ${id}`;
    return `---\npublic_federation: true\nsource: local\nstatus: ${status}\nrecord_type: ${input.type}\nobject_id: ${id}\n---\n# ${title.replace(/[\r\n#]/g, ' ')}\n\n\`\`\`json public-federation-local\n${JSON.stringify(input)}\n\`\`\`\n`;
}
function markdownForImported(objectId, object, state) {
    const base = object.base;
    if (state !== 'active') {
        return `---\npublic_federation: true\nsource: imported\nstate: ${state}\nobject_id: ${objectId}\nrevision: ${object.revision}\norigin_tombstone: ${object.tombstoned}\nglobal_moderation: ${object.globallyHidden}\n---\n# Unavailable public federation record\n\nContent is unavailable.\n`;
    }
    const title = base.type === 'post' ? base.title : base.type === 'profile' ? base.displayName : `${base.type} ${objectId}`;
    const body = base.type === 'post' || base.type === 'comment' ? base.body : base.type === 'profile' ? base.bio || '' : '';
    return `---\npublic_federation: true\nsource: imported\nstate: ${state}\nrecord_type: ${base.type}\nobject_id: ${objectId}\nactor_id: ${base.actorId}\nrevision: ${object.revision}\norigin_tombstone: ${object.tombstoned}\nglobal_moderation: ${object.globallyHidden}\n---\n# ${title.replace(/[\r\n#]/g, ' ')}\n\n${body}\n`;
}
function redactRecord(record) {
    if (record.type === 'post')
        return { ...record, title: '', body: '' };
    if (record.type === 'comment')
        return { ...record, body: '' };
    if (record.type === 'profile')
        return { ...record, displayName: '', bio: '' };
    return { ...record };
}
function outboxMarkdown(entry) {
    return `---\npublic_federation_outbox: true\nstatus: pending\nqueued_at: ${entry.queuedAt}\n---\n# Pending public federation record\n\n\`\`\`json public-federation-outbox\n${JSON.stringify(entry)}\n\`\`\`\n`;
}
function parseOutbox(content) {
    const match = content.match(/```json public-federation-outbox\r?\n([^\r\n]+)\r?\n```/);
    if (!match?.[1])
        throw guidanceError(new Error('public federation outbox record is invalid'), 'guid-1564888b702e54a0');
    return JSON.parse(match[1]);
}
function isPermanentTransportError(error) {
    return Boolean(error && typeof error === 'object' && 'retryable' in error && error.retryable === false);
}
export class PublicFederationReplica {
    vaultPath;
    publicRoot;
    internalRoot;
    outboxRoot;
    rejectedRoot;
    statePath;
    identity;
    actorId;
    client;
    trustedHubPublicKey;
    maxOutboxRecords;
    maxOutboxBytes;
    manageLocalProjection;
    state = { version: 1, cursor: 0, lastEventHash: '', objects: {}, localHidden: [] };
    loaded = false;
    mutationTail = Promise.resolve();
    constructor(options) {
        this.vaultPath = resolve(options.vaultPath);
        this.publicRoot = join(this.vaultPath, 'PublicCommunity');
        const namespace = options.storageNamespace?.trim();
        if (namespace && !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(namespace))
            throw guidanceError(new Error('storageNamespace must be an opaque identifier'), 'guid-b09d9d1fd19de99b');
        this.internalRoot = namespace
            ? join(this.vaultPath, '.mcpvault', 'public-federation', 'replicas', namespace.toLowerCase())
            : join(this.vaultPath, '.mcpvault', 'public-federation');
        this.outboxRoot = join(this.internalRoot, 'outbox');
        this.rejectedRoot = join(this.internalRoot, 'rejected');
        this.statePath = join(this.internalRoot, 'replica-state.json');
        this.identity = { origin: options.identity.origin.toLowerCase(), agentId: options.identity.agentId.toLowerCase(), ...(options.identity.role && { role: options.identity.role }) };
        this.actorId = makePublicActorId(this.identity.origin, this.identity.agentId);
        this.client = options.client;
        this.trustedHubPublicKey = options.trustedHubPublicKey;
        this.maxOutboxRecords = Math.min(Math.max(Math.trunc(options.maxOutboxRecords ?? DEFAULT_MAX_OUTBOX_RECORDS), 1), 10_000);
        this.maxOutboxBytes = Math.min(Math.max(Math.trunc(options.maxOutboxBytes ?? DEFAULT_MAX_OUTBOX_BYTES), 1024), 256 * 1024 * 1024);
        this.manageLocalProjection = options.manageLocalProjection !== false;
    }
    read(path) {
        return readFederationFile(this.vaultPath, path, { maxBytes: 64 * 1024 * 1024 });
    }
    writeAtomic(path, content) {
        return writeFederationFileAtomic(this.vaultPath, path, content, { maxBytes: 64 * 1024 * 1024 });
    }
    async load() {
        if (this.loaded)
            return;
        try {
            const value = JSON.parse(await this.read(this.statePath));
            if (!value || value.version !== 1 || !Number.isSafeInteger(value.cursor) || value.cursor < 0
                || typeof value.lastEventHash !== 'string' || !value.objects || typeof value.objects !== 'object' || Array.isArray(value.objects)
                || !Array.isArray(value.localHidden) || value.localHidden.some(id => typeof id !== 'string')
                || Object.entries(value.objects).some(([id, object]) => !object || !object.base || !['actor', 'profile', 'post', 'comment'].includes(object.base.type)
                    || recordObjectId(object.base) !== id || !Number.isSafeInteger(object.revision) || object.revision < 1
                    || typeof object.tombstoned !== 'boolean' || typeof object.globallyHidden !== 'boolean'
                    || !Number.isSafeInteger(object.moderationRevision) || !Array.isArray(object.parentIds) || object.parentIds.some(id => typeof id !== 'string'))) {
                throw guidanceError(new Error('public federation replica state is invalid'), 'guid-e6a817109a1f4d8b');
            }
            this.state = value;
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
    async withMutation(task) {
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
    localPath(input) {
        const id = input.type === 'profile' ? `profile:${this.identity.origin}:${this.identity.agentId}` : input.type === 'actor' ? input.actorId : input.objectId;
        return join(this.publicRoot, 'Local', localCategory(input), `${federationStorageName(id)}.md`);
    }
    outboxPath(idempotencyKey) {
        return join(this.outboxRoot, `${sha256(`${this.identity.origin}:${this.identity.agentId}:${idempotencyKey}`)}.md`);
    }
    async queued() {
        await ensureFederationDirectory(this.vaultPath, this.outboxRoot);
        const names = (await readdir(this.outboxRoot)).filter(name => name.endsWith('.md')).sort();
        if (names.length > this.maxOutboxRecords)
            throw guidanceError(new Error('public federation outbox quota exceeded'), 'guid-c72305fb508bfebb');
        const rows = [];
        for (const name of names) {
            const path = join(this.outboxRoot, name);
            const content = await this.read(path);
            const entry = parseOutbox(content);
            if (entry.version !== 1 || !Number.isSafeInteger(entry.queueSequence) || entry.queueSequence < 1
                || entry.identity.origin !== this.identity.origin || entry.identity.agentId !== this.identity.agentId
                || path !== this.outboxPath(entry.idempotencyKey))
                throw guidanceError(new Error('outbox identity or ordering is invalid'), 'guid-27bac9ad399820d0');
            validatePublicPublishInput(entry.input, this.identity);
            rows.push({ path, entry, bytes: Buffer.byteLength(content, 'utf8') });
        }
        return rows.sort((a, b) => a.entry.queueSequence - b.entry.queueSequence || a.path.localeCompare(b.path));
    }
    assertAcknowledgement(event, entry) {
        if (!verifyPublicFederationEvent(event, this.trustedHubPublicKey)
            || event.idempotencyHash !== `sha256:${sha256(`${this.identity.origin}:${this.identity.agentId}:${entry.idempotencyKey}`)}`
            || canonical(event.record) !== canonical(validatePublicPublishInput(entry.input, this.identity))) {
            throw guidanceError(new Error('public federation publish acknowledgement validation failed'), 'guid-917d691d90a47da9');
        }
    }
    async deliver(entry, path) {
        assertEnterpriseStorageFresh();
        const event = await this.client.publish(entry.input, entry.idempotencyKey);
        this.assertAcknowledgement(event, entry);
        if (this.manageLocalProjection)
            await this.writeAtomic(this.localPath(entry.input), markdownForLocal(entry.input, 'published'));
        await removeFederationFile(this.vaultPath, path);
        return event;
    }
    async reject(entry, path, error) {
        const reason = error instanceof Error ? error.message.slice(0, 500) : 'publication rejected';
        await this.writeAtomic(join(this.rejectedRoot, `${sha256(entry.idempotencyKey)}.md`), outboxMarkdown(entry) + `\nRejection: ${JSON.stringify(reason)}\n`);
        await removeFederationFile(this.vaultPath, path);
    }
    async publish(input, idempotencyKey) {
        return this.withMutation(async () => {
            if (!idempotencyKey || idempotencyKey.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(idempotencyKey))
                throw guidanceError(new Error('idempotencyKey is required and contains only letters, numbers, dot, underscore, colon, or hyphen'), 'guid-da5dd57649554246');
            validatePublicPublishInput(input, this.identity);
            const rows = await this.queued();
            const path = this.outboxPath(idempotencyKey);
            const existing = rows.find(row => row.path === path);
            const entry = existing?.entry || { version: 1, queueSequence: (rows.at(-1)?.entry.queueSequence || 0) + 1, identity: this.identity, idempotencyKey, input, queuedAt: new Date().toISOString() };
            if (existing && canonical(entry.input) !== canonical(input))
                throw guidanceError(new Error('idempotency key is already queued with a different payload'), 'guid-1fe156a6c6a676b1');
            if (!existing) {
                const serialized = outboxMarkdown(entry);
                if (rows.length >= this.maxOutboxRecords || rows.reduce((sum, row) => sum + row.bytes, 0) + Buffer.byteLength(serialized, 'utf8') > this.maxOutboxBytes)
                    throw guidanceError(new Error('public federation outbox quota exceeded'), 'guid-c72305fb508bfebb');
                await this.writeAtomic(path, serialized);
            }
            if (this.manageLocalProjection)
                await this.writeAtomic(this.localPath(input), markdownForLocal(input, 'pending'));
            // Never send a successor ahead of an older offline mutation.
            if (rows.length > 0 && rows[0].path !== path)
                return { status: 'pending', objectId: objectIdOf(input), error: 'earlier publication is pending' };
            try {
                const event = await this.deliver(entry, path);
                return { status: 'published', objectId: objectIdOf(input), event };
            }
            catch (error) {
                if (isPermanentTransportError(error)) {
                    await this.reject(entry, path, error);
                    throw error;
                }
                return { status: 'pending', objectId: objectIdOf(input), error: error instanceof Error ? error.message : 'hub unavailable' };
            }
        });
    }
    async flushOutbox() {
        return this.withMutation(async () => {
            const rows = await this.queued();
            const published = [], pending = [], rejected = [];
            for (let index = 0; index < rows.length; index += 1) {
                const { path, entry } = rows[index];
                try {
                    await this.deliver(entry, path);
                    published.push(objectIdOf(entry.input));
                }
                catch (error) {
                    if (isPermanentTransportError(error)) {
                        await this.reject(entry, path, error);
                        rejected.push(objectIdOf(entry.input));
                    }
                    else
                        pending.push(objectIdOf(entry.input));
                    pending.push(...rows.slice(index + 1).map(row => objectIdOf(row.entry.input)));
                    break;
                }
            }
            return { published, pending, rejected };
        });
    }
    apply(event) {
        const record = event.record;
        if (record.type === 'moderation') {
            const target = this.state.objects[record.objectId];
            if (target) {
                target.globallyHidden = record.action === 'hide';
                target.moderationRevision = record.revision;
            }
            return record.objectId;
        }
        if (record.type === 'actor' || record.type === 'profile' || record.type === 'post' || record.type === 'comment') {
            const objectId = recordObjectId(record);
            const parentIds = record.type === 'actor' ? [] : record.type === 'comment' ? [record.actorId, record.postId, ...(record.replyTo ? [record.replyTo] : [])] : [record.actorId];
            this.state.objects[objectId] = { base: record, revision: record.revision, tombstoned: false, globallyHidden: false, moderationRevision: 0, parentIds };
            return objectId;
        }
        const target = this.state.objects[record.targetObjectId];
        if (!target)
            return record.targetObjectId;
        if (record.type === 'tombstone') {
            target.revision = record.revision;
            target.tombstoned = true;
            return record.targetObjectId;
        }
        target.revision = record.revision;
        if (target.base.type === 'post') {
            target.base = { ...target.base, revision: record.revision, ...(record.title !== undefined && { title: record.title }), ...(record.body !== undefined && { body: record.body }) };
        }
        else if (target.base.type === 'comment') {
            target.base = { ...target.base, revision: record.revision, ...(record.body !== undefined && { body: record.body }) };
        }
        else if (target.base.type === 'profile') {
            target.base = { ...target.base, revision: record.revision, ...(record.displayName !== undefined && { displayName: record.displayName }), ...(record.bio !== undefined && { bio: record.bio }) };
        }
        return record.targetObjectId;
    }
    possibleImportedPaths(origin, objectId) {
        return ['Actors', 'Profiles', 'Posts', 'Comments', 'Pending', 'Tombstones', 'Moderated', 'LocallyHidden']
            .map(category => join(this.publicRoot, 'Imported', origin, category, `${federationStorageName(objectId)}.md`));
    }
    async reconcile() {
        const pending = [];
        const hidden = [];
        for (const [objectId, object] of Object.entries(this.state.objects)) {
            const origin = actorOrigin(object.base.actorId);
            if (origin === this.identity.origin && object.base.actorId === this.actorId)
                continue;
            for (const path of this.possibleImportedPaths(origin, objectId))
                await removeFederationFile(this.vaultPath, path);
            const projectionState = this.objectStatus(objectId);
            const categories = { 'origin-tombstone': 'Tombstones', 'global-moderation': 'Moderated', 'local-hide': 'LocallyHidden', 'pending-parent': 'Pending', active: importedCategory(object) };
            const category = categories[projectionState];
            if (projectionState === 'pending-parent')
                pending.push(objectId);
            else if (projectionState !== 'active')
                hidden.push(objectId);
            const path = join(this.publicRoot, 'Imported', origin, category, `${federationStorageName(objectId)}.md`);
            await this.writeAtomic(path, markdownForImported(objectId, object, projectionState));
        }
        return { pending, hidden };
    }
    objectStatus(objectId, visiting = new Set()) {
        const object = this.state.objects[objectId];
        if (!object || visiting.has(objectId) || visiting.size > 256)
            return 'pending-parent';
        if (object.tombstoned)
            return 'origin-tombstone';
        if (object.globallyHidden)
            return 'global-moderation';
        if (this.state.localHidden.includes(objectId))
            return 'local-hide';
        visiting.add(objectId);
        const unavailable = object.parentIds.some(parentId => this.objectStatus(parentId, visiting) !== 'active');
        visiting.delete(objectId);
        return unavailable ? 'pending-parent' : 'active';
    }
    view(objectId, object) {
        const status = this.objectStatus(objectId);
        return { objectId, origin: actorOrigin(object.base.actorId), revision: object.revision, status, record: status === 'active' ? structuredClone(object.base) : redactRecord(object.base) };
    }
    async getObject(objectId, options = {}) {
        return this.withMutation(async () => {
            const object = this.state.objects[objectId];
            if (!object)
                return undefined;
            const view = this.view(objectId, object);
            return view.status === 'active' || options.includeUnavailable === true ? view : undefined;
        });
    }
    async listObjects(params = {}) {
        return this.withMutation(async () => {
            const limit = Number.isSafeInteger(params.limit) && Number(params.limit) > 0 ? Math.min(Number(params.limit), 100) : 50;
            const origin = params.origin?.trim().toLowerCase();
            const requestedStatus = params.status || (params.includeUnavailable === true ? undefined : 'active');
            const rows = Object.entries(this.state.objects)
                .map(([objectId, object]) => this.view(objectId, object))
                .filter(view => (!params.postId || (view.record.type === 'comment' && view.record.postId === params.postId)) && (!params.type || view.record.type === params.type) && (!origin || view.origin === origin) && (!requestedStatus || view.status === requestedStatus))
                .sort((left, right) => left.objectId.localeCompare(right.objectId));
            const start = params.after ? rows.findIndex(row => row.objectId === params.after) + 1 : 0;
            if (params.after && start === 0)
                throw guidanceError(new Error('public federation list cursor is outside the current snapshot'), 'guid-0cdd8fbf390013db');
            const objects = rows.slice(start, start + limit);
            const truncated = start + objects.length < rows.length;
            return { objects, truncated, ...(truncated && objects.length > 0 && { nextCursor: objects.at(-1).objectId }) };
        });
    }
    async pull(limit = 50) {
        return this.withMutation(async () => {
            let feed;
            try {
                feed = await this.client.getFeed(this.state.cursor, limit);
            }
            catch (error) {
                return { applied: [], pending: [], hidden: [], cursor: this.state.cursor, hasMore: true, errors: [error instanceof Error ? error.message : 'hub unavailable'] };
            }
            if (!verifyPublicFederationFeed(feed, this.trustedHubPublicKey))
                return { applied: [], pending: [], hidden: [], cursor: this.state.cursor, hasMore: true, errors: ['public federation feed signature validation failed'] };
            if (feed.after !== this.state.cursor)
                return { applied: [], pending: [], hidden: [], cursor: this.state.cursor, hasMore: true, errors: ['public federation feed cursor mismatch'] };
            if (feed.anchorHash !== this.state.lastEventHash)
                return { applied: [], pending: [], hidden: [], cursor: this.state.cursor, hasMore: true, errors: ['public federation feed does not continue the trusted hash chain'] };
            const applied = [];
            let expectedSequence = this.state.cursor + 1;
            let previousHash = this.state.lastEventHash;
            for (const event of feed.events) {
                if (event.sequence !== expectedSequence || event.previousHash !== previousHash) {
                    return { applied: [], pending: [], hidden: [], cursor: this.state.cursor, hasMore: true, errors: ['public federation feed is out of order or has a broken hash chain'] };
                }
                applied.push(this.apply(event));
                this.state.cursor = event.sequence;
                this.state.lastEventHash = event.eventHash;
                expectedSequence += 1;
                previousHash = event.eventHash;
            }
            const status = await this.reconcile();
            await this.save();
            return { applied: Array.from(new Set(applied)), pending: status.pending, hidden: status.hidden, cursor: this.state.cursor, hasMore: feed.hasMore, errors: [] };
        });
    }
    async hideLocally(objectId, reason) {
        await this.withMutation(async () => {
            if (!this.state.objects[objectId])
                throw guidanceError(new Error('local hide target does not exist'), 'guid-7e92e5c81a4724e9');
            const cleanReason = String(reason || '').trim();
            if (!cleanReason || cleanReason.length > 500)
                throw guidanceError(new Error('local hide reason is required and bounded'), 'guid-837e32002ad814b8');
            if (!this.state.localHidden.includes(objectId))
                this.state.localHidden.push(objectId);
            const marker = `---\npublic_federation_local_hide: true\nobject_id: ${objectId}\n---\n# Local hide\n\n${cleanReason}\n`;
            await this.writeAtomic(join(this.internalRoot, 'local-hides', `${sha256(objectId)}.md`), marker);
            await this.reconcile();
            await this.save();
        });
    }
}
