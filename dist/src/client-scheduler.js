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
    minConcurrency;
    adaptive;
    targetLatencyMs;
    concurrency;
    constructor(options = 4) {
        const configured = typeof options === 'number' ? { maxConcurrency: options } : options;
        const maxConcurrency = configured.maxConcurrency ?? 4;
        const adaptive = configured.adaptive === true;
        const minConcurrency = configured.minConcurrency ?? (adaptive ? 1 : maxConcurrency);
        const initialConcurrency = configured.initialConcurrency ?? (adaptive ? minConcurrency : maxConcurrency);
        const targetLatencyMs = configured.targetLatencyMs ?? 250;
        if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1)
            throw new Error('maxConcurrency must be a positive integer');
        if (!Number.isInteger(minConcurrency) || minConcurrency < 1 || minConcurrency > maxConcurrency)
            throw new Error('minConcurrency must be between 1 and maxConcurrency');
        if (!Number.isInteger(initialConcurrency) || initialConcurrency < minConcurrency || initialConcurrency > maxConcurrency)
            throw new Error('initialConcurrency must be between minConcurrency and maxConcurrency');
        if (!Number.isInteger(targetLatencyMs) || targetLatencyMs < 1)
            throw new Error('targetLatencyMs must be a positive integer');
        this.maxConcurrency = maxConcurrency;
        this.minConcurrency = minConcurrency;
        this.adaptive = adaptive;
        this.targetLatencyMs = targetLatencyMs;
        this.concurrency = initialConcurrency;
    }
    run(key, task, options = {}) {
        const normalizedKey = String(key).trim();
        if (!normalizedKey)
            return Promise.reject(new Error('key is required'));
        const existing = this.inFlight.get(normalizedKey);
        if (existing)
            return waitForAbort(existing, options.signal);
        if (options.signal?.aborted)
            return Promise.reject(new Error('scheduled task was aborted'));
        let resolveTask;
        let rejectTask;
        const promise = new Promise((resolve, reject) => {
            resolveTask = resolve;
            rejectTask = reject;
        });
        this.inFlight.set(normalizedKey, promise);
        queuePush(this.queue, {
            key: normalizedKey,
            priority: options.priority ?? 0,
            sequence: this.sequence++,
            task: async (signal) => task(signal),
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
    currentConcurrency() {
        return this.concurrency;
    }
    pump() {
        while (this.active < this.concurrency && this.queue.length > 0) {
            const item = queuePop(this.queue);
            if (item.signal?.aborted) {
                item.reject(new Error('scheduled task was aborted'));
                this.inFlight.delete(item.key);
                continue;
            }
            this.active += 1;
            const startedAt = Date.now();
            Promise.resolve()
                .then(() => item.task(item.signal))
                .then(value => {
                this.recordOutcome(Date.now() - startedAt, true);
                item.resolve(value);
            }, error => {
                this.recordOutcome(Date.now() - startedAt, false, error);
                item.reject(error);
            })
                .finally(() => {
                this.active -= 1;
                this.inFlight.delete(item.key);
                this.pump();
            });
        }
    }
    recordOutcome(latencyMs, success, error) {
        if (!this.adaptive || !success && isAbortError(error))
            return;
        if (!success || latencyMs >= this.targetLatencyMs * 2) {
            this.concurrency = Math.max(this.minConcurrency, Math.floor(this.concurrency / 2));
            return;
        }
        if (latencyMs <= this.targetLatencyMs)
            this.concurrency = Math.min(this.maxConcurrency, this.concurrency + 1);
    }
}
function isAbortError(error) {
    return error instanceof Error && /abort/i.test(error.message);
}
function queueCompare(left, right) {
    return right.priority - left.priority || left.sequence - right.sequence;
}
function queuePush(queue, item) {
    queue.push(item);
    let index = queue.length - 1;
    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (queueCompare(queue[index], queue[parent]) >= 0)
            break;
        [queue[index], queue[parent]] = [queue[parent], queue[index]];
        index = parent;
    }
}
function queuePop(queue) {
    const first = queue[0];
    if (!first)
        return undefined;
    const last = queue.pop();
    if (queue.length === 0)
        return first;
    queue[0] = last;
    let index = 0;
    while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let best = index;
        if (left < queue.length && queueCompare(queue[left], queue[best]) < 0)
            best = left;
        if (right < queue.length && queueCompare(queue[right], queue[best]) < 0)
            best = right;
        if (best === index)
            return first;
        [queue[index], queue[best]] = [queue[best], queue[index]];
        index = best;
    }
}
async function waitForAbort(promise, signal) {
    if (!signal)
        return promise;
    if (signal.aborted)
        throw new Error('scheduled task was aborted');
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(new Error('scheduled task was aborted'));
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(value => {
            signal.removeEventListener('abort', onAbort);
            resolve(value);
        }, error => {
            signal.removeEventListener('abort', onAbort);
            reject(error);
        });
    });
}
