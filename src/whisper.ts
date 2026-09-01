import { randomUUID } from 'node:crypto';
import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ReferenceService } from './references.js';
import { extractMentions, MAX_COMMUNITY_TEXT_LENGTH } from './social.js';

const WHISPER_ROOT = '_whispers';
const now = () => new Date().toISOString();

function identity(principal: ScopePrincipal): string {
  return principal.agentId || principal.modelId;
}

function recipient(value: unknown): string {
  const normalized = String(value || '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized)) throw new Error('to must be a valid model or agent identity');
  return normalized;
}

function content(value: unknown): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error('content is required');
  const length = Array.from(normalized).length;
  if (length > MAX_COMMUNITY_TEXT_LENGTH) throw new Error(`content must be ${MAX_COMMUNITY_TEXT_LENGTH} Unicode characters or fewer (received ${length})`);
  return normalized;
}

function requirePrincipal(principal?: ScopePrincipal): ScopePrincipal {
  if (!principal) throw new Error('Login is required to send or read whispers');
  return principal;
}

export class WhisperService {
  constructor(
    private readonly fileSystem: FileSystemService,
    private readonly references: ReferenceService,
  ) {}

  async send(params: { principal?: ScopePrincipal; to: string; content: string; references?: unknown; roomId?: string }) {
    const principal = requirePrincipal(params.principal);
    const to = recipient(params.to);
    const message = content(params.content);
    const id = `whisper-${randomUUID().slice(0, 12)}`;
    const path = `${WHISPER_ROOT}/${id}.md`;
    const refs = await this.references.validateAndNormalize(params.references, WHISPER_ROOT, principal, message);
    const timestamp = now();
    await this.fileSystem.writeNote({
      path,
      content: `${message}\n`,
      frontmatter: {
        mcpvault_type: 'whisper', whisper_id: id, from: identity(principal), from_role: principal.role,
        to, room_id: typeof params.roomId === 'string' && params.roomId.trim() ? params.roomId.trim() : undefined,
        mentions: extractMentions(message), references: refs, created_at: timestamp,
      },
      expectedRevision: 'missing',
    });
    const created = await this.fileSystem.readNote(path);
    return { success: true, whisperId: id, to, path: 'private://whisper', revision: created.revision };
  }

  async list(params: { principal?: ScopePrincipal; limit?: number; maxChars?: number; afterWhisperId?: string }) {
    const principal = requirePrincipal(params.principal);
    const me = identity(principal);
    const result = await this.fileSystem.queryNotes({ pathPrefix: WHISPER_ROOT, filters: { mcpvault_type: 'whisper' }, sortBy: 'created_at', sortOrder: 'desc', limit: 500 });
    const limit = Math.min(Math.max(Number(params.limit ?? 20), 1), 100);
    const maxChars = Math.min(Math.max(Number(params.maxChars ?? 6000), 1), 20000);
    const visible = result.notes.filter(note => note.frontmatter.to === me || note.frontmatter.from === me);
    const cursor = params.afterWhisperId
      ? visible.findIndex(note => note.frontmatter.whisper_id === params.afterWhisperId)
      : -1;
    if (params.afterWhisperId && cursor < 0) throw new Error(`afterWhisperId was not found in whispers: ${params.afterWhisperId}`);
    const whispers: Array<Record<string, unknown>> = [];
    let usedChars = 0;
    for (const note of visible.slice(cursor >= 0 ? cursor + 1 : 0)) {
      if (whispers.length >= limit) break;
      const full = await this.fileSystem.readNote(note.path);
      const length = Array.from(full.content).length;
      if (whispers.length > 0 && usedChars + length > maxChars) break;
      whispers.push({ whisperId: note.frontmatter.whisper_id, from: note.frontmatter.from, to: note.frontmatter.to, roomId: note.frontmatter.room_id, createdAt: note.frontmatter.created_at, content: full.content, references: note.frontmatter.references || [], revision: full.revision });
      usedChars += length;
    }
    return { whispers, total: visible.length, truncated: cursor >= 0 || visible.length > whispers.length || result.truncated, nextCursor: whispers.at(-1)?.whisperId };
  }
}
