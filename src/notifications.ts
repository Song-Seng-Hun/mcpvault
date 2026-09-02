import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { FileSystemService } from './filesystem.js';
import type { VaultFileCatalog } from './vault-catalog.js';
import type { ScopePrincipal } from './scope-auth.js';
import { normalizeScopeId } from './scopes.js';
import type { ReputationService } from './reputation.js';
import type { QueryNote } from './types.js';
import { iterateNotes } from './paged-query.js';
import { isClosedWorkflowStatus } from './community-status.js';
import { isModerationHidden } from './moderation-policy.js';
import { createDerivedCacheOwner, derivedCacheBudget, estimateCacheBytes } from './cache-budget.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const READ_STATE_ROOT = '_notifications';
const EVENT_CACHE_TTL_MS = 2_000;
const EVENT_CACHE_MAX_ENTRIES = 64;
const HYDRATE_BATCH_SIZE = 32;
const PUBLIC_SNAPSHOT_FILE = '.mcpvault/public-discovery.snapshot.bin';
const PUBLIC_SNAPSHOT_MAGIC = Buffer.from('MCPVPUB1', 'ascii');
const PUBLIC_SNAPSHOT_VERSION = 2;
const PUBLIC_SNAPSHOT_MAX_ENTRIES = 200_000;
const PUBLIC_SNAPSHOT_MAX_BYTES = 128 * 1024 * 1024;

type NotificationKind = 'mention' | 'reply' | 'activity' | 'watch';

export interface NotificationEvent {
  notificationId: string;
  kind: NotificationKind;
  sourcePath: string;
  sourceType: string;
  sourceId: string;
  author: string;
  createdAt: string;
  content: string;
  context?: string;
  authorLevel?: number;
  authorLevelLabel?: string;
  unread: boolean;
}

interface NotificationCandidate {
  notificationId: string;
  kind: NotificationKind;
  sourcePath: string;
  sourceType: string;
  sourceId: string;
  author: string;
  createdAt: string;
  note: QueryNote;
  contextPrefix: string;
  parentPath?: string;
}

export interface PublicSnapshot {
  posts: QueryNote[];
  comments: QueryNote[];
  messages: QueryNote[];
  rooms: QueryNote[];
}

interface PublicSnapshotManifestEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

interface PublicSnapshotDiskNote {
  collection: PublicCollection;
  path: string;
  frontmatter: Record<string, unknown>;
}

interface PublicSnapshotDisk {
  manifest: PublicSnapshotManifestEntry[];
  notes: PublicSnapshotDiskNote[];
}

export interface PublicSnapshotIndex extends PublicSnapshot {
  postsByPostId: Map<string, QueryNote[]>;
  postsBySeriesId: Map<string, QueryNote[]>;
  postsByAuthor: Map<string, QueryNote[]>;
  postsByTag: Map<string, QueryNote[]>;
  postsByMention: Map<string, QueryNote[]>;
  commentsByPostId: Map<string, QueryNote[]>;
  commentsByCommentId: Map<string, QueryNote[]>;
  commentsByAuthor: Map<string, QueryNote[]>;
  commentsByMention: Map<string, QueryNote[]>;
  commentsByReplyTo: Map<string, QueryNote[]>;
  messagesByMessageId: Map<string, QueryNote[]>;
  messagesByMention: Map<string, QueryNote[]>;
  messagesByReplyTo: Map<string, QueryNote[]>;
  postTitles: Map<string, string>;
  roomTitles: Map<string, string>;
  seriesFirstSeen: Map<string, { createdAt: string; path: string }>;
  seriesOrder: string[];
}

function identity(principal: ScopePrincipal): string {
  return principal.agentId || principal.modelId;
}

function readStatePath(principal: ScopePrincipal): string {
  const owner = principal.agentId
    ? `agents/${normalizeScopeId(principal.agentId, 'agentId')}`
    : `models/${normalizeScopeId(principal.modelId, 'modelId')}`;
  return `_scopes/${owner}/${READ_STATE_ROOT}/read-state.md`;
}

function limitNumber(value: unknown, fallback: number, maximum: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('limit must be a positive integer');
  return Math.min(parsed, maximum);
}

function maxChars(value: unknown): number {
  return limitNumber(value, 6000, 20000);
}

function eventId(kind: NotificationKind, path: string, sourceId: string): string {
  return `${kind}:${sourceId || path}`;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function encodeSnapshotString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

function decodeSnapshotString(buffer: Buffer, offset: number): { value: string; offset: number } {
  if (offset + 4 > buffer.length) throw new Error('invalid public discovery snapshot');
  const length = buffer.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + length;
  if (end > buffer.length) throw new Error('invalid public discovery snapshot');
  return { value: buffer.subarray(start, end).toString('utf8'), offset: end };
}

const COLLECTION_CODES: Record<PublicCollection, number> = { posts: 0, comments: 1, messages: 2, rooms: 3 };
const CODE_COLLECTIONS: PublicCollection[] = ['posts', 'comments', 'messages', 'rooms'];

function encodePublicSnapshot(snapshot: PublicSnapshotDisk): Buffer {
  const strings: string[] = [];
  const stringIds = new Map<string, number>();
  const intern = (value: string): number => {
    const existing = stringIds.get(value);
    if (existing !== undefined) return existing;
    const id = strings.length;
    strings.push(value);
    stringIds.set(value, id);
    return id;
  };
  const manifestIds = snapshot.manifest.map(entry => intern(entry.path));
  const noteIds = snapshot.notes.map(note => ({ path: intern(note.path), frontmatter: intern(JSON.stringify(note.frontmatter)) }));
  if (strings.length > PUBLIC_SNAPSHOT_MAX_ENTRIES) throw new Error('public discovery snapshot string table is too large');
  const chunks: Buffer[] = [PUBLIC_SNAPSHOT_MAGIC];
  const header = Buffer.allocUnsafe(16);
  header.writeUInt32LE(PUBLIC_SNAPSHOT_VERSION, 0);
  header.writeUInt32LE(snapshot.manifest.length, 4);
  header.writeUInt32LE(snapshot.notes.length, 8);
  header.writeUInt32LE(strings.length, 12);
  chunks.push(header);
  for (const value of strings) chunks.push(encodeSnapshotString(value));
  for (let index = 0; index < snapshot.manifest.length; index += 1) {
    const entry = snapshot.manifest[index]!;
    const pathId = Buffer.allocUnsafe(4);
    pathId.writeUInt32LE(manifestIds[index]!, 0);
    chunks.push(pathId);
    const metadata = Buffer.allocUnsafe(16);
    metadata.writeDoubleLE(entry.size, 0);
    metadata.writeDoubleLE(entry.mtimeMs, 8);
    chunks.push(metadata);
  }
  for (let index = 0; index < snapshot.notes.length; index += 1) {
    const note = snapshot.notes[index]!;
    chunks.push(Buffer.from([COLLECTION_CODES[note.collection]]));
    const ids = Buffer.allocUnsafe(8);
    ids.writeUInt32LE(noteIds[index]!.path, 0);
    ids.writeUInt32LE(noteIds[index]!.frontmatter, 4);
    chunks.push(ids);
  }
  return Buffer.concat(chunks);
}

function decodePublicSnapshot(buffer: Buffer): PublicSnapshotDisk {
  if (buffer.length < PUBLIC_SNAPSHOT_MAGIC.length + 12 || !buffer.subarray(0, PUBLIC_SNAPSHOT_MAGIC.length).equals(PUBLIC_SNAPSHOT_MAGIC)) {
    throw new Error('unsupported public discovery snapshot');
  }
  let offset = PUBLIC_SNAPSHOT_MAGIC.length;
  const version = buffer.readUInt32LE(offset);
  const manifestCount = buffer.readUInt32LE(offset + 4);
  const noteCount = buffer.readUInt32LE(offset + 8);
  if (version === 1) {
    offset += 12;
    if (manifestCount > PUBLIC_SNAPSHOT_MAX_ENTRIES || noteCount > PUBLIC_SNAPSHOT_MAX_ENTRIES) throw new Error('unsupported public discovery snapshot');
    const manifest: PublicSnapshotManifestEntry[] = [];
    for (let index = 0; index < manifestCount; index += 1) {
      const path = decodeSnapshotString(buffer, offset);
      offset = path.offset;
      if (offset + 16 > buffer.length) throw new Error('invalid public discovery snapshot');
      manifest.push({ path: path.value, size: buffer.readDoubleLE(offset), mtimeMs: buffer.readDoubleLE(offset + 8) });
      offset += 16;
    }
    const notes: PublicSnapshotDiskNote[] = [];
    for (let index = 0; index < noteCount; index += 1) {
      if (offset + 1 > buffer.length) throw new Error('invalid public discovery snapshot');
      const collection = CODE_COLLECTIONS[buffer[offset]!];
      if (!collection) throw new Error('invalid public discovery snapshot collection');
      offset += 1;
      const path = decodeSnapshotString(buffer, offset);
      offset = path.offset;
      const rawFrontmatter = decodeSnapshotString(buffer, offset);
      offset = rawFrontmatter.offset;
      const parsed = JSON.parse(rawFrontmatter.value) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid public discovery snapshot frontmatter');
      notes.push({ collection, path: path.value, frontmatter: parsed as Record<string, unknown> });
    }
    return { manifest, notes };
  }
  if (version !== PUBLIC_SNAPSHOT_VERSION || offset + 4 > buffer.length || manifestCount > PUBLIC_SNAPSHOT_MAX_ENTRIES || noteCount > PUBLIC_SNAPSHOT_MAX_ENTRIES) {
    throw new Error('unsupported public discovery snapshot');
  }
  const stringCount = buffer.readUInt32LE(offset);
  offset += 4;
  if (stringCount > PUBLIC_SNAPSHOT_MAX_ENTRIES) throw new Error('unsupported public discovery snapshot');
  const strings: string[] = [];
  for (let index = 0; index < stringCount; index += 1) {
    const value = decodeSnapshotString(buffer, offset);
    offset = value.offset;
    strings.push(value.value);
  }
  const stringAt = (id: number): string => {
    const value = strings[id];
    if (value === undefined) throw new Error('invalid public discovery snapshot string id');
    return value;
  };
  const manifest: PublicSnapshotManifestEntry[] = [];
  for (let index = 0; index < manifestCount; index += 1) {
    if (offset + 20 > buffer.length) throw new Error('invalid public discovery snapshot');
    const pathId = buffer.readUInt32LE(offset);
    offset += 4;
    manifest.push({ path: stringAt(pathId), size: buffer.readDoubleLE(offset), mtimeMs: buffer.readDoubleLE(offset + 8) });
    offset += 16;
  }
  const notes: PublicSnapshotDiskNote[] = [];
  for (let index = 0; index < noteCount; index += 1) {
    if (offset + 9 > buffer.length) throw new Error('invalid public discovery snapshot');
    const collection = CODE_COLLECTIONS[buffer[offset]!];
    if (!collection) throw new Error('invalid public discovery snapshot collection');
    offset += 1;
    const pathId = buffer.readUInt32LE(offset);
    const frontmatterId = buffer.readUInt32LE(offset + 4);
    offset += 8;
    const parsed = JSON.parse(stringAt(frontmatterId)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid public discovery snapshot frontmatter');
    notes.push({ collection, path: stringAt(pathId), frontmatter: parsed as Record<string, unknown> });
  }
  return { manifest, notes };
}

function addToIndex(index: Map<string, QueryNote[]>, key: unknown, note: QueryNote): void {
  const normalized = text(key).toLowerCase();
  if (!normalized) return;
  const existing = index.get(normalized);
  if (existing) existing.push(note);
  else index.set(normalized, [note]);
}

function addMentions(index: Map<string, QueryNote[]>, note: QueryNote): void {
  if (!Array.isArray(note.frontmatter.mentions)) return;
  for (const mention of note.frontmatter.mentions) addToIndex(index, mention, note);
}

type PublicCollection = keyof PublicSnapshot;

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function publicCollectionForPath(path: string): PublicCollection | undefined {
  const normalized = normalizePath(path);
  if (normalized.startsWith('Community/Posts/')) return 'posts';
  if (normalized.startsWith('Community/Comments/')) return 'comments';
  if (normalized.startsWith('Community/ChatMessages/')) return 'messages';
  if (normalized.startsWith('Community/ChatRooms/')) return 'rooms';
  return undefined;
}

function isPublicRootNotePath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized.startsWith('Community/Posts/')
    || normalized.startsWith('Community/Comments/')
    || normalized.startsWith('Community/ChatMessages/')
    || normalized.startsWith('Community/ChatRooms/');
}

function belongsInPublicCollection(note: QueryNote, collection: PublicCollection): boolean {
  const type = text(note.frontmatter.mcpvault_type).toLowerCase();
  if (collection === 'posts') return type === 'blog_post' && text(note.frontmatter.status).toLowerCase() === 'published';
  if (collection === 'comments') return type === 'blog_comment';
  if (collection === 'messages') return type === 'chat_message';
  return type === 'chat_room';
}

const PUBLIC_METADATA_FIELDS: Record<PublicCollection, readonly string[]> = {
  posts: ['mcpvault_type', 'status', 'post_id', 'title', 'author', 'category', 'tags', 'mentions', 'series_id', 'series_title', 'series_order', 'related_posts', 'duplicate_of', 'created_at', 'updated_at', 'workflow_status', 'workflow_status_by', 'workflow_status_reason', 'workflow_status_updated_at', 'moderation_status', 'moderation_reason', 'moderated_by', 'moderated_at'],
  comments: ['mcpvault_type', 'post_id', 'comment_id', 'author', 'mentions', 'reply_to', 'created_at', 'updated_at', 'workflow_status', 'workflow_status_by', 'workflow_status_reason', 'workflow_status_updated_at', 'moderation_status', 'moderation_reason', 'moderated_by', 'moderated_at', 'content_status'],
  messages: ['mcpvault_type', 'room_id', 'message_id', 'author', 'mentions', 'reply_to', 'created_at', 'updated_at', 'workflow_status', 'workflow_status_by', 'workflow_status_reason', 'workflow_status_updated_at', 'moderation_status', 'moderation_reason', 'moderated_by', 'moderated_at', 'content_status'],
  rooms: ['mcpvault_type', 'room_id', 'title', 'creator', 'created_at', 'updated_at', 'archived', 'workflow_status', 'moderation_status'],
};

function compactPublicNote(note: QueryNote, collection: PublicCollection): QueryNote {
  const frontmatter = Object.fromEntries(PUBLIC_METADATA_FIELDS[collection]
    .filter(field => Object.prototype.hasOwnProperty.call(note.frontmatter, field))
    .map(field => [field, note.frontmatter[field]]));
  return { path: note.path, frontmatter };
}

function sortPublicCollection(notes: QueryNote[], collection: PublicCollection): QueryNote[] {
  if (collection === 'rooms') return notes.sort((a, b) => a.path.localeCompare(b.path));
  return notes.sort((a, b) => String(b.frontmatter.created_at || '').localeCompare(String(a.frontmatter.created_at || '')) || a.path.localeCompare(b.path));
}

function buildPublicSnapshotIndex(snapshot: PublicSnapshot): PublicSnapshotIndex {
  const index: PublicSnapshotIndex = {
    ...snapshot,
    postsByPostId: new Map(),
    postsBySeriesId: new Map(),
    postsByAuthor: new Map(),
    postsByTag: new Map(),
    postsByMention: new Map(),
    commentsByPostId: new Map(),
    commentsByCommentId: new Map(),
    commentsByAuthor: new Map(),
    commentsByMention: new Map(),
    commentsByReplyTo: new Map(),
    messagesByMessageId: new Map(),
    messagesByMention: new Map(),
    messagesByReplyTo: new Map(),
    postTitles: new Map(),
    roomTitles: new Map(),
    seriesFirstSeen: new Map(),
    seriesOrder: [],
  };
  const seriesFirstSeen = new Map<string, { createdAt: string; path: string }>();
  for (const note of snapshot.posts) {
    addToIndex(index.postsByPostId, note.frontmatter.post_id, note);
    addToIndex(index.postsBySeriesId, note.frontmatter.series_id, note);
    addToIndex(index.postsByAuthor, note.frontmatter.author, note);
    const seriesId = text(note.frontmatter.series_id).toLowerCase();
    if (seriesId && !isModerationHidden(note.frontmatter)) {
      const seen = seriesFirstSeen.get(seriesId);
      const candidate = { createdAt: text(note.frontmatter.created_at), path: note.path };
      if (!seen || candidate.createdAt < seen.createdAt || (candidate.createdAt === seen.createdAt && candidate.path < seen.path)) seriesFirstSeen.set(seriesId, candidate);
    }
    addMentions(index.postsByMention, note);
    if (Array.isArray(note.frontmatter.tags)) {
      for (const tag of note.frontmatter.tags) addToIndex(index.postsByTag, tag, note);
    }
    const postId = text(note.frontmatter.post_id);
    if (postId) index.postTitles.set(postId, text(note.frontmatter.title, postId));
  }
  for (const note of snapshot.comments) {
    addToIndex(index.commentsByPostId, note.frontmatter.post_id, note);
    addToIndex(index.commentsByCommentId, note.frontmatter.comment_id, note);
    addToIndex(index.commentsByAuthor, note.frontmatter.author, note);
    addMentions(index.commentsByMention, note);
    addToIndex(index.commentsByReplyTo, note.frontmatter.reply_to, note);
  }
  for (const note of snapshot.messages) {
    addToIndex(index.messagesByMessageId, note.frontmatter.message_id, note);
    addMentions(index.messagesByMention, note);
    addToIndex(index.messagesByReplyTo, note.frontmatter.reply_to, note);
  }
  for (const note of snapshot.rooms) {
    const roomId = text(note.frontmatter.room_id);
    if (roomId) index.roomTitles.set(roomId, text(note.frontmatter.title, roomId));
  }
  index.seriesOrder = [...seriesFirstSeen.entries()]
    .sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt) || a[1].path.localeCompare(b[1].path))
    .map(([seriesId]) => seriesId);
  index.seriesFirstSeen = seriesFirstSeen;
  return index;
}

function cloneCollectionIndex(index: PublicSnapshotIndex, collection: PublicCollection, notes: QueryNote[]): PublicSnapshotIndex {
  const next = { ...index, [collection]: notes } as PublicSnapshotIndex;
  if (collection === 'posts') {
    return {
      ...next,
      postsByPostId: new Map(index.postsByPostId),
      postsBySeriesId: new Map(index.postsBySeriesId),
      postsByAuthor: new Map(index.postsByAuthor),
      postsByTag: new Map(index.postsByTag),
      postsByMention: new Map(index.postsByMention),
      postTitles: new Map(index.postTitles),
      seriesFirstSeen: new Map(index.seriesFirstSeen),
      seriesOrder: index.seriesOrder.slice(),
    };
  }
  if (collection === 'comments') {
    return {
      ...next,
      commentsByPostId: new Map(index.commentsByPostId),
      commentsByCommentId: new Map(index.commentsByCommentId),
      commentsByAuthor: new Map(index.commentsByAuthor),
      commentsByMention: new Map(index.commentsByMention),
      commentsByReplyTo: new Map(index.commentsByReplyTo),
    };
  }
  if (collection === 'messages') {
    return {
      ...next,
      messagesByMessageId: new Map(index.messagesByMessageId),
      messagesByMention: new Map(index.messagesByMention),
      messagesByReplyTo: new Map(index.messagesByReplyTo),
    };
  }
  return { ...next, roomTitles: new Map(index.roomTitles) };
}

function removeIndexedValue(index: Map<string, QueryNote[]>, key: unknown, path: string): void {
  const normalized = text(key).toLowerCase();
  if (!normalized) return;
  const bucket = index.get(normalized);
  if (!bucket) return;
  const next = bucket.filter(note => note.path !== path);
  if (next.length) index.set(normalized, next);
  else index.delete(normalized);
}

function addIndexedValue(index: Map<string, QueryNote[]>, key: unknown, note: QueryNote): void {
  const normalized = text(key).toLowerCase();
  if (!normalized) return;
  const bucket = index.get(normalized);
  if (bucket) index.set(normalized, [...bucket, note]);
  else index.set(normalized, [note]);
}

function removeIndexedMentions(index: Map<string, QueryNote[]>, note: QueryNote): void {
  if (!Array.isArray(note.frontmatter.mentions)) return;
  for (const mention of note.frontmatter.mentions) removeIndexedValue(index, mention, note.path);
}

function addIndexedMentions(index: Map<string, QueryNote[]>, note: QueryNote): void {
  if (!Array.isArray(note.frontmatter.mentions)) return;
  for (const mention of note.frontmatter.mentions) addIndexedValue(index, mention, note);
}

function removeFromCollectionIndex(index: PublicSnapshotIndex, collection: PublicCollection, note: QueryNote): Set<string> {
  const affectedSeries = new Set<string>();
  if (collection === 'posts') {
    removeIndexedValue(index.postsByPostId, note.frontmatter.post_id, note.path);
    removeIndexedValue(index.postsBySeriesId, note.frontmatter.series_id, note.path);
    removeIndexedValue(index.postsByAuthor, note.frontmatter.author, note.path);
    removeIndexedMentions(index.postsByMention, note);
    if (Array.isArray(note.frontmatter.tags)) for (const tag of note.frontmatter.tags) removeIndexedValue(index.postsByTag, tag, note.path);
    const postId = text(note.frontmatter.post_id);
    if (postId) index.postTitles.delete(postId);
    const seriesId = text(note.frontmatter.series_id).toLowerCase();
    if (seriesId) affectedSeries.add(seriesId);
  } else if (collection === 'comments') {
    removeIndexedValue(index.commentsByPostId, note.frontmatter.post_id, note.path);
    removeIndexedValue(index.commentsByCommentId, note.frontmatter.comment_id, note.path);
    removeIndexedValue(index.commentsByAuthor, note.frontmatter.author, note.path);
    removeIndexedMentions(index.commentsByMention, note);
    removeIndexedValue(index.commentsByReplyTo, note.frontmatter.reply_to, note.path);
  } else if (collection === 'messages') {
    removeIndexedValue(index.messagesByMessageId, note.frontmatter.message_id, note.path);
    removeIndexedMentions(index.messagesByMention, note);
    removeIndexedValue(index.messagesByReplyTo, note.frontmatter.reply_to, note.path);
  } else {
    const roomId = text(note.frontmatter.room_id);
    if (roomId) index.roomTitles.delete(roomId);
  }
  return affectedSeries;
}

function addToCollectionIndex(index: PublicSnapshotIndex, collection: PublicCollection, note: QueryNote): Set<string> {
  const affectedSeries = new Set<string>();
  if (collection === 'posts') {
    addIndexedValue(index.postsByPostId, note.frontmatter.post_id, note);
    addIndexedValue(index.postsBySeriesId, note.frontmatter.series_id, note);
    addIndexedValue(index.postsByAuthor, note.frontmatter.author, note);
    addIndexedMentions(index.postsByMention, note);
    if (Array.isArray(note.frontmatter.tags)) for (const tag of note.frontmatter.tags) addIndexedValue(index.postsByTag, tag, note);
    const postId = text(note.frontmatter.post_id);
    if (postId) index.postTitles.set(postId, text(note.frontmatter.title, postId));
    const seriesId = text(note.frontmatter.series_id).toLowerCase();
    if (seriesId) affectedSeries.add(seriesId);
  } else if (collection === 'comments') {
    addIndexedValue(index.commentsByPostId, note.frontmatter.post_id, note);
    addIndexedValue(index.commentsByCommentId, note.frontmatter.comment_id, note);
    addIndexedValue(index.commentsByAuthor, note.frontmatter.author, note);
    addIndexedMentions(index.commentsByMention, note);
    addIndexedValue(index.commentsByReplyTo, note.frontmatter.reply_to, note);
  } else if (collection === 'messages') {
    addIndexedValue(index.messagesByMessageId, note.frontmatter.message_id, note);
    addIndexedMentions(index.messagesByMention, note);
    addIndexedValue(index.messagesByReplyTo, note.frontmatter.reply_to, note);
  } else {
    const roomId = text(note.frontmatter.room_id);
    if (roomId) index.roomTitles.set(roomId, text(note.frontmatter.title, roomId));
  }
  return affectedSeries;
}

function refreshSeriesOrder(index: PublicSnapshotIndex, seriesIds: Set<string>): void {
  for (const seriesId of seriesIds) {
    const candidates = (index.postsBySeriesId.get(seriesId) || []).filter(note => !isModerationHidden(note.frontmatter));
    if (!candidates.length) {
      index.seriesFirstSeen.delete(seriesId);
      continue;
    }
    let first = candidates[0]!;
    for (const candidate of candidates.slice(1)) {
      const candidateCreatedAt = text(candidate.frontmatter.created_at);
      const firstCreatedAt = text(first.frontmatter.created_at);
      if (candidateCreatedAt < firstCreatedAt || (candidateCreatedAt === firstCreatedAt && candidate.path < first.path)) first = candidate;
    }
    index.seriesFirstSeen.set(seriesId, { createdAt: text(first.frontmatter.created_at), path: first.path });
  }
  index.seriesOrder = [...index.seriesFirstSeen.entries()]
    .sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt) || a[1].path.localeCompare(b[1].path))
    .map(([seriesId]) => seriesId);
}

function patchPublicSnapshotIndex(index: PublicSnapshotIndex, collection: PublicCollection, notes: QueryNote[], previous: QueryNote | undefined, nextNote: QueryNote | undefined): PublicSnapshotIndex {
  const next = cloneCollectionIndex(index, collection, notes);
  const affectedSeries = new Set<string>();
  if (previous) for (const seriesId of removeFromCollectionIndex(next, collection, previous)) affectedSeries.add(seriesId);
  if (nextNote) for (const seriesId of addToCollectionIndex(next, collection, nextNote)) affectedSeries.add(seriesId);
  if (collection === 'posts') refreshSeriesOrder(next, affectedSeries);
  return next;
}

export class NotificationService {
  private readonly candidateCacheOwner = createDerivedCacheOwner('notifications.candidates');
  private readonly publicSnapshotCacheOwner = createDerivedCacheOwner('notifications.public-snapshot');
  private readonly candidateCache = new Map<string, { expiresAt: number; candidates: NotificationCandidate[] }>();
  private readonly candidateInFlight = new Map<string, Promise<NotificationCandidate[]>>();
  private publicSnapshotCache: { expiresAt: number; value: PublicSnapshotIndex } | undefined;
  private publicSnapshotInFlight: Promise<PublicSnapshotIndex> | undefined;
  private publicSnapshotUpdate: Promise<void> | undefined;
  private publicSnapshotWrite: Promise<void> | undefined;
  private publicSnapshotPending: PublicSnapshotIndex | undefined;
  private publicManifestCache: { expiresAt: number; entries: PublicSnapshotManifestEntry[] } | undefined;
  private publicSnapshotRestoreAttempted = false;

  constructor(
    private readonly fileSystem: FileSystemService,
    private readonly reputation: ReputationService,
    private readonly vaultPath?: string,
    private readonly fileCatalog?: VaultFileCatalog,
  ) {}

  async close(): Promise<void> {
    if (this.publicSnapshotUpdate) await this.publicSnapshotUpdate;
    if (this.publicSnapshotWrite) await this.publicSnapshotWrite;
    this.clearCandidateCache();
    this.clearPublicSnapshotCache();
  }

  async discoverySnapshot(): Promise<PublicSnapshotIndex> {
    return this.cachedPublicSnapshot();
  }

  /** Return only indexed public items that mention one of the exact identities. */
  async mentionCandidates(targets: ReadonlySet<string>, includeClosed = false): Promise<QueryNote[]> {
    const snapshot = await this.cachedPublicSnapshot();
    const unique = new Map<string, QueryNote>();
    for (const target of targets) {
      const key = target.toLowerCase();
      for (const note of [...(snapshot.commentsByMention.get(key) || []), ...(snapshot.messagesByMention.get(key) || [])]) {
        if (isModerationHidden(note.frontmatter)) continue;
        if (!includeClosed && isClosedWorkflowStatus(note.frontmatter.workflow_status)) continue;
        unique.set(note.path, note);
      }
    }
    return [...unique.values()].sort((a, b) => String(b.frontmatter.created_at || '').localeCompare(String(a.frontmatter.created_at || '')) || a.path.localeCompare(b.path));
  }

  private async publicManifest(): Promise<PublicSnapshotManifestEntry[] | undefined> {
    if (!this.vaultPath || !this.fileCatalog) return undefined;
    if (this.publicManifestCache && this.publicManifestCache.expiresAt > Date.now()) return this.publicManifestCache.entries;
    const paths = (await this.fileCatalog.notePathsSnapshot()).filter(isPublicRootNotePath).sort((a, b) => a.localeCompare(b));
    const stats = await this.fileCatalog.statPaths(paths);
    if (stats.size !== paths.length) return undefined;
    const entries = paths.map(path => ({ path, ...stats.get(path)! }));
    this.publicManifestCache = { expiresAt: Date.now() + EVENT_CACHE_TTL_MS, entries };
    return entries;
  }

  private async loadPublicSnapshot(): Promise<PublicSnapshotIndex | undefined> {
    if (!this.vaultPath || !this.fileCatalog) return undefined;
    try {
      const compressed = await readFile(join(this.vaultPath, PUBLIC_SNAPSHOT_FILE));
      const raw = await gunzipAsync(compressed);
      if (raw.length > PUBLIC_SNAPSHOT_MAX_BYTES) return undefined;
      const disk = decodePublicSnapshot(raw);
      const currentManifest = await this.publicManifest();
      if (!currentManifest || currentManifest.length !== disk.manifest.length) return undefined;
      for (let index = 0; index < currentManifest.length; index += 1) {
        const current = currentManifest[index]!;
        const saved = disk.manifest[index]!;
        if (current.path !== saved.path || current.size !== saved.size || current.mtimeMs !== saved.mtimeMs) return undefined;
      }
      const snapshot: PublicSnapshot = { posts: [], comments: [], messages: [], rooms: [] };
      for (const note of disk.notes) snapshot[note.collection].push({ path: normalizePath(note.path), frontmatter: note.frontmatter });
      for (const collection of ['posts', 'comments', 'messages', 'rooms'] as const) sortPublicCollection(snapshot[collection], collection);
      return buildPublicSnapshotIndex(snapshot);
    } catch {
      return undefined;
    }
  }

  private async savePublicSnapshot(value: PublicSnapshotIndex): Promise<void> {
    if (!this.vaultPath || !this.fileCatalog) return;
    try {
      const manifest = await this.publicManifest();
      if (!manifest || manifest.length > PUBLIC_SNAPSHOT_MAX_ENTRIES) return;
      const notes: PublicSnapshotDiskNote[] = [];
      for (const collection of ['posts', 'comments', 'messages', 'rooms'] as const) {
        for (const note of value[collection]) notes.push({ collection, path: note.path, frontmatter: note.frontmatter });
      }
      if (notes.length > PUBLIC_SNAPSHOT_MAX_ENTRIES) return;
      const compressed = await gzipAsync(encodePublicSnapshot({ manifest, notes }));
      const snapshotPath = join(this.vaultPath, PUBLIC_SNAPSHOT_FILE);
      const temporaryPath = `${snapshotPath}.${process.pid}.tmp`;
      await mkdir(join(this.vaultPath, '.mcpvault'), { recursive: true });
      await writeFile(temporaryPath, compressed);
      await rename(temporaryPath, snapshotPath);
    } catch {
      // Derived acceleration state is optional; Markdown remains authoritative.
    }
  }

  private queuePublicSnapshotSave(value: PublicSnapshotIndex): void {
    this.publicSnapshotPending = value;
    if (this.publicSnapshotWrite) return;
    const write = (async () => {
      while (this.publicSnapshotPending) {
        const pending = this.publicSnapshotPending;
        this.publicSnapshotPending = undefined;
        await this.savePublicSnapshot(pending);
      }
    })().catch(() => undefined);
    this.publicSnapshotWrite = write;
    void write.finally(() => {
      if (this.publicSnapshotWrite === write) this.publicSnapshotWrite = undefined;
    });
  }

  private clearCandidateCache(): void {
    this.candidateCache.clear();
    this.candidateInFlight.clear();
    derivedCacheBudget.clearOwner(this.candidateCacheOwner);
  }

  private clearPublicSnapshotCache(): void {
    this.publicSnapshotCache = undefined;
    this.publicManifestCache = undefined;
    derivedCacheBudget.clearOwner(this.publicSnapshotCacheOwner);
  }

  private trackPublicSnapshotCache(value: PublicSnapshotIndex): void {
    const bytes = estimateCacheBytes({ posts: value.posts, comments: value.comments, messages: value.messages, rooms: value.rooms }) + 256;
    derivedCacheBudget.register(this.publicSnapshotCacheOwner, 'current', bytes, () => {
      this.publicSnapshotCache = undefined;
    }, { allowOversized: true });
  }

  invalidate(path?: string, kind: 'upsert' | 'delete' = 'upsert'): void {
    this.invalidateMany(path ? [{ path, kind }] : undefined);
  }

  invalidateMany(changes?: readonly { path: string; kind: 'upsert' | 'delete' }[]): void {
    this.clearCandidateCache();
    if (!changes) {
      this.clearPublicSnapshotCache();
      return;
    }
    const relevant = changes
      .map(change => ({ ...change, collection: publicCollectionForPath(change.path) }))
      .filter((change): change is typeof change & { collection: PublicCollection } => Boolean(change.collection));
    if (relevant.length === 0) return;
    this.publicManifestCache = undefined;
    const previous = this.publicSnapshotUpdate || Promise.resolve();
    const update = previous.then(async () => {
      for (const change of relevant) await this.updatePublicSnapshot(change.path, change.kind, change.collection);
    }).catch(() => {
      this.publicSnapshotCache = undefined;
    });
    this.publicSnapshotUpdate = update;
    void update.finally(() => {
      if (this.publicSnapshotUpdate === update) this.publicSnapshotUpdate = undefined;
    });
  }

  private async cachedPublicSnapshot(): Promise<PublicSnapshotIndex> {
    while (this.publicSnapshotUpdate) await this.publicSnapshotUpdate;
    const cached = this.publicSnapshotCache;
    if (cached && cached.expiresAt > Date.now()) {
      derivedCacheBudget.touch(this.publicSnapshotCacheOwner, 'current');
      return cached.value;
    }
    if (cached) this.clearPublicSnapshotCache();
    if (this.publicSnapshotInFlight) return this.publicSnapshotInFlight;
    const computation = (async () => {
      if (!this.publicSnapshotRestoreAttempted) {
        this.publicSnapshotRestoreAttempted = true;
        const restored = await this.loadPublicSnapshot();
        if (restored) return restored;
      }
      const snapshot: PublicSnapshot = { posts: [], comments: [], messages: [], rooms: [] };
      for await (const note of iterateNotes(this.fileSystem)) {
        const collection = publicCollectionForPath(note.path);
        if (collection && belongsInPublicCollection(note, collection)) snapshot[collection].push(compactPublicNote(note, collection));
      }
      for (const collection of ['posts', 'comments', 'messages', 'rooms'] as const) sortPublicCollection(snapshot[collection], collection);
      const value = buildPublicSnapshotIndex(snapshot);
      this.queuePublicSnapshotSave(value);
      return value;
    })();
    this.publicSnapshotInFlight = computation;
    try {
      const value = await computation;
      this.publicSnapshotCache = { expiresAt: Date.now() + EVENT_CACHE_TTL_MS, value };
      this.trackPublicSnapshotCache(value);
      return value;
    } finally {
      if (this.publicSnapshotInFlight === computation) this.publicSnapshotInFlight = undefined;
    }
  }

  private async updatePublicSnapshot(path: string, kind: 'upsert' | 'delete', collection: PublicCollection): Promise<void> {
    if (this.publicSnapshotInFlight) await this.publicSnapshotInFlight;
    const cached = this.publicSnapshotCache;
    if (!cached || cached.expiresAt <= Date.now()) {
      this.clearPublicSnapshotCache();
      return;
    }
    const previous = cached.value[collection].find(note => note.path === path);
    const nextCollection = cached.value[collection].filter(note => note.path !== path);
    let nextNote: QueryNote | undefined;
    if (kind !== 'delete') {
      const note = await this.fileSystem.readNote(path);
      const metadata: QueryNote = { path: normalizePath(path), frontmatter: compactPublicNote({ path, frontmatter: note.frontmatter }, collection).frontmatter };
      if (belongsInPublicCollection(metadata, collection)) {
        nextNote = metadata;
        nextCollection.push(metadata);
      }
    }
    sortPublicCollection(nextCollection, collection);
    const value = patchPublicSnapshotIndex(cached.value, collection, nextCollection, previous, nextNote);
    this.publicSnapshotCache = { expiresAt: Date.now() + EVENT_CACHE_TTL_MS, value };
    this.trackPublicSnapshotCache(value);
  }

  private async hydrateNotes(notes: QueryNote[]): Promise<QueryNote[]> {
    const unique = [...new Map(notes.map(note => [note.path, note])).values()];
    const hydrated: QueryNote[] = [];
    for (let start = 0; start < unique.length; start += HYDRATE_BATCH_SIZE) {
      const batch = unique.slice(start, start + HYDRATE_BATCH_SIZE);
      const results = await Promise.all(batch.map(async note => {
        try {
          const parsed = await this.fileSystem.readNote(note.path);
          return { ...note, frontmatter: parsed.frontmatter, content: parsed.content };
        } catch {
          return undefined;
        }
      }));
      hydrated.push(...results.filter((note): note is QueryNote & { content: string } => note !== undefined));
    }
    return hydrated;
  }

  private async cachedPublicCandidates(principal: ScopePrincipal): Promise<NotificationCandidate[]> {
    const key = JSON.stringify({ accountId: principal.accountId, modelId: principal.modelId, agentId: principal.agentId, role: principal.role });
    const cached = this.candidateCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      derivedCacheBudget.touch(this.candidateCacheOwner, key);
      return cached.candidates;
    }
    if (cached) {
      this.candidateCache.delete(key);
      derivedCacheBudget.remove(this.candidateCacheOwner, key);
    }
    const running = this.candidateInFlight.get(key);
    if (running) return running;
    const computation = this.publicCandidates(principal);
    this.candidateInFlight.set(key, computation);
    try {
      const candidates = await computation;
      const cachedCandidates = candidates.map(candidate => ({ ...candidate }));
      this.candidateCache.set(key, { expiresAt: Date.now() + EVENT_CACHE_TTL_MS, candidates: cachedCandidates });
      derivedCacheBudget.register(
        this.candidateCacheOwner,
        key,
        estimateCacheBytes(cachedCandidates) + Buffer.byteLength(key, 'utf8') + 128,
        () => this.candidateCache.delete(key),
      );
      while (this.candidateCache.size > EVENT_CACHE_MAX_ENTRIES) {
        const oldest = this.candidateCache.keys().next();
        if (oldest.done) break;
        this.candidateCache.delete(oldest.value);
        derivedCacheBudget.remove(this.candidateCacheOwner, oldest.value);
      }
      return candidates;
    } finally {
      if (this.candidateInFlight.get(key) === computation) this.candidateInFlight.delete(key);
    }
  }

  private async lastReadAt(principal: ScopePrincipal): Promise<{ value?: string; revision?: string }> {
    const path = readStatePath(principal);
    if (!await this.fileSystem.noteExists(path)) return {};
    const note = await this.fileSystem.readNote(path);
    return { value: text(note.frontmatter.last_read_at), revision: note.revision };
  }

  private async publicCandidates(principal: ScopePrincipal): Promise<NotificationCandidate[]> {
    const target = identity(principal);
    const ownerRoot = principal.agentId
      ? `_scopes/agents/${normalizeScopeId(principal.agentId, 'agentId')}/_subscriptions`
      : `_scopes/models/${normalizeScopeId(principal.modelId, 'modelId')}/_subscriptions`;
    const snapshot = await this.cachedPublicSnapshot();
    const { messages, postsByPostId, postsBySeriesId, postsByAuthor, postsByTag, postsByMention, commentsByPostId, commentsByCommentId, commentsByAuthor, commentsByMention, commentsByReplyTo, messagesByMessageId, messagesByMention, messagesByReplyTo, postTitles, roomTitles } = snapshot;
    const targetKey = target.toLowerCase();
    const ownedPostIds = new Set((postsByAuthor.get(targetKey) || []).map(note => text(note.frontmatter.post_id)));
    const ownedCommentIds = new Set((commentsByAuthor.get(targetKey) || []).map(note => text(note.frontmatter.comment_id)));
    const ownedMessageIds = new Set(messages.filter(note => text(note.frontmatter.author).toLowerCase() === targetKey).map(note => text(note.frontmatter.message_id)));

    const watchedPostIds = new Set<string>();
    const watchedSeriesIds = new Set<string>();
    const watchedAuthors = new Set<string>();
    const watchedTags = new Set<string>();
    for await (const subscription of iterateNotes(this.fileSystem, { pathPrefix: ownerRoot, filters: { mcpvault_type: 'subscription', active: true } })) {
      const type = text(subscription.frontmatter.target_type).toLowerCase();
      const value = text(subscription.frontmatter.target_id).toLowerCase();
      if (!value) continue;
      if (type === 'post') watchedPostIds.add(value);
      else if (type === 'series') watchedSeriesIds.add(value);
      else if (type === 'author') watchedAuthors.add(value);
      else if (type === 'tag') watchedTags.add(value);
    }
    const uniqueNotes = (notesToAdd: QueryNote[][]): QueryNote[] => {
      const unique = new Map<string, QueryNote>();
      for (const notes of notesToAdd) for (const note of notes) unique.set(note.path, note);
      return [...unique.values()];
    };
    const relevantPosts = uniqueNotes([
      postsByMention.get(targetKey) || [],
      ...[...watchedPostIds].map(id => postsByPostId.get(id) || []),
      ...[...watchedSeriesIds].map(id => postsBySeriesId.get(id) || []),
      ...[...watchedAuthors].map(id => postsByAuthor.get(id) || []),
      ...[...watchedTags].map(id => postsByTag.get(id) || []),
    ]).filter(note => text(note.frontmatter.author).toLowerCase() !== targetKey);
    const relevantComments = uniqueNotes([
      commentsByMention.get(targetKey) || [],
      ...[...ownedCommentIds].map(id => commentsByReplyTo.get(id.toLowerCase()) || []),
      ...[...ownedPostIds].map(id => commentsByPostId.get(id.toLowerCase()) || []),
      ...[...watchedPostIds].map(id => commentsByPostId.get(id) || []),
      ...[...watchedAuthors].map(id => commentsByAuthor.get(id) || []),
    ]).filter(note => text(note.frontmatter.author).toLowerCase() !== targetKey);
    const relevantMessages = uniqueNotes([
      messagesByMention.get(targetKey) || [],
      ...[...ownedMessageIds].map(id => messagesByReplyTo.get(id.toLowerCase()) || []),
    ]).filter(note => text(note.frontmatter.author).toLowerCase() !== targetKey);
    const candidates: NotificationCandidate[] = [];
    const candidateIds = new Set<string>();
    const parentPathFor = (note: QueryNote, replyTo: string): string | undefined => {
      if (!replyTo) return undefined;
      const type = text(note.frontmatter.mcpvault_type);
      return type === 'blog_comment'
        ? commentsByCommentId.get(replyTo.toLowerCase())?.[0]?.path
        : type === 'chat_message'
          ? messagesByMessageId.get(replyTo.toLowerCase())?.[0]?.path
          : undefined;
    };
    const addCandidate = (note: QueryNote, kind: NotificationKind, sourceId: string): void => {
      const author = text(note.frontmatter.author);
      if (!author || author === target) return;
      const mentions = Array.isArray(note.frontmatter.mentions) ? note.frontmatter.mentions.map(String).map(value => value.toLowerCase()) : [];
      const isMention = mentions.includes(target.toLowerCase());
      const replyTo = text(note.frontmatter.reply_to);
      const isReply = (note.frontmatter.mcpvault_type === 'blog_comment' && ownedCommentIds.has(replyTo))
        || (note.frontmatter.mcpvault_type === 'chat_message' && ownedMessageIds.has(replyTo));
      const postId = text(note.frontmatter.post_id);
      const roomId = text(note.frontmatter.room_id);
      const activity = note.frontmatter.mcpvault_type === 'blog_comment' && ownedPostIds.has(postId);
      if (!isMention && !isReply && !activity) return;
      const selectedKind: NotificationKind = isMention ? 'mention' : isReply ? 'reply' : kind;
      const type = text(note.frontmatter.mcpvault_type);
      const contextPrefix = type === 'blog_comment'
        ? `post: ${postTitles.get(postId) || postId}`
        : `room: ${roomTitles.get(roomId) || roomId}`;
      const notificationId = eventId(selectedKind, note.path, sourceId);
      if (candidateIds.has(notificationId)) return;
      candidateIds.add(notificationId);
      const parentPath = parentPathFor(note, replyTo);
      candidates.push({
        notificationId,
        kind: selectedKind,
        sourcePath: note.path,
        sourceType: type,
        sourceId,
        author,
        createdAt: text(note.frontmatter.created_at),
        note,
        contextPrefix,
        ...(parentPath ? { parentPath } : {}),
      });
    };

    const watchedSourceCache = new Map<string, QueryNote[]>();
    const watchedSources = (type: string, target: string): QueryNote[] => {
      const cacheKey = `${type}:${target}`;
      const cached = watchedSourceCache.get(cacheKey);
      if (cached) return cached;
      const metadataSources = type === 'post'
        ? [...(postsByPostId.get(target) || []), ...(commentsByPostId.get(target) || [])]
        : type === 'series'
          ? (postsBySeriesId.get(target) || [])
          : type === 'author'
            ? [...(postsByAuthor.get(target) || []), ...(commentsByAuthor.get(target) || [])]
            : type === 'tag'
              ? (postsByTag.get(target) || [])
              : [];
      watchedSourceCache.set(cacheKey, metadataSources);
      return metadataSources;
    };

    for (const note of relevantComments) addCandidate(note, 'activity', text(note.frontmatter.comment_id));
    for (const note of relevantMessages) addCandidate(note, 'activity', text(note.frontmatter.message_id));
    // A post mention is useful too, while comments on a post are handled above.
    for (const note of relevantPosts) addCandidate(note, 'activity', text(note.frontmatter.post_id));

    const watchedEvents = new Set<string>();
    for await (const subscription of iterateNotes(this.fileSystem, { pathPrefix: ownerRoot, filters: { mcpvault_type: 'subscription', active: true } })) {
      const type = text(subscription.frontmatter.target_type);
      const target = text(subscription.frontmatter.target_id).toLowerCase();
      const sources = watchedSources(type, target);
      for (const note of sources) {
        const sourceId = text(note.frontmatter.post_id || note.frontmatter.comment_id);
        const notificationId = eventId('watch', note.path, `${type}:${target}:${sourceId}`);
        if (watchedEvents.has(notificationId) || text(note.frontmatter.author) === identity(principal)) continue;
        watchedEvents.add(notificationId);
        const author = text(note.frontmatter.author);
        if (!author || candidateIds.has(notificationId)) continue;
        candidateIds.add(notificationId);
        candidates.push({ notificationId, kind: 'watch', sourcePath: note.path, sourceType: text(note.frontmatter.mcpvault_type), sourceId, author, createdAt: text(note.frontmatter.updated_at || note.frontmatter.created_at), note, contextPrefix: `watched ${type}: ${target}` });
      }
    }
    return candidates.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.notificationId.localeCompare(b.notificationId));
  }

  private async hydrateCandidates(candidates: NotificationCandidate[], cutoff: string): Promise<NotificationEvent[]> {
    const parentNotes = candidates.flatMap(candidate => candidate.parentPath ? [candidate.note, { path: candidate.parentPath, frontmatter: {} }] : [candidate.note]);
    const hydrated = await this.hydrateNotes(parentNotes);
    const byPath = new Map(hydrated.map(note => [note.path, note]));
    const reputations = await this.reputation.getMany(candidates.map(candidate => candidate.author));
    return candidates.flatMap(candidate => {
      const note = byPath.get(candidate.note.path);
      if (!note) return [];
      const parent = candidate.parentPath ? byPath.get(candidate.parentPath) : undefined;
      const context = parent?.content ? `${candidate.contextPrefix} | replying to: ${text(parent.content).trim()}` : candidate.contextPrefix;
      const reputation = reputations.get(candidate.author.toLowerCase());
      return [{ notificationId: candidate.notificationId, kind: candidate.kind, sourcePath: candidate.sourcePath, sourceType: candidate.sourceType, sourceId: candidate.sourceId, author: candidate.author, createdAt: candidate.createdAt, content: text(note.content).trim(), context, ...(reputation && { authorLevel: reputation.level, authorLevelLabel: reputation.label }), unread: !cutoff || candidate.createdAt > cutoff }];
    });
  }

  async list(params: { principal?: ScopePrincipal; includeRead?: boolean; limit?: number; maxChars?: number; afterNotificationId?: string }) {
    if (!params.principal) throw new Error('Login is required to read notifications');
    const state = await this.lastReadAt(params.principal);
    const cutoff = state.value || '';
    const candidates = await this.cachedPublicCandidates(params.principal);
    const limit = limitNumber(params.limit, 20, 100);
    const budget = maxChars(params.maxChars);
    const cursorIndex = params.afterNotificationId
      ? candidates.findIndex(candidate => candidate.notificationId === params.afterNotificationId
        && (params.includeRead || !cutoff || candidate.createdAt > cutoff))
      : -1;
    const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const selectedCandidates: NotificationCandidate[] = [];
    let total = 0;
    let unreadCount = 0;
    for (let index = start; index < candidates.length; index += 1) {
      const candidate = candidates[index]!;
      const unread = !cutoff || candidate.createdAt > cutoff;
      if (unread) unreadCount += 1;
      if (!params.includeRead && !unread) continue;
      total += 1;
      if (selectedCandidates.length < limit) selectedCandidates.push(candidate);
    }
    const hydrated = await this.hydrateCandidates(selectedCandidates, cutoff);
    const selected: NotificationEvent[] = [];
    let used = 0;
    for (const event of hydrated) {
      if (selected.length >= limit) break;
      const size = Array.from(event.content).length + Array.from(event.context || '').length;
      if (selected.length > 0 && used + size > budget) break;
      selected.push(event);
      used += size;
    }
    return {
      notifications: selected,
      unreadCount,
      total,
      truncated: selected.length < total,
      lastReadAt: cutoff || undefined,
      nextCursor: selected.at(-1)?.notificationId,
    };
  }

  async markRead(params: { principal?: ScopePrincipal; through?: string; expectedRevision?: string }) {
    if (!params.principal) throw new Error('Login is required to mark notifications read');
    const path = readStatePath(params.principal);
    const existing = await this.lastReadAt(params.principal);
    const timestamp = new Date().toISOString();
    await this.fileSystem.writeNote({
      path,
      content: `Notifications read through ${params.through || 'now'}\n`,
      frontmatter: {
        mcpvault_type: 'notification_read_state',
        owner: identity(params.principal),
        last_read_at: timestamp,
        ...(params.through && { through_notification_id: params.through }),
        updated_at: timestamp,
      },
      expectedRevision: params.expectedRevision || (existing.revision ? existing.revision : 'missing'),
    });
    const updated = await this.fileSystem.readNote(path);
    return { success: true, lastReadAt: timestamp, through: params.through, revision: updated.revision };
  }
}
