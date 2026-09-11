import { guidanceError, guidanceText } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { ScopeAccessPolicy } from './scope-access.js';
import { normalizeScopeId } from './scopes.js';
import { isModerationHidden } from './moderation-policy.js';
import { inspectUnderstanding, prepareUnderstanding, UNDERSTANDING_READ_BYTES, UNDERSTANDING_UNAVAILABLE } from './continuity-understanding.js';
import { inspectContinuityPins } from './continuity-pins.js';
import { prepareLearningConfiguration, isLearningConfigurationState } from './learning-configuration.js';
const MAX_TEXT = 4000;
const MAX_LEARNING_ENTRIES = 50;
const REVISION_PATTERN = /^[a-f0-9]{64}$/;
function ownerPath(principal) {
    if (principal.agentId)
        return `_scopes/agents/${normalizeScopeId(principal.agentId, 'agentId')}/_continuity/work-state.md`;
    return `_scopes/models/${normalizeScopeId(principal.modelId, 'modelId')}/_continuity/accounts/${normalizeScopeId(principal.accountId, 'accountId')}/work-state.md`;
}
function requiredPrincipal(principal) {
    if (!principal)
        throw guidanceError(new Error('Login is required to save or resume private work state'), 'guid-92b2d0df72da1698');
    return principal;
}
function short(value, field, required = false) {
    const result = String(value ?? '').trim();
    if (required && !result)
        throw guidanceError(new Error(`${field} is required`), 'guid-0c6fd33ea1895f5e');
    if (result.length > MAX_TEXT)
        throw guidanceError(new Error(`${field} must be ${MAX_TEXT} characters or fewer`), 'guid-14159076104d2d61');
    return result || undefined;
}
function list(value, field) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value))
        throw guidanceError(new Error(`${field} must be an array of strings`), 'guid-c49beaf7ea701a04');
    return Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean))).slice(0, 20).map(item => item.slice(0, 500));
}
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function fingerprint(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
/** Project a read, never rewrite its canonical checkpoint or shorten edit guards. */
function packResumeState(full, maxChars, prettyPrint) {
    const fits = (value) => JSON.stringify(value, null, prettyPrint ? 2 : undefined).length <= maxChars;
    if (fits(full))
        return full;
    const result = {
        ...full, fm: {}, content: '', truncated: true,
        nextAction: { endpointId: 'mcp.read_note_lines', arguments: { path: full.path, expectedRevision: full.revision, startLine: 1, endLine: 40, maxChars: 6000 } },
    };
    // Route provenance is advisory; never displace safety or executable locators.
    delete result.route;
    if (full.understanding)
        result.nextAction = { endpointId: 'continuity.resume', arguments: { maxChars: 12000, prettyPrint: false } };
    // Keep the validated next target before optional history and duplicate prose.
    if (!fits(result) && result.learningProgress?.drift) {
        const { drift: _drift, ...progress } = result.learningProgress;
        result.learningProgress = { ...progress, detailsOmitted: true };
    }
    if (!fits(result)) {
        result.nextAction = { endpointId: 'continuity.resume', arguments: { maxChars: 12000, prettyPrint: false } };
    }
    if (!fits(result) && result.learningProgress) {
        // A partial next target is not executable. Require revalidation at a larger
        // budget rather than claiming that a missing action is ready to resume.
        result.learningProgress = { state: result.learningProgress.state, canResume: false, detailsOmitted: true };
    }
    if (!fits(result) && result.understanding) {
        result.understanding = { state: result.understanding.state, canResume: false, detailsOmitted: true };
        result.nextAction = { endpointId: 'continuity.resume', arguments: { maxChars: 12000 } };
    }
    if (!fits(result))
        result.validation = { detailsOmitted: true,
            ...(full.validation.selectedPinsCurrent !== undefined && { selectedPinsCurrent: full.validation.selectedPinsCurrent }) };
    if (!fits(result))
        throw guidanceError(new Error('Resume identity and safety state exceed maxChars; retry continuity.resume with maxChars=12000 and prettyPrint=false.'), 'guid-03ff3c9c7205c93a');
    const fitBody = (length) => {
        let low = 0, high = length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            result.content = full.content.slice(0, mid);
            if (fits(result))
                low = mid;
            else
                high = mid - 1;
        }
        result.content = full.content.slice(0, low);
        if (/[\uD800-\uDBFF]$/.test(result.content))
            result.content = result.content.slice(0, -1);
    };
    const priority = ['topic', 'next_action', 'cursors', 'pending_edits', 'research_trail', 'focus_questions', 'focus_projects', 'focus_notes', 'open_questions', 'references'];
    const keys = [...priority.filter(key => Object.hasOwn(full.fm, key)), ...Object.keys(full.fm).filter(key => !priority.includes(key))];
    let bodyReserved = false;
    for (const key of keys) {
        if (!bodyReserved && key !== 'topic' && key !== 'next_action') {
            // Metadata must not consume every character and leave an unusable '# W'.
            fitBody(Math.min(full.content.length, 400, Math.floor(maxChars / 4)));
            bodyReserved = true;
        }
        const value = full.fm[key];
        Object.defineProperty(result.fm, key, { value, enumerable: true, writable: true, configurable: true });
        if (fits(result))
            continue;
        if (Array.isArray(value)) {
            // Preserve an ordered prefix of whole entries, especially revision guards.
            let low = 0, high = value.length;
            while (low < high) {
                const mid = Math.ceil((low + high) / 2);
                result.fm[key] = value.slice(0, mid);
                if (fits(result))
                    low = mid;
                else
                    high = mid - 1;
            }
            result.fm[key] = value.slice(0, low);
            if (fits(result))
                continue;
        }
        delete result.fm[key];
    }
    fitBody(full.content.length);
    return result;
}
function pendingEdits(value) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value))
        throw guidanceError(new Error('pendingEdits must be an array'), 'guid-a80da8953b8ffbb7');
    const result = [];
    for (const raw of value.slice(0, 20)) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            throw guidanceError(new Error('Each pendingEdit must be an object'), 'guid-ecc01251f2a70457');
        const item = raw;
        const path = String(item.path ?? '').trim().replace(/\\/g, '/');
        const expectedRevision = String(item.expectedRevision ?? '').trim();
        const endpointId = String(item.endpointId ?? '').trim().toLowerCase();
        const purpose = String(item.purpose ?? '').trim().replace(/\s+/g, ' ');
        if (!path || path.length > 500 || path.split('/').includes('..'))
            throw guidanceError(new Error('pendingEdit.path must be a safe note path or scope URI of 500 characters or fewer'), 'guid-9e3187d5f871bd1a');
        if (!expectedRevision || expectedRevision.length > 200)
            throw guidanceError(new Error('pendingEdit.expectedRevision is required and must be 200 characters or fewer'), 'guid-cf01bbc9f2254190');
        if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(endpointId))
            throw guidanceError(new Error('pendingEdit.endpointId must be a valid endpoint id'), 'guid-031fc3b30efc890f');
        if (purpose.length > 500)
            throw guidanceError(new Error('pendingEdit.purpose must be 500 characters or fewer'), 'guid-bf4eac346e08ba25');
        const normalized = { path, expectedRevision, endpointId, ...(purpose && { purpose }) };
        if (!result.some(existing => existing.path === path && existing.endpointId === endpointId))
            result.push(normalized);
    }
    return result;
}
function researchTrail(value) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value))
        throw guidanceError(new Error('researchTrail must be an array'), 'guid-f9024625898ca217');
    const result = [];
    for (const raw of value.slice(0, 20)) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            throw guidanceError(new Error('Each researchTrail item must be an object'), 'guid-5981c36a9d489e8e');
        const item = raw;
        const kind = String(item.kind ?? '').trim().toLowerCase();
        const summary = String(item.summary ?? '').trim().replace(/\s+/g, ' ');
        const path = String(item.path ?? '').trim().replace(/\\/g, '/');
        const revision = String(item.revision ?? '').trim();
        if (!['query', 'read', 'finding', 'decision'].includes(kind))
            throw guidanceError(new Error('researchTrail.kind must be query, read, finding, or decision'), 'guid-9373d38e4481d9e8');
        if (!summary || summary.length > 500)
            throw guidanceError(new Error('researchTrail.summary is required and must be 500 characters or fewer'), 'guid-8804a19ce913f059');
        if (path && (path.length > 500 || path.split('/').includes('..')))
            throw guidanceError(new Error('researchTrail.path must be a safe note path or scope URI of 500 characters or fewer'), 'guid-de4b63ed723c8e4b');
        if (revision.length > 200)
            throw guidanceError(new Error('researchTrail.revision must be 200 characters or fewer'), 'guid-12a3373d788b2e04');
        const normalized = { kind, summary, ...(path && { path }), ...(revision && { revision }) };
        if (!result.some(existing => existing.kind === kind && existing.summary === summary && existing.path === path))
            result.push(normalized);
    }
    return result;
}
function render(state) {
    const learningIndex = state.learningProgress?.completed_through
        ? state.learningProgress.entries.findIndex(item => item.path === state.learningProgress.completed_through)
        : -1;
    const learningNext = state.learningProgress?.entries[learningIndex + 1];
    return [
        `# Work state: ${state.topic}`,
        '',
        '## Summary',
        '', state.summary,
        '',
        '## Next action',
        '', state.nextAction,
        ...(state.openQuestions?.length ? ['', '## Open questions', '', ...state.openQuestions.map(item => `- ${item}`)] : []),
        ...(state.references?.length ? ['', '## References', '', ...state.references.map(item => `- ${item}`)] : []),
        ...(state.focus?.questions?.length ? ['', '## Top-of-mind questions', '', ...state.focus.questions.map(item => `- ${item}`)] : []),
        ...(state.focus?.projects?.length ? ['', '## Top-of-mind projects', '', ...state.focus.projects.map(item => `- ${item}`)] : []),
        ...(state.focus?.notes?.length ? ['', '## Top-of-mind notes', '', ...state.focus.notes.map(item => `- ${item}`)] : []),
        ...(state.pendingEdits?.length ? ['', '## Pending revision-checked edits', '', ...state.pendingEdits.map(item => `- ${item.endpointId} · ${item.path} · revision ${item.expectedRevision}${item.purpose ? ` · ${item.purpose}` : ''}`)] : []),
        ...(state.researchTrail?.length ? ['', '## Research trail', '', ...state.researchTrail.map(item => `- ${item.kind} · ${item.summary}${item.path ? ` · ${item.path}` : ''}${item.revision ? ` · revision ${item.revision}` : ''}`)] : []),
        ...(state.learningProgress ? ['', '## Learning progress', '',
            `- Root: ${state.learningProgress.root_path}`,
            `- Order: ${state.learningProgress.order}`,
            `- Progress: ${learningIndex + 1}/${state.learningProgress.entries.length}`,
            ...(learningNext ? [`- Next: ${learningNext.path}`] : ['- State: complete at the saved revisions']),
            '- Resume through continuity.resume so path and note drift are checked before reading on.',
        ] : []),
        ...(state.cursors && Object.keys(state.cursors).length ? ['', '## Cursors', '', '```json', JSON.stringify(state.cursors), '```'] : []),
        '',
    ].join('\n');
}
export class ContinuityService {
    fileSystem;
    access;
    buildLearningPath;
    constructor(fileSystem, options = {}) {
        this.fileSystem = fileSystem;
        this.access = options.access || new ScopeAccessPolicy();
        this.buildLearningPath = options.buildLearningPath;
    }
    physicalLearningPath(value, field, principal) {
        const raw = String(value ?? '').trim();
        if (!raw || raw.length > 500)
            throw guidanceError(new Error(`${field} is required and must be 500 characters or fewer`), 'guid-5471d8b0a2aabefe');
        const path = this.access.resolveExternalPath(raw, principal).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (!path || path.split('/').some(part => part === '.' || part === '..') || !this.access.canAccessPhysicalPath(path, principal)) {
            throw guidanceError(new Error(`${field} must be a visible, safe note path`), 'guid-405b63ed8188e1ae');
        }
        return path;
    }
    async prepareLearningProgress(principal, value, allowUnpinnedConfiguration = false) {
        if (value === undefined)
            return undefined;
        const input = record(value);
        if (!input)
            throw guidanceError(new Error('learningProgress must be an object'), 'guid-ca0bd48aa887b743');
        if (!this.buildLearningPath)
            throw guidanceError(new Error('Learning-path checkpoints are unavailable on this server'), 'guid-b076df246b2c0795');
        const rootPath = this.physicalLearningPath(input.rootPath, 'learningProgress.rootPath', principal);
        const order = String(input.order || 'authored').trim().toLowerCase();
        if (!['authored', 'recommended'].includes(order))
            throw guidanceError(new Error('learningProgress.order must be authored or recommended'), 'guid-9faaf41144dc6bc2');
        const maxDepth = input.maxDepth === undefined ? 2 : Number(input.maxDepth);
        if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 6)
            throw guidanceError(new Error('learningProgress.maxDepth must be an integer from 0 to 6'), 'guid-d5955d23f0f07f85');
        const projection = await this.buildLearningPath(principal, rootPath, maxDepth, MAX_LEARNING_ENTRIES, 16_000);
        const root = record(projection.root);
        const rootRevision = String(root?.revision || '').toLowerCase();
        if (!REVISION_PATTERN.test(rootRevision))
            throw guidanceError(new Error('The learning path did not return a valid root revision'), 'guid-833b0f17ce8cdae2');
        const authored = Array.isArray(projection.authoredOrder) ? projection.authoredOrder : [];
        const authoredEntries = [];
        for (const raw of authored.slice(0, MAX_LEARNING_ENTRIES)) {
            const item = record(raw);
            if (!item)
                continue;
            const physical = this.physicalLearningPath(item.path, 'learningProgress entry path', principal);
            const revision = String(item.revision || '').toLowerCase();
            if (!REVISION_PATTERN.test(revision))
                throw guidanceError(new Error(`Learning-path entry '${item.path}' has no valid revision`), 'guid-2c0d2b6c10c758fc');
            const path = this.access.toPublicPath(physical);
            if (!authoredEntries.some(existing => existing.path === path))
                authoredEntries.push({ path, revision });
        }
        const omitted = Number(record(projection.summary)?.omittedEntries || 0);
        if (omitted > 0 || authored.length > MAX_LEARNING_ENTRIES) {
            throw guidanceError(new Error(`Learning progress is limited to ${MAX_LEARNING_ENTRIES} entries; split this oversized MOC into nested maps before checkpointing it`), 'guid-5c306c03a7870d4b');
        }
        if (projection.truncated === true) {
            throw guidanceError(new Error('The learning path scan is truncated or incomplete; simplify the MOC or checkpoint a smaller nested map before saving progress'), 'guid-dbc6bd326e4d8d08');
        }
        if (projection.navigationComplete === false) {
            throw guidanceError(new Error('The authored MOC route contains unresolved, ambiguous, inaccessible entries, or missing heading/block locators; inspect wiki.learning_path and repair the links, or save ordinary work state without learningProgress'), 'guid-0cd32f9ebd181b9c');
        }
        const byPath = new Map(authoredEntries.map(item => [item.path, item]));
        const entries = order === 'authored'
            ? authoredEntries
            : (Array.isArray(projection.recommendedOrder) ? projection.recommendedOrder : []).map(rawPath => {
                const physical = this.physicalLearningPath(rawPath, 'recommended learning path', principal);
                const path = this.access.toPublicPath(physical);
                const item = byPath.get(path);
                if (!item)
                    throw guidanceError(new Error(`Recommended learning entry is missing a revision snapshot: ${path}`), 'guid-3bc27f48ea56b912');
                return item;
            });
        if (order === 'recommended' && authoredEntries.length > 0 && entries.length !== authoredEntries.length) {
            throw guidanceError(new Error('The recommended path omits cyclic or blocked entries; use authored order or repair the MOC before saving progress'), 'guid-6c425c5b4ff44aab');
        }
        const sourceRevisionFingerprint = typeof projection.sourceRevisionFingerprint === 'string' ? projection.sourceRevisionFingerprint.toLowerCase() : '';
        if (!REVISION_PATTERN.test(sourceRevisionFingerprint)) {
            throw guidanceError(new Error('The learning path did not return a valid source revision fingerprint; rebuild it before saving progress'), 'guid-6d261f677cc51b26');
        }
        let completedThrough;
        if (input.completedThrough !== undefined && String(input.completedThrough).trim()) {
            const physical = this.physicalLearningPath(input.completedThrough, 'learningProgress.completedThrough', principal);
            completedThrough = this.access.toPublicPath(physical);
            if (!entries.some(item => item.path === completedThrough))
                throw guidanceError(new Error('learningProgress.completedThrough must be one entry in the selected learning path'), 'guid-d4b2ae79ac21a3cf');
        }
        const publicRoot = this.access.toPublicPath(rootPath);
        let configuration;
        if (input.configuration !== undefined) {
            const config = record(input.configuration);
            if (!config || !Array.isArray(config.mappings) || config.mappings.length > 16)
                throw guidanceError(new Error('Invalid learning configuration mapping'), 'guid-f26673509e7432dc');
            const mappings = config.mappings.map(raw => ({ ...raw, path: this.access.toPublicPath(this.physicalLearningPath(raw?.path, 'mapping path', principal)) }));
            configuration = prepareLearningConfiguration({ ...config, mappings }, entries, { rootPath: publicRoot, rootRevision, sourceFingerprint: sourceRevisionFingerprint, order }, allowUnpinnedConfiguration);
        }
        const savedAt = new Date().toISOString();
        return {
            root_path: publicRoot,
            root_revision: rootRevision,
            order,
            max_depth: maxDepth,
            ...(completedThrough && { completed_through: completedThrough }),
            entries,
            structure_fingerprint: fingerprint({ root: publicRoot, order, maxDepth, paths: entries.map(item => item.path), ...(configuration && { configuration: configuration.fingerprint }) }),
            revision_fingerprint: fingerprint({ root: [publicRoot, rootRevision], entries, sources: sourceRevisionFingerprint, ...(configuration && { configuration: configuration.fingerprint }) }),
            source_revision_fingerprint: sourceRevisionFingerprint,
            ...(configuration && { configuration }),
            saved_at: savedAt,
        };
    }
    async previewLearningConfiguration(params) {
        const principal = requiredPrincipal(params.principal), maxChars = params.maxChars ?? 6000;
        if (!Number.isSafeInteger(maxChars) || maxChars < 1024 || maxChars > 12000)
            throw guidanceError(new Error('Preview maxChars must be 1024..12000'), 'guid-3c40a8fffac190c2');
        const progress = (await this.prepareLearningProgress(principal, { rootPath: params.rootPath, order: params.order, maxDepth: params.maxDepth,
            configuration: { definition: params.configuration, mappings: params.mappings } }, true));
        const configured = progress.configuration;
        const result = { root: { path: progress.root_path, revision: progress.root_revision }, fingerprint: configured.fingerprint,
            mappings: configured.mappings, executable: false, permissionsGranted: false, competencyCertified: false,
            checkpointAction: { endpointId: 'continuity.save', requiredArguments: ['topic', 'summary', 'nextAction'], learningProgress: {
                    rootPath: progress.root_path, order: progress.order, maxDepth: progress.max_depth,
                    configuration: { definition: configured.definition, mappings: configured.mappings.map(({ nodeId, path }) => ({ nodeId, path })), expectedFingerprint: configured.fingerprint },
                } } };
        if (JSON.stringify(result).length > maxChars)
            throw guidanceError(new Error('Mapped preview exceeds maxChars; increase the budget or narrow the configuration'), 'guid-9a4645382369f7ad');
        return result;
    }
    compactLearningProgress(progress, state, drift) {
        const completedIndex = progress.completed_through ? progress.entries.findIndex(item => item.path === progress.completed_through) : -1;
        const next = progress.entries[completedIndex + 1];
        return {
            state,
            root: { path: progress.root_path, revision: progress.root_revision },
            order: progress.order,
            maxDepth: progress.max_depth,
            entriesTracked: progress.entries.length,
            completedCount: completedIndex + 1,
            ...(progress.configuration && { configuration: { fingerprint: progress.configuration.fingerprint, mappedNodes: progress.configuration.mappings.length, competencyCertified: false } }),
            ...(progress.completed_through && { completedThrough: progress.completed_through }),
            ...(state === 'ready' && next && { next: { ...next, endpointId: 'notes.read', arguments: { path: next.path, maxChars: 6000 } } }),
            ...(drift && { drift }),
            ...(state === 'stale' ? { canResume: false, nextAction: { endpointId: 'wiki.learning_path', arguments: { path: progress.root_path, maxDepth: progress.max_depth, limit: MAX_LEARNING_ENTRIES, maxChars: 7000 } } } : {}),
            ...(state === 'ready' ? { canResume: true } : {}),
            ...(state === 'complete' ? { canResume: true, complete: true } : {}),
            ...(state === 'saved_unchecked' ? { canResume: false, revalidateWith: 'continuity.resume' } : {}),
        };
    }
    async validateLearningProgress(principal, raw, validate) {
        const candidate = record(raw);
        const candidateEntries = Array.isArray(candidate?.entries) ? candidate.entries : [];
        const entries = candidateEntries.slice(0, MAX_LEARNING_ENTRIES).flatMap(rawEntry => {
            const item = record(rawEntry);
            const path = String(item?.path || '').trim();
            const revision = String(item?.revision || '').trim().toLowerCase();
            return path && path.length <= 500 && REVISION_PATTERN.test(revision) ? [{ path, revision }] : [];
        });
        const order = String(candidate?.order || '');
        const maxDepth = Number(candidate?.max_depth);
        const stored = candidate
            && String(candidate.root_path || '').length <= 500
            && REVISION_PATTERN.test(String(candidate.root_revision || '').toLowerCase())
            && ['authored', 'recommended'].includes(order)
            && Number.isInteger(maxDepth) && maxDepth >= 0 && maxDepth <= 6
            && candidateEntries.length <= MAX_LEARNING_ENTRIES
            && entries.length === candidateEntries.length
            && REVISION_PATTERN.test(String(candidate.structure_fingerprint || '').toLowerCase())
            && REVISION_PATTERN.test(String(candidate.revision_fingerprint || '').toLowerCase())
            && (candidate.source_revision_fingerprint === undefined || (typeof candidate.source_revision_fingerprint === 'string' && REVISION_PATTERN.test(candidate.source_revision_fingerprint.toLowerCase())))
            && (candidate.configuration === undefined || isLearningConfigurationState(candidate.configuration))
            ? {
                root_path: String(candidate.root_path), root_revision: String(candidate.root_revision).toLowerCase(), order, max_depth: maxDepth,
                ...(candidate.completed_through && { completed_through: String(candidate.completed_through) }), entries,
                structure_fingerprint: String(candidate.structure_fingerprint).toLowerCase(), revision_fingerprint: String(candidate.revision_fingerprint).toLowerCase(),
                ...(candidate.source_revision_fingerprint !== undefined && { source_revision_fingerprint: String(candidate.source_revision_fingerprint).toLowerCase() }),
                saved_at: String(candidate.saved_at || ''),
                ...(candidate.configuration !== undefined && { configuration: candidate.configuration }),
            }
            : undefined;
        if (!stored || (stored.completed_through !== undefined && !stored.entries.some(item => item.path === stored.completed_through))) {
            return { state: 'invalid_checkpoint', canResume: false, reason: guidanceText('guid-560636f338fb6f21', 'Stored learning progress is malformed; regenerate it with continuity.save.') };
        }
        if (!validate)
            return this.compactLearningProgress(stored, 'saved_unchecked');
        try {
            const current = await this.prepareLearningProgress(principal, {
                rootPath: stored.root_path,
                order: stored.order,
                maxDepth: stored.max_depth,
                ...(stored.completed_through && { completedThrough: stored.completed_through }),
                ...(stored.configuration && { configuration: { definition: stored.configuration.definition,
                        mappings: stored.configuration.mappings.map(({ nodeId, path }) => ({ nodeId, path })), expectedFingerprint: stored.configuration.fingerprint } }),
            });
            if (!current)
                throw guidanceError(new Error('Learning path could not be rebuilt'), 'guid-bee1ead1a6c2dda9');
            const previousByPath = new Map(stored.entries.map(item => [item.path, item.revision]));
            const currentByPath = new Map(current.entries.map(item => [item.path, item.revision]));
            const changedEntries = [...new Set([...previousByPath.keys(), ...currentByPath.keys()])].flatMap(path => {
                const previous = previousByPath.get(path);
                const next = currentByPath.get(path);
                if (previous === next)
                    return [];
                return [{ path, state: previous === undefined ? 'added' : next === undefined ? 'removed' : 'revised', ...(previous && { previousRevision: previous }), ...(next && { currentRevision: next }) }];
            });
            const structureChanged = current.structure_fingerprint !== stored.structure_fingerprint;
            const revisionsChanged = current.revision_fingerprint !== stored.revision_fingerprint;
            const sourceSnapshotChanged = current.source_revision_fingerprint !== stored.source_revision_fingerprint;
            if (structureChanged || revisionsChanged || sourceSnapshotChanged) {
                return this.compactLearningProgress(stored, 'stale', {
                    rootChanged: current.root_revision !== stored.root_revision,
                    structureChanged,
                    revisionsChanged,
                    sourceSnapshotChanged,
                    ...(stored.source_revision_fingerprint === undefined && { sourceSnapshotMissing: true }),
                    changedEntries: changedEntries.slice(0, 8),
                    changedEntriesTotal: changedEntries.length,
                });
            }
            const completedIndex = current.completed_through ? current.entries.findIndex(item => item.path === current.completed_through) : -1;
            return this.compactLearningProgress(current, completedIndex + 1 >= current.entries.length ? 'complete' : 'ready');
        }
        catch (error) {
            return {
                ...this.compactLearningProgress(stored, 'stale'),
                drift: { validationError: error instanceof Error ? error.message.slice(0, 500) : 'Learning path validation failed' },
            };
        }
    }
    async save(params) {
        const principal = requiredPrincipal(params.principal);
        const topic = short(params.topic, 'topic', true);
        const summary = short(params.summary, 'summary', true);
        const nextAction = short(params.nextAction, 'nextAction', true);
        const openQuestions = list(params.openQuestions, 'openQuestions');
        const references = list(params.references, 'references');
        const focusQuestions = list(params.focusQuestions, 'focusQuestions');
        const focusProjects = list(params.focusProjects, 'focusProjects');
        const focusNotes = list(params.focusNotes, 'focusNotes');
        const pending = pendingEdits(params.pendingEdits);
        const trail = researchTrail(params.researchTrail);
        const learningProgress = await this.prepareLearningProgress(principal, params.learningProgress);
        if (params.cursors !== undefined && (!params.cursors || typeof params.cursors !== 'object' || Array.isArray(params.cursors)))
            throw guidanceError(new Error('cursors must be an object'), 'guid-ae5e94f342fcaafc');
        const path = ownerPath(principal);
        if (!this.access.canAccessPhysicalPath(path, principal))
            throw Error(UNDERSTANDING_UNAVAILABLE);
        const existing = await this.fileSystem.noteExists(path) ? await this.fileSystem.readNote(path, UNDERSTANDING_READ_BYTES) : undefined;
        if (existing && isModerationHidden(existing.frontmatter))
            throw Error(UNDERSTANDING_UNAVAILABLE);
        if (existing?.frontmatter.owner_account_id !== undefined && existing.frontmatter.owner_account_id !== principal.accountId)
            throw Error(UNDERSTANDING_UNAVAILABLE);
        const previousUnderstanding = existing?.frontmatter.learning_understanding;
        if (existing && (params.understanding !== undefined || previousUnderstanding !== undefined) && !params.expectedRevision)
            throw guidanceError(Error('expectedRevision is required for an understanding checkpoint update; resume first.'), 'guid-efd363f9f27d6246');
        const prepared = params.understanding === undefined ? undefined : await prepareUnderstanding(this.fileSystem, this.access, principal, path, params.understanding);
        const understanding = prepared?.entries ?? previousUnderstanding;
        const expectedRevision = params.expectedRevision || existing?.revision || 'missing';
        const updatedAt = new Date().toISOString();
        const write = {
            path,
            content: render({ topic, summary, nextAction, ...(openQuestions && { openQuestions }), ...(references && { references }), ...(params.cursors && { cursors: params.cursors }), focus: { ...(focusQuestions && { questions: focusQuestions }), ...(focusProjects && { projects: focusProjects }), ...(focusNotes && { notes: focusNotes }) }, ...(pending && { pendingEdits: pending }), ...(trail && { researchTrail: trail }), ...(learningProgress && { learningProgress }) }),
            frontmatter: {
                mcpvault_type: 'agent_work_state', owner: principal.agentId || principal.modelId,
                owner_account_id: principal.accountId,
                model_id: principal.modelId, ...(principal.agentId && { agent_id: principal.agentId }),
                topic, next_action: nextAction, open_questions: openQuestions || [], references: references || [],
                cursors: params.cursors || {}, focus_questions: focusQuestions || [], focus_projects: focusProjects || [], focus_notes: focusNotes || [], pending_edits: pending || [], research_trail: trail || [], ...(learningProgress && { learning_progress: learningProgress }), updated_at: updatedAt,
                ...(understanding !== undefined && { learning_understanding: understanding }),
            },
            expectedRevision,
        };
        const learningGuards = learningProgress?.configuration ? [{ path: this.physicalLearningPath(learningProgress.root_path, 'root path', principal), expectedRevision: learningProgress.root_revision },
            ...learningProgress.entries.map(entry => ({ path: this.physicalLearningPath(entry.path, 'entry path', principal), expectedRevision: entry.revision }))] : [];
        const uniqueGuards = new Map();
        for (const guard of [...(prepared?.guards ?? []), ...learningGuards]) {
            const key = this.fileSystem.noteChangeIdentity(guard.path), prior = uniqueGuards.get(key);
            if (prior && prior.expectedRevision !== guard.expectedRevision)
                throw guidanceError(new Error('Checkpoint source revisions disagree; repeat the preview'), 'guid-600024eed508eb79');
            uniqueGuards.set(key, guard);
        }
        const guards = [...uniqueGuards.values()];
        const assertAccess = () => { if (!this.access.canAccessPhysicalPath(path, principal) || learningGuards.some(g => !this.access.canAccessPhysicalPath(g.path, principal)))
            throw Error(UNDERSTANDING_UNAVAILABLE); prepared?.assertAccess(); };
        assertAccess();
        const receipt = guards.length
            ? await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt(write, guards, { maxBytes: UNDERSTANDING_READ_BYTES, maxGuards: 128, assertAccess })
            : await this.fileSystem.writeNoteWithReceipt(write, { maxBytes: UNDERSTANDING_READ_BYTES, assertAccess });
        const learningCompletedIndex = learningProgress?.completed_through ? learningProgress.entries.findIndex(item => item.path === learningProgress.completed_through) : -1;
        const learningState = learningProgress && learningCompletedIndex + 1 >= learningProgress.entries.length ? 'complete' : 'ready';
        return { success: true, path: this.access.toPublicPath(path), updatedAt, revision: receipt.revision, ...(learningProgress && { learningProgress: this.compactLearningProgress(learningProgress, learningState) }) };
    }
    async read(params) {
        const principal = requiredPrincipal(params.principal);
        const path = ownerPath(principal);
        const watched = new Set([this.fileSystem.noteChangeIdentity(path)]);
        let changed = false;
        const unobserve = this.fileSystem.observeNoteChanges(target => { if (watched.has(this.fileSystem.noteChangeIdentity(target)))
            changed = true; });
        try {
            if (!await this.fileSystem.noteExists(path))
                return { exists: false, path: this.access.toPublicPath(path), ...(!principal.agentId && { legacyCheckpointPolicy: 'Old model work-state.md is host-review-only; never copy ownerless historical state to another account automatically.' }) };
            if (!this.access.canAccessPhysicalPath(path, principal))
                throw Error(UNDERSTANDING_UNAVAILABLE);
            const note = await this.fileSystem.readNote(path, UNDERSTANDING_READ_BYTES);
            if (isModerationHidden(note.frontmatter))
                throw Error(UNDERSTANDING_UNAVAILABLE);
            if (note.frontmatter.owner_account_id !== undefined && note.frontmatter.owner_account_id !== principal.accountId)
                throw Error(UNDERSTANDING_UNAVAILABLE);
            const requestedChars = Number(params.maxChars ?? 6000);
            const maxChars = Number.isFinite(requestedChars) ? Math.min(Math.max(Math.floor(requestedChars), 512), 12000) : 6000;
            const { learning_progress: rawLearningProgress, learning_understanding: rawUnderstanding, ...frontmatter } = note.frontmatter;
            const learningProgress = rawLearningProgress === undefined
                ? undefined
                : await this.validateLearningProgress(principal, rawLearningProgress, params.validateLearningProgress !== false);
            const understanding = rawUnderstanding === undefined ? undefined : await inspectUnderstanding(this.fileSystem, this.access, principal, path, rawUnderstanding, params.validateLearningProgress !== false, target => watched.add(this.fileSystem.noteChangeIdentity(target)));
            const pins = await inspectContinuityPins(this.fileSystem, this.access, principal, frontmatter, params.validatePins, target => watched.add(this.fileSystem.noteChangeIdentity(target)));
            if (await this.fileSystem.readNoteRevision(path, UNDERSTANDING_READ_BYTES) !== note.revision || !this.access.canAccessPhysicalPath(path, principal))
                throw Error(UNDERSTANDING_UNAVAILABLE);
            await understanding?.revalidate();
            await pins.revalidate();
            if (changed || !this.access.canAccessPhysicalPath(path, principal))
                throw Error(UNDERSTANDING_UNAVAILABLE);
            understanding?.assertAccess?.();
            const validation = { checked: ['checkpoint'], unchecked: ['pendingEdits', 'researchTrail', 'otherSavedFields'],
                ...(pins.pins.length && { pins: pins.pins, selectedPinsCurrent: pins.pins.every(pin => pin.state === 'current') }) };
            for (const [field, present] of [['learningProgress', learningProgress], ['understanding', understanding]])
                if (present)
                    (params.validateLearningProgress === false ? validation.unchecked : validation.checked).push(field);
            return packResumeState({
                exists: true,
                path: this.access.toPublicPath(path),
                fm: frontmatter,
                content: note.content,
                truncated: false,
                revision: note.revision,
                validation,
                ...((learningProgress || understanding) && (!learningProgress || learningProgress.canResume === true)
                    && (!understanding || understanding.projection.canResume === true) && params.validateLearningProgress !== false && validation.selectedPinsCurrent !== false
                    ? { route: { kind: 'verified_resume', reason: 'current_checkpoint_references_and_access', skipped: ['global_orientation'] } } : {}),
                ...(learningProgress && { learningProgress }),
                ...(understanding && { understanding: understanding.projection }),
            }, maxChars, params.prettyPrint === true);
        }
        finally {
            unobserve();
        }
    }
}
