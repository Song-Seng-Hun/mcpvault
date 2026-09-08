import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EconomyLedger } from './economy-ledger.js';
import { EconomyService } from './economy-service.js';
import { economyRevision, type EconomyPolicy } from './economy-model.js';
import { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import { CommunityParticipationService, type ParticipationCandidate } from './community-participation.js';

const roots:string[]=[];
const policy:EconomyPolicy={version:1,revision:'participation-pilot',enabled:true,treasury:'treasury',operators:['operator'],owners:{treasury:'host',alice:'owner-a',bob:'owner-b',carol:'owner-c'},reviewers:['carol'],subjectiveReview:true,maxSupply:5000,minReward:10,maxReward:100,postingFee:2,reviewFee:5,dailySpend:107,dailyPosts:1,openContracts:2};
const actor=(accountId:string):ScopePrincipal=>({accountId,modelId:'codex',agentId:accountId,role:'agent',capabilities:['profile','task','write']});
const context={topics:['uncertainty'],now:Date.parse('2026-09-08T00:00:00.000Z')};
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'economy-participation-'));roots.push(root);const vaultPath=join(root,'vault'),hostPath=join(root,'host');await mkdir(vaultPath);await mkdir(hostPath);
 const fs=new FileSystemService(vaultPath),ledger=await EconomyLedger.initialize({vaultPath,hostPath,policy,storageVerified:true});
 await ledger.transact({op:'issue',actor:'operator',requestId:'supply',amount:5000,reason:'pilot'});await ledger.transact({op:'allocate',actor:'operator',requestId:'allocation',account:'alice',amount:200,reason:'pilot'});
 await fs.writeNote({path:'Community/Projects/project.md',content:'# Project',frontmatter:{mcpvault_type:'work_project',project_id:'project',participants:['alice','bob','carol']}});
 const task=await fs.writeNoteWithReceipt({path:'Community/Tasks/quest.md',content:'# Quest',frontmatter:{mcpvault_type:'agent_task',task_id:'quest',project_id:'project',status:'proposed',requester_account_id:'alice',claim_generation:0,completion_criteria:['Preserve uncertainty']}});
 const terms={taskId:'quest',taskRevision:task.revision,title:'Uncertainty review',criteria:['Preserve uncertainty'],exclusions:[],kind:'research' as const,reward:100,deadline:'2027-01-01T00:00:00.000Z',verifier:'independent-review-v1'};
 const draft=await ledger.transact({op:'draft',actor:'alice',requestId:'draft',contractId:'quest-contract',expectedRevision:'missing',terms});
 await ledger.transact({op:'fund',actor:'alice',requestId:'fund',contractId:'quest-contract',expectedRevision:draft.revision});
 return {fs,ledger,service:new EconomyService(fs,ledger,policy,{assertActor:async()=>{}})};
}

test('ledger-backed participation candidates offer goal-matched funded acceptance and suppress an unchanged seen activity',async()=>{
 const {ledger,service}=await fixture();try{
  const before=economyRevision(await ledger.snapshot());
  const candidates=await service.participationCandidates(actor('bob'),{...context,goals:[{id:'uncertainty',question:'How should uncertainty be preserved?',nextCondition:'review'}],seen:[]});
  expect(candidates).toHaveLength(1);const candidate=candidates[0]!;expect(candidate).toMatchObject({path:'Community/Tasks/quest.md',lane:'interest',nextAction:{endpointId:'quest.market'}});
  if(!candidate.activityRevision)throw new Error('Economy activity revision is required for seen suppression');
  expect(JSON.stringify(candidate)).not.toContain('submissionBasis');
  expect(economyRevision(await ledger.snapshot())).toBe(before);
  expect(await service.participationCandidates(actor('bob'),{...context,goals:[{id:'uncertainty',question:'How should uncertainty be preserved?',nextCondition:'review'}],seen:[{path:candidate.path,revision:candidate.revision,activityRevision:candidate.activityRevision,handledAt:'2026-09-08T00:00:00.000Z'}]})).toEqual([]);
 }finally{await ledger.close();}
});

test('own commissioned, submitted-result, and assigned-review quest follow-ups expose no private ledger data or automatic action',async()=>{
 const {ledger,service}=await fixture();try{
  expect((await service.participationCandidates(actor('alice'),{...context,goals:[],seen:[]}))[0]!.reason).toMatch(/commissioned/i);
  let state=await ledger.snapshot(),contract=state.contracts['quest-contract']!;
  await ledger.transact({op:'claim',actor:'bob',requestId:'claim',contractId:contract.id,expectedRevision:economyRevision(contract),expectedGeneration:contract.generation});
  state=await ledger.snapshot();contract=state.contracts['quest-contract']!;
  await ledger.transact({op:'submit',actor:'bob',requestId:'submit',contractId:contract.id,expectedRevision:economyRevision(contract),expectedGeneration:contract.generation,artifacts:[{path:'Knowledge/result.md',revision:'a'.repeat(64)}]});
  const [worker,reviewer]=await Promise.all([service.participationCandidates(actor('bob'),{...context,goals:[],seen:[]}),service.participationCandidates(actor('carol'),{...context,goals:[],seen:[]})]);
  expect(worker[0]!.reason).toMatch(/submitted result/i);expect(reviewer[0]!.reason).toMatch(/review/i);
  expect(JSON.stringify([...worker,...reviewer])).not.toContain('submissionBasis');
  expect((await ledger.snapshot()).contracts['quest-contract']!.status).toBe('submitted');
 }finally{await ledger.close();}
});

test.each(['skip','finish'] as const)('production participation options support start -> %s -> seen suppression -> ledger follow-up',async(op)=>{
 const {fs,ledger,service:economy}=await fixture();let now=context.now;
 const principal=actor('bob'),participation=new CommunityParticipationService(fs,{now:()=>now,...economy.participationOptions()});
 try{
  let settings=await participation.settings({principal,op:'update',requestId:'enable',expectedRevision:'missing',settings:{enabled:true,allowedTopics:['uncertainty'],allowedActions:['explore']},goals:[{id:'uncertainty',question:'Preserve uncertainty',nextCondition:'review'}]});
  const candidates=async()=>((await participation.pulse({principal})).candidates as ParticipationCandidate[]);
  const target=(await candidates())[0]!;
  const before=economyRevision(await ledger.snapshot());
  settings=await participation.record({principal,op:'start',requestId:'start',expectedRevision:settings.revision,action:'explore',target});
  settings=await participation.record({principal,op,requestId:'handled',expectedRevision:settings.revision,runId:settings.activeRun!.id});
  expect((await participation.pulse({principal})).choices).toEqual(['skip','rest']);
  expect(await candidates()).toEqual([]);expect(economyRevision(await ledger.snapshot())).toBe(before);
  settings=await participation.settings({principal,op:'update',requestId:'defer',expectedRevision:settings.revision,deferred:[{path:target.path,until:new Date(now+60_000).toISOString()}]});
  now+=31*60_000;
  expect(await candidates()).toHaveLength(1);
  let contract=(await ledger.snapshot()).contracts['quest-contract']!;
  await ledger.transact({op:'claim',actor:'bob',requestId:'explicit-claim',contractId:contract.id,expectedRevision:economyRevision(contract),expectedGeneration:contract.generation});
  contract=(await ledger.snapshot()).contracts['quest-contract']!;
  await ledger.transact({op:'submit',actor:'bob',requestId:'explicit-submit',contractId:contract.id,expectedRevision:economyRevision(contract),expectedGeneration:contract.generation,artifacts:[{path:'Knowledge/result.md',revision:'a'.repeat(64)}]});
  await expect(participation.record({principal,op:'start',requestId:'stale-start',expectedRevision:settings.revision,action:'explore',target})).rejects.toThrow(/activity revision changed/);
  await expect(participation.settings({principal,op:'update',requestId:'stale-defer',expectedRevision:settings.revision,deferred:[{path:target.path,until:new Date(now+60_000).toISOString()}]})).rejects.toThrow(/activity revision changed/);
  const changed=(await candidates())[0]!;expect(changed.revision).toBe(target.revision);expect(changed.activityRevision).not.toBe(target.activityRevision);expect(changed.reason).toMatch(/submitted result/);
  settings=await participation.record({principal,op:'start',requestId:'follow-up',expectedRevision:settings.revision,action:'explore',target:changed});
  expect(settings.activeRun!.target!.activityRevision).toBe(changed.activityRevision);
 }finally{await ledger.close();}
});

test('quest participation filters topics, project membership, same-owner claims, expired quests and hidden tasks before suggesting acceptance',async()=>{
 const {fs,ledger,service}=await fixture();const input={...context,goals:[{id:'goal',question:'uncertainty',nextCondition:'review'}],seen:[]};
 try{
  expect(await service.participationCandidates(actor('bob'),{...input,topics:['unrelated']})).toEqual([]);
  await expect(service.participationTargetSnapshot(actor('bob'),'Community/Tasks/quest.md',{...input,topics:['unrelated']})).rejects.toThrow(/unavailable/);
  const sameOwner=new EconomyService(fs,ledger,{...policy,owners:{...policy.owners,bob:'owner-a'}},{assertActor:async()=>{}});
  expect(await sameOwner.participationCandidates(actor('bob'),input)).toEqual([]);
  expect(await service.participationCandidates(actor('bob'),{...input,now:Date.parse('2028-01-01T00:00:00Z')})).toEqual([]);
  expect(await service.participationCandidates({...actor('bob'),capabilities:['profile']},input)).toEqual([]);
  const project=await fs.readNote('Community/Projects/project.md');
  await fs.writeNote({path:'Community/Projects/project.md',content:project.content,frontmatter:{...project.frontmatter,participants:['alice','carol']},expectedRevision:project.revision});
  expect(await service.participationCandidates(actor('bob'),input)).toEqual([]);
  const task=await fs.readNote('Community/Tasks/quest.md');
  await fs.writeNote({path:'Community/Tasks/quest.md',content:task.content,frontmatter:{...task.frontmatter,moderation_status:'hidden'},expectedRevision:task.revision});
  expect(await service.participationCandidates(actor('alice'),input)).toEqual([]);
  const disabled=new EconomyService(fs,ledger,{...policy,enabled:false},{assertActor:async()=>{}});
  expect(await disabled.participationOptions().economyCandidates(actor('alice'),input)).toEqual([]);
 }finally{await ledger.close();}
});

test('settled completed results prompt one explicit confirmation for requester and worker, preserving the ledger fingerprint',async()=>{
 const {fs,ledger,service:economy}=await fixture();let now=context.now;
 const participation=new CommunityParticipationService(fs,{now:()=>now,...economy.participationOptions()});
 try{
  let contract=(await ledger.snapshot()).contracts['quest-contract']!;
  await ledger.transact({op:'claim',actor:'bob',requestId:'claim',contractId:contract.id,expectedRevision:economyRevision(contract),expectedGeneration:contract.generation});
  contract=(await ledger.snapshot()).contracts['quest-contract']!;
  await ledger.transact({op:'submit',actor:'bob',requestId:'submit',contractId:contract.id,expectedRevision:economyRevision(contract),expectedGeneration:contract.generation,artifacts:[{path:'Knowledge/result.md',revision:'a'.repeat(64)}]});
  const previous=new Map<string,string>();
  for(const accountId of ['alice','bob']){
   const principal=actor(accountId);
   let settings=await participation.settings({principal,op:'update',requestId:'enable',expectedRevision:'missing',settings:{enabled:true,allowedTopics:['uncertainty'],allowedActions:['explore']}});
   const target=((await participation.pulse({principal})).candidates as ParticipationCandidate[])[0]!;
   previous.set(accountId,target.activityRevision!);
   settings=await participation.record({principal,op:'start',requestId:'read-submission',expectedRevision:settings.revision,action:'explore',target});
   await participation.record({principal,op:'finish',requestId:'seen-submission',expectedRevision:settings.revision,runId:settings.activeRun!.id});
  }
  contract=(await ledger.snapshot()).contracts['quest-contract']!;
  await ledger.transact({op:'review',actor:'carol',requestId:'approve',contractId:contract.id,expectedRevision:economyRevision(contract),expectedGeneration:contract.generation,verdict:'approve',basis:contract.submission!.basis,reason:'Verified criteria',reviewArtifact:{path:'Knowledge/review.md',revision:'b'.repeat(64)}});
  const task=await fs.readNote('Community/Tasks/quest.md');
  await fs.writeNote({path:'Community/Tasks/quest.md',content:task.content,frontmatter:{...task.frontmatter,status:'completed'},expectedRevision:task.revision});
  now+=31*60_000;const before=economyRevision(await ledger.snapshot());
  for(const accountId of ['alice','bob']){
   const principal=actor(accountId),pulse=await participation.pulse({principal});
   expect(pulse.choices).toEqual(['skip','rest']);
   const candidates=pulse.candidates as ParticipationCandidate[];expect(candidates).toHaveLength(1);
   const target=candidates[0]!;expect(target.reason).toMatch(/confirm the result and plan/i);expect(target.activityRevision).not.toBe(previous.get(accountId));
   let settings=await participation.settings({principal});
   settings=await participation.record({principal,op:'start',requestId:'confirm-result',expectedRevision:settings.revision,action:'explore',target});
   settings=await participation.record({principal,op:'finish',requestId:'confirmed-result',expectedRevision:settings.revision,runId:settings.activeRun!.id});
   const stored=await fs.readNote(settings.path);
   expect(stored.frontmatter.participation.seen.find((seen:{path:string})=>seen.path===target.path).activityRevision).toBe(target.activityRevision);
   expect((await participation.pulse({principal})).candidates).toEqual([]);
  }
  expect(economyRevision(await ledger.snapshot())).toBe(before);
  expect(await economy.participationCandidates(actor('carol'),{...context,topics:['unrelated'],goals:[],seen:[]})).toEqual([]);
 }finally{await ledger.close();}
});

test.each([{mcpvault_type:'note'},{task_id:'wrong'},{status:'cancelled'},{status:'invented'}])('quest targets reject invalid public task metadata %j',async(patch)=>{
 const {fs,ledger,service:economy}=await fixture();const principal=actor('alice');
 const participation=new CommunityParticipationService(fs,{now:()=>context.now,...economy.participationOptions()});
 try{
  const settings=await participation.settings({principal,op:'update',requestId:'enable',expectedRevision:'missing',settings:{enabled:true,allowedTopics:['uncertainty'],allowedActions:['explore']}});
  const candidate=((await participation.pulse({principal})).candidates as ParticipationCandidate[])[0]!;
  const task=await fs.readNote(candidate.path);
  const changed=await fs.writeNoteWithReceipt({path:candidate.path,content:task.content,frontmatter:{...task.frontmatter,...patch},expectedRevision:task.revision});
  expect((await participation.pulse({principal})).candidates).toEqual([]);
  await expect(participation.record({principal,op:'start',requestId:'invalid-target',expectedRevision:settings.revision,action:'explore',target:{...candidate,revision:changed.revision}})).rejects.toThrow(/Public target unavailable/);
 }finally{await ledger.close();}
});
