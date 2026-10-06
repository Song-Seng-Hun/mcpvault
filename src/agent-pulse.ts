import { guidanceError, guidanceText } from './guidance-runtime.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { AgentTaskService } from './agent-tasks.js';
import type { ContinuityService } from './continuity.js';
import { endpointIdForTool } from './endpoint-registry.js';
import type { LlmWikiService } from './llm-wiki.js';
import type { WorkService } from './work-service.js';

const identity = (principal: ScopePrincipal) => principal.agentId || principal.modelId;
const MAINTENANCE_PACKET_MAX_CHARS = 4_000;
const MAINTENANCE_CACHE_TTL_MS = 30_000;
const MAINTENANCE_CACHE_MAX_ENTRIES = 256;
const MAINTENANCE_ACTION_MAX_ARGUMENTS = 8;
const MAINTENANCE_EXECUTABLE_STRING_MAX_CHARS = 1_024;

function positiveLimit(value: unknown, fallback: number, maximum: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw guidanceError(new Error('limit must be a positive integer'), 'guid-14abe8b02cfc3624');
  return Math.min(parsed, maximum);
}

interface CompactMaintenanceAction {
  endpointId: string;
  arguments?: Record<string, unknown>;
}

interface CompactMaintenanceFollowUpAction extends CompactMaintenanceAction {
  requiredArguments?: string[];
  instruction?: string;
}

interface CompactIdleWikiPlan {
  planType: 'maintenance' | 'synthesis';
  selected: { path: string; revision: string; reason?: string };
  inspect: CompactMaintenanceAction;
  followUpPlan?: CompactMaintenanceFollowUpAction;
  routing?: {
    mode: 'stateless_rendezvous';
    candidateBand: number;
    exclusive: false;
  };
}

type CompactMaintenanceArgumentsResult =
  | { valid: true; arguments?: Record<string, unknown> }
  | { valid: false };

function compactMaintenanceArguments(input: unknown): CompactMaintenanceArgumentsResult {
  if (input === undefined) return { valid: true };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false };
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAINTENANCE_ACTION_MAX_ARGUMENTS) return { valid: false };
  const compact: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (key.length > 80 || /(?:token|password|secret|credential)/i.test(key)) return { valid: false };
    if (typeof value === 'string') {
      if (value.length > MAINTENANCE_EXECUTABLE_STRING_MAX_CHARS) return { valid: false };
      compact[key] = value;
    }
    else if (typeof value === 'number' && Number.isFinite(value)) compact[key] = value;
    else if (typeof value === 'boolean') compact[key] = value;
    else return { valid: false };
  }
  return Object.keys(compact).length > 0 ? { valid: true, arguments: compact } : { valid: true };
}

function compactMaintenanceAction(input: unknown, includeFollowUpFields: boolean, maxChars: number): CompactMaintenanceFollowUpAction | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const action = input as Record<string, unknown>;
  if (typeof action.endpointId !== 'string'
    || action.endpointId.length === 0
    || action.endpointId.length > MAINTENANCE_EXECUTABLE_STRING_MAX_CHARS) return undefined;
  const compact: CompactMaintenanceFollowUpAction = { endpointId: action.endpointId };
  const compactArguments = compactMaintenanceArguments(action.arguments);
  if (!compactArguments.valid) return undefined;
  if (compactArguments.arguments) compact.arguments = compactArguments.arguments;
  if (includeFollowUpFields && Array.isArray(action.requiredArguments)) {
    compact.requiredArguments = action.requiredArguments
      .filter((item): item is string => typeof item === 'string')
      .slice(0, 8)
      .map(item => item.slice(0, 200));
  }
  if (includeFollowUpFields && typeof action.instruction === 'string') {
    const instructionLimit = Math.min(maxChars, 600);
    if (action.instruction.length <= instructionLimit) compact.instruction = action.instruction;
  }
  return JSON.stringify(compact).length <= maxChars ? compact : undefined;
}

function compactMaintenanceRouting(input: unknown): CompactIdleWikiPlan['routing'] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const source = input as Record<string, unknown>;
  if (source.mode !== 'stateless_rendezvous'
    || !Number.isInteger(source.candidateBand)
    || Number(source.candidateBand) < 1
    || Number(source.candidateBand) > 500
    || source.exclusive !== false) return undefined;
  return {
    mode: 'stateless_rendezvous',
    candidateBand: Number(source.candidateBand),
    exclusive: false,
  };
}

function compactMaintenancePlan(packet: unknown, maxChars: number): CompactIdleWikiPlan | undefined {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return undefined;
  const source = packet as Record<string, unknown>;
  const curationPlan = source.curationPlan;
  const plan = curationPlan && typeof curationPlan === 'object' && !Array.isArray(curationPlan)
    ? curationPlan as Record<string, unknown>
    : source.selected && source.nextAction
      ? { selected: source.selected, inspect: source.nextAction, then: source.then, followUp: source.followUp }
      : undefined;
  if (!plan) return undefined;
  const sourceSelected = plan.selected;
  if (!sourceSelected || typeof sourceSelected !== 'object' || Array.isArray(sourceSelected)) return undefined;
  const selectedSource = sourceSelected as Record<string, unknown>;
  if (typeof selectedSource.path !== 'string'
    || selectedSource.path.length === 0
    || selectedSource.path.length > MAINTENANCE_EXECUTABLE_STRING_MAX_CHARS
    || typeof selectedSource.revision !== 'string'
    || selectedSource.revision.length === 0
    || selectedSource.revision.length > MAINTENANCE_EXECUTABLE_STRING_MAX_CHARS) return undefined;
  const inspect = compactMaintenanceAction(plan.inspect, false, maxChars);
  if (!inspect) return undefined;
  const followUpSource = plan.then || plan.followUp;
  const followUpPlan = compactMaintenanceAction(followUpSource, true, maxChars);
  if (followUpSource && !followUpPlan) return undefined;
  const routing = compactMaintenanceRouting(source.attentionRouting);
  const compactPlan: CompactIdleWikiPlan = {
    planType: 'maintenance',
    selected: {
      path: selectedSource.path,
      revision: selectedSource.revision,
      ...(typeof selectedSource.reason === 'string' && { reason: selectedSource.reason }),
    },
    inspect,
    ...(followUpPlan && { followUpPlan }),
    ...(routing && { routing }),
  };
  return JSON.stringify(compactPlan).length <= maxChars ? compactPlan : undefined;
}

function compactSynthesisPlan(packet: unknown, maxChars: number): CompactIdleWikiPlan | undefined {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return undefined;
  const source = packet as Record<string, unknown>;
  if (!Array.isArray(source.items) || source.items.length === 0) return undefined;
  const candidate = source.items[0];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const readOrder = (candidate as Record<string, unknown>).readOrder;
  if (!Array.isArray(readOrder) || readOrder.length === 0) return undefined;
  const anchor = readOrder[0];
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) return undefined;
  const locator = anchor as Record<string, unknown>;
  if (typeof locator.path !== 'string'
    || locator.path.length === 0
    || locator.path.length > MAINTENANCE_EXECUTABLE_STRING_MAX_CHARS
    || typeof locator.revision !== 'string'
    || locator.revision.length === 0
    || locator.revision.length > MAINTENANCE_EXECUTABLE_STRING_MAX_CHARS) return undefined;
  const routing = compactMaintenanceRouting(source.attentionRouting);
  const plan: CompactIdleWikiPlan = {
    planType: 'synthesis',
    selected: { path: locator.path, revision: locator.revision, reason: 'knowledge_cluster_needs_synthesis' },
    inspect: {
      endpointId: endpointIdForTool('get_wiki_synthesis_candidates'),
      arguments: { focusPath: locator.path, limit: 1, maxChars: MAINTENANCE_PACKET_MAX_CHARS },
    },
    ...(routing && { routing }),
  };
  return JSON.stringify(plan).length <= maxChars ? plan : undefined;
}

/**
 * Produces one bounded, actionable pulse without adding a second
 * index or history database. The caller still decides whether to act.
 */
interface RetainedOwnerBoundary { revalidate(): Promise<void>; assertFresh(): void }

export class AgentPulseService {
  private readonly inFlight = new Map<string, Promise<{ packet: Record<string, unknown>; ownerValidator?: RetainedOwnerBoundary }>>();
  // Cached plans are advisory only. A stale entry can cause redundant inspect
  // suggestions or an expectedRevision conflict; the pulse never mutates.
  private readonly idleWikiPlanCache = new Map<string, { expiresAt: number; generation: number | undefined; plan: CompactIdleWikiPlan | undefined }>();

  constructor(
    private readonly tasks: AgentTaskService | undefined,
    private readonly continuity: ContinuityService,
    private readonly llmWiki?: LlmWikiService,
    private readonly work?: Pick<WorkService, 'pulse'>,
    private readonly skills?: { nextAction(params: { principal: ScopePrincipal; skillId: string }): Promise<{ endpointId: string; arguments: Record<string, unknown> } | undefined> },
    private readonly ownerActivity?: (activity: 'skill-evolution', principal: ScopePrincipal) => Promise<{
      run<T>(reader: () => Promise<T>): Promise<T>;
      revalidate(): Promise<void>;
      assertFresh(): void;
    } | undefined>,
  ) {}

  async get(params: { principal?: ScopePrincipal; limit?: number; maxChars?: number; hostBusy?: boolean; skillId?: string },
    retainOwnerValidator?: (validator: RetainedOwnerBoundary) => void) {
    if (params.skillId !== undefined && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(params.skillId)) throw guidanceError(Error('Invalid relevant skillId'), 'guid-df39616b6f882f4d');
    if (!params.principal) return this.getUncached(params);
    const key = JSON.stringify({ accountId: params.principal.accountId, userId: params.principal.userId, modelId: params.principal.modelId, agentId: params.principal.agentId, role: params.principal.role, limit: params.limit, maxChars: params.maxChars, skillId: params.skillId, hostBusy: params.hostBusy });
    const running = this.inFlight.get(key);
    if (running) {
      const result = await running;
      if (result.ownerValidator) retainOwnerValidator?.(result.ownerValidator);
      return result.packet;
    }
    let ownerValidator: RetainedOwnerBoundary | undefined;
    const computation = this.getUncached(params, validator => { ownerValidator = validator; })
      .then(packet => ({ packet, ...(ownerValidator && { ownerValidator }) }));
    this.inFlight.set(key, computation);
    try {
      const result = await computation;
      if (result.ownerValidator) retainOwnerValidator?.(result.ownerValidator);
      return result.packet;
    } finally {
      if (this.inFlight.get(key) === computation) this.inFlight.delete(key);
    }
  }

  private idleWikiPlanCacheKey(principal: ScopePrincipal): string {
    return JSON.stringify({
      commandCenterId: principal.commandCenterId || '',
      accountId: principal.accountId || '',
      modelId: principal.modelId || '',
      agentId: principal.agentId || '',
    });
  }

  private rememberIdleWikiPlan(key: string, generation: number | undefined, plan: CompactIdleWikiPlan | undefined, now: number): void {
    for (const [cachedKey, cached] of this.idleWikiPlanCache) {
      if (cached.expiresAt <= now) this.idleWikiPlanCache.delete(cachedKey);
    }
    this.idleWikiPlanCache.delete(key);
    while (this.idleWikiPlanCache.size >= MAINTENANCE_CACHE_MAX_ENTRIES) {
      const oldest = this.idleWikiPlanCache.keys().next();
      if (oldest.done) break;
      this.idleWikiPlanCache.delete(oldest.value);
    }
    this.idleWikiPlanCache.set(key, { expiresAt: now + MAINTENANCE_CACHE_TTL_MS, generation, plan });
  }

  private async idleWikiPlanFor(principal: ScopePrincipal): Promise<CompactIdleWikiPlan | undefined> {
    const key = this.idleWikiPlanCacheKey(principal);
    const now = Date.now();
    const generation = this.llmWiki?.readModelGeneration();
    const cached = this.idleWikiPlanCache.get(key);
    if (cached && cached.expiresAt > now && cached.generation === generation) {
      this.idleWikiPlanCache.delete(key);
      this.idleWikiPlanCache.set(key, cached);
      return cached.plan;
    }
    if (cached) this.idleWikiPlanCache.delete(key);
    const packet = await this.llmWiki?.reviewPacket(principal, 1, MAINTENANCE_PACKET_MAX_CHARS, { attentionKey: key });
    let plan = compactMaintenancePlan(packet, MAINTENANCE_PACKET_MAX_CHARS);
    if (!plan && this.llmWiki) {
      const synthesis = await this.llmWiki.synthesisCandidates(principal, 8, MAINTENANCE_PACKET_MAX_CHARS, { attentionKey: key });
      plan = compactSynthesisPlan(synthesis, MAINTENANCE_PACKET_MAX_CHARS);
    }
    this.rememberIdleWikiPlan(key, generation, plan, now);
    return plan;
  }

  private async getUncached(params: { principal?: ScopePrincipal; limit?: number; maxChars?: number; skillId?: string; hostBusy?: boolean },
    retainOwnerValidator?: (validator: RetainedOwnerBoundary) => void): Promise<Record<string, unknown>> {
    const limit = positiveLimit(params.limit, 5, 20);
    const maxChars = positiveLimit(params.maxChars, 5000, 12000);

    if (!params.principal) {
      return {
        protocol: 'mcpvault-agent-pulse/v1',
        state: 'public_reader',
        identity: null,
        authentication: {
          publicReading: true,
          requiredFor: ['note writes', 'work tasks', 'personal memory', 'skill experience'],
          note: guidanceText('guid-4bb51e030121b471', 'Public Global and Community reading needs no account. For requested participation, first read the complete onboarding policy and verify credential recovery. Do not create an account merely because this pulse is anonymous.'),
        },
        nextAction: {
          tool: 'wiki.policy',
          arguments: { topic: 'onboarding', maxChars: 3000 },
          reason: guidanceText('guid-a4a06b9e773ade8f', 'Read one complete onboarding policy for public reading, account recovery, or requested participation. This action does not register an account.'),
        },
        context: [],
      };
    }

    const principal = params.principal;
    // OAuth research sessions have an explicit task-free capability ceiling.
    // Their pulse may continue to permitted reads, but must never probe Work
    // or legacy tasks and misreport the expected denial as backend failure.
    const canReadTasks = !principal.capabilities || principal.capabilities.includes('task');
    const lease = async (activity: 'skill-evolution', configured: boolean) => {
      if (!configured) return undefined;
      try { return await this.ownerActivity?.(activity, principal); } catch { return undefined; }
    };
    const skillLease = await lease('skill-evolution', Boolean(this.skills));
    const ownerLeases = [skillLease];
    retainOwnerValidator?.({
      revalidate: async () => { await Promise.all(ownerLeases.filter((item): item is NonNullable<typeof item> => Boolean(item)).map(item => item.revalidate())); },
      assertFresh: () => { for (const ownerLease of ownerLeases) ownerLease?.assertFresh(); },
    });
    const ownerRead = <T>(ownerLease: { run<V>(reader: () => Promise<V>): Promise<V> } | undefined, reader?: () => Promise<T>) =>
      ownerLease && reader ? () => ownerLease.run(reader) : undefined;
    const actor = identity(principal);
    const sources = ['continuity', 'work', 'tasks', 'reviewQueue', 'inbox', 'skills', 'maintenance'] as const;
    type Source = typeof sources[number];
    const coverage = Object.fromEntries(sources.map(source => [source, { state: 'skipped' }])) as Record<Source, {
      state: 'loaded' | 'skipped' | 'unavailable'; reason?: 'not_configured' | 'read_failed';
    }>;
    // Only invoked sources can report counts. Required identity/work reads fail
    // closed; an optional projection failure never becomes an empty inventory.
    const read = async <T>(source: Source, enabled: boolean, reader?: () => Promise<T>, required = false): Promise<T | undefined> => {
      if (!enabled) return undefined;
      if (!reader) { coverage[source] = { state: 'unavailable', reason: 'not_configured' }; return undefined; }
      try {
        const value = await reader();
        coverage[source] = { state: 'loaded' };
        return value;
      } catch (error) {
        if (required) throw error;
        coverage[source] = { state: 'unavailable', reason: 'read_failed' };
        return undefined;
      }
    };
    const workState = (await read('continuity', true, () => this.continuity.read({ principal, maxChars: Math.min(maxChars, 3000), validateLearningProgress: false }), true))!;
    let selected = Boolean(workState.exists);
    const peerWork = await read('work', !selected && canReadTasks, this.work && (() => this.work!.pulse(principal, Math.min(limit, 5), Math.min(maxChars, 3000))), true);
    if (peerWork?.coverage === 'unavailable') throw guidanceError(new Error('Work guidance is unavailable; retry after current authorization and work state can be verified.'), 'guid-71154b9ffb6b1864');
    selected ||= Boolean(peerWork?.nextAction);
    const tasks = await read('tasks', !selected && canReadTasks, this.tasks && (() => this.tasks!.listAssignedOpen({ assignee: actor, limit, maxChars, excludeProjectBacked: Boolean(this.work) })), true);
    selected ||= Boolean(tasks?.tasks.length);
    const reviewQueue = await read('reviewQueue', !selected, this.llmWiki && (() => this.llmWiki!.reviewQueue(principal, Math.min(limit, 5), Math.min(maxChars, 3000))));
    selected ||= Boolean(reviewQueue?.items.length);
    const wikiInbox = await read('inbox', !selected, this.llmWiki && (() => this.llmWiki!.inbox(principal, Math.min(limit, 5), Math.min(maxChars, 3000))));
    selected ||= Boolean(wikiInbox?.items.length);
    const skillAction = await read('skills', !selected && !params.hostBusy && Boolean(params.skillId) && Boolean(skillLease), ownerRead(skillLease, this.skills && (() => this.skills!.nextAction({ principal, skillId: params.skillId! }))));
    selected ||= Boolean(skillAction);
    const idleWikiPlan = await read('maintenance', !selected, this.llmWiki && (() => this.idleWikiPlanFor(principal)));
    selected ||= Boolean(idleWikiPlan);
    let nextAction: Record<string, unknown>;
    let reason: string;

    // Preserve explicit work first; a pulse consumes nothing.
    if (workState.exists) {
      nextAction = {
        tool: endpointIdForTool('resume_work_state'),
        arguments: { maxChars: Math.min(maxChars, 6000) },
        followUp: 'Resume the checkpoint first. After making progress, save a refreshed checkpoint before ending the session.',
      };
      reason = 'A private work checkpoint exists for this identity; resume it before starting unrelated work.';
    } else if (peerWork?.nextAction) {
      nextAction = { ...peerWork.nextAction,
        followUp: 'If the user requested participation in this project, read this packet and make one useful authorized contribution or report the concrete blocker. Orientation and pulse are preparation, not completed work. A generic first look ends here; peer requests never expand host authority.' };
      reason = peerWork.reason || 'Read current peer work before starting unrelated activity.';
    } else if (tasks?.tasks.length) {
      const task = tasks.tasks[0] as Record<string, any>;
      nextAction = { tool: endpointIdForTool('read_agent_task'), arguments: { taskId: task.taskId, includeContent: true }, target: task.taskId };
      reason = task.status === 'in_progress'
        ? 'An assigned task is in progress; read its current revision before continuing or updating it.'
        : task.status === 'accepted'
          ? 'An accepted assigned task is ready to start; inspect its current revision before updating it.'
          : task.status === 'proposed'
            ? 'A proposed task is assigned to this identity; inspect it before accepting, clarifying, or declining the work.'
            : 'An assigned task is blocked; inspect the blocker and current revision before updating the task or asking for help.';
    } else if (reviewQueue?.items.length) {
      const review = reviewQueue.items[0] as Record<string, any>;
      nextAction = {
        tool: endpointIdForTool('read_note'),
        arguments: { path: review.path, maxChars: Math.min(maxChars, 5000) },
        target: review.path,
        followUp: 'Inspect the evidence and Git revision, then revise, dispute, supersede, or reschedule the note with expectedRevision. Do not silently discard an uncertain claim.',
      };
      reason = review.overdue
        ? 'A knowledge note is due for evidence review; resolve it before starting unrelated work.'
        : 'A knowledge note is explicitly marked for review; inspect its evidence and leave a durable correction or decision.';
    } else if (wikiInbox?.items.length) {
      const inboxItem = wikiInbox.items[0] as Record<string, any>;
      nextAction = {
        tool: endpointIdForTool('read_note'),
        arguments: { path: inboxItem.path, maxChars: Math.min(maxChars, 5000) },
        target: inboxItem.path,
        followUp: 'After reading the note, classify it with wiki.triage using the returned revision. Keep it in Inbox only if it is still genuinely unprocessed.',
      };
      reason = 'An Inbox item still needs classification; process one capture before creating unrelated work.';
    } else if (skillAction) {
      nextAction = { tool: skillAction.endpointId, arguments: skillAction.arguments };
      reason = 'One candidate for the skill relevant to this session is available. Read its exact revision; do not start a background model or exceed the current task scope.';
    } else if (idleWikiPlan) {
      nextAction = {
        tool: idleWikiPlan.inspect.endpointId,
        ...(idleWikiPlan.inspect.arguments && { arguments: idleWikiPlan.inspect.arguments }),
        target: idleWikiPlan.selected.path,
        selectedRevision: idleWikiPlan.selected.revision,
        ...(idleWikiPlan.followUpPlan && { followUpPlan: idleWikiPlan.followUpPlan }),
      };
      reason = idleWikiPlan.planType === 'synthesis'
        ? 'Open one authored Wiki synthesis opportunity and follow its bounded revision-safe plan only when the inputs, evidence, and counterpoints justify a larger model or argument. Unavailable sources are not proof that other obligations are absent.'
        : 'Inspect one bounded Wiki maintenance target before optional work. Equal-priority work is deterministically distributed to reduce duplicate effort, but this is advisory rather than an exclusive lock; re-read the selected revision before any mutation. Unavailable sources are not proof that other obligations are absent.';
    } else {
      nextAction = { tool: endpointIdForTool('get_wiki_home'), arguments: { maxChars: Math.min(maxChars, 3000) } };
      reason = 'Continue the requested wiki work; no unrelated optional activity has been selected.';
    }

    await Promise.all(ownerLeases
      .filter((item): item is NonNullable<typeof item> => Boolean(item)).map(item => item.revalidate()));
    for (const ownerLease of ownerLeases) ownerLease?.assertFresh();
    return {
      protocol: 'mcpvault-agent-pulse/v1',
      state: 'ready',
      identity: { accountId: principal.accountId, ...(principal.userId && { userId: principal.userId, familyId: principal.userId }), modelId: principal.modelId, ...(principal.agentId && { agentId: principal.agentId }), commandCenterId: principal.commandCenterId, role: principal.role },
      cadence: 'Past-experience requests: call memory.brief(query) FIRST; maintenance is not recalled experience. Retain via wiki.policy(topic=memory) -> an agent-scoped note -> re-read; default personal. No filler; shared edits require authorization. Discover continuity.save with understanding; verify continuity.resume. HTTP bearer needs no duplicate accessToken. No busy polling; MCP cannot wake models.',
      nextAction: { ...nextAction, reason },
      coverage,
      signals: {
        ...(tasks && { assignedOpenTasks: tasks.total, assignedTaskStatuses: tasks.statusCounts, assignedInProgressTasks: tasks.statusCounts.in_progress }),
        ...(peerWork?.summary && { peerWork: peerWork.summary }),
        ...(reviewQueue && { knowledgeReviewQueue: reviewQueue.total }),
        ...(wikiInbox && { wikiInbox: wikiInbox.total }),
        ...(coverage.maintenance.state === 'loaded' && { maintenanceAvailable: idleWikiPlan?.planType === 'maintenance' }),
        ...(idleWikiPlan?.planType === 'maintenance' && idleWikiPlan.routing && { maintenanceRouting: idleWikiPlan.routing.mode }),
        ...(idleWikiPlan?.planType === 'synthesis' && { synthesisAvailable: true }),
        ...(idleWikiPlan?.planType === 'synthesis' && idleWikiPlan.routing && { synthesisRouting: idleWikiPlan.routing.mode }),
      },
      context: [
        ...(workState.exists ? [{ kind: 'work_state', state: workState }] : []),
        ...(reviewQueue?.items || []).slice(0, Math.min(2, limit)).map(note => ({ kind: 'knowledge_review', note })),
        ...(wikiInbox?.items || []).slice(0, Math.min(2, limit)).map(note => ({ kind: 'wiki_inbox', note })),
        ...(idleWikiPlan ? [{ ...idleWikiPlan, kind: idleWikiPlan.planType === 'synthesis' ? 'wiki_synthesis' : 'wiki_maintenance' }] : []),
      ],
      guardrails: [
        'Do not publish private follow-up notes. Continuity stores compact progress and references, not copied bodies or secrets. Retain experience privately in agent-scoped notes; shared edits need task authorization.',
      ],
    };
  }
}
