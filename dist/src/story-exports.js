import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { FrontmatterHandler } from './frontmatter.js';
import { withStoryWrite } from './story-boundary.js';
import { storyArtifactPath, storyData, storyHash, storyId, storyIds, storyList, storyObject, storyRevision, storyRoot } from './story-model.js';
import { buildStoryCanvas, exportStoryFountain, exportStoryManuscript, exportStoryStoryboard } from './story-media.js';
const OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_GUARDS = 128;
const rawHash = (content) => createHash('sha256').update(content).digest('hex');
const chooseFormat = (value) => {
    const format = value === undefined ? 'markdown' : value;
    if (!['markdown', 'fountain', 'storyboard', 'canvas'].includes(format))
        throw guidanceError(new Error('Invalid story export format'), 'guid-bfcfca478556cc04');
    return format;
};
const chooseSelection = (value) => {
    const selection = value === undefined ? 'adopted' : value;
    if (selection !== 'adopted' && selection !== 'draft')
        throw guidanceError(new Error('Invalid story export selection'), 'guid-7da1cd6cd978c2b2');
    return selection;
};
const outputPathFor = (projectId, exportId, format) => `${storyRoot(projectId)}/Exports/${exportId}.${format === 'canvas' ? 'canvas' : format === 'fountain' ? 'fountain' : 'output.md'}`;
/** Managed, revision-pinned media exports. The Markdown sidecar owns the exact
 * selection, source dependencies, raw output SHA-256 and retry state. It is not
 * generic wiki.canvas freshness metadata. No model or image generation runs.
 *
 * Writes use prepare -> output CAS -> complete. A failed phase leaves an honest
 * pending manifest. Only the same actor/request/payload may resume it, only if
 * its frozen source selection still renders the same output. Existing bytes
 * must match either the previous pinned output or this pending output hash.
 */
export class StoryExports {
    w;
    constructor(w) {
        this.w = w;
    }
    manifestBudget(fm, body, request, result, priorReceipts) {
        // Store writes add timestamps, canonical YAML and up to sixteen receipts.
        // Reserve a pinned revision on every receipt so this is an upper bound even
        // when Store materializes the previous write's revision during this write.
        const receipts = storyList(priorReceipts ?? [], 'export receipts', 16).map(value => ({ ...value, revision: '0'.repeat(64) }));
        const next = [...receipts.slice(-15), { ...request, result, state: '0'.repeat(64), revision: '0'.repeat(64) }];
        const serialized = new FrontmatterHandler().stringify({ ...fm, updated_at: new Date().toISOString(), story_receipts: next }, body);
        if (Buffer.byteLength(serialized, 'utf8') > 400000)
            throw guidanceError(new Error('Story export manifest UTF8 byte bound exceeded; narrow sources or use a new exportId'), 'guid-edd99c685600962c');
        return next;
    }
    path(projectId, raw, principal, image = false) {
        if (typeof raw !== 'string' || raw.length > 2048 || !raw.trim() || /[\0\r\n]/.test(raw))
            throw guidanceError(new Error('Story export reference unavailable'), 'guid-7cb733c47642b787');
        const external = this.w.access.resolveExternalPath(raw, principal).replace(/\\/g, '/');
        if (external.split('/').some(part => part !== '.' && part !== '..' && /[. ]$/.test(part)))
            throw guidanceError(new Error('Story export reference has ambiguous platform spelling'), 'guid-97d4a2b8838254bd');
        const path = posix.normalize(external);
        if (path === '..' || path.startsWith('../') || path.startsWith('/') || path.includes(':') || !this.w.access.canAccessPhysicalPath(path, principal)
            || !this.w.access.canReferenceFrom(`${storyRoot(projectId)}/Project.md`, path)
            || (/^Community\/Stories\//i.test(path) && !path.startsWith(`${storyRoot(projectId)}/`)))
            throw guidanceError(new Error('Story export reference unavailable in this project scope'), 'guid-2ff367592d97ff84');
        if (image && !/\.(?:png|jpe?g|webp|gif)$/i.test(path))
            throw guidanceError(new Error('Story image must be an authorized local image reference'), 'guid-e5e86772458fe6f7');
        // Resolve existing references through the public containment API. Reject
        // aliases instead of authorizing a lexical public name for private bytes.
        // Missing paths are checked by the actual bounded filesystem read/write.
        try {
            const canonical = this.w.fs.canonicalReferencePath(path);
            if (canonical.toLowerCase() !== path.toLowerCase() || !this.w.access.canAccessPhysicalPath(canonical, principal)
                || !this.w.access.canReferenceFrom(`${storyRoot(projectId)}/Project.md`, canonical))
                throw guidanceError(new Error('Story export reference alias unavailable in this scope'), 'guid-b074c86a4bfb3254');
        }
        catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
                throw error;
        }
        return path;
    }
    sequences(project, branchId) {
        const sequence = storyObject(project.frontmatter.sequences?.[branchId] ?? { presentation: [], chronology: [], shots: [] }, ['presentation', 'chronology', 'shots'], 'story sequence');
        const result = { presentation: storyIds(sequence.presentation, 'presentation'), chronology: storyIds(sequence.chronology, 'chronology'), shots: storyIds(sequence.shots ?? [], 'shots') };
        if (result.presentation.length !== result.chronology.length || result.presentation.some(id => !result.chronology.includes(id)))
            throw guidanceError(new Error('Story chronology must contain the explicit presentation scene IDs'), 'guid-62dcd036dde4c5ea');
        if (result.shots.some(id => result.presentation.includes(id)))
            throw guidanceError(new Error('Scene and shot sequence IDs must be distinct'), 'guid-af13b18a3f536082');
        return result;
    }
    addGuard(guards, path, expectedRevision, maxGuards = MAX_GUARDS - 3) {
        const old = guards.get(path);
        if (old && old.expectedRevision !== expectedRevision)
            throw guidanceError(new Error('Story export sources changed during read'), 'guid-1ffc12ac249663b7');
        guards.set(path, { path, expectedRevision });
        if (guards.size > maxGuards)
            throw guidanceError(new Error('Story export source guard bound exceeded; narrow the explicit sequence'), 'guid-ed6da384f8f234b5');
    }
    assertReferenceIdentity(projectId, branchId, note) {
        // Public visibility is not creative-branch membership. Revalidate Properties
        // from the current bytes even when a pinned dependency has become stale.
        const record = /^Community\/Stories\//i.test(note.path)
            && !/\/Exports\/[^/]+\.(?:canvas|fountain|output\.md)$/i.test(note.path);
        if (!record && !String(note.frontmatter.mcpvault_type ?? '').startsWith('story_'))
            return;
        if (note.frontmatter.project_id !== projectId)
            throw guidanceError(new Error('Story export reference belongs to a different project'), 'guid-1deb8f97deb1d8c6');
        if (note.frontmatter.mcpvault_type !== 'story_project' && note.frontmatter.branch_id !== branchId) {
            throw guidanceError(new Error('Story export reference belongs to a different branch'), 'guid-dd0c24f25f5da449');
        }
    }
    async dependencies(projectId, branchId, note, principal, guards, stale, extra = []) {
        const pins = new Map();
        const visitNote = async (current, depth) => {
            await visit(current.frontmatter.source_revisions ?? [], depth);
            const data = current.frontmatter.data ?? {};
            const structured = [current.content, ...Object.values(data).filter(value => typeof value === 'string'),
                ...(Array.isArray(data.blocks) ? data.blocks.map((block) => block?.text).filter((text) => typeof text === 'string') : [])].join('\n');
            const references = await this.w.references.validateAndNormalize(current.frontmatter.references ?? [], current.path, principal, structured);
            for (const reference of references) {
                const path = this.path(projectId, reference, principal), target = (await this.w.store.read(path, principal));
                this.assertReferenceIdentity(projectId, branchId, target);
                this.addGuard(guards, path, target.revision);
                await visit([{ path, expectedRevision: target.revision }], depth);
            }
        };
        const visit = async (items, depth) => {
            if (depth > 16)
                throw guidanceError(new Error('Story export dependency depth bound exceeded'), 'guid-5d4fcd4a659296a9');
            for (const item of storyList(items, 'source revisions', 128)) {
                const value = storyObject(item, ['path', 'expectedRevision'], 'source revision');
                const path = this.path(projectId, value.path, principal), expectedRevision = storyRevision(value.expectedRevision);
                const key = `${path}:${expectedRevision}`;
                if (pins.has(key))
                    continue;
                pins.set(key, { path, expectedRevision });
                if (pins.size > 128)
                    throw guidanceError(new Error('Story export dependency bound exceeded'), 'guid-51669242ec601abf');
                const current = await this.w.store.read(path, principal, true);
                if (current)
                    this.assertReferenceIdentity(projectId, branchId, current);
                this.addGuard(guards, path, current?.revision ?? 'missing');
                if (current?.revision !== expectedRevision)
                    stale.add('source_changed');
                else
                    await visitNote(current, depth + 1);
            }
        };
        await visit(extra, 0);
        await visitNote(note, 0);
        return [...pins.values()];
    }
    async plan(project, params, principal) {
        const projectId = storyId(project.frontmatter.project_id), format = chooseFormat(params.format), selection = chooseSelection(params.selection);
        const branchId = storyId(params.branchId === undefined ? 'main' : params.branchId, 'branchId');
        const sequences = this.sequences(project, branchId), guards = new Map(), stale = new Set();
        this.addGuard(guards, project.path, project.revision);
        const sources = [], scenes = [], shots = [], images = [];
        const wantsShots = format === 'storyboard' || format === 'canvas';
        for (const [kind, ids] of [['scene', sequences.presentation], ['shot', wantsShots ? sequences.shots : []]]) {
            for (const artifactId of ids) {
                const sourcePath = storyArtifactPath(projectId, artifactId);
                let note;
                let sourceRevision;
                if (selection === 'adopted') {
                    const selected = project.frontmatter.adopted?.[branchId]?.[artifactId];
                    if (!selected || typeof selected !== 'object' || Array.isArray(selected))
                        throw guidanceError(new Error('Every exported artifact requires an exact selected adoption'), 'guid-df71765e9cd303d3');
                    const path = this.path(projectId, selected.path, principal);
                    if (!path.startsWith(`${storyRoot(projectId)}/Adoptions/`) || !/^adopt-[a-f0-9]{32}\.md$/.test(path.split('/').at(-1)))
                        throw guidanceError(new Error('Invalid selected adoption snapshot path'), 'guid-426b945f507e46a2');
                    note = (await this.w.store.read(path, principal));
                    sourceRevision = storyRevision(selected.sourceRevision);
                    if (note.revision !== storyRevision(selected.revision) || note.frontmatter.mcpvault_type !== 'story_adoption'
                        || note.frontmatter.project_id !== projectId || note.frontmatter.artifact_id !== artifactId || note.frontmatter.branch_id !== branchId
                        || note.frontmatter.kind !== kind || selected.kind !== kind || note.frontmatter.source_revision !== sourceRevision)
                        throw guidanceError(new Error('Selected adoption snapshot revision or identity changed'), 'guid-744e209a42ff96d7');
                }
                else {
                    note = await this.w.artifact(projectId, artifactId, principal, branchId);
                    if (note.frontmatter.kind !== kind)
                        throw guidanceError(new Error('Story sequence artifact kind mismatch'), 'guid-907482adda4fc8b5');
                    sourceRevision = note.revision;
                }
                this.addGuard(guards, note.path, note.revision);
                const dependencies = await this.dependencies(projectId, branchId, note, principal, guards, stale, selection === 'adopted' ? [{ path: sourcePath, expectedRevision: sourceRevision }] : []);
                const data = storyData(note.frontmatter.data ?? {});
                sources.push({ artifactId, kind, path: note.path, revision: note.revision, sourcePath, sourceRevision, dependencies });
                if (kind === 'scene') {
                    // Shot provenance refers to the original scene revision. The external
                    // manifest below separately pins the immutable selected file revision.
                    scenes.push({ id: artifactId, path: note.path, revision: sourceRevision, title: note.frontmatter.title, content: note.content,
                        ...(data.blocks !== undefined ? { blocks: data.blocks } : {}) });
                }
                else {
                    const checkedImages = [];
                    for (const image of data.images ?? []) {
                        const path = this.path(projectId, image.path, principal, true);
                        const revision = await this.w.fs.readStoryImageRevision(path);
                        const expectedRevision = image.revision === undefined ? undefined : storyRevision(image.revision);
                        images.push({ shotId: artifactId, path, revision: revision ?? 'missing', ...(expectedRevision ? { expectedRevision } : {}) });
                        checkedImages.push({ path, missing: revision === undefined, ...(revision ? { revision } : {}) });
                        if (expectedRevision && expectedRevision !== revision)
                            stale.add('image_changed');
                    }
                    shots.push({ id: artifactId, path: note.path, revision: note.revision, sourceSceneId: data.sourceSceneId,
                        sourceSceneRevision: data.sourceSceneRevision, order: data.order ?? 0, camera: data.camera ?? '', action: data.action ?? '',
                        dialogue: data.dialogue ?? '', sound: data.sound ?? '', durationSeconds: data.durationSeconds ?? 0, images: checkedImages });
                }
            }
        }
        const input = { title: project.frontmatter.title, scenes, shots, shotIds: wantsShots ? sequences.shots : [] };
        let content;
        let diagnostics;
        let canvasManifest;
        if (format === 'canvas') {
            const rendered = buildStoryCanvas(input);
            content = `${JSON.stringify(rendered.canvas, null, 2)}\n`;
            diagnostics = rendered.diagnostics;
            canvasManifest = { ...rendered.manifest, sources: sources.map(pin => ({ id: pin.artifactId, path: pin.path, revision: pin.revision })) };
        }
        else {
            const rendered = format === 'fountain' ? exportStoryFountain(input) : format === 'storyboard' ? exportStoryStoryboard(input) : exportStoryManuscript(input);
            content = rendered.text;
            diagnostics = rendered.diagnostics;
        }
        if (diagnostics.some(diagnostic => diagnostic.code === 'stale_shot' || diagnostic.code === 'missing_scene'))
            stale.add('shot_source_changed');
        const outputHash = rawHash(content);
        const fingerprint = storyHash({ format, selection, branchId, sequences, sources, images, outputHash });
        return { format, selection, branchId, sequences, content, outputHash, fingerprint, sources, images, diagnostics,
            staleReasons: [...stale], guards: [...guards.values()], ...(canvasManifest ? { canvasManifest } : {}) };
    }
    async assertPlan(plan, projectId, principal) {
        for (const guard of plan.guards) {
            const path = this.path(projectId, guard.path, principal), current = await this.w.store.read(path, principal, true);
            if ((current?.revision ?? 'missing') !== guard.expectedRevision)
                throw guidanceError(new Error('Story export sources changed during read; refresh'), 'guid-972ac7a1fbfcc516');
        }
        for (const image of plan.images) {
            const path = this.path(projectId, image.path, principal, true);
            if ((await this.w.fs.readStoryImageRevision(path) ?? 'missing') !== image.revision)
                throw guidanceError(new Error('Story export image changed during read; refresh'), 'guid-43ad377f6a9b27d7');
        }
    }
    /** Use Workspace continuation logic while binding it to the complete observed
     * projection, then restore the real note revision in the returned envelope.
     * A changing draft/health view must invalidate cursors even if Project.md or
     * the export manifest has not itself changed.
     */
    bounded(value, params, principal) {
        const actualRevision = value.revision;
        const { expectedRevision, ...projectionParams } = params;
        if (expectedRevision !== undefined && params.op !== 'write' && storyRevision(expectedRevision) !== actualRevision) {
            throw guidanceError(new Error('Story export read revision conflict; reread the current source'), 'guid-c5656c77c3f31b68');
        }
        // Check the caller's real source revision above. The synthetic revision is
        // only a cursor fingerprint and must not be compared to a manifest pin.
        const result = this.w.detail({ ...value, revision: storyHash(value) }, projectionParams, principal);
        result.revision = actualRevision;
        if (result.omittedFields) {
            result.nextAction = { endpointId: 'story.export', arguments: { projectId: value.projectId,
                    ...(value.exportId ? { op: 'read', exportId: value.exportId } : { format: value.format, selection: value.selection, branchId: value.branchId }), field: 'sources', maxChars: 12000 } };
            if (JSON.stringify(result).length > (params.maxChars ?? 4000))
                delete result.nextAction;
        }
        if (JSON.stringify(result).length > (params.maxChars ?? 4000))
            throw guidanceError(new Error('Story export response exceeds maxChars'), 'guid-346513ff2ce57c96');
        return result;
    }
    manifest(note, projectId, exportId, principal) {
        const fm = note.frontmatter;
        if (fm.mcpvault_type !== 'story_export' || fm.project_id !== projectId || fm.export_id !== exportId || !['pending', 'complete'].includes(fm.status))
            throw guidanceError(new Error('Unmanaged story export manifest'), 'guid-f92fdb0bee9722f5');
        const format = chooseFormat(fm.format);
        chooseSelection(fm.selection);
        storyId(fm.branch_id, 'branchId');
        if (fm.output_path !== outputPathFor(projectId, exportId, format))
            throw guidanceError(new Error('Changed story export output path'), 'guid-d870602663666228');
        storyRevision(fm.output_hash);
        storyRevision(fm.output_revision, true);
        storyRevision(fm.previous_output_revision, true);
        const latest = (fm.story_receipts ?? []).at(-1);
        const { story_receipts: _receipts, ...state } = fm;
        if (!latest || latest.state !== storyHash({ state, content: note.content })
            || new FrontmatterHandler().stringify(fm, note.content) !== note.originalContent)
            throw guidanceError(new Error('Story export manifest changed outside managed writes'), 'guid-e838d67e6be7c56e');
        for (const item of storyList(fm.sources, 'export sources', 200)) {
            const pin = storyObject(item, ['artifactId', 'kind', 'path', 'revision', 'sourcePath', 'sourceRevision', 'dependencies'], 'export source');
            storyId(pin.artifactId);
            storyRevision(pin.revision);
            storyRevision(pin.sourceRevision);
            if (!['scene', 'shot'].includes(pin.kind) || pin.sourcePath !== storyArtifactPath(projectId, pin.artifactId))
                throw guidanceError(new Error('Invalid export source identity'), 'guid-893618d10f74ff0a');
            const path = this.path(projectId, pin.path, principal);
            if (fm.selection === 'draft' ? path !== pin.sourcePath : !path.startsWith(`${storyRoot(projectId)}/Adoptions/`))
                throw guidanceError(new Error('Invalid export source scope'), 'guid-010f5603b2d023db');
            for (const dependency of storyList(pin.dependencies, 'export dependencies', 128)) {
                const guard = storyObject(dependency, ['path', 'expectedRevision'], 'export dependency');
                this.path(projectId, guard.path, principal);
                storyRevision(guard.expectedRevision);
            }
        }
        for (const item of storyList(fm.images, 'export images', 1200)) {
            const image = storyObject(item, ['shotId', 'path', 'revision', 'expectedRevision'], 'export image');
            storyId(image.shotId);
            this.path(projectId, image.path, principal, true);
            storyRevision(image.revision, true);
            if (image.expectedRevision !== undefined)
                storyRevision(image.expectedRevision);
        }
    }
    async output(path, projectId, principal) {
        path = this.path(projectId, path, principal);
        const revision = await this.w.fs.readStoryOutputRevision(path, OUTPUT_BYTES);
        if (revision === undefined)
            return;
        const note = await this.w.fs.readNote(path, OUTPUT_BYTES);
        if (!note.revision || typeof note.originalContent !== 'string')
            throw guidanceError(new Error('Export output unavailable'), 'guid-6ce6645e45698939');
        if (await this.w.fs.readStoryOutputRevision(path, OUTPUT_BYTES) !== revision)
            throw guidanceError(new Error('Story export output changed during raw read'), 'guid-1ad4adf46ea17ac4');
        // Decoding FF and the valid encoding of U+FFFD produces the same string.
        // Only the raw fingerprint may authorize overwrite or healthy output.
        const invalidUtf8 = rawHash(note.originalContent) !== revision;
        return { revision, content: invalidUtf8 ? '' : note.originalContent, invalidUtf8 };
    }
    async health(project, note, principal) {
        const fm = note.frontmatter, projectId = storyId(fm.project_id), exportId = storyId(fm.export_id);
        this.manifest(note, projectId, exportId, principal);
        const output = await this.output(fm.output_path, projectId, principal);
        const stale = new Set();
        const prepared = fm.status !== 'complete';
        if (prepared)
            stale.add('incomplete_write');
        const outputChanged = output === undefined || output.invalidUtf8 || output.revision !== fm.output_hash || (!prepared && output.revision !== fm.output_revision);
        if (outputChanged)
            stale.add(output ? 'output_changed' : 'output_missing');
        if (storyHash(this.sequences(project, fm.branch_id)) !== storyHash(fm.sequences))
            stale.add('sequence_changed');
        const currentGuards = new Map();
        // Planning reserves three slots for write-phase guards; health is read-only
        // and must also admit the completed manifest in addition to every plan pin.
        this.addGuard(currentGuards, project.path, project.revision, MAX_GUARDS);
        this.addGuard(currentGuards, note.path, note.revision, MAX_GUARDS);
        for (const pin of fm.sources) {
            if (fm.selection === 'adopted') {
                const selected = project.frontmatter.adopted?.[fm.branch_id]?.[pin.artifactId];
                if (selected?.path !== pin.path || selected?.revision !== pin.revision || selected?.sourceRevision !== pin.sourceRevision)
                    stale.add('selection_changed');
            }
            for (const guard of [{ path: pin.path, expectedRevision: pin.revision }, ...pin.dependencies]) {
                const path = this.path(projectId, guard.path, principal), current = await this.w.store.read(path, principal, true);
                this.addGuard(currentGuards, path, current?.revision ?? 'missing', MAX_GUARDS);
                if (current?.revision !== guard.expectedRevision)
                    stale.add('source_changed');
            }
        }
        const currentImages = [];
        for (const image of fm.images) {
            const path = this.path(projectId, image.path, principal, true), revision = await this.w.fs.readStoryImageRevision(path) ?? 'missing';
            currentImages.push({ ...image, revision });
            if (revision !== image.revision || (image.expectedRevision && image.expectedRevision !== revision))
                stale.add('image_changed');
        }
        for (const reason of fm.render_stale_reasons ?? [])
            stale.add(String(reason));
        await this.assertPlan({ guards: [...currentGuards.values()], images: currentImages }, projectId, principal);
        const reread = await this.output(fm.output_path, projectId, principal);
        if (reread?.revision !== output?.revision)
            throw guidanceError(new Error('Story export output changed during health read'), 'guid-48df151793790076');
        return { projectId, exportId, path: note.path, revision: note.revision, format: fm.format, selection: fm.selection, branchId: fm.branch_id,
            status: fm.status, prepared, outputPath: fm.output_path, outputRevision: fm.output_revision, outputHash: fm.output_hash,
            outputChanged, stale: stale.size > 0, staleReasons: [...stale], sequences: fm.sequences, sources: fm.sources, images: fm.images,
            diagnostics: fm.diagnostics, ...(fm.canvas_manifest ? { canvasManifest: fm.canvas_manifest } : {}),
            content: !prepared && !outputChanged ? output.content : '' };
    }
    async execute(params, principal) {
        const projectId = storyId(params.projectId, 'projectId'), project = await this.w.project(projectId, principal);
        const op = params.op === undefined ? 'preview' : params.op;
        if (!['preview', 'read', 'health', 'write'].includes(op))
            throw guidanceError(new Error('Invalid story export operation'), 'guid-5a4d236c818f8345');
        // Validate output budget before a mutation can leave even a pending record.
        this.w.detail({ path: project.path, revision: project.revision, content: '' }, { maxChars: params.maxChars }, principal);
        if (op === 'preview') {
            const plan = await this.plan(project, params, principal);
            await this.assertPlan(plan, projectId, principal);
            return this.bounded({ projectId, path: project.path, revision: project.revision, kind: 'story_export_preview', format: plan.format,
                selection: plan.selection, branchId: plan.branchId, projectionRevision: plan.fingerprint, sequences: plan.sequences,
                sources: plan.sources, images: plan.images, diagnostics: plan.diagnostics, stale: plan.staleReasons.length > 0,
                staleReasons: plan.staleReasons, content: plan.content, ...(plan.canvasManifest ? { canvasManifest: plan.canvasManifest } : {}) }, params, principal);
        }
        const exportId = storyId(params.exportId, 'exportId'), path = `${storyRoot(projectId)}/Exports/${exportId}.md`;
        const prior = await this.w.store.read(path, principal, true);
        if (op === 'read' || op === 'health') {
            if (!prior)
                throw guidanceError(new Error('Story export unavailable'), 'guid-dc8ad1a547d8f573');
            const result = await this.health(project, prior, principal);
            if (op === 'health')
                result.content = '';
            return this.bounded(result, params, principal);
        }
        const workGuard = await this.w.authorize(project, principal, 'showrunner'), actor = principal;
        const request = this.w.store.request('export.write', params, actor);
        if (prior) {
            this.manifest(prior, projectId, exportId, actor);
            const retry = this.w.store.retry(prior, request);
            if (retry) {
                const view = await this.health(project, prior, actor);
                if (view.prepared || view.outputChanged || retry.outputRevision !== view.outputRevision || retry.revision !== prior.revision)
                    throw guidanceError(new Error('Export request output changed or was superseded; cannot replay success'), 'guid-1174660416781f4b');
                return this.bounded({ ...retry, stale: view.stale, content: '' }, params, actor);
            }
        }
        const pending = prior?.frontmatter.status === 'pending';
        if (pending) {
            const prepared = prior.frontmatter.prepared_request;
            if (!prepared || prepared.id !== request.id || prepared.actor !== request.actor || prepared.payload !== request.payload)
                throw guidanceError(new Error('Incomplete export requires the same requestId, actor and payload to recover'), 'guid-39c377b71502eb3d');
        }
        else {
            this.w.projectRevision(project, params.expectedProjectRevision);
            if (storyRevision(params.expectedRevision, true) !== (prior?.revision ?? 'missing'))
                throw guidanceError(new Error('Export manifest revision conflict'), 'guid-5803ac931a2f23e1');
        }
        const plan = await this.plan(project, params, actor), outputPath = outputPathFor(projectId, exportId, plan.format);
        const ownTargets = new Set([path.toLowerCase(), outputPath.toLowerCase()]);
        if (plan.guards.some(guard => ownTargets.has(guard.path.toLowerCase()))) {
            throw guidanceError(new Error('Story export cannot depend on its own manifest or output'), 'guid-ab8ca3a523b3961a');
        }
        if (prior && (prior.frontmatter.format !== plan.format || prior.frontmatter.output_path !== outputPath))
            throw guidanceError(new Error('Export format is immutable; use a new exportId'), 'guid-450c843e2da5d495');
        if (pending && prior.frontmatter.selection_fingerprint !== plan.fingerprint)
            throw guidanceError(new Error('Prepared export sources changed; preserve partial output and use a new exportId'), 'guid-dd0fc9a0a52557e5');
        const currentOutput = await this.output(outputPath, projectId, actor);
        if (currentOutput?.invalidUtf8)
            throw guidanceError(new Error('Story export output has invalid UTF8 or changed during decoding; refusing overwrite'), 'guid-4c47ca6e7e588eef');
        const oldRevision = pending ? prior.frontmatter.previous_output_revision : prior?.frontmatter.output_revision ?? 'missing';
        if (!prior && currentOutput)
            throw guidanceError(new Error('Unmanaged output already exists; choose a new exportId'), 'guid-bfc0d659adbc55db');
        if (prior && !pending && (!currentOutput || currentOutput.revision !== prior.frontmatter.output_revision || currentOutput.revision !== prior.frontmatter.output_hash))
            throw guidanceError(new Error('Managed output changed outside export; refusing overwrite'), 'guid-ca27f70da9a38a37');
        if (pending && (currentOutput?.revision ?? 'missing') !== oldRevision && currentOutput?.revision !== plan.outputHash)
            throw guidanceError(new Error('Pending output changed outside export; refusing overwrite'), 'guid-85c0dba66711e345');
        let heldOutputRevision = currentOutput?.revision ?? 'missing';
        const assertAccess = async () => {
            const fresh = await this.w.project(projectId, actor);
            if (fresh.revision !== project.revision)
                throw guidanceError(new Error('Story project changed during export write'), 'guid-22730e18f43896ef');
            await this.w.authorize(fresh, actor, 'showrunner');
            await this.assertPlan(plan, projectId, actor);
            // Called again inside filesystem dispatch after async authorization. Host
            // editors do not participate in our locks, and decoded hashes are unsafe.
            const current = await this.w.fs.readStoryOutputRevision(this.path(projectId, outputPath, actor), OUTPUT_BYTES) ?? 'missing';
            if (current !== heldOutputRevision)
                throw guidanceError(new Error('Held story export output changed during write authorization'), 'guid-1f738d45e44e8d21');
        };
        const baseResult = { projectId, exportId, path, format: plan.format, selection: plan.selection, branchId: plan.branchId,
            outputPath, outputRevision: plan.outputHash, stale: plan.staleReasons.length > 0, diagnostics: plan.diagnostics };
        // Check the result budget before dispatch too; default writes return compact
        // exact output identifiers, with full source pins available through read.
        this.bounded({ ...baseResult, revision: '0'.repeat(64), prepared: false, status: 'complete', content: '' }, params, actor);
        const fm = { mcpvault_type: 'story_export', fiction_domain: 'story', project_id: projectId, export_id: exportId,
            format: plan.format, selection: plan.selection, branch_id: plan.branchId, status: 'pending', output_path: outputPath,
            output_hash: plan.outputHash, output_revision: oldRevision, previous_output_revision: oldRevision,
            selection_fingerprint: plan.fingerprint, sequences: plan.sequences, sources: plan.sources, images: plan.images,
            source_revisions: plan.sources.flatMap(pin => [{ path: pin.path, expectedRevision: pin.revision }, ...pin.dependencies]),
            diagnostics: plan.diagnostics, render_stale_reasons: plan.staleReasons, ...(plan.canvasManifest ? { canvas_manifest: plan.canvasManifest } : {}),
            prepared_request: request, author_account_id: actor.accountId, created_at: prior?.frontmatter.created_at ?? new Date().toISOString() };
        if (JSON.stringify(fm).length > 180000)
            throw guidanceError(new Error('Export manifest bound exceeded; narrow the sequence'), 'guid-f3cd11ece760bc34');
        const body = `# Story export: ${exportId}\n\nFormat: ${plan.format}\n\nOutput: [[${outputPath}]]\n\n`
            + 'The source pins and raw output hash in Properties own this derived export. Canvas files contain file links only.\n';
        const prepareRequest = this.w.store.request('export.prepare', params, actor);
        const preparedReceipts = pending ? prior.frontmatter.story_receipts
            : this.manifestBudget(fm, body, prepareRequest, { ...baseResult, prepared: true, status: 'pending' }, prior?.frontmatter.story_receipts);
        // Both phases must fit before even the pending manifest is written. Large
        // output files use their separate 8 MiB raw read/write budget.
        this.manifestBudget({ ...fm, status: 'complete', output_revision: plan.outputHash }, body, request, { ...baseResult, prepared: false, status: 'complete' }, preparedReceipts);
        let prepared = prior;
        if (!pending) {
            const saved = await this.w.store.write(path, fm, body, params.expectedRevision, prepareRequest, { ...baseResult, prepared: true, status: 'pending' }, [...plan.guards, workGuard, { path: outputPath, expectedRevision: oldRevision }], assertAccess, prior);
            prepared = (await this.w.store.read(path, actor));
            if (prepared.revision !== saved.revision)
                throw guidanceError(new Error('Prepared export manifest changed before output write'), 'guid-76c1fd470b548777');
        }
        const outputGuards = [...plan.guards, workGuard, { path, expectedRevision: prepared.revision }];
        const uniqueGuards = [...new Map(outputGuards.map(guard => [guard.path, guard])).values()];
        if (uniqueGuards.length > MAX_GUARDS)
            throw guidanceError(new Error('Export write guard bound exceeded'), 'guid-015eda9ee13d3b4e');
        // Always perform CAS, even if output bytes already equal the desired bytes:
        // a revision captured before preparation is the required overwrite guard.
        const outputRevision = currentOutput?.revision === plan.outputHash && pending ? plan.outputHash
            : (await withStoryWrite(outputPath, () => this.w.fs.writeNoteWithRevisionGuardsAndReceipt({ path: outputPath, content: plan.content,
                expectedRevision: oldRevision }, uniqueGuards, { maxGuards: MAX_GUARDS, maxBytes: OUTPUT_BYTES, assertAccess }))).revision;
        heldOutputRevision = outputRevision;
        const verified = await this.output(outputPath, projectId, actor);
        if (verified?.invalidUtf8 || verified?.revision !== outputRevision || outputRevision !== plan.outputHash)
            throw guidanceError(new Error('Export output changed after write; manifest remains pending'), 'guid-052a95be7b103cc4');
        await assertAccess();
        const saved = await this.w.store.write(path, { ...fm, status: 'complete', output_revision: outputRevision }, body, prepared.revision, request, { ...baseResult, outputRevision, prepared: false, status: 'complete' }, [...plan.guards, workGuard, { path: outputPath, expectedRevision: outputRevision }], assertAccess, prepared);
        const completed = (await this.w.store.read(path, actor));
        if (completed.revision !== saved.revision)
            throw guidanceError(new Error('Export manifest changed after completion'), 'guid-5a753ac02bac613c');
        const view = await this.health(project, completed, actor);
        if (view.outputChanged)
            throw guidanceError(new Error('Export output changed after completion'), 'guid-70b32e9e26a0169c');
        this.w.options.changed?.(path);
        this.w.options.changed?.(outputPath);
        return this.bounded({ ...saved, stale: view.stale, content: '' }, params, actor);
    }
}
