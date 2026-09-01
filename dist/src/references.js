import { extractWikiLinkOccurrences } from './backlinks.js';
import { isModerationHidden } from './moderation-policy.js';
import { parseWikiLink } from './wikilink/resolveWikiLink.js';
const MAX_REFERENCES = 50;
function normalize(value) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value))
        throw new Error('references must be an array of note paths');
    const paths = value
        .filter((item) => typeof item === 'string')
        .map(item => item.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
        .filter(Boolean);
    if (paths.length !== value.length)
        throw new Error('references must contain only non-empty strings');
    return Array.from(new Set(paths)).slice(0, MAX_REFERENCES);
}
function titleFor(path, frontmatter) {
    if (typeof frontmatter.title === 'string' && frontmatter.title.trim())
        return frontmatter.title.trim();
    return path.split('/').at(-1)?.replace(/\.[^.]+$/, '') || path;
}
export class ReferenceService {
    fileSystem;
    access;
    constructor(fileSystem, access) {
        this.fileSystem = fileSystem;
        this.access = access;
    }
    async resolveWikiLinkTarget(target, principal) {
        const name = target.trim().replace(/\.md$/i, '');
        const matches = await this.fileSystem.findPathForWikiLink(name, path => this.access.canAccessPhysicalPath(path, principal));
        if (matches.length === 0)
            throw new Error(`Obsidian reference does not resolve: [[${target}]]`);
        if (matches.length > 1)
            throw new Error(`Obsidian reference is ambiguous: [[${target}]]. Use a path-qualified link such as [[folder/${name.split('/').at(-1)}]]`);
        return matches[0];
    }
    /**
     * Validate explicit references and automatically add resolvable Obsidian
     * wikilinks found in the body. Unresolved body links remain ordinary
     * Obsidian links and are reported by lint, while explicit references fail
     * loudly because they claim to be evidence.
     */
    async validateAndNormalize(value, containerPath, principal, content) {
        const explicit = normalize(value);
        const references = [];
        for (const raw of explicit) {
            const path = /^!?\[\[.+\]\]$/.test(raw) ? await this.resolveWikiLinkTarget(parseWikiLink(raw.replace(/^!/, '')).document) : raw;
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
        for (const link of extractWikiLinkOccurrences(String(content || ''))) {
            try {
                const path = await this.resolveWikiLinkTarget(link.target, principal);
                if (!this.access.canReferenceFrom(containerPath, path)) {
                    throw new Error(`A more-private note cannot be referenced from this note: ${this.access.toPublicPath(path)}`);
                }
                if (!references.includes(path))
                    references.push(path);
            }
            catch (error) {
                // A normal unresolved link is valid Obsidian authoring. Only explicit
                // references above are treated as a hard evidence/metadata error.
                if (error instanceof Error && (error.message.includes('ambiguous') || error.message.includes('more-private')))
                    throw error;
            }
        }
        return references.slice(0, MAX_REFERENCES);
    }
    async resolve(value, principal, includeContent = false, limit = 10, maxChars = 4000) {
        const references = normalize(value);
        const resolved = [];
        let usedChars = 0;
        for (const path of references) {
            if (resolved.length >= Math.min(Math.max(limit, 1), 50))
                break;
            if (!this.access.canAccessPhysicalPath(path, principal) || !await this.fileSystem.noteExists(path))
                continue;
            const note = await this.fileSystem.readNote(path);
            if (isModerationHidden(note.frontmatter))
                continue;
            const item = {
                path: this.access.toPublicPath(path),
                title: titleFor(path, note.frontmatter),
                type: note.frontmatter.mcpvault_type || note.frontmatter.llm_wiki_type,
                revision: note.revision,
            };
            if (includeContent) {
                const remaining = maxChars - usedChars;
                if (remaining <= 0 && resolved.length > 0)
                    break;
                const content = note.content.slice(0, Math.max(0, remaining));
                item.content = content;
                usedChars += Array.from(content).length;
            }
            resolved.push(item);
        }
        return resolved;
    }
    async readFromNote(params) {
        if (!this.access.canAccessPhysicalPath(params.path, params.principal))
            throw new Error('Access denied to source note');
        const note = await this.fileSystem.readNote(params.path);
        if (isModerationHidden(note.frontmatter))
            throw new Error('The source note is unavailable because moderation has hidden it');
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
