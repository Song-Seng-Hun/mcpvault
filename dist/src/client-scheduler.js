/**
 * Host-side priority queue for MCP calls and local work. It coalesces the
 * same key while it is running, bounds concurrency, and never changes the
 * server's authorization or visibility decisions.
 */
export class ClientRequestScheduler {
    queue = [];
    inFlight = new Map();
    active = 0;
    sequence = 0;
    maxConcurrency;
    constructor(maxConcurrency = 4) {
        if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1)
            throw new Error('maxConcurrency must be a positive integer');
        this.maxConcurrency = maxConcurrency;
    }
    run(key, task, options = {}) {
        const normalizedKey = String(key).trim();
        if (!normalizedKey)
            return Promise.reject(new Error('key is required'));
        const existing = this.inFlight.get(normalizedKey);
        if (existing)
            return existing;
        if (options.signal?.aborted)
            return Promise.reject(new Error('scheduled task was aborted'));
        let resolveTask;
        let rejectTask;
        const promise = new Promise((resolve, reject) => {
            resolveTask = resolve;
            rejectTask = reject;
        });
        this.inFlight.set(normalizedKey, promise);
        this.queue.push({
            key: normalizedKey,
            priority: options.priority ?? 0,
            sequence: this.sequence++,
            task: async () => task(),
            resolve: value => resolveTask(value),
            reject: rejectTask,
            ...(options.signal && { signal: options.signal }),
        });
        options.signal?.addEventListener('abort', () => this.pump(), { once: true });
        this.pump();
        return promise;
    }
    pending() {
        return this.queue.length;
    }
    running() {
        return this.active;
    }
    pump() {
        while (this.active < this.maxConcurrency && this.queue.length > 0) {
            this.queue.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
            const item = this.queue.shift();
            if (item.signal?.aborted) {
                item.reject(new Error('scheduled task was aborted'));
                this.inFlight.delete(item.key);
                continue;
            }
            this.active += 1;
            Promise.resolve()
                .then(item.task)
                .then(item.resolve, item.reject)
                .finally(() => {
                this.active -= 1;
                this.inFlight.delete(item.key);
                this.pump();
            });
        }
    }
}
