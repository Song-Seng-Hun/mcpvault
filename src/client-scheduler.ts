export interface ClientScheduleOptions {
  /** Higher values run first when the queue is waiting. */
  priority?: number;
  /** A queued task is discarded if its signal is aborted; running tasks receive it too. */
  signal?: AbortSignal;
}

export interface ClientRequestSchedulerOptions {
  /** Hard upper bound for concurrent work. */
  maxConcurrency?: number;
  /** Lower bound used when adaptive control is enabled; defaults to 1. */
  minConcurrency?: number;
  /** Starting concurrency used when adaptive control is enabled. */
  initialConcurrency?: number;
  /** Enable additive-increase/multiplicative-decrease backpressure. */
  adaptive?: boolean;
  /** Successful work slower than this target is treated as congested. */
  targetLatencyMs?: number;
}

interface QueueItem {
  key: string;
  priority: number;
  sequence: number;
  task: (signal?: AbortSignal) => Promise<unknown> | unknown;
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
  private readonly minConcurrency: number;
  private readonly adaptive: boolean;
  private readonly targetLatencyMs: number;
  private concurrency: number;

  constructor(options: number | ClientRequestSchedulerOptions = 4) {
    const configured = typeof options === 'number' ? { maxConcurrency: options } : options;
    const maxConcurrency = configured.maxConcurrency ?? 4;
    const adaptive = configured.adaptive === true;
    const minConcurrency = configured.minConcurrency ?? (adaptive ? 1 : maxConcurrency);
    const initialConcurrency = configured.initialConcurrency ?? (adaptive ? minConcurrency : maxConcurrency);
    const targetLatencyMs = configured.targetLatencyMs ?? 250;
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) throw new Error('maxConcurrency must be a positive integer');
    if (!Number.isInteger(minConcurrency) || minConcurrency < 1 || minConcurrency > maxConcurrency) throw new Error('minConcurrency must be between 1 and maxConcurrency');
    if (!Number.isInteger(initialConcurrency) || initialConcurrency < minConcurrency || initialConcurrency > maxConcurrency) throw new Error('initialConcurrency must be between minConcurrency and maxConcurrency');
    if (!Number.isInteger(targetLatencyMs) || targetLatencyMs < 1) throw new Error('targetLatencyMs must be a positive integer');
    this.maxConcurrency = maxConcurrency;
    this.minConcurrency = minConcurrency;
    this.adaptive = adaptive;
    this.targetLatencyMs = targetLatencyMs;
    this.concurrency = initialConcurrency;
  }

  run<T>(key: string, task: (signal?: AbortSignal) => Promise<T> | T, options: ClientScheduleOptions = {}): Promise<T> {
    const normalizedKey = String(key).trim();
    if (!normalizedKey) return Promise.reject(new Error('key is required'));
    const existing = this.inFlight.get(normalizedKey);
    if (existing) return waitForAbort(existing as Promise<T>, options.signal);
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
      task: async signal => task(signal),
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

  currentConcurrency(): number {
    return this.concurrency;
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      this.queue.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
      const item = this.queue.shift()!;
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

  private recordOutcome(latencyMs: number, success: boolean, error?: unknown): void {
    if (!this.adaptive || !success && isAbortError(error)) return;
    if (!success || latencyMs >= this.targetLatencyMs * 2) {
      this.concurrency = Math.max(this.minConcurrency, Math.floor(this.concurrency / 2));
      return;
    }
    if (latencyMs <= this.targetLatencyMs) this.concurrency = Math.min(this.maxConcurrency, this.concurrency + 1);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && /abort/i.test(error.message);
}

async function waitForAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw new Error('scheduled task was aborted');
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('scheduled task was aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
