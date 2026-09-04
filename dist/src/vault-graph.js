import { watch } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import { VaultIoCoordinator } from './vault-io.js';
import { RELATION_FIELDS } from './organization.js';
import { noteReferenceDocument, noteReferenceTermKeys } from './note-reference.js';
import { collectPlainFrontmatterReferences, isNavigationalFrontmatterReference } from './property-references.js';
const GRAPH_RECONCILE_INTERVAL_MS = 60_000;
const NO_WATCHER_RECONCILE_INTERVAL_MS = 5_000;
const NOTE_PATTERN = /\.(?:md|markdown|txt)$/i;
const INLINE_TAG_PATTERN = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_\/\-]*)/g;
function normalizePath(value) {
    return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
function normalizedPath(value) {
    return normalizePath(value).toLowerCase();
}
function isNote(path) {
    return NOTE_PATTERN.test(path);
}
function withoutExtension(path) {
    return path.replace(/\.[^/.]+$/, '');
}
function basename(path) {
    return path.slice(path.lastIndexOf('/') + 1);
}
function addToMap(map, key, path) {
    const paths = map.get(key);
    if (paths) {
        if (!paths.includes(path))
            paths.push(path);
    }
    else
        map.set(key, [path]);
}
function buildResolver(paths, entries) {
    const resolver = {
        exact: new Map(),
        withoutExtension: new Map(),
        basename: new Map(),
        basenameWithoutExtension: new Map(),
        identity: new Map(),
    };
    for (const path of paths) {
        const exact = normalizedPath(path);
        const noExtension = withoutExtension(exact);
        addToMap(resolver.exact, exact, path);
        addToMap(resolver.withoutExtension, noExtension, path);
        addToMap(resolver.basename, basename(exact), path);
        addToMap(resolver.basenameWithoutExtension, basename(noExtension), path);
        const entry = entries?.get(path);
        for (const term of entry?.identityTerms || []) {
            for (const normalizedTerm of noteReferenceTermKeys(term))
                addToMap(resolver.identity, normalizedTerm, path);
        }
    }
    return resolver;
}
/**
 * Resolve wikilinks using the same matching rules as backlinks.ts, but with
 * maps built once per visibility set instead of scanning every note for every
 * link. This is a derived read model; Markdown remains authoritative.
 */
function resolveTargets(target, resolver, sourcePath) {
    const normalizedTarget = normalizedPath(target);
    if (!normalizedTarget)
        return [];
    const hasExtension = /(^|\/)[^/]+\.[^/]+$/.test(normalizedTarget);
    if (sourcePath && /^(?:\.\.?\/)/.test(normalizedTarget)) {
        const relativeTarget = normalizedPath(posix.normalize(posix.join(posix.dirname(normalizePath(sourcePath)), normalizedTarget)));
        const relativeMatches = hasExtension
            ? resolver.exact.get(relativeTarget) || []
            : resolver.withoutExtension.get(withoutExtension(relativeTarget)) || [];
        if (relativeMatches.length > 0)
            return relativeMatches;
    }
    let pathMatches;
    if (hasExtension) {
        pathMatches = normalizedTarget.includes('/')
            ? resolver.exact.get(normalizedTarget) || []
            : resolver.basename.get(normalizedTarget) || [];
    }
    else {
        pathMatches = normalizedTarget.includes('/')
            ? resolver.withoutExtension.get(normalizedTarget) || []
            : resolver.basenameWithoutExtension.get(normalizedTarget) || [];
    }
    if (pathMatches.length > 0)
        return pathMatches;
    for (const identityKey of noteReferenceTermKeys(normalizedTarget)) {
        const identityMatches = resolver.identity.get(identityKey);
        if (identityMatches?.length)
            return identityMatches;
    }
    return [];
}
function addTopMatch(items, item, limit, compare) {
    if (items.length < limit) {
        items.push(item);
        return;
    }
    let worst = 0;
    for (let index = 1; index < items.length; index += 1) {
        if (compare(items[index], items[worst]) > 0)
            worst = index;
    }
    if (compare(item, items[worst]) < 0)
        items[worst] = item;
}
/**
 * Incremental Obsidian graph read model for backlinks, tags, unresolved links,
 * and orphan notes. It stores only parsed link/tag/identity metadata and refreshes a
 * changed note, rather than rereading the entire vault for every request.
 */
export class VaultGraphIndex {
    pathFilter;
    frontmatter;
    catalog;
    vaultIo;
    vaultPath;
    entries = new Map();
    allPaths = new Set();
    dirty = new Set();
    refreshPromise;
    watcher;
    watcherStarted = false;
    initialized = false;
    needsFullRefresh = true;
    lastFullRefreshAt = 0;
    changeGeneration = 0;
    visibilityCache = new WeakMap();
    catalogUnsubscribe;
    constructor(vaultPath, pathFilter, frontmatter, catalog, vaultIo = new VaultIoCoordinator()) {
        this.pathFilter = pathFilter;
        this.frontmatter = frontmatter;
        this.catalog = catalog;
        this.vaultIo = vaultIo;
        this.vaultPath = resolve(vaultPath);
        if (catalog) {
            this.catalogUnsubscribe = catalog.subscribeBatch(changes => {
                if (changes)
                    this.invalidateMany(changes);
                else {
                    this.needsFullRefresh = true;
                    this.dirty.clear();
                }
            });
        }
    }
    invalidate(path, kind = 'upsert') {
        this.changeGeneration += 1;
        if (!path) {
            this.needsFullRefresh = true;
            this.dirty.clear();
            return;
        }
        const normalized = normalizePath(path);
        if (!this.pathFilter.isAllowedForListing(normalized))
            return;
        if (kind === 'delete') {
            this.entries.delete(normalized);
            this.allPaths.delete(normalized);
        }
        else {
            this.allPaths.add(normalized);
        }
        if (isNote(normalized) || this.pathFilter.isAllowed(normalized))
            this.dirty.add(normalized);
    }
    invalidateMany(changes) {
        this.changeGeneration += 1;
        for (const change of changes) {
            const normalized = normalizePath(change.path);
            if (!this.pathFilter.isAllowedForListing(normalized))
                continue;
            if (change.kind === 'delete') {
                this.entries.delete(normalized);
                this.allPaths.delete(normalized);
            }
            else {
                this.allPaths.add(normalized);
            }
            if (isNote(normalized) || this.pathFilter.isAllowed(normalized))
                this.dirty.add(normalized);
        }
    }
    close() {
        this.catalogUnsubscribe?.();
        this.watcher?.close();
        this.watcher = undefined;
        this.dirty.clear();
        this.entries.clear();
        this.allPaths.clear();
    }
    async getBacklinks(path, limit, canAccessPath, offset = 0, canIncludeSource) {
        await this.ensure();
        const target = normalizePath(path);
        const normalizedTarget = normalizedPath(target);
        let targetEntry;
        for (const entry of this.entries.values()) {
            if (normalizedPath(entry.path) === normalizedTarget) {
                targetEntry = entry;
                break;
            }
        }
        if (!targetEntry)
            throw new Error(`File not found: ${target}`);
        if (!canAccessPath(targetEntry.path))
            throw new Error(`Access denied: ${target}`);
        const visible = this.visibilityContext(canAccessPath);
        const backlinks = [];
        let total = 0;
        const compare = (a, b) => a.path.localeCompare(b.path) || a.line - b.line;
        for (const entry of this.entries.values()) {
            if (normalizedPath(entry.path) === normalizedTarget || !canAccessPath(entry.path))
                continue;
            let sourceChecked = false;
            for (const link of entry.links) {
                if (!resolveTargets(link.target, visible.resolver, entry.path).some(path => normalizedPath(path) === normalizedTarget))
                    continue;
                // Check each matching author once, before counts and pagination. The
                // filesystem supplies a fresh, path-guarded moderation check so a
                // stale graph entry cannot disclose a newly hidden author's links.
                if (!sourceChecked) {
                    if (canIncludeSource && !await canIncludeSource(entry.path))
                        break;
                    sourceChecked = true;
                }
                total += 1;
                const backlink = {
                    path: entry.path,
                    line: link.line,
                    link: link.link,
                    context: link.context,
                    ...(link.heading && { heading: link.heading }),
                    ...(link.targetHeading && { targetHeading: link.targetHeading }),
                    ...(link.targetBlockId && { targetBlockId: link.targetBlockId }),
                    ...(link.relation && { relation: link.relation }),
                    ...(link.sourceClaimId && { sourceClaimId: link.sourceClaimId }),
                    ...(link.propertyPath && { propertyPath: link.propertyPath }),
                };
                addTopMatch(backlinks, backlink, offset + limit, compare);
            }
        }
        backlinks.sort(compare);
        const page = backlinks.slice(offset, offset + limit);
        return { target, backlinks: page, total, truncated: total > offset + page.length };
    }
    async getOutlinks(path, limit, canAccessPath, offset = 0) {
        await this.ensure();
        const source = normalizePath(path);
        const entry = this.entries.get(source);
        if (!entry)
            throw new Error(`File not found: ${source}`);
        if (!canAccessPath(source))
            throw new Error(`Access denied: ${source}`);
        const visible = this.visibilityContext(canAccessPath);
        const allResolver = buildResolver([...this.allPaths], this.entries);
        const outlinks = entry.links.filter(link => {
            if (/^scope:\/\/(?:model|agent|user)\//i.test(link.target.trim()))
                return false;
            const anyMatches = resolveTargets(link.target, allResolver, entry.path);
            if (anyMatches.length === 0)
                return true;
            return resolveTargets(link.target, visible.resolver, entry.path).length > 0;
        });
        return {
            source,
            outlinks: outlinks.slice(offset, offset + limit),
            total: outlinks.length,
            truncated: outlinks.length > offset + limit,
        };
    }
    async findUnresolvedLinks(limit, canAccessPath, offset = 0) {
        await this.ensure();
        const { paths: visiblePaths, pathSet: visible, resolver } = this.visibilityContext(canAccessPath);
        const unresolved = [];
        let total = 0;
        for (const path of visiblePaths) {
            if (!isNote(path))
                continue;
            const entry = this.entries.get(path);
            if (!entry)
                continue;
            for (const link of entry.links) {
                if (resolveTargets(link.target, resolver, entry.path).some(path => visible.has(path)))
                    continue;
                total += 1;
                if (total > offset && unresolved.length < limit)
                    unresolved.push({ ...link, path: entry.path });
            }
        }
        return { unresolved, total, truncated: total > offset + unresolved.length };
    }
    async findOrphanNotes(limit, canAccessPath, offset = 0) {
        await this.ensure();
        const { paths: allVisiblePaths, resolver } = this.visibilityContext(canAccessPath);
        const notePaths = allVisiblePaths.filter(isNote);
        const visible = new Set(notePaths);
        const incomingCounts = new Map(notePaths.map(path => [normalizedPath(path), 0]));
        for (const source of notePaths) {
            const entry = this.entries.get(source);
            if (!entry)
                continue;
            for (const link of entry.links) {
                for (const destination of resolveTargets(link.target, resolver, entry.path)) {
                    if (normalizedPath(destination) !== normalizedPath(source) && visible.has(destination)) {
                        const key = normalizedPath(destination);
                        incomingCounts.set(key, (incomingCounts.get(key) || 0) + 1);
                    }
                }
            }
        }
        const orphans = notePaths
            .filter(path => incomingCounts.get(normalizedPath(path)) === 0)
            .map(path => ({ path, incomingLinks: 0 }))
            .sort((left, right) => left.path.localeCompare(right.path));
        return { orphans: orphans.slice(offset, offset + limit), total: orphans.length, truncated: orphans.length > offset + limit };
    }
    async listAllTags(canAccessPath) {
        await this.ensure();
        const counts = new Map();
        for (const entry of this.entries.values()) {
            if (!canAccessPath(entry.path))
                continue;
            for (const tag of entry.tags)
                counts.set(tag, (counts.get(tag) || 0) + 1);
        }
        return [...counts.entries()]
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    }
    async ensure() {
        this.startWatcher();
        if (this.refreshPromise)
            await this.refreshPromise;
        const interval = this.watcher ? GRAPH_RECONCILE_INTERVAL_MS : NO_WATCHER_RECONCILE_INTERVAL_MS;
        if (!this.initialized || this.needsFullRefresh || Date.now() - this.lastFullRefreshAt >= interval)
            await this.refreshAll();
        if (this.dirty.size > 0)
            await this.refreshDirty();
    }
    visibilityContext(canAccessPath) {
        const cached = this.visibilityCache.get(canAccessPath);
        if (cached && cached.generation === this.changeGeneration)
            return cached;
        const paths = [...this.allPaths].filter(canAccessPath).sort((a, b) => a.localeCompare(b));
        const context = {
            generation: this.changeGeneration,
            paths,
            pathSet: new Set(paths),
            resolver: buildResolver(paths, this.entries),
        };
        this.visibilityCache.set(canAccessPath, context);
        return context;
    }
    startWatcher() {
        if (this.catalog || this.watcherStarted)
            return;
        this.watcherStarted = true;
        try {
            this.watcher = watch(this.vaultPath, { recursive: true }, (_event, filename) => {
                const path = filename ? normalizePath(String(filename)) : '';
                if (path && isNote(path) && this.pathFilter.isAllowed(path))
                    this.dirty.add(path);
                else
                    this.needsFullRefresh = true;
            });
            this.watcher.on('error', () => {
                this.watcher?.close();
                this.watcher = undefined;
                this.needsFullRefresh = true;
            });
            this.watcher.unref?.();
        }
        catch {
            this.watcher = undefined;
        }
    }
    async refreshAll() {
        if (this.refreshPromise)
            return this.refreshPromise;
        this.refreshPromise = (async () => {
            const generation = this.changeGeneration;
            const paths = this.catalog
                ? await this.catalog.allPathsSnapshot()
                : await this.findNotePaths(this.vaultPath);
            this.allPaths = new Set(paths.filter(path => this.pathFilter.isAllowedForListing(path)));
            const next = new Map();
            for (let start = 0; start < paths.length; start += 16) {
                const batch = paths.slice(start, start + 16);
                const entries = await Promise.all(batch.map(path => this.readEntry(path, this.entries.get(path))));
                for (const entry of entries)
                    if (entry)
                        next.set(entry.path, entry);
            }
            this.entries.clear();
            for (const [path, entry] of next)
                this.entries.set(path, entry);
            const unchangedDuringRefresh = generation === this.changeGeneration;
            this.changeGeneration += 1;
            if (unchangedDuringRefresh)
                this.dirty.clear();
            this.needsFullRefresh = false;
            this.initialized = true;
            this.lastFullRefreshAt = Date.now();
        })();
        try {
            await this.refreshPromise;
        }
        finally {
            this.refreshPromise = undefined;
        }
    }
    async refreshDirty() {
        if (this.refreshPromise)
            return this.refreshPromise;
        this.refreshPromise = (async () => {
            const paths = [...this.dirty];
            this.dirty.clear();
            const entries = await Promise.all(paths.map(path => this.readEntry(path)));
            for (let index = 0; index < paths.length; index += 1) {
                const path = paths[index];
                const entry = entries[index];
                if (entry)
                    this.entries.set(path, entry);
                else
                    this.entries.delete(path);
            }
            this.changeGeneration += 1;
        })();
        try {
            await this.refreshPromise;
        }
        finally {
            this.refreshPromise = undefined;
        }
    }
    async readEntry(path, existing) {
        const normalized = normalizePath(path);
        if (!isNote(normalized) || !this.pathFilter.isAllowed(normalized))
            return undefined;
        try {
            const fullPath = join(this.vaultPath, normalized);
            const info = await stat(fullPath);
            if (!info.isFile())
                return undefined;
            if (existing && existing.size === info.size && existing.mtimeMs === info.mtimeMs)
                return existing;
            const raw = await this.vaultIo.readUtf8(fullPath);
            const parsed = this.frontmatter.parse(raw);
            const tags = [];
            const identityTerms = [];
            for (const field of ['title', 'preferred_term', 'stable_id']) {
                const value = parsed.frontmatter[field];
                if (typeof value === 'string' && value.trim())
                    identityTerms.push(value.trim());
            }
            const aliases = Array.isArray(parsed.frontmatter.aliases)
                ? parsed.frontmatter.aliases
                : typeof parsed.frontmatter.aliases === 'string'
                    ? [parsed.frontmatter.aliases]
                    : [];
            for (const alias of aliases) {
                if (typeof alias === 'string' && alias.trim())
                    identityTerms.push(alias.trim());
            }
            if (Array.isArray(parsed.frontmatter.tags)) {
                for (const tag of parsed.frontmatter.tags) {
                    if (typeof tag === 'string' && tag.trim())
                        tags.push(tag.trim().toLowerCase());
                }
            }
            INLINE_TAG_PATTERN.lastIndex = 0;
            let match;
            while ((match = INLINE_TAG_PATTERN.exec(parsed.content)) !== null)
                tags.push(match[1].toLowerCase());
            const links = extractObsidianLinkOccurrences(raw);
            for (const relation of RELATION_FIELDS) {
                const values = Array.isArray(parsed.frontmatter[relation]) ? parsed.frontmatter[relation] : [];
                for (let relationIndex = 0; relationIndex < values.length; relationIndex += 1) {
                    const value = values[relationIndex];
                    if (typeof value !== 'string' || !value.trim())
                        continue;
                    const target = value.trim();
                    const normalizedTarget = target.replace(/^!?\[\[/, '').replace(/\]\]$/, '').split(/[|#]/, 1)[0].trim().replace(/\\/g, '/').toLowerCase();
                    const propertyPath = `${relation}[${relationIndex}]`;
                    const existing = links.find(link => link.link === target && !link.relation);
                    if (existing) {
                        existing.relation = relation;
                        existing.context = `${relation}: ${target}`;
                        existing.propertyPath = propertyPath;
                    }
                    else {
                        links.push({
                            target: normalizedTarget,
                            line: 1,
                            link: /^!?\[\[.+\]\]$/.test(target) ? target : `[[${target}]]`,
                            context: `${relation}: ${target}`,
                            relation,
                            propertyPath,
                        });
                    }
                }
            }
            for (const reference of collectPlainFrontmatterReferences(parsed.frontmatter)) {
                if (!isNavigationalFrontmatterReference(reference))
                    continue;
                if (RELATION_FIELDS.includes(reference.root))
                    continue;
                links.push({
                    target: noteReferenceDocument(reference.value),
                    line: 1,
                    link: reference.value.trim(),
                    context: `${reference.propertyPath}: ${reference.value.trim()}`,
                    propertyPath: reference.propertyPath,
                });
            }
            const claims = Array.isArray(parsed.frontmatter.claims) ? parsed.frontmatter.claims : [];
            const claimRelations = [
                { field: 'supports_claims', relation: 'claim_supports' },
                { field: 'contradicts_claims', relation: 'claim_contradicts' },
                { field: 'depends_on_claims', relation: 'claim_depends_on' },
            ];
            for (let claimIndex = 0; claimIndex < claims.length; claimIndex += 1) {
                const claim = claims[claimIndex];
                if (!claim || typeof claim !== 'object')
                    continue;
                const sourceClaimId = String(claim.id || `claim-${claimIndex + 1}`).trim().toLowerCase();
                if (!sourceClaimId)
                    continue;
                for (const definition of claimRelations) {
                    const values = Array.isArray(claim[definition.field]) ? claim[definition.field] : [];
                    for (const value of values.slice(0, 20)) {
                        if (typeof value !== 'string' || !value.trim())
                            continue;
                        const authoredLink = value.trim();
                        const matching = links.find(link => link.link === authoredLink && !link.relation);
                        if (matching) {
                            matching.relation = definition.relation;
                            matching.sourceClaimId = sourceClaimId;
                            matching.context = `claims.${sourceClaimId}.${definition.field}: ${authoredLink}`;
                            continue;
                        }
                        const inner = authoredLink.replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|', 1)[0].trim();
                        const marker = inner.lastIndexOf('#^');
                        if (marker < 0)
                            continue;
                        links.push({
                            target: inner.slice(0, marker).trim().replace(/\\/g, '/').toLowerCase(),
                            targetBlockId: inner.slice(marker + 2).trim().toLowerCase(),
                            line: 1,
                            link: authoredLink,
                            context: `claims.${sourceClaimId}.${definition.field}: ${authoredLink}`,
                            relation: definition.relation,
                            sourceClaimId,
                        });
                    }
                }
            }
            return { path: normalized, size: info.size, mtimeMs: info.mtimeMs, links, tags, identityTerms };
        }
        catch {
            return undefined;
        }
    }
    async findNotePaths(directory) {
        const output = [];
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        }
        catch {
            return output;
        }
        for (const entry of entries) {
            const fullPath = join(directory, entry.name);
            const relativePath = normalizePath(relative(this.vaultPath, fullPath));
            if (entry.isDirectory()) {
                if (this.pathFilter.isAllowedForListing(relativePath))
                    output.push(...await this.findNotePaths(fullPath));
            }
            else if (entry.isFile() && this.pathFilter.isAllowedForListing(relativePath)) {
                output.push(relativePath);
            }
        }
        return output.sort((a, b) => a.localeCompare(b));
    }
}
