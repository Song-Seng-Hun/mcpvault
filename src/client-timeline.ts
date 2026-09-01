export interface ClientTimelineCacheOptions<T> {
  maxEntries?: number;
  getId: (item: T) => string;
  getRevision?: (item: T) => string | undefined;
}

export interface ClientTimelineMergeResult<T> {
  /** One current copy for each valid incoming item, in incoming order. */
  items: T[];
  addedIds: string[];
  updatedIds: string[];
  duplicateIds: string[];
}

const DEFAULT_MAX_ENTRIES = 500;

/**
 * Host-side bounded cache for cursor-paginated chat or community timelines.
 * It deduplicates context overlap locally; server authorization and freshness
 * remain authoritative.
 */
export class ClientTimelineCache<T> {
  private readonly entries = new Map<string, T>();
  private readonly maxEntries: number;

  constructor(private readonly options: ClientTimelineCacheOptions<T>) {
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('maxEntries must be a positive integer');
    this.maxEntries = maxEntries;
  }

  merge(items: T[]): ClientTimelineMergeResult<T> {
    const merged: T[] = [];
    const addedIds: string[] = [];
    const updatedIds: string[] = [];
    const duplicateIds: string[] = [];
    for (const item of items) {
      const id = this.idFor(item);
      if (!id) continue;
      const existing = this.entries.get(id);
      if (!existing) {
        this.entries.set(id, cloneItem(item));
        addedIds.push(id);
        merged.push(cloneItem(item));
      } else if (this.isSame(existing, item)) {
        duplicateIds.push(id);
        merged.push(cloneItem(existing));
      } else {
        this.entries.delete(id);
        this.entries.set(id, cloneItem(item));
        updatedIds.push(id);
        merged.push(cloneItem(item));
      }
    }
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    return { items: merged, addedIds, updatedIds, duplicateIds };
  }

  get(id: string): T | undefined {
    const item = this.entries.get(id);
    return item === undefined ? undefined : cloneItem(item);
  }

  values(): T[] {
    return [...this.entries.values()].map(cloneItem);
  }

  size(): number {
    return this.entries.size;
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }

  private idFor(item: T): string {
    return String(this.options.getId(item) || '').trim();
  }

  private isSame(left: T, right: T): boolean {
    const leftRevision = this.options.getRevision?.(left);
    const rightRevision = this.options.getRevision?.(right);
    if (leftRevision !== undefined && rightRevision !== undefined) return leftRevision === rightRevision;
    return JSON.stringify(left) === JSON.stringify(right);
  }
}

function cloneItem<T>(item: T): T {
  if (!item || typeof item !== 'object') return item;
  return { ...(item as Record<string, unknown>) } as T;
}
