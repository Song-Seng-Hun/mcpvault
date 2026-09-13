import { compilationContentHash } from './compilation-model.js';
import { normalizeCompilationEvidence } from './compilation-evidence.js';
import { normalizeCompilationObservation } from './compilation-observation.js';
import { checkFidelityLiterals } from './fidelity-literals.js';
import { resolveEvidenceLocator } from './evidence-locator.js';
import { isModerationHidden } from './moderation-policy.js';
const unavailable = () => Error('Compilation publication unavailable; review current evidence and authority');
/** Trusted host adapter, not enabled by feature/model/client declarations. All
 * inference comes from the current agent's submitted draft; comparison is local
 * lexical-only and no provider, source capture, merge or claim promotion runs. */
export class CompilationPublicationAdapter {
    options;
    constructor(options) {
        this.options = options;
    }
    async principal(job, current, publish = true) {
        await current();
        const p = await this.options.authorize(job.accountId);
        if (!p || p.accountId !== job.accountId || !p.capabilities?.includes('write') || publish && !p.capabilities.includes('publish'))
            throw unavailable();
        if (![job.outputPath, ...job.inputs.map(i => i.path)].every(path => this.options.access.canAccessPhysicalPath(path, p)))
            throw unavailable();
        return p;
    }
    async protect(job, current) {
        await this.principal(job, current);
        if (job.protection !== 'ready' || job.inputs.some(i => !this.options.access.canReferenceFrom(job.outputPath, i.path)))
            throw unavailable();
    }
    covers(note, locators) {
        const lines = note.content.split('\n'), covered = new Uint8Array(lines.length);
        for (const locator of locators) {
            const resolved = resolveEvidenceLocator(note.content, locator, note.revision);
            if (!resolved.valid || !resolved.startLine || !resolved.endLine)
                return false;
            covered.fill(1, resolved.startLine - 1, resolved.endLine);
        }
        return !lines.some((line, index) => line.trim() && !covered[index]);
    }
    /** Verifies acquired source bytes and attributed no-change observations only.
     * Does not call preview/apply, generate text, or assert semantic equivalence. */
    async checkObservation(job, current) {
        const answer = (status) => ({ status, ruleVersion: 'observation-v1' });
        try {
            if (!job.observation || job.draft || job.evidence || job.protection !== 'ready')
                return answer('partial');
            const observation = normalizeCompilationObservation(job.observation, job.inputs, job.operation);
            const principal = await this.principal(job, current, false);
            const notes = new Map();
            const load = async (path) => {
                if (notes.has(path))
                    return notes.get(path);
                const input = job.inputs.find(i => i.path === path);
                if (!input)
                    throw unavailable();
                const allowed = (p) => this.options.access.canAccessPhysicalPath(p, principal);
                if (!allowed(path))
                    throw unavailable();
                // Refresh the existing local read model without embedding/provider work.
                const metadata = (await this.options.fs.readNoteMetadata([path], allowed, { fresh: true, strict: true, maxBytes: 512 * 1024 }))[0];
                if (!metadata || metadata.revision !== input.revision || isModerationHidden(metadata.frontmatter))
                    throw unavailable();
                const note = await this.options.fs.readNote(path, 512 * 1024);
                if (note.revision !== input.revision || isModerationHidden(note.frontmatter) || !allowed(path))
                    throw unavailable();
                notes.set(path, note);
                return note;
            };
            const sources = job.inputs.filter(i => i.role === 'source');
            if (!sources.length)
                return answer('partial');
            for (const input of sources) {
                const note = await load(input.path);
                if (note.frontmatter.llm_wiki_type !== 'source' || note.frontmatter.immutable !== true
                    || note.frontmatter.content_sha256 !== compilationContentHash(note.content)
                    || !this.covers(note, observation.coverage.filter(c => c.sourcePath === input.path).map(c => c.locator)))
                    return answer('partial');
                if (observation.kind === 'source_only')
                    continue;
                const matches = observation.matches.filter(m => m.sourcePath === input.path);
                // Checking a whole source is not proof that its unpaired lines are covered.
                if (!this.covers(note, matches.map(m => m.sourceLocator)))
                    return answer('partial');
                const compared = await this.options.comparison.read({ sourcePath: this.options.access.toPublicPath(input.path),
                    expectedRevision: input.revision, query: observation.query, includeSemantic: false, maxChars: 12000, principal });
                if (compared.source?.integrity !== 'verified' || compared.truncated)
                    return answer('partial');
                for (const match of matches) {
                    const target = await load(match.knowledgePath);
                    if (match.semanticJudgment !== 'covered' || target.frontmatter.llm_wiki_type !== 'knowledge'
                        || ['archived', 'superseded'].includes(String(target.frontmatter.lifecycle || '').toLowerCase())
                        || ['superseded', 'disputed'].includes(String(target.frontmatter.knowledge_status || '').toLowerCase())
                        || !this.options.access.canReferenceFrom(match.knowledgePath, input.path)
                        || !compared.candidates.some((c) => c.path === this.options.access.toPublicPath(match.knowledgePath)
                            && c.revision === target.revision && c.integrationAllowed))
                        return answer('partial');
                    const literal = checkFidelityLiterals({ source: { body: note.content, revision: note.revision },
                        output: { body: target.content, revision: target.revision }, sourceLocator: match.sourceLocator,
                        outputLocator: match.knowledgeLocator, comparisonMode: 'exact' });
                    if (literal.status !== 'match')
                        return answer('partial');
                }
            }
            const refreshed = await this.principal(job, current, false);
            for (const input of job.inputs)
                if (await this.options.fs.readNoteRevision(input.path, 512 * 1024) !== input.revision)
                    return answer('partial');
            if (![job.outputPath, ...job.inputs.map(i => i.path)].every(p => this.options.access.canAccessPhysicalPath(p, refreshed)))
                return answer('partial');
            return answer('passed');
        }
        catch {
            return answer('partial');
        }
    }
    async check(job, current) {
        const answer = (status) => ({ status, ruleVersion: 'fidelity-v1' });
        try {
            if (job.operation !== 'synthesize' || !job.draft?.generatedAt || !job.evidence)
                return answer('partial');
            const evidence = normalizeCompilationEvidence(job.evidence, job.inputs, job.draft);
            if (!['new_knowledge', 'extend_existing'].includes(evidence.decision))
                return answer('partial');
            const principal = await this.principal(job, current);
            await this.protect(job, current);
            const bodies = new Map();
            const sources = job.inputs.filter(i => i.role === 'source');
            if (!sources.length)
                return answer('partial');
            for (const input of sources) {
                if (!this.options.access.canAccessPhysicalPath(input.path, principal))
                    return answer('partial');
                const note = await this.options.fs.readNote(input.path, 512 * 1024);
                if (isModerationHidden(note.frontmatter) || note.revision !== input.revision || note.frontmatter.llm_wiki_type !== 'source'
                    || note.frontmatter.immutable !== true || note.frontmatter.content_sha256 !== compilationContentHash(note.content))
                    return answer('partial');
                bodies.set(input.path, note);
                const lines = note.content.split('\n'), covered = new Uint8Array(lines.length);
                for (const checkpoint of evidence.coverage.filter(c => c.sourcePath === input.path)) {
                    const resolved = resolveEvidenceLocator(note.content, checkpoint.locator, note.revision);
                    if (!resolved.valid || !resolved.startLine || !resolved.endLine)
                        return answer('partial');
                    covered.fill(1, resolved.startLine - 1, resolved.endLine);
                }
                if (lines.some((line, index) => line.trim() && !covered[index]))
                    return answer('partial');
                const compared = await this.options.comparison.read({ sourcePath: this.options.access.toPublicPath(input.path),
                    expectedRevision: input.revision, query: evidence.query, includeSemantic: false, maxChars: 12000, principal });
                if (compared.source?.integrity !== 'verified' || compared.truncated)
                    return answer('partial');
                if (evidence.decision === 'extend_existing' && !compared.candidates.some((c) => c.path === this.options.access.toPublicPath(job.outputPath)
                    && c.revision === job.outputRevision && c.integrationAllowed))
                    return answer('partial');
            }
            if (evidence.decision === 'new_knowledge' && job.outputRevision !== 'missing')
                return answer('partial');
            for (const fact of evidence.facts) {
                const source = bodies.get(fact.sourcePath);
                if (!source || fact.semanticJudgment !== 'preserved')
                    return answer('partial');
                const result = checkFidelityLiterals({ source: { body: source.content, revision: source.revision },
                    output: { body: job.draft.content, revision: job.draft.fingerprint }, sourceLocator: fact.sourceLocator,
                    outputLocator: fact.outputLocator, comparisonMode: fact.comparisonMode });
                if (result.status !== 'match')
                    return answer('partial');
            }
            if (job.outputRevision !== 'missing') {
                const output = await this.options.fs.readNote(job.outputPath, 512 * 1024);
                if (output.revision !== job.outputRevision || isModerationHidden(output.frontmatter)
                    || output.frontmatter.knowledge_status !== 'draft' || output.frontmatter.llm_wiki_type !== 'knowledge')
                    return answer('partial');
            }
            await this.principal(job, current);
            for (const input of job.inputs)
                if (await this.options.fs.readNoteRevision(input.path, 512 * 1024) !== input.revision)
                    return answer('partial');
            if (!job.inputs.every(i => this.options.access.canAccessPhysicalPath(i.path, principal)))
                return answer('partial');
            return answer('passed');
        }
        catch {
            return answer('partial');
        }
    }
    async prepare(job, current) {
        if ((await this.check(job, current)).status !== 'passed')
            throw unavailable();
        const principal = await this.principal(job, current);
        return this.options.wiki.prepareKnowledgePublication({ path: job.outputPath, content: job.draft.content,
            evidencePaths: job.inputs.filter(i => i.role === 'source').map(i => i.path),
            evidence: job.evidence.facts.map(fact => ({ path: fact.sourcePath, ...fact.sourceLocator })),
            author: principal.agentId || principal.accountId, status: 'draft', expectedRevision: job.outputRevision, principal, }, { timestamp: job.draft.generatedAt, revisionGuards: job.inputs.map(i => ({ path: i.path, expectedRevision: i.revision })),
            assertOutputAccess: async () => { await this.protect(job, current); } });
    }
    async preview(job, current) {
        const prepared = await this.prepare(job, current);
        return { revision: prepared.revision, fingerprint: prepared.fingerprint };
    }
    async apply(job, intent, current) {
        const prepared = await this.prepare(job, current);
        if (prepared.revision !== intent.revision || prepared.fingerprint !== intent.fingerprint)
            throw unavailable();
        return prepared.apply(intent.fingerprint);
    }
}
