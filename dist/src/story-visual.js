import { guidanceError } from './guidance-runtime.js';
import { FrontmatterHandler } from './frontmatter.js';
import { page } from './work-model.js';
import { storyAccount, storyData, storyHash, storyId, storyIds, storyList, storyObject, storyRevision, storySources } from './story-model.js';
import { applyStoryVisualEdits, assertStoryVisualPassages, parseStoryVisual, parseStoryVisualIntent } from './story-visual-model.js';
const fail = (message) => { throw guidanceError(new Error(message), 'guid-story-visual-validation'); };
// Force an outer header, exactly as StoryStore does. An empty Properties object
// returns the raw body, whose leading YAML example must never be reparsed away.
const canonicalBody = (content) => new FrontmatterHandler().parse(new FrontmatterHandler().stringify({ mcpvault_type: 'story_artifact' }, content)).content;
async function typedArtifact(w, projectId, artifactId, branchId, kind, principal) {
    const note = await w.artifact(projectId, storyId(artifactId), principal, branchId);
    if (note.frontmatter.kind !== kind)
        fail('Visual reference has an incompatible artifact kind');
    return note;
}
/** Add a new pin without ever replacing an authored revision. */
function pin(sources, note) {
    const prior = sources.find(source => source.artifactId === note.frontmatter.artifact_id);
    if (prior && prior.revision !== note.revision)
        fail('Stale visual source revision');
    if (!prior)
        sources.push({ artifactId: note.frontmatter.artifact_id, revision: note.revision });
    storySources(sources);
}
async function modelSources(w, projectId, branchId, data, sources, principal) {
    const model = parseStoryVisual(data.visual);
    const scene = await typedArtifact(w, projectId, data.sourceSceneId, branchId, 'scene', principal);
    if (scene.revision !== storyRevision(data.sourceSceneRevision))
        fail('Stale visual source scene revision; reread and re-annotate the scene');
    assertStoryVisualPassages(model, scene.content);
    pin(sources, scene);
    const guards = await w.dependencyGuards(scene, principal);
    const refs = new Map();
    for (const event of model.events) {
        for (const [id, kind] of [[event.actorId, 'character'], [event.targetId, 'character'], [event.locationId, 'place']]) {
            if (!id)
                continue;
            if (refs.has(id) && refs.get(id) !== kind)
                fail('Visual entity cannot be both a character and a place');
            refs.set(id, kind);
        }
    }
    for (const [id, kind] of refs) {
        const note = await typedArtifact(w, projectId, id, branchId, kind, principal);
        pin(sources, note);
        guards.push(...await w.dependencyGuards(note, principal));
    }
    return { model, scene, guards: w.mergeGuards(guards) };
}
async function readFrame(w, project, modelId, branchId, principal) {
    const note = await typedArtifact(w, project.frontmatter.project_id, modelId, branchId, 'visual_model', principal);
    const data = storyData(note.frontmatter.data);
    if (data.visualProposal !== undefined)
        fail('A visual model cannot contain proposal provenance');
    // Revalidate host-edited YAML, not just the old derived source manifest.
    const sources = storySources(note.frontmatter.artifact_sources), count = sources.length;
    const frame = await modelSources(w, project.frontmatter.project_id, branchId, data, sources, principal);
    if (sources.length !== count)
        fail('Visual model has unpinned references; rewrite it through story.artifact');
    const guards = w.mergeGuards([{ path: project.path, expectedRevision: project.revision },
        ...frame.guards, ...await w.sourceGuards(project.frontmatter.project_id, sources, principal, branchId),
        ...await w.dependencyGuards(note, principal)]);
    const recorded = w.mergeGuards(storyList(note.frontmatter.source_revisions, 'visual model source guards', 128));
    const required = guards.filter(guard => guard.path !== project.path && guard.path !== note.path);
    if (required.some(guard => !recorded.some(pin => pin.path === guard.path && pin.expectedRevision === guard.expectedRevision)))
        fail('Visual model has missing or stale recorded dependency pins; rewrite its manifest');
    return { ...frame, note, guards };
}
async function prepare(w, project, modelId, branchId, sourceRevision, value, principal) {
    const frame = await readFrame(w, project, modelId, branchId, principal);
    if (frame.note.revision !== storyRevision(sourceRevision))
        fail('Visual model revision changed; reread the model');
    const intent = parseStoryVisualIntent(value, frame.model);
    if (intent.type === 'move_entity') {
        const destination = await typedArtifact(w, project.frontmatter.project_id, intent.locationId, branchId, 'place', principal);
        frame.guards = w.mergeGuards([...frame.guards, ...await w.dependencyGuards(destination, principal)]);
    }
    const fingerprint = visualFingerprint(project, branchId, frame, intent, principal?.accountId ?? null, project.revision);
    return { ...frame, intent, fingerprint };
}
/** Historical preview identity is trace data, never current authorization. */
function visualFingerprint(project, branchId, frame, intent, actor, projectRevision) {
    const guards = frame.guards.map(guard => guard.path === project.path ? { ...guard, expectedRevision: projectRevision } : guard);
    return storyHash({ version: 1, projectId: project.frontmatter.project_id, branchId,
        modelId: frame.note.frontmatter.artifact_id, sourceRevision: frame.note.revision, intent, actor,
        guards: guards.sort((a, b) => a.path.localeCompare(b.path)) });
}
function proposalData(value) {
    const proposal = storyObject(value, ['modelId', 'modelRevision', 'intent', 'fingerprint', 'projectRevision', 'actorAccountId', 'changes'], 'visual proposal');
    storyId(proposal.modelId);
    storyRevision(proposal.modelRevision);
    storyRevision(proposal.fingerprint);
    storyRevision(proposal.projectRevision);
    storyAccount(proposal.actorAccountId);
    return proposal;
}
function checkProposalContent(prepared, data, content, fingerprint) {
    const proposal = proposalData(data.visualProposal);
    if (proposal.fingerprint !== fingerprint)
        fail('Visual proposal fingerprint changed; preview again');
    if (data.sourceSceneId !== prepared.scene.frontmatter.artifact_id || data.sourceSceneRevision !== prepared.scene.revision)
        fail('Visual proposal source scene mismatch');
    const changes = storyList(proposal.changes, 'visual proposal changes', 32).map(value => storyObject(value, ['eventId', 'start', 'end', 'before', 'after'], 'visual proposal change'));
    const applied = applyStoryVisualEdits(prepared.model, prepared.scene.content, prepared.intent, prepared.intent.type === 'reorder_events' ? undefined : changes.map(change => ({ eventId: change.eventId, content: change.after })));
    if (storyHash(applied.changes) !== storyHash(changes) || canonicalBody(applied.content) !== canonicalBody(content))
        fail('Visual proposal content or patch provenance does not match the selected passages');
    return applied;
}
/** Shared by the public artifact path and visual proposal creation. */
export async function validateVisualArtifact(w, project, branchId, kind, data, content, sources, principal) {
    if (kind === 'visual_model' || data.visual !== undefined) {
        if (kind !== 'visual_model' || data.visualProposal !== undefined)
            fail('Visual annotations require visual_model kind, without proposal provenance');
        const frame = await modelSources(w, project.frontmatter.project_id, branchId, data, sources, principal);
        data.visual = frame.model;
        return frame.guards;
    }
    if (kind !== 'alternative')
        fail('Visual proposal provenance requires alternative kind');
    const proposal = proposalData(data.visualProposal);
    if (proposal.actorAccountId !== principal.accountId || proposal.projectRevision !== project.revision)
        fail('Visual proposal creation context does not match the current actor and project');
    const prepared = await prepare(w, project, storyId(proposal.modelId), branchId, proposal.modelRevision, proposal.intent, principal);
    const applied = checkProposalContent(prepared, data, content, prepared.fingerprint);
    pin(sources, prepared.note);
    pin(sources, prepared.scene);
    // Destination and transitive sources are guarded too; their revisions become
    // the artifact's immutable input pins for subsequent review/adoption.
    data.visualProposal = { modelId: prepared.note.frontmatter.artifact_id, modelRevision: prepared.note.revision,
        intent: prepared.intent, fingerprint: prepared.fingerprint, projectRevision: project.revision, actorAccountId: principal.accountId, changes: applied.changes };
    // Project state guards authorization/preview freshness, not story meaning.
    // Persisting that pin would make adoption's own project update stale the
    // just-adopted alternative. Artifact writes separately guard this project.
    return prepared.guards.filter(guard => guard.path !== project.path);
}
/** Revalidate typed data after host edits, without impersonating its author or
 * requiring the project to remain forever at the creation-time revision. */
export async function validatePersistedVisualArtifact(w, project, artifact, principal) {
    const data = storyData(artifact.frontmatter.data), kind = artifact.frontmatter.kind, branchId = storyId(artifact.frontmatter.branch_id);
    if (kind === 'visual_model' || data.visual !== undefined) {
        if (kind !== 'visual_model')
            fail('Visual annotations require visual_model kind');
        const frame = await readFrame(w, project, artifact.frontmatter.artifact_id, branchId, principal);
        if (frame.note.revision !== artifact.revision)
            fail('Visual artifact revision changed during editorial validation');
        return frame.guards.filter(guard => guard.path !== project.path);
    }
    if (kind !== 'alternative')
        fail('Visual proposal provenance requires alternative kind');
    const proposal = proposalData(data.visualProposal);
    const prepared = await prepare(w, project, proposal.modelId, branchId, proposal.modelRevision, proposal.intent, principal);
    const historicalFingerprint = visualFingerprint(project, branchId, prepared, prepared.intent, proposal.actorAccountId, proposal.projectRevision);
    checkProposalContent(prepared, data, artifact.content, historicalFingerprint);
    const sources = storySources(artifact.frontmatter.artifact_sources);
    for (const note of [prepared.note, prepared.scene]) {
        if (!sources.some(source => source.artifactId === note.frontmatter.artifact_id && source.revision === note.revision))
            fail('Visual proposal has missing source pins');
    }
    const declared = await w.sourceGuards(project.frontmatter.project_id, sources, principal, branchId);
    const recorded = w.mergeGuards(storyList(artifact.frontmatter.source_revisions, 'visual proposal source guards', 128));
    const required = prepared.guards.filter(guard => guard.path !== project.path);
    if (required.some(guard => !recorded.some(pin => pin.path === guard.path && pin.expectedRevision === guard.expectedRevision)))
        fail('Visual proposal has missing or stale dependency pins');
    return w.mergeGuards([...required, ...declared]);
}
/** No extraction, model execution, automatic scene replacement, or Canvas writes. */
export class StoryVisual {
    w;
    constructor(w) {
        this.w = w;
    }
    async execute(params, principal) {
        const projectId = storyId(params.projectId, 'projectId'), modelId = storyId(params.modelId, 'modelId'), branchId = storyId(params.branchId ?? 'main');
        const project = await this.w.project(projectId, principal), op = params.op ?? 'read';
        if (params.field !== undefined)
            fail('Visual projections use item cursors, not field continuation');
        if (op === 'propose') {
            await this.w.authorize(project, principal);
            this.w.projectRevision(project, params.expectedProjectRevision);
            if (params.expectedRevision !== 'missing')
                fail('Visual proposals create a new alternative; expectedRevision must be missing');
            if (params.eventIds !== undefined || params.view !== undefined || params.cursor !== undefined || params.field !== undefined)
                fail('Visual proposal selection must come only from its intent');
            const prepared = await prepare(this.w, project, modelId, branchId, params.sourceRevision, params.intent, principal);
            if (params.fingerprint !== prepared.fingerprint)
                fail('Visual preview fingerprint changed; preview again');
            const applied = applyStoryVisualEdits(prepared.model, prepared.scene.content, prepared.intent, params.replacements);
            const data = { sourceSceneId: prepared.scene.frontmatter.artifact_id, sourceSceneRevision: prepared.scene.revision,
                visualProposal: { modelId, modelRevision: prepared.note.revision, intent: prepared.intent,
                    fingerprint: prepared.fingerprint, projectRevision: project.revision, actorAccountId: principal.accountId, changes: applied.changes } };
            const { StoryArtifacts } = await import('./story-artifacts.js');
            return new StoryArtifacts(this.w).execute({ op: 'create', projectId, artifactId: storyId(params.artifactId), kind: 'alternative',
                branchId, title: params.title, content: applied.content, data, expectedRevision: 'missing', expectedProjectRevision: project.revision,
                requestId: params.requestId, maxChars: params.maxChars,
                sources: [{ artifactId: modelId, revision: prepared.note.revision }, { artifactId: prepared.scene.frontmatter.artifact_id, revision: prepared.scene.revision }] }, principal);
        }
        if (!['read', 'preview'].includes(op))
            fail('Invalid visual operation');
        if (params.replacements !== undefined || params.fingerprint !== undefined || params.artifactId !== undefined || params.title !== undefined)
            fail('Visual reads do not accept proposal write fields');
        if (op === 'preview' && (params.eventIds !== undefined || params.view !== undefined))
            fail('Visual preview selection must come only from its intent');
        if (op === 'read' && params.intent !== undefined)
            fail('Use preview for a visual edit intent');
        const frame = op === 'preview'
            ? await prepare(this.w, project, modelId, branchId, params.sourceRevision, params.intent, principal)
            : await readFrame(this.w, project, modelId, branchId, principal);
        if (params.expectedRevision !== undefined && storyRevision(params.expectedRevision) !== frame.note.revision)
            fail('Visual model revision changed; reread the model');
        if (params.sourceRevision !== undefined && storyRevision(params.sourceRevision) !== frame.note.revision)
            fail('Visual model source revision changed; reread the model');
        const view = op === 'preview' ? 'intent' : params.view ?? 'timeline';
        if (!['timeline', 'interactions', 'locations', 'intent'].includes(view) || (op === 'read' && view === 'intent'))
            fail('Invalid visual view');
        const intent = op === 'preview' ? frame.intent : undefined;
        const selection = intent?.eventIds ?? (params.eventIds === undefined ? frame.model.events.map(e => e.id) : storyIds(params.eventIds, 'eventIds', 64));
        if (selection.some(id => !frame.model.events.some(event => event.id === id)))
            fail('Selected visual event unavailable');
        const events = frame.model.events.filter(event => selection.includes(event.id)).sort((a, b) => a.passage.start - b.passage.start || a.id.localeCompare(b.id));
        const ordered = [...frame.model.events].sort((a, b) => a.passage.start - b.passage.start || a.id.localeCompare(b.id));
        const items = events.map(event => {
            const before = { actorId: event.actorId, targetId: event.targetId ?? null, action: event.action, locationId: event.locationId ?? null };
            const after = { ...before, ...(intent?.type === 'move_entity' ? { locationId: intent.locationId } : intent?.type === 'set_action' ? { action: intent.action } : {}) };
            return { eventId: event.id, ...before, basis: event.basis, passage: event.passage,
                ...(view === 'timeline' ? { presentationIndex: ordered.findIndex(item => item.id === event.id) }
                    : view === 'interactions' ? { edge: { from: event.actorId, to: event.targetId ?? null, label: event.action, targetSpecified: event.targetId !== undefined } }
                        : view === 'locations' ? { placement: { entityId: event.actorId, placeId: event.locationId ?? null, known: event.locationId !== undefined } } : {}),
                ...(intent ? { before, after, ...(intent.type === 'reorder_events' ? { proposedPosition: intent.eventIds.indexOf(event.id) } : {}) } : {}) };
        });
        const sequence = project.frontmatter.sequences?.[branchId];
        const position = (key) => {
            const ids = storyIds(sequence?.[key] ?? [], key), index = ids.indexOf(frame.scene.frontmatter.artifact_id);
            return index < 0 ? null : index;
        };
        const signature = storyHash({ modelId, branchId, view, selection, actor: principal?.accountId ?? null, guards: frame.guards, ...(intent && { intent }) });
        const result = page(items, { modelId, revision: frame.note.revision, view, advisory: true, coverage: 'partial',
            sourceSceneId: frame.scene.frontmatter.artifact_id, sourceSceneRevision: frame.scene.revision,
            presentationPosition: position('presentation'), chronologyPosition: position('chronology'),
            ...(intent && { fingerprint: frame.fingerprint, semanticSuccessVerified: false }) }, signature, params, 'story-visual');
        await this.w.store.assertCurrent(frame.guards, principal);
        return result;
    }
}
