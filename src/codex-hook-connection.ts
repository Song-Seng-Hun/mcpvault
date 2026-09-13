import type { CodexHookHost } from './codex-hook-host.js';
import { CodexHookService, type CodexHookAttestation, type CodexHookResult } from './codex-hook-service.js';
import type { CodexHookEvent } from './codex-hook-policy.js';
import type { CompilationSession } from './compilation-session.js';
import { CodexHookServiceAdapter, type CodexHookAdapterOptions, type CodexPreparedCheckpointStore } from './codex-hook-adapter.js';

export interface CodexHookConnectionOptions {
  host?: CodexHookHost;
  /** Fresh host verification of mode, definition hash, occurrence, actor and
   * exact dependencies. Never derive approval from incoming payload strings. */
  attest?(event: Readonly<CodexHookEvent>): Promise<CodexHookAttestation | undefined>;
  /** Host-owned transport only. No default listener, subprocess, polling or
   * trust mutation. Remaining work is retried at an existing host opportunity. */
  bind?(handler: (payload: string, signal?: AbortSignal) => Promise<CodexHookResult>): () => void;
  checkpoint?: CodexPreparedCheckpointStore;
  /** Separately supplied current-session generator; absent retains retry-only.
   * Never loaded from a hook payload or inferred from compilation permission. */
  session?: Pick<CompilationSession, 'generate' | 'application'>;
}
export function connectCodexHooks(options: CodexHookConnectionOptions | undefined, services: CodexHookAdapterOptions, readOnly: boolean): () => void {
  if (readOnly || !options?.host || !options.attest || !options.bind) return () => {};
  const service = new CodexHookService({ host: options.host, attest: options.attest,
    adapter: new CodexHookServiceAdapter({ ...services, ...(options.checkpoint && { checkpoint: options.checkpoint }),
      ...(options.session && { compilationSession: options.session }) }) });
  let unbind: (() => void);
  try { unbind = options.bind((payload, signal) => service.run(payload, signal)); }
  catch (error) { service.close(); throw error; }
  let closed = false;
  return () => { if (closed) return; closed = true; service.close(); unbind(); };
}
