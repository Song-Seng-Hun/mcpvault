import { createHash, randomBytes } from 'node:crypto';
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
/** Delivery is not retention. Only the in-process host can confirm a context generation. */
export class MemoryExposure {
    receipts = new Map();
    contexts = new Map();
    actor(p) { return p?.sessionId ? hash([p.accountId, p.agentId, p.modelId, p.sessionId, p.sessionGeneration, p.enterprise, p.capabilities]) : undefined; }
    confirm(p, receipt, context) {
        const actor = this.actor(p), record = this.receipts.get(receipt);
        if (!actor || !record || record.actor !== actor || !/^[a-zA-Z0-9._-]{1,100}$/.test(context))
            throw Error('Memory retention receipt unavailable');
        if (this.contexts.get(actor) !== context) {
            this.contexts.set(actor, context);
            for (const r of this.receipts.values())
                if (r.actor === actor)
                    delete r.context;
        }
        record.context = context;
    }
    invalidate(p) { const actor = this.actor(p); if (actor) {
        this.contexts.delete(actor);
        for (const [key, r] of this.receipts)
            if (r.actor === actor)
                this.receipts.delete(key);
    } }
    deliver(packet, p, policy, reuse, maxChars) {
        if (reuse.mode !== undefined && !['full', 'if_retained'].includes(reuse.mode) || reuse.knownReads !== undefined && (!Array.isArray(reuse.knownReads) || reuse.knownReads.length > 16 || reuse.knownReads.some(x => typeof x !== 'string' || x.length > 100)))
            throw Error('Invalid memory reuse request');
        const actor = this.actor(p);
        if (!actor || !packet.items?.length)
            return packet;
        const basis = hash([policy, packet.snapshot, packet.items, packet.warnings]), context = this.contexts.get(actor);
        if (reuse.mode === 'if_retained' && context && reuse.knownReads?.some(token => {
            const r = this.receipts.get(token);
            return r?.actor === actor && r.basis === basis && r.context === context;
        })) {
            const compact = { ...packet, items: packet.items.map((item) => ({ ...item, excerpt: null, retained: true })),
                retention: 'host_confirmed', reread: 'Use full mode or the exact source action; no confirmation question required.' };
            if (JSON.stringify(compact).length < JSON.stringify(packet).length && JSON.stringify(compact).length <= maxChars)
                return compact;
        }
        const receipt = randomBytes(24).toString('hex'), result = { ...packet, deliveryReceipt: receipt, retention: 'context_unknown' };
        if (JSON.stringify(result).length > maxChars)
            return packet;
        this.receipts.set(receipt, { actor, basis });
        while (this.receipts.size > 256)
            this.receipts.delete(this.receipts.keys().next().value);
        // Retention maps contain no bodies, and eviction only disables suppression.
        for (const key of this.contexts.keys())
            if (![...this.receipts.values()].some(r => r.actor === key))
                this.contexts.delete(key);
        return result;
    }
}
