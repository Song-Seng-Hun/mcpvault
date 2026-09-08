import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { withEnterpriseStorageContext } from './enterprise-storage-context.js';
import { CommunityParticipationService, participationPath, aggregateParticipationOwnerUsage } from './community-participation.js';

let vault: string, fs: FileSystemService, service: CommunityParticipationService;
let now = Date.parse('2026-09-08T00:00:00Z');
const principal: ScopePrincipal = { accountId: 'alice', modelId: 'gpt', agentId: 'worker', role: 'agent', capabilities: ['profile', 'comment', 'publish'] };
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'participation-')); fs = new FileSystemService(vault); now = Date.parse('2026-09-08T00:00:00Z'); service = new CommunityParticipationService(fs, { now: () => now }); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
async function enable() { return service.settings({ principal, op: 'update', expectedRevision: 'missing', requestId: 'opt-in', settings: { enabled: true, allowedTopics: ['science'], allowedActions: ['respond', 'explore', 'initiate'] } }); }
test('installation is off, reads are pure, account state is isolated from continuity and same model peers', async () => {
  const initial = await service.settings({ principal });
  expect(initial.settings.enabled).toBe(false); expect(initial.revision).toBe('missing');
  expect((await service.pulse({ principal })).state).toBe('paused');
  const saved = await enable();
  expect(saved.path).not.toContain('work-state.md');
  expect(new ScopeAccessPolicy().canAccessPhysicalPath(saved.path, { ...principal, accountId: 'bob' })).toBe(false);
  expect((await service.settings({ principal: { ...principal, accountId: 'bob' } })).revision).toBe('missing');
  await expect(service.settings({})).rejects.toThrow(/Login/);
});
test('settings require revisions and replay the same request without duplicating writes', async () => {
  const first = await enable(); const again = await enable(); expect(again.revision).toBe(first.revision);
  await expect(service.settings({ principal, op: 'update', expectedRevision: first.revision, requestId: 'opt-in', settings: { enabled: false } })).rejects.toThrow(/different/);
  await expect(service.settings({ principal, op: 'update', expectedRevision: 'missing', requestId: 'stale', settings: { enabled: false } })).rejects.toThrow(/revision/i);
  await expect(service.settings({ principal, op: 'update', expectedRevision: first.revision, requestId: 'goals', goals: Array.from({ length: 4 }, (_, i) => ({ id: String(i), question: 'Q', links: [], nextCondition: 'reply' })) })).rejects.toThrow(/3/);
  await expect(service.settings({ principal, op: 'update', expectedRevision: first.revision, requestId: 'too-many-runs', settings: { dailyLimit: 7 } })).rejects.toThrow(/6/);
});
test('parallel services admit one run, count idle runs, coalesce triggers, and preserve uncertain runs on restart', async () => {
  const configured = await enable(); const other = new CommunityParticipationService(fs, { now: () => now });
  const attempts = await Promise.allSettled([service, other].map((s, i) => s.record({ principal, op: 'start', requestId: `start-${i}`, expectedRevision: configured.revision, action: 'explore' })));
  expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  now += 6 * 60_000;
  expect((await other.pulse({ principal })).state).toBe('recovery_required');
  let state = await other.settings({ principal });
  const done = await other.record({ principal, op: 'skip', requestId: 'idle', runId: state.activeRun!.id, expectedRevision: state.revision });
  expect(done.daily.runs).toBe(1);
  await expect(other.record({ principal, op: 'start', requestId: 'nearby', expectedRevision: done.revision, action: 'explore' })).rejects.toThrow(/coalesced/);
});
test('busy hosts, pause, daily and initiation limits reject new runs', async () => {
  let state = await enable();
  await expect(service.record({ principal, op: 'start', requestId: 'busy', expectedRevision: state.revision, action: 'explore', hostBusy: true })).rejects.toThrow(/busy/);
  for (let i = 0; i < 6; i++) {
    state = await service.record({ principal, op: 'start', requestId: `start-${i}`, expectedRevision: state.revision, action: 'explore' });
    state = await service.record({ principal, op: 'skip', requestId: `skip-${i}`, expectedRevision: state.revision, runId: state.activeRun!.id });
    now += 31 * 60_000;
  }
  expect((await service.pulse({ principal })).state).toBe('budget_exhausted');
  await expect(service.record({ principal, op: 'start', requestId: 'seventh', expectedRevision: state.revision, action: 'explore' })).rejects.toThrow(/budget/);
});

test('pulse includes a host-projected economy candidate without changing free/rest choices or waking work',async()=>{
 let calls=0;
 const s=new CommunityParticipationService(fs,{now:()=>now,economyCandidates:async(_principal,input)=>{
   calls++;expect(input.goals).toEqual([]);return [{path:'Community/Tasks/quest.md',revision:'a'.repeat(64),activityRevision:'b'.repeat(64),lane:'interest',title:'Public quest',reason:'Goal-matched funded quest; acceptance is manual.',changedAt:'2026-09-08T00:00:00.000Z',changes:[],nextAction:{endpointId:'quest.market',arguments:{contractId:'quest',maxChars:2000}}}];
 }});
 const state=await s.settings({principal,op:'update',expectedRevision:'missing',requestId:'economy-opt-in',settings:{enabled:true,allowedTopics:['science'],allowedActions:['explore']}});
 const pulse=await s.pulse({principal});
 expect(calls).toBe(1);expect(pulse).toMatchObject({state:'ready',choices:['skip','rest'],participationRevision:state.revision});
 expect(JSON.stringify(pulse)).toContain('quest.market');expect(JSON.stringify(pulse)).not.toContain('claim');
});

test('host-only owner aggregation enforces two initialized enterprise aliases without exposing peer participation',async()=>{
 const enterprise={mode:'company' as const,realmId:'acme',runtimeId:'internal',sharedMemoryEnabled:true};
 const access=new ScopeAccessPolicy({commandCenterId:'acme',enterprise:{mode:'company',realmId:'acme'}});
 const own={...principal,accountId:'owner-one',userId:'owner-family',commandCenterId:'acme',enterprise};
 const peer={...own,accountId:'owner-two',agentId:'peer-worker'};
 const independent={...own,accountId:'independent',userId:'independent-family',agentId:'other-worker'};
 expect(access.canAccessPhysicalPath(participationPath(own),own)).toBe(true);
 expect(access.canAccessPhysicalPath(participationPath(peer),own)).toBe(false);
 const invoke=<T>(p:ScopePrincipal,operation:()=>Promise<T>)=>withEnterpriseStorageContext({access,principal:p,assertFresh(){}},operation);
 const s=new CommunityParticipationService(fs,{access,now:()=>now,ownerUsage:async p=>{
   return aggregateParticipationOwnerUsage(fs,p,p.accountId==='independent'?[]:[own,peer],now);
 }});
 for(const p of [own,peer,independent])await invoke(p,()=>s.settings({principal:p,op:'update',expectedRevision:'missing',requestId:'enable-owner',settings:{enabled:true,allowedTopics:['science'],allowedActions:['explore']}}));
 let peerState=await invoke(peer,()=>s.settings({principal:peer}));
 peerState=await invoke(peer,()=>s.settings({principal:peer,op:'update',expectedRevision:peerState.revision,requestId:'peer-private-goal',goals:[{id:'peer-secret',question:'private goal',nextCondition:'never'}]}));
 for(let i=0;i<6;i++) {
   const p=i%2?peer:own;let current=await invoke(p,()=>s.settings({principal:p}));
   current=await invoke(p,()=>s.record({principal:p,op:'start',requestId:`owner-${i}`,expectedRevision:current.revision,action:'explore'}));
   const finished=await invoke(p,()=>s.record({principal:p,op:'skip',requestId:`idle-${i}`,expectedRevision:current.revision,runId:current.activeRun!.id}));
   if(p===own)expect(JSON.stringify(finished)).not.toContain('peer-secret');
   else expect(JSON.stringify(finished)).toContain('peer-secret');
   now+=31*60000;
 }
 await expect(invoke(peer,async()=>s.record({principal:peer,op:'start',requestId:'alias-seventh',expectedRevision:(await s.settings({principal:peer})).revision,action:'explore'}))).rejects.toThrow(/owner.*budget/i);
 expect((await invoke(independent,async()=>s.record({principal:independent,op:'start',requestId:'other-owner',expectedRevision:(await s.settings({principal:independent})).revision,action:'explore'}))).daily.runs).toBe(1);
});
test('completion verifies the exact current public result and an uncertain run cannot be silently abandoned', async () => {
  let state = await enable(); state = await service.record({ principal, op: 'start', requestId: 'run', expectedRevision: state.revision, action: 'respond' });
  await expect(service.record({ principal, op: 'finish', requestId: 'bad', expectedRevision: state.revision, runId: state.activeRun!.id, result: { path: 'Community/Comments/p/no.md', revision: '0'.repeat(64) } })).rejects.toThrow();
  await expect(service.record({ principal, op: 'skip', requestId: 'uncertain', expectedRevision: state.revision, runId: state.activeRun!.id })).rejects.toThrow(/reconcile/);
});

test('owner helper handles single accounts, missing peers and duplicate guards through the production commit signature',async()=>{
 const peer={...principal,accountId:'not-initialized'};
 const s=new CommunityParticipationService(fs,{now:()=>now,ownerUsage:p=>aggregateParticipationOwnerUsage(fs,p,[p,peer,peer],now)});
 let state=await enable();
 const guard=await fs.writeNoteWithReceipt({path:'Community/Guard.md',content:'# Public guard'});
 const usage=await aggregateParticipationOwnerUsage(fs,principal,[principal],now);
 const note=await fs.readNote(state.path);
 const receipt=await usage.commit({path:state.path,content:note.content,frontmatter:note.frontmatter,expectedRevision:state.revision},[
   {path:'Community/Guard.md',expectedRevision:guard.revision},
   {path:'Community/./Guard.md',expectedRevision:guard.revision},
   {path:state.path,expectedRevision:state.revision},
 ],{maxBytes:2_000_000,maxGuards:128,assertAccess(){}});
 expect(receipt).toHaveProperty('revision');
 state=await s.settings({principal});
 state=await s.record({principal,op:'start',requestId:'missing-peer-start',expectedRevision:state.revision,action:'explore'});
 expect(state.daily.runs).toBe(1);expect(await fs.noteExists(participationPath(peer))).toBe(false);
});

test('owner helper guards a missing peer against concurrent initialization and conceals peer paths on conflict',async()=>{
 const peer={...principal,accountId:'private-peer'};
 const state=await enable(),before=await fs.readNote(state.path);
 const usage=await aggregateParticipationOwnerUsage(fs,principal,[principal,peer],now);
 await service.settings({principal:peer,op:'update',expectedRevision:'missing',requestId:'peer-created',settings:{enabled:true,allowedTopics:['science'],allowedActions:['explore']}});
 await expect(usage.commit({path:state.path,expectedRevision:state.revision,content:'must not commit',frontmatter:before.frontmatter},[],{maxBytes:2_000_000,maxGuards:128,assertAccess(){}})).rejects.toThrow(/^Owner participation budget conflict; reread participation settings and retry$/);
 expect((await fs.readNote(state.path)).revision).toBe(before.revision);
 const malformed=await fs.readNote(participationPath(peer));
 await fs.writeNote({path:participationPath(peer),expectedRevision:malformed.revision,content:'peer private content',frontmatter:{...malformed.frontmatter,participation:{version:1,daily:{runs:-1}}}});
 await expect(aggregateParticipationOwnerUsage(fs,principal,[peer],now)).rejects.toThrow(/^Owner participation budget conflict; reread participation settings and retry$/);
});

test('owner helper detects initialized peer revision drift and conflicting duplicate guards before commit',async()=>{
 const peer={...principal,accountId:'peer'};const state=await enable();
 let peerState=await service.settings({principal:peer,op:'update',expectedRevision:'missing',requestId:'enable-peer',settings:{enabled:true,allowedTopics:['science'],allowedActions:['explore']}});
 const usage=await aggregateParticipationOwnerUsage(fs,principal,[peer],now);
 peerState=await service.record({principal:peer,op:'start',requestId:'peer-start',expectedRevision:peerState.revision,action:'explore'});
 expect(peerState.daily.runs).toBe(1);
 const own=await fs.readNote(state.path),write={path:state.path,expectedRevision:state.revision,content:own.content,frontmatter:own.frontmatter},policy={maxBytes:2_000_000,maxGuards:128,assertAccess(){}};
 await expect(usage.commit(write,[],policy)).rejects.toThrow(/^Owner participation budget conflict; reread participation settings and retry$/);
 const single=await aggregateParticipationOwnerUsage(fs,principal,[],now);
 await expect(single.commit(write,[{path:'Community/guard.md',expectedRevision:'missing'},{path:'Community/./guard.md',expectedRevision:'a'.repeat(64)}],policy)).rejects.toThrow(/^Owner participation budget conflict; reread participation settings and retry$/);
 expect((await fs.readNote(state.path)).revision).toBe(state.revision);
});
test('an abandoned public reservation can recover only after proving no result exists', async () => {
  let state = await enable(); state = await service.record({ principal, op: 'start', requestId: 'reserved', expectedRevision: state.revision, action: 'respond' });
  const path = state.path, note = await fs.readNote(path);
  note.frontmatter.participation.activeRun.publicAttempt = { operation: 'community.comment', payloadHash: '0'.repeat(64), path: 'Community/Comments/q/reserved.md' };
  await fs.writeNote({ path, content: note.content, frontmatter: note.frontmatter, expectedRevision: note.revision });
  state = await service.settings({ principal });
  await expect(service.record({ principal, op: 'skip', runId: state.activeRun!.id, expectedRevision: state.revision, requestId: 'unsafe-skip', noMutation: true })).rejects.toThrow(/reconcile/);
  const recovered = await service.record({ principal, op: 'skip', runId: state.activeRun!.id, expectedRevision: state.revision, requestId: 'checked-skip', noMutation: true, reconcileAbsent: true });
  expect(recovered.activeRun).toBeUndefined(); expect(recovered.daily.runs).toBe(1);
});
