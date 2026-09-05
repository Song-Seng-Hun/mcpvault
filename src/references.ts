import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import { isModerationHidden } from './moderation-policy.js';
import { parseWikiLink } from './wikilink/resolveWikiLink.js';
import { RELATION_FIELDS } from './organization.js';

const MAX_REFERENCES = 50;

function normalize(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('references must be an array of note paths');
  const paths = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
  if (paths.length !== value.length) throw new Error('references must contain only non-empty strings');
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

  private async resolveWikiLinkTarget(target: string, principal?: ScopePrincipal, sourcePath?: string): Promise<string> {
    const name = target.trim().replace(/\.md$/i, '');
    const matches = await this.fileSystem.findPathForWikiLink(name, path => this.access.canAccessPhysicalPath(path, principal), sourcePath);
    if (matches.length === 0) throw new Error(`Obsidian reference does not resolve: [[${target}]]`);
    if (matches.length > 1) throw new Error(`Obsidian reference is ambiguous: [[${target}]]. Use a path-qualified link such as [[folder/${name.split('/').at(-1)}]]`);
    return matches[0]!;
  }

  /**
   * Validate explicit references and automatically add resolvable Obsidian
   * wikilinks found in the body. Unresolved body links remain ordinary
   * Obsidian links and are reported by lint, while explicit references fail
   * loudly because they claim to be evidence.
   */
  async validateAndNormalize(value: unknown, containerPath: string, principal?: ScopePrincipal, content?: string): Promise<string[]> {
    const explicit = normalize(value);
    const references: string[] = [];
    for (const raw of explicit) {
      const path = /^!?\[\[.+\]\]$/.test(raw) ? await this.resolveWikiLinkTarget(parseWikiLink(raw.replace(/^!/, '')).document, principal, containerPath) : raw;
      if (!this.access.canAccessPhysicalPath(path, principal)) {
        throw new Error(`Reference is not accessible in this scope: ${this.access.toPublicPath(path)}`);
      }
      if (!this.access.canReferenceFrom(containerPath, path)) {
        throw new Error(`A more-private note cannot be referenced from this note: ${this.access.toPublicPath(path)}`);
      }
      if (!await this.fileSystem.noteExists(path)) {
        throw new Error(`Referenced note was not found: ${this.access.toPublicPath(path)}`);
      }
      references.push(path);
    }
    for (const link of extractObsidianLinkOccurrences(String(content || ''))) {
      try {
        // The occurrence's normalized target omits ./; keep authored wikilink
        // spelling so a source-relative link cannot become a basename lookup.
        const target = /^!?\[\[/.test(link.link) ? parseWikiLink(link.link.replace(/^!/, '')).document : link.target;
        const path = await this.resolveWikiLinkTarget(target, principal, containerPath);
        if (!this.access.canReferenceFrom(containerPath, path)) {
          throw new Error(`A more-private note cannot be referenced from this note: ${this.access.toPublicPath(path)}`);
        }
        if (!references.includes(path)) references.push(path);
      } catch (error) {
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
    if (!this.access.canAccessPhysicalPath(params.path, params.principal)) throw new Error('Access denied to source note');
    const note = await this.fileSystem.readNote(params.path);
    if (isModerationHidden(note.frontmatter)) throw new Error('The source note is unavailable because moderation has hidden it');
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
