import { guidanceError } from './guidance-runtime.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { GitTaskHistory } from './git-history.js';
import { FrontmatterHandler } from './frontmatter.js';
import { isModerationHidden } from './moderation-policy.js';
import { storyHash, storyId, type StoryGuard, type StoryNote, type StoryParams } from './story-model.js';
import type { StoryWorkspace } from './story-workspace.js';

interface Edge { from: string; to: string; fromGeneration: number; toGeneration: number; proposalRevision: string | null }
export interface WorkBinding { revision: string; generation: number; assigneeAccountId: string | null }
export interface ReconnectProof {
  task: StoryNote; workProject: StoryGuard; chain: Edge[]; fingerprint: string;
  gitBasis: { head: string; observations: string } | null;
}
const account = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(v);
const revision = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const generation = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const message = 'Accepted Work handoff continuity could not be proven; preserve this session and create a new session';
class MissingContinuity extends Error {}
function reject(missing = false): never { throw missing ? new MissingContinuity(message) : new Error(message); }

export function storyWorkBinding(task: StoryNote): WorkBinding {
  if (!generation(task.frontmatter.claim_generation) || !revision(task.revision)) reject();
  const assignee = task.frontmatter.assignee_account_id;
  if (assignee !== undefined && !account(assignee)) reject();
  return { revision: task.revision, generation: task.frontmatter.claim_generation, assigneeAccountId: assignee ?? null };
}

function taskIdentity(fm: StoryParams, session: StoryNote, project: StoryNote): void {
  if (fm.mcpvault_type !== 'agent_task' || fm.task_id !== session.frontmatter.task_id
    || fm.project_id !== project.frontmatter.work_project_id || !generation(fm.claim_generation) || isModerationHidden(fm)) reject();
}

/** Bounded Markdown evidence, never a second ownership ledger. */
function continuity(session: StoryNote, current: StoryNote, project: StoryNote, history?: GitTaskHistory): Edge[] {
  const edges = new Map<number, Edge>(), claims = new Map<number, string>(), releases = new Set<number>();
  let initialClaim = false;
  const add = (edge: Edge) => {
    if (!account(edge.from) || !account(edge.to) || edge.from === edge.to || !generation(edge.fromGeneration)
      || edge.fromGeneration < 1 || !generation(edge.toGeneration) || edge.toGeneration !== edge.fromGeneration + 1
      || edge.proposalRevision !== null && !revision(edge.proposalRevision)) reject();
    const old = edges.get(edge.fromGeneration);
    if (old && (old.from !== edge.from || old.to !== edge.to || old.toGeneration !== edge.toGeneration
      || old.proposalRevision && edge.proposalRevision && old.proposalRevision !== edge.proposalRevision)) reject();
    if (!old || !old.proposalRevision) edges.set(edge.fromGeneration, edge);
  };
  const claim = (g: number, actor: string) => {
    if (!generation(g) || g < 1 || !account(actor) || claims.has(g) && claims.get(g) !== actor) reject();
    claims.set(g, actor); if (g === 1) initialClaim = true;
  };
  const eventEdge = (event: StoryParams): Edge | undefined => {
    if (event.action !== 'handoff.accept') return;
    const keys = ['fromAccountId', 'toAccountId', 'fromGeneration', 'toGeneration', 'proposalRevision', 'acceptorAccountId'];
    if (keys.every(key => event[key] === undefined)) return; // legacy: only an actual accepted state can supply this edge
    if (keys.some(key => event[key] === undefined) || event.actor !== event.toAccountId || event.acceptorAccountId !== event.toAccountId
      || event.generation !== event.toGeneration || !revision(event.proposalRevision)) reject();
    return { from: event.fromAccountId, to: event.toAccountId, fromGeneration: event.fromGeneration,
      toGeneration: event.toGeneration, proposalRevision: event.proposalRevision };
  };
  const acceptedState = (fm: StoryParams): Edge | undefined => {
    const h = fm.work_handoff;
    if (h?.state !== 'accepted') return;
    if (h.to_account_id !== fm.assignee_account_id || h.generation + 1 !== fm.claim_generation) reject();
    return { from: h.from_account_id, to: h.to_account_id, fromGeneration: h.generation,
      toGeneration: fm.claim_generation, proposalRevision: null };
  };
  const events = current.frontmatter.work_changes;
  if (!Array.isArray(events) || events.length > 16) reject();
  for (const event of events) {
    if (!event || !generation(event.generation)) reject();
    if (['claim.claim', 'claim.start'].includes(event.action)) claim(event.generation, event.actor);
    if (event.action === 'claim.release') releases.add(event.generation);
    const edge = eventEdge(event); if (edge) add(edge);
  }
  const currentEdge = acceptedState(current.frontmatter); if (currentEdge) add(currentEdge);
  if (history) {
    const states = history.observations.map(item => new FrontmatterHandler().parse(item.content).frontmatter).reverse();
    const latest = states.at(-1);
    if (!latest || current.frontmatter.claim_generation < latest.claim_generation
      || current.frontmatter.claim_generation === latest.claim_generation && current.frontmatter.assignee_account_id !== latest.assignee_account_id) reject();
    for (let index = 0; index < states.length; index++) {
      const fm = states[index]!, before = states[index - 1]; taskIdentity(fm, session, project);
      if (before && (fm.claim_generation < before.claim_generation
        || fm.claim_generation === before.claim_generation && fm.assignee_account_id !== before.assignee_account_id)) reject();
      const last = Array.isArray(fm.work_changes) ? fm.work_changes.at(-1) : undefined;
      if (last?.action === 'claim.release' && last.generation === fm.claim_generation && !fm.assignee_account_id) releases.add(last.generation);
      if (fm.claim_generation === 1 && account(fm.assignee_account_id) && last?.actor === fm.assignee_account_id
        && last.generation === 1 && ['claim.claim', 'claim.start'].includes(last.action)
        && (!before || before.claim_generation === 0 && !before.assignee_account_id)) claim(1, fm.assignee_account_id);
      // Only adjacent historical states that actually change assignment prove
      // an acceptance. A copied receipt/event in a later snapshot proves none.
      const edge = acceptedState(fm);
      if (edge && last?.action === 'handoff.accept' && last.actor === edge.to && last.generation === edge.toGeneration
        && before?.claim_generation === edge.fromGeneration && before.assignee_account_id === edge.from) {
        const recorded = eventEdge(last);
        if (recorded && (recorded.from !== edge.from || recorded.to !== edge.to || recorded.fromGeneration !== edge.fromGeneration)) reject();
        add(recorded ?? edge);
      }
    }
  }
  const target = current.frontmatter;
  let start: number;
  const binding = session.frontmatter.work_binding;
  if (binding !== undefined) {
    if (!binding || !revision(binding.revision) || !generation(binding.generation)) reject();
    if (binding.assigneeAccountId === null) {
      if (binding.generation !== 0) reject();
      start = 1;
      if ([...releases].some(g => g > start && g <= target.claim_generation)) reject();
      if (claims.get(start) !== session.frontmatter.writer_account_id) reject(!claims.has(start));
    } else {
      if (binding.assigneeAccountId !== session.frontmatter.writer_account_id || !account(binding.assigneeAccountId) || binding.generation < 1) reject();
      start = binding.generation;
    }
  } else {
    // One retained matching writer is not unique when earlier events expired.
    const origins = [...edges.values()].filter(edge => edge.from === session.frontmatter.writer_account_id);
    if (origins.length > 1) reject();
    if ([...releases].some(g => g > 1 && g <= target.claim_generation)) reject();
    if (!initialClaim) reject(true);
    let previous = claims.get(1)!;
    for (let g = 1; g < target.claim_generation; g++) {
      const edge = edges.get(g); if (!edge) reject(true);
      if (edge.from !== previous) reject();
      previous = edge.to;
    }
    if (origins.length !== 1) reject(true);
    start = origins[0]!.fromGeneration;
  }
  if ([...releases].some(g => g > start && g <= target.claim_generation)) reject();
  if (start >= target.claim_generation) reject();
  const chain: Edge[] = []; let writer = session.frontmatter.writer_account_id;
  if (target.claim_generation - start > 48) reject(true);
  for (let g = start; g < target.claim_generation; g++) {
    if (releases.has(g + 1)) reject();
    const edge = edges.get(g); if (!edge) reject(true);
    if (edge.from !== writer || claims.has(g + 1) && claims.get(g + 1) !== edge.to) reject();
    chain.push(edge); writer = edge.to;
  }
  if (!chain.length || writer !== target.assignee_account_id) reject();
  return chain;
}

const gitBasis = (history: GitTaskHistory) => ({ head: history.head,
  observations: storyHash(history.observations.map(({ commit, blob }) => ({ commit, blob }))) });

async function readHistory(w: StoryWorkspace, task: StoryNote, actor: ScopePrincipal): Promise<GitTaskHistory> {
  if (!w.options.gitHistory) reject(true);
  try { return await w.options.gitHistory.taskHandoffHistory(task.path, path => w.access.canAccessPhysicalPath(path, actor)); }
  catch { return reject(true); }
}

/** Same fresh proof for read-only preview and the locked mutation precondition. */
export async function proveStoryReconnect(w: StoryWorkspace, project: StoryNote, session: StoryNote, actor: ScopePrincipal,
  includeGitHistory: boolean): Promise<ReconnectProof> {
  const workProject = await w.authorize(project, actor, 'showrunner', false, true);
  const observed = (await w.store.read(session.path, actor))!;
  if (observed.revision !== session.revision) throw guidanceError(new Error('Story reconnect proof changed'), 'guid-49eb369239e78557');
  if (session.frontmatter.stage !== 'waiting') throw guidanceError(new Error('Writer reconnection requires a waiting session'), 'guid-64b1afaceec8fbf9');
  const task = (await w.store.read(`Community/Tasks/${storyId(session.frontmatter.task_id)}.md`, actor))!;
  taskIdentity(task.frontmatter, session, project);
  if (['completed', 'cancelled'].includes(task.frontmatter.status) || !account(task.frontmatter.assignee_account_id)) reject();
  let chain: Edge[], history: GitTaskHistory | undefined;
  try { chain = continuity(session, task, project); }
  catch (error) {
    if (!(error instanceof MissingContinuity) || !includeGitHistory) throw error;
    history = await readHistory(w, task, actor);
    chain = continuity(session, task, project, history);
  }
  for (const id of [task.frontmatter.assignee_account_id, session.frontmatter.editor_account_id]) {
    if (!project.frontmatter.participants.includes(id)) throw guidanceError(new Error('Session participant membership revoked'), 'guid-dae86a41f09b2303');
    await w.work.authorizeWorkshopProject(actor, project.frontmatter.work_project_id, false, id, project.frontmatter.owner_account_id);
  }
  const basis = history ? gitBasis(history) : null;
  const fingerprint = storyHash({ session: session.revision, project: project.revision, workProject,
    task: { path: task.path, revision: task.revision, generation: task.frontmatter.claim_generation },
    actor: actor.accountId, writer: session.frontmatter.writer_account_id, chain, git: basis, includeGitHistory });
  await w.authorize(project, actor, 'showrunner', false, true);
  await w.store.assertCurrent([{ path: session.path, expectedRevision: session.revision }, { path: project.path, expectedRevision: project.revision },
    workProject, { path: task.path, expectedRevision: task.revision }], actor);
  return { task, workProject, chain, fingerprint, gitBasis: basis };
}

/** A retry proves the persisted post-binding, not the old pre-resume chain. */
export async function verifyStoryReconnectReplay(w: StoryWorkspace, project: StoryNote, session: StoryNote, actor: ScopePrincipal, params: StoryParams): Promise<void> {
  const record = session.frontmatter.work_reconnect, binding = session.frontmatter.work_binding;
  if (!record || record.requestId !== params.requestId || record.actor !== actor.accountId || record.taskId !== session.frontmatter.task_id
    || record.workProjectId !== project.frontmatter.work_project_id || record.projectRevision !== project.revision
    || storyHash(record.after) !== storyHash(binding) || record.after.assigneeAccountId !== session.frontmatter.writer_account_id
    || record.after.revision !== params.expectedWorkRevision || record.after.generation !== params.expectedWorkGeneration
    || params.reconnectProofFingerprint !== undefined && params.reconnectProofFingerprint !== record.fingerprint) throw guidanceError(new Error('Story reconnect replay binding changed'), 'guid-b270f1ad483d3a6f');
  const workProject = await w.authorize(project, actor, 'showrunner');
  const task = (await w.store.read(`Community/Tasks/${storyId(record.taskId)}.md`, actor))!;
  taskIdentity(task.frontmatter, session, project);
  if (storyHash(storyWorkBinding(task)) !== storyHash(binding) || ['completed', 'cancelled'].includes(task.frontmatter.status)) throw guidanceError(new Error('Work binding changed after Story reconnect'), 'guid-2be8eb4cd4eee42a');
  for (const id of [session.frontmatter.writer_account_id, session.frontmatter.editor_account_id]) {
    if (!project.frontmatter.participants.includes(id)) throw guidanceError(new Error('Session participant membership revoked'), 'guid-dae86a41f09b2303');
    await w.work.authorizeWorkshopProject(actor, project.frontmatter.work_project_id, false, id, project.frontmatter.owner_account_id);
  }
  if (record.gitBasis && storyHash(gitBasis(await readHistory(w, task, actor))) !== storyHash(record.gitBasis)) throw guidanceError(new Error('Git reconnect proof changed'), 'guid-83c6f30f94649787');
  await w.authorize(project, actor, 'showrunner');
  await w.store.assertCurrent([{ path: session.path, expectedRevision: session.revision }, { path: project.path, expectedRevision: project.revision },
    workProject, { path: task.path, expectedRevision: task.revision }], actor);
}
