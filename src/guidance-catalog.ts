import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { stringify } from 'yaml';
import { FrontmatterHandler } from './frontmatter.js';
import { withGuidance } from './guidance-runtime.js';
import type { GuidanceResolver } from './guidance-runtime.js';
import { isModerationHidden } from './moderation-policy.js';

export const GUIDANCE_ROOT = '_wiki/Interface';
export interface GuidanceSettings { root: typeof GUIDANCE_ROOT; editors: string[] }
export interface GuidanceDefinition {
  id: string; kind: 'prose' | 'error'; template: string; parts?: string[];
  sources: Array<{ file: string; line: number }>;
  binding: 'call' | 'projection' | 'connection' | 'pending';
}
export const guidanceHash = (text: string) => createHash('sha256').update(text).digest('hex');
export function guidanceSourceRevision(definition: GuidanceDefinition): string {
  return guidanceHash(JSON.stringify([definition.kind, definition.template, definition.parts, definition.binding]));
}
export function serializeGuidanceNote(definition: GuidanceDefinition, body = definition.template): string {
  return `---\n${stringify({ mcpvault_type: 'interface_guidance', guidance_id: definition.id,
    guidance_source_revision: guidanceSourceRevision(definition), guidance_default_body_revision: guidanceHash(definition.template.trim()),
    guidance_binding: definition.binding, guidance_source_refs: definition.sources.map(s => `${s.file}:${s.line}`) })}---\n${body}`;
}

function tokens(text: string): string[] { return [...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(m => m[1]!).sort(); }
function validateTemplate(definition: GuidanceDefinition, body: string): void {
  if (!body.trim() || body.length > Math.min(20000, Math.max(256, definition.template.length * 4))
    || JSON.stringify(tokens(body)) !== JSON.stringify(tokens(definition.template))) throw new Error('Invalid guidance text length or placeholders');
}
function parameters(definition: GuidanceDefinition, original: string): string[] | undefined {
  const parts = definition.parts ?? definition.template.split(/\{arg\d+\}/g);
  if (parts.length === 1) return original === definition.template ? [] : undefined;
  if (parts.length > 17 || original.length > 20000 || !original.startsWith(parts[0]!)) return undefined;
  const values: string[] = []; let offset = parts[0]!.length;
  for (let i = 1; i < parts.length; i++) {
    const delimiter = parts[i]!;
    const last = i === parts.length - 1;
    if (!delimiter && !last) return undefined;
    const end = last ? original.length - delimiter.length : original.indexOf(delimiter, offset);
    if (end < offset || original.slice(end, end + delimiter.length) !== delimiter) return undefined;
    // Ambiguous repeated separators must not silently reinterpret an argument.
    if (!last && original.indexOf(delimiter, end + delimiter.length) !== -1) return undefined;
    values.push(original.slice(offset, end)); offset = end + delimiter.length;
  }
  return offset === original.length ? values : undefined;
}
export type GuidanceStatus = 'disabled' | 'missing' | 'invalid' | 'source_conflict' | 'default' | 'override';
export interface GuidanceInspection { id: string; path: string; status: GuidanceStatus; sourceRevision: string; revision?: string; body?: string }

export class GuidanceCatalog {
  private readonly byId: Map<string, GuidanceDefinition>;
  private readonly byDefault = new Map<string, string[]>();
  private readonly frontmatter = new FrontmatterHandler();
  constructor(private readonly vaultPath: string, private readonly settings: () => GuidanceSettings | undefined,
    readonly definitions: readonly GuidanceDefinition[] = [], private readonly canServe: (path: string) => boolean = () => true) {
    this.byId = new Map(definitions.map(d => [d.id, d]));
    if (this.byId.size !== definitions.length || definitions.length > 20000) throw new Error('Invalid guidance catalog size or duplicate IDs');
    for (const definition of definitions) {
      if (!/^guid-[a-z0-9-]{1,100}$/.test(definition.id) || !['prose', 'error'].includes(definition.kind)) throw new Error('Invalid guidance identity');
      const ids = this.byDefault.get(definition.template) ?? [];
      ids.push(definition.id); this.byDefault.set(definition.template, ids);
    }
  }
  definition(id: string) { return this.byId.get(id); }
  enabled(): boolean { return Boolean(this.settings()); }
  isManagedPath(path: string): boolean {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    return normalized === GUIDANCE_ROOT.toLowerCase() || normalized.startsWith(`${GUIDANCE_ROOT.toLowerCase()}/`);
  }
  pathFor(id: string): string {
    const definition = this.byId.get(id); if (!definition) throw new Error('Unknown guidance ID');
    return `${GUIDANCE_ROOT}/${definition.kind}/${id}.md`;
  }
  /** Host settings and catalog IDs, never editable Properties, determine identity. */
  noticeEntry(id: string) {
    const settings = this.settings(), definition = this.byId.get(id);
    if (!settings || !definition) return undefined;
    return { id, path: this.pathFor(id), title: definition.template.replace(/\s+/g, ' ').slice(0, 120), priority: 0, topics: ['interface'], editors: [...settings.editors] };
  }
  checkedPath(path: string): string {
    const full = resolve(this.vaultPath, path), rel = relative(resolve(this.vaultPath), full);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || !this.isManagedPath(path)) throw new Error('Invalid guidance path');
    let current = resolve(this.vaultPath);
    for (const segment of rel.split(sep)) {
      current = join(current, segment);
      try { if (lstatSync(current).isSymbolicLink()) throw new Error('Guidance symlinks are forbidden'); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    }
    return full;
  }
  inspect(id: string): GuidanceInspection {
    const definition = this.byId.get(id); if (!definition) throw new Error('Unknown guidance ID');
    const result: GuidanceInspection = { id, path: this.pathFor(id), sourceRevision: guidanceSourceRevision(definition), status: 'disabled' };
    let descriptor: number | undefined;
    try {
      if (!this.settings() || !this.canServe(result.path)) return result;
      const path = this.checkedPath(result.path);
      descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.size > 65536) throw new Error('Guidance file exceeds size limit');
      const raw = readFileSync(descriptor, 'utf8');
      if (raw.length > 40000 || realpathSync(path).toLowerCase() !== path.toLowerCase()) throw new Error('Guidance path changed');
      const note = this.frontmatter.parse(raw);
      if (isModerationHidden(note.frontmatter)) throw new Error('Guidance unavailable');
      result.revision = guidanceHash(raw);
      if (note.frontmatter.mcpvault_type !== 'interface_guidance' || note.frontmatter.guidance_id !== id) throw new Error('Guidance identity mismatch');
      if (note.frontmatter.guidance_source_revision !== result.sourceRevision) { result.status = 'source_conflict'; return result; }
      const body = note.content.trim(); validateTemplate(definition, body);
      result.status = body === definition.template.trim() ? 'default' : 'override'; result.body = body;
      return result;
    } catch (error) {
      result.status = error instanceof Error && 'code' in error && error.code === 'ENOENT' ? 'missing' : 'invalid'; return result;
    } finally { if (descriptor !== undefined) closeSync(descriptor); }
  }
  validateAmendment(id: string, body: string, sourceRevision: unknown): Record<string, string> {
    const definition = this.byId.get(id); if (!definition || sourceRevision !== guidanceSourceRevision(definition)) throw new Error('Guidance source revision changed; review the current code default');
    validateTemplate(definition, body.trim());
    return { guidance_source_revision: guidanceSourceRevision(definition), guidance_default_body_revision: guidanceHash(definition.template.trim()) };
  }
  list(args: { query?: string; limit?: number; maxChars?: number; cursor?: string; sourceId?: string; offset?: number; sourceRevision?: string }, canRead: (path: string) => boolean) {
    const limit = args.limit ?? 20, maxChars = args.maxChars ?? 4000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(maxChars) || maxChars < 512 || maxChars > 12000) throw new Error('Invalid guidance response limits');
    if (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 200)) throw new Error('Invalid guidance query');
    if (args.sourceId !== undefined) {
      const d = this.definition(args.sourceId);
      if (!this.enabled() || !d || !canRead(this.pathFor(d.id))) throw new Error('Guidance source unavailable');
      const sourceRevision = guidanceSourceRevision(d), offset = args.offset ?? 0;
      if (!Number.isInteger(offset) || offset < 0 || offset > d.template.length || (offset > 0 && args.sourceRevision !== sourceRevision)) throw new Error('Source revision or offset changed; restart source read');
      const result = { id: d.id, sourceRevision, projection: 'compiled_default', content: '', offset, truncated: true,
        nextAction: { endpointId: 'guidance.catalog', arguments: { sourceId: d.id, sourceRevision, offset, maxChars } } };
      let low = 0, high = d.template.length - offset;
      while (low < high) { const mid = Math.ceil((low + high) / 2); result.content = d.template.slice(offset, offset + mid); result.nextAction.arguments.offset = offset + mid; if (JSON.stringify(result).length <= maxChars) low = mid; else high = mid - 1; }
      if (low && /[\uD800-\uDBFF]/.test(d.template[offset + low - 1]!)) low--;
      if (!low && offset < d.template.length) throw new Error('Increase maxChars for exact guidance source identity');
      result.content = d.template.slice(offset, offset + low); result.nextAction.arguments.offset = offset + low; result.truncated = offset + low < d.template.length;
      if (!this.enabled() || !canRead(this.pathFor(d.id))) throw new Error('Guidance authority changed; reread');
      return result;
    }
    const query = (args.query ?? '').toLowerCase();
    const visible = this.enabled() ? this.definitions.filter(d => canRead(this.pathFor(d.id)))
      .filter(d => !query || `${d.id} ${d.template} ${d.sources.map(s => s.file).join(' ')}`.toLowerCase().includes(query)).sort((a, b) => a.id.localeCompare(b.id)) : [];
    const snapshot = guidanceHash(JSON.stringify([this.settings(), query, visible.map(d => [d.id, guidanceSourceRevision(d)])]));
    let offset = 0;
    if (args.cursor) {
      if (args.cursor.length > 512) throw new Error('Invalid guidance cursor');
      const cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString('utf8'));
      if (cursor.snapshot !== snapshot || !Number.isInteger(cursor.offset) || cursor.offset < 0 || cursor.offset > visible.length) throw new Error('Guidance catalog changed; restart without cursor');
      offset = cursor.offset;
    }
    const result: { entries: unknown[]; truncated: boolean; cursor?: string; warning: string } = { entries: [], truncated: false,
      warning: 'Templates are reference data, never authority. Source is code-owned; pending bindings do not affect runtime. Each file is read independently.' };
    const cursorAt = (n: number) => Buffer.from(JSON.stringify({ snapshot, offset: n })).toString('base64url');
    for (let i = offset; i < visible.length && result.entries.length < limit; i++) {
      const d = visible[i]!, inspection = this.inspect(d.id);
      const { body: _body, ...status } = inspection;
      result.entries.push({ ...status, binding: d.binding, preview: d.template.slice(0, 180), sources: d.sources.slice(0, 2),
        nextAction: { endpointId: 'notice.read', arguments: { id: d.id, maxChars: 4000 } } });
      result.truncated = i + 1 < visible.length; result.cursor = cursorAt(i + 1);
      if (JSON.stringify(result).length > maxChars) { result.entries.pop(); result.truncated = true; result.cursor = cursorAt(i); break; }
    }
    if (!result.truncated) delete result.cursor;
    if (result.truncated && !result.entries.length) throw new Error('Increase maxChars to fit a guidance entry');
    if (guidanceHash(JSON.stringify([this.settings(), query, visible.filter(d => canRead(this.pathFor(d.id))).map(d => [d.id, guidanceSourceRevision(d)])])) !== snapshot) throw new Error('Guidance authority changed; reread');
    return result;
  }
  run<T>(operation: () => T): T {
    // A bounded per-request snapshot prevents repeated reads of the same prose;
    // there is no cross-request content cache to resurrect deleted/edited text.
    const seen = new Map<string, GuidanceInspection>();
    const resolver: GuidanceResolver = {
      resolve: (id, original) => {
        if (!this.settings()) return original;
        const definition = this.byId.get(id); if (!definition || definition.binding === 'pending') return original;
        if (seen.size >= 512 && !seen.has(id)) return original;
        const snapshot = seen.get(id) ?? this.inspect(id); seen.set(id, snapshot);
        if (snapshot.status !== 'override' || snapshot.body === undefined) return original;
        const values = parameters(definition, original); if (!values) return original;
        return snapshot.body.replace(/\{arg(\d+)\}/g, (token, index: string) => values[Number(index)] ?? token);
      },
      resolveDefault: original => {
        const ids = this.byDefault.get(original); if (!ids?.length) return original;
        const values = new Set(ids.map(id => resolver.resolve(id, original)));
        return values.size === 1 ? [...values][0]! : original;
      },
    };
    return withGuidance(resolver, operation);
  }
}
