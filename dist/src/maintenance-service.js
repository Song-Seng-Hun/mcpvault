import { guidanceError } from './guidance-runtime.js';
import { validateMaintenanceConfig, MAX_MAINTENANCE_STATE_BYTES } from './maintenance-host.js';
import { createHash, randomUUID } from 'node:crypto';
import { AsyncResource } from 'node:async_hooks';
import { isModerationHidden } from './moderation-policy.js';
import { isOriginalPath } from './original-boundary.js';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const MAX_JOBS = 64;
const ordinary = (path, frontmatter) => !isOriginalPath(path)
    && !/^(?:Community|PublicCommunity|_wiki|_collaboration)(?:\/|$)/i.test(path)
    && frontmatter.llm_wiki_type === 'knowledge' && frontmatter.immutable !== true && !isModerationHidden(frontmatter);
/** A private serialized host worker. Receipts attest exact past writes, never
 * present truth or permission. Unknown history is retained for review. */
export class MaintenanceService {
    options;
    epoch = randomUUID();
    resource = new AsyncResource('MCPVaultMaintenance');
    observed = new Map();
    state = { version: 1, jobs: [] };
    writer;
    initialized = false;
    closed = false;
    fatal = false;
    tail = Promise.resolve();
    cancel;
    dispose;
    pendingPaths = new Set();
    reconcile = false;
    historyDirty = false;
    constructor(options) {
        this.options = options;
        if (options.host)
            this.dispose = options.fs.observeNoteChanges(path => {
                const key = options.fs.noteChangeIdentity(path);
                if (this.observed.has(key))
                    this.observed.set(key, this.observed.get(key) + 1);
                for (const job of this.state.jobs)
                    if (job.move && options.fs.noteChangeIdentity(job.move.oldPath) === key
                        && ['queued', 'applying', 'failed'].includes(job.status)) {
                        job.status = 'review_required';
                        job.reason = 'old_path_changed';
                        this.historyDirty = true;
                    }
            });
    }
    serial(operation) {
        const pending = this.tail.then(operation, operation);
        this.tail = pending.catch(() => undefined);
        return pending;
    }
    async config() {
        if (!this.options.host || this.closed || this.fatal)
            return undefined;
        const config = validateMaintenanceConfig(await this.options.host.refresh());
        return config.enabled ? config : undefined;
    }
    async initialize() {
        if (this.initialized)
            return;
        const host = this.options.host;
        this.writer = await host.acquire();
        try {
            const raw = await host.readState();
            if (raw !== undefined)
                this.state = this.validateState(raw);
            this.initialized = true;
        }
        catch (error) {
            this.fatal = true;
            await this.writer.close();
            this.writer = undefined;
            throw error;
        }
    }
    validateState(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            throw guidanceError(new Error('Maintenance history invalid; preserve for host review'), 'guid-f4fe03e59569e72f');
        const state = raw;
        if (state.version !== 1 || !Array.isArray(state.jobs) || state.jobs.length > MAX_JOBS
            || Buffer.byteLength(JSON.stringify(raw)) > MAX_MAINTENANCE_STATE_BYTES)
            throw guidanceError(new Error('Maintenance history exceeds its contract'), 'guid-78fe52bc1e6be3e7');
        const ids = new Set();
        for (const job of state.jobs) {
            if (!job || !sha(job.id) || ids.has(job.id) || !sha(job.fingerprint) || !sha(job.revision)
                || typeof job.epoch !== 'string' || !Number.isInteger(job.attempts) || job.attempts < 0 || job.attempts > 3
                || !['capturing', 'queued', 'applying', 'failed', 'stopped', 'review_required', 'verified'].includes(job.status))
                throw guidanceError(new Error('Maintenance receipt invalid'), 'guid-f845f8382dc7302a');
            validateMaintenanceConfig({ version: 1, enabled: true, accountId: job.accountId, paths: [job.path], operations: [job.operation] });
            ids.add(job.id);
            if (job.intent && (!sha(job.intent.previousRevision) || !sha(job.intent.revision)
                || typeof job.intent.before !== 'string' || typeof job.intent.after !== 'string'
                || digest(job.intent.before) !== job.intent.previousRevision || digest(job.intent.after) !== job.intent.revision))
                throw guidanceError(new Error('Maintenance recovery bytes mismatch'), 'guid-d4182bde1d350dad');
            if (job.operation === 'moved_link_repair') {
                const move = job.move;
                if (!move || move.version !== 1 || move.destinationRevision !== 'missing' || !sha(move.sourceRevision)
                    || move.reference?.path !== job.path || !job.intent || move.reference.before !== job.intent.before
                    || move.reference.after !== job.intent.after || move.reference.previousRevision !== job.intent.previousRevision
                    || move.reference.revision !== job.intent.revision || !Array.isArray(move.reference.links)
                    || !Array.isArray(move.reference.properties))
                    throw guidanceError(new Error('Maintenance move history incomplete'), 'guid-4d08b718b8c676fc');
                validateMaintenanceConfig({ version: 1, enabled: true, accountId: job.accountId,
                    paths: [move.oldPath, move.newPath, job.path], operations: ['moved_link_repair'] });
            }
        }
        return structuredClone(state);
    }
    async save() {
        this.historyDirty = false;
        try {
            await this.writer.assertHeld();
            await this.options.host.writeState(this.state);
        }
        catch (error) {
            this.fatal = true;
            throw error;
        }
    }
    async authority(job) {
        const config = await this.config();
        const paths = [job.path, ...(job.move ? [job.move.oldPath, job.move.newPath] : [])];
        const granted = (current) => current && current.accountId === job.accountId
            && current.operations.includes(job.operation) && paths.every(path => current.paths.includes(path));
        if (!granted(config))
            throw guidanceError(new Error('Maintenance host approval unavailable'), 'guid-08c67460ba61d170');
        const principal = await this.options.authorize(job.accountId, job.operation);
        if (!principal || principal.accountId !== job.accountId)
            throw guidanceError(new Error('Maintenance current document authority unavailable'), 'guid-1449651f4704f639');
        await this.writer.assertHeld();
        // Account/lease IO may yield while the host removes just one grant. Enabled
        // alone is not permission: revalidate the complete job grant at admission.
        if (!granted(await this.config()))
            throw guidanceError(new Error('Maintenance host approval changed'), 'guid-a2e601c1f130ab4f');
        if (paths.some(path => !this.options.access.canAccessPhysicalPath(path, principal)))
            throw guidanceError(new Error('Maintenance current document authority unavailable'), 'guid-1449651f4704f639');
        return principal;
    }
    runAs(principal, operation) {
        return this.options.runAs ? this.options.runAs(principal, operation) : operation();
    }
    schedule() {
        if (this.cancel || this.closed || this.fatal || !this.options.host)
            return;
        this.resource.runInAsyncScope(() => {
            const schedule = this.options.schedule || ((callback) => { const timer = setTimeout(callback, 100); timer.unref(); return () => clearTimeout(timer); });
            this.cancel = schedule(() => { this.cancel = undefined; void this.flush().catch(() => { this.fatal = true; }); });
        });
    }
    async move(params, principal) {
        return this.serial(async () => {
            if (this.closed)
                throw guidanceError(new Error('Maintenance worker is closed'), 'guid-15adeee5c8ed5369');
            const canAccess = (path) => this.options.access.canAccessPhysicalPath(path, principal);
            let config;
            try {
                config = await this.config();
                if (config)
                    await this.initialize();
            }
            catch {
                this.fatal = true;
            }
            if (!config || this.fatal || !principal || config.accountId !== principal.accountId || !config.operations.includes('moved_link_repair'))
                return this.options.fs.moveNote(params, canAccess);
            const captured = [];
            let oldKey, startingEvents = 0;
            const result = await this.options.fs.moveNoteWithRecovery(params, canAccess, async (capture) => {
                if (this.state.jobs.length + capture.references.length > MAX_JOBS)
                    throw guidanceError(new Error('Maintenance receipt capacity reached'), 'guid-d0e89f9634b43c89');
                const moveId = randomUUID();
                const jobs = capture.references.map(reference => ({
                    id: digest(moveId + '\0' + reference.path), accountId: config.accountId, operation: 'moved_link_repair', path: reference.path,
                    fingerprint: digest(JSON.stringify({ moveId, capture: { ...capture, references: [reference] } })),
                    revision: reference.previousRevision, epoch: this.epoch, status: 'capturing', attempts: 0,
                    move: { version: 1, oldPath: capture.oldPath, newPath: capture.newPath, sourceRevision: capture.sourceRevision,
                        destinationRevision: 'missing', reference },
                    intent: { before: reference.before, after: reference.after, previousRevision: reference.previousRevision, revision: reference.revision },
                }));
                for (const job of jobs)
                    await this.authority(job);
                if (Buffer.byteLength(JSON.stringify({ version: 1, jobs: [...this.state.jobs, ...jobs] })) > MAX_MAINTENANCE_STATE_BYTES)
                    throw guidanceError(new Error('Maintenance recovery storage full'), 'guid-63f830fa470a518b');
                this.state.jobs.push(...jobs);
                await this.save();
                captured.push(...jobs);
                oldKey = this.options.fs.noteChangeIdentity(capture.oldPath);
                startingEvents = this.observed.get(oldKey) || 0;
                this.observed.set(oldKey, startingEvents);
            });
            if (captured.length) {
                for (const job of captured) {
                    try {
                        if (!result.success || job.status !== 'capturing' || this.observed.get(oldKey) !== startingEvents + 1)
                            throw guidanceError(new Error('Move observation incomplete'), 'guid-f463585936de6b7f');
                        await this.authority(job);
                        if (await this.options.fs.noteExists(job.move.oldPath)
                            || (await this.options.fs.readNote(job.move.newPath, 128 * 1024)).revision !== job.move.sourceRevision)
                            throw guidanceError(new Error('Move state changed'), 'guid-2561fc63da8eea98');
                        if (job.status !== 'capturing' || this.observed.get(oldKey) !== startingEvents + 1)
                            throw guidanceError(new Error('Move observation changed during verification'), 'guid-6228a08a501adb58');
                        job.status = 'queued';
                    }
                    catch {
                        job.status = 'review_required';
                        job.reason = 'move_not_verified';
                    }
                }
                try {
                    await this.save();
                    this.schedule();
                }
                catch { /* User's completed move remains completed; no autonomous repair. */ }
            }
            return result;
        });
    }
    async notify(changes) {
        if (!this.options.host || this.closed || this.fatal)
            return;
        if (!changes) {
            this.reconcile = true;
            this.invalidateMoveObservation();
        }
        else
            for (const change of changes.slice(0, 256)) {
                if (this.pendingPaths.has(change.path) || this.pendingPaths.size < 128)
                    this.pendingPaths.add(change.path);
                else {
                    this.reconcile = true;
                    this.invalidateMoveObservation();
                }
                for (const job of this.state.jobs)
                    if (job.move && ['queued', 'applying', 'failed'].includes(job.status)
                        && this.options.fs.noteChangeIdentity(change.path) === this.options.fs.noteChangeIdentity(job.move.oldPath)) {
                        job.status = 'review_required';
                        job.reason = 'old_path_event_requires_review';
                        this.historyDirty = true;
                    }
            }
        if (changes && changes.length > 256) {
            this.reconcile = true;
            this.invalidateMoveObservation();
        }
        this.schedule();
    }
    invalidateMoveObservation() {
        for (const job of this.state.jobs)
            if (job.move && ['capturing', 'queued', 'applying', 'failed'].includes(job.status)) {
                job.status = 'review_required';
                job.reason = 'observation_gap';
                this.historyDirty = true;
            }
    }
    async flush() {
        this.cancel?.();
        this.cancel = undefined;
        return this.serial(() => this.resource.runInAsyncScope(async () => {
            const config = await this.config();
            if (!config)
                return;
            await this.initialize();
            if (this.historyDirty)
                await this.save();
            if (this.options.derived) {
                // Source edits arrive under note paths, not their derived Canvas output.
                // Reinspect only explicitly configured maps; never discover new outputs.
                const candidates = config.paths.filter(path => this.reconcile || this.pendingPaths.has(path)
                    || this.pendingPaths.size > 0 && /\.canvas$/i.test(path) && config.operations.includes('managed_canvas_regenerate'));
                this.reconcile = false;
                this.pendingPaths.clear();
                for (const path of candidates.slice(0, 128))
                    for (const operation of config.operations.filter(op => op !== 'moved_link_repair')) {
                        if (this.state.jobs.length >= MAX_JOBS)
                            break;
                        try {
                            const principal = await this.authority({ accountId: config.accountId, operation, path });
                            const snapshot = await this.runAs(principal, () => this.options.derived.inspect(operation, path, principal));
                            if (!snapshot.needed || !sha(snapshot.fingerprint) || !sha(snapshot.revision))
                                continue;
                            const id = digest(JSON.stringify([operation, path, snapshot.fingerprint, config.accountId]));
                            if (this.state.jobs.some(job => job.id === id))
                                continue;
                            this.state.jobs.push({ id, accountId: config.accountId, operation, path, fingerprint: snapshot.fingerprint,
                                revision: snapshot.revision, epoch: this.epoch, status: 'queued', attempts: 0 });
                            await this.save();
                        }
                        catch { /* Unverifiable derived candidates remain diagnostic only. */ }
                    }
            }
            for (const job of this.state.jobs) {
                if (this.closed || this.fatal)
                    break;
                if (['verified', 'review_required', 'stopped'].includes(job.status))
                    continue;
                try {
                    const principal = await this.authority(job);
                    await this.runAs(principal, async () => {
                        if (job.epoch !== this.epoch) {
                            if (job.status === 'applying' && job.intent && await this.currentRevision(job.path) === job.intent.revision) {
                                await this.authority(job);
                                this.assertCurrentJob(job);
                                job.status = 'verified';
                                job.resultRevision = job.intent.revision;
                            }
                            else {
                                job.status = 'review_required';
                                job.reason = 'restart_requires_review';
                            }
                            await this.save();
                            return;
                        }
                        if (job.status === 'capturing') {
                            job.status = 'review_required';
                            job.reason = 'incomplete_move';
                            await this.save();
                            return;
                        }
                        if (job.move)
                            await this.repairMove(job);
                        else
                            await this.repairDerived(job, principal);
                    });
                }
                catch {
                    if (this.fatal)
                        break;
                    if (job.status !== 'review_required') {
                        job.attempts++;
                        job.status = job.attempts >= 3 ? 'stopped' : 'failed';
                        job.reason = 'repair_not_verified';
                    }
                    try {
                        if (await this.config())
                            await this.save();
                    }
                    catch {
                        this.fatal = true;
                    }
                }
            }
            if (this.historyDirty && !this.closed && !this.fatal)
                await this.save();
        }));
    }
    async currentRevision(path) {
        return /\.canvas$/i.test(path) ? (await this.options.fs.readCanvasFile(path)).revision : (await this.options.fs.readNote(path, 256 * 1024)).revision;
    }
    async repairMove(job) {
        const move = job.move, ref = move.reference;
        const assertAccess = async () => {
            await this.authority(job);
            if (job.status === 'review_required')
                throw guidanceError(new Error('Move observation invalidated'), 'guid-4e35232553dad7b3');
            const source = await this.options.fs.readNote(move.newPath, 128 * 1024);
            const reference = await this.options.fs.readNote(job.path, 128 * 1024);
            if (!ordinary(move.newPath, source.frontmatter) || !ordinary(job.path, reference.frontmatter))
                throw guidanceError(new Error('Only ordinary knowledge may be repaired'), 'guid-cf853b0647781c2d');
        };
        await assertAccess();
        if (await this.options.fs.noteExists(move.oldPath) || (await this.options.fs.readNote(move.newPath, 128 * 1024)).revision !== move.sourceRevision) {
            job.status = 'review_required';
            job.reason = 'move_target_changed';
            await this.save();
            return;
        }
        const current = await this.options.fs.readNote(job.path, 128 * 1024);
        if (current.revision !== ref.previousRevision && !(job.status === 'applying' && current.revision === ref.revision)) {
            job.status = 'review_required';
            job.reason = 'reference_changed';
            await this.save();
            return;
        }
        if (current.revision !== ref.revision) {
            const changes = [{ path: job.path, expectedRevision: ref.previousRevision, patches: [{ oldString: ref.before, newString: ref.after }] }];
            const policy = { guards: [{ path: move.oldPath, expectedRevision: 'missing' }, { path: move.newPath, expectedRevision: move.sourceRevision }], assertAccess,
                assertCurrent: () => this.assertCurrentJob(job) };
            const preview = await this.options.fs.patchMultipleNotes({ changes, dryRun: true }, path => this.options.access.toPublicPath(path), policy);
            if (preview.changes[0]?.revision !== ref.revision)
                throw guidanceError(new Error('Recorded move plan differs from preview'), 'guid-8c0a3ff8b9c8094c');
            if (this.closed || this.fatal || !['queued', 'failed', 'applying'].includes(job.status))
                throw guidanceError(new Error('Move observation changed during preview'), 'guid-f36563ff479202f7');
            job.status = 'applying';
            await this.save();
            await this.options.fs.patchMultipleNotes({ changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint }, path => this.options.access.toPublicPath(path), policy);
        }
        await assertAccess();
        if ((await this.options.fs.readNote(job.path, 128 * 1024)).revision !== ref.revision)
            throw guidanceError(new Error('Move repair reread changed'), 'guid-66d546287a9ec208');
        this.assertCurrentJob(job);
        job.status = 'verified';
        job.resultRevision = ref.revision;
        await this.save();
    }
    async repairDerived(job, principal) {
        const derived = this.options.derived;
        if (!derived) {
            job.status = 'review_required';
            job.reason = 'derived_adapter_unavailable';
            await this.save();
            return;
        }
        const current = await derived.inspect(job.operation, job.path, principal);
        if (current.fingerprint !== job.fingerprint || current.revision !== job.revision) {
            job.status = 'review_required';
            job.reason = 'derived_inputs_changed';
            await this.save();
            return;
        }
        const assertAccess = async () => { await this.authority(job); };
        job.status = 'applying';
        await this.save();
        const result = await derived.repair(job.operation, job.path, principal, assertAccess, async (intent) => {
            if (digest(intent.before) !== intent.previousRevision || digest(intent.after) !== intent.revision || intent.previousRevision !== job.revision)
                throw guidanceError(new Error('Derived recovery intent mismatch'), 'guid-2d11bd690f2420aa');
            job.intent = intent;
            await this.save();
        }, { fingerprint: job.fingerprint, revision: job.revision }, () => this.assertCurrentJob(job));
        await assertAccess();
        if (await this.currentRevision(job.path) !== result.revision)
            throw guidanceError(new Error('Derived repair reread changed'), 'guid-619f06cb3052db85');
        this.assertCurrentJob(job);
        job.status = 'verified';
        job.resultRevision = result.revision;
        await this.save();
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        this.cancel?.();
        this.cancel = undefined;
        this.dispose?.();
        try {
            await this.tail;
            await this.writer?.close();
        }
        finally {
            this.resource.emitDestroy();
        }
    }
    assertCurrentJob(job) {
        if (this.closed || this.fatal || job.status !== 'applying')
            throw guidanceError(new Error('Maintenance dispatch observation is no longer current'), 'guid-fd09a62cc9a4a46f');
    }
}
