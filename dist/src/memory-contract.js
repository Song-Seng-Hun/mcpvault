import { guidanceError, guidanceText } from './guidance-runtime.js';
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
                path: { type: 'string', maxLength: 512, description: guidanceText('guid-d2c4affb5186bb71', 'Exact .md Vault path or authorized scope URI; never a description of an assumption.') },
                revision: { type: 'string', pattern: revisionPattern.source },
                block_id: { type: 'string', pattern: blockPattern.source },
            },
        } });
    return { type: 'object', additionalProperties: false, required: ['block_id', 'role'], properties: {
            block_id: { type: 'string', pattern: blockPattern.source, description: guidanceText('guid-da8652bd33e73cc4', 'Anchor ^id on the actual experience paragraph/list in content, outside fences. A standalone anchor binds only the immediately preceding block, not the whole journal. Verify the recalled excerpt after writing.') },
            role: { type: 'string', enum: [...MEMORY_ROLES] },
            state: { type: 'string', enum: ['active', 'archived'] },
            observed_at: { type: 'string', description: guidanceText('guid-d02e562aef9ce72f', 'Event date YYYY-MM-DD or known ISO timestamp; do not invent precision.') },
            valid_from: { type: 'string' }, valid_until: { type: 'string' },
            retrieval_cues: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 300 } },
            use_when: { type: 'string', maxLength: 1000 },
            basis: { ...reference(true), description: guidanceText('guid-429e4a02c86468d1', 'Array of exact supporting source references; pin each reviewed revision.') },
            corrects: { ...reference(false), description: guidanceText('guid-c31332f23128f8a5', 'Array of old memory references, not prose. Put failed assumptions in Markdown.') },
        } };
}
function text(value, name, max) {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
        throw guidanceError(new Error(`Invalid memory ${name}`), 'guid-e89fe4e565cd090f');
}
export function memoryDate(value, name) {
    if (value === undefined)
        return;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)
        || !Number.isFinite(Date.parse(value)) || new Date(value.slice(0, 10)).toISOString().slice(0, 10) !== value.slice(0, 10))
        throw guidanceError(new Error(`Invalid memory ${name}`), 'guid-e89fe4e565cd090f');
}
/** Exact vault paths only. No aliases, host paths, URL fetches or inferred owners. */
export function memoryReferencePath(value) {
    text(value, 'reference path', 512);
    const parsed = parseScopePath(value);
    const raw = parsed ? expandScopePath(value) : value.replace(/\\/g, '/');
    if (!raw || /^(?:[a-z]:|\/|~)/i.test(raw) || raw.includes(':') || raw.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p))
        || /[#|\[\]]/.test(raw) || !/\.md$/i.test(raw))
        throw guidanceError(new Error('Invalid memory reference path'), 'guid-78c427310d3b2105');
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
        throw guidanceError(new Error('Use memory_role or memory_entries, not both'), 'guid-f5599d3ab7b2322d');
    if (fm.memory_entries !== undefined && (!Array.isArray(fm.memory_entries) || fm.memory_entries.length > 32))
        throw guidanceError(new Error('memory_entries must contain at most 32 block records'), 'guid-b298c9a43e45f581');
    if (fm.memory_state !== undefined && !['active', 'archived'].includes(fm.memory_state))
        throw guidanceError(new Error('Invalid memory_state'), 'guid-d56160a253dca108');
    if (!fm.memory_role && fm.memory_entries === undefined)
        throw guidanceError(new Error('Memory metadata requires memory_role or memory_entries'), 'guid-2ebe180107aebeb8');
    const ids = new Set();
    for (const entry of memoryEntries(fm)) {
        if (!entry || typeof entry !== 'object' || !MEMORY_ROLES.includes(entry.role))
            throw guidanceError(new Error('Invalid memory role'), 'guid-0aa9e154f08508c0');
        if (entry.state !== undefined && !['active', 'archived'].includes(entry.state))
            throw guidanceError(new Error('Invalid memory state'), 'guid-eb67227a52a51c46');
        if (fm.memory_entries !== undefined) {
            if (typeof entry.block_id !== 'string' || !blockPattern.test(entry.block_id) || ids.has(entry.block_id.toLowerCase()) || projectNoteBlockLines(raw, entry.block_id).length !== 1)
                throw guidanceError(new Error('Memory block must have one unique visible Obsidian block anchor'), 'guid-012bc567799593b7');
            ids.add(entry.block_id.toLowerCase());
            const allowed = new Set(['block_id', 'role', 'state', 'observed_at', 'valid_from', 'valid_until', 'retrieval_cues', 'use_when', 'basis', 'corrects']);
            if (Object.keys(entry).some(key => !allowed.has(key)))
                throw guidanceError(new Error('Unknown memory entry field; keep narrative in the Markdown block'), 'guid-33746596796386c2');
        }
        for (const name of ['observed_at', 'valid_from', 'valid_until'])
            memoryDate(entry[name], name);
        if (entry.valid_from && entry.valid_until && Date.parse(entry.valid_from) >= Date.parse(entry.valid_until))
            throw guidanceError(new Error('Invalid memory validity interval'), 'guid-f2ff79d29a674c0d');
        if (entry.use_when !== undefined)
            text(entry.use_when, 'use_when', 1000);
        if (entry.retrieval_cues !== undefined) {
            if (!Array.isArray(entry.retrieval_cues) || entry.retrieval_cues.length > 8)
                throw guidanceError(new Error('Invalid memory retrieval_cues'), 'guid-86e9d2df41abaa03');
            entry.retrieval_cues.forEach(cue => text(cue, 'retrieval cue', 300));
        }
        for (const field of ['basis', 'corrects']) {
            if (entry[field] === undefined)
                continue;
            if (!Array.isArray(entry[field]) || entry[field].length > 8)
                throw guidanceError(new Error(`Invalid memory ${field}`), 'guid-e89fe4e565cd090f');
            for (const ref of entry[field]) {
                if (!ref || typeof ref !== 'object')
                    throw guidanceError(new Error('Invalid memory reference'), 'guid-0107ece743e8d9b7');
                const source = memoryReferencePath(ref.path);
                if (!memoryReferenceAllowed(path, source))
                    throw guidanceError(new Error('Memory scope cannot disclose a private or narrower-scope reference'), 'guid-cffe72522a0f63d7');
                if ((field === 'basis' || ref.revision !== undefined) && !revisionPattern.test(ref.revision || ''))
                    throw guidanceError(new Error('Memory basis requires an exact revision'), 'guid-4980fd46f78727af');
                if (ref.block_id !== undefined && !blockPattern.test(ref.block_id))
                    throw guidanceError(new Error('Invalid memory reference block'), 'guid-4166cb846e4cdf93');
            }
        }
    }
}
