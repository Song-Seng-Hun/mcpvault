import { isModerationHidden } from './moderation-policy.js';
export async function attachCompilationReview(options) {
    const { fs, access, principal, result, maxChars } = options;
    try {
        const boundary = access.captureDocumentBoundary(principal);
        const guards = new Map();
        const collect = (value) => {
            if (!value || typeof value !== 'object')
                return;
            if (Array.isArray(value)) {
                for (const item of value)
                    collect(item);
                return;
            }
            const row = value;
            if (typeof row.path === 'string' && typeof row.revision === 'string' && /^[a-f0-9]{64}$/.test(row.revision)) {
                const path = access.resolveExternalPath(row.path, principal);
                if (!access.canAccessPhysicalPath(path, principal, false) || guards.has(path) && guards.get(path) !== row.revision)
                    throw Error();
                guards.set(path, row.revision);
            }
            for (const child of Object.values(row))
                collect(child);
        };
        collect(result);
        if (guards.size > 128)
            throw Error();
        const findings = await options.review(options.allJobs ? undefined : [...guards.keys()]);
        // Reading diagnostics introduces awaits after the original view was packed.
        // Revalidate that original evidence as well as the new finding identities.
        for (const finding of findings)
            collect(finding);
        if (guards.size > 256)
            throw Error();
        for (const [path, revision] of guards) {
            if (!access.canAccessPhysicalPath(path, principal, false))
                throw Error();
            if (/\.canvas$/i.test(path)) {
                if ((await fs.readCanvasFile(path)).revision !== revision)
                    throw Error();
            }
            else {
                const note = (await fs.readNoteMetadata([path], p => access.canAccessPhysicalPath(p, principal, false), { fresh: true, strict: true }))[0];
                if (!note || note.revision !== revision || isModerationHidden(note.frontmatter))
                    throw Error();
            }
        }
        await options.revalidateActor();
        boundary();
        if ([...guards.keys()].some(path => !access.canAccessPhysicalPath(path, principal, false)))
            throw Error();
        if (!findings.length)
            return result;
        const length = (value) => JSON.stringify(value, null, options.prettyPrint ? 2 : undefined).length;
        const annotated = { ...result, status: 'partial', partial: true, compilationReview: findings };
        if (length(annotated) <= maxChars)
            return annotated;
        // Never squeeze out evidence silently to add host-private diagnostics.
        // A complete pinned action is more useful than an orphaned warning count.
        const minimal = { status: 'partial', partial: true, truncated: true, omissionReason: 'compilation_review_response_budget',
            nextAction: findings[0].nextAction, resume: options.retry };
        if (length(minimal) <= maxChars)
            return minimal;
        const { resume: _resume, ...small } = minimal;
        if (length(small) <= maxChars)
            return small;
        const actionOnly = { status: 'partial', partial: true, nextAction: findings[0].nextAction };
        if (length(actionOnly) > maxChars)
            throw Error();
        return actionOnly;
    }
    catch {
        throw Error('Compilation context unavailable; retry with current authorization');
    }
}
