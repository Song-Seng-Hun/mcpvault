import { readFile } from 'node:fs/promises';
const BACKGROUND_MAX_WAIT_MS = 500;
/**
 * Deduplicates concurrent note reads and applies adaptive backpressure to
 * derived read-model work. It intentionally retains no content after a read
 * finishes: Markdown remains authoritative and memory use stays bounded.
 */
export class VaultIoCoordinator {
    reader;
    minConcurrency;
    maxConcurrency;
    targetConcurrency;
    active = 0;
    queue = [];
    inFlight = new Map();
    latencyEmaMs = 0;
    constructor(options = {}) {
        this.reader = options.reader || (path => readFile(path, 'utf8'));
        this.minConcurrency = Math.max(1, Math.floor(options.minConcurrency || 2));
        this.maxConcurrency = Math.max(this.minConcurrency, Math.floor(options.maxConcurrency || 32));
        this.targetConcurrency = Math.min(this.maxConcurrency, Math.max(this.minConcurrency, Math.floor(options.initialConcurrency || 8)));
    }
    readUtf8(path, priority = 'foreground') {
        const existing = this.inFlight.get(path);
        if (existing)
            return existing;
        const promise = new Promise((resolve, reject) => {
            this.queue.push({ path, priority, run: () => this.reader(path), resolve, reject, queuedAt: Date.now() });
            this.pump();
        });
        this.inFlight.set(path, promise);
        promise.then(() => { if (this.inFlight.get(path) === promise)
            this.inFlight.delete(path); }, () => { if (this.inFlight.get(path) === promise)
            this.inFlight.delete(path); });
        return promise;
    }
    status() {
        return {
            active: this.active,
            queued: this.queue.length,
            targetConcurrency: this.targetConcurrency,
            latencyEmaMs: Math.round(this.latencyEmaMs * 10) / 10,
        };
    }
    pump() {
        while (this.active < this.targetConcurrency && this.queue.length > 0) {
            const now = Date.now();
            const agedBackgroundIndex = this.queue.findIndex(job => job.priority === 'background' && now - job.queuedAt >= BACKGROUND_MAX_WAIT_MS);
            const foregroundIndex = this.queue.findIndex(job => job.priority === 'foreground');
            const index = agedBackgroundIndex >= 0 ? agedBackgroundIndex : foregroundIndex >= 0 ? foregroundIndex : 0;
            const job = this.queue.splice(index, 1)[0];
            this.active += 1;
            job.startedAt = Date.now();
            void Promise.resolve()
                .then(() => job.run())
                .then(value => { job.resolve(value); this.finish(job, false); }, error => { job.reject(error); this.finish(job, true); });
        }
    }
    finish(job, failed) {
        this.active = Math.max(0, this.active - 1);
        const duration = Math.max(0, Date.now() - (job.startedAt || Date.now()));
        this.latencyEmaMs = this.latencyEmaMs === 0 ? duration : this.latencyEmaMs * 0.8 + duration * 0.2;
        if (failed || duration >= 250 || this.latencyEmaMs >= 180) {
            this.targetConcurrency = Math.max(this.minConcurrency, this.targetConcurrency - 1);
        }
        else if (duration <= 40 && this.queue.length > this.active) {
            this.targetConcurrency = Math.min(this.maxConcurrency, this.targetConcurrency + 1);
        }
        this.pump();
    }
}
