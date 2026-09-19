import { hash, unavailable } from './policy.js';
/** One bounded owner index, separate page records. No global directory/body scans. */
export class EvolutionRepository {
    records;
    owner;
    current;
    account;
    constructor(records, owner, current, account = owner) {
        this.records = records;
        this.owner = owner;
        this.current = current;
        this.account = account;
    }
    key(kind, id) { return hash(['evolution-v1', this.owner, kind, id]); }
    async read(kind, id) {
        await this.current();
        const r = await this.records.read(this.key(kind, id));
        await this.current();
        if (r.value !== undefined && (!r.value || typeof r.value !== 'object' || r.value.version !== 1))
            return unavailable();
        return { revision: r.revision, ...(r.value !== undefined && { value: r.value }) };
    }
    async write(kind, id, value, revision) {
        await this.current();
        return this.records.write(this.key(kind, id), value, revision, this.current);
    }
    async partition(shared) {
        const r = await this.read('index', shared ? 'owner' : `account-${hash(this.account)}`);
        const v = r.value ?? { version: 1, feedback: [], cycles: [] };
        if (!Array.isArray(v.feedback) || !Array.isArray(v.cycles) || [v.feedback, v.cycles].some(a => a.length > 1024
            || new Set(a).size !== a.length || a.some(i => typeof i !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(i))))
            return unavailable();
        return { revision: r.revision, value: v };
    }
    async index() {
        const own = await this.partition(false), common = await this.partition(true);
        return { revision: hash([own.revision, common.revision]), value: { version: 1,
                feedback: [...new Set([...own.value.feedback, ...common.value.feedback])], cycles: [...new Set([...own.value.cycles, ...common.value.cycles])] } };
    }
    async add(kind, id, shared = false) {
        const r = await this.partition(shared);
        if (r.value[kind].includes(id))
            return;
        if (r.value[kind].length >= 1024)
            throw Error('Evolution index capacity reached; preserve history for host review');
        r.value[kind].push(id);
        await this.write('index', shared ? 'owner' : `account-${hash(this.account)}`, r.value, r.revision);
    }
}
