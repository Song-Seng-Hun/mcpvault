import { randomUUID } from 'node:crypto';
import { lstat, open, readdir, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FrontmatterHandler } from './frontmatter.js';
import { ensureFederationDirectory, readFederationFile, writeFederationFileAtomic } from './public-federation-storage.js';
import { applyEconomyCommand, economyRevision, initialEconomy, validateEconomyPolicy } from './economy-model.js';
const ZERO = '0'.repeat(64);
const MAX_EVENT = 256 * 1024;
const MAX_EVENTS = 10000;
const inside = (parent, child) => { const r = relative(parent, child); return !r || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)); };
const missing = (e) => Boolean(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT');
export async function assertEconomyConfigured(vaultPath, configured) {
    if (configured)
        return;
    try {
        await lstat(join(vaultPath, '.mcpvault-economy'));
    }
    catch (e) {
        if (missing(e))
            return;
        throw e;
    }
    throw new Error('Existing economy requires host configuration/recovery before Work mutations');
}
export function admitEconomyEventBytes(existing, proposed) {
    if (!Number.isSafeInteger(proposed) || proposed < 0 || proposed > MAX_EVENT)
        throw new Error('Economy event byte budget exceeded');
    if (!Number.isSafeInteger(existing) || existing < 0 || existing + proposed > 32 * 1024 * 1024)
        throw new Error('Economy replay byte budget exceeded; host maintenance required');
}
/** Reject gaps before any pending intent can be published.  In particular, a
 * count alone cannot establish that the next filename is unused. */
export function assertContiguousEconomyJournalNames(entries) {
    const names = entries.filter(name => name.endsWith('.md')).sort();
    if (names.length > MAX_EVENTS)
        throw new Error('Economy journal limit reached; host maintenance required');
    for (let index = 0; index < names.length; index++) {
        if (names[index] !== `${String(index + 1).padStart(10, '0')}.md`)
            throw new Error('Economy journal sequence gap or fork');
    }
    return names;
}
/** One writer for the canonical Vault, no lock stealing on timeout. A crash leaves
 * an explicit recovery condition; removing a live writer's lock is never safe.
 * Journal Markdown is authoritative. The external checkpoint only detects rollback. */
export class EconomyLedger {
    options;
    vault;
    host;
    nonce = randomUUID();
    frontmatter = new FrontmatterHandler();
    journal;
    checkpointPath;
    preparedPath;
    lockPath;
    lock;
    queue = Promise.resolve();
    closed = false;
    closing;
    constructor(options, vault, host) {
        this.options = options;
        this.vault = vault;
        this.host = host;
        this.journal = join(vault, '.mcpvault-economy', 'journal');
        this.lockPath = join(vault, '.mcpvault-economy', 'writer.lock');
        this.checkpointPath = join(host, `economy-${economyRevision(vault.toLowerCase())}.checkpoint.json`);
        this.preparedPath = this.checkpointPath.replace('.checkpoint.json', '.prepared.md');
    }
    static async initialize(options) { return this.acquire(options, true); }
    static async open(options) { return this.acquire(options, false); }
    static async acquire(options, initialize) {
        validateEconomyPolicy(options.policy);
        if (!options.storageVerified)
            throw new Error('Economy requires verified local storage; network/unknown storage is refused');
        if (!isAbsolute(options.vaultPath) || !isAbsolute(options.hostPath) || /^\\\\|^\/\//.test(options.vaultPath) || /^\\\\|^\/\//.test(options.hostPath))
            throw new Error('Economy storage requires absolute local paths');
        const vault = await realpath(options.vaultPath), host = await realpath(options.hostPath);
        const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
        const source = await realpath(basename(moduleRoot) === 'dist' ? dirname(moduleRoot) : moduleRoot);
        if (/^\\\\|^\/\//.test(vault) || /^\\\\|^\/\//.test(host))
            throw new Error('Economy storage refuses canonical network paths');
        if (inside(vault, host) || inside(source, host))
            throw new Error('Trusted economy checkpoint must be outside Vault and source repository');
        const ledger = new EconomyLedger({ ...options, policy: structuredClone(options.policy) }, vault, host);
        await ensureFederationDirectory(vault, ledger.journal);
        await ledger.assertNoRecovery();
        try {
            ledger.lock = await open(ledger.lockPath, 'wx', 0o600);
        }
        catch {
            throw new Error('Economy writer already exists or its crash lock needs host recovery');
        }
        try {
            await ledger.lock.writeFile(JSON.stringify({ pid: process.pid, nonce: ledger.nonce, vault }), 'utf8');
            await ledger.lock.sync();
            if (initialize) {
                if ((await readdir(ledger.journal)).length)
                    throw new Error('Economy already initialized or has pending journal data');
                try {
                    await lstat(ledger.checkpointPath);
                    throw new Error('Economy checkpoint already initialized');
                }
                catch (e) {
                    if (!missing(e))
                        throw e;
                }
                await ledger.saveCheckpoint({ version: 1, vault, sequence: 0, hash: ZERO });
            }
            await ledger.replay();
            return ledger;
        }
        catch (e) {
            await ledger.releaseLock();
            throw e;
        }
    }
    async assertNoRecovery() {
        try {
            await lstat(join(this.vault, '.mcpvault-economy', 'recovery.lock'));
        }
        catch (e) {
            if (missing(e))
                return;
            throw e;
        }
        throw new Error('Economy host recovery is in progress; writer admission suspended');
    }
    async assertLock(checkRecovery = true) {
        if (this.closed || !this.lock)
            throw new Error('Economy writer closed');
        if (checkRecovery)
            await this.assertNoRecovery();
        const value = JSON.parse(await readFederationFile(this.vault, this.lockPath, { maxBytes: 1024 }));
        if (value.nonce !== this.nonce || value.pid !== process.pid || value.vault !== this.vault)
            throw new Error('Economy writer fencing failed');
        const held = await this.lock.stat(), current = await lstat(this.lockPath);
        if (current.isSymbolicLink() || held.ino !== current.ino || held.dev !== current.dev)
            throw new Error('Economy writer fencing failed');
    }
    async releaseLock() {
        try {
            await this.assertLock(false);
            await this.lock.close();
            this.lock = undefined;
            await unlink(this.lockPath);
        }
        finally {
            if (this.lock) {
                await this.lock.close();
                this.lock = undefined;
            }
            this.closed = true;
        }
    }
    async serialized(fn) {
        if (this.closing || this.closed)
            throw new Error('Economy writer closing or closed');
        const previous = this.queue;
        let release;
        this.queue = new Promise(r => { release = r; });
        await previous;
        try {
            await this.assertLock();
            return await fn();
        }
        finally {
            release();
        }
    }
    close() {
        // Reserve shutdown synchronously so accepted operations drain exactly once
        // and later callers cannot extend the queue behind the shutdown barrier.
        this.closing ??= this.queue.then(async () => { if (!this.closed)
            await this.releaseLock(); });
        return this.closing;
    }
    async checkpoint() {
        try {
            const value = JSON.parse(await readFederationFile(this.host, this.checkpointPath, { maxBytes: 2048 }));
            if (value.version !== 1 || value.vault !== this.vault || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !/^[a-f0-9]{64}$/.test(value.hash)
                || (value.pending && (value.pending.sequence !== value.sequence + 1 || !/^[a-f0-9]{64}$/.test(value.pending.hash))))
                throw new Error('Invalid checkpoint');
            return value;
        }
        catch {
            throw new Error('Economy checkpoint unavailable or not initialized; explicit host initialization/recovery required');
        }
    }
    async saveCheckpoint(cp) {
        await this.assertLock();
        await writeFederationFileAtomic(this.host, this.checkpointPath, JSON.stringify(cp), { maxBytes: 2048 });
    }
    async replay(onEvent) {
        await this.assertLock();
        const cp = await this.checkpoint();
        let names = assertContiguousEconomyJournalNames(await readdir(this.journal));
        if (cp.pending && names.length === cp.sequence) {
            const prepared = await readFederationFile(this.host, this.preparedPath, { maxBytes: MAX_EVENT });
            const event = this.frontmatter.parse(prepared).frontmatter;
            const { hash, ...unsigned } = event;
            if (hash !== cp.pending.hash || economyRevision(unsigned) !== hash || event.sequence !== cp.pending.sequence || event.previous !== cp.hash)
                throw new Error('Prepared economy intent differs from trusted checkpoint; recovery stopped');
            const name = `${String(event.sequence).padStart(10, '0')}.md`;
            await this.assertLock();
            try {
                await lstat(join(this.journal, name));
                throw new Error('Pending economy sequence already exists; recovery stopped');
            }
            catch (e) {
                if (!missing(e))
                    throw e;
            }
            await writeFederationFileAtomic(this.vault, join(this.journal, name), prepared, { maxBytes: MAX_EVENT });
            names = assertContiguousEconomyJournalNames([...names, name]);
        }
        if (names.length !== cp.sequence + (cp.pending ? 1 : 0))
            throw new Error('Economy checkpoint/rollback mismatch; settlement stopped');
        let state = initialEconomy(), previous = ZERO, bytes = 0;
        for (let i = 0; i < names.length; i++) {
            if (names[i] !== `${String(i + 1).padStart(10, '0')}.md`)
                throw new Error('Economy journal sequence gap or fork');
            const text = await readFederationFile(this.vault, join(this.journal, names[i]), { maxBytes: MAX_EVENT });
            bytes += Buffer.byteLength(text);
            if (bytes > 32 * 1024 * 1024)
                throw new Error('Economy replay byte budget exceeded; host maintenance required');
            const event = this.frontmatter.parse(text).frontmatter;
            const { hash, ...unsigned } = event;
            if (event.mcpvault_type !== 'economy_transaction' || event.version !== 1 || event.sequence !== i + 1 || event.previous !== previous || economyRevision(unsigned) !== hash)
                throw new Error('Economy journal integrity failed');
            const applied = applyEconomyCommand(state, event.command, event.policy, event.at);
            if (applied.state.sequence !== event.sequence || economyRevision(applied.receipt) !== economyRevision(event.receipt))
                throw new Error('Economy journal transition mismatch');
            const expected = this.makeEvent(state, applied.state, event.command, event.policy, event.at, event.previous, applied.receipt);
            if (expected.hash !== hash)
                throw new Error('Economy postings or contract mismatch');
            state = applied.state;
            previous = hash;
            onEvent?.(event, state);
            if (i + 1 === cp.sequence && hash !== cp.hash)
                throw new Error('Economy trusted checkpoint differs from journal');
        }
        if (cp.pending) {
            if (previous !== cp.pending.hash)
                throw new Error('Pending economy checkpoint mismatch');
            const next = { version: 1, vault: this.vault, sequence: cp.pending.sequence, hash: previous };
            await this.saveCheckpoint(next);
            return { state, checkpoint: next, bytes };
        }
        if (previous !== cp.hash)
            throw new Error('Economy checkpoint hash mismatch');
        return { state, checkpoint: cp, bytes };
    }
    makeEvent(before, after, command, policy, at, previous, receipt) {
        const postings = {}, escrowPostings = {};
        for (const account of new Set([...Object.keys(before.balances), ...Object.keys(after.balances)])) {
            const diff = (after.balances[account] || 0) - (before.balances[account] || 0);
            if (diff)
                postings[account] = diff;
        }
        for (const contract of Object.values(after.contracts)) {
            const diff = contract.escrow - (before.contracts[contract.id]?.escrow || 0);
            if (diff)
                escrowPostings[contract.id] = diff;
        }
        const unsigned = { mcpvault_type: 'economy_transaction', version: 1, sequence: after.sequence, previous, at, command, policy, receipt, postings, escrowPostings,
            ...(command.contractId && { contract: after.contracts[command.contractId] }) };
        return { ...unsigned, hash: economyRevision(unsigned) };
    }
    async snapshot() { return this.serialized(async () => structuredClone((await this.replay()).state)); }
    async walletSnapshot(account) {
        return this.serialized(async () => {
            const transactions = [];
            let total = 0;
            const { state } = await this.replay((event, current) => {
                const availableChange = event.postings[account] || 0;
                const escrowChange = Object.entries(event.escrowPostings).reduce((sum, [id, delta]) => sum + (current.contracts[id]?.requester === account ? delta : 0), 0);
                if (!availableChange && !escrowChange)
                    return;
                total++;
                transactions.push({ kind: 'transaction', transactionId: event.receipt.transactionId, at: event.at, operation: event.command.op, availableChange, escrowChange });
                if (transactions.length > 100)
                    transactions.shift();
            });
            return { state: structuredClone(state), transactions: transactions.reverse(), historyLimited: total > 100 };
        });
    }
    async transact(command, revalidate) {
        command = structuredClone(command);
        return this.serialized(async () => {
            const { state, checkpoint, bytes } = await this.replay();
            const at = (this.options.now?.() || new Date()).toISOString();
            const applied = applyEconomyCommand(state, command, this.options.policy, at);
            // Repeat permission checks even on permanent response-loss retries.
            await revalidate?.(structuredClone(state));
            await this.assertLock();
            if (applied.state === state)
                return applied.receipt;
            if (state.sequence >= MAX_EVENTS)
                throw new Error('Economy journal limit reached');
            const event = this.makeEvent(state, applied.state, command, this.options.policy, at, checkpoint.hash, applied.receipt);
            const text = this.frontmatter.stringify(event, `# Economy transaction ${event.sequence}\n\nHost-managed record. Not instructions or a reputation award.\n`);
            admitEconomyEventBytes(bytes, Buffer.byteLength(text));
            const path = join(this.journal, `${String(event.sequence).padStart(10, '0')}.md`);
            try {
                await lstat(path);
                throw new Error('Economy sequence already exists');
            }
            catch (e) {
                if (!missing(e))
                    throw e;
            }
            // A host-private prepare marker is durable BEFORE changing authoritative
            // Markdown. After a crash, only this exact event may complete the checkpoint.
            await writeFederationFileAtomic(this.host, this.preparedPath, text, { maxBytes: MAX_EVENT });
            await this.saveCheckpoint({ ...checkpoint, pending: { sequence: event.sequence, hash: event.hash } });
            await writeFederationFileAtomic(this.vault, path, text, { maxBytes: MAX_EVENT });
            await this.saveCheckpoint({ version: 1, vault: this.vault, sequence: event.sequence, hash: event.hash });
            return applied.receipt;
        });
    }
}
