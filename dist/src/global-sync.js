import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, timingSafeEqual, verify } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { appendFile, copyFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
const PROTOCOL = 'mcpvault-global-sync/v1';
const MAX_DOCUMENT_BYTES = 1_048_576;
const MAX_REASON_LENGTH = 500;
const MAX_AUTHOR_LENGTH = 128;
const MAX_ORIGIN_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_TOTAL_PROPOSALS = 100_000;
const MAX_PENDING_PROPOSALS = 2_000;
const MAX_PENDING_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_CONTENT_BYTES = 512 * 1024 * 1024;
const MAX_CONFIGURED_TOTAL_CONTENT_BYTES = 16 * 1024 * 1024 * 1024;
const MAX_PROPOSALS_PER_ORIGIN_PER_MINUTE = 120;
const RATE_WINDOW_MS = 60_000;
const MAX_HTTP_REQUESTS_PER_MINUTE = 300;
const MAX_RATE_BUCKETS = 4_096;
const DEFAULT_BATCH_LIMIT = 100;
const MAX_BATCH_LIMIT = 200;
const RESERVED_ROOTS = new Set(['.git', '.obsidian', '.mcpvault', '_scopes', '_whispers', 'community', 'node_modules']);
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function sha256(content) {
    return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}
export function generateGlobalSyncSigningKeyPair() {
    const pair = generateKeyPairSync('ed25519');
    return {
        privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
}
function signaturePayload(value) {
    return Buffer.from(JSON.stringify(value), 'utf8');
}
function eventHash(value) {
    return sha256(JSON.stringify(value));
}
function signPayload(value, privateKey) {
    return sign(null, signaturePayload(value), privateKey).toString('base64url');
}
function verifyPayload(value, signature, publicKey) {
    try {
        return verify(null, signaturePayload(value), publicKey, Buffer.from(signature, 'base64url'));
    }
    catch {
        return false;
    }
}
function withoutSignature(value) {
    const { signature: _signature, ...unsigned } = value;
    return unsigned;
}
function withoutRevisionContent(value) {
    const { signature: _signature, content: _content, ...unsigned } = value;
    return unsigned;
}
function normalizeId(value, field) {
    const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalized || normalized.length > 240 || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error(`${field} must be a safe relative path`);
    }
    const first = normalized.split('/')[0].toLowerCase();
    if (RESERVED_ROOTS.has(first) || normalized.startsWith('_'))
        throw new Error(`${field} must identify a Global document, not private or service state`);
    if (!/\.(?:md|markdown|txt)$/i.test(normalized))
        throw new Error(`${field} must be a Markdown or text document`);
    return normalized;
}
function boundedText(value, field, max) {
    const text = String(value || '').trim();
    if (!text || text.length > max)
        throw new Error(`${field} is required and must be at most ${max} characters`);
    if (/[\u0000-\u001f\u007f]/.test(text))
        throw new Error(`${field} contains unsupported control characters`);
    return text;
}
function normalizeIdempotencyKey(value) {
    if (value === undefined)
        return undefined;
    const key = boundedText(value, 'idempotencyKey', MAX_IDEMPOTENCY_KEY_LENGTH);
    if (!/^[a-zA-Z0-9._:-]+$/.test(key))
        throw new Error('idempotencyKey contains unsupported characters');
    return key;
}
function serializeCredential(credential) {
    if (!credential?.digest)
        return undefined;
    return { digest: credential.digest.toString('base64url'), ...(credential.expiresAt !== undefined && { expiresAt: credential.expiresAt }) };
}
function deserializeCredential(value, field) {
    if (!isRecord(value) || typeof value.digest !== 'string')
        throw new Error(`${field} is invalid`);
    const digest = Buffer.from(value.digest, 'base64url');
    if (digest.byteLength !== 32)
        throw new Error(`${field}.digest is invalid`);
    const expiresAt = value.expiresAt;
    if (expiresAt !== undefined && (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= 0))
        throw new Error(`${field}.expiresAt is invalid`);
    return { digest, ...(typeof expiresAt === 'number' && { expiresAt }) };
}
function serializeCredentialStore(authCredential, reviewerTokens, adminCredential) {
    const reviewers = {};
    for (const [reviewerId, credential] of reviewerTokens) {
        const serialized = serializeCredential(credential);
        if (serialized)
            reviewers[reviewerId] = serialized;
    }
    const proposer = serializeCredential(authCredential);
    const admin = serializeCredential(adminCredential);
    return { version: 1, reviewers, ...(proposer ? { proposer } : {}), ...(admin ? { admin } : {}) };
}
async function loadCredentialStore(path) {
    try {
        const parsed = JSON.parse(await readFile(path, 'utf8'));
        if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.reviewers))
            throw new Error('credential state has an unsupported format');
        const reviewers = {};
        for (const [reviewerId, value] of Object.entries(parsed.reviewers)) {
            if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(reviewerId))
                throw new Error('credential state contains an invalid reviewer id');
            const credential = deserializeCredential(value, `reviewers.${reviewerId}`);
            reviewers[reviewerId] = serializeCredential(credential);
        }
        const proposer = parsed.proposer === undefined ? undefined : serializeCredential(deserializeCredential(parsed.proposer, 'proposer'));
        const admin = parsed.admin === undefined ? undefined : serializeCredential(deserializeCredential(parsed.admin, 'admin'));
        return { version: 1, ...(proposer && { proposer }), reviewers, ...(admin && { admin }) };
    }
    catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
function normalizeExpiry(value, field) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value !== 'string')
        throw new Error(`${field} must be an ISO timestamp`);
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp <= Date.now())
        throw new Error(`${field} must be a future ISO timestamp`);
    return timestamp;
}
function credentialActive(credential) {
    return Boolean(credential.digest) && (credential.expiresAt === undefined || credential.expiresAt > Date.now());
}
function normalizeLimit(value) {
    const number = Number(value ?? DEFAULT_BATCH_LIMIT);
    if (!Number.isSafeInteger(number) || number < 1)
        return DEFAULT_BATCH_LIMIT;
    return Math.min(number, MAX_BATCH_LIMIT);
}
function normalizeContentQuota(value) {
    if (value === undefined)
        return DEFAULT_MAX_TOTAL_CONTENT_BYTES;
    if (!Number.isSafeInteger(value) || value < 1)
        throw new Error('maxTotalContentBytes must be a positive safe integer');
    return Math.min(value, MAX_CONFIGURED_TOTAL_CONTENT_BYTES);
}
function emptyState(hubId) {
    return { protocol: PROTOCOL, hubId, nextSequence: 0, heads: {}, revisions: {}, proposals: {} };
}
function applyEvent(state, event) {
    state.nextSequence = Math.max(state.nextSequence, event.sequence);
    const payload = isRecord(event.payload) ? event.payload : {};
    if (event.type === 'proposal.created') {
        const proposal = payload.proposal;
        if (isRecord(proposal) && typeof proposal.proposalId === 'string')
            state.proposals[proposal.proposalId] = proposal;
        return;
    }
    const proposalId = typeof payload.proposalId === 'string' ? payload.proposalId : undefined;
    if (proposalId && state.proposals[proposalId]) {
        const proposal = state.proposals[proposalId];
        if (event.type === 'proposal.approval') {
            const reviewer = typeof payload.reviewer === 'string' ? payload.reviewer : undefined;
            if (reviewer && !proposal.approvals?.includes(reviewer))
                proposal.approvals = [...(proposal.approvals || []), reviewer];
        }
        else if (event.type === 'proposal.approved') {
            proposal.status = 'approved';
            const revision = payload.revision;
            if (isRecord(revision) && typeof revision.revisionId === 'string' && typeof revision.documentId === 'string') {
                const typedRevision = revision;
                state.revisions[typedRevision.revisionId] = typedRevision;
                state.heads[typedRevision.documentId] = typedRevision.revisionId;
            }
        }
        else if (event.type === 'proposal.rejected') {
            proposal.status = 'rejected';
            if (typeof payload.reason === 'string')
                proposal.decisionReason = payload.reason;
        }
        else if (event.type === 'proposal.conflict') {
            proposal.status = 'conflict';
            if (typeof payload.reason === 'string')
                proposal.decisionReason = payload.reason;
        }
        if (typeof payload.decidedAt === 'string')
            proposal.decidedAt = payload.decidedAt;
        return;
    }
    if (event.type === 'revision.restored') {
        const revision = payload.revision;
        if (isRecord(revision) && typeof revision.revisionId === 'string' && typeof revision.documentId === 'string') {
            const typedRevision = revision;
            state.revisions[typedRevision.revisionId] = typedRevision;
            state.heads[typedRevision.documentId] = typedRevision.revisionId;
        }
    }
}
async function writeAtomic(path, content) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await rename(temporary, path);
    }
    finally {
        await unlink(temporary).catch(() => undefined);
    }
}
async function writeObjectIfMissing(path, content) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
        await writeFile(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    }
    catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
            throw error;
    }
}
function processIsAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return !(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH');
    }
}
async function acquireProcessLock(path) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const nonce = randomUUID();
        try {
            const handle = await open(path, 'wx');
            try {
                await handle.writeFile(`${JSON.stringify({ pid: process.pid, nonce, startedAt: new Date().toISOString() })}\n`, 'utf8');
                await handle.sync();
            }
            catch (error) {
                await handle.close().catch(() => undefined);
                await unlink(path).catch(() => undefined);
                throw error;
            }
            return { handle, nonce, path };
        }
        catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
                throw error;
            let raw;
            try {
                raw = await readFile(path, 'utf8');
            }
            catch (readError) {
                if (readError && typeof readError === 'object' && 'code' in readError && readError.code === 'ENOENT')
                    continue;
                throw readError;
            }
            let record;
            try {
                record = JSON.parse(raw);
            }
            catch {
                throw new Error('Global Sync process lock is corrupt; refusing to remove it automatically');
            }
            if (!isRecord(record) || typeof record.pid !== 'number' || !Number.isSafeInteger(record.pid) || record.pid <= 0 || typeof record.nonce !== 'string' || !record.nonce) {
                throw new Error('Global Sync process lock is invalid; refusing to remove it automatically');
            }
            if (processIsAlive(record.pid))
                throw new Error(`Global Sync storage is already in use by process ${record.pid}`);
            await unlink(path);
        }
    }
    throw new Error('Unable to acquire Global Sync process lock');
}
async function releaseProcessLock(lock) {
    await lock.handle.close().catch(() => undefined);
    try {
        const record = JSON.parse(await readFile(lock.path, 'utf8'));
        if (record.nonce === lock.nonce)
            await unlink(lock.path);
    }
    catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
            throw error;
    }
}
/**
 * Append-only Global authority. It stores metadata in a rebuildable state
 * snapshot and content in immutable, hash-addressed objects. No physical
 * document deletion operation exists: deletion is a reviewable tombstone.
 */
export class GlobalSyncHub {
    root;
    statePath;
    eventPath;
    objectRoot;
    hubId;
    processLockPath;
    signingPrivateKey;
    signingPublicKey;
    approvalQuorum;
    maxTotalContentBytes;
    originWindows = new Map();
    state;
    lastEventHash = '';
    initialized = false;
    mutationTail = Promise.resolve();
    loadPromise;
    processLock;
    closed = false;
    totalProposalBytes = 0;
    constructor(root, options = {}) {
        this.root = resolve(root);
        this.statePath = join(this.root, 'state.json');
        this.eventPath = join(this.root, 'events.ndjson');
        this.objectRoot = join(this.root, 'objects');
        this.hubId = boundedText(options.hubId || 'global-hub', 'hubId', MAX_ORIGIN_LENGTH).toLowerCase();
        this.processLockPath = options.processLockPath ? resolve(options.processLockPath) : undefined;
        if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(this.hubId))
            throw new Error('hubId must be a lowercase identifier');
        this.signingPrivateKey = options.signingPrivateKey ? createPrivateKey(options.signingPrivateKey) : createPrivateKey(generateGlobalSyncSigningKeyPair().privateKey);
        if (this.signingPrivateKey.asymmetricKeyType !== 'ed25519')
            throw new Error('Global Sync signing key must be Ed25519');
        this.signingPublicKey = createPublicKey(this.signingPrivateKey).export({ type: 'spki', format: 'pem' }).toString();
        this.approvalQuorum = 2;
        this.maxTotalContentBytes = normalizeContentQuota(options.maxTotalContentBytes);
        this.state = emptyState(this.hubId);
    }
    getPublicKey() { return this.signingPublicKey; }
    exportSigningPrivateKey() {
        return this.signingPrivateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    }
    ensureLoaded() {
        if (this.closed)
            return Promise.reject(new Error('Global Sync hub is closed'));
        if (this.initialized)
            return Promise.resolve();
        if (this.loadPromise)
            return this.loadPromise;
        const load = this.loadFromDisk();
        this.loadPromise = load;
        return load.finally(() => {
            if (this.loadPromise === load)
                this.loadPromise = undefined;
        });
    }
    async loadFromDisk() {
        if (this.processLockPath)
            this.processLock = await acquireProcessLock(this.processLockPath);
        try {
            await mkdir(this.objectRoot, { recursive: true });
            let snapshotExists = false;
            try {
                await stat(this.statePath);
                snapshotExists = true;
            }
            catch {
                snapshotExists = false;
            }
            this.state = emptyState(this.hubId);
            try {
                const lines = (await readFile(this.eventPath, 'utf8')).split(/\r?\n/).filter(Boolean);
                for (const line of lines) {
                    const event = JSON.parse(line);
                    const unsignedEvent = { sequence: event.sequence, type: event.type, payload: event.payload, previousHash: event.previousHash };
                    if (!Number.isSafeInteger(event.sequence) || event.sequence !== this.state.nextSequence + 1 || event.previousHash !== this.lastEventHash || event.eventHash !== eventHash(unsignedEvent) || !event.signature || !verifyPayload(unsignedEvent, event.signature, createPublicKey(this.signingPublicKey)))
                        throw new Error(`invalid event chain at sequence ${event.sequence}`);
                    applyEvent(this.state, event);
                    this.lastEventHash = event.eventHash;
                }
            }
            catch (error) {
                if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
                    if (snapshotExists)
                        throw new Error('Global Sync event log is missing; refusing to trust the state snapshot');
                }
                else {
                    throw error;
                }
            }
            this.initialized = true;
            this.totalProposalBytes = Object.values(this.state.proposals).reduce((total, proposal) => total + proposal.byteLength, 0);
        }
        catch (error) {
            if (this.processLock) {
                await releaseProcessLock(this.processLock).catch(() => undefined);
                this.processLock = undefined;
            }
            throw error;
        }
    }
    async close() {
        this.closed = true;
        await this.loadPromise?.catch(() => undefined);
        if (this.processLock) {
            const lock = this.processLock;
            this.processLock = undefined;
            await releaseProcessLock(lock);
        }
    }
    async withMutation(task) {
        const previous = this.mutationTail;
        let release;
        this.mutationTail = new Promise(resolvePromise => { release = resolvePromise; });
        await previous;
        try {
            await this.ensureLoaded();
            return await task();
        }
        finally {
            release();
        }
    }
    async appendEvent(type, payload) {
        const unsignedEvent = { sequence: this.state.nextSequence + 1, type, payload, previousHash: this.lastEventHash };
        const event = { ...unsignedEvent, eventHash: eventHash(unsignedEvent), signature: signPayload(unsignedEvent, this.signingPrivateKey) };
        await mkdir(dirname(this.eventPath), { recursive: true });
        const handle = await open(this.eventPath, 'a');
        try {
            await handle.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        applyEvent(this.state, event);
        this.lastEventHash = event.eventHash;
        await writeAtomic(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`);
    }
    objectPath(contentHash) {
        if (!/^sha256:[a-f0-9]{64}$/.test(contentHash))
            throw new Error('Invalid content hash');
        return join(this.objectRoot, contentHash.slice('sha256:'.length));
    }
    async storeContent(content) {
        const byteLength = Buffer.byteLength(content, 'utf8');
        if (byteLength > MAX_DOCUMENT_BYTES)
            throw new Error(`Global document exceeds ${MAX_DOCUMENT_BYTES} bytes`);
        const contentHash = sha256(content);
        await writeObjectIfMissing(this.objectPath(contentHash), content);
        return { contentHash, byteLength };
    }
    enforceProposalQuota(origin, byteLength) {
        const proposals = Object.values(this.state.proposals);
        if (proposals.length >= MAX_TOTAL_PROPOSALS)
            throw new Error('Global Sync proposal history quota exceeded');
        if (this.totalProposalBytes > this.maxTotalContentBytes - byteLength)
            throw new Error('Global Sync total content quota exceeded');
        const pending = proposals.filter(proposal => proposal.status === 'pending');
        if (pending.length >= MAX_PENDING_PROPOSALS)
            throw new Error('Global Sync pending proposal quota exceeded');
        const pendingBytes = pending.reduce((total, proposal) => total + proposal.byteLength, 0);
        if (pendingBytes + byteLength > MAX_PENDING_BYTES)
            throw new Error('Global Sync pending content quota exceeded');
        const now = Date.now();
        const window = this.originWindows.get(origin);
        if (!window || now - window.startedAt >= RATE_WINDOW_MS) {
            if (this.originWindows.size >= MAX_RATE_BUCKETS) {
                for (const [key, value] of this.originWindows) {
                    if (now - value.startedAt >= RATE_WINDOW_MS)
                        this.originWindows.delete(key);
                    if (this.originWindows.size < MAX_RATE_BUCKETS)
                        break;
                }
            }
            if (this.originWindows.size >= MAX_RATE_BUCKETS && !this.originWindows.has(origin))
                throw new Error('Global Sync proposal rate limiter is at capacity');
            this.originWindows.set(origin, { startedAt: now, count: 1 });
            return;
        }
        if (window.count >= MAX_PROPOSALS_PER_ORIGIN_PER_MINUTE)
            throw new Error('Global Sync proposal rate limit exceeded for origin');
        window.count += 1;
    }
    currentRevision(documentId) {
        const head = this.state.heads[documentId];
        return head ? this.state.revisions[head] : undefined;
    }
    async submitProposal(input) {
        return this.withMutation(async () => {
            const documentId = normalizeId(input.documentId, 'documentId');
            const operation = input.operation || 'upsert';
            if (operation !== 'upsert' && operation !== 'tombstone')
                throw new Error('operation must be upsert or tombstone');
            const author = boundedText(input.author, 'author', MAX_AUTHOR_LENGTH);
            const reason = boundedText(input.reason, 'reason', MAX_REASON_LENGTH);
            const origin = boundedText(input.origin, 'origin', MAX_ORIGIN_LENGTH);
            const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
            const current = this.currentRevision(documentId);
            const parentRevision = input.parentRevision || current?.revisionId;
            if (parentRevision && (!this.state.revisions[parentRevision] || this.state.revisions[parentRevision].documentId !== documentId))
                throw new Error('parentRevision is unknown or belongs to another document');
            let contentHash;
            let byteLength = 0;
            if (operation === 'upsert') {
                if (typeof input.content !== 'string')
                    throw new Error('content is required for an upsert');
                byteLength = Buffer.byteLength(input.content, 'utf8');
                if (byteLength > MAX_DOCUMENT_BYTES)
                    throw new Error(`Global document exceeds ${MAX_DOCUMENT_BYTES} bytes`);
                contentHash = sha256(input.content);
            }
            if (idempotencyKey) {
                const existing = Object.values(this.state.proposals).find(candidate => candidate.origin === origin && candidate.idempotencyKey === idempotencyKey);
                if (existing) {
                    if (existing.documentId !== documentId || (input.parentRevision !== undefined && existing.parentRevision !== parentRevision) || existing.operation !== operation || existing.contentHash !== contentHash || existing.byteLength !== byteLength || existing.author !== author || existing.reason !== reason)
                        throw new Error('idempotencyKey was already used for a different proposal');
                    return existing;
                }
            }
            const duplicate = Object.values(this.state.proposals).find(candidate => candidate.status === 'pending'
                && candidate.documentId === documentId
                && candidate.parentRevision === parentRevision
                && candidate.operation === operation
                && candidate.contentHash === contentHash);
            if (duplicate)
                return duplicate;
            this.enforceProposalQuota(origin, byteLength);
            if (operation === 'upsert' && typeof input.content === 'string')
                await this.storeContent(input.content);
            const proposal = {
                proposalId: `proposal_${randomUUID()}`,
                documentId,
                ...(parentRevision && { parentRevision }),
                operation,
                ...(contentHash && { contentHash }),
                byteLength,
                author,
                reason,
                origin,
                ...(idempotencyKey && { idempotencyKey }),
                createdAt: new Date().toISOString(),
                status: 'pending',
                approvals: [],
            };
            await this.appendEvent('proposal.created', { proposal });
            this.totalProposalBytes += byteLength;
            return proposal;
        });
    }
    async getManifest(after = 0, limit) {
        await this.ensureLoaded();
        const cursor = Number.isSafeInteger(Number(after)) && Number(after) >= 0 ? Number(after) : 0;
        const revisions = Object.values(this.state.revisions).filter(revision => revision.sequence > cursor).sort((a, b) => a.sequence - b.sequence);
        const bounded = revisions.slice(0, normalizeLimit(limit));
        const unsignedManifest = {
            protocol: PROTOCOL,
            hubId: this.hubId,
            cursor: bounded.at(-1)?.sequence || cursor,
            latestSequence: this.state.nextSequence,
            entries: bounded.map(revision => ({ documentId: revision.documentId, revisionId: revision.revisionId, sequence: revision.sequence, ...(revision.parentRevision && { parentRevision: revision.parentRevision }), operation: revision.operation, ...(revision.contentHash && { contentHash: revision.contentHash }) })),
            hasMore: revisions.length > bounded.length,
        };
        return { ...unsignedManifest, signature: signPayload(unsignedManifest, this.signingPrivateKey) };
    }
    async getRevision(revisionId) {
        await this.ensureLoaded();
        const revision = this.state.revisions[String(revisionId || '').trim()];
        if (!revision)
            throw new Error('revision not found');
        if (!revision.signature || !verifyPayload(withoutSignature(revision), revision.signature, createPublicKey(this.signingPublicKey)))
            throw new Error(`revision signature mismatch for ${revision.revisionId}`);
        if (revision.operation === 'tombstone')
            return { ...revision };
        if (!revision.contentHash)
            throw new Error('upsert revision has no content hash');
        const content = await readFile(this.objectPath(revision.contentHash), 'utf8');
        if (sha256(content) !== revision.contentHash || Buffer.byteLength(content, 'utf8') !== revision.byteLength)
            throw new Error(`content validation failed for ${revision.revisionId}`);
        return { ...revision, content };
    }
    async listProposals(status, limit) {
        await this.ensureLoaded();
        const all = Object.values(this.state.proposals)
            .filter(proposal => !status || proposal.status === status)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const bounded = all.slice(0, normalizeLimit(limit));
        return { proposals: bounded, total: all.length, truncated: bounded.length < all.length };
    }
    async approveProposal(proposalId, reviewer, reason) {
        return this.withMutation(async () => {
            const proposal = this.state.proposals[String(proposalId || '').trim()];
            if (!proposal)
                throw new Error('proposal not found');
            if (proposal.status !== 'pending')
                throw new Error(`proposal is already ${proposal.status}`);
            const reviewerId = boundedText(reviewer, 'reviewer', MAX_AUTHOR_LENGTH);
            if (proposal.approvals?.includes(reviewerId))
                throw new Error('reviewer has already approved this proposal');
            await this.appendEvent('proposal.approval', { proposalId: proposal.proposalId, reviewer: reviewerId, decidedAt: new Date().toISOString() });
            const approvedProposal = this.state.proposals[proposal.proposalId];
            const requiredApprovals = this.approvalQuorum;
            if ((approvedProposal.approvals?.length || 0) < requiredApprovals)
                return { status: 'pending', proposal: approvedProposal };
            const current = this.currentRevision(proposal.documentId);
            const currentId = current?.revisionId;
            if ((proposal.parentRevision || undefined) !== currentId) {
                const decisionReason = `Conflict: expected parent ${proposal.parentRevision || 'none'}, current head is ${currentId || 'none'}`;
                await this.appendEvent('proposal.conflict', { proposalId: proposal.proposalId, reason: decisionReason, decidedAt: new Date().toISOString() });
                return { status: 'conflict', proposal: this.state.proposals[proposal.proposalId], ...(currentId && { currentRevision: currentId }) };
            }
            const unsignedRevision = {
                revisionId: `rev_${randomUUID()}`,
                documentId: proposal.documentId,
                sequence: this.state.nextSequence + 1,
                ...(proposal.parentRevision && { parentRevision: proposal.parentRevision }),
                operation: proposal.operation,
                ...(proposal.contentHash && { contentHash: proposal.contentHash }),
                byteLength: proposal.byteLength,
                author: proposal.author,
                reason: boundedText(reason || proposal.reason, 'decision reason', MAX_REASON_LENGTH),
                origin: proposal.origin,
                createdAt: new Date().toISOString(),
            };
            const revision = { ...unsignedRevision, signature: signPayload(unsignedRevision, this.signingPrivateKey) };
            await this.appendEvent('proposal.approved', { proposalId: proposal.proposalId, revision, decidedAt: new Date().toISOString(), reviewer: reviewerId });
            return { status: 'approved', proposal: this.state.proposals[proposal.proposalId], revision };
        });
    }
    async rejectProposal(proposalId, reviewer, reason) {
        return this.withMutation(async () => {
            const proposal = this.state.proposals[String(proposalId || '').trim()];
            if (!proposal)
                throw new Error('proposal not found');
            if (proposal.status !== 'pending')
                throw new Error(`proposal is already ${proposal.status}`);
            await this.appendEvent('proposal.rejected', { proposalId: proposal.proposalId, reason: boundedText(reason, 'reason', MAX_REASON_LENGTH), decidedAt: new Date().toISOString(), reviewer: boundedText(reviewer, 'reviewer', MAX_AUTHOR_LENGTH) });
            return this.state.proposals[proposal.proposalId];
        });
    }
    async restoreDocument(documentIdInput, targetRevisionId, reviewer, reason, expectedCurrentRevision) {
        return this.withMutation(async () => {
            const documentId = normalizeId(documentIdInput, 'documentId');
            const target = this.state.revisions[String(targetRevisionId || '').trim()];
            if (!target || target.documentId !== documentId || target.operation !== 'upsert' || !target.contentHash)
                throw new Error('targetRevisionId must identify an existing upsert of this document');
            const targetContent = await readFile(this.objectPath(target.contentHash), 'utf8');
            if (sha256(targetContent) !== target.contentHash || Buffer.byteLength(targetContent, 'utf8') !== target.byteLength)
                throw new Error('target revision object failed content validation');
            const current = this.currentRevision(documentId);
            if ((expectedCurrentRevision || undefined) !== current?.revisionId)
                throw new Error(`restore conflict: expected ${expectedCurrentRevision || 'none'}, current ${current?.revisionId || 'none'}`);
            const unsignedRevision = {
                revisionId: `rev_${randomUUID()}`,
                documentId,
                sequence: this.state.nextSequence + 1,
                ...(current && { parentRevision: current.revisionId }),
                operation: 'upsert',
                contentHash: target.contentHash,
                byteLength: target.byteLength,
                author: boundedText(reviewer, 'reviewer', MAX_AUTHOR_LENGTH),
                reason: boundedText(reason, 'reason', MAX_REASON_LENGTH),
                origin: this.hubId,
                createdAt: new Date().toISOString(),
            };
            const revision = { ...unsignedRevision, signature: signPayload(unsignedRevision, this.signingPrivateKey) };
            await this.appendEvent('revision.restored', { revision });
            return this.state.revisions[revision.revisionId];
        });
    }
    async audit() {
        await this.ensureLoaded();
        const errors = [];
        let checkedObjects = 0;
        const revisions = Object.values(this.state.revisions);
        for (const revision of revisions) {
            try {
                normalizeId(revision.documentId, 'documentId');
                if (!revision.signature || !verifyPayload(withoutSignature(revision), revision.signature, createPublicKey(this.signingPublicKey)))
                    throw new Error('signature mismatch');
                if (revision.parentRevision) {
                    const parent = this.state.revisions[revision.parentRevision];
                    if (!parent || parent.documentId !== revision.documentId || parent.sequence >= revision.sequence)
                        errors.push(`invalid parent chain at ${revision.revisionId}`);
                }
                if (revision.operation === 'upsert') {
                    if (!revision.contentHash)
                        throw new Error('missing content hash');
                    const content = await readFile(this.objectPath(revision.contentHash), 'utf8');
                    checkedObjects += 1;
                    if (sha256(content) !== revision.contentHash || Buffer.byteLength(content, 'utf8') !== revision.byteLength)
                        errors.push(`content validation failed at ${revision.revisionId}`);
                }
            }
            catch (error) {
                errors.push(`${revision.revisionId}: ${error instanceof Error ? error.message : 'invalid revision'}`);
            }
        }
        for (const [documentId, revisionId] of Object.entries(this.state.heads)) {
            if (!this.state.revisions[revisionId] || this.state.revisions[revisionId].documentId !== documentId)
                errors.push(`head mismatch for ${documentId}`);
        }
        for (const proposal of Object.values(this.state.proposals)) {
            if (proposal.operation === 'upsert' && (!proposal.contentHash || !(await stat(this.objectPath(proposal.contentHash)).catch(() => undefined))))
                errors.push(`proposal object missing for ${proposal.proposalId}`);
        }
        return { ok: errors.length === 0, checkedRevisions: revisions.length, checkedObjects, errors: errors.slice(0, 100) };
    }
}
/** Small HTTP client used by a vault replica; it never sends User or Community paths. */
export class GlobalSyncClient {
    baseUrl;
    authToken;
    reviewerToken;
    adminToken;
    constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.authToken = boundedText(options.authToken, 'authToken', 4096);
        if (options.reviewerToken)
            this.reviewerToken = boundedText(options.reviewerToken, 'reviewerToken', 4096);
        if (options.adminToken)
            this.adminToken = boundedText(options.adminToken, 'adminToken', 4096);
    }
    async request(path, init = {}, credential = 'proposer') {
        const token = credential === 'reviewer' ? this.reviewerToken : credential === 'admin' ? this.adminToken : this.authToken;
        if (!token)
            throw new Error('reviewerToken is required for this operation');
        const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } });
        const body = await response.text();
        let value;
        try {
            value = body ? JSON.parse(body) : {};
        }
        catch {
            value = { error: body };
        }
        if (!response.ok)
            throw new Error(isRecord(value) && typeof value.error === 'string' ? value.error : `Global Sync HTTP ${response.status}`);
        return value;
    }
    getManifest(after = 0, limit) {
        const params = new URLSearchParams({ after: String(after), limit: String(normalizeLimit(limit)) });
        return this.request(`/v1/global/manifest?${params}`);
    }
    getRevision(revisionId) {
        return this.request(`/v1/global/revisions/${encodeURIComponent(revisionId)}`);
    }
    submitProposal(input) {
        return this.request('/v1/global/proposals', { method: 'POST', body: JSON.stringify(input) });
    }
    listProposals(status, limit) {
        const params = new URLSearchParams({ limit: String(normalizeLimit(limit)) });
        if (status)
            params.set('status', status);
        return this.request(`/v1/global/proposals?${params}`);
    }
    approveProposal(proposalId, reviewer, reason) {
        return this.request(`/v1/global/proposals/${encodeURIComponent(proposalId)}/approve`, { method: 'POST', body: JSON.stringify({ reviewer, reason }) }, 'reviewer');
    }
    rejectProposal(proposalId, reviewer, reason) {
        return this.request(`/v1/global/proposals/${encodeURIComponent(proposalId)}/reject`, { method: 'POST', body: JSON.stringify({ reviewer, reason }) }, 'reviewer');
    }
    restoreDocument(documentId, targetRevisionId, reviewer, reason, expectedCurrentRevision) {
        return this.request('/v1/global/restore', { method: 'POST', body: JSON.stringify({ documentId, targetRevisionId, reviewer, reason, expectedCurrentRevision }) }, 'reviewer');
    }
    rotateCredential(input) {
        return this.request('/v1/global/credentials/rotate', { method: 'POST', body: JSON.stringify(input) }, 'admin');
    }
    revokeCredential(kind, reviewerId) {
        return this.request('/v1/global/credentials/revoke', { method: 'POST', body: JSON.stringify({ kind, ...(reviewerId && { reviewerId }) }) }, 'admin');
    }
}
/** Pull-only replica. Local edits are never overwritten; remote tombstones are recoverable moves. */
export class GlobalSyncReplica {
    vaultPath;
    statePath;
    backupRoot;
    quarantineRoot;
    client;
    trustedPublicKey;
    state = { version: 1, cursor: 0, documents: {} };
    loaded = false;
    constructor(options) {
        this.vaultPath = resolve(options.vaultPath);
        this.statePath = join(this.vaultPath, '.mcpvault', 'global-sync-replica.json');
        this.backupRoot = join(this.vaultPath, '.mcpvault', 'global-sync-backups');
        this.quarantineRoot = join(this.vaultPath, '.mcpvault', 'global-sync-quarantine');
        this.client = options.client;
        this.trustedPublicKey = createPublicKey(options.trustedPublicKey);
    }
    async load() {
        if (this.loaded)
            return;
        try {
            const parsed = JSON.parse(await readFile(this.statePath, 'utf8'));
            if (isRecord(parsed) && parsed.version === 1 && typeof parsed.cursor === 'number' && isRecord(parsed.documents))
                this.state = parsed;
        }
        catch {
            // First pull starts from the beginning of the hub history.
        }
        this.loaded = true;
    }
    async save() {
        await writeAtomic(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`);
    }
    localPath(documentId) {
        const normalized = normalizeId(documentId, 'documentId');
        const path = resolve(this.vaultPath, normalized);
        const relativePath = relative(this.vaultPath, path).replace(/\\/g, '/');
        if (!relativePath || relativePath.startsWith('..'))
            throw new Error('Global document escaped vault root');
        return path;
    }
    async currentContent(path) {
        try {
            const content = await readFile(path, 'utf8');
            return { exists: true, content, hash: sha256(content) };
        }
        catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
                return { exists: false };
            throw error;
        }
    }
    async backup(path, documentId, sequence) {
        const backupPath = join(this.backupRoot, `${sequence}-${documentId.replace(/[^a-z0-9._-]+/gi, '_')}`);
        await mkdir(dirname(backupPath), { recursive: true });
        await copyFile(path, backupPath);
    }
    async pull(limit) {
        await this.load();
        const manifest = await this.client.getManifest(this.state.cursor, normalizeLimit(limit));
        if (manifest.protocol !== PROTOCOL || !Number.isSafeInteger(manifest.latestSequence) || manifest.latestSequence < this.state.cursor || !manifest.signature || !verifyPayload(withoutSignature(manifest), manifest.signature, this.trustedPublicKey)) {
            return { applied: [], conflicts: [{ documentId: '', revisionId: '', reason: 'Remote manifest failed protocol or signature validation.' }], cursor: this.state.cursor, hasMore: true };
        }
        if (manifest.entries.length > 0 && manifest.cursor !== manifest.entries.at(-1).sequence) {
            return { applied: [], conflicts: [{ documentId: '', revisionId: '', reason: 'Remote manifest cursor does not match its final entry.' }], cursor: this.state.cursor, hasMore: true };
        }
        let expectedSequence = this.state.cursor;
        const applied = [];
        const conflicts = [];
        for (const entry of manifest.entries) {
            if (!Number.isSafeInteger(entry.sequence) || entry.sequence <= expectedSequence) {
                conflicts.push({ documentId: entry.documentId, revisionId: entry.revisionId, reason: 'Remote manifest sequence is not strictly increasing.' });
                break;
            }
            const path = this.localPath(entry.documentId);
            const previous = this.state.documents[entry.documentId];
            const current = await this.currentContent(path);
            if (previous?.revisionId === entry.revisionId) {
                if (entry.operation === 'upsert' && current.hash !== previous.contentHash) {
                    conflicts.push({ documentId: entry.documentId, revisionId: entry.revisionId, reason: 'Local document changed after its last synchronized revision.' });
                    break;
                }
                this.state.cursor = entry.sequence;
                await this.save();
                continue;
            }
            if (entry.operation === 'upsert') {
                const revision = await this.client.getRevision(entry.revisionId);
                if (!revision.signature || !verifyPayload(withoutRevisionContent(revision), revision.signature, this.trustedPublicKey) || revision.revisionId !== entry.revisionId || revision.documentId !== entry.documentId || revision.sequence !== entry.sequence || revision.parentRevision !== entry.parentRevision || (previous?.revisionId || undefined) !== (revision.parentRevision || undefined) || revision.operation !== 'upsert' || typeof revision.content !== 'string' || !revision.contentHash || revision.byteLength !== Buffer.byteLength(revision.content, 'utf8') || sha256(revision.content) !== revision.contentHash || revision.contentHash !== entry.contentHash) {
                    conflicts.push({ documentId: entry.documentId, revisionId: entry.revisionId, reason: 'Remote revision failed identity or content-hash validation.' });
                    break;
                }
                const localDirty = current.exists && (!previous || current.hash !== previous.contentHash) && current.hash !== revision.contentHash;
                if (localDirty) {
                    conflicts.push({ documentId: entry.documentId, revisionId: entry.revisionId, reason: 'Local document has unsubmitted changes; remote content was not applied.' });
                    break;
                }
                if (current.exists && current.hash !== revision.contentHash)
                    await this.backup(path, entry.documentId, entry.sequence);
                await mkdir(dirname(path), { recursive: true });
                await writeAtomic(path, revision.content);
                this.state.documents[entry.documentId] = { revisionId: entry.revisionId, operation: 'upsert', contentHash: revision.contentHash };
            }
            else {
                const revision = await this.client.getRevision(entry.revisionId);
                if (!revision.signature || !verifyPayload(withoutRevisionContent(revision), revision.signature, this.trustedPublicKey) || revision.revisionId !== entry.revisionId || revision.documentId !== entry.documentId || revision.sequence !== entry.sequence || revision.parentRevision !== entry.parentRevision || (previous?.revisionId || undefined) !== (revision.parentRevision || undefined) || revision.operation !== 'tombstone' || revision.byteLength !== 0 || entry.contentHash !== undefined) {
                    conflicts.push({ documentId: entry.documentId, revisionId: entry.revisionId, reason: 'Remote tombstone failed identity, chain, or signature validation.' });
                    break;
                }
                const localDirty = current.exists && (!previous || current.hash !== previous.contentHash);
                if (localDirty) {
                    conflicts.push({ documentId: entry.documentId, revisionId: entry.revisionId, reason: 'Local document has unsubmitted changes; remote tombstone was not applied.' });
                    break;
                }
                if (current.exists) {
                    const quarantinePath = join(this.quarantineRoot, `${entry.sequence}-${entry.documentId.replace(/[^a-z0-9._-]+/gi, '_')}`);
                    await mkdir(dirname(quarantinePath), { recursive: true });
                    await rename(path, quarantinePath);
                }
                this.state.documents[entry.documentId] = { revisionId: entry.revisionId, operation: 'tombstone' };
            }
            this.state.cursor = entry.sequence;
            expectedSequence = entry.sequence;
            await this.save();
            applied.push(entry.documentId);
        }
        return { applied, conflicts, cursor: this.state.cursor, hasMore: manifest.hasMore || conflicts.length > 0 };
    }
    async proposeLocal(documentId, author, reason, origin) {
        await this.load();
        const normalized = normalizeId(documentId, 'documentId');
        const current = await this.currentContent(this.localPath(normalized));
        if (!current.exists || current.content === undefined)
            throw new Error('local Global document does not exist');
        return this.client.submitProposal({ documentId: normalized, ...(this.state.documents[normalized]?.revisionId && { parentRevision: this.state.documents[normalized].revisionId }), operation: 'upsert', content: current.content, author, reason, origin });
    }
    async proposeTombstone(documentId, author, reason, origin) {
        await this.load();
        const normalized = normalizeId(documentId, 'documentId');
        return this.client.submitProposal({ documentId: normalized, ...(this.state.documents[normalized]?.revisionId && { parentRevision: this.state.documents[normalized].revisionId }), operation: 'tombstone', author, reason, origin });
    }
}
function bearer(request) {
    const value = request.headers.authorization;
    return typeof value === 'string' && /^Bearer\s+/i.test(value) ? value.replace(/^Bearer\s+/i, '').trim() : undefined;
}
function constantTimeEqual(left, right) {
    if (!left)
        return false;
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}
function secretDigest(value) {
    return createHash('sha256').update(value, 'utf8').digest();
}
function constantTimeDigestEqual(left, right) {
    return left.length === right.length && timingSafeEqual(left, right);
}
async function jsonBody(request, maxBytes) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > maxBytes)
            throw new Error(`request body exceeds ${maxBytes} bytes`);
        chunks.push(buffer);
    }
    if (!chunks.length)
        return {};
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!isRecord(parsed))
        throw new Error('request body must be a JSON object');
    return parsed;
}
function sendJson(response, status, value) {
    const body = JSON.stringify(value);
    response.statusCode = status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.end(body);
}
async function appendCredentialAudit(path, action, kind, reviewerId) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const entry = {
        timestamp: new Date().toISOString(),
        action,
        kind,
        ...(reviewerId && { reviewerId }),
    };
    await appendFile(path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
}
function pathParam(pathname, prefix) {
    return pathname.startsWith(prefix) ? decodeURIComponent(pathname.slice(prefix.length).replace(/^\/+/, '')) : undefined;
}
/** Optional standalone HTTP control plane for a GlobalSyncHub. */
export async function startGlobalSyncHub(root, options) {
    const authToken = boundedText(options.authToken, 'authToken', 4096);
    const reviewerToken = boundedText(options.reviewerToken, 'reviewerToken', 4096);
    if (constantTimeEqual(authToken, reviewerToken))
        throw new Error('authToken and reviewerToken must be different');
    const authCredential = { digest: secretDigest(authToken) };
    const authExpiry = normalizeExpiry(options.authTokenExpiresAt, 'authTokenExpiresAt');
    if (authExpiry !== undefined)
        authCredential.expiresAt = authExpiry;
    const reviewerTokens = new Map([['reviewer', { digest: secretDigest(reviewerToken) }]]);
    const primaryReviewerExpiry = normalizeExpiry(options.reviewerTokenExpiresAt?.reviewer, 'reviewerTokenExpiresAt.reviewer');
    if (primaryReviewerExpiry !== undefined)
        reviewerTokens.get('reviewer').expiresAt = primaryReviewerExpiry;
    let adminCredential;
    if (options.adminToken) {
        const adminToken = boundedText(options.adminToken, 'adminToken', 4096);
        if (constantTimeEqual(authToken, adminToken) || constantTimeEqual(reviewerToken, adminToken))
            throw new Error('adminToken must differ from other credentials');
        adminCredential = { digest: secretDigest(adminToken) };
        const adminExpiry = normalizeExpiry(options.adminTokenExpiresAt, 'adminTokenExpiresAt');
        if (adminExpiry !== undefined)
            adminCredential.expiresAt = adminExpiry;
    }
    for (const [reviewerId, token] of Object.entries(options.reviewerTokens || {})) {
        const id = boundedText(reviewerId, 'reviewerId', MAX_AUTHOR_LENGTH);
        if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id))
            throw new Error('reviewerId must be a lowercase identifier');
        const normalizedToken = boundedText(token, `reviewerTokens.${id}`, 4096);
        if (constantTimeEqual(authToken, normalizedToken))
            throw new Error('reviewer tokens must differ from authToken');
        const normalizedTokenDigest = secretDigest(normalizedToken);
        if ([...reviewerTokens.values()].some(existing => existing.digest && constantTimeDigestEqual(existing.digest, normalizedTokenDigest)))
            throw new Error('reviewer tokens must be unique');
        const expiry = normalizeExpiry(options.reviewerTokenExpiresAt?.[id], `reviewerTokenExpiresAt.${id}`);
        const credential = { digest: normalizedTokenDigest };
        if (expiry !== undefined)
            credential.expiresAt = expiry;
        reviewerTokens.set(id, credential);
    }
    const credentialStatePath = resolve(options.credentialStatePath || join(resolve(root), 'credentials.json'));
    const credentialAuditPath = resolve(options.credentialAuditPath || join(resolve(root), 'credential-audit.ndjson'));
    const credentialLockPath = resolve(options.credentialLockPath || join(resolve(root), 'credentials.lock'));
    const persistCredentialState = async () => {
        await writeAtomic(credentialStatePath, `${JSON.stringify(serializeCredentialStore(authCredential, reviewerTokens, adminCredential), null, 2)}\n`);
    };
    const signingKeyPath = resolve(options.signingKeyPath || join(resolve(root), 'signing-key.pem'));
    // HTTP callers must never be able to choose the command-center origin by
    // putting a different value in the proposal JSON. A library caller may
    // explicitly configure it; otherwise bind it to the configured hub id.
    const proposerOrigin = boundedText(options.proposerOrigin || options.hubId || 'global-hub', 'proposerOrigin', MAX_ORIGIN_LENGTH).toLowerCase();
    let signingPrivateKey;
    const credentialLock = await acquireProcessLock(credentialLockPath);
    try {
        const persistedCredentials = await loadCredentialStore(credentialStatePath);
        if (persistedCredentials) {
            if (persistedCredentials.proposer) {
                const restored = deserializeCredential(persistedCredentials.proposer, 'proposer');
                authCredential.digest = restored.digest;
                if (restored.expiresAt === undefined)
                    delete authCredential.expiresAt;
                else
                    authCredential.expiresAt = restored.expiresAt;
            }
            else {
                delete authCredential.digest;
                delete authCredential.expiresAt;
            }
            reviewerTokens.clear();
            for (const [reviewerId, credential] of Object.entries(persistedCredentials.reviewers))
                reviewerTokens.set(reviewerId, deserializeCredential(credential, `reviewers.${reviewerId}`));
            if (persistedCredentials.admin)
                adminCredential = deserializeCredential(persistedCredentials.admin, 'admin');
            else
                adminCredential = undefined;
        }
        else {
            await persistCredentialState();
        }
        const activeCredentialDigests = [];
        if (authCredential.digest)
            activeCredentialDigests.push(authCredential.digest);
        if (adminCredential?.digest)
            activeCredentialDigests.push(adminCredential.digest);
        for (const credential of reviewerTokens.values())
            if (credential.digest)
                activeCredentialDigests.push(credential.digest);
        if (new Set(activeCredentialDigests.map(digest => digest.toString('base64url'))).size !== activeCredentialDigests.length)
            throw new Error('credential state contains duplicate active credentials');
        try {
            signingPrivateKey = await readFile(signingKeyPath, 'utf8');
        }
        catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
                throw error;
            const generated = generateGlobalSyncSigningKeyPair().privateKey;
            await mkdir(dirname(signingKeyPath), { recursive: true, mode: 0o700 });
            try {
                await writeFile(signingKeyPath, generated, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
                signingPrivateKey = generated;
            }
            catch (writeError) {
                if (!(writeError && typeof writeError === 'object' && 'code' in writeError && writeError.code === 'EEXIST'))
                    throw writeError;
                signingPrivateKey = await readFile(signingKeyPath, 'utf8');
            }
        }
    }
    finally {
        await releaseProcessLock(credentialLock);
    }
    const processLockPath = resolve(options.processLockPath || join(resolve(root), 'hub.lock'));
    const hub = new GlobalSyncHub(root, { ...(options.hubId && { hubId: options.hubId }), signingPrivateKey: signingPrivateKey, processLockPath, ...(options.maxTotalContentBytes !== undefined && { maxTotalContentBytes: options.maxTotalContentBytes }) });
    await hub.getManifest(0, 1);
    const host = options.host || '127.0.0.1';
    const maxBodyBytes = Math.min(Math.max(Math.trunc(options.maxBodyBytes ?? 2 * 1024 * 1024), 1024), 2 * 1024 * 1024);
    const requestWindows = new Map();
    const reviewerFor = (token) => {
        if (!token)
            return undefined;
        const digest = secretDigest(token);
        for (const [reviewerId, reviewerCredential] of reviewerTokens)
            if (credentialActive(reviewerCredential) && reviewerCredential.digest && constantTimeDigestEqual(digest, reviewerCredential.digest))
                return reviewerId;
        return undefined;
    };
    const allowedByRate = (key) => {
        const now = Date.now();
        const current = requestWindows.get(key);
        if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
            if (requestWindows.size >= MAX_RATE_BUCKETS) {
                for (const [bucket, value] of requestWindows) {
                    if (now - value.startedAt >= RATE_WINDOW_MS)
                        requestWindows.delete(bucket);
                    if (requestWindows.size < MAX_RATE_BUCKETS)
                        break;
                }
            }
            if (requestWindows.size >= MAX_RATE_BUCKETS && !requestWindows.has(key))
                return false;
            requestWindows.set(key, { startedAt: now, count: 1 });
            return true;
        }
        if (current.count >= MAX_HTTP_REQUESTS_PER_MINUTE)
            return false;
        current.count += 1;
        return true;
    };
    const sameAsConfiguredCredential = (digest, exceptReviewerId) => {
        if (authCredential.digest && constantTimeDigestEqual(digest, authCredential.digest))
            return true;
        if (adminCredential?.digest && constantTimeDigestEqual(digest, adminCredential.digest))
            return true;
        for (const [reviewerId, credential] of reviewerTokens) {
            if (reviewerId !== exceptReviewerId && credential.digest && constantTimeDigestEqual(digest, credential.digest))
                return true;
        }
        return false;
    };
    const rotateCredential = async (body) => {
        const kind = body.kind;
        if (kind !== 'proposer' && kind !== 'reviewer' && kind !== 'admin')
            throw new Error('kind must be proposer, reviewer, or admin');
        if (typeof body.token !== 'string')
            throw new Error('token is required');
        const token = boundedText(body.token, 'token', 4096);
        const digest = secretDigest(token);
        const reviewerId = kind === 'reviewer' ? boundedText(String(body.reviewerId || ''), 'reviewerId', MAX_AUTHOR_LENGTH) : undefined;
        if (reviewerId && !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(reviewerId))
            throw new Error('reviewerId must be a lowercase identifier');
        if (sameAsConfiguredCredential(digest, reviewerId))
            throw new Error('token must be unique across active credentials');
        const expiresAt = normalizeExpiry(body.expiresAt, 'expiresAt');
        const previousAuthDigest = authCredential.digest;
        const previousAuthExpiry = authCredential.expiresAt;
        const previousReviewers = new Map(reviewerTokens);
        const previousAdmin = adminCredential;
        if (kind === 'proposer') {
            authCredential.digest = digest;
            if (expiresAt === undefined)
                delete authCredential.expiresAt;
            else
                authCredential.expiresAt = expiresAt;
        }
        else if (kind === 'reviewer') {
            reviewerTokens.set(reviewerId, { digest, ...(expiresAt !== undefined && { expiresAt }) });
        }
        else {
            adminCredential = { digest, ...(expiresAt !== undefined && { expiresAt }) };
        }
        try {
            await persistCredentialState();
        }
        catch (error) {
            if (previousAuthDigest)
                authCredential.digest = previousAuthDigest;
            else
                delete authCredential.digest;
            if (previousAuthExpiry === undefined)
                delete authCredential.expiresAt;
            else
                authCredential.expiresAt = previousAuthExpiry;
            reviewerTokens.clear();
            for (const [reviewerId, credential] of previousReviewers)
                reviewerTokens.set(reviewerId, credential);
            adminCredential = previousAdmin;
            throw error;
        }
        await appendCredentialAudit(credentialAuditPath, 'rotate', kind, reviewerId);
    };
    const revokeCredential = async (body) => {
        const kind = body.kind;
        const previousAuthDigest = authCredential.digest;
        const previousAuthExpiry = authCredential.expiresAt;
        const previousReviewers = new Map(reviewerTokens);
        const previousAdmin = adminCredential;
        let reviewerId;
        if (kind === 'proposer') {
            delete authCredential.digest;
            delete authCredential.expiresAt;
        }
        else if (kind === 'reviewer') {
            reviewerId = boundedText(String(body.reviewerId || ''), 'reviewerId', MAX_AUTHOR_LENGTH);
            if (!reviewerTokens.delete(reviewerId))
                throw new Error('reviewer credential not found');
        }
        else if (kind === 'admin') {
            adminCredential = undefined;
        }
        else {
            throw new Error('kind must be proposer, reviewer, or admin');
        }
        try {
            await persistCredentialState();
        }
        catch (error) {
            if (previousAuthDigest)
                authCredential.digest = previousAuthDigest;
            else
                delete authCredential.digest;
            if (previousAuthExpiry === undefined)
                delete authCredential.expiresAt;
            else
                authCredential.expiresAt = previousAuthExpiry;
            reviewerTokens.clear();
            for (const [previousReviewerId, credential] of previousReviewers)
                reviewerTokens.set(previousReviewerId, credential);
            adminCredential = previousAdmin;
            throw error;
        }
        await appendCredentialAudit(credentialAuditPath, 'revoke', kind, reviewerId);
    };
    let credentialMutationTail = Promise.resolve();
    const withCredentialMutation = async (task) => {
        const previous = credentialMutationTail;
        let release;
        credentialMutationTail = new Promise(resolvePromise => { release = resolvePromise; });
        await previous;
        try {
            await task();
        }
        finally {
            release();
        }
    };
    const requestHandler = async (request, response) => {
        try {
            const url = new URL(request.url || '/', `http://${host}`);
            const reviewerRoute = url.pathname === '/v1/global/audit' || (request.method === 'POST' && (url.pathname === '/v1/global/restore' || /\/v1\/global\/proposals\/[^/]+\/(?:approve|reject)$/.test(url.pathname)));
            const adminRoute = request.method === 'POST' && (url.pathname === '/v1/global/credentials/rotate' || url.pathname === '/v1/global/credentials/revoke');
            const token = bearer(request);
            if (adminRoute) {
                if (!adminCredential?.digest || !token || !credentialActive(adminCredential) || !constantTimeDigestEqual(secretDigest(token), adminCredential.digest)) {
                    sendJson(response, 401, { error: 'Unauthorized' });
                    return;
                }
                if (!allowedByRate(`${request.socket.remoteAddress || 'unknown'}:admin`)) {
                    sendJson(response, 429, { error: 'Rate limit exceeded; retry later' });
                    return;
                }
                const body = await jsonBody(request, maxBodyBytes);
                await withCredentialMutation(() => url.pathname.endsWith('/rotate') ? rotateCredential(body) : revokeCredential(body));
                sendJson(response, 200, { ok: true });
                return;
            }
            const reviewerId = reviewerFor(token);
            if (reviewerRoute ? !reviewerId : !token || !credentialActive(authCredential) || !authCredential.digest || !constantTimeDigestEqual(secretDigest(token), authCredential.digest)) {
                sendJson(response, 401, { error: 'Unauthorized' });
                return;
            }
            if (!allowedByRate(`${request.socket.remoteAddress || 'unknown'}:${reviewerId || 'proposer'}`)) {
                sendJson(response, 429, { error: 'Rate limit exceeded; retry later' });
                return;
            }
            if (request.method === 'GET' && url.pathname === '/healthz') {
                sendJson(response, 200, { ok: true, protocol: PROTOCOL });
                return;
            }
            if (request.method === 'GET' && url.pathname === '/v1/global/manifest') {
                sendJson(response, 200, await hub.getManifest(Number(url.searchParams.get('after') || 0), Number(url.searchParams.get('limit') || DEFAULT_BATCH_LIMIT)));
                return;
            }
            if (request.method === 'GET' && url.pathname === '/v1/global/proposals') {
                const status = url.searchParams.get('status');
                sendJson(response, 200, await hub.listProposals(status || undefined, Number(url.searchParams.get('limit') || DEFAULT_BATCH_LIMIT)));
                return;
            }
            const revisionId = pathParam(url.pathname, '/v1/global/revisions/');
            if (request.method === 'GET' && revisionId) {
                sendJson(response, 200, await hub.getRevision(revisionId));
                return;
            }
            if (request.method === 'POST' && url.pathname === '/v1/global/proposals') {
                const body = await jsonBody(request, maxBodyBytes);
                sendJson(response, 201, await hub.submitProposal({ ...body, ...(proposerOrigin && { origin: proposerOrigin }) }));
                return;
            }
            const proposalId = pathParam(url.pathname, '/v1/global/proposals/');
            if (request.method === 'POST' && proposalId?.endsWith('/approve')) {
                const body = await jsonBody(request, maxBodyBytes);
                sendJson(response, 200, await hub.approveProposal(proposalId.slice(0, -'/approve'.length), reviewerId, String(body.reason || '')));
                return;
            }
            if (request.method === 'POST' && proposalId?.endsWith('/reject')) {
                const body = await jsonBody(request, maxBodyBytes);
                sendJson(response, 200, await hub.rejectProposal(proposalId.slice(0, -'/reject'.length), reviewerId, String(body.reason || '')));
                return;
            }
            if (request.method === 'POST' && url.pathname === '/v1/global/restore') {
                const body = await jsonBody(request, maxBodyBytes);
                sendJson(response, 200, await hub.restoreDocument(String(body.documentId || ''), String(body.targetRevisionId || ''), reviewerId, String(body.reason || ''), typeof body.expectedCurrentRevision === 'string' ? body.expectedCurrentRevision : undefined));
                return;
            }
            if ((request.method === 'GET' || request.method === 'POST') && url.pathname === '/v1/global/audit') {
                sendJson(response, 200, await hub.audit());
                return;
            }
            response.statusCode = 404;
            response.end('Not found');
        }
        catch (error) {
            sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad request' });
        }
    };
    const server = options.tls
        ? createHttpsServer({ key: options.tls.key, cert: options.tls.cert, ...(options.tls.ca && { ca: options.tls.ca }), requestCert: options.tls.requestCert ?? Boolean(options.tls.ca), rejectUnauthorized: options.tls.rejectUnauthorized ?? Boolean(options.tls.ca) }, requestHandler)
        : createHttpServer(requestHandler);
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.maxHeadersCount = 64;
    server.maxRequestsPerSocket = 100;
    server.maxConnections = Math.min(Math.max(Math.trunc(options.maxConnections ?? 256), 1), 2_048);
    try {
        await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, () => { server.off('error', reject); resolvePromise(); }); });
    }
    catch (error) {
        await hub.close().catch(() => undefined);
        throw error;
    }
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : options.port || 0;
    return { server, host, port, hub, close: async () => {
            await new Promise((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
            await hub.close();
        } };
}
