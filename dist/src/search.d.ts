import type { PathFilter } from './pathfilter.js';
import type { SearchParams, SearchResult } from './types.js';
import type { VaultFileCatalog } from './vault-catalog.js';
import { VaultIoCoordinator } from './vault-io.js';
export declare class SearchService {
    private pathFilter;
    private readonly catalog?;
    private readonly vaultIo;
    private readonly cacheOwner;
    private readonly directoryCacheOwner;
    private vaultPath;
    private readonly cache;
    private readonly inFlight;
    private readonly documents;
    private readonly documentsById;
    private readonly dirtyDocuments;
    private readonly postings;
    private readonly gramIds;
    private readonly gramsById;
    private readonly pathDocuments;
    private readonly documentPathKeys;
    private readonly corpusStatsCache;
    private readonly directoryCache;
    private nextDocumentId;
    private indexedTextBytes;
    private cacheGeneration;
    private indexReady;
    private readonly snapshotReady;
    private indexRefresh;
    private snapshotTimer;
    private snapshotWrite;
    private snapshotPending;
    private watcher;
    private readonly catalogUnsubscribe;
    private lastIndexReconcileAt;
    private needsFullReconcile;
    constructor(vaultPath: string, pathFilter: PathFilter, catalog?: VaultFileCatalog | undefined, vaultIo?: VaultIoCoordinator);
    /**
     * Search is derived from Markdown, so a short cache is safe and useful for
     * repeated agent lookups. Writers call this immediately after a mutation;
     * the TTL also covers edits made directly in Obsidian.
     */
    invalidate(path?: string, kind?: 'upsert' | 'delete'): void;
    close(): void;
    private loadSnapshot;
    private restoreSnapshot;
    private scheduleSnapshotSave;
    private flushSnapshot;
    search(params: SearchParams): Promise<SearchResult[]>;
    private ensureIndex;
    private startWatcher;
    private refreshAll;
    private refreshDirty;
    private readIndexedDocument;
    private gramIdsForText;
    private postingKey;
    private updatePostings;
    private setDocument;
    private removeDocument;
    private pathKeys;
    private addPathIndex;
    private removePathIndex;
    private scopedDocumentIds;
    private getCorpusStats;
    private loadText;
    private trimTextCache;
    private candidateIds;
    private matchingPostingCandidates;
    private postingCandidates;
    private findMarkdownFiles;
    private rerank;
}
//# sourceMappingURL=search.d.ts.map