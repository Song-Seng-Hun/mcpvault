import { guidanceError } from './guidance-runtime.js';
import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import { isModerationHidden } from './moderation-policy.js';
import { parseWikiLink } from './wikilink/resolveWikiLink.js';
import { RELATION_FIELDS } from './organization.js';
import { posix } from 'node:path';
import type { QueryNote } from './types.js';

const MAX_REFERENCES = 50;
export type BodyLink = ReturnType<typeof extractObsidianLinkOccurrences>[number];
export type ReadReferenceMetadata = (path: string, canRead: (path: string) => boolean) => Promise<QueryNote | undefined>;

function normalize(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw guidanceError(new Error('references must be an array of note paths'), 'guid-5149921bfa80033d');
  const paths = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().replace(/\\/g, '/'))
    .filter(Boolean);
  if (paths.length !== value.length) throw guidanceError(new Error('references must contain only non-empty strings'), 'guid-17d9d33f41aa7a81');
  return Array.from(new Set(paths)).slice(0, MAX_REFERENCES);
}

function titleFor(path: string, frontmatter: Record<string, any>): string {
  if (typeof frontmatter.title === 'string' && frontmatter.title.trim()) return frontmatter.title.trim();
  return path.split('/').at(-1)?.replace(/\.[^.]+$/, '') || path;
}

export class ReferenceService {
  constructor(
    private readonly fileSystem: FileSystemService,
    private readonly access: ScopeAccessPolicy,
  ) {}

  private lexicalPath(value: string, principal?: ScopePrincipal, authorize = true): string {
    const raw = value.startsWith('scope://') ? this.access.resolveExternalPath(value, principal) : value;
    if (/^(?:[/\\]|~)|:/.test(raw)) throw guidanceError(new Error('Reference must be a Vault-relative authorized path'), 'guid-9a8c78ee8a1b736b');
    const path = posix.normalize(raw.replace(/\\/g, '/').split('/').map(part => process.platform !== 'win32' || part === '.' || part === '..' ? part : part.replace(/[. ]+$/, '')).join('/'));
    if (path === '..' || path.startsWith('../') || (authorize && !this.access.canAccessPhysicalPath(path, principal))) throw guidanceError(new Error('Reference unavailable in this scope'), 'guid-fe6b3ca2a3a02285');
    return path;
  }

  private canonicalPath(value: string, principal?: ScopePrincipal): string {
    const lexical = this.lexicalPath(value, principal);
    const canonical = this.fileSystem.canonicalReferencePath(lexical);
    if (!this.access.canAccessPhysicalPath(canonical, principal)) throw guidanceError(new Error('Reference unavailable in this scope'), 'guid-fe6b3ca2a3a02285');
    return canonical;
  }

  private async resolveWikiLinkTarget(target: string, principal?: ScopePrincipal, sourcePath?: string, syntax?: 'markdown'): Promise<string> {
    const name = target.trim();
    const canAccess = (path: string) => this.access.canAccessPhysicalPath(path, principal);
    const matches = syntax === 'markdown'
      ? await this.fileSystem.findPathForMarkdownLink(name, sourcePath || '', canAccess)
      : await this.fileSystem.findPathForWikiLink(name, canAccess, sourcePath);
    if (matches.length === 0) throw guidanceError(new Error(`Obsidian reference does not resolve: [[${target}]]`), 'guid-400eb2ad9b9ecc7e');
    if (matches.length > 1) throw guidanceError(new Error(`Obsidian reference is ambiguous: [[${target}]]. Use a path-qualified link such as [[folder/${name.split('/').at(-1)}]]`), 'guid-9143e01bad625d4f');
    return matches[0]!;
  }

  private async resolveBodyLink(link: BodyLink, containerPath: string, principal?: ScopePrincipal): Promise<string> {
    const wiki = /^!?\[\[/.test(link.link);
    const target = wiki ? parseWikiLink(link.link.replace(/^!/, '')).document : link.target;
    const path = this.canonicalPath(await this.resolveWikiLinkTarget(target, principal, containerPath, wiki ? undefined : 'markdown'), principal);
    if (!this.access.canReferenceFrom(containerPath, path)) {
      throw guidanceError(new Error(`A more-private note cannot be referenced from this note: ${this.access.toPublicPath(path)}`), 'guid-41bb26d8f842bd65');
    }
    return path;
  }

  /** Strict structured prose only. The domain supplies its authored-path policy
   * (including scope expansion), occurrence budget and separate field parsing.
   * Ordinary note-body permissiveness in validateAndNormalize is unchanged. */
  async validateBodyLinks(links: readonly BodyLink[], containerPath: string, principal: ScopePrincipal | undefined,
    assertPath: (path: string) => void): Promise<string[]> {
    for (const link of links) {
      const raw = /^!?\[\[/.test(link.link) ? parseWikiLink(link.link.replace(/^!/, '')).document : link.target;
      const decoded = decodeURIComponent(raw).replace(/\\/g, '/');
      assertPath(decoded.startsWith('.') ? posix.join(posix.dirname(containerPath), decoded) : decoded);
    }
    containerPath = this.lexicalPath(containerPath, principal, false);
    const paths = new Set<string>();
    for (const link of links) {
      const path = await this.resolveBodyLink(link, containerPath, principal);
      assertPath(path); paths.add(path);
    }
    return [...paths];
  }

  /** Request-local observations, not cached permissions or a current-state
   * promise. Callers retain their final access and revision guards. */
  createMetadataReader(principal?: ScopePrincipal): ReadReferenceMetadata {
    const observed = new Map<string, QueryNote>();
    return async (path, canRead) => {
      const allowed = (p: string) => this.access.canAccessPhysicalPath(p, principal) && canRead(p);
      if (!allowed(path)) return undefined;
      const cached = observed.get(path);
      if (cached) return cached;
      const note = (await this.fileSystem.readNoteMetadata([path], allowed, { fresh: true, strict: true, maxBytes: 8 * 1024 * 1024 }))[0];
      if (!allowed(path) || !note?.revision || isModerationHidden(note.frontmatter)) return undefined;
      observed.set(path, note);
      return note;
    };
  }

  /**
   * Validate explicit references and automatically add resolvable Obsidian
   * wikilinks found in the body. Unresolved body links remain ordinary
   * Obsidian links and are reported by lint, while explicit references fail
   * loudly because they claim to be evidence.
   */
  async validateAndNormalize(value: unknown, containerPath: string, principal?: ScopePrincipal, content?: string, policy: { strictBodyLinks?: boolean } = {}): Promise<string[]> {
    // Managed containers (for example Whisper) authorize their operation in
    // their own service. Normalize their scope without granting generic reads.
    containerPath = this.lexicalPath(containerPath, principal, false);
    const explicit = normalize(value);
    const references: string[] = [];
    for (const raw of explicit) {
      const resolved = /^!?\[\[.+\]\]$/.test(raw) ? await this.resolveWikiLinkTarget(parseWikiLink(raw.replace(/^!/, '')).document, principal, containerPath) : raw;
      const path = this.canonicalPath(resolved, principal);
      if (!this.access.canAccessPhysicalPath(path, principal)) {
        throw guidanceError(new Error(`Reference is not accessible in this scope: ${this.access.toPublicPath(path)}`), 'guid-bc12cbf46a8bb0c5');
      }
      if (!this.access.canReferenceFrom(containerPath, path)) {
        throw guidanceError(new Error(`A more-private note cannot be referenced from this note: ${this.access.toPublicPath(path)}`), 'guid-41bb26d8f842bd65');
      }
      if (!await this.fileSystem.noteExists(path)) {
        throw guidanceError(new Error(`Referenced note was not found: ${this.access.toPublicPath(path)}`), 'guid-4a0d37ad30c529ec');
      }
      if (!references.includes(path)) references.push(path);
    }
    for (const link of extractObsidianLinkOccurrences(String(content || ''))) {
      try {
        const path = await this.resolveBodyLink(link, containerPath, principal);
        if (!references.includes(path)) references.push(path);
      } catch (error) {
        // Structured experience fields cannot echo an unresolved alias whose
        // target is intentionally hidden from the current reader. Ordinary note
        // bodies retain their existing permissive Obsidian authoring behavior.
        if (policy.strictBodyLinks) throw error;
        // A normal unresolved link is valid Obsidian authoring. Only explicit
        // references above are treated as a hard evidence/metadata error.
        if (error instanceof Error && (error.message.includes('ambiguous') || error.message.includes('more-private'))) throw error;
      }
    }
    return references.slice(0, MAX_REFERENCES);
  }

  async resolve(value: unknown, principal?: ScopePrincipal, includeContent = false, limit = 10, maxChars = 4000) {
    const references = normalize(value);
    const resolved: Array<Record<string, unknown>> = [];
    let usedChars = 0;
    for (const path of references) {
      if (resolved.length >= Math.min(Math.max(limit, 1), 50)) break;
      let target = path;
      if (/^!?\[\[.+\]\]$/.test(path)) {
        try { target = await this.resolveWikiLinkTarget(parseWikiLink(path.replace(/^!/, '')).document, principal); } catch { continue; }
      }
      try { target = this.canonicalPath(target, principal); } catch { continue; }
      if (!this.access.canAccessPhysicalPath(target, principal) || !await this.fileSystem.noteExists(target)) continue;
      const note = await this.fileSystem.readNote(target);
      if (isModerationHidden(note.frontmatter)) continue;
      const item: Record<string, unknown> = {
        path: this.access.toPublicPath(target),
        title: titleFor(target, note.frontmatter),
        type: note.frontmatter.mcpvault_type || note.frontmatter.llm_wiki_type,
        revision: note.revision,
      };
      if (includeContent) {
        const remaining = maxChars - usedChars;
        if (remaining <= 0 && resolved.length > 0) break;
        const content = note.content.slice(0, Math.max(0, remaining));
        item.content = content;
        usedChars += Array.from(content).length;
      }
      resolved.push(item);
    }
    return resolved;
  }

  async readFromNote(params: {
    path: string;
    principal?: ScopePrincipal;
    includeContent?: boolean;
    limit?: number;
    maxChars?: number;
  }) {
    params = { ...params, path: this.canonicalPath(params.path, params.principal) };
    if (!this.access.canAccessPhysicalPath(params.path, params.principal)) throw guidanceError(new Error('Access denied to source note'), 'guid-625c00431fce3699');
    const note = await this.fileSystem.readNote(params.path);
    if (isModerationHidden(note.frontmatter)) throw guidanceError(new Error('The source note is unavailable because moderation has hidden it'), 'guid-705f049baba276fe');
    const references = [
      ...(Array.isArray(note.frontmatter.references) ? note.frontmatter.references : []),
      ...(Array.isArray(note.frontmatter.evidence_paths) ? note.frontmatter.evidence_paths : []),
      ...RELATION_FIELDS.flatMap(field => Array.isArray(note.frontmatter[field]) ? note.frontmatter[field] : []),
    ];
    const uniqueReferences = Array.from(new Set(references.filter((item): item is string => typeof item === 'string')));
    return {
      source: this.access.toPublicPath(params.path),
      references: await this.resolve(uniqueReferences, params.principal, params.includeContent === true, params.limit ?? 10, params.maxChars ?? 4000),
      total: uniqueReferences.length,
    };
  }
}
