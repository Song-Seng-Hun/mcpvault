import type { FileSystemService, MoveRecoveryCapture } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { validateMaintenanceConfig, MAX_MAINTENANCE_STATE_BYTES, type MaintenanceHost, type MaintenanceOperation, type MaintenanceConfig, type MaintenanceWriter } from './maintenance-host.js';
import type { MoveNoteParams } from './types.js';
import type { VaultCatalogChange } from './vault-catalog.js';
import { createHash, randomUUID } from 'node:crypto';
import { AsyncResource } from 'node:async_hooks';
import { isModerationHidden } from './moderation-policy.js';
import { isOriginalPath } from './original-boundary.js';

export interface MaintenanceWriteIntent { before: string; after: string; previousRevision: string; revision: string }
export interface MaintenanceDerivedAdapter {
  inspect(operation: MaintenanceOperation, path: string, principal: ScopePrincipal): Promise<{ fingerprint: string; revision: string; needed: boolean }>;
  repair(operation: MaintenanceOperation, path: string, principal: ScopePrincipal, assertAccess: () => Promise<void>,
    recordIntent: (intent: MaintenanceWriteIntent) => Promise<void>, expected: { fingerprint: string; revision: string }, assertCurrent?: () => void): Promise<{ revision: string }>;
}
export interface MaintenanceOptions {
  fs: FileSystemService;
  access: ScopeAccessPolicy;
  host?: MaintenanceHost;
  authorize: (accountId: string, operation: MaintenanceOperation) => Promise<ScopePrincipal | undefined>;
  schedule?: (callback: () => void) => () => void;
  derived?: MaintenanceDerivedAdapter;
  runAs?: <T>(principal: ScopePrincipal, operation: () => Promise<T>) => Promise<T>;
}

type Status = 'capturing' | 'queued' | 'applying' | 'failed' | 'stopped' | 'review_required' | 'verified';
interface Job {
  id: string; accountId: string; operation: MaintenanceOperation; path: string;
  fingerprint: string; revision: string; epoch: string; status: Status; attempts: number;
  move?: Omit<MoveRecoveryCapture, 'references'> & { reference: MoveRecoveryCapture['references'][number] };
  intent?: MaintenanceWriteIntent;
  resultRevision?: string;
  reason?: string;
}
interface State { version: 1; jobs: Job[] }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const MAX_JOBS = 64;
const ordinary = (path: string, frontmatter: Record<string, unknown>) => !isOriginalPath(path)
  && !/^(?:Community|PublicCommunity|_wiki|_collaboration)(?:\/|$)/i.test(path)
  && frontmatter.llm_wiki_type === 'knowledge' && frontmatter.immutable !== true && !isModerationHidden(frontmatter);

/** A private serialized host worker. Receipts attest exact past writes, never
 * present truth or permission. Unknown history is retained for review. */
export class MaintenanceService {
  private readonly epoch = randomUUID();
  private readonly resource = new AsyncResource('MCPVaultMaintenance');
  private readonly observed = new Map<string, number>();
  private state: State = { version: 1, jobs: [] };
  private writer: MaintenanceWriter | undefined;
  private initialized = false;
  private closed = false;
  private fatal = false;
  private tail: Promise<unknown> = Promise.resolve();
  private cancel: (() => void) | undefined;
  private dispose?: () => void;
  private pendingPaths = new Set<string>();
  private reconcile = false;
  private historyDirty = false;
  constructor(private readonly options: MaintenanceOptions) {
    if (options.host) this.dispose = options.fs.observeNoteChanges(path => {
      const key = options.fs.noteChangeIdentity(path);
      if (this.observed.has(key)) this.observed.set(key, this.observed.get(key)! + 1);
      for (const job of this.state.jobs) if (job.move && options.fs.noteChangeIdentity(job.move.oldPath) === key
        && ['queued', 'applying', 'failed'].includes(job.status)) { job.status = 'review_required'; job.reason = 'old_path_changed'; this.historyDirty = true; }
    });
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(operation, operation);
    this.tail = pending.catch(() => undefined); return pending;
  }
  private async config(): Promise<MaintenanceConfig | undefined> {
    if (!this.options.host || this.closed || this.fatal) return undefined;
    const config = validateMaintenanceConfig(await this.options.host.refresh());
    return config.enabled ? config : undefined;
  }
  private async initialize() {
    if (this.initialized) return;
    const host = this.options.host!;
    this.writer = await host.acquire();
    try {
      const raw = await host.readState();
      if (raw !== undefined) this.state = this.validateState(raw);
      this.initialized = true;
    } catch (error) { this.fatal = true; await this.writer.close(); this.writer = undefined; throw error; }
  }
  private validateState(raw: unknown): State {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Maintenance history invalid; preserve for host review');
    const state = raw as State;
    if (state.version !== 1 || !Array.isArray(state.jobs) || state.jobs.length > MAX_JOBS
      || Buffer.byteLength(JSON.stringify(raw)) > MAX_MAINTENANCE_STATE_BYTES) throw new Error('Maintenance history exceeds its contract');
    const ids = new Set<string>();
    for (const job of state.jobs) {
      if (!job || !sha(job.id) || ids.has(job.id) || !sha(job.fingerprint) || !sha(job.revision)
        || typeof job.epoch !== 'string' || !Number.isInteger(job.attempts) || job.attempts < 0 || job.attempts > 3
        || !['capturing','queued','applying','failed','stopped','review_required','verified'].includes(job.status)) throw new Error('Maintenance receipt invalid');
      validateMaintenanceConfig({ version: 1, enabled: true, accountId: job.accountId, paths: [job.path], operations: [job.operation] });
      ids.add(job.id);
      if (job.intent && (!sha(job.intent.previousRevision) || !sha(job.intent.revision)
        || typeof job.intent.before !== 'string' || typeof job.intent.after !== 'string'
        || digest(job.intent.before) !== job.intent.previousRevision || digest(job.intent.after) !== job.intent.revision)) throw new Error('Maintenance recovery bytes mismatch');
      if (job.operation === 'moved_link_repair') {
        const move = job.move;
        if (!move || move.version !== 1 || move.destinationRevision !== 'missing' || !sha(move.sourceRevision)
          || move.reference?.path !== job.path || !job.intent || move.reference.before !== job.intent.before
          || move.reference.after !== job.intent.after || move.reference.previousRevision !== job.intent.previousRevision
          || move.reference.revision !== job.intent.revision || !Array.isArray(move.reference.links)
          || !Array.isArray(move.reference.properties)) throw new Error('Maintenance move history incomplete');
        validateMaintenanceConfig({ version: 1, enabled: true, accountId: job.accountId,
          paths: [move.oldPath, move.newPath, job.path], operations: ['moved_link_repair'] });
      }
    }
    return structuredClone(state);
  }
  private async save() {
    this.historyDirty = false;
    try { await this.writer!.assertHeld(); await this.options.host!.writeState(this.state); }
    catch (error) { this.fatal = true; throw error; }
  }
  private async authority(job: Pick<Job, 'accountId' | 'operation' | 'path' | 'move'>): Promise<ScopePrincipal> {
    const config = await this.config();
    const paths = [job.path, ...(job.move ? [job.move.oldPath, job.move.newPath] : [])];
    const granted = (current: MaintenanceConfig | undefined) => current && current.accountId === job.accountId
      && current.operations.includes(job.operation) && paths.every(path => current.paths.includes(path));
    if (!granted(config)) throw new Error('Maintenance host approval unavailable');
    const principal = await this.options.authorize(job.accountId, job.operation);
    if (!principal || principal.accountId !== job.accountId) throw new Error('Maintenance current document authority unavailable');
    await this.writer!.assertHeld();
    // Account/lease IO may yield while the host removes just one grant. Enabled
    // alone is not permission: revalidate the complete job grant at admission.
    if (!granted(await this.config())) throw new Error('Maintenance host approval changed');
    if (paths.some(path => !this.options.access.canAccessPhysicalPath(path, principal))) throw new Error('Maintenance current document authority unavailable');
    return principal;
  }
  private runAs<T>(principal: ScopePrincipal, operation: () => Promise<T>): Promise<T> {
    return this.options.runAs ? this.options.runAs(principal, operation) : operation();
  }
  private schedule() {
    if (this.cancel || this.closed || this.fatal || !this.options.host) return;
    this.resource.runInAsyncScope(() => {
      const schedule = this.options.schedule || ((callback: () => void) => { const timer = setTimeout(callback, 100); timer.unref(); return () => clearTimeout(timer); });
      this.cancel = schedule(() => { this.cancel = undefined; void this.flush().catch(() => { this.fatal = true; }); });
    });
  }
  async move(params: MoveNoteParams, principal?: ScopePrincipal) {
    return this.serial(async () => {
      if (this.closed) throw new Error('Maintenance worker is closed');
      const canAccess = (path: string) => this.options.access.canAccessPhysicalPath(path, principal);
      let config: MaintenanceConfig | undefined;
      try { config = await this.config(); if (config) await this.initialize(); }
      catch { this.fatal = true; }
      if (!config || this.fatal || !principal || config.accountId !== principal.accountId || !config.operations.includes('moved_link_repair')) return this.options.fs.moveNote(params, canAccess);
      const captured: Job[] = [];
      let oldKey: string | undefined, startingEvents = 0;
      const result = await this.options.fs.moveNoteWithRecovery(params, canAccess, async capture => {
        if (this.state.jobs.length + capture.references.length > MAX_JOBS) throw new Error('Maintenance receipt capacity reached');
        const moveId = randomUUID();
        const jobs: Job[] = capture.references.map(reference => ({
          id: digest(moveId + '\0' + reference.path), accountId: config!.accountId, operation: 'moved_link_repair', path: reference.path,
          fingerprint: digest(JSON.stringify({ moveId, capture: { ...capture, references: [reference] } })),
          revision: reference.previousRevision, epoch: this.epoch, status: 'capturing', attempts: 0,
          move: { version: 1, oldPath: capture.oldPath, newPath: capture.newPath, sourceRevision: capture.sourceRevision,
            destinationRevision: 'missing', reference },
          intent: { before: reference.before, after: reference.after, previousRevision: reference.previousRevision, revision: reference.revision },
        }));
        for (const job of jobs) await this.authority(job);
        if (Buffer.byteLength(JSON.stringify({ version: 1, jobs: [...this.state.jobs, ...jobs] })) > MAX_MAINTENANCE_STATE_BYTES) throw new Error('Maintenance recovery storage full');
        this.state.jobs.push(...jobs); await this.save(); captured.push(...jobs);
        oldKey = this.options.fs.noteChangeIdentity(capture.oldPath); startingEvents = this.observed.get(oldKey) || 0;
        this.observed.set(oldKey, startingEvents);
      });
      if (captured.length) {
        for (const job of captured) {
          try {
            if (!result.success || job.status !== 'capturing' || this.observed.get(oldKey!) !== startingEvents + 1) throw new Error('Move observation incomplete');
            await this.authority(job);
            if (await this.options.fs.noteExists(job.move!.oldPath)
              || (await this.options.fs.readNote(job.move!.newPath, 128 * 1024)).revision !== job.move!.sourceRevision) throw new Error('Move state changed');
            if (job.status !== 'capturing' || this.observed.get(oldKey!) !== startingEvents + 1) throw new Error('Move observation changed during verification');
            job.status = 'queued';
          } catch { job.status = 'review_required'; job.reason = 'move_not_verified'; }
        }
        try { await this.save(); this.schedule(); } catch { /* User's completed move remains completed; no autonomous repair. */ }
      }
      return result;
    });
  }
  async notify(changes?: readonly VaultCatalogChange[]) {
    if (!this.options.host || this.closed || this.fatal) return;
    if (!changes) {
      this.reconcile = true;
      this.invalidateMoveObservation();
    } else for (const change of changes.slice(0, 256)) {
      if (this.pendingPaths.has(change.path) || this.pendingPaths.size < 128) this.pendingPaths.add(change.path);
      else { this.reconcile = true; this.invalidateMoveObservation(); }
      for (const job of this.state.jobs) if (job.move && ['queued','applying','failed'].includes(job.status)
        && this.options.fs.noteChangeIdentity(change.path) === this.options.fs.noteChangeIdentity(job.move.oldPath)) {
        job.status = 'review_required'; job.reason = 'old_path_event_requires_review'; this.historyDirty = true;
      }
    }
    if (changes && changes.length > 256) { this.reconcile = true; this.invalidateMoveObservation(); }
    this.schedule();
  }
  private invalidateMoveObservation() {
    for (const job of this.state.jobs) if (job.move && ['capturing','queued','applying','failed'].includes(job.status)) {
      job.status = 'review_required'; job.reason = 'observation_gap';
      this.historyDirty = true;
    }
  }
  async flush() {
    this.cancel?.(); this.cancel = undefined;
    return this.serial(() => this.resource.runInAsyncScope(async () => {
      const config = await this.config(); if (!config) return;
      await this.initialize();
      if (this.historyDirty) await this.save();
      if (this.options.derived) {
        // Source edits arrive under note paths, not their derived Canvas output.
        // Reinspect only explicitly configured maps; never discover new outputs.
        const candidates = config.paths.filter(path => this.reconcile || this.pendingPaths.has(path)
          || this.pendingPaths.size > 0 && /\.canvas$/i.test(path) && config.operations.includes('managed_canvas_regenerate'));
        this.reconcile = false; this.pendingPaths.clear();
        for (const path of candidates.slice(0, 128)) for (const operation of config.operations.filter(op => op !== 'moved_link_repair')) {
          if (this.state.jobs.length >= MAX_JOBS) break;
          try {
            const principal = await this.authority({ accountId: config.accountId, operation, path });
            const snapshot = await this.runAs(principal, () => this.options.derived!.inspect(operation, path, principal));
            if (!snapshot.needed || !sha(snapshot.fingerprint) || !sha(snapshot.revision)) continue;
            const id = digest(JSON.stringify([operation, path, snapshot.fingerprint, config.accountId]));
            if (this.state.jobs.some(job => job.id === id)) continue;
            this.state.jobs.push({ id, accountId: config.accountId, operation, path, fingerprint: snapshot.fingerprint,
              revision: snapshot.revision, epoch: this.epoch, status: 'queued', attempts: 0 }); await this.save();
          } catch { /* Unverifiable derived candidates remain diagnostic only. */ }
        }
      }
      for (const job of this.state.jobs) {
        if (this.closed || this.fatal) break;
        if (['verified','review_required','stopped'].includes(job.status)) continue;
        try {
          const principal = await this.authority(job);
          await this.runAs(principal, async () => {
            if (job.epoch !== this.epoch) {
              if (job.status === 'applying' && job.intent && await this.currentRevision(job.path) === job.intent.revision) {
                await this.authority(job); this.assertCurrentJob(job); job.status = 'verified'; job.resultRevision = job.intent.revision;
              } else { job.status = 'review_required'; job.reason = 'restart_requires_review'; }
              await this.save(); return;
            }
            if (job.status === 'capturing') { job.status = 'review_required'; job.reason = 'incomplete_move'; await this.save(); return; }
            if (job.move) await this.repairMove(job);
            else await this.repairDerived(job, principal);
          });
        } catch {
          if (this.fatal) break;
          if (job.status !== 'review_required') { job.attempts++; job.status = job.attempts >= 3 ? 'stopped' : 'failed'; job.reason = 'repair_not_verified'; }
          try { if (await this.config()) await this.save(); } catch { this.fatal = true; }
        }
      }
      if (this.historyDirty && !this.closed && !this.fatal) await this.save();
    }));
  }
  private async currentRevision(path: string) {
    return /\.canvas$/i.test(path) ? (await this.options.fs.readCanvasFile(path)).revision : (await this.options.fs.readNote(path, 256 * 1024)).revision;
  }
  private async repairMove(job: Job) {
    const move = job.move!, ref = move.reference;
    const assertAccess = async () => {
      await this.authority(job);
      if (job.status === 'review_required') throw new Error('Move observation invalidated');
      const source = await this.options.fs.readNote(move.newPath, 128 * 1024);
      const reference = await this.options.fs.readNote(job.path, 128 * 1024);
      if (!ordinary(move.newPath, source.frontmatter) || !ordinary(job.path, reference.frontmatter)) throw new Error('Only ordinary knowledge may be repaired');
    };
    await assertAccess();
    if (await this.options.fs.noteExists(move.oldPath) || (await this.options.fs.readNote(move.newPath, 128 * 1024)).revision !== move.sourceRevision) {
      job.status = 'review_required'; job.reason = 'move_target_changed'; await this.save(); return;
    }
    const current = await this.options.fs.readNote(job.path, 128 * 1024);
    if (current.revision !== ref.previousRevision && !(job.status === 'applying' && current.revision === ref.revision)) {
      job.status = 'review_required'; job.reason = 'reference_changed'; await this.save(); return;
    }
    if (current.revision !== ref.revision) {
      const changes = [{ path: job.path, expectedRevision: ref.previousRevision, patches: [{ oldString: ref.before, newString: ref.after }] }];
      const policy = { guards: [{ path: move.oldPath, expectedRevision: 'missing' }, { path: move.newPath, expectedRevision: move.sourceRevision }], assertAccess,
        assertCurrent: () => this.assertCurrentJob(job) };
      const preview = await this.options.fs.patchMultipleNotes({ changes, dryRun: true }, path => this.options.access.toPublicPath(path), policy);
      if (preview.changes[0]?.revision !== ref.revision) throw new Error('Recorded move plan differs from preview');
      if (this.closed || this.fatal || !['queued', 'failed', 'applying'].includes(job.status)) throw new Error('Move observation changed during preview');
      job.status = 'applying'; await this.save();
      await this.options.fs.patchMultipleNotes({ changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint }, path => this.options.access.toPublicPath(path), policy);
    }
    await assertAccess();
    if ((await this.options.fs.readNote(job.path, 128 * 1024)).revision !== ref.revision) throw new Error('Move repair reread changed');
    this.assertCurrentJob(job);
    job.status = 'verified'; job.resultRevision = ref.revision; await this.save();
  }
  private async repairDerived(job: Job, principal: ScopePrincipal) {
    const derived = this.options.derived;
    if (!derived) { job.status = 'review_required'; job.reason = 'derived_adapter_unavailable'; await this.save(); return; }
    const current = await derived.inspect(job.operation, job.path, principal);
    if (current.fingerprint !== job.fingerprint || current.revision !== job.revision) { job.status = 'review_required'; job.reason = 'derived_inputs_changed'; await this.save(); return; }
    const assertAccess = async () => { await this.authority(job); };
    job.status = 'applying'; await this.save();
    const result = await derived.repair(job.operation, job.path, principal, assertAccess, async intent => {
      if (digest(intent.before) !== intent.previousRevision || digest(intent.after) !== intent.revision || intent.previousRevision !== job.revision) throw new Error('Derived recovery intent mismatch');
      job.intent = intent; await this.save();
    }, { fingerprint: job.fingerprint, revision: job.revision }, () => this.assertCurrentJob(job));
    await assertAccess();
    if (await this.currentRevision(job.path) !== result.revision) throw new Error('Derived repair reread changed');
    this.assertCurrentJob(job);
    job.status = 'verified'; job.resultRevision = result.revision; await this.save();
  }
  async close() {
    if (this.closed) return;
    this.closed = true; this.cancel?.(); this.cancel = undefined; this.dispose?.();
    try { await this.tail; await this.writer?.close(); } finally { this.resource.emitDestroy(); }
  }
  private assertCurrentJob(job: Job) {
    if (this.closed || this.fatal || job.status !== 'applying') throw new Error('Maintenance dispatch observation is no longer current');
  }
}
