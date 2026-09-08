import { guidanceError, guidanceText } from './guidance-runtime.js';
import { stringify } from 'yaml';
import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { QueryNotesCursor } from './types.js';
import { isModerationHidden } from './moderation-policy.js';

export interface SavedView {
  version: 1; filters: Record<string, string | number | boolean>; columns: string[];
  pathPrefix?: string; sortBy: string; sortOrder: 'asc' | 'desc'; limit: number;
}
export interface ViewReadOptions {
  path: string; expectedRevision?: string; after?: QueryNotesCursor;
  limit?: number; maxChars?: number; prettyPrint?: boolean;
}
function field(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(value) || ['constructor', '__proto__', 'prototype'].includes(value)) throw guidanceError(new Error('Unsupported view Property'), 'guid-59cef4910e04fd77');
  return value;
}
export function parseSavedView(value: unknown): SavedView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw guidanceError(new Error('wiki_view must be a mapping'), 'guid-aa474dc3d389578e');
  const v = value as Record<string, any>;
  if (v.version !== 1 || Object.keys(v).some(key => !['version', 'filters', 'columns', 'pathPrefix', 'sortBy', 'sortOrder', 'limit'].includes(key))) throw guidanceError(new Error('Unsupported wiki_view definition; scripts and expressions are not supported'), 'guid-ac4e7b66a849b921');
  const filters: SavedView['filters'] = {};
  if (v.filters !== undefined) {
    if (!v.filters || typeof v.filters !== 'object' || Array.isArray(v.filters) || Object.keys(v.filters).length > 12) throw guidanceError(new Error('View filters must have at most 12 exact scalar conditions'), 'guid-ee676d3cc3dbe20e');
    for (const [key, scalar] of Object.entries(v.filters)) {
      field(key);
      if (!['string', 'number', 'boolean'].includes(typeof scalar) || (typeof scalar === 'string' && scalar.length > 300) || (typeof scalar === 'number' && !Number.isFinite(scalar))) throw guidanceError(new Error('View filters support only bounded scalar values'), 'guid-e8af20c525ab2239');
      filters[key] = scalar as string | number | boolean;
    }
  }
  const columns = v.columns ?? ['title', 'note_kind', 'lifecycle'];
  if (!Array.isArray(columns) || columns.length > 8 || columns.length < 1) throw guidanceError(new Error('View columns must contain 1..8 Properties'), 'guid-acf397b0e5c88820');
  if (v.pathPrefix !== undefined && (typeof v.pathPrefix !== 'string' || v.pathPrefix.length > 500)) throw guidanceError(new Error('Invalid view pathPrefix'), 'guid-021460a01cc95a97');
  if (v.sortOrder !== undefined && !['asc', 'desc'].includes(v.sortOrder)) throw guidanceError(new Error('Invalid view sortOrder'), 'guid-2fb2d8fd5be3515f');
  if (v.limit !== undefined && (!Number.isInteger(v.limit) || v.limit < 1 || v.limit > 100)) throw guidanceError(new Error('View limit must be 1..100'), 'guid-48a90a1d875d322e');
  return { version: 1, filters, columns: [...new Set(columns.map(field))], ...(v.pathPrefix !== undefined && { pathPrefix: v.pathPrefix }), sortBy: field(v.sortBy ?? 'path'), sortOrder: v.sortOrder ?? 'asc', limit: v.limit ?? 20 };
}
const clip = (value: unknown): unknown => typeof value === 'string' ? value.slice(0, 160)
  : Array.isArray(value) ? value.slice(0, 4).map(item => typeof item === 'string' ? item.slice(0, 80) : typeof item === 'number' || typeof item === 'boolean' ? item : '[object]')
    : value === null || ['number', 'boolean'].includes(typeof value) ? value : '[object]';

/** Uses the existing metadata index. There is no script evaluator or second index. */
export class WikiViewService {
  constructor(private readonly fs: FileSystemService, private readonly access: ScopeAccessPolicy) {}
  private async definition(principal: ScopePrincipal | undefined, options: ViewReadOptions) {
    const path = this.access.resolveExternalPath(this.access.toPublicPath(options.path), principal);
    const note = await this.fs.readNote(path);
    if (isModerationHidden(note.frontmatter)) throw guidanceError(new Error('View unavailable'), 'guid-c6a31dde914be26b');
    if (options.expectedRevision && options.expectedRevision !== note.revision) throw guidanceError(new Error('View revision changed; re-read the definition'), 'guid-bf03d20dd8b6b79b');
    const definition = parseSavedView(note.frontmatter.wiki_view);
    if (definition.pathPrefix !== undefined) definition.pathPrefix = this.access.resolveExternalPath(definition.pathPrefix, principal);
    return { path, note, definition };
  }
  async read(principal: ScopePrincipal | undefined, options: ViewReadOptions) {
    const { path, note, definition } = await this.definition(principal, options);
    const maxChars = options.maxChars ?? 4000;
    const limit = options.limit ?? definition.limit;
    if (!Number.isInteger(maxChars) || maxChars < 512 || maxChars > 12000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw guidanceError(new Error('View requires limit 1..100 and maxChars 512..12000'), 'guid-89bc4e2f8804c8f3');
    const page = await this.fs.queryNotes({ ...definition, limit: Math.min(limit, definition.limit), ...(options.after && { after: options.after }), includeContent: false, includeTotal: false },
      candidate => this.access.canAccessPhysicalPath(candidate, principal), candidate => !isModerationHidden(candidate.frontmatter));
    const items: Array<{ path: string; revision?: string; properties: Record<string, unknown>; propertiesTruncated?: boolean }> = [];
    const result: { definition: { path: string; revision: string }; items: typeof items; truncated: boolean; nextAction?: { endpointId: string; arguments: ViewReadOptions }; freshness: string } = {
      definition: { path: this.access.toPublicPath(path), revision: note.revision }, items, truncated: page.truncated,
      freshness: 'Current observed metadata; cursor pages are not an atomic vault snapshot.',
    };
    const continuation = (index: number) => {
      const last = page.notes[index]!;
      const raw = definition.sortBy === 'path' ? last.path : last.frontmatter[definition.sortBy];
      const value = raw === undefined || raw === null || ['string', 'number', 'boolean'].includes(typeof raw) ? raw : String(raw);
      return { endpointId: 'wiki.view', arguments: { path: this.access.toPublicPath(path), expectedRevision: note.revision, limit, maxChars, ...(options.prettyPrint && { prettyPrint: true }), after: { path: last.path, ...(value === undefined ? { missing: true } : { value }) } } };
    };
    for (let index = 0; index < page.notes.length; index++) {
      const row = page.notes[index]!;
      const properties = Object.fromEntries(definition.columns.filter(key => Object.hasOwn(row.frontmatter, key)).map(key => [key, clip(row.frontmatter[key])]));
      const propertiesTruncated = definition.columns.some(key => Object.hasOwn(row.frontmatter, key) && JSON.stringify(row.frontmatter[key]) !== JSON.stringify(properties[key]));
      items.push({ path: this.access.toPublicPath(row.path), ...(row.revision && { revision: row.revision }), properties, ...(propertiesTruncated && { propertiesTruncated }) });
      result.truncated = page.truncated || index < page.notes.length - 1;
      if (result.truncated) result.nextAction = continuation(index); else delete result.nextAction;
      if (JSON.stringify(result, null, options.prettyPrint ? 2 : undefined).length > maxChars) {
        items.pop();
        if (!items.length) throw guidanceError(new Error('maxChars too small for a view row and its cursor; increase maxChars or sort by path'), 'guid-9ce3a59af197f5e2');
        result.truncated = true; result.nextAction = continuation(index - 1); break;
      }
    }
    if ((await this.fs.readNote(path)).revision !== note.revision) throw guidanceError(new Error('View revision changed during query'), 'guid-72f0eefc0a029b4b');
    return result;
  }
  async bases(principal: ScopePrincipal | undefined, options: ViewReadOptions) {
    const { path, note, definition: v } = await this.definition(principal, options);
    const conditions = Object.entries(v.filters).map(([key, value]) => `(note[${JSON.stringify(key)}] == ${JSON.stringify(value)} || (note[${JSON.stringify(key)}].isType("list") && note[${JSON.stringify(key)}].contains(${JSON.stringify(value)})))`);
    if (v.pathPrefix) {
      const prefix = v.pathPrefix.replace(/\/$/, '');
      conditions.push(`(file.path == ${JSON.stringify(prefix)} || file.path.startsWith(${JSON.stringify(`${prefix}/`)}))`);
    }
    const yaml = stringify({ filters: { and: conditions }, views: [{ type: 'table', name: 'Saved Wiki view', order: ['file.name', ...v.columns.map(key => `note.${key}`)], sort: [{ property: v.sortBy === 'path' ? 'file.path' : `note.${v.sortBy}`, direction: v.sortOrder.toUpperCase() }], limit: v.limit }] });
    const result = { definition: { path, revision: note.revision }, yaml, permissionBoundary: false, warning: guidanceText('guid-451ac05481b8be1f', 'Host-only projection: Bases sees the host vault, not MCP account permissions.') };
    if (JSON.stringify(result, null, options.prettyPrint ? 2 : undefined).length > (options.maxChars ?? 12000)) throw guidanceError(new Error('Increase maxChars to preserve the complete Bases definition'), 'guid-88a4767c65d69451');
    return result;
  }
}
