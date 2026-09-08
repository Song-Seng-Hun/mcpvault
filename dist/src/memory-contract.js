import { posix } from 'node:path';
import { FrontmatterHandler } from './frontmatter.js';
import { projectNoteBlockLines } from './note-projections.js';
import { expandScopePath, parseScopePath } from './scopes.js';
export const MEMORY_ROLES = ['core', 'episodic', 'semantic', 'procedural', 'resource'];
const parser = new FrontmatterHandler();
const blockPattern = /^[A-Za-z0-9_-]{1,80}$/;
const revisionPattern = /^[a-fA-F0-9]{64}$/;
/** The authoring schema shares role/locator constraints with final-file validation. */
export function memoryEntrySchema() {
    const reference = (basis) => ({ type: 'array', maxItems: 8, items: {
            type: 'object', additionalProperties: false, required: basis ? ['path', 'revision'] : ['path'],
            properties: {
                path: { type: 'string', maxLength: 512, description: 'Exact .md Vault path or authorized scope URI; never a description of an assumption.' },
                revision: { type: 'string', pattern: revisionPattern.source },
                block_id: { type: 'string', pattern: blockPattern.source },
            },
        } });
    return { type: 'object', additionalProperties: false, required: ['block_id', 'role'], properties: {
            block_id: { type: 'string', pattern: blockPattern.source, description: 'Anchor ^id on the actual experience paragraph/list in content, outside fences. A standalone anchor binds only the immediately preceding block, not the whole journal. Verify the recalled excerpt after writing.' },
            role: { type: 'string', enum: [...MEMORY_ROLES] },
            state: { type: 'string', enum: ['active', 'archived'] },
            observed_at: { type: 'string', description: 'Event date YYYY-MM-DD or known ISO timestamp; do not invent precision.' },
            valid_from: { type: 'string' }, valid_until: { type: 'string' },
            retrieval_cues: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 300 } },
            use_when: { type: 'string', maxLength: 1000 },
            basis: { ...reference(true), description: 'Array of exact supporting source references; pin each reviewed revision.' },
            corrects: { ...reference(false), description: 'Array of old memory references, not prose. Put failed assumptions in Markdown.' },
        } };
}
function text(value, name, max) {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
        throw new Error(`Invalid memory ${name}`);
}
export function memoryDate(value, name) {
    if (value === undefined)
        return;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)
        || !Number.isFinite(Date.parse(value)) || new Date(value.slice(0, 10)).toISOString().slice(0, 10) !== value.slice(0, 10))
        throw new Error(`Invalid memory ${name}`);
}
/** Exact vault paths only. No aliases, host paths, URL fetches or inferred owners. */
export function memoryReferencePath(value) {
    text(value, 'reference path', 512);
    const parsed = parseScopePath(value);
    const raw = parsed ? expandScopePath(value) : value.replace(/\\/g, '/');
    if (!raw || /^(?:[a-z]:|\/|~)/i.test(raw) || raw.includes(':') || raw.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p))
        || /[#|\[\]]/.test(raw) || !/\.md$/i.test(raw))
        throw new Error('Invalid memory reference path');
    return posix.normalize(raw);
}
function audience(path) {
    const p = path.replace(/\\/g, '/').toLowerCase();
    const privateRoot = /^(_scopes\/(?:agents|models|users)\/[^/]+)(?:\/|$)/.exec(p);
    if (privateRoot)
        return privateRoot[1];
    if (/^_scopes(?:\/|$)|^_whispers(?:\/|$)/.test(p))
        return 'forbidden';
    return /^community\//.test(p) ? 'community' : 'global';
}
export function memoryReferenceAllowed(owner, source) {
    const target = audience(owner);
    const origin = audience(source);
    return target !== 'forbidden' && origin !== 'forbidden'
        && (origin === 'global' || origin === target || (target.startsWith('_scopes/') && origin === 'community'));
}
export function memoryEntries(fm) {
    if (Array.isArray(fm.memory_entries))
        return fm.memory_entries;
    if (!fm.memory_role)
        return [];
    return [{ role: fm.memory_role, state: fm.memory_state, observed_at: fm.observed_at,
            valid_from: fm.valid_from, valid_until: fm.valid_until, retrieval_cues: fm.retrieval_cues,
            use_when: fm.use_when, basis: fm.memory_basis, corrects: fm.memory_corrects }];
}
/** Validate the final serialized file, including raw-YAML and patch writers. */
export function assertMemoryContent(raw, path) {
    if (!raw.includes('memory_'))
        return;
    const note = parser.parse(raw);
    const fm = note.frontmatter;
    if (!Object.keys(fm).some(k => k.startsWith('memory_')))
        return;
    if (fm.memory_role !== undefined && fm.memory_entries !== undefined)
        throw new Error('Use memory_role or memory_entries, not both');
    if (fm.memory_entries !== undefined && (!Array.isArray(fm.memory_entries) || fm.memory_entries.length > 32))
        throw new Error('memory_entries must contain at most 32 block records');
    if (fm.memory_state !== undefined && !['active', 'archived'].includes(fm.memory_state))
        throw new Error('Invalid memory_state');
    if (!fm.memory_role && fm.memory_entries === undefined)
        throw new Error('Memory metadata requires memory_role or memory_entries');
    const ids = new Set();
    for (const entry of memoryEntries(fm)) {
        if (!entry || typeof entry !== 'object' || !MEMORY_ROLES.includes(entry.role))
            throw new Error('Invalid memory role');
        if (entry.state !== undefined && !['active', 'archived'].includes(entry.state))
            throw new Error('Invalid memory state');
        if (fm.memory_entries !== undefined) {
            if (typeof entry.block_id !== 'string' || !blockPattern.test(entry.block_id) || ids.has(entry.block_id.toLowerCase()) || projectNoteBlockLines(raw, entry.block_id).length !== 1)
                throw new Error('Memory block must have one unique visible Obsidian block anchor');
            ids.add(entry.block_id.toLowerCase());
            const allowed = new Set(['block_id', 'role', 'state', 'observed_at', 'valid_from', 'valid_until', 'retrieval_cues', 'use_when', 'basis', 'corrects']);
            if (Object.keys(entry).some(key => !allowed.has(key)))
                throw new Error('Unknown memory entry field; keep narrative in the Markdown block');
        }
        for (const name of ['observed_at', 'valid_from', 'valid_until'])
            memoryDate(entry[name], name);
        if (entry.valid_from && entry.valid_until && Date.parse(entry.valid_from) >= Date.parse(entry.valid_until))
            throw new Error('Invalid memory validity interval');
        if (entry.use_when !== undefined)
            text(entry.use_when, 'use_when', 1000);
        if (entry.retrieval_cues !== undefined) {
            if (!Array.isArray(entry.retrieval_cues) || entry.retrieval_cues.length > 8)
                throw new Error('Invalid memory retrieval_cues');
            entry.retrieval_cues.forEach(cue => text(cue, 'retrieval cue', 300));
        }
        for (const field of ['basis', 'corrects']) {
            if (entry[field] === undefined)
                continue;
            if (!Array.isArray(entry[field]) || entry[field].length > 8)
                throw new Error(`Invalid memory ${field}`);
            for (const ref of entry[field]) {
                if (!ref || typeof ref !== 'object')
                    throw new Error('Invalid memory reference');
                const source = memoryReferencePath(ref.path);
                if (!memoryReferenceAllowed(path, source))
                    throw new Error('Memory scope cannot disclose a private or narrower-scope reference');
                if ((field === 'basis' || ref.revision !== undefined) && !revisionPattern.test(ref.revision || ''))
                    throw new Error('Memory basis requires an exact revision');
                if (ref.block_id !== undefined && !blockPattern.test(ref.block_id))
                    throw new Error('Invalid memory reference block');
            }
        }
    }
}
