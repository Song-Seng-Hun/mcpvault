export type SemanticInferencePriority = 'foreground' | 'background';
export class SemanticInferenceBusyError extends Error {
  constructor() { super('Semantic inference is busy; retry shortly. Lexical search remains available.'); }
}
interface WaitingInference {
  priority: SemanticInferencePriority;
  expiresAt: number;
  start: () => void;
  cancel: () => void;
}

/** One native model call at a time, not a global request or file-IO limiter. */
export class SemanticInferenceGate {
  private active = false;
  private foregroundBurst = 0;
  private readonly waiting: WaitingInference[] = [];

  run<T>(priority: SemanticInferencePriority, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted || this.waiting.length >= 16) return Promise.reject(new SemanticInferenceBusyError());
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', job.cancel); };
      const job: WaitingInference = {
        priority, expiresAt: Date.now() + 5000,
        start: () => {
          cleanup();
          // Do not release the active slot on abort or timeout: native work
          // may still own memory/threads until its promise actually settles.
          void Promise.resolve().then(task).then(resolve, reject).finally(() => {
            this.active = false;
            this.pump();
          });
        },
        cancel: () => {
          const index = this.waiting.indexOf(job);
          if (index < 0) return;
          this.waiting.splice(index, 1); cleanup(); reject(new SemanticInferenceBusyError());
        },
      };
      this.waiting.push(job);
      signal?.addEventListener('abort', job.cancel, { once: true });
      timer = setTimeout(job.cancel, 5000); timer.unref?.();
      this.pump();
    });
  }

  private pump(): void {
    if (this.active) return;
    for (const job of [...this.waiting]) if (Date.now() >= job.expiresAt) job.cancel();
    if (this.waiting.length === 0) { this.foregroundBurst = 0; return; }
    const foreground = this.waiting.findIndex(job => job.priority === 'foreground');
    const background = this.waiting.findIndex(job => job.priority === 'background');
    const index = background >= 0 && this.foregroundBurst >= 4 ? background : foreground >= 0 ? foreground : 0;
    const job = this.waiting.splice(index, 1)[0]!;
    this.foregroundBurst = job.priority === 'foreground' ? Math.min(4, this.foregroundBurst + 1) : 0;
    this.active = true;
    job.start();
  }
}
export const semanticInferenceGate = new SemanticInferenceGate();
