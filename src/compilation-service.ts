import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { CompilationHost } from './compilation-host.js';
import { GRAPH_CONTRACT_VERSION } from './graph-contract.js';
import { isModerationHidden } from './moderation-policy.js';
import { isMissingVaultPath } from './vault-read-errors.js';
import { inspectCompilationPolicy, validateCompilationConfig, compilationHash, compilationPath, type CompilationRuntime,
  type CompilationOperation, type CompilationConfig } from './compilation-policy.js';
import { parseCompilationHistory, compilationContentHash, compilationId, compilationJobRevision, isCompilationRevision,
  compilationValidationBasis, compilationReceiptBasis,
  type CompilationJob, type CompilationIntent, type CompilationStatus } from './compilation-model.js';

export interface CompilationAdapter {
  /** Code-owned deterministic checks, not an incoming client's success assertion. */
  check(job: Readonly<CompilationJob>, assertCurrent: () => Promise<void>): Promise<{ status: 'passed' | 'partial'; ruleVersion: string }>;
  protect(job: Readonly<CompilationJob>, assertCurrent: () => Promise<void>): Promise<void>;
  preview(job: Readonly<CompilationJob>, assertCurrent: () => Promise<void>): Promise<CompilationIntent>;
  /** Must delegate to the publication/change-set service with revision/authority guards. */
  apply(job: Readonly<CompilationJob>, intent: CompilationIntent, assertCurrent: () => Promise<void>): Promise<unknown>;
}
export interface CompilationOptions {
  fs: FileSystemService; access: ScopeAccessPolicy; host?: CompilationHost; readOnly?: boolean;
  authorize(accountId: string): Promise<ScopePrincipal | undefined>;
  runtime?(principal: ScopePrincipal, operation: CompilationOperation, paths: readonly string[]): Promise<CompilationRuntime | undefined>;
  adapter?: CompilationAdapter;
  /** Trusted restriction-only store; persists inherited policy before accepting draft bytes. */
  protectSources?(job: Readonly<CompilationJob>, assertCurrent: () => Promise<void>): Promise<void>;
}
export interface CompilationParams {
  op?: string; requestId?: string; projectId?: string; operation?: CompilationOperation;
  inputs?: Array<{ path: string; expectedRevision: string; role: 'source' | 'member' | 'concept' | 'topic' }>;
  outputPath?: string; expectedOutputRevision?: string; expectedJobRevision?: string; content?: string; maxChars?: number;
}
const unavailable = () => Error('Compilation unavailable; revalidate current authorization and inputs');
const actorBasis = (p?: ScopePrincipal) => p && compilationHash({ account: p.accountId, model: p.modelId, agent: p.agentId,
  user: p.userId, center: p.commandCenterId, capabilities: p.capabilities, enterprise: p.enterprise });

/** Host-owned bounded journal. No scheduler, model invocation or raw Vault writer.
 * Every entry point reauthorizes; checkpoints are never bearer access grants. */
export class CompilationService {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private pendingPaths = new Set<string>();
  private pendingReconcile = false;
  private notificationTask: Promise<void> | undefined;
  constructor(private readonly options: CompilationOptions) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(operation, operation); this.tail = pending.catch(() => undefined); return pending;
  }
  async close(): Promise<void> { this.closed = true; await this.tail; }
  private async actor(principal?: ScopePrincipal): Promise<ScopePrincipal> {
    if (!principal) throw unavailable();
    const current = await this.options.authorize(principal.accountId);
    if (!current || actorBasis(current) !== actorBasis(principal) || !current.capabilities?.includes('write')) throw unavailable();
    return current;
  }
  private async revision(path: string, principal: ScopePrincipal, allowMissing = false): Promise<string> {
    const { fs, access } = this.options;
    if (!access.canAccessPhysicalPath(path, principal, false)) throw unavailable();
    try {
      const note = (await fs.readNoteMetadata([path], p => access.canAccessPhysicalPath(p, principal, false), { fresh: true, maxBytes: 8 * 1024 * 1024 }))[0];
      if (!note) {
        if (allowMissing && !await fs.noteExists(path)) return 'missing';
        throw unavailable();
      }
      if (!note.revision || isModerationHidden(note.frontmatter) || !access.canAccessPhysicalPath(path, principal, false)) throw unavailable();
      return note.revision;
    } catch (error) { if (allowMissing && isMissingVaultPath(error)) return 'missing'; throw unavailable(); }
  }
  private async gate(config: CompilationConfig, job: Pick<CompilationJob, 'projectId' | 'inputs' | 'outputPath' | 'operation'>, principal: ScopePrincipal) {
    const paths = job.inputs.map(input => input.path);
    const base = { config, projectId: job.projectId, principal, access: this.options.access, paths, outputPath: job.outputPath, operation: job.operation };
    const admission = inspectCompilationPolicy(base);
    // Even the host verifier receives only already-admitted source identities.
    if (admission.status !== 'waiting_runtime') return admission;
    const runtime = await this.options.runtime?.(principal, job.operation, paths);
    return inspectCompilationPolicy({ ...base, ...(runtime && { runtime }) });
  }
  private projection(job: CompilationJob, maxChars: number, override?: { status: CompilationStatus; reason: string }) {
    const result = { requestId: job.requestId, status: override?.status ?? job.status, jobRevision: compilationJobRevision(job),
      ...(override?.reason || job.reason ? { reason: override?.reason ?? job.reason } : {}),
      ...(job.receipt && !override && { outputRevision: job.receipt.outputRevision }),
      ...(['partial', 'review_required'].includes(override?.status ?? job.status) && { partial: true,
        nextAction: { endpointId: 'wiki.compilation', arguments: { op: 'read', requestId: job.requestId, maxChars: 4000 } } }) };
    if (JSON.stringify(result).length <= maxChars) return result;
    return { requestId: job.requestId, status: result.status, jobRevision: result.jobRevision, partial: true };
  }
  execute(params: CompilationParams, principal?: ScopePrincipal, protectSources = this.options.protectSources): Promise<any> {
    if (this.closed) return Promise.reject(Error('Compilation service closed'));
    return this.serial(async () => {
      try { return await this.run(params, principal, protectSources); }
      catch (error) {
        // JSON/filesystem/provider exceptions can quote private bytes or host
        // paths. Never let them reach endpoint output or the shared audit log.
        if (error instanceof Error && error.message === 'Compilation history unavailable; preserve it for host review') throw error;
        throw unavailable();
      }
    });
  }
  private async run(params: CompilationParams, principal: ScopePrincipal | undefined, protectSources: CompilationOptions['protectSources']): Promise<any> {
    const op = params.op ?? 'diagnose', maxChars = params.maxChars ?? 4000;
    if (!['diagnose', 'prepare', 'read', 'submit', 'check', 'retry'].includes(op) || !Number.isInteger(maxChars) || maxChars < 512 || maxChars > 12000) throw Error('Invalid compilation operation or response budget');
    if (this.options.readOnly && !['diagnose', 'read'].includes(op)) throw Error('Compilation mutations disabled in read-only mode');
    const host = this.options.host;
    if (!host) return { status: 'diagnostic_only', reason: 'host_configuration_required' };
    const config = validateCompilationConfig(await host.refresh());
    if (!config.enabled) return { status: 'diagnostic_only', reason: 'host_configuration_required' };
    principal = await this.actor(principal);
    if (config.accountId !== principal.accountId) throw unavailable();
    if (op === 'diagnose') return { status: 'diagnostic_only', reason: 'prepare_exact_revision_plan', automaticApplication: Boolean(this.options.adapter) };
    if (!compilationId(params.requestId)) throw Error('Compilation requires a stable requestId');
    const writer = ['read'].includes(op) ? undefined : await host.acquire();
    try {
      const state = parseCompilationHistory(await host.readState());
      let job = state.jobs.find(job => job.requestId === params.requestId);
      const save = async () => {
        await this.actor(principal); await writer?.assertHeld();
        parseCompilationHistory(state); await host.writeState(state);
        await this.actor(principal); await writer?.assertHeld();
        if (job && ![job.outputPath, ...job.inputs.map(input => input.path)].every(path => this.options.access.canAccessPhysicalPath(path, principal, false))) throw unavailable();
        // A persisted receipt describes its basis at the time of writing, not a
        // guarantee the basis survived that await. Never return fresh success
        // until all inputs/output/runtime/rules have been checked again.
        if (job && !['review_required', 'failed', 'stopped', 'partial'].includes(job.status)) await this.assertCurrent(job, principal!);
      };
      if (op === 'prepare') {
        if (!compilationId(params.projectId) || !params.operation || !Array.isArray(params.inputs) || !params.inputs.length || params.inputs.length > 8) throw Error('Compilation requires bounded explicit dependencies');
        const inputs = params.inputs.map(input => {
          if (!isCompilationRevision(input.expectedRevision) || !['source', 'member', 'concept', 'topic'].includes(input.role)) throw Error('Compilation requires exact dependency revisions and roles');
          return { path: compilationPath(input.path), revision: input.expectedRevision, role: input.role };
        });
        const outputPath = compilationPath(params.outputPath);
        if (new Set(inputs.map(i => i.path.toLowerCase())).size !== inputs.length || inputs.some(i => i.path.toLowerCase() === outputPath.toLowerCase())
          || params.expectedOutputRevision !== 'missing' && !isCompilationRevision(params.expectedOutputRevision)) throw Error('Invalid compilation output or dependency identity');
        const requestFingerprint = compilationHash({ projectId: params.projectId, operation: params.operation, inputs, outputPath, outputRevision: params.expectedOutputRevision });
        if (job && job.requestFingerprint !== requestFingerprint) throw Error('Compilation requestId already binds different inputs');
        const provisional = { projectId: params.projectId, operation: params.operation, inputs, outputPath };
        const admission = await this.gate(config, provisional, principal);
        if (admission.status === 'unavailable') throw unavailable();
        if (admission.status !== 'ready') return admission;
        for (const input of inputs) if (await this.revision(input.path, principal) !== input.revision) throw unavailable();
        const outputRevision = await this.revision(outputPath, principal, true);
        if (job) {
          const changed = await this.drift(job, principal, admission);
          await this.actor(principal);
          return this.projection(job, maxChars, changed ? { status: 'review_required', reason: changed }
            : job.protection === 'pending' ? { status: 'review_required', reason: 'protection_incomplete' } : undefined);
        }
        if (outputRevision !== params.expectedOutputRevision) throw unavailable();
        const managed = [...state.jobs].reverse().find(j => j.outputPath.toLowerCase() === outputPath.toLowerCase() && j.applied);
        if ((outputRevision !== 'missing' || managed) && managed?.applied?.outputRevision !== outputRevision) return { status: 'review_required', reason: 'unmanaged_or_edited_output' };
        if (state.jobs.some(j => j.requestFingerprint === requestFingerprint && j.attempts >= 3)) return { status: 'review_required', reason: 'prior_attempts_exhausted' };
        if (state.jobs.length >= 64 || state.jobs.some(j => j.outputPath.toLowerCase() === outputPath.toLowerCase() && !['completed', 'review_required', 'stopped'].includes(j.status))) throw Error('Compilation queue requires host review before adding work');
        job = { ...provisional, requestId: params.requestId, requestFingerprint, accountId: principal.accountId, outputRevision,
          ruleVersion: config.projects.find(p => p.id === params.projectId)!.ruleVersion, graphContractVersion: GRAPH_CONTRACT_VERSION,
          authorityFingerprint: admission.fingerprint, status: 'prepared', attempts: 0, protection: 'pending' };
        // This restriction/basis header precedes any future private draft body.
        state.jobs.push(job);
        await this.assertCurrent(job, principal); await save();
        if (protectSources) {
          await protectSources(structuredClone(job), () => this.assertCurrent(job!, principal!));
          await this.actor(principal);
          const protectedAdmission = await this.gate(validateCompilationConfig(await host.refresh()), job, principal);
          if (protectedAdmission.status !== 'ready' || protectedAdmission.sourceFingerprint !== admission.sourceFingerprint) throw unavailable();
          // Only this deliberate restriction-only step may update the target's
          // policy basis. Original/rule/runtime/membership authority stays pinned.
          job.authorityFingerprint = protectedAdmission.fingerprint;
          await this.assertCurrent(job, principal); await save();
        }
        if (job.inputs.some(input => !this.options.access.canReferenceFrom(job!.outputPath, input.path))) {
          job.status = 'review_required'; job.reason = 'source_restrictions_required'; await save();
        } else { job.protection = 'ready'; await save(); }
        await this.assertCurrent(job, principal); return this.projection(job, maxChars);
      }
      if (!job || job.accountId !== principal.accountId) throw unavailable();
      const admission = await this.gate(config, job, principal);
      if (admission.status === 'unavailable') throw unavailable();
      if (admission.status === 'diagnostic_only') return admission;
      if (op !== 'read' && params.expectedJobRevision !== compilationJobRevision(job)) throw Error('Compilation job revision changed; read again');
      const drift = await this.drift(job, principal, admission) ?? (job.protection === 'pending' ? 'protection_incomplete' : undefined);
      if (op === 'read') {
        await this.actor(principal);
        const latest = await this.gate(validateCompilationConfig(await host.refresh()), job, principal);
        if (latest.status === 'unavailable') throw unavailable();
        await this.actor(principal);
        return this.projection(job, maxChars, drift ? { status: 'review_required', reason: drift }
          : latest.status !== 'ready' || latest.fingerprint !== job.authorityFingerprint ? { status: 'review_required', reason: 'authority_or_rule_changed' } : undefined);
      }
      if (drift) { if (job.status !== 'review_required' || job.reason !== drift) { job.status = 'review_required'; job.reason = drift; await save(); } return this.projection(job, maxChars); }
      const recoverApplied = op === 'retry' && job.intent && await this.revision(job.outputPath, principal, true) === job.intent.revision;
      if (['completed', 'review_required'].includes(job.status) || job.status === 'stopped' && !recoverApplied) return this.projection(job, maxChars);
      if (op === 'submit') {
        if (job.operation !== 'synthesize' || job.intent || job.draft || typeof params.content !== 'string' || !params.content.trim() || params.content.length > 24000) throw Error('Compilation accepts one bounded generated draft before application');
        await this.assertCurrent(job, principal);
        job.draft = { content: params.content, fingerprint: compilationContentHash(params.content) }; job.status = 'generated'; delete job.reason;
        await save(); return this.projection(job, maxChars);
      }
      const adapter = this.options.adapter;
      if (!job.draft || !adapter) {
        if (job.status !== 'partial' || job.reason !== 'validation_unavailable') { job.status = 'partial'; job.reason = 'validation_unavailable'; await save(); }
        return this.projection(job, maxChars);
      }
      const assertCurrent = () => this.assertCurrent(job!, principal!);
      const snapshot = () => structuredClone(job!);
      if (!job.intent) {
        const validation = await adapter.check(snapshot(), assertCurrent); await assertCurrent();
        if (!['passed', 'partial'].includes(validation.status) || !compilationId(validation.ruleVersion)) throw Error('Invalid compilation validation receipt');
        job.validation = { ...validation, basis: compilationValidationBasis(job) }; job.status = validation.status === 'passed' ? 'checked' : 'partial';
        delete job.reason; await save();
        if (op === 'check' || validation.status !== 'passed') return this.projection(job, maxChars);
      }
      if (op === 'check') return this.projection(job, maxChars);
      if (job.attempts >= 3 && !recoverApplied) { job.status = 'stopped'; await save(); return this.projection(job, maxChars); }
      const priorIntent = job.intent;
      if (!priorIntent || await this.revision(job.outputPath, principal, true) !== priorIntent.revision) {
        await adapter.protect(snapshot(), assertCurrent); await assertCurrent();
        const intent = await adapter.preview(snapshot(), assertCurrent); await assertCurrent();
        if (!isCompilationRevision(intent.revision) || !isCompilationRevision(intent.fingerprint)) throw Error('Invalid compilation application intent');
        job.intent = intent; job.status = 'applying'; job.attempts++; await save();
        try { await adapter.apply(snapshot(), intent, assertCurrent); }
        catch {
          await this.actor(principal);
          job.status = job.attempts >= 3 ? 'stopped' : 'failed'; job.reason = 'application_interrupted'; await save();
          return this.projection(job, maxChars);
        }
      }
      await assertCurrent();
      if (await this.revision(job.outputPath, principal, true) !== job.intent!.revision) throw Error('Compilation output verification failed');
      job.applied = { outputRevision: job.intent!.revision, basis: compilationReceiptBasis(job) };
      job.status = 'applied'; delete job.reason; await save();
      await assertCurrent();
      job.receipt = { outputRevision: job.intent!.revision, basis: compilationReceiptBasis(job) };
      job.status = 'completed'; await save(); return this.projection(job, maxChars);
    } finally { await writer?.close(); }
  }
  private async drift(job: CompilationJob, principal: ScopePrincipal, admission: Awaited<ReturnType<CompilationService['gate']>>): Promise<string | undefined> {
    if (admission.status !== 'ready' || admission.fingerprint !== job.authorityFingerprint) return 'authority_or_rule_changed';
    for (const input of job.inputs) if (await this.revision(input.path, principal) !== input.revision) return 'input_changed';
    const output = await this.revision(job.outputPath, principal, true);
    // A durable applied checkpoint proves the old revision was replaced. Its
    // later reappearance (including deletion back to missing) is a human
    // rollback, not permission to replay the prior write after a receipt loss.
    if (job.applied && output !== job.applied.outputRevision) return 'manual_edit_conflict';
    if (output !== job.outputRevision && output !== job.intent?.revision || job.status === 'completed' && output !== job.receipt?.outputRevision) return 'manual_edit_conflict';
    return undefined;
  }
  private async assertCurrent(job: CompilationJob, principal: ScopePrincipal): Promise<void> {
    const current = await this.actor(principal), config = validateCompilationConfig(await this.options.host!.refresh());
    if (await this.drift(job, current, await this.gate(config, job, current))) throw unavailable();
  }
  /** Coalesce read-model events through the same worker; no model or application is scheduled.
   * Reconciliation supplies the full bounded dependency set when events were missed. */
  notify(paths?: readonly string[]): Promise<void> {
    if (this.closed || !this.options.host || this.options.readOnly) return Promise.resolve();
    if (!paths || paths.length > 256) { this.pendingReconcile = true; this.pendingPaths.clear(); }
    else if (!this.pendingReconcile) {
      for (const path of paths) this.pendingPaths.add(path.toLowerCase());
      if (this.pendingPaths.size > 256) { this.pendingReconcile = true; this.pendingPaths.clear(); }
    }
    if (this.notificationTask) return this.notificationTask;
    this.notificationTask = this.serial(async () => {
      try {
        while (this.pendingReconcile || this.pendingPaths.size) {
          const affected = this.pendingReconcile ? undefined : this.pendingPaths;
          this.pendingReconcile = false; this.pendingPaths = new Set();
          await this.invalidateJobs(affected);
        }
      } finally {
        // No await between the last queue check and release: a late event either
        // joined the loop or observes an idle worker and schedules the next one.
        this.notificationTask = undefined;
      }
    });
    return this.notificationTask;
  }
  private async invalidateJobs(affected?: ReadonlySet<string>): Promise<void> {
      const host = this.options.host!, config = validateCompilationConfig(await host.refresh());
      if (!config.enabled) return;
      const principal = await this.options.authorize(config.accountId); if (!principal) return;
      const writer = await host.acquire();
      try {
        const state = parseCompilationHistory(await host.readState()); let changed = false;
        for (const job of state.jobs) {
          if (job.accountId !== principal.accountId || job.status === 'review_required' || affected && ![job.outputPath, ...job.inputs.map(i => i.path)].some(p => affected.has(p.toLowerCase()))) continue;
          const admission = await this.gate(config, job, principal);
          const reason = admission.status === 'unavailable' ? 'authority_changed' : await this.drift(job, principal, admission);
          if (reason) { job.status = 'review_required'; job.reason = reason; changed = true; }
        }
        if (changed) { await this.actor(principal); await writer.assertHeld(); await host.writeState(state); }
      } finally { await writer.close(); }
  }
}
