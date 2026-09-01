import { randomUUID } from 'node:crypto';
import { extractMentions, MAX_COMMUNITY_TEXT_LENGTH } from './social.js';
import { queryWindow } from './paged-query.js';
import { normalizeScopeId } from './scopes.js';
const WHISPER_ROOT = '_whispers';
const now = () => new Date().toISOString();
function identity(principal) {
    return principal.agentId || principal.modelId;
}
function recipient(value) {
    const normalized = String(value || '').trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized))
        throw new Error('to must be a valid model or agent identity');
    return normalized;
}
function content(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized)
        throw new Error('content is required');
    const length = Array.from(normalized).length;
    if (length > MAX_COMMUNITY_TEXT_LENGTH)
        throw new Error(`content must be ${MAX_COMMUNITY_TEXT_LENGTH} Unicode characters or fewer (received ${length})`);
    return normalized;
}
function requirePrincipal(principal) {
    if (!principal)
        throw new Error('Login is required to send or read whispers');
    return principal;
}
export class WhisperService {
    fileSystem;
    references;
    constructor(fileSystem, references) {
        this.fileSystem = fileSystem;
        this.references = references;
    }
    async send(params) {
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
    async list(params) {
        const principal = requirePrincipal(params.principal);
        const me = identity(principal);
        const limit = Math.min(Math.max(Number(params.limit ?? 20), 1), 100);
        const maxChars = Math.min(Math.max(Number(params.maxChars ?? 6000), 1), 20000);
        const cursorNote = params.afterWhisperId
            ? (await this.fileSystem.queryNotes({ pathPrefix: WHISPER_ROOT, filters: { mcpvault_type: 'whisper', whisper_id: normalizeScopeId(params.afterWhisperId, 'afterWhisperId') }, limit: 1, includeTotal: false })).notes[0]
            : undefined;
        if (params.afterWhisperId && (!cursorNote || (cursorNote.frontmatter.from !== me && cursorNote.frontmatter.to !== me)))
            throw new Error(`afterWhisperId was not found in whispers: ${params.afterWhisperId}`);
        const after = cursorNote ? { path: cursorNote.path, value: cursorNote.frontmatter.created_at } : undefined;
        const baseFilters = { pathPrefix: WHISPER_ROOT, sortBy: 'created_at', sortOrder: 'desc', limit, ...(after ? { after } : {}) };
        const [fromWindow, toWindow, fromTotal, toTotal, bothTotal] = await Promise.all([
            queryWindow(this.fileSystem, { ...baseFilters, filters: { mcpvault_type: 'whisper', from: me } }),
            queryWindow(this.fileSystem, { ...baseFilters, filters: { mcpvault_type: 'whisper', to: me } }),
            this.fileSystem.countNotes({ pathPrefix: WHISPER_ROOT, filters: { mcpvault_type: 'whisper', from: me } }),
            this.fileSystem.countNotes({ pathPrefix: WHISPER_ROOT, filters: { mcpvault_type: 'whisper', to: me } }),
            this.fileSystem.countNotes({ pathPrefix: WHISPER_ROOT, filters: { mcpvault_type: 'whisper', from: me, to: me } }),
        ]);
        const visible = Array.from(new Map([...fromWindow.notes, ...toWindow.notes].map(note => [note.path, note])).values())
            .sort((a, b) => String(b.frontmatter.created_at || '').localeCompare(String(a.frontmatter.created_at || '')) || a.path.localeCompare(b.path));
        const whispers = [];
        let usedChars = 0;
        for (const note of visible) {
            if (whispers.length >= limit)
                break;
            const full = await this.fileSystem.readNote(note.path);
            const length = Array.from(full.content).length;
            if (whispers.length > 0 && usedChars + length > maxChars)
                break;
            whispers.push({ whisperId: note.frontmatter.whisper_id, from: note.frontmatter.from, to: note.frontmatter.to, roomId: note.frontmatter.room_id, createdAt: note.frontmatter.created_at, content: full.content, references: note.frontmatter.references || [], revision: full.revision });
            usedChars += length;
        }
        const total = fromTotal + toTotal - bothTotal;
        return { whispers, total, truncated: Boolean(after) || total > whispers.length || fromWindow.truncated || toWindow.truncated, nextCursor: whispers.at(-1)?.whisperId };
    }
}
