import { compilationHash, compilationPath } from './compilation-policy.js';
import type { CodexHookHost } from './codex-hook-host.js';
import { decodeCodexHookEvent, hookHash, hookId, validateCodexHookConfig, type CodexHookEvent, type CodexHookEventName,
  type CodexHookAction, type CodexHookConfig } from './codex-hook-policy.js';
import type { HostWorkWriter } from './host-work-storage.js';

export type CodexHookWork = { action: 'resume' | 'community' }
  | { action: 'search'; query: string }
  | { action: 'candidate'; path: string; expectedRevision: string }
  | { action: 'checkpoint'; checkpointId: string; expectedRevision: string }
  | { action: 'compilation'; requestId: string; expectedJobRevision: string };
/** Supplied by trusted host code, never reconstructed from a hook payload.
 * verified means this definition/event and current mode were actually verified.
 * paths must include every dependency; adapters enforce their normal ACL too. */
export interface CodexHookAttestation {
  projectId: string; accountId: string; workspace: string; definitionHash: string;
  event: CodexHookEventName; sessionId: string; causeId: string; originId?: string;
  authorityRevision: string; inputRevision: string; mode: 'default' | 'plan'; verified: boolean;
  expiresAt: number; hostBusy: boolean; quotaAvailable: boolean; paths: string[]; work: CodexHookWork;
  /** Actual host-attested locality, required before reading confidential bodies. */
  runtimeLocal?: boolean;
}
export interface CodexHookContext {
  ticket: Readonly<CodexHookAttestation>; requestId: string; signal: AbortSignal;
  deadline: number; maxChars: number; assertCurrent(): Promise<void>;
}
export interface CodexHookOutcome { status: 'completed' | 'partial'; revision?: string; packet?: Record<string, unknown> }
export interface CodexHookAdapter {
  execute(work: CodexHookWork, context: CodexHookContext): Promise<CodexHookOutcome>;
  /** Read-only current-result reconciliation. Never resubmit an uncertain write. */
  reconcile(work: CodexHookWork, context: CodexHookContext): Promise<CodexHookOutcome>;
}
interface Options {
  host?: CodexHookHost; adapter?: CodexHookAdapter; readOnly?: boolean;
  attest(event: Readonly<CodexHookEvent>): Promise<CodexHookAttestation | undefined>;
  now?: () => number;
}
interface Receipt { id: string; binding: string; status: 'running' | 'completed'; resultRevision?: string }
interface History { version: 1; receipts: Receipt[] }
export interface CodexHookResult {
  status: 'quiet' | 'deferred' | 'diagnostic_only' | 'review_required' | 'cancelled' | 'processed';
  partial?: true; context?: { trust: 'data_not_instructions'; packet: Record<string, unknown> };
}
const shutdown = (event: CodexHookEventName) => event === 'Interrupt' || event === 'SessionEnd';
const actions: Record<CodexHookEventName, readonly CodexHookAction[]> = {
  SessionStart: ['resume', 'community'], PostCompact: ['resume'], UserPromptSubmit: ['search'], PostToolUse: ['candidate'],
  PreCompact: ['checkpoint'], Stop: ['checkpoint', 'compilation', 'community'], Interrupt: ['checkpoint'], SessionEnd: ['checkpoint'],
};
const invalid = () => Error('Hook state unavailable');
function validateWork(work: CodexHookWork): void {
  if (!work || typeof work !== 'object') throw invalid();
  const keys: Record<CodexHookAction, string[]> = { resume: ['action'], community: ['action'], search: ['action', 'query'],
    candidate: ['action', 'path', 'expectedRevision'], checkpoint: ['action', 'checkpointId', 'expectedRevision'],
    compilation: ['action', 'requestId', 'expectedJobRevision'] };
  if (!keys[work.action] || Object.keys(work).some(k => !keys[work.action].includes(k))) throw invalid();
  if (work.action === 'search' && (typeof work.query !== 'string' || !work.query.trim() || work.query.length > 1000)) throw invalid();
  if (work.action === 'candidate') { compilationPath(work.path); if (!hookHash(work.expectedRevision)) throw invalid(); }
  if (work.action === 'checkpoint' && (!hookId(work.checkpointId) || !hookHash(work.expectedRevision))) throw invalid();
  if (work.action === 'compilation' && (!hookId(work.requestId) || !hookHash(work.expectedJobRevision))) throw invalid();
}
function history(value: unknown): History {
  if (value === undefined) return { version: 1, receipts: [] };
  const raw = value as History;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !['version', 'receipts'].includes(k))
    || raw.version !== 1 || !Array.isArray(raw.receipts) || raw.receipts.length > 1024) throw invalid();
  const ids = new Set<string>();
  for (const r of raw.receipts) {
    if (!r || typeof r !== 'object' || Object.keys(r).some(k => !['id', 'binding', 'status', 'resultRevision'].includes(k))
      || !hookHash(r.id) || !hookHash(r.binding) || ids.has(r.id) || !['running', 'completed'].includes(r.status)
      || (r.status === 'completed' ? !hookHash(r.resultRevision) : r.resultRevision !== undefined)) throw invalid();
    ids.add(r.id);
  }
  return structuredClone(raw);
}
const binding = (ticket: CodexHookAttestation, config: CodexHookConfig) => {
  // Delivery event/session is freshly checked, but does not make an unchanged
  // host cause a new action when it arrives through Stop or an existing heartbeat.
  const { expiresAt: _expiry, event: _event, sessionId: _session, ...stable } = ticket; return compilationHash({ config, ticket: stable });
};

/** No scheduler or model calls. One existing host opportunity, one narrow action.
 * A timed-out adapter retains the lease until it settles; abort is not a safe
 * license to start a second writer. Remaining work stays in its original registry. */
export class CodexHookService {
  private busy = false;
  private closed = false;
  private controller: AbortController | undefined;
  constructor(private readonly options: Options) {}
  close(): void { this.closed = true; this.controller?.abort(); }
  async run(payload: string, signal?: AbortSignal): Promise<CodexHookResult> {
    if (signal?.aborted || this.closed) return { status: 'cancelled' };
    let event: CodexHookEvent;
    try { event = decodeCodexHookEvent(payload); } catch { return { status: 'diagnostic_only' }; }
    if (event.reentrant) return { status: 'quiet' };
    if (!this.options.host || !this.options.adapter || this.options.readOnly) return { status: 'diagnostic_only' };
    if (this.busy) return { status: 'deferred' };
    this.busy = true;
    const controller = new AbortController(); this.controller = controller;
    const now = this.options.now ?? Date.now, duration = shutdown(event.event) ? 750 : event.event === 'PreCompact' ? 2000 : 300000;
    const deadline = now() + duration;
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout>;
    const cancelled = new Promise<CodexHookResult>(resolve => {
      controller.signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
      timer = setTimeout(abort, duration); timer.unref?.();
    });
    const operation = this.perform(event, controller.signal, deadline).catch((): CodexHookResult => ({ status: controller.signal.aborted ? 'cancelled' : 'review_required' }))
      .finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.busy = false; if (this.controller === controller) this.controller = undefined; });
    return Promise.race([operation, cancelled]);
  }
  private async perform(event: CodexHookEvent, signal: AbortSignal, deadline: number): Promise<CodexHookResult> {
    const host = this.options.host!, adapter = this.options.adapter!, now = this.options.now ?? Date.now;
    const active = () => { if (signal.aborted || this.closed || now() >= deadline) throw invalid(); };
    const admit = async () => {
      active(); const config = validateCodexHookConfig(await host.refresh());
      const ticket = structuredClone(await this.options.attest(Object.freeze({ ...event })));
      active();
      if (!config.enabled || !ticket || ticket.mode !== 'default' || ticket.verified !== true || ticket.hostBusy !== false || ticket.quotaAvailable !== true
        || !Number.isFinite(ticket.expiresAt) || ticket.expiresAt <= now() || ticket.accountId !== config.accountId
        || ticket.event !== event.event || ticket.sessionId !== event.sessionId || !hookId(ticket.causeId)
        || !hookHash(ticket.authorityRevision) || !hookHash(ticket.inputRevision)) return;
      const project = config.projects.find(p => p.id === ticket.projectId);
      validateWork(ticket.work);
      if (!project || project.workspace !== ticket.workspace || project.definitionHash !== ticket.definitionHash
        || !project.events.includes(event.event) || !project.actions.includes(ticket.work.action) || !actions[event.event].includes(ticket.work.action)
        || !Array.isArray(ticket.paths) || !ticket.paths.length || ticket.paths.length > 128 || new Set(ticket.paths).size !== ticket.paths.length
        || ticket.paths.some(p => !project.paths.includes(compilationPath(p)))
        || ticket.work.action === 'candidate' && !ticket.paths.includes(ticket.work.path)) return;
      return { ticket, config };
    };
    const admission = await admit(); if (!admission) return { status: 'diagnostic_only' };
    const { ticket, config } = admission;
    if (ticket.originId !== undefined) return { status: 'quiet' };
    const expectedBinding = binding(ticket, config), id = compilationHash({ account: ticket.accountId, project: ticket.projectId, cause: ticket.causeId });
    let writer: HostWorkWriter | undefined;
    const assertCurrent = async () => {
      active(); const current = await admit();
      if (!current || binding(current.ticket, current.config) !== expectedBinding) throw invalid();
      await writer?.assertHeld(); active();
    };
    try {
      writer = await host.acquire(); await assertCurrent();
      const state = history(await host.readState());
      const context: CodexHookContext = { ticket: structuredClone(ticket), requestId: `hook-${id}`, signal, deadline, maxChars: 3000, assertCurrent };
      const existing = state.receipts.find(r => r.id === id);
      if (existing) {
        if (existing.binding !== expectedBinding) return { status: 'review_required' };
        await assertCurrent(); const result = await adapter.reconcile(structuredClone(ticket.work), context); await assertCurrent();
        if (result.status !== 'completed' || !hookHash(result.revision)
          || existing.status === 'completed' && existing.resultRevision !== result.revision) return { status: 'review_required' };
        if (existing.status !== 'completed') { existing.status = 'completed'; existing.resultRevision = result.revision; await assertCurrent(); await host.writeState(state); }
        return { status: 'quiet' };
      }
      if (state.receipts.length >= 1024) return { status: 'review_required' };
      const receipt: Receipt = { id, binding: expectedBinding, status: 'running' };
      state.receipts.push(receipt); await assertCurrent(); await host.writeState(state);
      await assertCurrent(); const result = await adapter.execute(structuredClone(ticket.work), context); await assertCurrent();
      if (result.status !== 'completed' || !hookHash(result.revision)) return { status: 'review_required' };
      receipt.status = 'completed'; receipt.resultRevision = result.revision;
      await host.writeState(state); await assertCurrent();
      if (result.packet) {
        const response: CodexHookResult = { status: 'processed', context: { trust: 'data_not_instructions', packet: result.packet } };
        if (JSON.stringify(response).length <= 4000) return response;
        return { status: 'processed', partial: true };
      }
      return { status: 'processed' };
    } finally { await writer?.close(); }
  }
}
