import { createHash, randomUUID } from 'node:crypto';
import { normalizeScopeId } from './scopes.js';
const KNOWLEDGE_STATUSES = new Set(['draft', 'verified', 'disputed', 'superseded']);
const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);
const ISSUE_KINDS = new Set(['contradiction', 'unsupported_claim', 'stale', 'broken_link', 'missing_context', 'other']);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const joinRoot = (root, path) => root ? `${root}/${path}` : path;
const DEFAULT_SCHEMA = `# LLM Wiki schema

This vault uses ordinary Markdown, YAML frontmatter, Obsidian links, and Git as one coherent knowledge system.

## Layers

- \`_sources/\`: immutable source snapshots created only by \`ingest_source\`.
- Knowledge notes: normal notes anywhere in this scope, published with \`publish_knowledge\` and grounded in one or more source snapshots.
- \`_wiki/issues/\`: durable contradictions, unsupported claims, stale knowledge, and other repair work.
- Git: the authoritative author/reason/change history and rollback mechanism. Do not duplicate it in a hand-written edit log.

## Invariants

1. Never edit, delete, move, or retag an existing source snapshot. Ingest a new snapshot instead.
2. Every load-bearing claim in a knowledge note must be supported by its \`evidence_paths\` source snapshots.
3. Use \`expectedRevision\` for updates so peers cannot silently overwrite one another.
4. Mark uncertainty explicitly with \`confidence\` and \`knowledge_status\`.
5. Record contradictions and unsupported claims as Wiki issues; resolve them only with a reason.
6. Use \`get_wiki_catalog\` as the live index and \`lint_wiki\` as the deterministic quality gate.
7. Use discussions for peer argument and Git commits for coherent accepted changes.
`;
export class LlmWikiService {
    fileSystem;
    access;
    constructor(fileSystem, access) {
        this.fileSystem = fileSystem;
        this.access = access;
    }
    async initialize(scopeRoot, actor) {
        const schemaPath = joinRoot(scopeRoot, '_wiki/SCHEMA.md');
        if (await this.fileSystem.noteExists(schemaPath)) {
            const existing = await this.fileSystem.readNote(schemaPath);
            return { success: true, created: false, schemaPath: this.access.toPublicPath(schemaPath), revision: existing.revision };
        }
        const timestamp = now();
        await this.fileSystem.writeNote({
            path: schemaPath,
            content: DEFAULT_SCHEMA,
            frontmatter: {
                llm_wiki_type: 'schema',
                schema_version: 1,
                created_by: actor,
                created_at: timestamp,
                updated_at: timestamp,
            },
            expectedRevision: 'missing',
        });
        const created = await this.fileSystem.readNote(schemaPath);
        return { success: true, created: true, schemaPath: this.access.toPublicPath(schemaPath), revision: created.revision };
    }
    async ingestSource(params) {
        const title = String(params.title || '').trim();
        const inputContent = String(params.content ?? '').replace(/\r\n/g, '\n');
        if (!title || !inputContent.trim())
            throw new Error('title and non-empty source content are required');
        // gray-matter emits a separating newline after frontmatter. Canonicalizing
        // source bodies here makes idempotency and integrity checks byte-stable.
        const content = inputContent.endsWith('\n') ? inputContent : `${inputContent}\n`;
        const contentHash = hash(content);
        const sourceId = params.sourceId
            ? normalizeScopeId(params.sourceId, 'sourceId')
            : `source-${contentHash.slice(0, 16)}`;
        const path = joinRoot(params.scopeRoot, `_sources/${sourceId}.md`);
        if (await this.fileSystem.noteExists(path)) {
            const existing = await this.fileSystem.readNote(path);
            if (existing.frontmatter.content_sha256 === contentHash && existing.content === content) {
                return { success: true, created: false, sourceId, path: this.access.toPublicPath(path), contentHash, revision: existing.revision };
            }
            throw new Error(`Source id already exists with different content: ${sourceId}. Ingest a new immutable snapshot with a new sourceId.`);
        }
        const timestamp = params.capturedAt?.trim() || now();
        await this.fileSystem.writeNote({
            path,
            content,
            frontmatter: {
                llm_wiki_type: 'source',
                source_id: sourceId,
                title,
                immutable: true,
                content_sha256: contentHash,
                captured_by: params.capturedBy,
                captured_at: timestamp,
                ...(params.sourceUrl?.trim() && { source_url: params.sourceUrl.trim() }),
                ...(params.mediaType?.trim() && { media_type: params.mediaType.trim() }),
            },
            expectedRevision: 'missing',
        });
        const created = await this.fileSystem.readNote(path);
        return { success: true, created: true, sourceId, path: this.access.toPublicPath(path), contentHash, revision: created.revision };
    }
    async publishKnowledge(params) {
        const content = String(params.content ?? '');
        if (!content.trim())
            throw new Error('content is required');
        if (!params.expectedRevision)
            throw new Error("expectedRevision is required; use 'missing' for a new knowledge note");
        const evidencePaths = Array.from(new Set(params.evidencePaths || []));
        if (evidencePaths.length === 0)
            throw new Error('At least one immutable source evidence path is required');
        const confidence = params.confidence || 'medium';
        const status = params.status || 'draft';
        if (!CONFIDENCE_LEVELS.has(confidence))
            throw new Error('confidence must be low, medium, or high');
        if (!KNOWLEDGE_STATUSES.has(status))
            throw new Error('status must be draft, verified, disputed, or superseded');
        for (const evidencePath of evidencePaths) {
            if (!this.access.canReferenceFrom(params.path, evidencePath)) {
                throw new Error(`A more-private source cannot ground a more-public knowledge note: ${this.access.toPublicPath(evidencePath)}`);
            }
            const evidence = await this.fileSystem.readNote(evidencePath);
            if (evidence.frontmatter.llm_wiki_type !== 'source' || evidence.frontmatter.immutable !== true) {
                throw new Error(`Evidence is not an immutable LLM Wiki source: ${this.access.toPublicPath(evidencePath)}`);
            }
            if (evidence.frontmatter.content_sha256 !== hash(evidence.content)) {
                throw new Error(`Evidence source failed its integrity hash: ${this.access.toPublicPath(evidencePath)}`);
            }
        }
        const exists = await this.fileSystem.noteExists(params.path);
        const existing = exists ? await this.fileSystem.readNote(params.path) : undefined;
        if (existing && existing.frontmatter.llm_wiki_type && existing.frontmatter.llm_wiki_type !== 'knowledge') {
            throw new Error(`Refusing to replace LLM Wiki ${existing.frontmatter.llm_wiki_type} metadata at ${this.access.toPublicPath(params.path)}`);
        }
        const timestamp = now();
        await this.fileSystem.writeNote({
            path: params.path,
            content,
            frontmatter: {
                ...(existing?.frontmatter || {}),
                llm_wiki_type: 'knowledge',
                evidence_paths: evidencePaths,
                confidence,
                knowledge_status: status,
                updated_by: params.author,
                updated_at: timestamp,
                ...(!existing && { created_by: params.author, created_at: timestamp }),
            },
            expectedRevision: params.expectedRevision,
        });
        const updated = await this.fileSystem.readNote(params.path);
        return {
            success: true,
            created: !exists,
            path: this.access.toPublicPath(params.path),
            evidencePaths: evidencePaths.map(path => this.access.toPublicPath(path)),
            revision: updated.revision,
        };
    }
    async catalog(principal) {
        const canAccess = (path) => this.access.canAccessPhysicalPath(path, principal);
        const result = await this.fileSystem.queryNotes({ limit: 500 }, canAccess);
        const entries = result.notes
            .filter(note => typeof note.frontmatter.llm_wiki_type === 'string')
            .map(note => ({
            path: this.access.toPublicPath(note.path),
            type: note.frontmatter.llm_wiki_type,
            title: note.frontmatter.title,
            status: note.frontmatter.knowledge_status || note.frontmatter.status,
            confidence: note.frontmatter.confidence,
            updatedAt: note.frontmatter.updated_at || note.frontmatter.captured_at,
        }));
        const counts = entries.reduce((acc, entry) => {
            acc[entry.type] = (acc[entry.type] || 0) + 1;
            return acc;
        }, {});
        return { counts, entries, total: entries.length, truncated: result.truncated };
    }
    async lint(principal, limit = 200) {
        const canAccess = (path) => this.access.canAccessPhysicalPath(path, principal);
        const result = await this.fileSystem.queryNotes({ limit: 500, includeContent: true }, canAccess);
        const issues = [];
        for (const note of result.notes) {
            const type = note.frontmatter.llm_wiki_type;
            if (type === 'source') {
                if (note.frontmatter.immutable !== true) {
                    issues.push({ severity: 'error', code: 'source_not_immutable', path: this.access.toPublicPath(note.path), detail: 'Source metadata must set immutable: true.' });
                }
                if (note.frontmatter.content_sha256 !== hash(note.content || '')) {
                    issues.push({ severity: 'error', code: 'source_hash_mismatch', path: this.access.toPublicPath(note.path), detail: 'Source content differs from its captured SHA-256 hash.' });
                }
            }
            if (type === 'knowledge') {
                const evidence = Array.isArray(note.frontmatter.evidence_paths) ? note.frontmatter.evidence_paths.filter((item) => typeof item === 'string') : [];
                if (evidence.length === 0) {
                    issues.push({ severity: 'error', code: 'knowledge_without_evidence', path: this.access.toPublicPath(note.path), detail: 'Knowledge note has no immutable source evidence.' });
                }
                for (const evidencePath of evidence) {
                    if (!canAccess(evidencePath) || !await this.fileSystem.noteExists(evidencePath)) {
                        issues.push({ severity: 'error', code: 'missing_evidence', path: this.access.toPublicPath(note.path), detail: `Missing or inaccessible evidence: ${this.access.toPublicPath(evidencePath)}` });
                        continue;
                    }
                    const source = await this.fileSystem.readNote(evidencePath);
                    if (source.frontmatter.llm_wiki_type !== 'source') {
                        issues.push({ severity: 'error', code: 'invalid_evidence_type', path: this.access.toPublicPath(note.path), detail: `Evidence is not a source snapshot: ${this.access.toPublicPath(evidencePath)}` });
                    }
                }
            }
        }
        const unresolved = await this.fileSystem.findUnresolvedLinks(limit, canAccess);
        for (const link of unresolved.unresolved) {
            issues.push({ severity: 'warning', code: 'broken_wikilink', path: this.access.toPublicPath(link.path), detail: `${link.link} at line ${link.line}` });
        }
        const ordered = issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
        return {
            healthy: ordered.every(issue => issue.severity !== 'error'),
            errors: ordered.filter(issue => issue.severity === 'error').length,
            warnings: ordered.filter(issue => issue.severity === 'warning').length,
            issues: ordered.slice(0, limit),
            truncated: ordered.length > limit || result.truncated || unresolved.truncated,
        };
    }
    async reportIssue(params) {
        if (!ISSUE_KINDS.has(params.kind))
            throw new Error(`Unsupported issue kind: ${params.kind}`);
        if (!params.title?.trim() || !params.description?.trim())
            throw new Error('title and description are required');
        const id = normalizeScopeId(params.issueId || `issue-${randomUUID().slice(0, 12)}`, 'issueId');
        const path = joinRoot(params.scopeRoot, `_wiki/issues/${id}.md`);
        for (const reference of [params.subjectPath, ...(params.evidencePaths || [])].filter((item) => Boolean(item))) {
            if (!this.access.canReferenceFrom(path, reference)) {
                throw new Error(`A public issue cannot expose a more-private reference: ${this.access.toPublicPath(reference)}`);
            }
        }
        const timestamp = now();
        await this.fileSystem.writeNote({
            path,
            content: `# ${params.title.trim()}\n\n${params.description.trim()}\n\n## Resolution\n\nOpen.\n`,
            frontmatter: {
                llm_wiki_type: 'issue', issue_id: id, issue_kind: params.kind, status: 'open',
                reported_by: params.reportedBy, created_at: timestamp, updated_at: timestamp,
                ...(params.subjectPath && { subject_path: params.subjectPath }),
                ...(params.evidencePaths?.length && { evidence_paths: params.evidencePaths }),
            },
            expectedRevision: 'missing',
        });
        const created = await this.fileSystem.readNote(path);
        return { success: true, issueId: id, path: this.access.toPublicPath(path), revision: created.revision };
    }
    async resolveIssue(params) {
        if (!params.resolution?.trim() || !params.expectedRevision)
            throw new Error('resolution and expectedRevision are required');
        const issue = await this.fileSystem.readNote(params.path);
        if (issue.frontmatter.llm_wiki_type !== 'issue')
            throw new Error('path is not an LLM Wiki issue');
        const timestamp = now();
        const marker = '## Resolution';
        const replacement = `${marker}\n\n${timestamp} — Resolved by ${params.actor}: ${params.resolution.trim()}\n`;
        const content = issue.content.includes(marker)
            ? issue.content.replace(/## Resolution[\s\S]*$/, replacement)
            : `${issue.content.trimEnd()}\n\n${replacement}`;
        await this.fileSystem.writeNote({
            path: params.path,
            content,
            frontmatter: { ...issue.frontmatter, status: 'resolved', resolved_by: params.actor, resolved_at: timestamp, updated_at: timestamp },
            expectedRevision: params.expectedRevision,
        });
        const updated = await this.fileSystem.readNote(params.path);
        return { success: true, path: this.access.toPublicPath(params.path), status: 'resolved', revision: updated.revision };
    }
}
