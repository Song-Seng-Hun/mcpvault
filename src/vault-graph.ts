import { watch, type FSWatcher } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { BacklinkMatch, OrphanNotesResult, UnresolvedLinksResult, OutlinkMatch } from './types.js';
import { extractWikiLinkOccurrences } from './backlinks.js';
import type { FrontmatterHandler } from './frontmatter.js';
import type { PathFilter } from './pathfilter.js';
import type { VaultFileCatalog, VaultCatalogChangeKind } from './vault-catalog.js';
import { VaultIoCoordinator } from './vault-io.js';

const GRAPH_RECONCILE_INTERVAL_MS = 60_000;
const NO_WATCHER_RECONCILE_INTERVAL_MS = 5_000;
const NOTE_PATTERN = /\.(?:md|markdown|txt)$/i;
const INLINE_TAG_PATTERN = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_\/\-]*)/g;

interface GraphEntry {
  path: string;
  size: number;
  mtimeMs: number;
  links: OutlinkMatch[];
  tags: string[];
}

interface Resolver {
  exact: Map<string, string[]>;
  withoutExtension: Map<string, string[]>;
  basename: Map<string, string[]>;
  basenameWithoutExtension: Map<string, string[]>;
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
  if (paths) paths.push(path);
  else map.set(key, [path]);
}

function buildResolver(paths: string[]): Resolver {
  const resolver: Resolver = {
    exact: new Map(),
    withoutExtension: new Map(),
    basename: new Map(),
    basenameWithoutExtension: new Map(),
  };
  for (const path of paths) {
    const exact = normalizedPath(path);
    const noExtension = withoutExtension(exact);
    addToMap(resolver.exact, exact, path);
    addToMap(resolver.withoutExtension, noExtension, path);
    addToMap(resolver.basename, basename(exact), path);
    addToMap(resolver.basenameWithoutExtension, basename(noExtension), path);
  }
  return resolver;
}

/**
 * Resolve wikilinks using the same matching rules as backlinks.ts, but with
 * maps built once per visibility set instead of scanning every note for every
 * link. This is a derived read model; Markdown remains authoritative.
 */
function resolveTargets(target: string, resolver: Resolver): string[] {
  const normalizedTarget = normalizedPath(target);
  if (!normalizedTarget) return [];
  const hasExtension = /(^|\/)[^/]+\.[^/]+$/.test(normalizedTarget);
  if (hasExtension) {
    return normalizedTarget.includes('/')
      ? resolver.exact.get(normalizedTarget) || []
      : resolver.basename.get(normalizedTarget) || [];
  }
  return normalizedTarget.includes('/')
    ? resolver.withoutExtension.get(normalizedTarget) || []
    : resolver.basenameWithoutExtension.get(normalizedTarget) || [];
}

function normalizeBacklinkTarget(path: string): string {
  return normalizedPath(path).replace(/\.md$/i, '');
}

function backlinkMatches(linkTarget: string, targetPath: string): boolean {
  const target = normalizeBacklinkTarget(targetPath);
  const targetBase = basename(target);
  const document = normalizeBacklinkTarget(linkTarget);
  return document.includes('/') ? document === target : document === targetBase;
}

function addTopMatch<T>(items: T[], item: T, limit: number, compare: (a: T, b: T) => number): void {
  if (items.length < limit) {
    items.push(item);
    return;
  }
  let worst = 0;
  for (let index = 1; index < items.length; index += 1) {
    if (compare(items[index]!, items[worst]!) > 0) worst = index;
  }
  if (compare(item, items[worst]!) < 0) items[worst] = item;
}

/**
 * Incremental Obsidian graph read model for backlinks, tags, unresolved links,
 * and orphan notes. It stores only parsed link/tag metadata and refreshes a
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
  private lastFullRefreshAt = 0;
  private changeGeneration = 0;
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
      this.catalogUnsubscribe = catalog.subscribe((path, kind) => {
        if (path && kind) this.invalidate(path, kind);
        else {
          this.needsFullRefresh = true;
          this.dirty.clear();
        }
      });
    }
  }

  invalidate(path?: string, kind: VaultCatalogChangeKind = 'upsert'): void {
    this.changeGeneration += 1;
    if (!path) {
      this.needsFullRefresh = true;
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

  close(): void {
    this.catalogUnsubscribe?.();
    this.watcher?.close();
    this.watcher = undefined;
    this.dirty.clear();
    this.entries.clear();
    this.allPaths.clear();
  }

  async getBacklinks(path: string, limit: number, canAccessPath: (path: string) => boolean): Promise<{ target: string; backlinks: BacklinkMatch[]; total: number; truncated: boolean }> {
    await this.ensure();
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
    if (!canAccessPath(targetEntry.path)) throw new Error(`Access denied: ${target}`);
    const backlinks: BacklinkMatch[] = [];
    let total = 0;
    const compare = (a: BacklinkMatch, b: BacklinkMatch) => a.path.localeCompare(b.path) || a.line - b.line;
    for (const entry of this.entries.values()) {
      if (normalizedPath(entry.path) === normalizedTarget || !canAccessPath(entry.path)) continue;
      for (const link of entry.links) {
        if (!backlinkMatches(link.target, targetEntry.path)) continue;
        total += 1;
        const backlink: BacklinkMatch = { path: entry.path, line: link.line, link: link.link, context: link.context };
        addTopMatch(backlinks, backlink, limit, compare);
      }
    }
    backlinks.sort(compare);
    return { target, backlinks, total, truncated: total > backlinks.length };
  }

  async findUnresolvedLinks(limit: number, canAccessPath: (path: string) => boolean): Promise<UnresolvedLinksResult> {
    await this.ensure();
    const visiblePaths = [...this.allPaths].filter(canAccessPath).sort((a, b) => a.localeCompare(b));
    const visible = new Set(visiblePaths);
    const resolver = buildResolver(visiblePaths);
    const unresolved: UnresolvedLinksResult['unresolved'] = [];
    let total = 0;
    for (const entry of visiblePaths
      .filter(path => isNote(path))
      .map(path => this.entries.get(path))
      .filter((item): item is GraphEntry => Boolean(item))) {
      for (const link of entry.links) {
        if (resolveTargets(link.target, resolver).some(path => visible.has(path))) continue;
        total += 1;
        if (unresolved.length < limit) unresolved.push({ ...link, path: entry.path });
      }
    }
    return { unresolved, total, truncated: total > unresolved.length };
  }

  async findOrphanNotes(limit: number, canAccessPath: (path: string) => boolean): Promise<OrphanNotesResult> {
    await this.ensure();
    const allVisiblePaths = [...this.allPaths].filter(canAccessPath).sort((a, b) => a.localeCompare(b));
    const notePaths = [...this.entries.keys()].filter(path => canAccessPath(path) && isNote(path)).sort((a, b) => a.localeCompare(b));
    const visible = new Set(notePaths);
    const resolver = buildResolver(allVisiblePaths);
    const incomingCounts = new Map(notePaths.map(path => [normalizedPath(path), 0]));
    for (const source of notePaths) {
      const entry = this.entries.get(source);
      if (!entry) continue;
      for (const link of entry.links) {
        for (const destination of resolveTargets(link.target, resolver)) {
          if (normalizedPath(destination) !== normalizedPath(source) && visible.has(destination)) {
            const key = normalizedPath(destination);
            incomingCounts.set(key, (incomingCounts.get(key) || 0) + 1);
          }
        }
      }
    }
    const orphans = notePaths
      .filter(path => incomingCounts.get(normalizedPath(path)) === 0)
      .map(path => ({ path, incomingLinks: 0 }));
    return { orphans: orphans.slice(0, limit), total: orphans.length, truncated: orphans.length > limit };
  }

  async listAllTags(canAccessPath: (path: string) => boolean): Promise<Array<{ tag: string; count: number }>> {
    await this.ensure();
    const counts = new Map<string, number>();
    for (const entry of this.entries.values()) {
      if (!canAccessPath(entry.path)) continue;
      for (const tag of entry.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  private async ensure(): Promise<void> {
    this.startWatcher();
    if (this.refreshPromise) await this.refreshPromise;
    const interval = this.watcher ? GRAPH_RECONCILE_INTERVAL_MS : NO_WATCHER_RECONCILE_INTERVAL_MS;
    if (!this.initialized || this.needsFullRefresh || Date.now() - this.lastFullRefreshAt >= interval) await this.refreshAll();
    if (this.dirty.size > 0) await this.refreshDirty();
  }

  private startWatcher(): void {
    if (this.catalog || this.watcherStarted) return;
    this.watcherStarted = true;
    try {
      this.watcher = watch(this.vaultPath, { recursive: true }, (_event, filename) => {
        const path = filename ? normalizePath(String(filename)) : '';
        if (path && isNote(path) && this.pathFilter.isAllowed(path)) this.dirty.add(path);
        else this.needsFullRefresh = true;
      });
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = undefined;
        this.needsFullRefresh = true;
      });
      this.watcher.unref?.();
    } catch {
      this.watcher = undefined;
    }
  }

  private async refreshAll(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const generation = this.changeGeneration;
      const paths = this.catalog
        ? await this.catalog.listAllPaths()
        : await this.findNotePaths(this.vaultPath);
      this.allPaths = new Set(paths.filter(path => this.pathFilter.isAllowedForListing(path)));
      const next = new Map<string, GraphEntry>();
      for (let start = 0; start < paths.length; start += 16) {
        const batch = paths.slice(start, start + 16);
      const entries = await Promise.all(batch.map(path => this.readEntry(path, this.entries.get(path))));
        for (const entry of entries) if (entry) next.set(entry.path, entry);
      }
      this.entries.clear();
      for (const [path, entry] of next) this.entries.set(path, entry);
      if (generation === this.changeGeneration) this.dirty.clear();
      this.needsFullRefresh = false;
      this.initialized = true;
      this.lastFullRefreshAt = Date.now();
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
      const paths = [...this.dirty];
      this.dirty.clear();
      const entries = await Promise.all(paths.map(path => this.readEntry(path)));
      for (let index = 0; index < paths.length; index += 1) {
        const path = paths[index]!;
        const entry = entries[index];
        if (entry) this.entries.set(path, entry);
        else this.entries.delete(path);
      }
    })();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async readEntry(path: string, existing?: GraphEntry): Promise<GraphEntry | undefined> {
    const normalized = normalizePath(path);
    if (!isNote(normalized) || !this.pathFilter.isAllowed(normalized)) return undefined;
    try {
      const fullPath = join(this.vaultPath, normalized);
      const info = await stat(fullPath);
      if (!info.isFile()) return undefined;
      if (existing && existing.size === info.size && existing.mtimeMs === info.mtimeMs) return existing;
      const raw = await this.vaultIo.readUtf8(fullPath);
      const parsed = this.frontmatter.parse(raw);
      const tags: string[] = [];
      if (Array.isArray(parsed.frontmatter.tags)) {
        for (const tag of parsed.frontmatter.tags) {
          if (typeof tag === 'string' && tag.trim()) tags.push(tag.trim().toLowerCase());
        }
      }
      INLINE_TAG_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = INLINE_TAG_PATTERN.exec(parsed.content)) !== null) tags.push(match[1]!.toLowerCase());
      return { path: normalized, size: info.size, mtimeMs: info.mtimeMs, links: extractWikiLinkOccurrences(raw), tags };
    } catch {
      return undefined;
    }
  }

  private async findNotePaths(directory: string): Promise<string[]> {
    const output: string[] = [];
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return output;
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
