import { createHash } from 'node:crypto';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const versionKey = (v) => `${v.skillId}:${v.revision}`;
export function skillUsageTaskId(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value))
        throw new Error('Skill taskId must be an opaque identifier, not a path or transcript');
    return value;
}
/** Private, bounded process observations. No transcript, host path, token or persistent file. */
export class SkillUsageTelemetry {
    capacity;
    startedAt = new Date().toISOString();
    entries = new Map();
    receipts = new Set();
    tasks = new Map();
    saturated = false;
    constructor(capacity = 1024) {
        this.capacity = capacity;
        if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10000)
            throw new Error('Invalid skill observation capacity');
    }
    entry(actor, v) {
        if (!actor)
            return undefined;
        const key = hash(actor + ':' + versionKey(v));
        let entry = this.entries.get(key);
        if (!entry) {
            if (this.entries.size >= this.capacity) {
                this.saturated = true;
                return undefined;
            }
            entry = { ...v, resolvedCalls: 0, reportedApplications: 0, reportedSuccesses: 0, lastObserved: new Date().toISOString() };
            this.entries.set(key, entry);
        }
        entry.lastObserved = new Date().toISOString();
        return entry;
    }
    resolved(actor, v) { const entry = this.entry(actor, v); if (entry)
        entry.resolvedCalls = Math.min(Number.MAX_SAFE_INTEGER, entry.resolvedCalls + 1); }
    reported(actor, v, receipt, taskId, outcome) {
        if (!actor)
            return;
        const id = hash(actor + ':' + receipt);
        if (this.receipts.has(id))
            return;
        if (this.receipts.size >= this.capacity * 4) {
            this.saturated = true;
            return;
        }
        const entry = this.entry(actor, v);
        if (!entry)
            return;
        this.receipts.add(id);
        entry.reportedApplications++;
        if (outcome === 'success')
            entry.reportedSuccesses++;
        if (!taskId)
            return;
        const key = hash(actor + ':' + taskId);
        let task = this.tasks.get(key);
        if (!task) {
            if (this.tasks.size >= this.capacity) {
                this.saturated = true;
                return;
            }
            task = { actor, members: new Map() };
            this.tasks.set(key, task);
        }
        if (task.members.size >= 16 && !task.members.has(versionKey(v))) {
            this.saturated = true;
            return;
        }
        task.members.set(versionKey(v), { ...v });
    }
    snapshot(actor, v) {
        const entry = actor ? this.entries.get(hash(actor + ':' + versionKey(v))) : undefined;
        const pairs = new Map();
        let truncated = false;
        if (actor && entry)
            for (const task of this.tasks.values()) {
                if (task.actor !== actor || !task.members.has(versionKey(v)))
                    continue;
                for (const [key, member] of task.members) {
                    if (key === versionKey(v))
                        continue;
                    const prior = pairs.get(key);
                    if (prior)
                        prior.tasks++;
                    else if (pairs.size < 32)
                        pairs.set(key, { ...member, tasks: 1, basis: 'caller_reported_task' });
                    else
                        truncated = true;
                }
            }
        return { coverage: entry ? (this.saturated || truncated ? 'partial' : 'resolver_and_new_report_records') : 'unobserved', observedSince: this.startedAt,
            storage: 'process_only', resolvedCalls: entry?.resolvedCalls ?? null, reportedApplications: entry?.reportedApplications ?? null,
            reportedSuccesses: entry?.reportedSuccesses ?? null, verifiedApplications: null, receiptAcknowledged: null,
            lastObserved: entry?.lastObserved ?? null, retirementDecision: 'not_evaluated', coUsed: [...pairs.values()],
            notice: 'Resolution is server completion, not receipt or application. Reports are not execution proof. No automatic merge or deletion.' };
    }
}
