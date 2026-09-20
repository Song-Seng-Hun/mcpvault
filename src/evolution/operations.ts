import type { HostWorkStorage } from '../host-work-storage.js';
import type { EvolutionConfig } from './model.js';
import type { EvolutionRuntimeHost } from './runtime-connection.js';
import { hash, id, unavailable } from './policy.js';
import { MEMORY_OBSERVED_ENDPOINTS, memoryObservation, type MemoryDeliveryEvidence } from './memory-observation.js';
import { curationActor, deliveredDocuments, type CurationDelivery, type CurationDeliverySink } from '../curation/delivery.js';

export const OBSERVED_ENDPOINTS = new Set(['wiki.search', 'wiki.answer_packet', 'notes.read', 'mcp.read_note_lines', 'documents.outline', 'documents.read', ...MEMORY_OBSERVED_ENDPOINTS]);
interface Task {
  version: 1; accountId: string; authority: string; id: string; fingerprint: string;
  context: Record<string, string>; events: string[]; contextBasis?: string;
}
export interface OperationActor { accountId: string; modelId: string; authority: string; assert(): Promise<void> }
interface Observation {
  version: 1; taskId: string; requestId: string; fingerprint: string; endpointId: string;
  state: 'started' | 'completed' | 'failed'; returnedChars?: number; returnedBytes?: number; elapsedMs?: number;
  resultHash?: string; measurementScope: 'search_server' | 'memory_server' | 'continuity_server'; effectVerified: false;
  evidence?: MemoryDeliveryEvidence;
  selectedHarness?: { cycleId: string; revision: string };
  resourceRevisions?: string[];
  documentDelivery?: CurationDelivery;
}

/** Server observations, never client-authored success logs. Bodies and credentials are not persisted. */
export class EvolutionOperations {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(private readonly storage: HostWorkStorage<EvolutionConfig>, private readonly host: EvolutionRuntimeHost,
    private readonly actor: (token: string, write: boolean) => Promise<OperationActor>, private readonly deliverySink?: Partial<CurationDeliverySink>) {}
  private key(a: OperationActor, kind: string, value: string) { return hash(['operations-v1', a.accountId, kind, value]); }
  private async serial<T>(a: OperationActor, work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      if (this.closed || !(await this.storage.refresh()).enabled || !this.storage.records) return unavailable();
      await a.assert(); const lock = await this.storage.acquire();
      try { await lock.assertHeld(); const result = await work(); await lock.assertHeld(); await a.assert(); return result; }
      finally { await lock.close(); }
    });
    this.tail = run.catch(() => undefined); return run;
  }
  private async task(a: OperationActor, taskId: string) {
    await a.assert();
    const r = await this.storage.records!.read(this.key(a, 'task', id(taskId))), t = r.value as Task | undefined;
    if (!t || t.version !== 1 || t.id !== taskId || t.accountId !== a.accountId || t.authority !== a.authority
      || !Array.isArray(t.events) || t.events.length > 64) return unavailable();
    await a.assert(); return { ...r, value: t };
  }
  async begin(token: string, args: Record<string, any>) {
    const a = await this.actor(token, true), requestId = id(args.requestId);
    const taskId = `task-${hash([a.accountId, requestId]).slice(0, 40)}`;
    const context = Object.fromEntries(['sessionId', 'taskKind', 'project', 'computer', 'scene']
      .filter(k => args[k] !== undefined).map(k => [k, id(args[k])]));
    id(context.sessionId); id(context.taskKind);
    context.taskId = taskId;
    const fingerprint = hash([context, a.modelId, a.authority]);
    await this.serial(a, async () => {
      const key = this.key(a, 'task', taskId), r = await this.storage.records!.read(key);
      if (r.value !== undefined) { if ((r.value as Task).fingerprint !== fingerprint) return unavailable(); return; }
      await this.storage.records!.write(key, { version: 1, accountId: a.accountId, authority: a.authority, id: taskId,
        fingerprint, context, events: [] } satisfies Task, r.revision, a.assert);
    });
    // Pin even before the first search. Starting the same task cannot select a later harness.
    let pinned: { cycleId: string; revision: string } | undefined;
    await this.host.runTask(token, context, async () => undefined, selected => { pinned = selected; });
    const delivered = await this.host.deliverContext(token, { ...context, maxChars: 2000 });
    const shown = delivered.packet.harness;
    if (hash(pinned ?? null) !== hash(shown ? { cycleId: shown.cycleId, revision: shown.revision } : null)) return unavailable();
    await this.serial(a, async () => {
      const r = await this.task(a, taskId);
      if (r.value.contextBasis && r.value.contextBasis !== delivered.packet.basis) return unavailable();
      if (!r.value.contextBasis) await this.storage.records!.write(this.key(a, 'task', taskId),
        { ...r.value, contextBasis: delivered.packet.basis }, r.revision, a.assert);
    });
    await a.assert();
    return { task: { id: taskId, sessionProvenance: 'agent_report', effectVerified: false }, ...delivered,
      nextAction: { endpointId: 'wiki.search', arguments: { evolutionTask: taskId, evolutionRequestId: 'unique-request-id' } } };
  }
  async observations(token: string, args: Record<string, any>) {
    const a = await this.actor(token, false), r = await this.task(a, id(args.taskId)), offset = args.offset ?? 0;
    const max = args.maxChars ?? 4000;
    if (!Number.isSafeInteger(max) || max < 1000 || max > 12000) return unavailable();
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > r.value.events.length
      || args.expectedRevision !== undefined && args.expectedRevision !== r.revision) return unavailable();
    const items: Observation[] = [];
    const packet = (next: number) => ({ taskId: r.value.id, revision: r.revision, items, modelTokens: null, effectVerified: false,
      partial: next < r.value.events.length, nextAction: next < r.value.events.length ? {
        endpointId: 'evolution.context', arguments: { op: 'observations', taskId: r.value.id, offset: next, expectedRevision: r.revision,
          ...(next === offset && { maxChars: 12000 }) } } : null });
    for (const requestId of r.value.events.slice(offset, offset + 8)) {
      const event = await this.storage.records!.read(this.key(a, 'event', `${r.value.id}/${requestId}`));
      const v = event.value as Observation;
      if (!v || v.version !== 1 || v.taskId !== r.value.id || v.requestId !== requestId) return unavailable();
      items.push(v);
      if (JSON.stringify(packet(offset + items.length)).length > max) { items.pop(); break; }
    }
    await a.assert();
    return packet(offset + items.length);
  }
  async run<T>(token: string, endpointId: string, args: Record<string, any>, operation: () => Promise<T>): Promise<T> {
    if (!OBSERVED_ENDPOINTS.has(endpointId)) return unavailable();
    const a = await this.actor(token, true), taskId = id(args.evolutionTask), requestId = id(args.evolutionRequestId);
    const { accessToken: _token, evolutionTask: _task, evolutionRequestId: _request, ...input } = args;
    const fingerprint = hash([a.accountId, taskId, endpointId, input]);
    const key = this.key(a, 'event', `${taskId}/${requestId}`);
    const t = await this.serial(a, async () => {
      const task = await this.task(a, taskId), prior = await this.storage.records!.read(key);
      // Do not replay output or rerun after a lost response. Caller can inspect the receipt.
      if (prior.value !== undefined) throw Error('Observation already exists; read evolution.context observations before retrying with a new request ID');
      if (task.value.events.length >= 64) return unavailable();
      const measurementScope = endpointId === 'continuity.resume' ? 'continuity_server' : endpointId.startsWith('memory.') ? 'memory_server' : 'search_server';
      const event: Observation = { version: 1, taskId, requestId, fingerprint, endpointId, state: 'started', measurementScope, effectVerified: false };
      await this.storage.records!.write(key, event, prior.revision, a.assert);
      await this.storage.records!.write(this.key(a, 'task', taskId), { ...task.value, events: [...task.value.events, requestId] }, task.revision, a.assert);
      return task.value;
    });
    const start = performance.now();
    try {
      let selectedHarness: Observation['selectedHarness'];
      const result = await this.host.runTask(token, t.context, operation, selected => { selectedHarness = selected; });
      const body = JSON.stringify(result);
      let data: any;
      try { data = JSON.parse((result as any)?.content?.[0]?.text); } catch { /* no structured revision */ }
      const rows = Array.isArray(data) ? data : [data, ...Array.isArray(data?.results) ? data.results : []];
      const evidence = memoryObservation(endpointId, result);
      const resourceRevisions = [...new Set<string>(evidence ? evidence.resources.map(row => row.revision)
        : rows.slice(0, 32).flatMap(row => [row?.rv, row?.revision]).filter(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)))];
      const documents = deliveredDocuments(endpointId, result);
      const documentDelivery: CurationDelivery | undefined = documents.length ? {
        actor: curationActor(a.accountId), eventId: hash([a.accountId, taskId, requestId]), observedAt: Date.now(), documents } : undefined;
      await this.finish(a, key, { state: (result as any)?.isError ? 'failed' : 'completed', returnedChars: body.length,
        returnedBytes: Buffer.byteLength(body), elapsedMs: performance.now() - start, resultHash: hash(result), resourceRevisions,
        ...(evidence && { evidence }),
        ...(documentDelivery && { documentDelivery }),
        ...(selectedHarness && { selectedHarness }) });
      // Canonical completion is durable first. Loss of the advisory index cannot
      // rerun the operation, invent disuse or claim the agent retained/used it.
      await a.assert();
      if (documentDelivery) await this.deliverySink?.recordCurationDelivery?.(documentDelivery).catch(() => {});
      await a.assert(); return result;
    } catch (error) {
      await this.finish(a, key, { state: 'failed', elapsedMs: performance.now() - start }).catch(() => {});
      throw error;
    }
  }
  private finish(a: OperationActor, key: string, patch: Partial<Observation>) {
    return this.serial(a, async () => {
      const r = await this.storage.records!.read(key), prior = r.value as Observation;
      if (!prior || prior.state !== 'started') return unavailable();
      await this.storage.records!.write(key, { ...prior, ...patch }, r.revision, a.assert);
    });
  }
  async close() { this.closed = true; await this.tail; }
}
