import { guidanceError } from './guidance-runtime.js';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { open, lstat, unlink } from 'node:fs/promises';
import { FrontmatterHandler } from './frontmatter.js';
import { readFederationFile, writeFederationFileAtomic } from './public-federation-storage.js';
import { DocumentAuthority, documentPolicyPath } from './document-authority.js';
import { isOriginalPath } from './original-boundary.js';
export const DOCUMENT_POLICY_PATH = '_wiki/_policies/documents.md';
const unavailable = () => guidanceError(new Error('Protected document policy unavailable; host review required'), 'guid-9690a0ffb67e9c3d');
/** Authoritative Markdown metadata, deliberately outside the generic note API.
 * No raw original is changed and no request can claim or downgrade its rules.
 * Each request refreshes before work and before returning, including on NAS.
 * Compiled definitions are reused only for exactly the same policy bytes. */
export class DocumentPolicyStore {
    vault;
    definition = Object.freeze([]);
    digest;
    seen = false;
    ready = false;
    queue = Promise.resolve();
    content = '';
    constructor(vault) {
        this.vault = vault;
    }
    rules() {
        if (!this.ready)
            throw unavailable();
        return this.definition;
    }
    revision() {
        this.rules();
        return this.digest ?? 'missing';
    }
    refresh() {
        // A final refresh must not reuse a read that began before it was requested.
        this.queue = this.queue.then(() => this.read(), () => this.read());
        return this.queue;
    }
    async read() {
        try {
            let content;
            try {
                content = await readFederationFile(this.vault, join(this.vault, DOCUMENT_POLICY_PATH), { maxBytes: 2 * 1024 * 1024 });
            }
            catch (error) {
                if (!this.seen && error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
                    this.ready = true;
                    return;
                }
                throw unavailable();
            }
            this.seen = true;
            const digest = createHash('sha256').update(content).digest('hex');
            if (digest !== this.digest) {
                const { frontmatter } = new FrontmatterHandler().parse(content);
                if (frontmatter.type !== 'protected-document-policy' || frontmatter.version !== 1
                    || !Array.isArray(frontmatter.rules) || Object.keys(frontmatter).some(k => !['type', 'version', 'rules'].includes(k)))
                    throw unavailable();
                const authority = new DocumentAuthority(frontmatter.rules);
                this.definition = authority.rules;
                this.digest = digest;
                this.content = content;
            }
            this.ready = true;
        }
        catch {
            this.ready = false;
            throw unavailable();
        }
    }
    /** Trusted writer: can only ADD inherited restrictions, never relax or edit
     * source classifications. Persist before writing a derivative's body. A failed
     * later write may leave conservative metadata, never a public partial body. */
    async inherit(targetInput, sourceInputs, expectedRevision) {
        const target = documentPolicyPath(targetInput);
        if (isOriginalPath(target))
            throw guidanceError(new Error('Original classification cannot be changed by derivative inheritance'), 'guid-bf3a46d519f8033b');
        if (!Array.isArray(sourceInputs) || !sourceInputs.length || sourceInputs.length > 32)
            throw guidanceError(new Error('Derived sources must be a bounded nonempty list'), 'guid-36a4912b05458b6a');
        const sources = [...new Set(sourceInputs.map(documentPolicyPath))];
        if (sources.includes(target))
            throw guidanceError(new Error('Cyclic derived document policy'), 'guid-f3bd9bf8b5ffb8c9');
        return this.updateRules(expectedRevision, () => {
            const existing = this.definition.find(rule => rule.path === target);
            const inherited = new DocumentAuthority(this.definition).effectiveConstraints(target);
            const needed = sources.filter(source => !inherited.some(rule => rule.derivedFrom?.includes(source)));
            if (!needed.length)
                return;
            const derivedFrom = [...new Set([...(existing?.derivedFrom ?? []), ...needed])];
            return [...this.definition.filter(rule => rule.path !== target), { ...existing, path: target, derivedFrom }];
        });
    }
    /** Persist restrictions and a directory-wide hold before any chapter bytes.
     * A published/reused root is not silently adopted as a new bundle. */
    async beginPublication(root, sourceInputs, owner, expectedRevision) {
        const path = documentPolicyPath(root);
        if (isOriginalPath(path) || !/^[a-f0-9]{64}$/.test(owner) || !Array.isArray(sourceInputs)
            || !sourceInputs.length || sourceInputs.length > 32)
            throw unavailable();
        const sources = [...new Set(sourceInputs.map(documentPolicyPath))];
        if (sources.some(source => source === path || source.startsWith(path + '/')))
            throw unavailable();
        return this.updateRules(expectedRevision, () => {
            const existing = this.definition.find(rule => rule.path === path);
            if (existing) {
                if (existing.publicationHold !== owner || !existing.recursive
                    || JSON.stringify(existing.derivedFrom) !== JSON.stringify(sources))
                    throw unavailable();
                return;
            }
            return [...this.definition, { path, recursive: true, derivedFrom: sources, publicationHold: owner }];
        });
    }
    /** The publication owner supplies a reread-verified manifest before calling.
     * This removes only its hold; current source/audience constraints survive. */
    async finishPublication(root, owner, expectedRevision) {
        const path = documentPolicyPath(root);
        if (!/^[a-f0-9]{64}$/.test(owner))
            throw unavailable();
        return this.updateRules(expectedRevision, () => {
            const existing = this.definition.find(rule => rule.path === path);
            if (!existing || existing.publicationHold !== owner || !existing.recursive)
                throw unavailable();
            const { publicationHold: _held, ...retained } = existing;
            return this.definition.map(rule => rule === existing ? retained : rule);
        });
    }
    /** Re-hide only the exact released rule pinned by the publication journal.
     * The caller still verifies ownership, outputs and current authorization. */
    async holdPublished(root, owner, released, expectedRevision) {
        const path = documentPolicyPath(root);
        if (!/^[a-f0-9]{64}$/.test(owner) || !released || released.path !== path || !released.recursive || released.publicationHold)
            throw unavailable();
        const canonical = (rule) => JSON.stringify(new DocumentAuthority([rule]).rules);
        return this.updateRules(expectedRevision, () => {
            const existing = this.definition.find(rule => rule.path === path);
            if (!existing || canonical(existing) !== canonical(released))
                throw unavailable();
            return this.definition.map(rule => rule === existing ? { ...rule, publicationHold: owner } : rule);
        });
    }
    updateRules(expectedRevision, transform) {
        const update = async () => {
            await this.read();
            if (this.revision() !== expectedRevision)
                throw guidanceError(new Error('Protected document policy revision changed'), 'guid-1bc997e4b0c7d462');
            const lockPath = join(this.vault, '_wiki', '_policies', '.documents.lock');
            let lock;
            try {
                lock = await open(lockPath, 'wx', 0o600);
            }
            catch {
                throw guidanceError(new Error('Protected document policy is locked; retry or ask the host to inspect an interrupted writer'), 'guid-1eeee5d513578437');
            }
            const identity = await lock.stat();
            try {
                await this.read();
                if (this.revision() !== expectedRevision)
                    throw guidanceError(new Error('Protected document policy revision changed'), 'guid-1bc997e4b0c7d462');
                const rules = transform();
                if (!rules)
                    return;
                const next = new DocumentAuthority(rules);
                const body = new FrontmatterHandler().updateFrontmatter(this.content, { rules: next.rules });
                // Check the authoritative revision again after preparation. The lock is
                // cross-process; out-of-band NAS edits still cause a conflict on reread.
                await this.read();
                if (this.revision() !== expectedRevision)
                    throw guidanceError(new Error('Protected document policy revision changed'), 'guid-1bc997e4b0c7d462');
                await writeFederationFileAtomic(this.vault, join(this.vault, DOCUMENT_POLICY_PATH), body, { maxBytes: 2 * 1024 * 1024 });
                await this.read();
                if (this.digest !== createHash('sha256').update(body).digest('hex'))
                    throw guidanceError(new Error('Protected document policy changed while committing inheritance'), 'guid-677722ecff6dd218');
            }
            finally {
                await lock.close();
                // Never remove a replacement lock belonging to another writer.
                const present = await lstat(lockPath).catch(() => undefined);
                if (present && !present.isSymbolicLink() && present.ino === identity.ino && present.dev === identity.dev)
                    await unlink(lockPath);
            }
        };
        this.queue = this.queue.then(update, update);
        return this.queue;
    }
}
