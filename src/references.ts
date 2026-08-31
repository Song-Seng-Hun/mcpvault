import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';

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

  async validateAndNormalize(value: unknown, containerPath: string, principal?: ScopePrincipal): Promise<string[]> {
    const references = normalize(value);
    for (const path of references) {
      if (!this.access.canAccessPhysicalPath(path, principal)) {
        throw new Error(`Reference is not accessible in this scope: ${this.access.toPublicPath(path)}`);
      }
      if (!this.access.canReferenceFrom(containerPath, path)) {
        throw new Error(`A more-private note cannot be referenced from this note: ${this.access.toPublicPath(path)}`);
      }
      if (!await this.fileSystem.noteExists(path)) {
        throw new Error(`Referenced note was not found: ${this.access.toPublicPath(path)}`);
      }
    }
    return references;
  }

  async resolve(value: unknown, principal?: ScopePrincipal, includeContent = false, limit = 10, maxChars = 4000) {
    const references = normalize(value);
    const resolved: Array<Record<string, unknown>> = [];
    let usedChars = 0;
    for (const path of references) {
      if (resolved.length >= Math.min(Math.max(limit, 1), 50)) break;
      if (!this.access.canAccessPhysicalPath(path, principal) || !await this.fileSystem.noteExists(path)) continue;
      const note = await this.fileSystem.readNote(path);
      const item: Record<string, unknown> = {
        path: this.access.toPublicPath(path),
        title: titleFor(path, note.frontmatter),
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
    const references = [
      ...(Array.isArray(note.frontmatter.references) ? note.frontmatter.references : []),
      ...(Array.isArray(note.frontmatter.evidence_paths) ? note.frontmatter.evidence_paths : []),
    ];
    return {
      source: this.access.toPublicPath(params.path),
      references: await this.resolve(references, params.principal, params.includeContent === true, params.limit ?? 10, params.maxChars ?? 4000),
      total: references.length,
    };
  }
}
