import { guidanceError, guidanceText } from './guidance-runtime.js';
import { page } from './work-model.js';
import { runStoryBranch } from './story-branch.js';
import { storyAccount, storyHash, storyId, storyReviewPath, storyRevision, storyRoot, storyText } from './story-model.js';
/** Durable host-driven coordination. Roles never instantiate or impersonate agents. */
export class StorySessions {
    w;
    constructor(w) {
        this.w = w;
    }
    view(note) {
        const f = note.frontmatter;
        return { path: note.path, revision: note.revision, projectId: f.project_id, sessionId: f.session_id,
            artifactId: f.artifact_id, taskId: f.task_id, stage: f.stage, revisionRound: f.revision_round,
            steps: f.steps, waitingFor: f.waiting_for, writerAccountId: f.writer_account_id,
            editorAccountId: f.editor_account_id, sourceRevision: f.source_revision, result: f.result,
            hostExecutionOnly: true, workStatusIndependent: true, content: note.content,
            nextAction: f.task_id ? { endpointId: 'work.packet', arguments: { taskId: f.task_id } } : undefined };
    }
    async execute(params, principal) {
        const projectId = storyId(params.projectId), project = await this.w.project(projectId, principal), op = params.op ?? 'read';
        if (op === 'list') {
            const notes = await this.w.inventory(projectId, 'Sessions', principal);
            const items = notes.filter(n => n.frontmatter.mcpvault_type === 'story_session').map(n => this.view(n));
            return page(items, { projectId, revision: project.revision }, storyHash({ items, actor: principal?.accountId }), params, 'story-sessions');
        }
        const sessionId = storyId(params.sessionId, 'sessionId');
        const path = `${storyRoot(projectId)}/${op === 'rehearse' ? 'Rehearsals' : 'Sessions'}/${sessionId}.md`;
        const prior = await this.w.store.read(path, principal, true);
        if (op === 'read') {
            if (!prior || prior.frontmatter.mcpvault_type !== 'story_session' || prior.frontmatter.project_id !== projectId)
                throw guidanceError(new Error('Story session unavailable'), 'guid-e8860ba50d173e0b');
            return this.w.detail({ ...this.view(prior), ...await this.w.stale(prior, principal) }, params, principal);
        }
        if (!['start', 'submit', 'review', 'pause', 'resume', 'decide', 'rehearse'].includes(op))
            throw guidanceError(new Error('Invalid story session operation'), 'guid-483aa010b6cf04dc');
        const workGuard = await this.w.authorize(project, principal, ['start', 'decide'].includes(op) ? 'showrunner' : 'member', op === 'pause');
        const actor = principal, request = this.w.store.request(`session.${op}`, params, actor);
        const retry = this.w.store.retry(prior, request);
        if (retry)
            return retry;
        this.w.projectRevision(project, params.expectedProjectRevision);
        const guards = [workGuard, { path: project.path, expectedRevision: project.revision }];
        if (op === 'rehearse') {
            if (prior || params.expectedRevision !== 'missing')
                throw guidanceError(new Error('Rehearsal records are immutable; choose a new sessionId'), 'guid-17b1afb7ff65e8cc');
            const artifact = await this.w.artifact(projectId, storyId(params.artifactId), actor);
            if (artifact.frontmatter.kind !== 'branch_graph' || artifact.revision !== storyRevision(params.sourceRevision))
                throw guidanceError(new Error('Rehearsal requires a current branch graph revision'), 'guid-9ae6a064af0e96ae');
            if ((await this.w.stale(artifact, actor)).stale)
                throw guidanceError(new Error('Rehearsal dependencies are stale'), 'guid-724acf3b7419fddb');
            const maxSteps = params.maxSteps ?? project.frontmatter.max_steps;
            if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > project.frontmatter.max_steps)
                throw guidanceError(new Error('Rehearsal maxSteps exceeds the explicit project budget'), 'guid-dde1371232bfbf0b');
            const result = runStoryBranch({ graph: { ...artifact.frontmatter.data.graph, revision: artifact.revision },
                expectedRevision: artifact.revision, choiceIds: params.choiceIds ?? [], initialState: params.initialState ?? {}, maxSteps });
            const sources = [{ path: artifact.path, expectedRevision: artifact.revision }, ...(artifact.frontmatter.source_revisions ?? [])];
            return this.w.store.write(path, { mcpvault_type: 'story_rehearsal', fiction_domain: 'story', project_id: projectId,
                session_id: sessionId, artifact_id: params.artifactId, branch_id: artifact.frontmatter.branch_id,
                source_revision: artifact.revision, source_revisions: sources, result, proposal_only: true, actor_account_id: actor.accountId }, '# Fiction rehearsal\n\nA pinned branch trace; not a canonical adoption or a shared-world mutation.\n', 'missing', request, { path, projectId, sessionId, result, proposalOnly: true, hostExecutionOnly: true }, [...guards, ...sources], async () => { await this.w.authorize(project, actor); });
        }
        let fm;
        if (op === 'start') {
            if (prior || params.expectedRevision !== 'missing')
                throw guidanceError(new Error('New story session requires expectedRevision=missing'), 'guid-18b5af8b138f047a');
            const artifact = await this.w.artifact(projectId, storyId(params.artifactId), actor);
            const writer = storyAccount(params.writerAccountId), editor = storyAccount(params.editorAccountId);
            const accounts = await this.w.auth.listPrincipals();
            for (const id of [writer, editor]) {
                if (!project.frontmatter.participants.includes(id) || !accounts.some(p => p.accountId === id))
                    throw guidanceError(new Error('Session roles require real registered project participants'), 'guid-9f64c1b62ce9a67b');
                await this.w.work.authorizeWorkshopProject(actor, project.frontmatter.work_project_id, false, id, project.frontmatter.owner_account_id);
            }
            if ((await this.w.stale(artifact, actor)).stale)
                throw guidanceError(new Error('Refresh stale artifact dependencies before starting a session'), 'guid-25ea87cf327fcefb');
            const taskId = `story-${storyHash({ projectId, sessionId }).slice(0, 32)}`;
            let task = await this.w.store.read(`Community/Tasks/${taskId}.md`, actor, true);
            if (!task) {
                await this.w.tasks.create({ principal: actor, taskId, projectId: project.frontmatter.work_project_id,
                    title: `Draft: ${artifact.frontmatter.title}`.slice(0, 180), description: guidanceText('guid-d9de25f147d04b12', `Prepare and revise [[${artifact.path}]] for story session ${sessionId}. Intended writer account: ${writer}. The actual writer claims it; no other account accepts on its behalf.`),
                    references: [artifact.path],
                    completionCriteria: ['Revision-pinned scene submitted, reviewed and explicitly selected or rejected.'],
                    expectedRevision: 'missing', requestId: `story-${storyHash({ projectId, sessionId, actor: actor.accountId }).slice(0, 32)}` });
                task = (await this.w.store.read(`Community/Tasks/${taskId}.md`, actor));
            }
            if (task.frontmatter.project_id !== project.frontmatter.work_project_id || task.frontmatter.requester_account_id !== actor.accountId
                || (task.frontmatter.assignee_account_id && task.frontmatter.assignee_account_id !== writer)
                || !task.frontmatter.references?.includes(artifact.path))
                throw guidanceError(new Error('Existing Work task does not match the requested story session'), 'guid-3f4a96f70573f427');
            guards.push({ path: task.path, expectedRevision: task.revision }, { path: artifact.path, expectedRevision: artifact.revision });
            fm = { mcpvault_type: 'story_session', fiction_domain: 'story', project_id: projectId, session_id: sessionId,
                artifact_id: params.artifactId, branch_id: artifact.frontmatter.branch_id, writer_account_id: writer,
                editor_account_id: editor, task_id: taskId, stage: 'draft', revision_round: 0, steps: 1, source_revisions: [], created_at: new Date().toISOString() };
        }
        else {
            if (!prior || prior.frontmatter.mcpvault_type !== 'story_session' || prior.frontmatter.project_id !== projectId)
                throw guidanceError(new Error('Story session unavailable'), 'guid-e8860ba50d173e0b');
            if (storyRevision(params.expectedRevision) !== prior.revision)
                throw guidanceError(new Error('Story session revision conflict'), 'guid-41bf004618654280');
            fm = structuredClone(prior.frontmatter);
            if (['completed', 'rejected'].includes(fm.stage))
                throw guidanceError(new Error('Story session has reached a terminal stage'), 'guid-99a80d4068929f01');
            if (![fm.writer_account_id, fm.editor_account_id, project.frontmatter.showrunner_account_id].includes(actor.accountId))
                throw guidanceError(new Error('Current session role required'), 'guid-1d0fc343cfe0f803');
            const reason = params.reason === undefined ? '' : storyText(params.reason, 'session reason', 2000, true);
            if (reason)
                guards.push(...(await this.w.referencesFor(projectId, fm.branch_id, [], path, reason, actor, true)).guards);
            if (op === 'pause') {
                if (!reason)
                    throw guidanceError(new Error('A waiting reason is required'), 'guid-c25843a52b0cd332');
                if (fm.stage !== 'waiting')
                    fm.resume_stage = fm.stage;
                fm.stage = 'waiting';
                fm.waiting_for = reason;
            }
            else {
                if (fm.steps >= project.frontmatter.max_steps) {
                    if (fm.stage !== 'waiting')
                        fm.resume_stage = fm.stage;
                    fm.stage = 'waiting';
                    fm.waiting_for = 'Project step budget exhausted; owner must raise the explicit project budget before resume.';
                }
                else {
                    for (const account of [fm.writer_account_id, fm.editor_account_id]) {
                        if (!project.frontmatter.participants.includes(account))
                            throw guidanceError(new Error('Session participant membership revoked; pause and request owner direction'), 'guid-5c11f7cf1eff4a01');
                        await this.w.work.authorizeWorkshopProject(actor, project.frontmatter.work_project_id, false, account, project.frontmatter.owner_account_id);
                    }
                    let task = (await this.w.store.read(`Community/Tasks/${storyId(fm.task_id)}.md`, actor));
                    if (task.frontmatter.project_id !== project.frontmatter.work_project_id || (task.frontmatter.assignee_account_id && task.frontmatter.assignee_account_id !== fm.writer_account_id)
                        || ['cancelled', 'completed'].includes(task.frontmatter.status))
                        throw guidanceError(new Error('Work assignment changed or closed; pause the story session'), 'guid-80a816c8e1722a90');
                    const artifact = await this.w.artifact(projectId, fm.artifact_id, actor, fm.branch_id);
                    guards.push({ path: artifact.path, expectedRevision: artifact.revision }, ...(artifact.frontmatter.source_revisions ?? []));
                    if ((await this.w.stale(artifact, actor)).stale)
                        throw guidanceError(new Error('Session context is stale; refresh dependencies before continuing'), 'guid-a23077c2ed6264b9');
                    if (op === 'resume') {
                        if (fm.stage !== 'waiting')
                            throw guidanceError(new Error('Resume requires the waiting stage'), 'guid-e13672cb1d5841d1');
                        if (['review', 'decision'].includes(fm.resume_stage) && fm.source_revision !== artifact.revision)
                            throw guidanceError(new Error('Paused session source revision changed; owner must create a new session'), 'guid-fed85d3656d09e7d');
                        fm.stage = fm.resume_stage;
                        delete fm.resume_stage;
                        delete fm.waiting_for;
                    }
                    else if (op === 'submit') {
                        if (actor.accountId !== fm.writer_account_id || !['draft', 'revise'].includes(fm.stage))
                            throw guidanceError(new Error('Only assigned writer may submit during draft/revise stage'), 'guid-11d7ee007bf83ea7');
                        if (storyRevision(params.sourceRevision) !== artifact.revision)
                            throw guidanceError(new Error('Submitted source revision is stale'), 'guid-7b5018255abb6b7f');
                        if (!task.frontmatter.assignee_account_id) {
                            // This authenticated submission is the actual writer's acceptance,
                            // never an impersonated claim made by the showrunner at start.
                            await this.w.work.claim({ principal: actor, op: 'claim', taskId: fm.task_id, expectedRevision: task.revision,
                                expectedGeneration: task.frontmatter.claim_generation, requestId: `claim-${storyHash({ sessionId, actor: actor.accountId, request: request.id }).slice(0, 32)}` });
                            task = (await this.w.store.read(task.path, actor));
                        }
                        fm.source_revision = artifact.revision;
                        fm.source_revisions = [{ path: artifact.path, expectedRevision: artifact.revision }, ...(artifact.frontmatter.source_revisions ?? [])];
                        fm.stage = 'review';
                    }
                    else if (op === 'review') {
                        if (actor.accountId !== fm.editor_account_id || fm.stage !== 'review')
                            throw guidanceError(new Error('Only assigned editor may review during review stage'), 'guid-47021259b7e8dbd8');
                        if (storyRevision(params.sourceRevision) !== artifact.revision || fm.source_revision !== artifact.revision)
                            throw guidanceError(new Error('Review source revision changed'), 'guid-3cbce561d34fd065');
                        const reviewId = storyId(params.reviewId), review = (await this.w.store.read(storyReviewPath(projectId, reviewId), actor));
                        if (review.frontmatter.mcpvault_type !== 'story_review' || review.frontmatter.project_id !== projectId || review.frontmatter.artifact_id !== fm.artifact_id
                            || review.frontmatter.source_revision !== artifact.revision || review.frontmatter.reviewer_account_id !== actor.accountId || (await this.w.stale(review, actor)).stale)
                            throw guidanceError(new Error('Session review must match current source and assigned editor'), 'guid-81a64ba219bfd612');
                        if (!['changes_requested', 'ready'].includes(params.decision))
                            throw guidanceError(new Error('Review decision requires changes_requested or ready'), 'guid-15b6ac4ba1411d83');
                        guards.push({ path: review.path, expectedRevision: review.revision });
                        fm.review_id = reviewId;
                        if (params.decision === 'changes_requested' && fm.revision_round < 2) {
                            fm.revision_round++;
                            fm.stage = 'revise';
                        }
                        else
                            fm.stage = 'decision';
                    }
                    else if (op === 'decide') {
                        if (fm.stage !== 'decision')
                            throw guidanceError(new Error('Final selection requires decision stage'), 'guid-3d5a2c0b90bcb4aa');
                        if (!['adopt', 'reject', 'hold', 'adjust_scope'].includes(params.decision) || !reason)
                            throw guidanceError(new Error('Explicit adopt/reject/hold/adjust_scope decision and reason required'), 'guid-7762bc4c4040a964');
                        if (storyRevision(params.sourceRevision) !== artifact.revision || fm.source_revision !== artifact.revision)
                            throw guidanceError(new Error('Decision source revision changed'), 'guid-6384f0cc8f0ae872');
                        if (params.decision === 'adopt') {
                            const selected = project.frontmatter.adopted?.[fm.branch_id]?.[fm.artifact_id];
                            if (!selected || selected.sourceRevision !== artifact.revision)
                                throw guidanceError(new Error('Use story.adopt to select the exact snapshot before completing the session'), 'guid-2dffd8189b3411cd');
                            const snapshot = (await this.w.store.read(selected.path, actor));
                            if (snapshot.revision !== selected.revision || snapshot.frontmatter.mcpvault_type !== 'story_adoption' || snapshot.frontmatter.project_id !== projectId
                                || snapshot.frontmatter.artifact_id !== fm.artifact_id || snapshot.frontmatter.source_revision !== artifact.revision)
                                throw guidanceError(new Error('Selected adoption snapshot changed'), 'guid-88d1842edfa6d960');
                            guards.push({ path: snapshot.path, expectedRevision: snapshot.revision });
                        }
                        if (['hold', 'adjust_scope'].includes(params.decision)) {
                            fm.stage = 'waiting';
                            fm.resume_stage = 'decision';
                            fm.waiting_for = reason;
                        }
                        else
                            fm.stage = params.decision === 'adopt' ? 'completed' : 'rejected';
                        fm.decision_reason = reason;
                    }
                    guards.push({ path: task.path, expectedRevision: task.revision });
                    fm.steps++;
                }
            }
        }
        const content = `# Story session ${sessionId}\n\nStage: ${fm.stage}\n\n[[Community/Tasks/${fm.task_id}|Assigned Work task]]\n\n${fm.waiting_for ?? fm.decision_reason ?? 'Host-driven drafting and editorial coordination; Work task lifecycle remains explicit.'}\n`;
        const result = this.view({ path, revision: '', frontmatter: fm, content });
        delete result.revision;
        return this.w.store.write(path, fm, content, params.expectedRevision, request, result, guards, async () => { await this.w.authorize(project, actor, ['start', 'decide'].includes(op) ? 'showrunner' : 'member', op === 'pause'); }, prior);
    }
}
