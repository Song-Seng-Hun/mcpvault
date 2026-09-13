import { compilationHash, compilationPath } from './compilation-policy.js';
import { compilationContentHash } from './compilation-model.js';
import { hookHash } from './codex-hook-policy.js';
import { isModerationHidden } from './moderation-policy.js';
import { withEnterpriseStorageContext } from './enterprise-storage-context.js';
/** Narrow host adapter over existing services, not an arbitrary endpoint runner.
 * Public participation is an opportunity for the current agent only. Its actual
 * start/write/finish still use existing consent and publicRequestId enforcement. */
export class CodexHookServiceAdapter {
    options;
    constructor(options) {
        this.options = options;
    }
    execute(work, context) { return this.run(work, context, false); }
    reconcile(work, context) { return this.run(work, context, true); }
    async run(work, context, reconcile) {
        const { fs, access } = this.options, unavailable = () => Error('Hook operation unavailable');
        try {
            await context.assertCurrent();
            const principal = await this.options.authorize(context.ticket.accountId);
            if (!principal || principal.accountId !== context.ticket.accountId || !principal.capabilities?.includes('write'))
                throw unavailable();
            const actor = compilationHash(principal), paths = context.ticket.paths.map(compilationPath);
            const owner = work.action === 'community' ? await this.options.ownerActivity?.begin('collaboration', 'read', paths, principal) : undefined;
            if (work.action === 'community' && !owner)
                throw unavailable();
            const boundary = access.captureDocumentBoundary(principal);
            const active = () => {
                if (context.signal.aborted || Date.now() >= context.deadline)
                    throw unavailable();
                boundary();
                owner?.assertFresh();
                if (paths.some(p => !access.canAccessPhysicalPath(p, principal, false)
                    || access.isConfidentialDocument(p) && context.ticket.runtimeLocal !== true))
                    throw unavailable();
            };
            const check = async () => {
                active();
                await context.assertCurrent();
                await owner?.revalidate();
                if (compilationHash(await this.options.authorize(principal.accountId)) !== actor)
                    throw unavailable();
                active();
            };
            await check();
            return await withEnterpriseStorageContext({ access, principal, assertFresh: active,
                canAccessPath: p => paths.includes(p) && (!owner || owner.canAccessPath(p)),
                canTraversePath: p => (p === '.' || p === '' || paths.some(path => path.startsWith(p + '/'))) && (!owner || owner.canTraversePath(p)),
                beforeWrite: async () => { if (work.action !== 'compilation')
                    throw unavailable(); await check(); },
            }, async () => {
                const completed = (packet, include = true) => {
                    // Some existing readers deliberately conflate denied and absent files.
                    // Their returned identity/continuation is not an additional host grant.
                    let nodes = 0;
                    const validate = (value, depth = 0) => {
                        if (++nodes > 4096 || depth > 20)
                            throw unavailable();
                        if (!value || typeof value !== 'object')
                            return;
                        if (Array.isArray(value)) {
                            for (const item of value)
                                validate(item, depth + 1);
                            return;
                        }
                        for (const [key, item] of Object.entries(value)) {
                            if (['path', 'sourcePath', 'outputPath', 'root_path'].includes(key) && typeof item === 'string') {
                                const physical = access.resolveExternalPath(item, principal);
                                if (!paths.includes(physical) || !access.canAccessPhysicalPath(physical, principal, false))
                                    throw unavailable();
                            }
                            validate(item, depth + 1);
                        }
                    };
                    validate(packet);
                    return { status: 'completed', revision: compilationHash(packet), ...(include && !reconcile && { packet }) };
                };
                let result = { status: 'partial' };
                switch (work.action) {
                    case 'resume':
                        result = completed(await this.options.continuity.read({ principal, maxChars: context.maxChars, validateLearningProgress: true }));
                        break;
                    case 'search':
                        if (this.options.questionPacket)
                            result = completed(await this.options.questionPacket.read({ principal, query: work.query,
                                retrievalMode: 'evidence', includeSemantic: false, maxChars: context.maxChars }));
                        break;
                    case 'candidate': {
                        if (!paths.includes(work.path))
                            throw unavailable();
                        const note = await fs.readNote(work.path, 512 * 1024);
                        if (note.revision !== work.expectedRevision || isModerationHidden(note.frontmatter) || note.frontmatter.llm_wiki_type !== 'source'
                            || note.frontmatter.immutable !== true || note.frontmatter.content_sha256 !== compilationContentHash(note.content))
                            break;
                        if (!this.options.compilation)
                            break;
                        await check();
                        if (!reconcile)
                            await this.options.compilation.notify([work.path]);
                        if (await fs.readNoteRevision(work.path, 512 * 1024) !== note.revision)
                            break;
                        result = { status: 'completed', revision: note.revision };
                        break;
                    }
                    case 'checkpoint':
                        if (this.options.checkpoint)
                            result = await (reconcile ? this.options.checkpoint.inspect.bind(this.options.checkpoint)
                                : this.options.checkpoint.flush.bind(this.options.checkpoint))(work.checkpointId, work.expectedRevision, { ...context, assertCurrent: check });
                        break;
                    case 'compilation': {
                        if (!this.options.compilation)
                            break;
                        const session = this.options.compilationSession;
                        const packet = session && !reconcile ? await this.options.compilation.runSession({ requestId: work.requestId, expectedJobRevision: work.expectedJobRevision }, principal, { ...session, signal: context.signal, deadline: context.deadline, assertCurrent: check })
                            : await this.options.compilation.execute({ op: reconcile ? 'read' : 'retry', requestId: work.requestId,
                                ...(!reconcile && { expectedJobRevision: work.expectedJobRevision }), maxChars: context.maxChars }, principal);
                        if ((packet.status === 'completed' || session && session.application !== 'apply_verified' && packet.status === 'checked')
                            && hookHash(packet.jobRevision))
                            result = { status: 'completed', revision: packet.jobRevision };
                        break;
                    }
                    case 'community':
                        if (this.options.participation) {
                            const packet = await this.options.participation.pulse({ principal, hostBusy: context.ticket.hostBusy, limit: 1, maxChars: context.maxChars });
                            result = completed(packet, packet.state === 'ready');
                        }
                        break;
                }
                await check();
                return result;
            });
        }
        catch {
            throw unavailable();
        }
    }
}
