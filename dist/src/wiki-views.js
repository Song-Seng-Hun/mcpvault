import { stringify } from 'yaml';
import { isModerationHidden } from './moderation-policy.js';
function field(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(value) || ['constructor', '__proto__', 'prototype'].includes(value))
        throw new Error('Unsupported view Property');
    return value;
}
export function parseSavedView(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('wiki_view must be a mapping');
    const v = value;
    if (v.version !== 1 || Object.keys(v).some(key => !['version', 'filters', 'columns', 'pathPrefix', 'sortBy', 'sortOrder', 'limit'].includes(key)))
        throw new Error('Unsupported wiki_view definition; scripts and expressions are not supported');
    const filters = {};
    if (v.filters !== undefined) {
        if (!v.filters || typeof v.filters !== 'object' || Array.isArray(v.filters) || Object.keys(v.filters).length > 12)
            throw new Error('View filters must have at most 12 exact scalar conditions');
        for (const [key, scalar] of Object.entries(v.filters)) {
            field(key);
            if (!['string', 'number', 'boolean'].includes(typeof scalar) || (typeof scalar === 'string' && scalar.length > 300) || (typeof scalar === 'number' && !Number.isFinite(scalar)))
                throw new Error('View filters support only bounded scalar values');
            filters[key] = scalar;
        }
    }
    const columns = v.columns ?? ['title', 'note_kind', 'lifecycle'];
    if (!Array.isArray(columns) || columns.length > 8 || columns.length < 1)
        throw new Error('View columns must contain 1..8 Properties');
    if (v.pathPrefix !== undefined && (typeof v.pathPrefix !== 'string' || v.pathPrefix.length > 500))
        throw new Error('Invalid view pathPrefix');
    if (v.sortOrder !== undefined && !['asc', 'desc'].includes(v.sortOrder))
        throw new Error('Invalid view sortOrder');
    if (v.limit !== undefined && (!Number.isInteger(v.limit) || v.limit < 1 || v.limit > 100))
        throw new Error('View limit must be 1..100');
    return { version: 1, filters, columns: [...new Set(columns.map(field))], ...(v.pathPrefix !== undefined && { pathPrefix: v.pathPrefix }), sortBy: field(v.sortBy ?? 'path'), sortOrder: v.sortOrder ?? 'asc', limit: v.limit ?? 20 };
}
const clip = (value) => typeof value === 'string' ? value.slice(0, 160)
    : Array.isArray(value) ? value.slice(0, 4).map(item => typeof item === 'string' ? item.slice(0, 80) : typeof item === 'number' || typeof item === 'boolean' ? item : '[object]')
        : value === null || ['number', 'boolean'].includes(typeof value) ? value : '[object]';
/** Uses the existing metadata index. There is no script evaluator or second index. */
export class WikiViewService {
    fs;
    access;
    constructor(fs, access) {
        this.fs = fs;
        this.access = access;
    }
    async definition(principal, options) {
        const path = this.access.resolveExternalPath(this.access.toPublicPath(options.path), principal);
        const note = await this.fs.readNote(path);
        if (isModerationHidden(note.frontmatter))
            throw new Error('View unavailable');
        if (options.expectedRevision && options.expectedRevision !== note.revision)
            throw new Error('View revision changed; re-read the definition');
        const definition = parseSavedView(note.frontmatter.wiki_view);
        if (definition.pathPrefix !== undefined)
            definition.pathPrefix = this.access.resolveExternalPath(definition.pathPrefix, principal);
        return { path, note, definition };
    }
    async read(principal, options) {
        const { path, note, definition } = await this.definition(principal, options);
        const maxChars = options.maxChars ?? 4000;
        const limit = options.limit ?? definition.limit;
        if (!Number.isInteger(maxChars) || maxChars < 512 || maxChars > 12000 || !Number.isInteger(limit) || limit < 1 || limit > 100)
            throw new Error('View requires limit 1..100 and maxChars 512..12000');
        const page = await this.fs.queryNotes({ ...definition, limit: Math.min(limit, definition.limit), ...(options.after && { after: options.after }), includeContent: false, includeTotal: false }, candidate => this.access.canAccessPhysicalPath(candidate, principal), candidate => !isModerationHidden(candidate.frontmatter));
        const items = [];
        const result = {
            definition: { path: this.access.toPublicPath(path), revision: note.revision }, items, truncated: page.truncated,
            freshness: 'Current observed metadata; cursor pages are not an atomic vault snapshot.',
        };
        const continuation = (index) => {
            const last = page.notes[index];
            const raw = definition.sortBy === 'path' ? last.path : last.frontmatter[definition.sortBy];
            const value = raw === undefined || raw === null || ['string', 'number', 'boolean'].includes(typeof raw) ? raw : String(raw);
            return { endpointId: 'wiki.view', arguments: { path: this.access.toPublicPath(path), expectedRevision: note.revision, limit, maxChars, ...(options.prettyPrint && { prettyPrint: true }), after: { path: last.path, ...(value === undefined ? { missing: true } : { value }) } } };
        };
        for (let index = 0; index < page.notes.length; index++) {
            const row = page.notes[index];
            const properties = Object.fromEntries(definition.columns.filter(key => Object.hasOwn(row.frontmatter, key)).map(key => [key, clip(row.frontmatter[key])]));
            const propertiesTruncated = definition.columns.some(key => Object.hasOwn(row.frontmatter, key) && JSON.stringify(row.frontmatter[key]) !== JSON.stringify(properties[key]));
            items.push({ path: this.access.toPublicPath(row.path), ...(row.revision && { revision: row.revision }), properties, ...(propertiesTruncated && { propertiesTruncated }) });
            result.truncated = page.truncated || index < page.notes.length - 1;
            if (result.truncated)
                result.nextAction = continuation(index);
            else
                delete result.nextAction;
            if (JSON.stringify(result, null, options.prettyPrint ? 2 : undefined).length > maxChars) {
                items.pop();
                if (!items.length)
                    throw new Error('maxChars too small for a view row and its cursor; increase maxChars or sort by path');
                result.truncated = true;
                result.nextAction = continuation(index - 1);
                break;
            }
        }
        if ((await this.fs.readNote(path)).revision !== note.revision)
            throw new Error('View revision changed during query');
        return result;
    }
    async bases(principal, options) {
        const { path, note, definition: v } = await this.definition(principal, options);
        const conditions = Object.entries(v.filters).map(([key, value]) => `(note[${JSON.stringify(key)}] == ${JSON.stringify(value)} || (note[${JSON.stringify(key)}].isType("list") && note[${JSON.stringify(key)}].contains(${JSON.stringify(value)})))`);
        if (v.pathPrefix) {
            const prefix = v.pathPrefix.replace(/\/$/, '');
            conditions.push(`(file.path == ${JSON.stringify(prefix)} || file.path.startsWith(${JSON.stringify(`${prefix}/`)}))`);
        }
        const yaml = stringify({ filters: { and: conditions }, views: [{ type: 'table', name: 'Saved Wiki view', order: ['file.name', ...v.columns.map(key => `note.${key}`)], sort: [{ property: v.sortBy === 'path' ? 'file.path' : `note.${v.sortBy}`, direction: v.sortOrder.toUpperCase() }], limit: v.limit }] });
        const result = { definition: { path, revision: note.revision }, yaml, permissionBoundary: false, warning: 'Host-only projection: Bases sees the host vault, not MCP account permissions.' };
        if (JSON.stringify(result, null, options.prettyPrint ? 2 : undefined).length > (options.maxChars ?? 12000))
            throw new Error('Increase maxChars to preserve the complete Bases definition');
        return result;
    }
}
