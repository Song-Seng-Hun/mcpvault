import { guidanceError } from './guidance-runtime.js';
import { randomUUID, createHash } from 'node:crypto';
import { lstat, open, readdir, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { roleplayHostIdentity, validateRoleplayStorage } from './roleplay-storage-host.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { extractMentions } from './social.js';
import { ensureFederationDirectory, readFederationFile, writeFederationFileAtomic } from './public-federation-storage.js';
import { applyRoleplayCommand, initialRoleplay, roleplayHash } from './roleplay-model.js';
export const ROLEPLAY_ROOT = 'Community/Roleplay/Turns';
export const roleplayTurnPath = (sequence) => `${ROLEPLAY_ROOT}/${String(sequence).padStart(10, '0')}.md`;
const ZERO = '0'.repeat(64), MAX_BYTES = 65536;
export const ROLEPLAY_REPLAY_MAX_BYTES = 32 * 1024 * 1024;
const TEMPORARY_TURN = /^\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;
const MAX_TEMPORARY_TURNS = 16;
const missing = (e) => Boolean(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT');
const revision = (text) => createHash('sha256').update(text).digest('hex');
export function assertRoleplayReplayAdmission(existingBytes, candidateBytes) {
    if (!Number.isSafeInteger(existingBytes) || !Number.isSafeInteger(candidateBytes) || existingBytes < 0 || candidateBytes < 0 || existingBytes > ROLEPLAY_REPLAY_MAX_BYTES - candidateBytes) {
        throw guidanceError(new Error('Roleplay replay capacity reached; host maintenance required'), 'guid-6f034b696b4fa383');
    }
}
export async function canonicalTurnNames(dir) {
    const names = (await readdir(dir)).sort();
    const temporary = names.filter(name => TEMPORARY_TURN.test(name));
    if (temporary.length > MAX_TEMPORARY_TURNS)
        throw guidanceError(new Error('Roleplay temporary turn limit reached; host repair required'), 'guid-e190edd51a4a9536');
    for (const name of temporary) {
        const stat = await lstat(join(dir, name));
        if (!stat.isFile() || stat.size > MAX_BYTES)
            throw guidanceError(new Error('Roleplay temporary turn integrity failure; host repair required'), 'guid-4eef613a39b7673b');
    }
    return names.filter(name => !TEMPORARY_TURN.test(name));
}
/** Single writer, durable intent before canonical Markdown, trusted tail outside the Vault.
 * No second chat log and no authoritative state snapshot. The journal is replayable.
 * Host checkpoint is integrity metadata, not a disposable index or a secret-vault claim. */
export class RoleplayStore {
    options;
    hostId;
    lock;
    nonce = randomUUID();
    queue = Promise.resolve();
    closing;
    fm = new FrontmatterHandler();
    verified;
    constructor(options, hostId) {
        this.options = options;
        this.hostId = hostId;
    }
    get lockPath() { return join(this.options.vaultPath, '.mcpvault-roleplay', 'writer.lock'); }
    get checkpointPath() { return join(this.options.hostPath, `roleplay-${roleplayHash(this.options.vaultPath.toLowerCase())}.checkpoint.json`); }
    get preparedPath() { return this.checkpointPath.replace('.checkpoint.json', '.prepared.md'); }
    static async open(options) {
        const { vaultPath, hostPath } = await validateRoleplayStorage(options);
        if (!Array.isArray(options.policy.administrators) || options.policy.administrators.length > 20)
            throw guidanceError(new Error('Explicit host administrators array required'), 'guid-f83ee70da08f1adb');
        const hostId = (await roleplayHostIdentity(hostPath, true));
        const store = new RoleplayStore({ vaultPath, hostPath, policy: structuredClone(options.policy) }, hostId);
        await ensureFederationDirectory(vaultPath, join(vaultPath, ROLEPLAY_ROOT));
        await ensureFederationDirectory(vaultPath, join(vaultPath, '.mcpvault-roleplay'));
        await store.assertNoRecovery();
        try {
            store.lock = await open(store.lockPath, 'wx', 0o600);
        }
        catch {
            throw guidanceError(new Error('Roleplay writer already exists or crash lock needs explicit host recovery'), 'guid-2e39a35b0d753bdc');
        }
        try {
            await store.lock.writeFile(JSON.stringify({ pid: process.pid, nonce: store.nonce, vault: vaultPath, hostId }));
            await store.lock.sync();
            await store.assertNoRecovery();
            try {
                await lstat(store.checkpointPath);
            }
            catch (e) {
                if (!missing(e))
                    throw e;
                if ((await canonicalTurnNames(join(vaultPath, ROLEPLAY_ROOT))).length)
                    throw guidanceError(new Error('Roleplay checkpoint missing for existing records; host repair required'), 'guid-e5da252a4f3e7ef4');
                await store.saveCheckpoint({ version: 1, vault: vaultPath, sequence: 0, hash: ZERO });
            }
            await store.replay();
            return store;
        }
        catch (e) {
            await store.release();
            throw e;
        }
    }
    async assertNoRecovery() {
        try {
            await lstat(join(this.options.vaultPath, '.mcpvault-roleplay', 'recovery.lock'));
        }
        catch (e) {
            if (missing(e))
                return;
            throw e;
        }
        throw guidanceError(new Error('Roleplay host recovery is in progress; writer admission suspended'), 'guid-97a0c3a60e48db26');
    }
    async assertWriter(checkRecovery = true) {
        if (!this.lock)
            throw guidanceError(new Error('Roleplay writer is closed'), 'guid-c35f7bcfd1ae8506');
        await validateRoleplayStorage(this.options);
        if (checkRecovery)
            await this.assertNoRecovery();
        const current = JSON.parse(await readFederationFile(this.options.vaultPath, this.lockPath, { maxBytes: 2048 }));
        const held = await this.lock.stat(), disk = await lstat(this.lockPath);
        // SMB file IDs may collide or differ between handle/path queries. Ownership
        // is the durable nonce/PID/Vault/host tuple under cooperative host fencing.
        if (!held.isFile() || !disk.isFile() || disk.isSymbolicLink() || current.nonce !== this.nonce || current.pid !== process.pid || current.vault !== this.options.vaultPath || current.hostId !== this.hostId)
            throw guidanceError(new Error('Roleplay writer fencing failed'), 'guid-50547e1c3f6a6645');
    }
    async release() {
        try {
            await this.assertWriter(false);
            await this.lock.close();
            this.lock = undefined;
            await unlink(this.lockPath);
        }
        finally {
            await this.lock?.close();
            this.lock = undefined;
        }
    }
    async serial(fn) {
        if (this.closing)
            throw guidanceError(new Error('Roleplay writer closing'), 'guid-0990ec0e413e95f9');
        const prior = this.queue;
        let release;
        this.queue = new Promise(r => { release = r; });
        await prior;
        try {
            await this.assertWriter();
            return await fn();
        }
        finally {
            release();
        }
    }
    close() { return this.closing ??= this.queue.then(() => this.release()); }
    async saveCheckpoint(cp) {
        await this.assertWriter();
        await writeFederationFileAtomic(this.options.hostPath, this.checkpointPath, JSON.stringify(cp), { maxBytes: 2048 });
    }
    encode(event) {
        const r = event.receipt;
        return this.fm.stringify({ mcpvault_type: r.roomId ? 'chat_message' : 'roleplay_turn', fiction_domain: 'roleplay', roleplay_committed: true,
            message_id: `roleplay-${r.id}`, room_id: r.roomId ?? '', author: r.actor, character_id: r.characterId ?? '', created_at: event.at,
            mentions: extractMentions(r.content), references: [], ...(event.command.data.replyTo && { reply_to: event.command.data.replyTo }), roleplay_event: event }, `${r.content}\n`);
    }
    async replay() {
        const cp = JSON.parse(await readFederationFile(this.options.hostPath, this.checkpointPath, { maxBytes: 2048 }));
        if (cp.version !== 1 || cp.vault !== this.options.vaultPath || !Number.isSafeInteger(cp.sequence) || cp.sequence < 0 || cp.sequence > 10000 || !/^[a-f0-9]{64}$/.test(cp.hash))
            throw guidanceError(new Error('Roleplay checkpoint invalid; host repair required'), 'guid-5b9f82430fb8c51a');
        const dir = join(this.options.vaultPath, ROLEPLAY_ROOT);
        await ensureFederationDirectory(this.options.vaultPath, dir);
        let names = await canonicalTurnNames(dir);
        // Check before replay can finish a pending intent or update its checkpoint.
        if (!this.options.policy.administrators.length && (cp.sequence !== 0 || cp.pending || names.length))
            throw guidanceError(new Error('Explicit host administrators required for an initialized roleplay journal'), 'guid-e2747762923e4582');
        if (names.length < cp.sequence || names.length > cp.sequence + (cp.pending ? 1 : 0))
            throw guidanceError(new Error('Roleplay checkpoint/record mismatch; host repair required'), 'guid-d5cbf65c3b751ac9');
        let existingBytes = 0;
        const texts = [];
        for (let i = 0; i < names.length; i++) {
            const path = roleplayTurnPath(i + 1);
            if (names[i] !== basename(path) || !new PathFilter().isAllowed(path))
                throw guidanceError(new Error('Roleplay record path integrity failure'), 'guid-7d08ac8ebe3c8f67');
            const text = await readFederationFile(this.options.vaultPath, path, { maxBytes: MAX_BYTES });
            texts.push(text);
            const cached = this.verified?.records[i];
            if (cached && cached.revision !== revision(text))
                throw guidanceError(new Error('Roleplay record tampered; host repair required'), 'guid-dd796f5ee3b41059');
            existingBytes += Buffer.byteLength(text);
            assertRoleplayReplayAdmission(existingBytes, 0);
        }
        if (cp.pending) {
            if (cp.pending.sequence !== cp.sequence + 1 || !/^[a-f0-9]{64}$/.test(cp.pending.hash))
                throw guidanceError(new Error('Invalid pending roleplay checkpoint'), 'guid-744365638887a240');
            const path = roleplayTurnPath(cp.pending.sequence), name = basename(path);
            if (!names.includes(name)) {
                const text = await readFederationFile(this.options.hostPath, this.preparedPath, { maxBytes: MAX_BYTES });
                const event = this.fm.parse(text).frontmatter.roleplay_event;
                if (event?.hash !== cp.pending.hash || event.sequence !== cp.pending.sequence)
                    throw guidanceError(new Error('Prepared turn integrity failure; host repair required'), 'guid-0f5dea998152a464');
                assertRoleplayReplayAdmission(existingBytes, Buffer.byteLength(text));
                await this.assertWriter();
                await writeFederationFileAtomic(this.options.vaultPath, path, text, { maxBytes: MAX_BYTES });
                names = [...names, name].sort();
                texts.push(text);
            }
        }
        if (names.length !== cp.sequence + (cp.pending ? 1 : 0))
            throw guidanceError(new Error('Roleplay checkpoint/record mismatch; host repair required'), 'guid-d5cbf65c3b751ac9');
        const cached = this.verified;
        if (cached && cached.state.sequence > cp.sequence)
            throw guidanceError(new Error('Roleplay checkpoint moved backwards; host repair required'), 'guid-8846f141c67aa2ff');
        let state = cached?.state ?? initialRoleplay(), previous = cached?.checkpoint.hash ?? ZERO, bytes = cached?.bytes ?? 0;
        const records = [...(cached?.records ?? [])];
        if (cached?.state.sequence === cp.sequence && cached.checkpoint.hash !== cp.hash)
            throw guidanceError(new Error('Roleplay trusted checkpoint mismatch'), 'guid-7185f9e9a309eae7');
        for (let i = records.length; i < names.length; i++) {
            const path = roleplayTurnPath(i + 1);
            if (names[i] !== basename(path) || !new PathFilter().isAllowed(path))
                throw guidanceError(new Error('Roleplay record path integrity failure'), 'guid-7d08ac8ebe3c8f67');
            const text = texts[i];
            bytes += Buffer.byteLength(text);
            assertRoleplayReplayAdmission(bytes, 0);
            const parsed = this.fm.parse(text), event = parsed.frontmatter.roleplay_event;
            if (!event || event.version !== 1 || event.sequence !== i + 1 || event.previous !== previous)
                throw guidanceError(new Error('Roleplay record integrity failed; host repair required'), 'guid-b5cfa5b0c8e17c30');
            const { hash, ...unsigned } = event;
            if (roleplayHash(unsigned) !== hash || this.encode(event) !== text)
                throw guidanceError(new Error('Roleplay record tampered; host repair required'), 'guid-dd796f5ee3b41059');
            const applied = applyRoleplayCommand(state, event.command, event.policy);
            if (roleplayHash(applied.receipt) !== roleplayHash(event.receipt) || applied.state === state)
                throw guidanceError(new Error('Roleplay transition integrity failed'), 'guid-cc1e2494212fc2d5');
            state = applied.state;
            previous = hash;
            records.push({ path, revision: revision(text), event, content: text, frontmatter: parsed.frontmatter });
            if (i + 1 === cp.sequence && hash !== cp.hash)
                throw guidanceError(new Error('Roleplay trusted checkpoint mismatch'), 'guid-7185f9e9a309eae7');
        }
        if (previous !== (cp.pending?.hash ?? cp.hash))
            throw guidanceError(new Error('Roleplay checkpoint integrity failure'), 'guid-9528a308dcb17f4e');
        const checkpoint = { version: 1, vault: cp.vault, sequence: state.sequence, hash: previous };
        if (cp.pending)
            await this.saveCheckpoint(checkpoint);
        return this.verified = { state, checkpoint, bytes, records };
    }
    snapshot() { return this.serial(async () => structuredClone((await this.replay()).state)); }
    read() { return this.serial(async () => structuredClone(await this.replay())); }
    async transact(command, revalidate) {
        command = structuredClone(command);
        return this.serial(async () => {
            const { state, checkpoint, bytes, records } = await this.replay();
            // Authenticate again even for an already committed response-loss retry.
            await revalidate?.(structuredClone(state));
            await this.assertWriter();
            const applied = applyRoleplayCommand(state, command, this.options.policy);
            if (applied.state === state) {
                const old = records.find(r => r.event.receipt.id === applied.receipt.id);
                return { ...applied.receipt, path: old.path, noteRevision: old.revision };
            }
            const unsigned = { version: 1, sequence: applied.state.sequence, previous: checkpoint.hash, command, policy: this.options.policy, receipt: applied.receipt, at: new Date().toISOString() };
            const event = { ...unsigned, hash: roleplayHash(unsigned) }, text = this.encode(event), path = roleplayTurnPath(event.sequence);
            if (Buffer.byteLength(text) > MAX_BYTES)
                throw guidanceError(new Error('Roleplay turn exceeds storage budget'), 'guid-8bfb189437191955');
            assertRoleplayReplayAdmission(bytes, Buffer.byteLength(text));
            await writeFederationFileAtomic(this.options.hostPath, this.preparedPath, text, { maxBytes: MAX_BYTES });
            await this.saveCheckpoint({ ...checkpoint, pending: { sequence: event.sequence, hash: event.hash } });
            await writeFederationFileAtomic(this.options.vaultPath, path, text, { maxBytes: MAX_BYTES });
            await this.saveCheckpoint({ version: 1, vault: checkpoint.vault, sequence: event.sequence, hash: event.hash });
            return { ...applied.receipt, path, noteRevision: revision(text) };
        });
    }
}
