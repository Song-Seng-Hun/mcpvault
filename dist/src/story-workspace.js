import { guidanceError } from './guidance-runtime.js';
import { isModerationHidden } from './moderation-policy.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import { StoryStore } from './story-store.js';
import { storyArtifactPath, storyHash, storyList, storyPath, storyProjectPath, storyRevision, storyRoot } from './story-model.js';
/** Shared security and current-source checks, not a model executor. */
export class StoryWorkspace {
    fs;
    access;
    references;
    auth;
    work;
    tasks;
    options;
    store;
    constructor(fs, access, references, auth, work, tasks, options = {}) {
        this.fs = fs;
        this.access = access;
        this.references = references;
        this.auth = auth;
        this.work = work;
        this.tasks = tasks;
        this.options = options;
        this.store = new StoryStore(fs, access);
    }
    async actor(principal, allowReadOnly = false) {
        if (!principal)
            throw guidanceError(new Error('Authenticated account required for story mutation'), 'guid-fdcef9cb9054ef89');
        if (this.options.readOnly && !allowReadOnly)
            throw guidanceError(new Error('Story server is read-only'), 'guid-ec2e79aa817cec12');
        const current = (await this.auth.listPrincipals()).find(p => p.accountId === principal.accountId);
        if (!current || current.modelId !== principal.modelId || current.agentId !== principal.agentId || current.role !== principal.role
            || !this.auth.hasCapability(current, 'write') || !this.auth.hasCapability(principal, 'write')
            || !this.auth.hasCapability(current, 'task') || !this.auth.hasCapability(principal, 'task')
            || !this.access.canAccessPhysicalPath('Community/Stories', principal))
            throw guidanceError(new Error('Authenticated story account unavailable or lacks write/task capability'), 'guid-9d34725353bfea71');
        await this.options.assertActor?.(principal);
        return principal;
    }
    async project(projectId, principal) {
        const note = (await this.store.read(storyProjectPath(projectId), principal));
        if (note.frontmatter.mcpvault_type !== 'story_project' || note.frontmatter.project_id !== projectId)
            throw guidanceError(new Error('Story project unavailable'), 'guid-cbebc93974b368d0');
        return note;
    }
    async authorize(project, principal, role = 'member', allowDisabled = false, allowReadOnly = false) {
        const actor = await this.actor(principal, allowReadOnly);
        const current = await this.project(project.frontmatter.project_id, actor);
        if (current.revision !== project.revision)
            throw guidanceError(new Error('Story project delegation or revision changed during operation'), 'guid-61d0d9aee9288279');
        const fm = project.frontmatter;
        if (!allowDisabled && fm.enabled !== true)
            throw guidanceError(new Error('Story project disabled'), 'guid-fa5d6dd70f510c40');
        if (!Array.isArray(fm.participants) || !fm.participants.includes(actor.accountId))
            throw guidanceError(new Error('Story participant membership required'), 'guid-65456151ef90fa33');
        if (role === 'owner' && actor.accountId !== fm.owner_account_id)
            throw guidanceError(new Error('Only story owner can change delegation or project settings'), 'guid-434b265edef0945f');
        if (role === 'showrunner' && actor.accountId !== fm.showrunner_account_id)
            throw guidanceError(new Error('Current showrunner required'), 'guid-6c3a7311269dd84d');
        return this.work.authorizeWorkshopProject(actor, fm.work_project_id, role === 'owner', undefined, fm.owner_account_id);
    }
    async artifact(projectId, artifactId, principal, branchId) {
        const note = (await this.store.read(storyArtifactPath(projectId, artifactId), principal));
        if (note.frontmatter.mcpvault_type !== 'story_artifact' || note.frontmatter.project_id !== projectId || note.frontmatter.artifact_id !== artifactId)
            throw guidanceError(new Error('Story artifact unavailable'), 'guid-2090cc5af0c365c4');
        if (branchId && note.frontmatter.branch_id !== branchId)
            throw guidanceError(new Error('Story source belongs to a different branch'), 'guid-4f3423434ac44189');
        return note;
    }
    projectRevision(project, value) {
        if (storyRevision(value) !== project.revision)
            throw guidanceError(new Error('Story project revision conflict; reread current delegation and context'), 'guid-70337d549bf8feaf');
    }
    async sourceGuards(projectId, sources, principal, branchId) {
        const guards = [];
        const seen = new Set();
        for (const source of sources) {
            if (seen.has(source.artifactId))
                throw guidanceError(new Error('Duplicate story source'), 'guid-9880e6aec3ce5441');
            seen.add(source.artifactId);
            const note = await this.artifact(projectId, source.artifactId, principal, branchId);
            if (note.revision !== source.revision)
                throw guidanceError(new Error('Stale story source revision'), 'guid-f979124430a4ae81');
            guards.push({ path: note.path, expectedRevision: note.revision });
        }
        return guards;
    }
    async referencesFor(projectId, branchId, value, path, content, principal, strictBodyLinks = false) {
        storyList(value ?? [], 'story references', 50);
        if (extractObsidianLinkOccurrences(content).length > 50)
            throw guidanceError(new Error('Story reference limit exceeded'), 'guid-7aee9ee36500bf7f');
        // Resolve separately so the shared service cannot silently truncate the union.
        const explicit = await this.references.validateAndNormalize(value, path, principal);
        const body = await this.references.validateAndNormalize([], path, principal, content, { strictBodyLinks });
        const paths = [...new Set([...explicit, ...body])];
        if (paths.length > 50)
            throw guidanceError(new Error('Story reference limit exceeded'), 'guid-7aee9ee36500bf7f');
        const guards = [];
        for (const target of paths) {
            const note = (await this.store.read(target, principal));
            if (/^Community\/Stories\//i.test(target)) {
                this.assertDependencyDomain(note, projectId, branchId);
            }
            guards.push({ path: target, expectedRevision: note.revision });
        }
        return { paths, guards };
    }
    /** Never allow a later read of the same path to replace an authored pin. */
    mergeGuards(guards) {
        const pins = new Map();
        for (const guard of guards) {
            const path = storyPath(guard?.path), expectedRevision = storyRevision(guard?.expectedRevision);
            const key = path.toLowerCase(), prior = pins.get(key);
            if (prior && prior.expectedRevision !== expectedRevision)
                throw guidanceError(new Error('Conflicting story source revision guards'), 'guid-253f2d40f9d9fc4f');
            if (!prior)
                pins.set(key, { path, expectedRevision });
            if (pins.size > 128)
                throw guidanceError(new Error('Story dependency limit exceeds 128 sources'), 'guid-f42a3374d1e197bc');
        }
        return [...pins.values()];
    }
    assertDependencyDomain(note, projectId, branchId) {
        if (!note.path.toLowerCase().startsWith(`${storyRoot(projectId)}/`.toLowerCase()) || note.frontmatter.project_id !== projectId)
            throw guidanceError(new Error('Cross-project story reference is not allowed'), 'guid-620e2037b58dbd93');
        if (note.path.toLowerCase() !== storyProjectPath(projectId).toLowerCase() && note.frontmatter.branch_id !== branchId)
            throw guidanceError(new Error('Cross-branch story reference is not allowed'), 'guid-59536f5facfa4f81');
    }
    /** Fresh bounded closure, carried unchanged into every editorial write guard. */
    async dependencyGuards(note, principal, extra = []) {
        const projectId = note.frontmatter.project_id, branchId = note.frontmatter.branch_id ?? 'main';
        let guards = this.mergeGuards([{ path: note.path, expectedRevision: note.revision }, ...extra]);
        let bytes = 0;
        for (let index = 0; index < guards.length; index++) {
            const pin = guards[index];
            if (!this.access.canAccessPhysicalPath(pin.path, principal) || !this.access.canReferenceFrom(note.path, pin.path))
                throw guidanceError(new Error('Story source unavailable in this scope'), 'guid-0688c9bbd6df63ad');
            const current = (await this.store.read(pin.path, principal));
            bytes += Buffer.byteLength(current.originalContent, 'utf8');
            if (bytes > 8 * 1024 * 1024)
                throw guidanceError(new Error('Story dependency byte budget exceeded'), 'guid-ce24ce921bcd2c72');
            if (current.revision !== pin.expectedRevision)
                throw guidanceError(new Error('Stale story source revision'), 'guid-f979124430a4ae81');
            if (!/^Community\/Stories\//i.test(current.path))
                continue;
            this.assertDependencyDomain(current, projectId, branchId);
            const sources = storyList(current.frontmatter.source_revisions ?? [], 'source revisions', 128);
            const refs = await this.referencesFor(projectId, branchId, current.frontmatter.references ?? [], current.path, current.content, principal, true);
            // Host-edited YAML is authoritative too. Scan each authored string with
            // independent Markdown fences, without trusting the old derived manifest.
            const values = ['title', 'data', 'findings', 'reason', 'brief']
                .map(field => ({ value: current.frontmatter[field] }));
            const active = new WeakSet(), visited = new WeakSet();
            let scanned = 0, textBytes = Buffer.byteLength(current.content, 'utf8');
            while (values.length) {
                if (++scanned > 8192)
                    throw guidanceError(new Error('Story authored value scan budget exceeded'), 'guid-a8a63dee1b73a5ee');
                const { value, leave } = values.pop();
                if (value && typeof value === 'object') {
                    if (leave) {
                        active.delete(value);
                        continue;
                    }
                    if (active.has(value))
                        throw guidanceError(new Error('Cyclic story authored data is unavailable'), 'guid-b4f3066b2ca9c1cf');
                    if (visited.has(value))
                        continue;
                    visited.add(value);
                    active.add(value);
                    const children = Object.values(value);
                    if (scanned + values.length + children.length + 1 > 8192)
                        throw guidanceError(new Error('Story authored value scan budget exceeded'), 'guid-a8a63dee1b73a5ee');
                    values.push({ value, leave: true }, ...children.map(child => ({ value: child })));
                }
                else if (typeof value === 'string') {
                    textBytes += Buffer.byteLength(value, 'utf8');
                    if (textBytes > 512000)
                        throw guidanceError(new Error('Story authored text byte budget exceeded'), 'guid-e651289629df0413');
                    if (!extractObsidianLinkOccurrences(value).length)
                        continue;
                    const authored = await this.referencesFor(projectId, branchId, [], current.path, value, principal, true);
                    refs.paths = [...new Set([...refs.paths, ...authored.paths])];
                    if (refs.paths.length > 50)
                        throw guidanceError(new Error('Story reference limit exceeded'), 'guid-7aee9ee36500bf7f');
                    refs.guards = this.mergeGuards([...refs.guards, ...authored.guards]);
                }
            }
            guards = this.mergeGuards([...guards, ...sources, ...refs.guards]);
        }
        return guards;
    }
    async inventory(projectId, directory, principal, filters = {}) {
        const prefix = `${storyRoot(projectId)}/${directory}`;
        const notes = [];
        let after;
        let bytes = 0;
        do {
            const rows = await this.fs.queryNotes({ pathPrefix: prefix, filters: { ...filters, project_id: projectId }, limit: 100, includeContent: false, ...(after && { after }) }, path => this.access.canAccessPhysicalPath(path, principal), note => !isModerationHidden(note.frontmatter));
            for (const row of rows.notes) {
                if (!row.path.startsWith(`${prefix}/`))
                    continue;
                if (notes.length >= 2048)
                    throw guidanceError(new Error('Story collection scan exceeds 2048 records; request a narrower branch or kind'), 'guid-9ee772c8c32276bf');
                const note = (await this.store.read(row.path, principal));
                if (row.revision && row.revision !== note.revision)
                    throw guidanceError(new Error('Story inventory source changed; restart the current page'), 'guid-d4dfa0a24abe5418');
                bytes += Buffer.byteLength(note.originalContent, 'utf8');
                if (bytes > 8 * 1024 * 1024)
                    throw guidanceError(new Error('Story collection exceeds byte scan budget; request a narrower branch or kind'), 'guid-9a0c659348c1ab33');
                if (note.frontmatter.project_id === projectId)
                    notes.push(note);
            }
            after = rows.truncated ? rows.nextCursor : undefined;
            if (rows.truncated && !after)
                throw guidanceError(new Error('Story inventory changed during pagination'), 'guid-1b917f6ca8d79ecf');
        } while (after);
        return notes;
    }
    async stale(note, principal) {
        const staleSources = [];
        const queue = [...(note.frontmatter.source_revisions ?? [])];
        const seen = new Set();
        let reads = 0;
        while (queue.length) {
            const source = queue.shift();
            const identity = `${source.path}:${source.expectedRevision}`;
            if (seen.has(identity))
                continue;
            seen.add(identity);
            if (++reads > 128) {
                staleSources.push('dependency_budget_exceeded');
                break;
            }
            try {
                if (!source.path.startsWith(`${storyRoot(note.frontmatter.project_id)}/`) && !this.access.canReferenceFrom(note.path, source.path))
                    throw new Error();
                const current = await this.store.read(source.path, principal);
                if (current?.revision !== source.expectedRevision)
                    staleSources.push(this.access.toPublicPath(source.path));
                else if (current.frontmatter.project_id === note.frontmatter.project_id && Array.isArray(current.frontmatter.source_revisions)) {
                    if (queue.length + current.frontmatter.source_revisions.length > 256) {
                        staleSources.push('dependency_budget_exceeded');
                        break;
                    }
                    queue.push(...current.frontmatter.source_revisions);
                }
            }
            catch {
                staleSources.push('unavailable');
            }
        }
        return { stale: staleSources.length > 0, staleSources: [...new Set(staleSources)] };
    }
    /** Bounded body continuation is revision- and actor-bound, not a second source. */
    detail(value, params, principal) {
        if (params.expectedRevision !== undefined && (!params.op || ['read', 'preview', 'health'].includes(params.op))
            && storyRevision(params.expectedRevision) !== value.revision)
            throw guidanceError(new Error('Story read revision conflict; reread the current source'), 'guid-2788668adbcd099b');
        const max = params.maxChars ?? 4000;
        if (!Number.isInteger(max) || max < 512 || max > 12000)
            throw guidanceError(new Error('maxChars must be 512..12000'), 'guid-4b78da01578248c7');
        const signature = storyHash({ path: value.path, revision: value.revision, actor: principal?.accountId, field: params.field });
        const serialized = params.field ? JSON.stringify(value[params.field] ?? null) : String(value.content ?? '');
        let offset = 0;
        if (params.cursor) {
            try {
                const decoded = JSON.parse(Buffer.from(params.cursor, 'base64url').toString());
                if (params.cursor.length > 1000 || decoded.f !== signature || !Number.isSafeInteger(decoded.o) || decoded.o < 0 || decoded.o >= serialized.length)
                    throw new Error();
                offset = decoded.o;
            }
            catch {
                throw guidanceError(new Error('Story cursor invalidated; reread current revision'), 'guid-c4b3acfa17ea65e6');
            }
        }
        const result = params.field ? { path: value.path, revision: value.revision, field: params.field, content: '' } : { ...value, content: '' };
        if (JSON.stringify(result).length > max - 300) {
            const retained = {};
            for (const key of ['path', 'revision', 'projectId', 'artifactId', 'reviewId', 'sessionId', 'kind', 'stale', 'enabled', 'showrunnerAccountId'])
                if (value[key] !== undefined)
                    retained[key] = value[key];
            Object.keys(result).forEach(key => delete result[key]);
            Object.assign(result, retained, { content: '', omittedFields: true, nextAction: { endpointId: 'notes.read', arguments: { path: value.path, expectedRevision: value.revision, maxChars: 12000 } } });
        }
        result.contentOffset = offset;
        result.contentTotal = serialized.length;
        let end = Math.min(serialized.length, offset + max);
        do {
            result.content = serialized.slice(offset, end);
            result.truncated = end < serialized.length;
            if (result.truncated)
                result.cursor = Buffer.from(JSON.stringify({ f: signature, o: end })).toString('base64url');
            else
                delete result.cursor;
            if (JSON.stringify(result).length <= max)
                return result;
            end -= Math.max(1, Math.ceil((JSON.stringify(result).length - max) / 2));
        } while (end > offset);
        if (!serialized.length && JSON.stringify(result).length <= max)
            return result;
        throw guidanceError(new Error('maxChars too small for story response; request a field or larger budget'), 'guid-931062d9deeeeea9');
    }
}
