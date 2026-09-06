import { readFile } from 'node:fs/promises';
import { readBoundedSource, SourceReadLimitError } from './bounded-source-read.js';
import { hashUtf8Source } from './streaming-revision.js';
import { readUtf8HeaderSource, readUtf8MetadataSource, type Utf8MetadataSource } from './streaming-metadata.js';

export type VaultIoPriority = 'foreground' | 'background';
const BACKGROUND_MAX_WAIT_MS = 500;
type IoResult = string | Utf8MetadataSource;

interface IoJob {
  path: string;
  priority: VaultIoPriority;
  run: () => Promise<IoResult>;
  resolve: (value: IoResult) => void;
  reject: (reason?: unknown) => void;
  queuedAt: number;
  startedAt?: number;
}

export interface VaultIoCoordinatorOptions {
  minConcurrency?: number;
  maxConcurrency?: number;
  initialConcurrency?: number;
  reader?: (path: string) => Promise<string>;
  boundedReader?: (path: string, maxBytes: number) => Promise<string>;
  revisionReader?: (path: string, maxBytes?: number) => Promise<string>;
  metadataReader?: (path: string, maxBytes?: number) => Promise<Utf8MetadataSource>;
  headerReader?: (path: string) => Promise<string>;
}

/**
 * Deduplicates concurrent note reads and applies adaptive backpressure to
 * derived read-model work. It intentionally retains no content after a read
 * finishes: Markdown remains authoritative and memory use stays bounded.
 */
export class VaultIoCoordinator {
  private readonly reader: (path: string) => Promise<string>;
  private readonly boundedReader: (path: string, maxBytes: number) => Promise<string>;
  private readonly revisionReader: (path: string, maxBytes?: number) => Promise<string>;
  private readonly metadataReader: (path: string, maxBytes?: number) => Promise<Utf8MetadataSource>;
  private readonly headerReader: (path: string) => Promise<string>;
  private readonly minConcurrency: number;
  private readonly maxConcurrency: number;
  private targetConcurrency: number;
  private active = 0;
  private readonly queue: IoJob[] = [];
  private readonly inFlight = new Map<string, Promise<IoResult>>();
  private latencyEmaMs = 0;

  constructor(options: VaultIoCoordinatorOptions = {}) {
    this.reader = options.reader || (path => readFile(path, 'utf8'));
    this.boundedReader = options.boundedReader || readBoundedSource;
    this.revisionReader = options.revisionReader || hashUtf8Source;
    this.metadataReader = options.metadataReader || readUtf8MetadataSource;
    this.headerReader = options.headerReader || readUtf8HeaderSource;
    this.minConcurrency = Math.max(1, Math.floor(options.minConcurrency || 2));
    this.maxConcurrency = Math.max(this.minConcurrency, Math.floor(options.maxConcurrency || 32));
    this.targetConcurrency = Math.min(
      this.maxConcurrency,
      Math.max(this.minConcurrency, Math.floor(options.initialConcurrency || 8)),
    );
  }

  readUtf8(path: string, priority: VaultIoPriority = 'foreground'): Promise<string> {
    return this.schedule(JSON.stringify(['full', path]), () => this.reader(path), priority);
  }

  readUtf8Header(path: string, priority: VaultIoPriority = 'foreground'): Promise<string> {
    return this.schedule(JSON.stringify(['header', path]), () => this.headerReader(path), priority);
  }

  readUtf8Bounded(path: string, maxBytes: number, priority: VaultIoPriority = 'foreground'): Promise<string> {
    return this.schedule(JSON.stringify(['bounded', maxBytes, path]), () => this.boundedReader(path, maxBytes), priority);
  }

  readUtf8Revision(path: string, maxBytes?: number, priority: VaultIoPriority = 'foreground'): Promise<string> {
    // Validate before keying: JSON serializes NaN/Infinity as null, which would
    // otherwise share an unbounded in-flight read and bypass the reader's check.
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 0x7fffffff)) {
      return Promise.reject(new TypeError('Invalid source byte limit'));
    }
    return this.schedule(JSON.stringify(['revision', maxBytes ?? null, path]), () => this.revisionReader(path, maxBytes), priority);
  }

  readUtf8Metadata(path: string, maxBytes?: number, priority: VaultIoPriority = 'foreground'): Promise<Utf8MetadataSource> {
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 0x7fffffff)) {
      return Promise.reject(new TypeError('Invalid source byte limit'));
    }
    return this.schedule(JSON.stringify(['metadata', maxBytes ?? null, path]), () => this.metadataReader(path, maxBytes), priority);
  }

  private schedule<T extends IoResult>(path: string, run: () => Promise<T>, priority: VaultIoPriority): Promise<T> {
    const existing = this.inFlight.get(path);
    // Private callers use disjoint operation namespaces; a key always has one
    // result type. Share only immutable strings/projections, never parsed data.
    if (existing) return existing as Promise<T>;

    const promise = new Promise<T>((resolve, reject) => {
      this.queue.push({ path, priority, run, resolve: value => resolve(value as T), reject, queuedAt: Date.now() });
      this.pump();
    });
    this.inFlight.set(path, promise);
    promise.then(
      () => { if (this.inFlight.get(path) === promise) this.inFlight.delete(path); },
      () => { if (this.inFlight.get(path) === promise) this.inFlight.delete(path); },
    );
    return promise;
  }

  status(): { active: number; queued: number; targetConcurrency: number; latencyEmaMs: number } {
    return {
      active: this.active,
      queued: this.queue.length,
      targetConcurrency: this.targetConcurrency,
      latencyEmaMs: Math.round(this.latencyEmaMs * 10) / 10,
    };
  }

  private pump(): void {
    while (this.active < this.targetConcurrency && this.queue.length > 0) {
      const now = Date.now();
      const agedBackgroundIndex = this.queue.findIndex(job => job.priority === 'background' && now - job.queuedAt >= BACKGROUND_MAX_WAIT_MS);
      const foregroundIndex = this.queue.findIndex(job => job.priority === 'foreground');
      const index = agedBackgroundIndex >= 0 ? agedBackgroundIndex : foregroundIndex >= 0 ? foregroundIndex : 0;
      const job = this.queue.splice(index, 1)[0]!;
      this.active += 1;
      job.startedAt = Date.now();
      void Promise.resolve()
        .then(() => job.run())
        .then(
          value => { job.resolve(value); this.finish(job, false); },
          error => { job.reject(error); this.finish(job, !(error instanceof SourceReadLimitError)); },
        );
    }
  }

  private finish(job: IoJob, failed: boolean): void {
    this.active = Math.max(0, this.active - 1);
    const duration = Math.max(0, Date.now() - (job.startedAt || Date.now()));
    this.latencyEmaMs = this.latencyEmaMs === 0 ? duration : this.latencyEmaMs * 0.8 + duration * 0.2;
    if (failed || duration >= 250 || this.latencyEmaMs >= 180) {
      this.targetConcurrency = Math.max(this.minConcurrency, this.targetConcurrency - 1);
    } else if (duration <= 40 && this.queue.length > this.active) {
      this.targetConcurrency = Math.min(this.maxConcurrency, this.targetConcurrency + 1);
    }
    this.pump();
  }
}
