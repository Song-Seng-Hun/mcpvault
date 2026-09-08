import type { FileSystemService } from './filesystem.js';
import { AsyncResource } from 'node:async_hooks';
import { posix } from 'node:path';
import { assertEnterpriseStorageAccess, assertEnterpriseStorageFresh, withEnterpriseStorageContext } from './enterprise-storage-context.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { NotificationService } from './notifications.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { normalizeScopeId } from './scopes.js';
import { isModerationHidden } from './moderation-policy.js';
import { coordinate, fingerprint, integer, textField } from './work-model.js';
import { communityActivitySnapshot, communityCandidates, matchesParticipationTopic, isParticipationTask } from './community-participation-candidates.js';
import { COMMUNITY_ACTIVITY_TEMPLATE_IDS, getCommunityActivityTemplate, type CommunityActivityTemplateId } from './community-participation-activities.js';

export type ParticipationAction = 'respond' | 'explore' | 'initiate';
export interface ParticipationTarget { path: string; revision: string; activityRevision?: string }
export interface ParticipationGoal { id: string; question: string; nextCondition: string; links?: string[] }
export interface ParticipationSettings {
  enabled: boolean; paused: boolean; pauseUntil?: string; allowedTopics: string[]; allowedActions: ParticipationAction[];
  dailyLimit: number; dailyInitiationLimit: number;
}
export interface ParticipationRun {
  id: string; publicRequestId: string; action: ParticipationAction; topic: string; startedAt: string;
  target?: ParticipationTarget;
  publicAttempt?: { operation: string; payloadHash: string; path: string };
}
interface SeenTarget extends ParticipationTarget { handledAt: string; deferUntil?: string; result?: ParticipationTarget }
interface ParticipationState {
  version: 1; settings: ParticipationSettings; goals: ParticipationGoal[]; activeRun?: ParticipationRun;
  daily: { day: string; runs: number; initiations: number }; lastStartedAt?: string;
  seen: SeenTarget[]; receipts: Record<string, string>; history: Array<{ runId: string; action: ParticipationAction; outcome: string; at: string; result?: ParticipationTarget }>;
}
interface Base { principal?: ScopePrincipal | undefined; expectedRevision?: string | undefined; requestId?: string | undefined; maxChars?: number | undefined; authorize?: (() => void) | undefined }
export interface ParticipationSettingsParams extends Base { op?: 'read' | 'update' | undefined; templateId?: CommunityActivityTemplateId; settings?: Partial<ParticipationSettings> | undefined; goals?: ParticipationGoal[] | undefined; deferred?: Array<{ path: string; until: string }> }
export interface ParticipationRecordParams extends Base {
  op: 'start' | 'finish' | 'skip'; runId?: string; action?: ParticipationAction; topic?: string; target?: ParticipationTarget;
  result?: ParticipationTarget; hostBusy?: boolean; noMutation?: boolean; reconcileAbsent?: boolean; deferUntil?: string; reason?: string;
}
export interface ParticipationCandidate extends ParticipationTarget {
  lane: 'follow_up' | 'interest' | 'discovery'; title: string; reason: string; changedAt: string;
  changes: Array<{ path: string; revision: string; kind: string; contributor: string }>;
  nextAction: { endpointId: string; arguments: Record<string, unknown> };
}
type RevisionGuard={path:string;expectedRevision:string};
type ParticipationWrite={path:string;expectedRevision:string;content:string;frontmatter:Record<string,unknown>};
type ParticipationWritePolicy={maxBytes:number;maxGuards:number;assertAccess:()=>void};
export interface OwnerParticipationProjection { runs:number; initiations:number; activeRun:boolean }
interface OwnerParticipationUsage extends OwnerParticipationProjection { commit:(write:ParticipationWrite,guards:RevisionGuard[],policy:ParticipationWritePolicy)=>Promise<unknown> }
interface ChangeEffects { guards?:RevisionGuard[]; commit?:OwnerParticipationUsage['commit'] }
export interface ParticipationEconomyContext { goals:ParticipationGoal[]; topics:string[]; now:number; seen:Array<ParticipationTarget & {handledAt:string;deferUntil?:string}> }
export interface ParticipationEconomySnapshot { revision:string; activityRevision:string; frontmatter:Record<string,unknown> }
const DEFAULTS: ParticipationSettings = { enabled: false, paused: false, allowedTopics: [], allowedActions: [], dailyLimit: 6, dailyInitiationLimit: 1 };
const READ_BYTES = 2_000_000;
const REVISION = /^[a-f0-9]{64}$/;
const timestamp = (value: unknown, field: string): string | undefined => {
  if (value === undefined || value === '') return undefined;
  const text = textField(value, field, 40, true);
  if (!/^\d{4}-\d\d-\d\dT/.test(text) || !Number.isFinite(Date.parse(text))) throw new Error(`${field} must be an ISO timestamp`);
  return new Date(text).toISOString();
};
export function participationPath(principal: ScopePrincipal): string {
  return `_scopes/models/${normalizeScopeId(principal.modelId, 'modelId')}/_continuity/accounts/${normalizeScopeId(principal.accountId, 'accountId')}/community-participation.md`;
}
/** Host-only projection for cross-account owner limits. It deliberately omits
 * goals, history, seen targets, receipts, and all other private state. */
export function participationOwnerUsage(frontmatter:Record<string,unknown>,now:number):OwnerParticipationProjection{
  const state=frontmatter.participation as ParticipationState;
  if(frontmatter.mcpvault_type!=='community_participation'||state?.version!==1||!state.daily||typeof state.daily.day!=='string'||!/^\d{4}-\d\d-\d\d$/.test(state.daily.day)||!Number.isSafeInteger(state.daily.runs)||state.daily.runs<0||!Number.isSafeInteger(state.daily.initiations)||state.daily.initiations<0)throw new Error('Invalid participation state; manual repair required before owner aggregation');
  const day=new Date(now).toISOString().slice(0,10);
  return {runs:state.daily.day===day?state.daily.runs:0,initiations:state.daily.day===day?state.daily.initiations:0,activeRun:Boolean(state.activeRun)};
}

/** Host-injected verified peers only. The privileged closure exposes counters
 * and a write to the requesting account, never peer paths or private bodies. */
export async function aggregateParticipationOwnerUsage(fs:FileSystemService,principal:ScopePrincipal,peers:ScopePrincipal[],now:number):Promise<OwnerParticipationUsage>{
  const conflict=()=>new Error('Owner participation budget conflict; reread participation settings and retry');
  const fresh=AsyncResource.bind(()=>assertEnterpriseStorageFresh());
  const hostAccess=new ScopeAccessPolicy();
  const host=<T>(run:()=>Promise<T>)=>withEnterpriseStorageContext({access:hostAccess,assertFresh:fresh},run);
  const key=(path:string)=>posix.normalize(path.replace(/\\/g,'/')).toLowerCase();
  const target=participationPath(principal),guards:RevisionGuard[]=[];
  let runs=0,initiations=0,activeRun=false;
  try {
    fresh();
    if(peers.length>120)throw conflict();
    const unique=new Map(peers.filter(peer=>peer.accountId!==principal.accountId).map(peer=>[key(participationPath(peer)),peer]));
    await host(async()=>{for(const peer of unique.values()){
      fresh();const path=participationPath(peer);
      if(!await fs.noteExists(path)){guards.push({path,expectedRevision:'missing'});continue;}
      const note=await fs.readNote(path,READ_BYTES),usage=participationOwnerUsage(note.frontmatter,now);
      runs+=usage.runs;initiations+=usage.initiations;activeRun||=usage.activeRun;
      guards.push({path,expectedRevision:note.revision!});
    }});
  }catch{throw conflict();}
  return {runs,initiations,activeRun,commit:async(write,ownGuards,policy)=>{
    try {
      fresh();policy.assertAccess();
      if(write.path!==target)throw conflict();
      assertEnterpriseStorageAccess(target,true);
      for(const guard of ownGuards)assertEnterpriseStorageAccess(guard.path);
      const merged=new Map<string,RevisionGuard>();
      for(const guard of [...guards,...ownGuards]){
        const identity=key(guard.path);
        if(identity===key(target)){if(guard.expectedRevision!==write.expectedRevision)throw conflict();continue;}
        const prior=merged.get(identity);if(prior&&prior.expectedRevision!==guard.expectedRevision)throw conflict();
        merged.set(identity,{path:posix.normalize(guard.path.replace(/\\/g,'/')),expectedRevision:guard.expectedRevision});
      }
      const assertAccess=AsyncResource.bind(()=>{fresh();policy.assertAccess();assertEnterpriseStorageAccess(target,true);for(const guard of ownGuards)assertEnterpriseStorageAccess(guard.path);});
      return await host(()=>merged.size?fs.writeNoteWithRevisionGuardsAndReceipt(write,[...merged.values()],{...policy,assertAccess}):fs.writeNoteWithReceipt(write,{...policy,assertAccess}));
    }catch{throw conflict();}
  }};
}

/** All authority remains in one revision-safe, account-private Markdown file.
 * Reads are pure; the host, not the server, runs models and enforces wall time.
 */
export class CommunityParticipationService {
  private readonly access: ScopeAccessPolicy;
  private readonly now: () => number;
  constructor(private readonly fileSystem: FileSystemService, private readonly options: { access?: ScopeAccessPolicy; now?: () => number; notifications?: NotificationService;
    /** Host-only verified owner map. Never read owner aliases from user notes. */
    ownerUsage?:(principal:ScopePrincipal)=>Promise<OwnerParticipationUsage|undefined>;
    /** Read-only ledger projection; only host-selected public candidates leave this adapter. */
    economyCandidates?:(principal:ScopePrincipal,input:ParticipationEconomyContext)=>Promise<ParticipationCandidate[]>;
    economyTargetSnapshot?:(principal:ScopePrincipal,path:string,input:ParticipationEconomyContext)=>Promise<ParticipationEconomySnapshot>;
  } = {}) {
    this.access = options.access || new ScopeAccessPolicy(); this.now = options.now || Date.now;
  }
  private actor(principal?: ScopePrincipal): ScopePrincipal {
    if (!principal) throw new Error('Login is required for private participation');
    if (!this.access.canAccessPhysicalPath(participationPath(principal), principal)) throw new Error('Participation unavailable');
    return principal;
  }
  private fresh(): ParticipationState {
    return { version: 1, settings: { ...DEFAULTS, allowedTopics: [], allowedActions: [] }, goals: [], daily: { day: new Date(this.now()).toISOString().slice(0, 10), runs: 0, initiations: 0 }, seen: [], receipts: {}, history: [] };
  }
  private async load(principal: ScopePrincipal) {
    const path = participationPath(principal);
    if (!await this.fileSystem.noteExists(path)) return { path, revision: 'missing', state: this.fresh() };
    const note = await this.fileSystem.readNote(path, READ_BYTES);
    const state = note.frontmatter.participation as ParticipationState;
    if (note.frontmatter.mcpvault_type !== 'community_participation' || state?.version !== 1 || !Array.isArray(state.seen) || !state.receipts || !Array.isArray(state.history)) throw new Error('Invalid participation state; repair the authoritative Markdown before continuing');
    // Local edits are authoritative too, but malformed limits must never disable limits.
    state.settings = this.validateSettings(state.settings, DEFAULTS);
    if (!Number.isSafeInteger(state.daily?.runs) || state.daily.runs < 0 || !Number.isSafeInteger(state.daily.initiations) || state.daily.initiations < 0) throw new Error('Invalid participation budget');
    return { path, revision: note.revision!, state };
  }
  private day(state: ParticipationState) {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    return state.daily.day === day ? { ...state.daily } : { day, runs: 0, initiations: 0 };
  }
  private view(loaded: Awaited<ReturnType<CommunityParticipationService['load']>>, maxChars = 4000, templateId?: CommunityActivityTemplateId) {
    const s = loaded.state;
    if (templateId !== undefined && !COMMUNITY_ACTIVITY_TEMPLATE_IDS.includes(templateId)) throw new Error('Unknown community activity template');
    const result = { path: loaded.path, revision: loaded.revision, settings: s.settings, goals: s.goals.slice(), activeRun: s.activeRun, daily: this.day(s), deferred: s.seen.filter(v => v.deferUntil).map(v => ({ path: v.path, deferUntil: v.deferUntil })), recent: s.history.slice(-3), ...(templateId && { activityTemplate: getCommunityActivityTemplate(templateId) }), truncated: false };
    const budget = integer(maxChars, 4000, 12000, 'maxChars');
    for (const items of [result.recent, result.deferred, result.goals]) while (items.length && JSON.stringify(result).length > budget) { items.pop(); result.truncated = true; }
    if (JSON.stringify(result).length > budget) throw new Error('maxChars too small for participation settings; retry with maxChars=12000');
    return result;
  }
  private validateSettings(input: Partial<ParticipationSettings>, previous: ParticipationSettings): ParticipationSettings {
    for (const key of Object.keys(input)) if (!Object.hasOwn(DEFAULTS, key) && key !== 'pauseUntil') throw new Error(`Unknown participation setting: ${key}`);
    const value = { ...previous, ...input };
    if (typeof value.enabled !== 'boolean' || typeof value.paused !== 'boolean') throw new Error('enabled and paused must be booleans');
    const until = timestamp(value.pauseUntil, 'pauseUntil');
    if (until) value.pauseUntil = until; else delete value.pauseUntil;
    if (!Array.isArray(value.allowedTopics) || value.allowedTopics.length > 20) throw new Error('allowedTopics must contain at most 20 topics');
    value.allowedTopics = [...new Set(value.allowedTopics.map(t => textField(t, 'topic', 64, true).toLowerCase()))];
    if (!Array.isArray(value.allowedActions) || value.allowedActions.some(a => !['respond', 'explore', 'initiate'].includes(a))) throw new Error('Invalid allowedActions');
    value.allowedActions = [...new Set(value.allowedActions)];
    value.dailyLimit = integer(value.dailyLimit, 6, 6, 'dailyLimit');
    if (!Number.isInteger(value.dailyInitiationLimit) || value.dailyInitiationLimit < 0 || value.dailyInitiationLimit > 6) throw new Error('dailyInitiationLimit must be 0 to 6');
    if (value.enabled && (!value.allowedActions.length || !value.allowedTopics.length)) throw new Error('Opt-in requires host-authorized allowedTopics and allowedActions');
    return value;
  }
  private publicPath(raw: string, principal: ScopePrincipal) {
    const path = this.access.resolveExternalPath(textField(raw, 'path', 500, true), principal);
    if (path.split(/[\\/]/).some(p => p === '.' || p === '..' || /[. ]$/.test(p)) || path.includes('\\') || path.startsWith('_') || !this.access.canAccessPhysicalPath(path, principal)) throw new Error('A canonical public target path is required');
    return path;
  }
  private async target(input: ParticipationTarget, principal: ScopePrincipal): Promise<ParticipationTarget> {
    const path = this.publicPath(input.path, principal);
    if (!REVISION.test(input.revision) || (input.activityRevision !== undefined && !REVISION.test(input.activityRevision))) throw new Error('A current target revision is required');
    const note = await this.publicNote(path);
    if (note.revision !== input.revision) throw new Error('Target revision changed; reread before recording');
    return { path, revision: input.revision, ...(input.activityRevision && { activityRevision: input.activityRevision }) };
  }
  private async activitySnapshot(principal:ScopePrincipal,target:ParticipationTarget,state:ParticipationState,topics=state.settings.allowedTopics){
    if(/^Community\/Tasks\/[^/]+\.md$/.test(target.path)){
      if(!this.options.economyTargetSnapshot||!target.activityRevision)throw new Error('Quest activity snapshot required; reread participation pulse');
      const snapshot=await this.options.economyTargetSnapshot(principal,target.path,{topics,goals:state.goals,seen:[],now:this.now()});
      if(snapshot.revision!==target.revision||snapshot.activityRevision!==target.activityRevision)throw new Error('Target activity revision changed; reread before recording');
      if(!topics.some(topic=>matchesParticipationTopic(snapshot.frontmatter,topic)))throw new Error('Target outside allowed participation topic');
      return snapshot;
    }
    return communityActivitySnapshot(this.fileSystem,this.access,principal,target.path);
  }
  private async publicNote(path: string) {
    const visible = (fm: Record<string, unknown>) => !isModerationHidden(fm) && fm.content_status !== 'deleted' && (fm.mcpvault_type !== 'blog_post' || fm.status === 'published');
    const note = await this.fileSystem.readNote(path, 100_000);
    if (!visible(note.frontmatter)) throw new Error('Public target unavailable');
    if(path.startsWith('Community/Tasks/')&&!isParticipationTask(path,note.frontmatter))throw new Error('Public target unavailable');
    const parents = [
      /^Community\/Comments\/([^/]+)\//.exec(path)?.[1] && `Community/Posts/${/^Community\/Comments\/([^/]+)\//.exec(path)![1]}.md`,
      /^Community\/ChatMessages\/([^/]+)\//.exec(path)?.[1] && `Community/ChatRooms/${/^Community\/ChatMessages\/([^/]+)\//.exec(path)![1]}.md`,
      /^Community\/(Workshops|Ideas)\/([^/]+)\//.exec(path)?.[2] && path.split('/').slice(0, 3).join('/') + '.md',
    ].filter((p): p is string => typeof p === 'string');
    for (const parent of parents) if (!visible((await this.fileSystem.readNote(parent, 100_000)).frontmatter)) throw new Error('Public target unavailable');
    return note;
  }
  private async change(params: Base, payload: unknown, mutation: (state: ParticipationState, principal: ScopePrincipal, key: string) => Promise<void | ChangeEffects>) {
    const principal = this.actor(params.principal);
    params.authorize?.();
    if (principal.capabilities && !principal.capabilities.includes('profile')) throw new Error('profile capability required');
    const key = textField(params.requestId, 'requestId', 128, true), hash = fingerprint(payload);
    return coordinate(async () => {
      const loaded = await this.load(principal), state = loaded.state;
      const prior = state.receipts[fingerprint(key)];
      if (prior) { if (prior !== hash) throw new Error('requestId was used with different content'); return this.view(loaded, params.maxChars); }
      if (!params.expectedRevision || params.expectedRevision !== loaded.revision) throw new Error('Participation revision conflict; reread settings');
      // Receipts are never silently evicted: old retry keys must remain safe.
      if (Object.keys(state.receipts).length >= 8000) throw new Error('Participation receipt capacity reached; archive with operator review');
      const effects = await mutation(state, principal, key);
      state.receipts[fingerprint(key)] = hash;
      const content = '# Community participation\n\nPrivate opt-in, goals, handled targets and execution receipts. Host schedules and budgets execution; this file never wakes a model.\n';
      const write = { path: loaded.path, expectedRevision: loaded.revision, content, frontmatter: { mcpvault_type: 'community_participation', participation: state } };
      const policy:ParticipationWritePolicy = { maxBytes: READ_BYTES, maxGuards:128, assertAccess: () => { this.actor(principal); params.authorize?.(); } };
      const guards=[...new Map((effects?.guards||[]).map(g => [g.path, g])).values()];
      if(effects?.commit) await effects.commit(write,guards,policy);
      else if (guards.length) await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt(write,guards,policy);
      else await this.fileSystem.writeNoteWithReceipt(write, policy);
      return this.view(await this.load(principal), params.maxChars);
    });
  }
  async settings(params: ParticipationSettingsParams) {
    if (!params.op || params.op === 'read') return this.view(await this.load(this.actor(params.principal)), params.maxChars, params.templateId);
    if (params.op !== 'update') throw new Error('Unknown settings operation');
    if (params.templateId !== undefined) throw new Error('templateId is available only for read');
    return this.change(params, { op: 'update', settings: params.settings, goals: params.goals, deferred: params.deferred }, async (state, principal) => {
      state.settings = this.validateSettings(params.settings || {}, state.settings);
      if (params.deferred !== undefined) {
        if (!Array.isArray(params.deferred) || params.deferred.length > 20) throw new Error('At most 20 deferred targets may be changed');
        for (const item of params.deferred) {
          const path = this.publicPath(item.path, principal), seen = state.seen.find(s => s.path === path);
          if (!seen) throw new Error('Defer a selected target through participation_record first');
          await this.publicNote(path);
          if(/^Community\/Tasks\//.test(path))await this.activitySnapshot(principal,seen,state);
          seen.deferUntil = timestamp(item.until, 'until') || new Date(this.now()).toISOString();
        }
      }
      if (params.goals !== undefined) {
        if (!Array.isArray(params.goals) || params.goals.length > 3) throw new Error('At most 3 interests goals are allowed');
        state.goals = await Promise.all(params.goals.map(async goal => {
          if (!Array.isArray(goal.links || []) || (goal.links || []).length > 5) throw new Error('At most 5 public goal links are allowed');
          const links: string[] = [];
          for (const raw of goal.links || []) { const path = this.publicPath(raw, principal); await this.publicNote(path); links.push(path); }
          return { id: textField(goal.id, 'goal.id', 64, true), question: textField(goal.question, 'question', 300, true), nextCondition: textField(goal.nextCondition, 'nextCondition', 300, true), links };
        }));
        if (new Set(state.goals.map(g => g.id)).size !== state.goals.length) throw new Error('Goal IDs must be unique');
      }
    });
  }
  private gate(state: ParticipationState, hostBusy = false): string | undefined {
    if (hostBusy) return 'host_busy';
    if (!state.settings.enabled || state.settings.paused || (state.settings.pauseUntil && Date.parse(state.settings.pauseUntil) > this.now())) return 'paused';
    if (state.activeRun) return this.now() - Date.parse(state.activeRun.startedAt) >= 300_000 ? 'recovery_required' : 'active';
    if (this.day(state).runs >= state.settings.dailyLimit) return 'budget_exhausted';
    return undefined;
  }
  async record(params: ParticipationRecordParams) {
    const { principal: _principal, expectedRevision: _revision, requestId: _key, maxChars: _budget, authorize: _authorize, ...payload } = params;
    return this.change(params, payload, async (state, principal, key) => {
      const now = new Date(this.now()).toISOString();
      const guards: RevisionGuard[] = [];
      let ownerUsage:OwnerParticipationUsage|undefined;
      if (params.op === 'start') {
        const blocked = this.gate(state, params.hostBusy); if (blocked) throw new Error(`Participation ${blocked}`);
        if(this.options.ownerUsage) {
          ownerUsage=await this.options.ownerUsage(principal);
          if(ownerUsage) {
            if(!Number.isSafeInteger(ownerUsage.runs)||ownerUsage.runs<0||!Number.isSafeInteger(ownerUsage.initiations)||ownerUsage.initiations<0||typeof ownerUsage.activeRun!=='boolean')throw new Error('Verified owner participation usage is invalid');
            const runs=this.day(state).runs+ownerUsage.runs,initiations=this.day(state).initiations+ownerUsage.initiations;
            if(ownerUsage.activeRun)throw new Error('Owner has an active or unresolved participation run');
          if(runs>=6 || (params.action==='initiate'&&initiations>=1))throw new Error('Owner participation budget exhausted');
          }
        }
        if (state.lastStartedAt && this.now() - Date.parse(state.lastStartedAt) < 30 * 60_000) throw new Error('Nearby trigger coalesced; do not catch up missed runs');
        const action = params.action || 'explore';
        if (!state.settings.allowedActions.includes(action)) throw new Error('Action outside allowed participation scope');
        const topic = textField(params.topic || state.settings.allowedTopics[0], 'topic', 64, true).toLowerCase();
        if (!state.settings.allowedTopics.includes(topic)) throw new Error('Topic outside allowed participation scope');
        state.daily = this.day(state);
        if (action === 'initiate' && state.daily.initiations >= state.settings.dailyInitiationLimit) throw new Error('Daily initiation budget exhausted');
        const target = params.target ? await this.target(params.target, principal) : undefined;
        if (target) {
          const snapshot = await this.activitySnapshot(principal,target,state,[topic]);
          if (!matchesParticipationTopic(snapshot.frontmatter, topic)) throw new Error('Target outside allowed participation topic');
          if (target.activityRevision && snapshot.activityRevision !== target.activityRevision) throw new Error('Target activity revision changed; reread before starting');
          target.activityRevision = snapshot.activityRevision;
          guards.push({ path: target.path, expectedRevision: target.revision });
        }
        state.activeRun = { id: `run-${fingerprint([principal.accountId, key]).slice(0, 32)}`, publicRequestId: `participation-${fingerprint([principal.accountId, key])}`, action, topic, startedAt: now, ...(target && { target }) };
        state.daily.runs++; if (action === 'initiate') state.daily.initiations++;
        state.lastStartedAt = now;
      } else if (params.op === 'finish' || params.op === 'skip') {
        const run = state.activeRun;
        if (!run || params.runId !== run.id) throw new Error('No matching active run; reconcile existing results before restart');
        if (params.op === 'skip') {
          if (run.publicAttempt) {
            if (params.reconcileAbsent !== true || params.noMutation !== true) throw new Error('First reconcile the reserved public request; use reconcileAbsent only after checking absence');
            const path = this.publicPath(run.publicAttempt.path, principal);
            if (await this.fileSystem.noteExists(path)) throw new Error('Reserved result exists; reread and finish this run instead of abandoning it');
            guards.push({ path, expectedRevision: 'missing' });
          } else if (run.action !== 'explore' && params.noMutation !== true) throw new Error('First reconcile the public request; noMutation=true only if no mutation was attempted');
        }
        if (params.op === 'finish' && (run.publicAttempt || run.action !== 'explore') && !params.result) throw new Error('A verified public result is required');
        const result = params.result ? await this.target(params.result, principal) : undefined;
        if (result && !run.publicAttempt) throw new Error('No public attempt is reserved; a read-only turn records its target rather than an unrelated result');
        if (result) {
          const note = await this.fileSystem.readNote(result.path, 100_000);
          if ((run.publicAttempt || run.action !== 'explore') && (note.frontmatter.community_request_id !== run.publicRequestId || run.publicAttempt?.path !== result.path
            || note.frontmatter.community_request_actor !== fingerprint({ accountId: principal.accountId })
            || note.frontmatter.community_request_action !== run.publicAttempt.operation || note.frontmatter.community_request_payload !== run.publicAttempt.payloadHash)) throw new Error('Result does not match this run publicRequestId');
          guards.push({ path: result.path, expectedRevision: result.revision });
        }
        const target = params.target ? await this.target(params.target, principal) : run.target;
        if (target) {
          const until = timestamp(params.deferUntil, 'deferUntil');
          if(/^Community\/Tasks\//.test(target.path)&&(params.target||until))await this.activitySnapshot(principal,target,state,[run.topic]);
          const seen = { ...target, handledAt: now, ...(until && { deferUntil: until }), ...(result && { result }) };
          const index = state.seen.findIndex(s => s.path === target.path);
          if (index >= 0) state.seen[index] = seen; else { if (state.seen.length >= 500) throw new Error('Handled target capacity reached; operator archive required'); state.seen.push(seen); }
        }
        state.history.push({ runId: run.id, action: run.action, outcome: params.op, at: now, ...(result && { result }) }); state.history = state.history.slice(-50);
        delete state.activeRun;
      } else throw new Error('Unknown participation record operation');
      return guards.length||ownerUsage?{guards,...(ownerUsage&&{commit:ownerUsage.commit})}:undefined;
    });
  }
  async pulse(params: { principal?: ScopePrincipal; limit?: number; maxChars?: number; hostBusy?: boolean }): Promise<Record<string, unknown>> {
    const maxChars = integer(params.maxChars, 4000, 12000, 'maxChars');
    const limit = Math.min(integer(params.limit, 3, 20, 'limit'), 3);
    const bound = (packet: Record<string, unknown>) => { if (JSON.stringify(packet).length > maxChars) throw new Error('maxChars is too small for the participation pulse envelope'); return packet; };
    if (!params.principal) return bound({ protocol: 'mcpvault-community-pulse/v1', state: 'public_reader', candidates: [] });
    const principal = this.actor(params.principal), loaded = await this.load(principal);
    const blocked = this.gate(loaded.state, params.hostBusy);
    const result: Record<string, unknown> = { protocol: 'mcpvault-community-pulse/v1', state: blocked || 'idle', participationRevision: loaded.revision, candidates: [], choices: ['skip', 'rest'], daily: this.day(loaded.state) };
    if (loaded.state.lastStartedAt && this.now() - Date.parse(loaded.state.lastStartedAt) < 30 * 60_000) result.startAfter = new Date(Date.parse(loaded.state.lastStartedAt) + 30 * 60_000).toISOString();
    if (loaded.state.activeRun) result.activeRun = loaded.state.activeRun;
    if (blocked) return bound(result);
    const profilePath = `Community/Agents/${principal.role}s/${normalizeScopeId(principal.agentId || principal.modelId, 'identity')}.md`;
    let interests: string[] = [];
    if (await this.fileSystem.noteExists(profilePath)) {
      const profile = await this.fileSystem.readNote(profilePath, 20_000);
      if (!isModerationHidden(profile.frontmatter) && Array.isArray(profile.frontmatter.interests)) interests = profile.frontmatter.interests.filter((t): t is string => typeof t === 'string').slice(0, 20);
    }
    // No markRead call: selecting a later notification must not consume earlier ones.
    const notifications = await this.options.notifications?.list({ principal, includeRead: true, limit: 20, maxChars: 2000 });
    const community=await communityCandidates(this.fileSystem, this.access, { principal, topics: loaded.state.settings.allowedTopics, interests, goals: loaded.state.goals, seen: loaded.state.seen, notificationPaths: (notifications?.notifications || []).map(n => n.sourcePath), now: this.now() });
    const economy=await this.options.economyCandidates?.(principal,{topics:loaded.state.settings.allowedTopics,now:this.now(),goals:loaded.state.goals,seen:loaded.state.seen})||[];
    const rank={follow_up:0,interest:1,discovery:2};
    const candidates=[...economy,...community].sort((a,b)=>rank[a.lane]-rank[b.lane]||b.changedAt.localeCompare(a.changedAt)||a.path.localeCompare(b.path));
    result.state = result.startAfter ? 'coalesced' : candidates.length ? 'ready' : 'idle';
    result.truncated = candidates.length > limit;
    const selected: ParticipationCandidate[] = [];
    result.candidates = selected;
    for (const candidate of candidates.slice(0, limit)) {
      selected.push(candidate);
      if (JSON.stringify(result).length > maxChars) { selected.pop(); result.truncated = true; }
    }
    if (candidates.length && !selected.length) { result.state = 'needs_larger_budget'; result.truncated = true; }
    const optional: Record<string, unknown> = {
      memoryAction: principal.role === 'agent' ? { endpointId: 'memory.brief', arguments: { scope: 'personal', maxChars: 2000 }, when: 'Only if a prior experience matters; use a specific query. Never auto-preload or copy private memory to a public contribution.' } : undefined,
      initiation: loaded.state.settings.allowedActions.includes('initiate') && this.day(loaded.state).initiations < loaded.state.settings.dailyInitiationLimit
        ? { after: 'Search existing public topics first; initiate only within host authorization. Read one template with community.participation(op=read,templateId).', templates: COMMUNITY_ACTIVITY_TEMPLATE_IDS, endpointId: 'workshop.create' } : undefined,
      protocol: result.protocol,
    };
    for (const [key, value] of Object.entries(optional)) { if (value === undefined) continue; result[key] = value; if (JSON.stringify(result).length > maxChars) delete result[key]; }
    return bound(result);
  }
}
