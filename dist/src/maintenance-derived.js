import { createHash, randomUUID } from 'node:crypto';
import { readJsonCanvasMetadata, validateJsonCanvasDocument } from './json-canvas.js';
import { isModerationHidden } from './moderation-policy.js';
import { PathFilter } from './pathfilter.js';
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class MaintenanceDerivedService {
    fs;
    access;
    wiki;
    refreshCache;
    cacheEpoch = randomUUID();
    constructor(fs, access, wiki, refreshCache) {
        this.fs = fs;
        this.access = access;
        this.wiki = wiki;
        this.refreshCache = refreshCache;
    }
    accessible(path, principal) {
        if (!path || path.trim() !== path || path.includes('\\') || !new PathFilter().isAllowed(path) || /^(?:\/|~|[a-z][a-z0-9+.-]*:)/i.test(path)
            || path.split('/').some(part => !part || part === '.' || part === '..')
            || !this.access.canAccessPhysicalPath(path, principal))
            throw new Error('Derived maintenance path unavailable');
    }
    async plan(operation, path, principal) {
        this.accessible(path, principal);
        const skip = { fingerprint: hash(['unsupported', operation, path]), revision: 'missing', needed: false };
        if (operation === 'cache_refresh') {
            if (!/\.(?:md|markdown|txt)$/i.test(path))
                return skip;
            const note = await this.fs.readNote(path, 256 * 1024);
            this.accessible(path, principal);
            if (isModerationHidden(note.frontmatter))
                throw new Error('Derived source unavailable');
            return { fingerprint: hash(['cache', this.cacheEpoch, path, note.revision]), revision: note.revision, needed: true };
        }
        if (operation !== 'managed_canvas_regenerate' || !/\.canvas$/i.test(path))
            return skip;
        const opened = await this.fs.readCanvasFile(path);
        this.accessible(path, principal);
        const metadata = readJsonCanvasMetadata(opened.document);
        if (!metadata)
            return { fingerprint: hash(['unmanaged', path, opened.revision]), revision: opened.revision, needed: false };
        validateJsonCanvasDocument(opened.document);
        const nodes = new Map(opened.document.nodes.filter(node => node.type === 'file').map(node => [node.id, node]));
        const root = nodes.get(metadata.rootNodeId)?.file;
        if (!root || !/\.(?:md|markdown|txt)$/i.test(root))
            throw new Error('Managed Canvas root unavailable');
        this.accessible(root, principal);
        let stale = false;
        const sources = [];
        for (const [id, expectedRevision] of Object.entries(metadata.revisions)) {
            const target = nodes.get(id)?.file;
            if (!target || !/\.(?:md|markdown|txt)$/i.test(target))
                throw new Error('Managed Canvas source unavailable');
            this.accessible(target, principal);
            if (!this.access.canReferenceFrom(root, target))
                throw new Error('Managed Canvas reference unavailable');
            if (!await this.fs.noteExists(target)) {
                sources.push({ path: target, revision: 'missing' });
                stale = true;
                continue;
            }
            const note = await this.fs.readNote(target, 256 * 1024);
            this.accessible(target, principal);
            if (isModerationHidden(note.frontmatter))
                throw new Error('Managed Canvas source unavailable');
            sources.push({ path: target, revision: note.revision });
            if (note.revision !== expectedRevision)
                stale = true;
        }
        // Follow existing canvas-health semantics: only recorded source drift, not
        // speculative new neighbors, makes a managed map eligible for regeneration.
        const base = { fingerprint: hash([path, opened.revision, sources]), revision: opened.revision, needed: stale };
        if (!stale)
            return base;
        const preview = await this.wiki.canvasView(principal, root, metadata.mode, 2, Math.min(Object.keys(metadata.revisions).length, 50), 12000, false);
        const args = preview.exportAction?.arguments;
        if (!args || preview.exportAction.endpointId !== 'wiki.canvas_export'
            || typeof args.expectedSnapshotFingerprint !== 'string' || typeof args.expectedSourceRevision !== 'string')
            throw new Error('Managed Canvas preview unavailable');
        if ((await this.fs.readCanvasFile(path)).revision !== opened.revision)
            throw new Error('Managed Canvas output changed during preview');
        this.accessible(path, principal);
        return { ...base, fingerprint: hash([base.fingerprint, args.expectedSnapshotFingerprint, args.expectedSourceRevision]),
            exportArguments: { ...args, path: root, outputPath: path, expectedRevision: opened.revision, includeSemantic: false } };
    }
    async inspect(operation, path, principal) {
        const { exportArguments: _privatePlan, ...snapshot } = await this.plan(operation, path, principal);
        return snapshot;
    }
    async repair(operation, path, principal, assertAccess, recordIntent, expected, assertCurrent) {
        await assertAccess();
        const snapshot = await this.plan(operation, path, principal);
        if (!snapshot.needed || snapshot.revision !== expected.revision || snapshot.fingerprint !== expected.fingerprint)
            throw new Error('Derived maintenance input changed or needs no repair');
        if (operation === 'cache_refresh') {
            await assertAccess();
            assertCurrent?.();
            await this.refreshCache(path, principal);
            await assertAccess();
            if ((await this.fs.readNote(path, 256 * 1024)).revision !== snapshot.revision)
                throw new Error('Cache source changed during rebuild');
            return { revision: snapshot.revision };
        }
        if (!snapshot.exportArguments)
            throw new Error('Managed Canvas export unavailable');
        const result = await this.wiki.writeCanvasView({ ...snapshot.exportArguments, principal }, { assertAccess, beforeWrite: recordIntent, ...(assertCurrent && { assertCurrent }) });
        await assertAccess();
        const current = await this.fs.readCanvasFile(path);
        if (current.revision !== result.revision || readJsonCanvasMetadata(current.document)?.snapshotFingerprint !== result.snapshotFingerprint)
            throw new Error('Managed Canvas repair verification changed');
        return { revision: result.revision };
    }
}
