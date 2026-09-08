import { guidanceError } from './guidance-runtime.js';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { mkdir, open, readFile, readdir, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ensureFederationDirectory, readFederationFile, writeFederationFileAtomic } from './public-federation-storage.js';

export const PUBLIC_FEDERATION_PROTOCOL = 'mcpvault-public-federation/v1' as const;
const MAX_RECORD_BYTES = 64 * 1024;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_TEXT = 32 * 1024;
const MAX_IDEMPOTENCY_KEY = 128;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export interface PublicFederationIdentity {
  origin: string;
  agentId: string;
  role?: 'publisher' | 'moderator';
}

interface PublicRecordBase {
  protocol: typeof PUBLIC_FEDERATION_PROTOCOL;
  version: 1;
  recordId: string;
  actorId: string;
  revision: number;
}

export interface PublicActorRecord extends PublicRecordBase {
  type: 'actor';
  origin: string;
  agentId: string;
}

export interface PublicProfileRecord extends PublicRecordBase {
  type: 'profile';
  displayName: string;
  bio?: string;
}

export interface PublicPostRecord extends PublicRecordBase {
  type: 'post';
  objectId: string;
  title: string;
  body: string;
}

export interface PublicCommentRecord extends PublicRecordBase {
  type: 'comment';
  objectId: string;
  postId: string;
  replyTo?: string;
  body: string;
}

export interface PublicUpdateRecord extends PublicRecordBase {
  type: 'update';
  objectId: string;
  targetObjectId: string;
  title?: string;
  body?: string;
  displayName?: string;
  bio?: string;
}

export interface PublicTombstoneRecord extends PublicRecordBase {
  type: 'tombstone';
  objectId: string;
  targetObjectId: string;
  reason: string;
}

export type PublicFederationRecord =
  | PublicActorRecord
  | PublicProfileRecord
  | PublicPostRecord
  | PublicCommentRecord
  | PublicUpdateRecord
  | PublicTombstoneRecord;

export type PublicPublishInput =
  | { type: 'actor'; actorId: string; expectedRevision: 0 }
  | { type: 'profile'; actorId: string; expectedRevision: number; displayName: string; bio?: string }
  | { type: 'post'; objectId: string; actorId: string; expectedRevision: 0; title: string; body: string }
  | { type: 'comment'; objectId: string; actorId: string; expectedRevision: 0; postId: string; replyTo?: string; body: string }
  | { type: 'update'; objectId: string; actorId: string; targetObjectId: string; expectedRevision: number; title?: string; body?: string; displayName?: string; bio?: string }
  | { type: 'tombstone'; objectId: string; actorId: string; targetObjectId: string; expectedRevision: number; reason: string };

export interface PublicModerationInput {
  objectId: string;
  action: 'hide' | 'restore';
  reason: string;
  expectedRevision: number;
}

export interface PublicModerationRecord {
  protocol: typeof PUBLIC_FEDERATION_PROTOCOL;
  version: 1;
  type: 'moderation';
  recordId: string;
  objectId: string;
  action: 'hide' | 'restore';
  reason: string;
  moderator: PublicFederationIdentity;
  revision: number;
}

export interface PublicFederationEvent {
  eventId: string;
  sequence: number;
  previousHash: string;
  record: PublicFederationRecord | PublicModerationRecord;
  status: 'active' | 'pending-parent';
  publishedAt: string;
  idempotencyHash: string;
  eventHash: string;
  signature: string;
}

export interface PublicFederationFeed {
  protocol: typeof PUBLIC_FEDERATION_PROTOCOL;
  hubId: string;
  after: number;
  anchorHash: string;
  cursor: number;
  latestSequence: number;
  hasMore: boolean;
  events: PublicFederationEvent[];
  signature: string;
}

export interface PublicFederationHubOptions {
  hubId?: string;
  signingPrivateKey?: string;
  maxRecords?: number;
}

interface ObjectState {
  actorId: string;
  kind: 'actor' | 'profile' | 'post' | 'comment';
  revision: number;
  tombstoned: boolean;
  globallyHidden: boolean;
  moderationRevision: number;
  parentIds: string[];
  latest: PublicFederationRecord;
}

interface IdempotencyState {
  payloadHash: string;
  eventId: string;
}

interface ProcessLock {
  handle: FileHandle;
  nonce: string;
  path: string;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH');
  }
}

async function acquireProcessLock(path: string): Promise<ProcessLock> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const nonce = randomUUID();
    try {
      const handle = await open(path, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, nonce, startedAt: new Date().toISOString() })}\n`, 'utf8');
        await handle.sync();
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(path).catch(() => undefined);
        throw error;
      }
      return { handle, nonce, path };
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
      let raw: string;
      try { raw = await readFile(path, 'utf8'); } catch (readError) {
        if (readError && typeof readError === 'object' && 'code' in readError && readError.code === 'ENOENT') continue;
        throw readError;
      }
      let record: unknown;
      try { record = JSON.parse(raw); } catch { throw guidanceError(new Error('Public Federation process lock is corrupt; refusing to remove it automatically'), 'guid-97ff5ba4b1458912'); }
      if (!record || typeof record !== 'object' || Array.isArray(record)
        || !Number.isSafeInteger((record as Record<string, unknown>).pid) || Number((record as Record<string, unknown>).pid) <= 0
        || typeof (record as Record<string, unknown>).nonce !== 'string' || !(record as Record<string, unknown>).nonce) {
        throw guidanceError(new Error('Public Federation process lock is invalid; refusing to remove it automatically'), 'guid-bb2ad9ac925fc9bb');
      }
      const pid = Number((record as Record<string, unknown>).pid);
      if (processIsAlive(pid)) throw guidanceError(new Error(`Public Federation storage is already in use by process ${pid}`), 'guid-2ce2dec3f3d41a3d');
      await unlink(path);
    }
  }
  throw guidanceError(new Error('Unable to acquire Public Federation process lock'), 'guid-e4f97aded2ce88ef');
}

async function releaseProcessLock(lock: ProcessLock): Promise<void> {
  await lock.handle.close().catch(() => undefined);
  try {
    const record = JSON.parse(await readFile(lock.path, 'utf8')) as Record<string, unknown>;
    if (record.nonce === lock.nonce) await unlink(lock.path);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function unsignedEvent(event: PublicFederationEvent): Omit<PublicFederationEvent, 'eventHash' | 'signature'> {
  const { eventHash: _hash, signature: _signature, ...unsigned } = event;
  return unsigned;
}

function unsignedFeed(feed: PublicFederationFeed): Omit<PublicFederationFeed, 'signature'> {
  const { signature: _signature, ...unsigned } = feed;
  return unsigned;
}

function signValue(value: unknown, privateKey: KeyObject): string {
  return sign(null, Buffer.from(canonical(value), 'utf8'), privateKey).toString('base64url');
}

function verifyValue(value: unknown, signature: string, publicKey: KeyObject): boolean {
  try {
    return verify(null, Buffer.from(canonical(value), 'utf8'), publicKey, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

function boundedId(value: string, field: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!ID_PATTERN.test(normalized)) throw guidanceError(new Error(`${field} must be a lowercase opaque identifier`), 'guid-2e550a2ac3b1c100');
  return normalized;
}

function boundedText(value: string, field: string, max = MAX_TEXT): string {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw guidanceError(new Error(`${field} is required and must be at most ${max} characters`), 'guid-600d6a2929171008');
  if (/\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw guidanceError(new Error(`${field} contains unsupported control characters`), 'guid-5e267e1e9c837924');
  return text;
}

function normalizeIdentity(identity: PublicFederationIdentity): PublicFederationIdentity {
  return {
    origin: boundedId(identity.origin, 'origin'),
    agentId: boundedId(identity.agentId, 'agentId'),
    ...(identity.role && { role: identity.role }),
  };
}

export function makePublicActorId(origin: string, agentId: string): string {
  return `actor:${boundedId(origin, 'origin')}:${boundedId(agentId, 'agentId')}`;
}

export function makePublicObjectId(kind: 'post' | 'comment' | 'update' | 'tombstone', origin: string, agentId: string, localId: string): string {
  return `${kind}:${boundedId(origin, 'origin')}:${boundedId(agentId, 'agentId')}:${boundedId(localId, 'localId')}`;
}

function profileId(identity: PublicFederationIdentity): string {
  return `profile:${identity.origin}:${identity.agentId}`;
}

function expectedObjectId(kind: string, identity: PublicFederationIdentity, actual: string): void {
  const prefix = `${kind}:${identity.origin}:${identity.agentId}:`;
  if (!actual.startsWith(prefix) || actual.length > 512 || !/^[a-z0-9:._-]+$/.test(actual)) throw guidanceError(new Error(`${kind} objectId is not owned by the authenticated actor`), 'guid-9e884c4b2aa47849');
}

function rejectPrivateReferences(value: string, field: string): void {
  const normalized = value.replace(/\\/g, '/');
  if (/(?:^|[\[(/\s])(?:community|user|users|_scopes|_whispers|\.mcpvault|\.git)(?:\/|\]\]|\s|$)/i.test(normalized)) {
    throw guidanceError(new Error(`${field} contains a private or instance-local reference`), 'guid-7c7566fa40431867');
  }
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(value).find(key => !allowedSet.has(key));
  if (extra) throw guidanceError(new Error(`public record contains unsupported or private field: ${extra}`), 'guid-8b9571302dbfe05b');
}

function normalizeExpectedRevision(value: number, allowZero: boolean): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw guidanceError(new Error('expectedRevision is invalid'), 'guid-0ab6244a003a3452');
  return value;
}

function normalizeInput(input: PublicPublishInput, rawIdentity: PublicFederationIdentity): PublicFederationRecord {
  if (!input || typeof input !== 'object') throw guidanceError(new Error('public record must be an object'), 'guid-e09ffebab930ca56');
  const identity = normalizeIdentity(rawIdentity);
  const actorId = makePublicActorId(identity.origin, identity.agentId);
  if (input.actorId !== actorId) throw guidanceError(new Error('actorId is not owned by the authenticated origin and agent'), 'guid-15eb73725eb7f881');
  const common = { protocol: PUBLIC_FEDERATION_PROTOCOL, version: 1 as const, actorId };
  if (input.type === 'actor') {
    assertExactKeys(input as unknown as Record<string, unknown>, ['type', 'actorId', 'expectedRevision']);
    normalizeExpectedRevision(input.expectedRevision, true);
    return { ...common, type: 'actor', recordId: actorId, revision: 1, origin: identity.origin, agentId: identity.agentId };
  }
  if (input.type === 'profile') {
    assertExactKeys(input as unknown as Record<string, unknown>, ['type', 'actorId', 'expectedRevision', 'displayName', 'bio']);
    const displayName = boundedText(input.displayName, 'displayName', 128);
    const bio = input.bio === undefined ? undefined : boundedText(input.bio, 'bio', 2_000);
    rejectPrivateReferences(displayName, 'displayName');
    if (bio) rejectPrivateReferences(bio, 'bio');
    return { ...common, type: 'profile', recordId: profileId(identity), revision: normalizeExpectedRevision(input.expectedRevision, true) + 1, displayName, ...(bio && { bio }) };
  }
  if (input.type === 'post') {
    assertExactKeys(input as unknown as Record<string, unknown>, ['type', 'objectId', 'actorId', 'expectedRevision', 'title', 'body']);
    expectedObjectId('post', identity, input.objectId);
    normalizeExpectedRevision(input.expectedRevision, true);
    const title = boundedText(input.title, 'title', 240);
    const body = boundedText(input.body, 'body');
    rejectPrivateReferences(title, 'title');
    rejectPrivateReferences(body, 'body');
    return { ...common, type: 'post', recordId: input.objectId, objectId: input.objectId, revision: 1, title, body };
  }
  if (input.type === 'comment') {
    assertExactKeys(input as unknown as Record<string, unknown>, ['type', 'objectId', 'actorId', 'expectedRevision', 'postId', 'replyTo', 'body']);
    expectedObjectId('comment', identity, input.objectId);
    normalizeExpectedRevision(input.expectedRevision, true);
    const postId = boundedText(input.postId, 'postId', 512).toLowerCase();
    const replyTo = input.replyTo === undefined ? undefined : boundedText(input.replyTo, 'replyTo', 512).toLowerCase();
    if (!postId.startsWith('post:') || (replyTo && !replyTo.startsWith('comment:'))) throw guidanceError(new Error('comment parent IDs are invalid'), 'guid-6c483f4ad377b173');
    const body = boundedText(input.body, 'body');
    rejectPrivateReferences(body, 'body');
    return { ...common, type: 'comment', recordId: input.objectId, objectId: input.objectId, revision: 1, postId, ...(replyTo && { replyTo }), body };
  }
  if (input.type === 'update') {
    assertExactKeys(input as unknown as Record<string, unknown>, ['type', 'objectId', 'actorId', 'targetObjectId', 'expectedRevision', 'title', 'body', 'displayName', 'bio']);
    expectedObjectId('update', identity, input.objectId);
    const revision = normalizeExpectedRevision(input.expectedRevision, false) + 1;
    const fields = {
      ...(input.title !== undefined && { title: boundedText(input.title, 'title', 240) }),
      ...(input.body !== undefined && { body: boundedText(input.body, 'body') }),
      ...(input.displayName !== undefined && { displayName: boundedText(input.displayName, 'displayName', 128) }),
      ...(input.bio !== undefined && { bio: boundedText(input.bio, 'bio', 2_000) }),
    };
    if (Object.keys(fields).length === 0) throw guidanceError(new Error('update requires a public field'), 'guid-526494c833cd7ec7');
    for (const [field, value] of Object.entries(fields)) rejectPrivateReferences(value, field);
    return { ...common, type: 'update', recordId: input.objectId, objectId: input.objectId, targetObjectId: boundedText(input.targetObjectId, 'targetObjectId', 512).toLowerCase(), revision, ...fields };
  }
  if (input.type === 'tombstone') {
    assertExactKeys(input as unknown as Record<string, unknown>, ['type', 'objectId', 'actorId', 'targetObjectId', 'expectedRevision', 'reason']);
    expectedObjectId('tombstone', identity, input.objectId);
    return { ...common, type: 'tombstone', recordId: input.objectId, objectId: input.objectId, targetObjectId: boundedText(input.targetObjectId, 'targetObjectId', 512).toLowerCase(), revision: normalizeExpectedRevision(input.expectedRevision, false) + 1, reason: boundedText(input.reason, 'reason', 500) };
  }
  throw guidanceError(new Error('unsupported public record type'), 'guid-051b31a1527a1f2f');
}

/** Pure transport preflight used before a local SocialService mutation. */
export function validatePublicPublishInput(input: PublicPublishInput, identity: PublicFederationIdentity): PublicFederationRecord {
  return normalizeInput(input, identity);
}

function eventMarkdown(event: PublicFederationEvent): string {
  const summary = event.record.type === 'post' ? event.record.title : `${event.record.type} ${event.record.recordId}`;
  return `---\nprotocol: ${PUBLIC_FEDERATION_PROTOCOL}\nsequence: ${event.sequence}\nevent_id: ${event.eventId}\nrecord_type: ${event.record.type}\nstatus: ${event.status}\n---\n# ${summary.replace(/[\r\n#]/g, ' ')}\n\n\`\`\`json public-federation-record\n${JSON.stringify(event)}\n\`\`\`\n`;
}

function parseEventMarkdown(content: string): PublicFederationEvent {
  const match = content.match(/```json public-federation-record\r?\n([^\r\n]+)\r?\n```/);
  if (!match?.[1]) throw guidanceError(new Error('public federation record Markdown is invalid'), 'guid-13525993d3b358a5');
  return JSON.parse(match[1]) as PublicFederationEvent;
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isSafeInteger(limit) || Number(limit) < 1) return DEFAULT_PAGE_LIMIT;
  return Math.min(Number(limit), MAX_PAGE_LIMIT);
}

export function verifyPublicFederationEvent(event: PublicFederationEvent, publicKeyPem: string): boolean {
  try {
    const unsigned = unsignedEvent(event);
    return Number.isSafeInteger(event.sequence) && event.sequence > 0
      && event.eventHash === sha256(canonical(unsigned))
      && verifyValue(unsigned, event.signature, createPublicKey(publicKeyPem));
  } catch { return false; }
}

export function verifyPublicFederationFeed(feed: PublicFederationFeed, publicKeyPem: string): boolean {
  try {
    const publicKey = createPublicKey(publicKeyPem);
    if (feed.protocol !== PUBLIC_FEDERATION_PROTOCOL || !verifyValue(unsignedFeed(feed), feed.signature, publicKey)) return false;
    let previousSequence = feed.after;
    let previousHash = feed.anchorHash;
    for (const event of feed.events) {
      const unsigned = unsignedEvent(event);
      if (event.sequence !== previousSequence + 1 || event.previousHash !== previousHash || event.eventHash !== sha256(canonical(unsigned)) || !verifyValue(unsigned, event.signature, publicKey)) return false;
      previousSequence = event.sequence;
      previousHash = event.eventHash;
    }
    return feed.cursor === (feed.events.at(-1)?.sequence ?? feed.after);
  } catch {
    return false;
  }
}

export class PublicFederationHub {
  private readonly root: string;
  private readonly recordsRoot: string;
  private readonly hubId: string;
  private readonly signingPrivateKey: KeyObject;
  private readonly signingPublicKey: string;
  private readonly maxRecords: number;
  private readonly processLockPath: string;
  private readonly events: PublicFederationEvent[] = [];
  private readonly objects = new Map<string, ObjectState>();
  private readonly idempotency = new Map<string, IdempotencyState>();
  private initialized = false;
  private loadPromise: Promise<void> | undefined;
  private mutationTail: Promise<void> = Promise.resolve();
  private closed = false;
  private processLock: ProcessLock | undefined;

  constructor(root: string, options: PublicFederationHubOptions = {}) {
    this.root = resolve(root);
    this.recordsRoot = join(this.root, 'records');
    this.processLockPath = join(this.root, 'hub.lock');
    this.hubId = boundedId(options.hubId || 'public-hub', 'hubId');
    const privateKey = options.signingPrivateKey
      ? createPrivateKey(options.signingPrivateKey)
      : generateKeyPairSync('ed25519').privateKey;
    if (privateKey.asymmetricKeyType !== 'ed25519') throw guidanceError(new Error('Public Federation signing key must be Ed25519'), 'guid-fd140080076d6966');
    this.signingPrivateKey = privateKey;
    this.signingPublicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
    this.maxRecords = Math.min(Math.max(Math.trunc(options.maxRecords ?? 100_000), 1), 1_000_000);
  }

  getPublicKey(): string { return this.signingPublicKey; }

  exportSigningPrivateKey(): string {
    return this.signingPrivateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.closed) throw guidanceError(new Error('Public Federation hub is closed'), 'guid-48fc18bcfb4caeee');
    if (this.initialized) return;
    if (!this.loadPromise) this.loadPromise = this.load();
    await this.loadPromise;
  }

  private async load(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await ensureFederationDirectory(this.root, this.recordsRoot);
    this.processLock = await acquireProcessLock(this.processLockPath);
    try {
      await ensureFederationDirectory(this.root, this.recordsRoot);
      const names = (await readdir(this.recordsRoot)).filter(name => /^\d{12}\.md$/.test(name)).sort();
      let previousHash = '';
      for (const name of names) {
        const event = parseEventMarkdown(await readFederationFile(this.root, join(this.recordsRoot, name), { maxBytes: 128 * 1024 }));
        const unsigned = unsignedEvent(event);
        if (event.sequence !== this.events.length + 1 || event.previousHash !== previousHash || event.eventHash !== sha256(canonical(unsigned)) || !verifyValue(unsigned, event.signature, createPublicKey(this.signingPublicKey))) {
          throw guidanceError(new Error(`invalid public federation event chain at sequence ${event.sequence}`), 'guid-645e5acaa22f03ef');
        }
        this.apply(event);
        this.events.push(event);
        previousHash = event.eventHash;
      }
      this.initialized = true;
    } catch (error) {
      if (this.processLock) await releaseProcessLock(this.processLock).catch(() => undefined);
      this.processLock = undefined;
      throw error;
    }
  }

  private apply(event: PublicFederationEvent): void {
    const record = event.record;
    if (record.type === 'moderation') {
      const target = this.objects.get(record.objectId);
      if (target) {
        target.globallyHidden = record.action === 'hide';
        target.moderationRevision = record.revision;
      }
      return;
    }
    if (record.type === 'actor') {
      this.objects.set(record.actorId, { actorId: record.actorId, kind: 'actor', revision: record.revision, tombstoned: false, globallyHidden: false, moderationRevision: 0, parentIds: [], latest: record });
    } else if (record.type === 'profile') {
      this.objects.set(record.recordId, { actorId: record.actorId, kind: 'profile', revision: record.revision, tombstoned: false, globallyHidden: false, moderationRevision: 0, parentIds: [record.actorId], latest: record });
    } else if (record.type === 'post') {
      this.objects.set(record.objectId, { actorId: record.actorId, kind: 'post', revision: record.revision, tombstoned: false, globallyHidden: false, moderationRevision: 0, parentIds: [], latest: record });
    } else if (record.type === 'comment') {
      this.objects.set(record.objectId, { actorId: record.actorId, kind: 'comment', revision: record.revision, tombstoned: false, globallyHidden: false, moderationRevision: 0, parentIds: [record.postId, ...(record.replyTo ? [record.replyTo] : [])], latest: record });
    } else if (record.type === 'update') {
      const target = this.objects.get(record.targetObjectId);
      if (target) {
        target.revision = record.revision;
        target.latest = record;
      }
    } else {
      const target = this.objects.get(record.targetObjectId);
      if (target) {
        target.revision = record.revision;
        target.tombstoned = true;
        target.latest = record;
      }
    }
    this.idempotency.set(event.idempotencyHash, { payloadHash: sha256(canonical({ record })), eventId: event.eventId });
  }

  private async withMutation<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>(resolvePromise => { release = resolvePromise; });
    await previous;
    try {
      await this.ensureLoaded();
      return await task();
    } finally {
      release();
    }
  }

  private eventForId(eventId: string): PublicFederationEvent | undefined {
    return this.events.find(event => event.eventId === eventId);
  }

  async publish(input: PublicPublishInput, rawIdentity: PublicFederationIdentity, idempotencyKey: string): Promise<PublicFederationEvent> {
    return this.withMutation(async () => {
      const identity = normalizeIdentity(rawIdentity);
      const key = boundedText(idempotencyKey, 'idempotencyKey', MAX_IDEMPOTENCY_KEY);
      if (!/^[a-zA-Z0-9._:-]+$/.test(key)) throw guidanceError(new Error('idempotencyKey contains unsupported characters'), 'guid-fa172a62ac0530bc');
      const record = normalizeInput(input, identity);
      const scopedKey = sha256(`${identity.origin}:${identity.agentId}:${key}`);
      const payloadHash = sha256(canonical({ record }));
      const prior = this.idempotency.get(scopedKey);
      if (prior) {
        if (prior.payloadHash !== payloadHash) throw guidanceError(new Error('idempotency key was already used with a different payload'), 'guid-09916e6dfb668052');
        const existing = this.eventForId(prior.eventId);
        if (!existing) throw guidanceError(new Error('idempotency state references a missing event'), 'guid-25ff516f7ff453f6');
        return existing;
      }
      if (this.events.length >= this.maxRecords) throw guidanceError(new Error('Public Federation record quota exceeded'), 'guid-2c2a854e1845203b');
      const actor = this.objects.get(record.actorId);
      if (record.type === 'actor') {
        if (actor) throw guidanceError(new Error('actor already exists'), 'guid-acec98e1fd226793');
      } else if (!actor || actor.kind !== 'actor' || actor.tombstoned) {
        throw guidanceError(new Error('authenticated actor must be published before social records'), 'guid-063b4205ef9befcf');
      }
      const targetId = record.type === 'update' || record.type === 'tombstone' ? record.targetObjectId : record.recordId;
      const target = this.objects.get(targetId);
      const expectedRevision = input.expectedRevision;
      if (record.type === 'actor' || record.type === 'post' || record.type === 'comment') {
        if (expectedRevision !== 0 || target) throw guidanceError(new Error('revision conflict: new public object requires expectedRevision 0'), 'guid-a0f5b846cdfb6fb3');
      } else if (record.type === 'profile') {
        const current = this.objects.get(record.recordId);
        if ((current?.revision ?? 0) !== expectedRevision) throw guidanceError(new Error(`revision conflict: expected ${expectedRevision}, current ${current?.revision ?? 0}`), 'guid-5f13e1a416a5feaf');
      } else {
        if (!target) throw guidanceError(new Error('target public object does not exist'), 'guid-f524e3f5e7a51ae7');
        if (target.actorId !== record.actorId) throw guidanceError(new Error('authenticated actor does not own the target object'), 'guid-837a1e889d6a6a51');
        if (target.tombstoned) throw guidanceError(new Error('target public object is tombstoned'), 'guid-2bd5f236d56ef72f');
        if (target.revision !== expectedRevision) throw guidanceError(new Error(`revision conflict: expected ${expectedRevision}, current ${target.revision}`), 'guid-5f13e1a416a5feaf');
        if (record.type === 'update') {
          const invalid = target.kind === 'post'
            ? record.displayName !== undefined || record.bio !== undefined
            : target.kind === 'comment'
              ? record.title !== undefined || record.displayName !== undefined || record.bio !== undefined
              : target.kind === 'profile'
                ? record.title !== undefined || record.body !== undefined
                : true;
          if (invalid) throw guidanceError(new Error(`an update field does not apply to a ${target.kind} object`), 'guid-1548b66ee82a824b');
        }
      }
      const parents = record.type === 'comment' ? [record.postId, ...(record.replyTo ? [record.replyTo] : [])] : [];
      const status = parents.some(parentId => {
        const parent = this.objects.get(parentId);
        return !parent || parent.tombstoned || parent.globallyHidden;
      }) ? 'pending-parent' as const : 'active' as const;
      const unsigned = {
        eventId: `public_event_${randomUUID()}`,
        sequence: this.events.length + 1,
        previousHash: this.events.at(-1)?.eventHash || '',
        record,
        status,
        publishedAt: new Date().toISOString(),
        idempotencyHash: scopedKey,
      };
      const eventHash = sha256(canonical(unsigned));
      const event: PublicFederationEvent = { ...unsigned, eventHash, signature: signValue(unsigned, this.signingPrivateKey) };
      const serialized = eventMarkdown(event);
      if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES) throw guidanceError(new Error(`public record exceeds ${MAX_RECORD_BYTES} bytes`), 'guid-221c5078b30c3465');
      const path = join(this.recordsRoot, `${String(event.sequence).padStart(12, '0')}.md`);
      await writeFederationFileAtomic(this.root, path, serialized, { maxBytes: 128 * 1024 });
      this.apply(event);
      this.events.push(event);
      this.idempotency.set(scopedKey, { payloadHash, eventId: event.eventId });
      return event;
    });
  }

  async moderate(input: PublicModerationInput, rawIdentity: PublicFederationIdentity, idempotencyKey: string): Promise<PublicFederationEvent> {
    return this.withMutation(async () => {
      const identity = normalizeIdentity(rawIdentity);
      if (identity.role !== 'moderator') throw guidanceError(new Error('moderator authority is required'), 'guid-11f710a3f13d26b2');
      if (!input || typeof input !== 'object') throw guidanceError(new Error('moderation input must be an object'), 'guid-aa444b5dba2c0e38');
      assertExactKeys(input as unknown as Record<string, unknown>, ['objectId', 'action', 'reason', 'expectedRevision']);
      const objectId = boundedText(input.objectId, 'objectId', 512).toLowerCase();
      const target = this.objects.get(objectId);
      if (!target) throw guidanceError(new Error('moderation target does not exist'), 'guid-a2b809aaf2b368c4');
      if (input.action !== 'hide' && input.action !== 'restore') throw guidanceError(new Error('moderation action must be hide or restore'), 'guid-797d2745d5c3837a');
      const expectedRevision = normalizeExpectedRevision(input.expectedRevision, true);
      const reason = boundedText(input.reason, 'reason', 500);
      const key = boundedText(idempotencyKey, 'idempotencyKey', MAX_IDEMPOTENCY_KEY);
      if (!/^[a-zA-Z0-9._:-]+$/.test(key)) throw guidanceError(new Error('idempotencyKey contains unsupported characters'), 'guid-fa172a62ac0530bc');
      const scopedKey = sha256(`${identity.origin}:${identity.agentId}:moderation:${key}`);
      const record: PublicModerationRecord = {
        protocol: PUBLIC_FEDERATION_PROTOCOL,
        version: 1,
        type: 'moderation',
        recordId: `moderation:${this.hubId}:${sha256(scopedKey).slice('sha256:'.length, 'sha256:'.length + 32)}`,
        objectId,
        action: input.action,
        reason,
        moderator: identity,
        revision: expectedRevision + 1,
      };
      const payloadHash = sha256(canonical({ record }));
      const prior = this.idempotency.get(scopedKey);
      if (prior) {
        if (prior.payloadHash !== payloadHash) throw guidanceError(new Error('idempotency key was already used with a different payload'), 'guid-09916e6dfb668052');
        const existing = this.eventForId(prior.eventId);
        if (!existing) throw guidanceError(new Error('idempotency state references a missing event'), 'guid-25ff516f7ff453f6');
        return existing;
      }
      if (target.moderationRevision !== expectedRevision) throw guidanceError(new Error(`moderation revision conflict: expected ${expectedRevision}, current ${target.moderationRevision}`), 'guid-e4cffd5efec94ec6');
      if (this.events.length >= this.maxRecords) throw guidanceError(new Error('Public Federation record quota exceeded'), 'guid-2c2a854e1845203b');
      const unsigned = {
        eventId: `public_event_${randomUUID()}`,
        sequence: this.events.length + 1,
        previousHash: this.events.at(-1)?.eventHash || '',
        record,
        status: 'active' as const,
        publishedAt: new Date().toISOString(),
        idempotencyHash: scopedKey,
      };
      const event: PublicFederationEvent = { ...unsigned, eventHash: sha256(canonical(unsigned)), signature: signValue(unsigned, this.signingPrivateKey) };
      const serialized = eventMarkdown(event);
      if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES) throw guidanceError(new Error(`public record exceeds ${MAX_RECORD_BYTES} bytes`), 'guid-221c5078b30c3465');
      await writeFederationFileAtomic(this.root, join(this.recordsRoot, `${String(event.sequence).padStart(12, '0')}.md`), serialized, { maxBytes: 128 * 1024 });
      this.apply(event);
      this.events.push(event);
      this.idempotency.set(scopedKey, { payloadHash, eventId: event.eventId });
      return event;
    });
  }

  async getFeed(after = 0, limit?: number): Promise<PublicFederationFeed> {
    await this.ensureLoaded();
    const cursor = Number.isSafeInteger(after) && after >= 0 ? after : 0;
    if (cursor > this.events.length) throw guidanceError(new Error('feed cursor is beyond the current public federation sequence'), 'guid-29b742adbcb94906');
    const events = this.events.filter(event => event.sequence > cursor).slice(0, normalizeLimit(limit));
    const unsigned = {
      protocol: PUBLIC_FEDERATION_PROTOCOL,
      hubId: this.hubId,
      after: cursor,
      anchorHash: cursor === 0 ? '' : this.events[cursor - 1]!.eventHash,
      cursor: events.at(-1)?.sequence ?? cursor,
      latestSequence: this.events.length,
      hasMore: this.events.length > (events.at(-1)?.sequence ?? cursor),
      events,
    };
    return { ...unsigned, signature: signValue(unsigned, this.signingPrivateKey) };
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.loadPromise?.catch(() => undefined);
    if (this.processLock) await releaseProcessLock(this.processLock);
    this.processLock = undefined;
  }
}
