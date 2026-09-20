import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { AsyncResource } from 'node:async_hooks';
import type { FileSystemService } from '../filesystem.js';
import type { VaultCatalogChange, VaultFileCatalog } from '../vault-catalog.js';
import { HostDerivedStorage } from '../host-derived-storage.js';
import { MemorySqliteStore } from '../memory/sqlite-store.js';
import { referenceDocumentPath, referenceTargetKeys } from './reference-footprint.js';

export interface ReferenceImpactCapture {
  targetRevision: string;
  candidates: Array<{ path: string; revision: string }>;
  assertCurrent(): Promise<void>;
  assertObserved(): void;
}
const MAX_BYTES = 256 * 1024;
const unavailable = () => Error('Reference integrity unavailable; retry after reconciliation or request review');

/** Private background integrity index, not the public search graph. A complete
 * scan covers every reference-bearing file in the filesystem's host boundary,
 * including fiction/drafts/checkpoints. Any unreadable scope stops coverage.
 * Watcher generations fence known changes; this is not an atomic NAS snapshot. */
export class ReferenceImpactIndex {
  private readonly owner = new AsyncResource('reference-index-owner');
  private readonly storage: HostDerivedStorage;
  private store?: MemorySqliteStore;
  private state: 'cold' | 'preparing' | 'ready' | 'unavailable' | 'closed' = 'cold';
  private revision = 0;
  private full = false;
  private pending = new Map<string, VaultCatalogChange>();
  private draining = false;
  private reconciling = false;
  private tail: Promise<void> = Promise.resolve();
  private unsubscribes: Array<() => void> = [];
  constructor(private fs: FileSystemService, cacheDir: string, private readonly catalog?: VaultFileCatalog,
    private readonly canIndex: (path: string) => boolean = () => true) {
    this.storage = new HostDerivedStorage(fs.getVaultPath(), cacheDir);
    if (catalog) this.unsubscribes = [catalog.subscribeIntegrity(path => { void this.invalidate(path ? [{ path, kind: 'upsert' }] : undefined); }),
      catalog.subscribeReconcile(() => { void this.invalidate(); })];
  }
  start() { if (this.state === 'cold') this.state = 'preparing'; return this.invalidate(); }
  status() { return this.state; }
  invalidate(changes?: readonly VaultCatalogChange[]) {
    if (this.state === 'closed' || changes?.length === 0) return this.tail;
    this.revision++;
    if (this.state === 'cold') return this.tail;
    if (!changes || !this.store || this.state === 'unavailable') this.full = true;
    else for (const change of changes) {
      if (!/\.(?:md|markdown|txt)$/i.test(change.path)) { this.full = true; break; }
      this.pending.set(change.path, change); if (this.pending.size > 128) { this.full = true; break; }
    }
    if (this.full) this.pending.clear();
    this.state = 'preparing';
    if (this.draining) return this.tail;
    this.draining = true;
    this.tail = this.owner.runInAsyncScope(() => this.tail.then(async () => {
      try {
        while (!this.closed() && (this.full || this.pending.size)) {
          const full = this.full, changes = [...this.pending.values()], revision = this.revision;
          this.full = false; this.pending.clear();
          try {
            if (full) { this.reconciling = true; try { await this.rebuild(); } finally { this.reconciling = false; } }
            else {
              await this.storage.verifiedTree('reference-impact-v1');
              for (const change of changes) { if (this.closed()) throw unavailable(); await this.refresh(change.path, true); }
            }
            if (this.revision === revision && !this.closed()) this.state = 'ready';
          } catch {
            if (!this.closed()) {
              this.state = 'unavailable';
              // Do not let a later, successful event hide a failed earlier
              // refresh. Re-establish whole coverage before becoming ready.
              if (this.revision !== revision) { this.full = true; this.pending.clear(); }
            }
          }
        }
      } finally { this.draining = false; }
    }));
    return this.tail;
  }
  private closed() { return this.state === 'closed'; }
  private async refresh(path: string, allowMissing: boolean) {
    referenceDocumentPath(path);
    if (!this.canIndex(path)) throw unavailable();
    try {
      const note = await this.fs.readNote(path, MAX_BYTES);
      if (!this.canIndex(path)) throw unavailable();
      await this.store!.putReferenceDocuments([{ path, revision: note.revision, frontmatter: note.frontmatter, text: note.content }]);
    } catch (error) {
      // A watcher deletion is only a hint. Never sweep on a disconnected NAS.
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await stat(this.fs.getVaultPath()); await this.store!.removeReferenceDocuments([path]);
    }
  }
  private async rebuild() {
    const directory = await this.storage.verifiedTree('reference-impact-v1', true);
    this.store ??= new MemorySqliteStore(join(directory, 'references.sqlite'));
    await this.store.ready(); await this.store.beginReferenceScan();
    const batch: string[] = [];
    const flush = async () => {
      if (this.closed()) throw unavailable();
      const paths = batch.splice(0);
      const results = await Promise.allSettled(paths.map(p => this.refresh(p, false)));
      if (results.some(r => r.status === 'rejected')) throw unavailable();
      await this.store!.seenReferences(paths);
    };
    for await (const path of this.fs.referenceFiles()) {
      if (this.closed()) throw unavailable(); batch.push(path); if (batch.length === 4) await flush();
    }
    await flush(); await stat(this.fs.getVaultPath()); await this.storage.verifiedTree('reference-impact-v1');
    if (this.closed()) throw unavailable(); await this.store.finishReferenceScan();
  }
  async capture(path: string, canAccess: (path: string) => boolean): Promise<ReferenceImpactCapture> {
    try {
      referenceDocumentPath(path);
      const observation = this.catalog?.integrityObservation();
      if (observation && !observation.watching) throw unavailable();
      // An owned write may have queued a small incremental refresh. Drain that
      // work briefly, never wait for/restart a whole-Vault reconciliation here.
      if (this.state === 'preparing' && this.store && !this.reconciling && !this.full) {
        let timer: NodeJS.Timeout | undefined;
        try { await Promise.race([this.tail, new Promise<void>(r => { timer = setTimeout(r, 2000); })]); }
        finally { clearTimeout(timer); }
      }
      if (!this.store || this.state !== 'ready' || !canAccess(path) || !this.canIndex(path)) throw unavailable();
      const revision = this.revision, store = this.store;
      await this.storage.verifiedTree('reference-impact-v1'); await stat(this.fs.getVaultPath());
      const target = await this.fs.readNote(path, MAX_BYTES);
      const page = await store.referenceImpact({ keys: referenceTargetKeys({ path, frontmatter: target.frontmatter }), limit: 200 });
      if (!page.complete || page.truncated) throw unavailable();
      if (page.candidates.some(p => p.path !== path && p.path.toLocaleLowerCase() === path.toLocaleLowerCase())) throw unavailable();
      const candidates = page.candidates.filter(p => p.path !== path);
      const assertObserved = () => {
        const live = this.catalog?.integrityObservation();
        if (observation && (!live?.watching || live.revision !== observation.revision)) throw unavailable();
        if (this.state !== 'ready' || this.revision !== revision
          || !canAccess(path) || !this.canIndex(path) || candidates.some(p => !canAccess(p.path) || !this.canIndex(p.path))) throw unavailable();
      };
      const current = async () => { assertObserved(); if (await store.generation() !== page.generation) throw unavailable(); assertObserved(); };
      await current();
      return { targetRevision: target.revision, candidates, assertObserved, assertCurrent: async () => {
        try {
          await current(); await this.storage.verifiedTree('reference-impact-v1'); await stat(this.fs.getVaultPath());
          for (const expected of [{ path, revision: target.revision }, ...candidates]) {
            if (!canAccess(expected.path) || (await this.fs.readNote(expected.path, MAX_BYTES)).revision !== expected.revision) throw unavailable();
          }
          await current();
        } catch { throw unavailable(); }
      } };
    } catch { throw unavailable(); }
  }
  async close() {
    this.state = 'closed'; this.revision++; for (const unsubscribe of this.unsubscribes) unsubscribe();
    await this.tail; try { await this.store?.close(); } finally { this.owner.emitDestroy(); }
  }
}
