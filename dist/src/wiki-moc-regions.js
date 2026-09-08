import { guidanceError } from './guidance-runtime.js';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { join, posix, relative } from 'node:path';
import { isManagedCommunityPath, isModerationHidden } from './moderation-policy.js';
import { managedNavigationRegion, MOC_BEGIN, MOC_END } from './managed-navigation.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const normalized = (path) => posix.normalize(path.replace(/\\/g, '/'));
const identity = (path) => process.platform === 'win32' ? path.toLowerCase() : path;
/** Trusted registrations are separate from editable Markdown. One queue, no polling. */
export class MocRegionService {
    vault;
    fs;
    access;
    authorize;
    readOnly;
    registrations = new Map();
    pending = new Set();
    tail = Promise.resolve();
    startup;
    timer;
    closed = false;
    constructor(vault, fs, access, authorize, readOnly = false) {
        this.vault = vault;
        this.fs = fs;
        this.access = access;
        this.authorize = authorize;
        this.readOnly = readOnly;
    }
    async exclusive(operation) {
        const task = this.tail.then(operation, operation);
        this.tail = task.catch(() => undefined);
        return task;
    }
    async statePath(create = false) {
        const directory = join(this.vault, '.mcpvault');
        for (const path of [this.vault, directory, join(directory, 'moc-regions.json')]) {
            try {
                if ((await lstat(path)).isSymbolicLink())
                    throw guidanceError(new Error('MOC registration state cannot use symlinks'), 'guid-454e8ce99d7f666b');
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
        }
        if (create)
            await mkdir(directory, { recursive: true, mode: 0o700 });
        return join(directory, 'moc-regions.json');
    }
    async save() {
        const path = await this.statePath(true);
        const temporary = `${path}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify({ version: 1, registrations: [...this.registrations.values()] }), { mode: 0o600, flag: 'wx' });
        await rename(temporary, path);
    }
    async start() {
        if (!this.startup)
            this.startup = (async () => {
                try {
                    const path = await this.statePath();
                    if ((await lstat(path)).size > 128 * 1024)
                        throw guidanceError(new Error('MOC registration state exceeds limit'), 'guid-16d2a140e35ea4f8');
                    const data = JSON.parse(await readFile(path, 'utf8'));
                    if (data.version !== 1 || !Array.isArray(data.registrations) || data.registrations.length > 32)
                        throw guidanceError(new Error('Invalid MOC registrations'), 'guid-073ac91ad7df20aa');
                    for (const row of data.registrations) {
                        if (!row || typeof row.owner !== 'string' || !/^[a-f0-9]{64}$/.test(row.regionHash) || !['active', 'stopped', 'conflict', 'suspended'].includes(row.status) || (row.pendingHash && !/^[a-f0-9]{64}$/.test(row.pendingHash)))
                            throw guidanceError(new Error('Invalid MOC registration'), 'guid-074a99c42ef7ccb0');
                        this.validatePath(row.path);
                        this.validatePrefix(row.pathPrefix, row.path);
                        if (this.registrations.has(identity(row.path)))
                            throw guidanceError(new Error('Duplicate MOC registration'), 'guid-f630fa4a185703f9');
                        this.registrations.set(identity(row.path), row);
                        if (row.status === 'active' && !this.readOnly)
                            this.pending.add(identity(row.path));
                    }
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        throw error;
                }
            })();
        await this.startup;
    }
    validatePath(path) {
        if (typeof path !== 'string' || path.length > 500 || normalized(path) !== path || path.startsWith('/') || path.split('/').some(part => part === '..' || part.startsWith('.')) || !this.access.canAccessPhysicalPath(path) || !/\.md$/i.test(path) || isManagedCommunityPath(path))
            throw guidanceError(new Error('Managed MOC requires an ordinary public Global or Community Markdown path'), 'guid-449488858d987080');
        this.access.assertMutationAllowed(path, 'Managed MOC');
    }
    validatePrefix(prefix, path) {
        if (typeof prefix !== 'string' || !prefix || prefix.length > 500 || normalized(prefix) !== prefix || prefix.startsWith('/') || prefix.split('/').some(part => part === '..' || part.startsWith('.')) || !this.access.canAccessPhysicalPath(prefix) || this.access.isCommunityPath(path) !== this.access.isCommunityPath(prefix))
            throw guidanceError(new Error('MOC pathPrefix must be a nonempty folder in the same public scope'), 'guid-adbd9dcfe425dc92');
        this.access.assertMutationAllowed(prefix, 'Managed MOC');
    }
    async projection(path, prefix) {
        this.validatePath(path);
        this.validatePrefix(prefix, path);
        const note = await this.fs.readNote(path);
        if (note.frontmatter.note_kind !== 'moc' || isModerationHidden(note.frontmatter))
            throw guidanceError(new Error('Visible note_kind=moc required'), 'guid-36c880d1283c50be');
        const region = managedNavigationRegion(note.originalContent);
        let queryPrefix = prefix;
        if (process.platform === 'win32') {
            const vaultRoot = await realpath(this.vault);
            try {
                const canonical = relative(vaultRoot, await realpath(join(this.vault, prefix))).replace(/\\/g, '/');
                if (identity(canonical) !== identity(prefix))
                    throw guidanceError(new Error('MOC folder aliases are not supported'), 'guid-9cc5ca2cf2bfab53');
                queryPrefix = canonical;
            }
            catch (error) {
                // A deleted/moved folder is an empty inventory, not a manual-region conflict.
                // The filesystem query still applies its normal path and symlink checks.
                if (error.code !== 'ENOENT')
                    throw error;
            }
        }
        const page = await this.fs.queryNotes({ pathPrefix: `${queryPrefix}/`, sortBy: 'path', limit: 101, includeContent: false, includeTotal: false }, candidate => identity(candidate) !== identity(path) && this.access.canAccessPhysicalPath(candidate) && this.access.isCommunityPath(path) === this.access.isCommunityPath(candidate), candidate => !isModerationHidden(candidate.frontmatter));
        if (page.notes.length > 100 || page.truncated)
            throw guidanceError(new Error('MOC region exceeds 100 links; narrow its folder or split the MOC'), 'guid-378c20f54d125d4d');
        if (page.notes.some(row => /[\[\]#|\r\n]/.test(row.path)))
            throw guidanceError(new Error('MOC target filename cannot be represented by an exact wikilink'), 'guid-816769509c4f8945');
        const text = `${MOC_BEGIN}\n${page.notes.map(row => `- [[${row.path}]]`).join('\n')}\n${MOC_END}\n`;
        const fingerprint = hash(JSON.stringify([path, prefix, note.revision, page.notes.map(row => [row.path, row.revision]), text]));
        return { note, region, text, fingerprint };
    }
    async run(principal, options) {
        await this.start();
        return this.exclusive(async () => {
            const path = this.access.resolveExternalPath(options.path, principal);
            this.validatePath(path);
            const prior = this.registrations.get(identity(path));
            if (options.operation === 'status') {
                const note = await this.fs.readNote(path);
                if (isModerationHidden(note.frontmatter))
                    throw guidanceError(new Error('MOC unavailable'), 'guid-0c56a0d7f6967c58');
                const status = prior?.status === 'active' && !await this.authorize(prior.owner) ? 'suspended' : prior?.status ?? 'unregistered';
                return { path, revision: note.revision, status };
            }
            if (!principal || !await this.authorize(principal.accountId))
                throw guidanceError(new Error('Current write permission is required for MOC management'), 'guid-67b957628a0539ab');
            if (prior && prior.owner !== principal.accountId)
                throw guidanceError(new Error('Only the registering account may manage this region'), 'guid-a2dba8176d3c0688');
            const prefix = options.pathPrefix ?? prior?.pathPrefix;
            if (options.operation === 'stop') {
                if (this.readOnly)
                    throw guidanceError(new Error('Read-only server'), 'guid-20cea472b18b8444');
                if (!prior || (await this.fs.readNote(path)).revision !== options.expectedRevision)
                    throw guidanceError(new Error('Registration or revision changed'), 'guid-2c3e07b6e910cb5e');
                prior.status = 'stopped';
                this.pending.delete(identity(path));
                await this.save();
                return { path, status: 'stopped', revision: options.expectedRevision };
            }
            if (!['preview', 'register', 'regenerate'].includes(options.operation))
                throw guidanceError(new Error('Unknown MOC operation'), 'guid-0666a2fbc339cc2c');
            if (!prefix)
                throw guidanceError(new Error('pathPrefix is required when registering a MOC'), 'guid-a4a2e1a1d2974a09');
            const current = await this.projection(path, prefix);
            if (options.operation === 'preview') {
                const result = { path, revision: current.note.revision, preview: current.text, fingerprint: current.fingerprint, applyAction: { endpointId: 'wiki.moc_region', arguments: { operation: prior ? 'regenerate' : 'register', path, pathPrefix: prefix, expectedRevision: current.note.revision, expectedFingerprint: current.fingerprint } } };
                if (JSON.stringify(result).length > (options.maxChars ?? 12000))
                    throw guidanceError(new Error('Increase maxChars or narrow MOC folder to preserve the complete preview'), 'guid-325b151c08ac72e5');
                return result;
            }
            if (this.readOnly)
                throw guidanceError(new Error('Read-only server'), 'guid-20cea472b18b8444');
            if (options.expectedRevision !== current.note.revision || options.expectedFingerprint !== current.fingerprint)
                throw guidanceError(new Error('MOC preview fingerprint or revision changed'), 'guid-f5081099abc8aed5');
            if (!prior && this.registrations.size >= 32)
                throw guidanceError(new Error('Maximum 32 managed MOC regions'), 'guid-7c4b0c93e6bbf3e8');
            const registration = { path, pathPrefix: prefix, owner: principal.accountId, regionHash: hash(current.region?.text ?? ''), status: 'active' };
            this.registrations.set(identity(path), registration);
            await this.write(registration, current);
            return { path, status: registration.status, revision: (await this.fs.readNote(path)).revision };
        });
    }
    async write(row, current) {
        // Persist intent before writing. Old or pending hashes permit crash recovery.
        if (!await this.authorize(row.owner)) {
            row.status = 'suspended';
            await this.save();
            return;
        }
        row.pendingHash = hash(current.text);
        await this.save();
        const original = current.note.originalContent;
        const content = current.region
            ? original.slice(0, current.region.start) + current.text + original.slice(current.region.end)
            : original + (original.endsWith('\n') ? '\n' : '\n\n') + current.text;
        if (content !== original)
            await this.fs.writeNote({ path: row.path, content, expectedRevision: current.note.revision });
        row.regionHash = row.pendingHash;
        delete row.pendingHash;
        await this.save();
    }
    async notify(changes) {
        if (this.closed || this.readOnly)
            return;
        await this.start();
        for (const row of this.registrations.values())
            if (row.status === 'active' && (!changes || changes.some(change => identity(change.path) === identity(row.path) || identity(change.path) === identity(row.pathPrefix) || identity(change.path).startsWith(`${identity(row.pathPrefix)}/`) || identity(row.pathPrefix).startsWith(`${identity(change.path)}/`))))
                this.pending.add(identity(row.path));
        if (this.pending.size && !this.timer) {
            this.timer = setTimeout(() => { this.timer = undefined; void this.flush().catch(() => undefined); }, 250);
            this.timer.unref();
        }
    }
    async flush() {
        await this.start();
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        await this.exclusive(async () => {
            if (this.closed || this.readOnly)
                return;
            const paths = [...this.pending];
            this.pending.clear();
            for (const path of paths) {
                const row = this.registrations.get(path);
                if (row.status !== 'active')
                    continue;
                try {
                    if (!await this.authorize(row.owner)) {
                        row.status = 'suspended';
                        await this.save();
                        continue;
                    }
                    const current = await this.projection(row.path, row.pathPrefix);
                    const observed = hash(current.region?.text ?? '');
                    if (observed !== row.regionHash && observed !== row.pendingHash)
                        throw guidanceError(new Error('Managed region edited'), 'guid-f633928ff6eeb724');
                    const verified = await this.projection(row.path, row.pathPrefix);
                    if (verified.fingerprint !== current.fingerprint)
                        throw guidanceError(new Error('MOC sources changed repeatedly; obtain a fresh preview'), 'guid-a060f569af63eb78');
                    if (current.region?.text === current.text && !row.pendingHash)
                        continue;
                    await this.write(row, current);
                }
                catch {
                    row.status = 'conflict';
                    await this.save();
                }
            }
        });
    }
    async close() { this.closed = true; if (this.timer)
        clearTimeout(this.timer); await this.tail; }
}
