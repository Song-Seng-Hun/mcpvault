import { guidanceError } from './guidance-runtime.js';
import type { ScopePrincipal } from './scope-auth.js';
import { page } from './work-model.js';
import { storyHash, storyId, storyIds, storyList, storyObject, storyReviewPath, storyRevision, storyRoot, storyText, type StoryGuard, type StoryNote, type StoryParams } from './story-model.js';
import type { StoryWorkspace } from './story-workspace.js';

export class StoryEditorial {
  constructor(readonly w: StoryWorkspace) {}

  private async visualGuards(project: StoryNote, artifact: StoryNote, actor: ScopePrincipal): Promise<StoryGuard[]> {
    const fm = artifact.frontmatter;
    if (fm.kind !== 'visual_model' && fm.data?.visual === undefined && fm.data?.visualProposal === undefined) return [];
    const { validatePersistedVisualArtifact } = await import('./story-visual.js');
    return validatePersistedVisualArtifact(this.w, project, artifact, actor);
  }

  async review(params: StoryParams, principal?: ScopePrincipal): Promise<StoryParams> {
    const projectId = storyId(params.projectId), project = await this.w.project(projectId, principal), op = params.op ?? 'read';
    if (op === 'list') {
      const notes = await this.w.inventory(projectId, 'Reviews', principal, { branch_id: storyId(params.branchId ?? 'main'), ...(params.artifactId && { artifact_id: storyId(params.artifactId) }), mcpvault_type: 'story_review' });
      const selected = notes.filter(n => n.frontmatter.branch_id === (params.branchId ?? 'main') && (!params.artifactId || n.frontmatter.artifact_id === params.artifactId));
      const items = await Promise.all(selected.map(async n => ({ reviewId: n.frontmatter.review_id, artifactId: n.frontmatter.artifact_id,
        path: n.path, revision: n.revision, reviewerAccountId: n.frontmatter.reviewer_account_id, ...await this.w.stale(n, principal) })));
      return page(items, { projectId, revision: project.revision }, storyHash({ revision: project.revision, items, actor: principal?.accountId }), params, 'story-reviews');
    }
    const reviewId = storyId(params.reviewId, 'reviewId'), path = storyReviewPath(projectId, reviewId);
    if (op === 'read') {
      const note = (await this.w.store.read(path, principal))!;
      if (note.frontmatter.mcpvault_type !== 'story_review' || note.frontmatter.project_id !== projectId) throw guidanceError(new Error('Story review unavailable'), 'guid-2ebd7fa705c4d5a0');
      return this.w.detail({ projectId, reviewId, path, revision: note.revision, artifactId: note.frontmatter.artifact_id,
        findings: note.frontmatter.findings, pass: note.frontmatter.editorial_pass, reviewerAccountId: note.frontmatter.reviewer_account_id,
        ...await this.w.stale(note, principal), content: note.content }, params, principal);
    }
    if (op !== 'create') throw guidanceError(new Error('Reviews are revision-pinned records; create a new review for a new source'), 'guid-bb3d21997240b051');
    const workGuard = await this.w.authorize(project, principal), actor = principal!;
    const request = this.w.store.request('review.create', params, actor), prior = await this.w.store.read(path, actor, true);
    const retry = this.w.store.retry(prior, request); if (retry) return retry;
    if (prior || params.expectedRevision !== 'missing') throw guidanceError(new Error('Story review is immutable; create a new ID with expectedRevision=missing'), 'guid-4e8d1cf2726091bd');
    this.w.projectRevision(project, params.expectedProjectRevision);
    const artifact = await this.w.artifact(projectId, storyId(params.artifactId), actor);
    if (artifact.revision !== storyRevision(params.sourceRevision)) throw guidanceError(new Error('Stale review source revision'), 'guid-3b5483e4876445a4');
    if ((await this.w.stale(artifact, actor)).stale) throw guidanceError(new Error('Artifact sources are stale; refresh before reviewing'), 'guid-aae26eddde0a336a');
    const pass = params.pass ?? 'structure';
    if (!['structure', 'line', 'continuity', 'reader'].includes(pass)) throw guidanceError(new Error('Invalid editorial pass'), 'guid-3f874c934cddf53e');
    const findings = storyList(params.findings ?? [], 'findings', 20).map(value => {
      const f = storyObject(value, ['classification', 'text'], 'finding');
      if (!['confirmed_conflict', 'possible_conflict', 'intentional_exception', 'unknown', 'suggestion'].includes(f.classification)) throw guidanceError(new Error('Invalid continuity classification'), 'guid-05617ba6f20ce3ec');
      return { classification: f.classification, text: storyText(f.text, 'finding', 2000, true) };
    });
    const content = storyText(params.content, 'review content', 12000, true);
    const refs = await this.w.referencesFor(projectId, artifact.frontmatter.branch_id, [], path, content, actor, true);
    for (const finding of findings) refs.guards.push(...(await this.w.referencesFor(projectId, artifact.frontmatter.branch_id, [], path, finding.text, actor, true)).guards);
    const guards = await this.w.dependencyGuards(artifact, actor, [...refs.guards, ...await this.visualGuards(project, artifact, actor)]);
    return this.w.store.write(path, { mcpvault_type: 'story_review', fiction_domain: 'story', project_id: projectId, review_id: reviewId,
      artifact_id: params.artifactId, branch_id: artifact.frontmatter.branch_id, source_revision: artifact.revision, source_revisions: guards,
      reviewer_account_id: actor.accountId, reviewer_agent_id: actor.agentId ?? '', independent_account: actor.accountId !== artifact.frontmatter.author_account_id,
      editorial_pass: pass, findings, advisory: true, created_at: new Date().toISOString() }, content, params.expectedRevision, request,
      { projectId, reviewId, path, artifactId: params.artifactId, advisory: true },
      [workGuard, { path: project.path, expectedRevision: project.revision }, ...guards], async () => { await this.w.authorize(project, actor); });
  }

  async adopt(params: StoryParams, principal?: ScopePrincipal): Promise<StoryParams> {
    const projectId = storyId(params.projectId), project = await this.w.project(projectId, principal);
    const workGuard = await this.w.authorize(project, principal, 'showrunner'), actor = principal!;
    const artifactId = storyId(params.artifactId), request = this.w.store.request('adopt', params, actor);
    const snapshotId = `adopt-${storyHash({ actor: actor.accountId, requestId: request.id }).slice(0, 32)}`;
    const path = `${storyRoot(projectId)}/Adoptions/${snapshotId}.md`;
    const prior = await this.w.store.read(path, actor, true), replay = this.w.store.retry(prior, request);
    if (replay) {
      const selected = Object.values(project.frontmatter.adopted ?? {}).some((branch: any) => branch?.[artifactId]?.path === path && branch[artifactId].revision === prior!.revision);
      if (selected) return { ...replay, prepared: false, adopted: true, projectRevision: project.revision };
    }
    this.w.projectRevision(project, params.expectedProjectRevision);
    if (params.expectedRevision !== 'missing') throw guidanceError(new Error('Adoption creates a new immutable snapshot; expectedRevision=missing required'), 'guid-b35421a5bc968bdc');
    const artifact = await this.w.artifact(projectId, artifactId, actor);
    if (artifact.revision !== storyRevision(params.sourceRevision)) throw guidanceError(new Error('Stale adoption source revision'), 'guid-a065e15882394e58');
    if ((await this.w.stale(artifact, actor)).stale) throw guidanceError(new Error('Stale artifact dependencies must be refreshed before adoption'), 'guid-8fff448fa0e82d60');
    if (artifact.frontmatter.kind === 'rehearsal') throw guidanceError(new Error('Rehearsal is only a proposal; create and review a scene or setting artifact before adoption'), 'guid-6b73889fd2c40978');
    const reason = storyText(params.reason, 'adoption reason', 2000, true);
    const reasonRefs = await this.w.referencesFor(projectId, artifact.frontmatter.branch_id, [], path, reason, actor, true);
    const reviewIds = storyIds(params.reviewIds ?? [], 'reviewIds', 8), extraGuards: StoryGuard[] = [...reasonRefs.guards, ...await this.visualGuards(project, artifact, actor)];
    // A prepared retry must activate the original manifest, not newly repinned references.
    if (replay) extraGuards.push(...storyList(prior!.frontmatter.source_revisions, 'prepared source revisions', 128) as StoryGuard[]);
    for (const id of reviewIds) {
      const review = (await this.w.store.read(storyReviewPath(projectId, id), actor))!;
      if (review.frontmatter.mcpvault_type !== 'story_review' || review.frontmatter.project_id !== projectId
        || review.frontmatter.artifact_id !== artifactId || review.frontmatter.source_revision !== artifact.revision || (await this.w.stale(review, actor)).stale) throw guidanceError(new Error('Stale or unrelated adoption review'), 'guid-3e579edb8098ba83');
      extraGuards.push({ path: review.path, expectedRevision: review.revision });
    }
    const sourceGuards = await this.w.dependencyGuards(artifact, actor, extraGuards);
    const guards = [workGuard, ...sourceGuards];
    const snapshot = replay ?? await this.w.store.write(path, { mcpvault_type: 'story_adoption', fiction_domain: 'story', project_id: projectId,
      artifact_id: artifactId, branch_id: artifact.frontmatter.branch_id, kind: artifact.frontmatter.kind, title: artifact.frontmatter.title,
      data: structuredClone(artifact.frontmatter.data), source_revision: artifact.revision, source_revisions: sourceGuards,
      review_ids: reviewIds, reason, adopted_by: actor.accountId, original_author: artifact.frontmatter.author_account_id,
      created_at: new Date().toISOString(), activation: 'Selected only by an exact Project.md adopted path/revision entry.' }, artifact.content,
      'missing', request, { path, projectId, artifactId, sourceRevision: artifact.revision, reviewed: reviewIds.length > 0, prepared: true },
      [...guards, { path: project.path, expectedRevision: project.revision }], async () => { await this.w.authorize(project, actor, 'showrunner'); });
    const branchId = artifact.frontmatter.branch_id;
    const branch = project.frontmatter.adopted?.[branchId] ?? {};
    if (!branch[artifactId] && Object.keys(branch).length >= 100) throw guidanceError(new Error('At most 100 selected artifacts per branch'), 'guid-73d90a42b4aec370');
    const fm = { ...project.frontmatter, adopted: { ...project.frontmatter.adopted, [branchId]: { ...branch,
      [artifactId]: { path, revision: snapshot.revision, sourceRevision: artifact.revision, kind: artifact.frontmatter.kind } } } };
    const commit = this.w.store.request('adopt.commit', params, actor);
    const selected = await this.w.store.write(project.path, fm, project.content, project.revision, commit,
      { projectId, path: project.path, adoptionPath: path }, [...guards, { path, expectedRevision: snapshot.revision }],
      async () => { await this.w.authorize(project, actor, 'showrunner'); }, project);
    return { ...snapshot, prepared: false, adopted: true, projectRevision: selected.revision };
  }
}
