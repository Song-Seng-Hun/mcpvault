import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, timingSafeEqual, verify, type KeyObject } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { copyFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import type { Server as NetServer } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';

const PROTOCOL = 'mcpvault-global-sync/v1' as const;
const MAX_DOCUMENT_BYTES = 1_048_576;
const MAX_REASON_LENGTH = 500;
const MAX_AUTHOR_LENGTH = 128;
const MAX_ORIGIN_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_TOTAL_PROPOSALS = 100_000;
const MAX_PENDING_PROPOSALS = 2_000;
const MAX_PENDING_BYTES = 64 * 1024 * 1024;
const MAX_PROPOSALS_PER_ORIGIN_PER_MINUTE = 120;
const RATE_WINDOW_MS = 60_000;
const MAX_HTTP_REQUESTS_PER_MINUTE = 300;
const MAX_RATE_BUCKETS = 4_096;
const DEFAULT_BATCH_LIMIT = 100;
const MAX_BATCH_LIMIT = 200;
const RESERVED_ROOTS = new Set(['.git', '.obsidian', '.mcpvault', '_scopes', '_whispers', 'community', 'node_modules']);

export type GlobalSyncOperation = 'upsert' | 'tombstone';
export type GlobalProposalStatus = 'pending' | 'approved' | 'rejected' | 'conflict';

export interface GlobalRevision {
  revisionId: string;
  documentId: string;
  sequence: number;
  parentRevision?: string;
  operation: GlobalSyncOperation;
  contentHash?: string;
  byteLength: number;
  author: string;
  reason: string;
  origin: string;
  createdAt: string;
  signature: string;
}

export interface GlobalManifestEntry {
  documentId: string;
  revisionId: string;
  sequence: number;
  parentRevision?: string;
  operation: GlobalSyncOperation;
  contentHash?: string;
}

export interface GlobalManifest {
  protocol: typeof PROTOCOL;
  hubId: string;
  cursor: number;
  latestSequence: number;
  entries: GlobalManifestEntry[];
  hasMore: boolean;
  signature: string;
}

export interface GlobalRevisionWithContent extends GlobalRevision {
  content?: string;
}

export interface GlobalProposal {
  proposalId: string;
  documentId: string;
  parentRevision?: string;
  operation: GlobalSyncOperation;
  contentHash?: string;
  byteLength: number;
  author: string;
  reason: string;
  origin: string;
  idempotencyKey?: string;
  createdAt: string;
  status: GlobalProposalStatus;
  approvals?: string[];
  decisionReason?: string;
  decidedAt?: string;
}

export interface GlobalAuditResult {
  ok: boolean;
  checkedRevisions: number;
  checkedObjects: number;
  errors: string[];
}

export interface GlobalProposalList {
  proposals: GlobalProposal[];
  total: number;
  truncated: boolean;
}

export interface GlobalSyncHubOptions {
  hubId?: string;
  signingPrivateKey?: string;
}

export interface GlobalSyncChangeInput {
  documentId: string;
  parentRevision?: string;
  operation?: GlobalSyncOperation;
  content?: string;
  author: string;
  reason: string;
  origin: string;
  idempotencyKey?: string;
}

interface HubState {
  protocol: typeof PROTOCOL;
  hubId: string;
  nextSequence: number;
  heads: Record<string, string>;
  revisions: Record<string, GlobalRevision>;
  proposals: Record<string, GlobalProposal>;
}

interface HubEvent {
  sequence: number;
  type: 'proposal.created' | 'proposal.approval' | 'proposal.approved' | 'proposal.rejected' | 'proposal.conflict' | 'revision.restored';
  payload: unknown;
  previousHash: string;
  eventHash: string;
  signature: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

export function generateGlobalSyncSigningKeyPair(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function signaturePayload(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function eventHash(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function signPayload(value: unknown, privateKey: KeyObject): string {
  return sign(null, signaturePayload(value), privateKey).toString('base64url');
}

function verifyPayload(value: unknown, signature: string, publicKey: KeyObject): boolean {
  try { return verify(null, signaturePayload(value), publicKey, Buffer.from(signature, 'base64url')); } catch { return false; }
}

function withoutSignature<T extends { signature: string }>(value: T): Omit<T, 'signature'> {
  const { signature: _signature, ...unsigned } = value;
  return unsigned;
}

function withoutRevisionContent(value: GlobalRevisionWithContent): Omit<GlobalRevisionWithContent, 'signature' | 'content'> {
  const { signature: _signature, content: _content, ...unsigned } = value;
  return unsigned;
}

function normalizeId(value: string, field: string): string {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.length > 240 || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`${field} must be a safe relative path`);
  }
  const first = normalized.split('/')[0]!.toLowerCase();
  if (RESERVED_ROOTS.has(first) || normalized.startsWith('_')) throw new Error(`${field} must identify a Global document, not private or service state`);
  if (!/\.(?:md|markdown|txt)$/i.test(normalized)) throw new Error(`${field} must be a Markdown or text document`);
  return normalized;
}

function boundedText(value: string, field: string, max: number): string {
  const text = String(value || '').trim();
  if (!text || text.length > max) throw new Error(`${field} is required and must be at most ${max} characters`);
  return text;
}

function normalizeIdempotencyKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const key = boundedText(value, 'idempotencyKey', MAX_IDEMPOTENCY_KEY_LENGTH);
  if (!/^[a-zA-Z0-9._:-]+$/.test(key)) throw new Error('idempotencyKey contains unsupported characters');
  return key;
}

function normalizeLimit(value: number | undefined): number {
  const number = Number(value ?? DEFAULT_BATCH_LIMIT);
  if (!Number.isSafeInteger(number) || number < 1) return DEFAULT_BATCH_LIMIT;
  return Math.min(number, MAX_BATCH_LIMIT);
}

function emptyState(hubId: string): HubState {
  return { protocol: PROTOCOL, hubId, nextSequence: 0, heads: {}, revisions: {}, proposals: {} };
}

function applyEvent(state: HubState, event: HubEvent): void {
  state.nextSequence = Math.max(state.nextSequence, event.sequence);
  const payload = isRecord(event.payload) ? event.payload : {};
  if (event.type === 'proposal.created') {
    const proposal = payload.proposal;
    if (isRecord(proposal) && typeof proposal.proposalId === 'string') state.proposals[proposal.proposalId] = proposal as unknown as GlobalProposal;
    return;
  }
  const proposalId = typeof payload.proposalId === 'string' ? payload.proposalId : undefined;
  if (proposalId && state.proposals[proposalId]) {
    const proposal = state.proposals[proposalId]!;
    if (event.type === 'proposal.approval') {
      const reviewer = typeof payload.reviewer === 'string' ? payload.reviewer : undefined;
      if (reviewer && !proposal.approvals?.includes(reviewer)) proposal.approvals = [...(proposal.approvals || []), reviewer];
    } else if (event.type === 'proposal.approved') {
      proposal.status = 'approved';
      const revision = payload.revision;
      if (isRecord(revision) && typeof revision.revisionId === 'string' && typeof revision.documentId === 'string') {
        const typedRevision = revision as unknown as GlobalRevision;
        state.revisions[typedRevision.revisionId] = typedRevision;
        state.heads[typedRevision.documentId] = typedRevision.revisionId;
      }
    } else if (event.type === 'proposal.rejected') {
      proposal.status = 'rejected';
      if (typeof payload.reason === 'string') proposal.decisionReason = payload.reason;
    } else if (event.type === 'proposal.conflict') {
      proposal.status = 'conflict';
      if (typeof payload.reason === 'string') proposal.decisionReason = payload.reason;
    }
    if (typeof payload.decidedAt === 'string') proposal.decidedAt = payload.decidedAt;
    return;
  }
  if (event.type === 'revision.restored') {
    const revision = payload.revision;
    if (isRecord(revision) && typeof revision.revisionId === 'string' && typeof revision.documentId === 'string') {
      const typedRevision = revision as unknown as GlobalRevision;
      state.revisions[typedRevision.revisionId] = typedRevision;
      state.heads[typedRevision.documentId] = typedRevision.revisionId;
    }
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function writeObjectIfMissing(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
  }
}

/**
 * Append-only Global authority. It stores metadata in a rebuildable state
 * snapshot and content in immutable, hash-addressed objects. No physical
 * document deletion operation exists: deletion is a reviewable tombstone.
 */
export class GlobalSyncHub {
  private readonly root: string;
  private readonly statePath: string;
  private readonly eventPath: string;
  private readonly objectRoot: string;
  private readonly hubId: string;
  private readonly signingPrivateKey: KeyObject;
  private readonly signingPublicKey: string;
  private readonly approvalQuorum: number;
  private readonly originWindows = new Map<string, { startedAt: number; count: number }>();
  private state: HubState;
  private lastEventHash = '';
  private initialized = false;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(root: string, options: GlobalSyncHubOptions = {}) {
    this.root = resolve(root);
    this.statePath = join(this.root, 'state.json');
    this.eventPath = join(this.root, 'events.ndjson');
    this.objectRoot = join(this.root, 'objects');
    this.hubId = boundedText(options.hubId || 'global-hub', 'hubId', MAX_ORIGIN_LENGTH).toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(this.hubId)) throw new Error('hubId must be a lowercase identifier');
    this.signingPrivateKey = options.signingPrivateKey ? createPrivateKey(options.signingPrivateKey) : createPrivateKey(generateGlobalSyncSigningKeyPair().privateKey);
    if (this.signingPrivateKey.asymmetricKeyType !== 'ed25519') throw new Error('Global Sync signing key must be Ed25519');
    this.signingPublicKey = createPublicKey(this.signingPrivateKey).export({ type: 'spki', format: 'pem' }).toString();
    this.approvalQuorum = 2;
    this.state = emptyState(this.hubId);
  }

  getPublicKey(): string { return this.signingPublicKey; }

  exportSigningPrivateKey(): string {
    return this.signingPrivateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.objectRoot, { recursive: true });
    let snapshotExists = false;
    try {
      await stat(this.statePath);
      snapshotExists = true;
    } catch {
      snapshotExists = false;
    }
    this.state = emptyState(this.hubId);
    try {
      const lines = (await readFile(this.eventPath, 'utf8')).split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const event = JSON.parse(line) as HubEvent;
        const unsignedEvent = { sequence: event.sequence, type: event.type, payload: event.payload, previousHash: event.previousHash };
        if (!Number.isSafeInteger(event.sequence) || event.sequence !== this.state.nextSequence + 1 || event.previousHash !== this.lastEventHash || event.eventHash !== eventHash(unsignedEvent) || !event.signature || !verifyPayload(unsignedEvent, event.signature, createPublicKey(this.signingPublicKey))) throw new Error(`invalid event chain at sequence ${event.sequence}`);
        applyEvent(this.state, event);
        this.lastEventHash = event.eventHash;
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        if (snapshotExists) throw new Error('Global Sync event log is missing; refusing to trust the state snapshot');
      } else {
        throw error;
      }
    }
    this.initialized = true;
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

  private async appendEvent(type: HubEvent['type'], payload: unknown): Promise<void> {
    const unsignedEvent = { sequence: this.state.nextSequence + 1, type, payload, previousHash: this.lastEventHash };
    const event: HubEvent = { ...unsignedEvent, eventHash: eventHash(unsignedEvent), signature: signPayload(unsignedEvent, this.signingPrivateKey) };
    await mkdir(dirname(this.eventPath), { recursive: true });
    const handle = await open(this.eventPath, 'a');
    try {
      await handle.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    applyEvent(this.state, event);
    this.lastEventHash = event.eventHash;
    await writeAtomic(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  private objectPath(contentHash: string): string {
    if (!/^sha256:[a-f0-9]{64}$/.test(contentHash)) throw new Error('Invalid content hash');
    return join(this.objectRoot, contentHash.slice('sha256:'.length));
  }

  private async storeContent(content: string): Promise<{ contentHash: string; byteLength: number }> {
    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > MAX_DOCUMENT_BYTES) throw new Error(`Global document exceeds ${MAX_DOCUMENT_BYTES} bytes`);
    const contentHash = sha256(content);
    await writeObjectIfMissing(this.objectPath(contentHash), content);
    return { contentHash, byteLength };
  }

  private enforceProposalQuota(origin: string, byteLength: number): void {
    const proposals = Object.values(this.state.proposals);
    if (proposals.length >= MAX_TOTAL_PROPOSALS) throw new Error('Global Sync proposal history quota exceeded');
    const pending = proposals.filter(proposal => proposal.status === 'pending');
    if (pending.length >= MAX_PENDING_PROPOSALS) throw new Error('Global Sync pending proposal quota exceeded');
    const pendingBytes = pending.reduce((total, proposal) => total + proposal.byteLength, 0);
    if (pendingBytes + byteLength > MAX_PENDING_BYTES) throw new Error('Global Sync pending content quota exceeded');
    const now = Date.now();
    const window = this.originWindows.get(origin);
    if (!window || now - window.startedAt >= RATE_WINDOW_MS) {
      if (this.originWindows.size >= MAX_RATE_BUCKETS) {
        for (const [key, value] of this.originWindows) {
          if (now - value.startedAt >= RATE_WINDOW_MS) this.originWindows.delete(key);
          if (this.originWindows.size < MAX_RATE_BUCKETS) break;
        }
      }
      if (this.originWindows.size >= MAX_RATE_BUCKETS && !this.originWindows.has(origin)) throw new Error('Global Sync proposal rate limiter is at capacity');
      this.originWindows.set(origin, { startedAt: now, count: 1 });
      return;
    }
    if (window.count >= MAX_PROPOSALS_PER_ORIGIN_PER_MINUTE) throw new Error('Global Sync proposal rate limit exceeded for origin');
    window.count += 1;
  }

  private currentRevision(documentId: string): GlobalRevision | undefined {
    const head = this.state.heads[documentId];
    return head ? this.state.revisions[head] : undefined;
  }

  async submitProposal(input: GlobalSyncChangeInput): Promise<GlobalProposal> {
    return this.withMutation(async () => {
      const documentId = normalizeId(input.documentId, 'documentId');
      const operation = input.operation || 'upsert';
      if (operation !== 'upsert' && operation !== 'tombstone') throw new Error('operation must be upsert or tombstone');
      const author = boundedText(input.author, 'author', MAX_AUTHOR_LENGTH);
      const reason = boundedText(input.reason, 'reason', MAX_REASON_LENGTH);
      const origin = boundedText(input.origin, 'origin', MAX_ORIGIN_LENGTH);
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      const current = this.currentRevision(documentId);
      const parentRevision = input.parentRevision || current?.revisionId;
      if (parentRevision && (!this.state.revisions[parentRevision] || this.state.revisions[parentRevision]!.documentId !== documentId)) throw new Error('parentRevision is unknown or belongs to another document');
      let contentHash: string | undefined;
      let byteLength = 0;
      if (operation === 'upsert') {
        if (typeof input.content !== 'string') throw new Error('content is required for an upsert');
        byteLength = Buffer.byteLength(input.content, 'utf8');
        if (byteLength > MAX_DOCUMENT_BYTES) throw new Error(`Global document exceeds ${MAX_DOCUMENT_BYTES} bytes`);
        contentHash = sha256(input.content);
      }
      if (idempotencyKey) {
        const existing = Object.values(this.state.proposals).find(candidate => candidate.origin === origin && candidate.idempotencyKey === idempotencyKey);
        if (existing) {
          if (existing.documentId !== documentId || (input.parentRevision !== undefined && existing.parentRevision !== parentRevision) || existing.operation !== operation || existing.contentHash !== contentHash || existing.byteLength !== byteLength || existing.author !== author || existing.reason !== reason) throw new Error('idempotencyKey was already used for a different proposal');
          return existing;
        }
      }
      const duplicate = Object.values(this.state.proposals).find(candidate => candidate.status === 'pending'
        && candidate.documentId === documentId
        && candidate.parentRevision === parentRevision
        && candidate.operation === operation
        && candidate.contentHash === contentHash);
      if (duplicate) return duplicate;
      this.enforceProposalQuota(origin, byteLength);
      if (operation === 'upsert' && typeof input.content === 'string') await this.storeContent(input.content);
      const proposal: GlobalProposal = {
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
      return proposal;
    });
  }

  async getManifest(after = 0, limit?: number): Promise<GlobalManifest> {
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

  async getRevision(revisionId: string): Promise<GlobalRevisionWithContent> {
    await this.ensureLoaded();
    const revision = this.state.revisions[String(revisionId || '').trim()];
    if (!revision) throw new Error('revision not found');
    if (!revision.signature || !verifyPayload(withoutSignature(revision), revision.signature, createPublicKey(this.signingPublicKey))) throw new Error(`revision signature mismatch for ${revision.revisionId}`);
    if (revision.operation === 'tombstone') return { ...revision };
    if (!revision.contentHash) throw new Error('upsert revision has no content hash');
    const content = await readFile(this.objectPath(revision.contentHash), 'utf8');
    if (sha256(content) !== revision.contentHash || Buffer.byteLength(content, 'utf8') !== revision.byteLength) throw new Error(`content validation failed for ${revision.revisionId}`);
    return { ...revision, content };
  }

  async listProposals(status?: GlobalProposalStatus, limit?: number): Promise<GlobalProposalList> {
    await this.ensureLoaded();
    const all = Object.values(this.state.proposals)
      .filter(proposal => !status || proposal.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const bounded = all.slice(0, normalizeLimit(limit));
    return { proposals: bounded, total: all.length, truncated: bounded.length < all.length };
  }

  async approveProposal(proposalId: string, reviewer: string, reason: string): Promise<{ status: 'pending' | 'approved' | 'conflict'; proposal: GlobalProposal; revision?: GlobalRevision; currentRevision?: string }> {
    return this.withMutation(async () => {
      const proposal = this.state.proposals[String(proposalId || '').trim()];
      if (!proposal) throw new Error('proposal not found');
      if (proposal.status !== 'pending') throw new Error(`proposal is already ${proposal.status}`);
      const reviewerId = boundedText(reviewer, 'reviewer', MAX_AUTHOR_LENGTH);
      if (proposal.approvals?.includes(reviewerId)) throw new Error('reviewer has already approved this proposal');
      await this.appendEvent('proposal.approval', { proposalId: proposal.proposalId, reviewer: reviewerId, decidedAt: new Date().toISOString() });
      const approvedProposal = this.state.proposals[proposal.proposalId]!;
      const requiredApprovals = this.approvalQuorum;
      if ((approvedProposal.approvals?.length || 0) < requiredApprovals) return { status: 'pending' as const, proposal: approvedProposal };
      const current = this.currentRevision(proposal.documentId);
      const currentId = current?.revisionId;
      if ((proposal.parentRevision || undefined) !== currentId) {
        const decisionReason = `Conflict: expected parent ${proposal.parentRevision || 'none'}, current head is ${currentId || 'none'}`;
        await this.appendEvent('proposal.conflict', { proposalId: proposal.proposalId, reason: decisionReason, decidedAt: new Date().toISOString() });
        return { status: 'conflict' as const, proposal: this.state.proposals[proposal.proposalId]!, ...(currentId && { currentRevision: currentId }) };
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
      const revision: GlobalRevision = { ...unsignedRevision, signature: signPayload(unsignedRevision, this.signingPrivateKey) };
      await this.appendEvent('proposal.approved', { proposalId: proposal.proposalId, revision, decidedAt: new Date().toISOString(), reviewer: reviewerId });
      return { status: 'approved' as const, proposal: this.state.proposals[proposal.proposalId]!, revision };
    });
  }

  async rejectProposal(proposalId: string, reviewer: string, reason: string): Promise<GlobalProposal> {
    return this.withMutation(async () => {
      const proposal = this.state.proposals[String(proposalId || '').trim()];
      if (!proposal) throw new Error('proposal not found');
      if (proposal.status !== 'pending') throw new Error(`proposal is already ${proposal.status}`);
      await this.appendEvent('proposal.rejected', { proposalId: proposal.proposalId, reason: boundedText(reason, 'reason', MAX_REASON_LENGTH), decidedAt: new Date().toISOString(), reviewer: boundedText(reviewer, 'reviewer', MAX_AUTHOR_LENGTH) });
      return this.state.proposals[proposal.proposalId]!;
    });
  }

  async restoreDocument(documentIdInput: string, targetRevisionId: string, reviewer: string, reason: string, expectedCurrentRevision?: string): Promise<GlobalRevision> {
    return this.withMutation(async () => {
      const documentId = normalizeId(documentIdInput, 'documentId');
      const target = this.state.revisions[String(targetRevisionId || '').trim()];
      if (!target || target.documentId !== documentId || target.operation !== 'upsert' || !target.contentHash) throw new Error('targetRevisionId must identify an existing upsert of this document');
      const targetContent = await readFile(this.objectPath(target.contentHash), 'utf8');
      if (sha256(targetContent) !== target.contentHash || Buffer.byteLength(targetContent, 'utf8') !== target.byteLength) throw new Error('target revision object failed content validation');
      const current = this.currentRevision(documentId);
      if ((expectedCurrentRevision || undefined) !== current?.revisionId) throw new Error(`restore conflict: expected ${expectedCurrentRevision || 'none'}, current ${current?.revisionId || 'none'}`);
      const unsignedRevision = {
        revisionId: `rev_${randomUUID()}`,
        documentId,
        sequence: this.state.nextSequence + 1,
        ...(current && { parentRevision: current.revisionId }),
        operation: 'upsert' as const,
        contentHash: target.contentHash,
        byteLength: target.byteLength,
        author: boundedText(reviewer, 'reviewer', MAX_AUTHOR_LENGTH),
        reason: boundedText(reason, 'reason', MAX_REASON_LENGTH),
        origin: this.hubId,
        createdAt: new Date().toISOString(),
      };
      const revision: GlobalRevision = { ...unsignedRevision, signature: signPayload(unsignedRevision, this.signingPrivateKey) };
      await this.appendEvent('revision.restored', { revision });
      return this.state.revisions[revision.revisionId]!;
    });
  }

  async audit(): Promise<GlobalAuditResult> {
    await this.ensureLoaded();
    const errors: string[] = [];
    let checkedObjects = 0;
    const revisions = Object.values(this.state.revisions);
    for (const revision of revisions) {
      try {
        normalizeId(revision.documentId, 'documentId');
        if (!revision.signature || !verifyPayload(withoutSignature(revision), revision.signature, createPublicKey(this.signingPublicKey))) throw new Error('signature mismatch');
        if (revision.parentRevision) {
          const parent = this.state.revisions[revision.parentRevision];
          if (!parent || parent.documentId !== revision.documentId || parent.sequence >= revision.sequence) errors.push(`invalid parent chain at ${revision.revisionId}`);
        }
        if (revision.operation === 'upsert') {
          if (!revision.contentHash) throw new Error('missing content hash');
          const content = await readFile(this.objectPath(revision.contentHash), 'utf8');
          checkedObjects += 1;
          if (sha256(content) !== revision.contentHash || Buffer.byteLength(content, 'utf8') !== revision.byteLength) errors.push(`content validation failed at ${revision.revisionId}`);
        }
      } catch (error) {
        errors.push(`${revision.revisionId}: ${error instanceof Error ? error.message : 'invalid revision'}`);
      }
    }
    for (const [documentId, revisionId] of Object.entries(this.state.heads)) {
      if (!this.state.revisions[revisionId] || this.state.revisions[revisionId]!.documentId !== documentId) errors.push(`head mismatch for ${documentId}`);
    }
    for (const proposal of Object.values(this.state.proposals)) {
      if (proposal.operation === 'upsert' && (!proposal.contentHash || !(await stat(this.objectPath(proposal.contentHash)).catch(() => undefined)))) errors.push(`proposal object missing for ${proposal.proposalId}`);
    }
    return { ok: errors.length === 0, checkedRevisions: revisions.length, checkedObjects, errors: errors.slice(0, 100) };
  }
}

export interface GlobalSyncClientOptions {
  baseUrl: string;
  authToken: string;
  reviewerToken?: string;
}

/** Small HTTP client used by a vault replica; it never sends User or Community paths. */
export class GlobalSyncClient {
  private readonly baseUrl: string;
  private readonly authToken: string;
  private readonly reviewerToken?: string;

  constructor(options: GlobalSyncClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.authToken = boundedText(options.authToken, 'authToken', 4096);
    if (options.reviewerToken) this.reviewerToken = boundedText(options.reviewerToken, 'reviewerToken', 4096);
  }

  private async request<T>(path: string, init: RequestInit = {}, reviewer = false): Promise<T> {
    const token = reviewer ? this.reviewerToken : this.authToken;
    if (!token) throw new Error('reviewerToken is required for this operation');
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } });
    const body = await response.text();
    let value: unknown;
    try { value = body ? JSON.parse(body) : {}; } catch { value = { error: body }; }
    if (!response.ok) throw new Error(isRecord(value) && typeof value.error === 'string' ? value.error : `Global Sync HTTP ${response.status}`);
    return value as T;
  }

  getManifest(after = 0, limit?: number): Promise<GlobalManifest> {
    const params = new URLSearchParams({ after: String(after), limit: String(normalizeLimit(limit)) });
    return this.request<GlobalManifest>(`/v1/global/manifest?${params}`);
  }

  getRevision(revisionId: string): Promise<GlobalRevisionWithContent> {
    return this.request<GlobalRevisionWithContent>(`/v1/global/revisions/${encodeURIComponent(revisionId)}`);
  }

  submitProposal(input: GlobalSyncChangeInput): Promise<GlobalProposal> {
    return this.request<GlobalProposal>('/v1/global/proposals', { method: 'POST', body: JSON.stringify(input) });
  }

  listProposals(status?: GlobalProposalStatus, limit?: number): Promise<GlobalProposalList> {
    const params = new URLSearchParams({ limit: String(normalizeLimit(limit)) });
    if (status) params.set('status', status);
    return this.request<GlobalProposalList>(`/v1/global/proposals?${params}`);
  }

  approveProposal(proposalId: string, reviewer: string, reason: string): Promise<{ status: 'pending' | 'approved' | 'conflict'; proposal: GlobalProposal; revision?: GlobalRevision; currentRevision?: string }> {
    return this.request(`/v1/global/proposals/${encodeURIComponent(proposalId)}/approve`, { method: 'POST', body: JSON.stringify({ reviewer, reason }) }, true);
  }

  rejectProposal(proposalId: string, reviewer: string, reason: string): Promise<GlobalProposal> {
    return this.request<GlobalProposal>(`/v1/global/proposals/${encodeURIComponent(proposalId)}/reject`, { method: 'POST', body: JSON.stringify({ reviewer, reason }) }, true);
  }

  restoreDocument(documentId: string, targetRevisionId: string, reviewer: string, reason: string, expectedCurrentRevision?: string): Promise<GlobalRevision> {
    return this.request<GlobalRevision>('/v1/global/restore', { method: 'POST', body: JSON.stringify({ documentId, targetRevisionId, reviewer, reason, expectedCurrentRevision }) }, true);
  }
}

export interface GlobalSyncReplicaOptions {
  vaultPath: string;
  client: Pick<GlobalSyncClient, 'getManifest' | 'getRevision' | 'submitProposal'>;
  trustedPublicKey: string;
}

interface ReplicaDocumentState {
  revisionId: string;
  operation: GlobalSyncOperation;
  contentHash?: string;
}

interface ReplicaState {
  version: 1;
  cursor: number;
  documents: Record<string, ReplicaDocumentState>;
}

export interface GlobalPullResult {
  applied: string[];
  conflicts: Array<{ documentId: string; revisionId: string; reason: string }>;
  cursor: number;
  hasMore: boolean;
}

/** Pull-only replica. Local edits are never overwritten; remote tombstones are recoverable moves. */
export class GlobalSyncReplica {
  private readonly vaultPath: string;
  private readonly statePath: string;
  private readonly backupRoot: string;
  private readonly quarantineRoot: string;
  private readonly client: GlobalSyncReplicaOptions['client'];
  private readonly trustedPublicKey: KeyObject;
  private state: ReplicaState = { version: 1, cursor: 0, documents: {} };
  private loaded = false;

  constructor(options: GlobalSyncReplicaOptions) {
    this.vaultPath = resolve(options.vaultPath);
    this.statePath = join(this.vaultPath, '.mcpvault', 'global-sync-replica.json');
    this.backupRoot = join(this.vaultPath, '.mcpvault', 'global-sync-backups');
    this.quarantineRoot = join(this.vaultPath, '.mcpvault', 'global-sync-quarantine');
    this.client = options.client;
    this.trustedPublicKey = createPublicKey(options.trustedPublicKey);
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.statePath, 'utf8'));
      if (isRecord(parsed) && parsed.version === 1 && typeof parsed.cursor === 'number' && isRecord(parsed.documents)) this.state = parsed as unknown as ReplicaState;
    } catch {
      // First pull starts from the beginning of the hub history.
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await writeAtomic(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  private localPath(documentId: string): string {
    const normalized = normalizeId(documentId, 'documentId');
    const path = resolve(this.vaultPath, normalized);
    const relativePath = relative(this.vaultPath, path).replace(/\\/g, '/');
    if (!relativePath || relativePath.startsWith('..')) throw new Error('Global document escaped vault root');
    return path;
  }

  private async currentContent(path: string): Promise<{ exists: boolean; content?: string; hash?: string }> {
    try {
      const content = await readFile(path, 'utf8');
      return { exists: true, content, hash: sha256(content) };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { exists: false };
      throw error;
    }
  }

  private async backup(path: string, documentId: string, sequence: number): Promise<void> {
    const backupPath = join(this.backupRoot, `${sequence}-${documentId.replace(/[^a-z0-9._-]+/gi, '_')}`);
    await mkdir(dirname(backupPath), { recursive: true });
    await copyFile(path, backupPath);
  }

  async pull(limit?: number): Promise<GlobalPullResult> {
    await this.load();
    const manifest = await this.client.getManifest(this.state.cursor, normalizeLimit(limit));
    if (manifest.protocol !== PROTOCOL || !Number.isSafeInteger(manifest.latestSequence) || manifest.latestSequence < this.state.cursor || !manifest.signature || !verifyPayload(withoutSignature(manifest), manifest.signature, this.trustedPublicKey)) {
      return { applied: [], conflicts: [{ documentId: '', revisionId: '', reason: 'Remote manifest failed protocol or signature validation.' }], cursor: this.state.cursor, hasMore: true };
    }
    if (manifest.entries.length > 0 && manifest.cursor !== manifest.entries.at(-1)!.sequence) {
      return { applied: [], conflicts: [{ documentId: '', revisionId: '', reason: 'Remote manifest cursor does not match its final entry.' }], cursor: this.state.cursor, hasMore: true };
    }
    let expectedSequence = this.state.cursor;
    const applied: string[] = [];
    const conflicts: GlobalPullResult['conflicts'] = [];
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
        if (current.exists && current.hash !== revision.contentHash) await this.backup(path, entry.documentId, entry.sequence);
        await mkdir(dirname(path), { recursive: true });
        await writeAtomic(path, revision.content);
        this.state.documents[entry.documentId] = { revisionId: entry.revisionId, operation: 'upsert', contentHash: revision.contentHash };
      } else {
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

  async proposeLocal(documentId: string, author: string, reason: string, origin: string): Promise<GlobalProposal> {
    await this.load();
    const normalized = normalizeId(documentId, 'documentId');
    const current = await this.currentContent(this.localPath(normalized));
    if (!current.exists || current.content === undefined) throw new Error('local Global document does not exist');
    return this.client.submitProposal({ documentId: normalized, ...(this.state.documents[normalized]?.revisionId && { parentRevision: this.state.documents[normalized]!.revisionId }), operation: 'upsert', content: current.content, author, reason, origin });
  }

  async proposeTombstone(documentId: string, author: string, reason: string, origin: string): Promise<GlobalProposal> {
    await this.load();
    const normalized = normalizeId(documentId, 'documentId');
    return this.client.submitProposal({ documentId: normalized, ...(this.state.documents[normalized]?.revisionId && { parentRevision: this.state.documents[normalized]!.revisionId }), operation: 'tombstone', author, reason, origin });
  }
}

export interface GlobalSyncHubHttpOptions {
  host?: string;
  port?: number;
  authToken: string;
  reviewerToken: string;
  reviewerTokens?: Record<string, string>;
  maxBodyBytes?: number;
  hubId?: string;
  signingKeyPath?: string;
  proposerOrigin?: string;
  tls?: {
    key: string;
    cert: string;
    ca?: string;
    requestCert?: boolean;
    rejectUnauthorized?: boolean;
  };
  maxConnections?: number;
}

export interface GlobalSyncHubHttpHandle {
  server: NetServer;
  host: string;
  port: number;
  hub: GlobalSyncHub;
  close(): Promise<void>;
}

function bearer(request: IncomingMessage): string | undefined {
  const value = request.headers.authorization;
  return typeof value === 'string' && /^Bearer\s+/i.test(value) ? value.replace(/^Bearer\s+/i, '').trim() : undefined;
}

function constantTimeEqual(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function secretDigest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function constantTimeDigestEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

async function jsonBody(request: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) throw new Error(`request body exceeds ${maxBytes} bytes`);
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!isRecord(parsed)) throw new Error('request body must be a JSON object');
  return parsed;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(body);
}

function pathParam(pathname: string, prefix: string): string | undefined {
  return pathname.startsWith(prefix) ? decodeURIComponent(pathname.slice(prefix.length).replace(/^\/+/, '')) : undefined;
}

/** Optional standalone HTTP control plane for a GlobalSyncHub. */
export async function startGlobalSyncHub(root: string, options: GlobalSyncHubHttpOptions): Promise<GlobalSyncHubHttpHandle> {
  const authToken = boundedText(options.authToken, 'authToken', 4096);
  const reviewerToken = boundedText(options.reviewerToken, 'reviewerToken', 4096);
  if (constantTimeEqual(authToken, reviewerToken)) throw new Error('authToken and reviewerToken must be different');
  const reviewerTokens = new Map<string, Buffer>([['reviewer', secretDigest(reviewerToken)]]);
  for (const [reviewerId, token] of Object.entries(options.reviewerTokens || {})) {
    const id = boundedText(reviewerId, 'reviewerId', MAX_AUTHOR_LENGTH);
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)) throw new Error('reviewerId must be a lowercase identifier');
    const normalizedToken = boundedText(token, `reviewerTokens.${id}`, 4096);
    if (constantTimeEqual(authToken, normalizedToken)) throw new Error('reviewer tokens must differ from authToken');
    const normalizedTokenDigest = secretDigest(normalizedToken);
    if ([...reviewerTokens.values()].some(existing => constantTimeDigestEqual(existing, normalizedTokenDigest))) throw new Error('reviewer tokens must be unique');
    reviewerTokens.set(id, normalizedTokenDigest);
  }
  const signingKeyPath = resolve(options.signingKeyPath || join(resolve(root), 'signing-key.pem'));
  const proposerOrigin = options.proposerOrigin ? boundedText(options.proposerOrigin, 'proposerOrigin', MAX_ORIGIN_LENGTH) : undefined;
  let signingPrivateKey: string | undefined;
  try {
    signingPrivateKey = await readFile(signingKeyPath, 'utf8');
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  let hub = new GlobalSyncHub(root, { ...(options.hubId && { hubId: options.hubId }), ...(signingPrivateKey && { signingPrivateKey }) });
  if (!signingPrivateKey) {
    await mkdir(dirname(signingKeyPath), { recursive: true, mode: 0o700 });
    try {
      await writeFile(signingKeyPath, hub.exportSigningPrivateKey(), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
      hub = new GlobalSyncHub(root, { ...(options.hubId && { hubId: options.hubId }), signingPrivateKey: await readFile(signingKeyPath, 'utf8') });
    }
  }
  await hub.getManifest(0, 1);
  const host = options.host || '127.0.0.1';
  const maxBodyBytes = Math.min(Math.max(Math.trunc(options.maxBodyBytes ?? 2 * 1024 * 1024), 1024), 2 * 1024 * 1024);
  const authTokenDigest = secretDigest(authToken);
  const requestWindows = new Map<string, { startedAt: number; count: number }>();
  const reviewerFor = (token: string | undefined): string | undefined => {
    if (!token) return undefined;
    const digest = secretDigest(token);
    for (const [reviewerId, reviewerSecretDigest] of reviewerTokens) if (constantTimeDigestEqual(digest, reviewerSecretDigest)) return reviewerId;
    return undefined;
  };
  const allowedByRate = (key: string): boolean => {
    const now = Date.now();
    const current = requestWindows.get(key);
    if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
      if (requestWindows.size >= MAX_RATE_BUCKETS) {
        for (const [bucket, value] of requestWindows) {
          if (now - value.startedAt >= RATE_WINDOW_MS) requestWindows.delete(bucket);
          if (requestWindows.size < MAX_RATE_BUCKETS) break;
        }
      }
      if (requestWindows.size >= MAX_RATE_BUCKETS && !requestWindows.has(key)) return false;
      requestWindows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= MAX_HTTP_REQUESTS_PER_MINUTE) return false;
    current.count += 1;
    return true;
  };
  const requestHandler = async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const url = new URL(request.url || '/', `http://${host}`);
      const reviewerRoute = url.pathname === '/v1/global/audit' || (request.method === 'POST' && (url.pathname === '/v1/global/restore' || /\/v1\/global\/proposals\/[^/]+\/(?:approve|reject)$/.test(url.pathname)));
      const token = bearer(request);
      const reviewerId = reviewerFor(token);
      if (reviewerRoute ? !reviewerId : !token || !constantTimeDigestEqual(secretDigest(token), authTokenDigest)) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      if (!allowedByRate(`${request.socket.remoteAddress || 'unknown'}:${reviewerId || 'proposer'}`)) { sendJson(response, 429, { error: 'Rate limit exceeded; retry later' }); return; }
      if (request.method === 'GET' && url.pathname === '/healthz') { sendJson(response, 200, { ok: true, protocol: PROTOCOL }); return; }
      if (request.method === 'GET' && url.pathname === '/v1/global/manifest') {
        sendJson(response, 200, await hub.getManifest(Number(url.searchParams.get('after') || 0), Number(url.searchParams.get('limit') || DEFAULT_BATCH_LIMIT))); return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/global/proposals') {
        const status = url.searchParams.get('status') as GlobalProposalStatus | null;
        sendJson(response, 200, await hub.listProposals(status || undefined, Number(url.searchParams.get('limit') || DEFAULT_BATCH_LIMIT))); return;
      }
      const revisionId = pathParam(url.pathname, '/v1/global/revisions/');
      if (request.method === 'GET' && revisionId) { sendJson(response, 200, await hub.getRevision(revisionId)); return; }
      if (request.method === 'POST' && url.pathname === '/v1/global/proposals') {
        const body = await jsonBody(request, maxBodyBytes);
        sendJson(response, 201, await hub.submitProposal({ ...(body as unknown as GlobalSyncChangeInput), ...(proposerOrigin && { origin: proposerOrigin }) })); return;
      }
      const proposalId = pathParam(url.pathname, '/v1/global/proposals/');
      if (request.method === 'POST' && proposalId?.endsWith('/approve')) {
        const body = await jsonBody(request, maxBodyBytes);
        sendJson(response, 200, await hub.approveProposal(proposalId.slice(0, -'/approve'.length), reviewerId!, String(body.reason || ''))); return;
      }
      if (request.method === 'POST' && proposalId?.endsWith('/reject')) {
        const body = await jsonBody(request, maxBodyBytes);
        sendJson(response, 200, await hub.rejectProposal(proposalId.slice(0, -'/reject'.length), reviewerId!, String(body.reason || ''))); return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/global/restore') {
        const body = await jsonBody(request, maxBodyBytes);
        sendJson(response, 200, await hub.restoreDocument(String(body.documentId || ''), String(body.targetRevisionId || ''), reviewerId!, String(body.reason || ''), typeof body.expectedCurrentRevision === 'string' ? body.expectedCurrentRevision : undefined)); return;
      }
      if ((request.method === 'GET' || request.method === 'POST') && url.pathname === '/v1/global/audit') { sendJson(response, 200, await hub.audit()); return; }
      response.statusCode = 404; response.end('Not found');
    } catch (error) {
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
  await new Promise<void>((resolvePromise, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, () => { server.off('error', reject); resolvePromise(); }); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port || 0;
  return { server, host, port, hub, close: async () => new Promise<void>((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise())) };
}
