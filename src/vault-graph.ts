import { watch, type FSWatcher } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, posix, relative, resolve } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { BacklinkMatch, BacklinksResult, OrphanNotesResult, UnresolvedLinksResult, OutlinkMatch } from './types.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import type { FrontmatterHandler } from './frontmatter.js';
import type { PathFilter } from './pathfilter.js';
import type { VaultCatalogChange, VaultFileCatalog, VaultCatalogChangeKind } from './vault-catalog.js';
import { VaultIoCoordinator } from './vault-io.js';
import { isMissingVaultPath, VaultReadUnavailableError } from './vault-read-errors.js';
import { RELATION_FIELDS } from './organization.js';
import { markdownNotePath, noteReferenceDocument, noteReferenceTermKeys } from './note-reference.js';
import { collectPlainFrontmatterReferences, isNavigationalFrontmatterReference } from './property-references.js';
import { isModerationHidden } from './moderation-policy.js';
import { extractInlineTags } from './markdown-tags.js';
import { SourceReadLimitError } from './bounded-source-read.js';
import { NavigationViewFingerprint } from './navigation-view.js';
import { createGraphLinkProjector } from './graph-link-projection.js';
import { createBoundedTopK } from './search-limits.js';

const GRAPH_RECONCILE_INTERVAL_MS = 60_000;
const NO_WATCHER_RECONCILE_INTERVAL_MS = 5_000;
const GRAPH_CONTENT_AUDIT_INTERVAL_MS = 15 * 60_000;
const REVERSE_LINK_CACHE_LIMIT = 16_384;
const NOTE_PATTERN = /\.(?:md|markdown|txt)$/i;
const GRAPH_READ_BATCH_SIZE = 16;
const GRAPH_SOURCE_MAX_BYTES = 8 * 1024 * 1024;

interface GraphEntry {
  path: string;
  moderationHidden: boolean;
  revision: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  links: OutlinkMatch[];
  tags: string[];
  identityTerms: string[];
}

interface Resolver {
  exact: Map<string, string[]>;
  withoutExtension: Map<string, string[]>;
  basename: Map<string, string[]>;
  basenameWithoutExtension: Map<string, string[]>;
  identity: Map<string, string[]>;
}

interface VisibilityContext {
  generation: number;
  paths: string[];
  pathSet: Set<string>;
  resolver: Resolver;
  incoming?: Map<string, Array<{ entry: GraphEntry; link: OutlinkMatch }>>;
  incomingOverflow?: boolean;
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function normalizedPath(value: string): string {
  return normalizePath(value).toLowerCase();
}

function isNote(path: string): boolean {
  return NOTE_PATTERN.test(path);
}

function withoutExtension(path: string): string {
  return path.replace(/\.[^/.]+$/, '');
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function addToMap(map: Map<string, string[]>, key: string, path: string): void {
  const paths = map.get(key);
  if (paths) {
    if (!paths.includes(path)) paths.push(path);
  }
  else map.set(key, [path]);
}

function buildResolver(paths: string[], entries?: ReadonlyMap<string, GraphEntry>): Resolver {
  const resolver: Resolver = {
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
      for (const normalizedTerm of noteReferenceTermKeys(term)) addToMap(resolver.identity, normalizedTerm, path);
    }
  }
  return resolver;
}

/**
 * Resolve wikilinks using the same matching rules as backlinks.ts, but with
 * maps built once per visibility set instead of scanning every note for every
 * link. This is a derived read model; Markdown remains authoritative.
 */
function resolveTargets(target: string, resolver: Resolver, sourcePath?: string, authoredLink?: string): string[] {
  if (authoredLink && /^\[[^\]]*\]\(/.test(authoredLink)) {
    const path = markdownNotePath(target, sourcePath || '');
    if (!path) return [];
    const normalized = normalizedPath(path);
    return /(^|\/)[^/]+\.[^/]+$/.test(normalized)
      ? resolver.exact.get(normalized) || []
      : resolver.withoutExtension.get(normalized) || [];
  }
  const normalizedTarget = normalizedPath(target);
  if (!normalizedTarget) return [];
  const hasExtension = /(^|\/)[^/]+\.[^/]+$/.test(normalizedTarget);
  if (sourcePath && /^(?:\.\.?\/)/.test(normalizedTarget)) {
    const relativeTarget = normalizedPath(posix.normalize(posix.join(posix.dirname(normalizePath(sourcePath)), normalizedTarget)));
    const relativeMatches = hasExtension
      ? resolver.exact.get(relativeTarget) || []
      : resolver.withoutExtension.get(withoutExtension(relativeTarget)) || [];
    if (relativeMatches.length > 0) return relativeMatches;
  }
  let pathMatches: string[];
  if (hasExtension) {
    pathMatches = normalizedTarget.includes('/')
      ? resolver.exact.get(normalizedTarget) || []
      : resolver.basename.get(normalizedTarget) || [];
  } else {
    pathMatches = normalizedTarget.includes('/')
      ? resolver.withoutExtension.get(normalizedTarget) || []
      : resolver.basenameWithoutExtension.get(normalizedTarget) || [];
  }
  if (pathMatches.length > 0) return pathMatches;
  // A written note suffix names a file, not an alias to a differently named note.
  if (/\.(?:md|markdown|txt)$/i.test(normalizedTarget)) return [];
  for (const identityKey of noteReferenceTermKeys(normalizedTarget)) {
    const identityMatches = resolver.identity.get(identityKey);
    if (identityMatches?.length) return identityMatches;
  }
  return [];
}

/**
 * Incremental Obsidian graph read model for backlinks, tags, unresolved links,
 * and orphan notes. It stores only parsed link/tag/identity metadata and refreshes a
 * changed note, rather than rereading the entire vault for every request.
 */
export class VaultGraphIndex {
  private readonly vaultPath: string;
  private readonly entries = new Map<string, GraphEntry>();
  private allPaths = new Set<string>();
  private readonly dirty = new Set<string>();
  private refreshPromise: Promise<void> | undefined;
  private watcher: FSWatcher | undefined;
  private watcherStarted = false;
  private initialized = false;
  private needsFullRefresh = true;
  private forceFullRead = true;
  private lastFullRefreshAt = 0;
  private lastContentAuditAt = 0;
  private changeGeneration = 0;
  private readonly visibilityCache = new WeakMap<(path: string) => boolean, VisibilityContext>();
  private readonly catalogUnsubscribe: (() => void) | undefined;

  constructor(
    vaultPath: string,
    private readonly pathFilter: PathFilter,
    private readonly frontmatter: FrontmatterHandler,
    private readonly catalog?: VaultFileCatalog,
    private readonly vaultIo = new VaultIoCoordinator(),
  ) {
    this.vaultPath = resolve(vaultPath);
    if (catalog) {
      this.catalogUnsubscribe = catalog.subscribeBatch(changes => {
        if (changes) this.invalidateMany(changes);
        else this.invalidate();
      });
    }
  }

  invalidate(path?: string, kind: VaultCatalogChangeKind = 'upsert'): void {
    this.changeGeneration += 1;
    if (!path) {
      this.needsFullRefresh = true;
      this.forceFullRead = true;
      this.dirty.clear();
      return;
    }
    const normalized = normalizePath(path);
    if (!this.pathFilter.isAllowedForListing(normalized)) return;
    if (kind === 'delete') {
      this.entries.delete(normalized);
      this.allPaths.delete(normalized);
    } else {
      this.allPaths.add(normalized);
    }
    if (isNote(normalized) || this.pathFilter.isAllowed(normalized)) this.dirty.add(normalized);
  }

  invalidateMany(changes: readonly VaultCatalogChange[]): void {
    this.changeGeneration += 1;
    for (const change of changes) {
      const normalized = normalizePath(change.path);
      if (!this.pathFilter.isAllowedForListing(normalized)) continue;
      if (change.kind === 'delete') {
        this.entries.delete(normalized);
        this.allPaths.delete(normalized);
      } else {
        this.allPaths.add(normalized);
      }
      if (isNote(normalized) || this.pathFilter.isAllowed(normalized)) this.dirty.add(normalized);
    }
  }

  close(): void {
    this.catalogUnsubscribe?.();
    this.watcher?.close();
    this.watcher = undefined;
    this.dirty.clear();
    this.entries.clear();
    this.allPaths.clear();
  }

  /** Keep caller-side asynchronous source validation inside the same view. */
  async withStableRead<T>(canAccessPath: (path: string) => boolean, read: () => Promise<T>): Promise<T> {
    await this.ensure();
    const generation = this.changeGeneration;
    const visible = this.visibilityContext(canAccessPath);
    const result = await read();
    if (this.changeGeneration !== generation || this.visibilityContext(canAccessPath) !== visible) {
      throw new Error('Graph changed or visibility changed during validation; retry the query. No stable graph view was returned.');
    }
    return result;
  }

  async getBacklinks(path: string, limit: number, canAccessPath: (path: string) => boolean, offset = 0, canIncludeSource?: (path: string, revision: string) => Promise<boolean>, includeSourceRevision = false, includeSnapshot = false, validateTargets?: (targets: ReadonlyMap<string, string>) => Promise<void>): Promise<BacklinksResult> {
    await this.ensure();
    const startGeneration = this.changeGeneration;
    const target = normalizePath(path);
    const normalizedTarget = normalizedPath(target);
    let targetEntry: GraphEntry | undefined;
    for (const entry of this.entries.values()) {
      if (normalizedPath(entry.path) === normalizedTarget) {
        targetEntry = entry;
        break;
      }
    }
    if (!targetEntry) throw new Error(`File not found: ${target}`);
    if (!canAccessPath(targetEntry.path) || targetEntry.moderationHidden) throw new Error(`Access denied: ${target}`);
    const snapshot = includeSnapshot ? new NavigationViewFingerprint(['backlinks', targetEntry.path, targetEntry.revision]) : undefined;
    const visible = this.visibilityContext(canAccessPath);
    const allResolver = buildResolver([...this.allPaths], this.entries);
    const project = this.linkProjector(visible.resolver, allResolver);
    const validationResolver = validateTargets ? this.targetValidationResolver(visible, canAccessPath) : visible.resolver;
    const contexts = new Map<GraphEntry, { lines: Set<number>; headings: Set<string> }>();
    const sourceEntries = new Map<string, GraphEntry>();
    let total = 0;
    const compare = (a: BacklinkMatch, b: BacklinkMatch) => a.path.localeCompare(b.path) || a.line - b.line;
    // Encounter order makes same-line ties stable across heap selection/pages.
    const backlinks = createBoundedTopK<{ link: BacklinkMatch; order: number }>(offset + limit,
      (a, b) => compare(a.link, b.link) || a.order - b.order);
    const incoming = this.incomingBacklinks(visible);
    const edges = incoming ? incoming.get(normalizedTarget) || [] : this.matchingBacklinks(visible, normalizedTarget);
    const checkedSources = new Map<string, boolean>();
    for (const { entry, link } of edges) {
        if (normalizedPath(entry.path) === normalizedTarget) continue;
        // Check each matching author once, before counts and pagination. The
        // filesystem supplies a fresh, path-guarded moderation check so a
        // stale graph entry cannot disclose a newly hidden author's links.
        if (!checkedSources.has(entry.path)) {
          checkedSources.set(entry.path, canAccessPath(entry.path) && (!canIncludeSource || await canIncludeSource(entry.path, entry.revision)));
        }
        if (!checkedSources.get(entry.path)) continue;
        sourceEntries.set(entry.path, entry);
        if (validateTargets) {
          let context = contexts.get(entry);
          if (!context) { context = { lines: new Set(), headings: new Set() }; contexts.set(entry, context); }
          context.lines.add(link.line);
          if (link.heading) context.headings.add(link.heading);
        }
        total += 1;
        const backlink: BacklinkMatch = {
          path: entry.path,
          ...(includeSourceRevision && { sourceRevision: entry.revision }),
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
        snapshot?.add(entry.path, entry.revision, project(entry, backlink));
        backlinks.add({ link: backlink, order: total });
    }
    if (validateTargets) {
      const targets = new Map<string, string>();
      for (const [entry, context] of contexts) {
        const collect = (link: { target: string; link: string }) => {
          if (/^scope:\/\/(?:model|agent|user)\//i.test(link.target.trim())) return;
          for (const resolver of new Set([allResolver, visible.resolver, validationResolver])) {
            for (const path of resolveTargets(link.target, resolver, entry.path, link.link)) {
              const candidate = this.entries.get(path);
              if (candidate && path !== entry.path && path !== targetEntry!.path && canAccessPath(path)) targets.set(path, candidate.revision);
            }
          }
        };
        // Match the projector's physical-line dependencies, including clipped
        // references. Do not hash links in unrelated sections of the author.
        for (const link of entry.links) if (context.lines.has(link.line)) collect(link);
        for (const heading of context.headings) for (const link of extractObsidianLinkOccurrences(heading)) collect(link);
      }
      await validateTargets(targets);
    }
    if (this.changeGeneration !== startGeneration || this.visibilityContext(canAccessPath) !== visible) {
      throw new Error('Graph changed or visibility changed during navigation; retry the query. No stable navigation view was returned.');
    }
    const page = backlinks.values().slice(offset, offset + limit).map(({ link }) => project(sourceEntries.get(link.path)!, link));
    return { target, ...(includeSourceRevision && { targetRevision: targetEntry.revision }), ...(snapshot && { snapshotFingerprint: snapshot.finish() }), backlinks: page, total, truncated: total > offset + page.length };
  }

  async getOutlinks(path: string, limit: number, canAccessPath: (path: string) => boolean, offset = 0, includeSourceRevision = false, includeSnapshot = false, validateTargets?: (targets: ReadonlyMap<string, string>) => Promise<void>): Promise<{ source: string; sourceRevision?: string; snapshotFingerprint?: string; outlinks: OutlinkMatch[]; total: number; truncated: boolean }> {
    await this.ensure();
    const startGeneration = this.changeGeneration;
    const source = normalizePath(path);
    const entry = this.entries.get(source);
    if (!entry) throw new Error(`File not found: ${source}`);
    if (!canAccessPath(source) || entry.moderationHidden) throw new Error(`Access denied: ${source}`);

    const visible = this.visibilityContext(canAccessPath);
    const allResolver = buildResolver([...this.allPaths], this.entries);
    const project = this.linkProjector(visible.resolver, allResolver);
    const validationResolver = validateTargets ? this.targetValidationResolver(visible, canAccessPath) : visible.resolver;
    const targetRevisions = new Map<string, string>();
    const outlinks: OutlinkMatch[] = [];
    const snapshot = includeSnapshot ? new NavigationViewFingerprint(['outlinks', source, entry.revision]) : undefined;
    let total = 0;
    for (const link of entry.links) {
      if (/^scope:\/\/(?:model|agent|user)\//i.test(link.target.trim())) continue;
      const anyMatches = resolveTargets(link.target, allResolver, entry.path, link.link);
      const visibleMatches = resolveTargets(link.target, visible.resolver, entry.path, link.link);
      const validationMatches = validationResolver === visible.resolver ? visibleMatches
        : resolveTargets(link.target, validationResolver, entry.path, link.link);
      if (validateTargets) for (const path of [...anyMatches, ...visibleMatches, ...validationMatches]) {
        // Include cached moderation-hidden matches so newly unhidden notes
        // can be refreshed too, but never read another caller's scope.
        const target = this.entries.get(path);
        if (target && path !== source && canAccessPath(path)) targetRevisions.set(path, target.revision);
      }
      if (anyMatches.length > 0 && visibleMatches.length === 0) continue;
      total += 1;
      snapshot?.add(source, entry.revision, project(entry, link));
      if (total > offset && outlinks.length < limit) outlinks.push(link);
    }
    if (validateTargets) await validateTargets(targetRevisions);
    if (this.changeGeneration !== startGeneration || this.visibilityContext(canAccessPath) !== visible) {
      throw new Error('Graph changed or visibility changed during navigation; retry the query. No stable navigation view was returned.');
    }
    return {
      source,
      ...(includeSourceRevision && { sourceRevision: entry.revision }),
      ...(snapshot && { snapshotFingerprint: snapshot.finish() }),
      outlinks: outlinks.map(link => project(entry, link)),
      total,
      truncated: total > offset + limit,
    };
  }

  private targetValidationResolver(visible: VisibilityContext, canAccessPath: (path: string) => boolean): Resolver {
    const hiddenPaths: string[] = [];
    for (const candidate of this.entries.values()) {
      if (candidate.moderationHidden && this.allPaths.has(candidate.path) && canAccessPath(candidate.path)) hiddenPaths.push(candidate.path);
    }
    // Exclude other scopes' shadowing names, but include authorized cached
    // hidden aliases so an unhide can be discovered before the next census.
    return hiddenPaths.length ? buildResolver([...visible.paths, ...hiddenPaths], this.entries) : visible.resolver;
  }

  async findUnresolvedLinks(limit: number, canAccessPath: (path: string) => boolean, offset = 0, includeSnapshot = false): Promise<UnresolvedLinksResult> {
    await this.ensure();
    const { paths: visiblePaths, pathSet: visible, resolver } = this.visibilityContext(canAccessPath);
    const allResolver = buildResolver([...this.allPaths], this.entries);
    const project = this.linkProjector(resolver, allResolver);
    const unresolved: UnresolvedLinksResult['unresolved'] = [];
    const snapshot = includeSnapshot ? new NavigationViewFingerprint(['unresolved']) : undefined;
    let total = 0;
    for (const path of visiblePaths) {
      if (!isNote(path)) continue;
      const entry = this.entries.get(path);
      if (!entry) continue;
      for (const link of entry.links) {
        if (/^scope:\/\/(?:model|agent|user)\//i.test(link.target.trim())) continue;
        if (resolveTargets(link.target, resolver, entry.path, link.link).some(path => visible.has(path))) continue;
        // A known invisible target is not an actionable broken-link repair.
        // Never return its resolution candidates or count its hidden edges.
        if (resolveTargets(link.target, allResolver, entry.path, link.link).length > 0) continue;
        total += 1;
        snapshot?.add(entry.path, entry.revision, project(entry, link));
        if (total > offset && unresolved.length < limit) unresolved.push({ ...project(entry, link), path: entry.path });
      }
    }
    return { unresolved, ...(snapshot && { snapshotFingerprint: snapshot.finish() }), total, truncated: total > offset + unresolved.length };
  }

  async findOrphanNotes(limit: number, canAccessPath: (path: string) => boolean, offset = 0, includeSnapshot = false): Promise<OrphanNotesResult> {
    await this.ensure();
    const { paths: allVisiblePaths, resolver } = this.visibilityContext(canAccessPath);
    const notePaths = allVisiblePaths.filter(isNote);
    const visible = new Set(notePaths);
    const incoming = new Set<string>();
    for (const source of notePaths) {
      const entry = this.entries.get(source);
      if (!entry) continue;
      for (const link of entry.links) {
        for (const destination of resolveTargets(link.target, resolver, entry.path, link.link)) {
          if (normalizedPath(destination) !== normalizedPath(source) && visible.has(destination)) {
            incoming.add(normalizedPath(destination));
          }
        }
      }
    }
    const orphans: OrphanNotesResult['orphans'] = [];
    const snapshot = includeSnapshot ? new NavigationViewFingerprint(['orphans']) : undefined;
    let total = 0;
    // visibilityContext already sorts paths using the same locale comparator.
    for (const path of notePaths) {
      if (incoming.has(normalizedPath(path))) continue;
      total += 1;
      const row = { path, incomingLinks: 0 };
      snapshot?.add(path, this.entries.get(path)!.revision, row);
      if (total > offset && orphans.length < limit) orphans.push(row);
    }
    return { orphans, ...(snapshot && { snapshotFingerprint: snapshot.finish() }), total, truncated: total > offset + limit };
  }

  async listAllTags(canAccessPath: (path: string) => boolean): Promise<Array<{ tag: string; count: number }>> {
    await this.ensure();
    const counts = new Map<string, number>();
    for (const entry of this.entries.values()) {
      if (!canAccessPath(entry.path) || entry.moderationHidden) continue;
      for (const tag of entry.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  }

  private async ensure(): Promise<void> {
    await this.catalog?.flushPendingEvents();
    this.startWatcher();
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.refreshPromise) await this.refreshPromise;
      const interval = this.watcher ? GRAPH_RECONCILE_INTERVAL_MS : NO_WATCHER_RECONCILE_INTERVAL_MS;
      const auditContent = this.initialized && Date.now() - this.lastContentAuditAt >= GRAPH_CONTENT_AUDIT_INTERVAL_MS;
      if (!this.initialized || this.needsFullRefresh || auditContent || Date.now() - this.lastFullRefreshAt >= interval) await this.refreshAll(auditContent);
      else if (this.dirty.size > 0) await this.refreshDirty();
      // A shared catalog may still be debouncing events received during IO.
      await this.catalog?.flushPendingEvents();
      if (this.initialized && !this.needsFullRefresh && this.dirty.size === 0) return;
    }
    throw new Error('Graph changed during refresh; retry the query. No stable graph view was returned.');
  }

  /** Caller-local excerpts; never mutate shared source edges or headings. */
  private linkProjector(visible: Resolver, all: Resolver) {
    const invisible = (target: string, source: string, link: string) => /^scope:\/\/(?:model|agent|user)\//i.test(target.trim())
      || (resolveTargets(target, all, source, link).length > 0 && resolveTargets(target, visible, source, link).length === 0);
    return createGraphLinkProjector(invisible);
  }

  private visibilityContext(canAccessPath: (path: string) => boolean): VisibilityContext {
    const cached = this.visibilityCache.get(canAccessPath);
    // Predicate identity is not an authorization snapshot: its closure may
    // have changed without a filesystem event. Recheck membership, but retain
    // the resolver and incoming-edge cache when the visible set is unchanged.
    const paths = [...this.allPaths].filter(path => canAccessPath(path)
      && (!isNote(path) || (this.entries.has(path) && !this.entries.get(path)!.moderationHidden)));
    if (cached && cached.generation === this.changeGeneration
      && paths.length === cached.pathSet.size && paths.every(path => cached.pathSet.has(path))) return cached;
    paths.sort((a, b) => a.localeCompare(b));
    const context: VisibilityContext = {
      generation: this.changeGeneration,
      paths,
      pathSet: new Set(paths),
      resolver: buildResolver(paths, this.entries),
    };
    this.visibilityCache.set(canAccessPath, context);
    return context;
  }

  /** Lazily reuse resolved edges only within this predicate/generation view. */
  private incomingBacklinks(visible: VisibilityContext) {
    if (visible.incoming || visible.incomingOverflow) return visible.incoming;
    const incoming = new Map<string, Array<{ entry: GraphEntry; link: OutlinkMatch }>>();
    let count = 0;
    for (const entry of this.entries.values()) {
      if (!visible.pathSet.has(entry.path)) continue;
      for (const link of entry.links) {
        const targets = new Set(resolveTargets(link.target, visible.resolver, entry.path, link.link).map(normalizedPath));
        for (const target of targets) {
          // Dense/ambiguous graphs must not create an unbounded second index.
          // Fall back to the original scan, never a partial cached answer.
          if (++count > REVERSE_LINK_CACHE_LIMIT) {
            visible.incomingOverflow = true;
            return undefined;
          }
          const edges = incoming.get(target) || [];
          edges.push({ entry, link });
          incoming.set(target, edges);
        }
      }
    }
    visible.incoming = incoming;
    return incoming;
  }

  private *matchingBacklinks(visible: VisibilityContext, target: string) {
    for (const entry of this.entries.values()) {
      if (!visible.pathSet.has(entry.path)) continue;
      for (const link of entry.links) {
        if (resolveTargets(link.target, visible.resolver, entry.path, link.link).some(path => normalizedPath(path) === target)) yield { entry, link };
      }
    }
  }

  private startWatcher(): void {
    if (this.catalog || this.watcherStarted) return;
    this.watcherStarted = true;
    try {
      this.watcher = watch(this.vaultPath, { recursive: true }, (_event, filename) => {
        const path = filename ? normalizePath(String(filename)) : '';
        if (path && !this.pathFilter.isAllowedForListing(path)) return;
        if (path && isNote(path) && this.pathFilter.isAllowed(path)) this.invalidate(path);
        else this.invalidate();
      });
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = undefined;
        this.invalidate();
      });
      this.watcher.unref?.();
    } catch {
      this.watcher = undefined;
    }
  }

  private async refreshAll(auditContent = false): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const generation = this.changeGeneration;
      const verifyContent = auditContent || this.forceFullRead || !this.initialized;
      const paths = this.catalog
        ? await this.catalog.allPathsSnapshot()
        : await this.findNotePaths(this.vaultPath);
      const nextPaths = new Set(paths.filter(path => this.pathFilter.isAllowedForListing(path)));
      const next = new Map<string, GraphEntry>();
      for (let start = 0; start < paths.length; start += GRAPH_READ_BATCH_SIZE) {
        const batch = paths.slice(start, start + GRAPH_READ_BATCH_SIZE);
        const entries = await this.readBatch(batch, true, verifyContent);
        for (const entry of entries) if (entry) next.set(entry.path, entry);
        if (generation !== this.changeGeneration) {
          this.needsFullRefresh = true;
          return;
        }
      }
      if (generation !== this.changeGeneration) { this.needsFullRefresh = true; return; }
      this.allPaths = nextPaths;
      this.entries.clear();
      for (const [path, entry] of next) this.entries.set(path, entry);
      this.changeGeneration += 1;
      this.dirty.clear();
      this.needsFullRefresh = false;
      this.forceFullRead = false;
      this.initialized = true;
      this.lastFullRefreshAt = Date.now();
      if (verifyContent) this.lastContentAuditAt = this.lastFullRefreshAt;
    })();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async refreshDirty(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const generation = this.changeGeneration;
      const paths = [...this.dirty];
      this.dirty.clear();
      const entries: Array<GraphEntry | undefined> = [];
      try {
        for (let start = 0; start < paths.length; start += GRAPH_READ_BATCH_SIZE) {
          entries.push(...await this.readBatch(paths.slice(start, start + GRAPH_READ_BATCH_SIZE)));
          if (generation !== this.changeGeneration) {
            for (const path of paths) this.dirty.add(path);
            return;
          }
        }
      } catch (error) {
        for (const path of paths) this.dirty.add(path);
        throw error;
      }
      for (let index = 0; index < paths.length; index += 1) {
        const path = paths[index]!;
        const entry = entries[index];
        if (entry) { this.entries.set(path, entry); this.allPaths.add(path); }
        else {
          this.entries.delete(path);
          if (isNote(path)) this.allPaths.delete(path);
        }
      }
      this.changeGeneration += 1;
    })();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async readBatch(paths: string[], reuseExisting = false, verifyContent = false): Promise<Array<GraphEntry | undefined>> {
    // Drain a failed batch before allowing another refresh to share its reads.
    const results = await Promise.allSettled(paths.map(path => this.readEntry(path,
      reuseExisting && !this.forceFullRead && !this.dirty.has(path) ? this.entries.get(path) : undefined, verifyContent)));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    return results.map(result => result.status === 'fulfilled' ? result.value : undefined);
  }

  private async readEntry(path: string, existing?: GraphEntry, verifyContent = false): Promise<GraphEntry | undefined> {
    const normalized = normalizePath(path);
    if (!isNote(normalized) || !this.pathFilter.isAllowed(normalized)) return undefined;
    try {
      const fullPath = join(this.vaultPath, normalized);
      const info = await stat(fullPath);
      if (!info.isFile()) return undefined;
      // Sync tools can preserve size and mtime while replacing the contents.
      // ctime lets periodic reconciliation detect those missed watcher edits
      // without reading every unchanged body. This remains a stat heuristic,
      // not a content proof on filesystems that preserve all three values.
      // The independent content audit bypasses this shortcut periodically.
      if (existing && !verifyContent && existing.size === info.size && existing.mtimeMs === info.mtimeMs
        && existing.ctimeMs === info.ctimeMs) return existing;
      const raw = await this.vaultIo.readUtf8Bounded(fullPath, GRAPH_SOURCE_MAX_BYTES);
      const revision = createHash('sha256').update(raw).digest('hex');
      if (existing && existing.revision === revision) {
        return { ...existing, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs };
      }
      const parsed = this.frontmatter.parse(raw);
      const tags: string[] = [];
      const identityTerms: string[] = [];
      for (const field of ['title', 'preferred_term', 'stable_id'] as const) {
        const value = parsed.frontmatter[field];
        if (typeof value === 'string' && value.trim()) identityTerms.push(value.trim());
      }
      const aliases = Array.isArray(parsed.frontmatter.aliases)
        ? parsed.frontmatter.aliases
        : typeof parsed.frontmatter.aliases === 'string'
          ? [parsed.frontmatter.aliases]
          : [];
      for (const alias of aliases) {
        if (typeof alias === 'string' && alias.trim()) identityTerms.push(alias.trim());
      }
      if (Array.isArray(parsed.frontmatter.tags)) {
        for (const tag of parsed.frontmatter.tags) {
          if (typeof tag === 'string' && tag.trim()) tags.push(tag.trim().toLowerCase());
        }
      }
      tags.push(...extractInlineTags(parsed.content).map(tag => tag.toLowerCase()));
      const links = extractObsidianLinkOccurrences(raw);
      for (const relation of RELATION_FIELDS) {
        const values = Array.isArray(parsed.frontmatter[relation]) ? parsed.frontmatter[relation] : [];
        for (let relationIndex = 0; relationIndex < values.length; relationIndex += 1) {
          const value = values[relationIndex];
          if (typeof value !== 'string' || !value.trim()) continue;
          const target = value.trim();
          const normalizedTarget = target.replace(/^!?\[\[/, '').replace(/\]\]$/, '').split(/[|#]/, 1)[0]!.trim().replace(/\\/g, '/').toLowerCase();
          const propertyPath = `${relation}[${relationIndex}]`;
          const existing = links.find(link => link.link === target && !link.relation);
          if (existing) {
            existing.relation = relation;
            existing.context = `${relation}: ${target}`;
            existing.propertyPath = propertyPath;
          } else {
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
        if (!isNavigationalFrontmatterReference(reference)) continue;
        if (RELATION_FIELDS.includes(reference.root as typeof RELATION_FIELDS[number])) continue;
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
      ] as const;
      for (let claimIndex = 0; claimIndex < claims.length; claimIndex += 1) {
        const claim = claims[claimIndex];
        if (!claim || typeof claim !== 'object') continue;
        const sourceClaimId = String((claim as any).id || `claim-${claimIndex + 1}`).trim().toLowerCase();
        if (!sourceClaimId) continue;
        for (const definition of claimRelations) {
          const values = Array.isArray((claim as any)[definition.field]) ? (claim as any)[definition.field] : [];
          for (const value of values.slice(0, 20)) {
            if (typeof value !== 'string' || !value.trim()) continue;
            const authoredLink = value.trim();
            const matching = links.find(link => link.link === authoredLink && !link.relation);
            if (matching) {
              matching.relation = definition.relation;
              matching.sourceClaimId = sourceClaimId;
              matching.context = `claims.${sourceClaimId}.${definition.field}: ${authoredLink}`;
              continue;
            }
            const inner = authoredLink.replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|', 1)[0]!.trim();
            const marker = inner.lastIndexOf('#^');
            if (marker < 0) continue;
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
      return { path: normalized, moderationHidden: isModerationHidden(parsed.frontmatter), revision, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, links, tags, identityTerms };
    } catch (error) {
      if (isMissingVaultPath(error)) return undefined;
      if (error instanceof SourceReadLimitError) throw new Error('Graph source exceeds the 8 MiB read limit; split oversized notes before retrying. No partial graph view was returned.');
      throw new VaultReadUnavailableError();
    }
  }

  private async findNotePaths(directory: string): Promise<string[]> {
    const output: string[] = [];
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (directory !== this.vaultPath && isMissingVaultPath(error)) return output;
      throw new VaultReadUnavailableError();
    }
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      const relativePath = normalizePath(relative(this.vaultPath, fullPath));
      if (entry.isDirectory()) {
        if (this.pathFilter.isAllowedForListing(relativePath)) output.push(...await this.findNotePaths(fullPath));
      } else if (entry.isFile() && this.pathFilter.isAllowedForListing(relativePath)) {
        output.push(relativePath);
      }
    }
    return output.sort((a, b) => a.localeCompare(b));
  }
}
