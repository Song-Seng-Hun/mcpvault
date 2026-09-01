export interface ClientScheduleOptions {
  /** Higher values run first when the queue is waiting. */
  priority?: number;
  /** A queued task is discarded if its signal is already aborted. */
  signal?: AbortSignal;
}

interface QueueItem {
  key: string;
  priority: number;
  sequence: number;
  task: () => Promise<unknown> | unknown;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
}

/**
 * Host-side priority queue for MCP calls and local work. It coalesces the
 * same key while it is running, bounds concurrency, and never changes the
 * server's authorization or visibility decisions.
 */
export class ClientRequestScheduler {
  private readonly queue: QueueItem[] = [];
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private active = 0;
  private sequence = 0;
  private readonly maxConcurrency: number;

  constructor(maxConcurrency = 4) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) throw new Error('maxConcurrency must be a positive integer');
    this.maxConcurrency = maxConcurrency;
  }

  run<T>(key: string, task: () => Promise<T> | T, options: ClientScheduleOptions = {}): Promise<T> {
    const normalizedKey = String(key).trim();
    if (!normalizedKey) return Promise.reject(new Error('key is required'));
    const existing = this.inFlight.get(normalizedKey);
    if (existing) return existing as Promise<T>;
    if (options.signal?.aborted) return Promise.reject(new Error('scheduled task was aborted'));

    let resolveTask!: (value: T | PromiseLike<T>) => void;
    let rejectTask!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });
    this.inFlight.set(normalizedKey, promise as Promise<unknown>);
    this.queue.push({
      key: normalizedKey,
      priority: options.priority ?? 0,
      sequence: this.sequence++,
      task: async () => task(),
      resolve: value => resolveTask(value as T),
      reject: rejectTask,
      ...(options.signal && { signal: options.signal }),
    });
    options.signal?.addEventListener('abort', () => this.pump(), { once: true });
    this.pump();
    return promise;
  }

  pending(): number {
    return this.queue.length;
  }

  running(): number {
    return this.active;
  }

  private pump(): void {
    while (this.active < this.maxConcurrency && this.queue.length > 0) {
      this.queue.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
      const item = this.queue.shift()!;
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
