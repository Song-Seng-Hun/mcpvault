import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { EconomyService } from './economy-service.js';
import { EconomyLedger } from './economy-ledger.js';
import { economyRevision, type EconomyPolicy } from './economy-model.js';
import type { ScopePrincipal } from './scope-auth.js';

const roots: string[]=[];
afterEach(async()=>{ for(const root of roots.splice(0)) await rm(root,{recursive:true,force:true}); });
const p:EconomyPolicy={version:1,revision:'pilot',enabled:true,treasury:'treasury',operators:['operator'],owners:{treasury:'host',alice:'oa',bob:'ob',carol:'oc'},reviewers:['carol'],subjectiveReview:true,maxSupply:5000,minReward:10,maxReward:100,postingFee:2,reviewFee:5,dailySpend:107,dailyPosts:1,openContracts:2};
const actor=(accountId:string):ScopePrincipal=>({accountId,modelId:'codex',agentId:accountId,role:'agent',capabilities:['task','write']});
async function fixture() {
 const root=await mkdtemp(join(tmpdir(),'quest-service-'));roots.push(root);
 const vaultPath=join(root,'vault'),hostPath=join(root,'host');await mkdir(vaultPath);await mkdir(hostPath);
 const fs=new FileSystemService(vaultPath);const ledger=await EconomyLedger.initialize({vaultPath,hostPath,policy:p,storageVerified:true});
 await ledger.transact({op:'issue',actor:'operator',requestId:'supply',amount:5000,reason:'pilot'});
 await ledger.transact({op:'allocate',actor:'operator',requestId:'allocation',account:'alice',amount:200,reason:'budget'});
 await fs.writeNote({path:'Community/Projects/demo.md',content:'# Project',frontmatter:{mcpvault_type:'work_project',project_id:'demo',participants:['alice','bob','carol']}});
 await fs.writeNote({path:'Community/Tasks/task.md',content:'# Task',frontmatter:{mcpvault_type:'agent_task',task_id:'task',project_id:'demo',status:'proposed',requester_account_id:'alice',claim_generation:0,completion_criteria:['Review uncertainty']}});
 const task=await fs.readNote('Community/Tasks/task.md');
 const service=new EconomyService(fs,ledger,p,{assertActor:async()=>{}});
 return {fs,ledger,service,task};
}
test('wallet is personal and raw journal is excluded from all note paths',async()=>{
 const {service,fs,ledger}=await fixture();
 try {
  expect(await service.wallet(actor('alice'),{})).toMatchObject({availableXp:200,escrowXp:0});
  expect((await service.wallet(actor('alice'),{})).items).toContainEqual(expect.objectContaining({kind:'transaction',availableChange:200}));
  expect(JSON.stringify(await service.wallet(actor('bob'),{}))).not.toContain('alice');
  await expect(service.wallet(actor('unapproved'),{})).rejects.toThrow(/approved/);
  await expect(fs.readNote('.mcpvault-economy/journal/0000000001.md')).rejects.toThrow();
  await expect(fs.writeNote({path:'.mcpvault-economy/journal/fake.md',content:'mint'})).rejects.toThrow();
 } finally {await ledger.close();}
});
test('draft remains private, market is bounded, and funded task cannot use free mutations',async()=>{
 const {service,ledger,task}=await fixture();
 try {
  const draft=await service.contract(actor('alice'),{op:'draft',requestId:'draft',contractId:'q',expectedRevision:'missing',terms:{taskId:'task',taskRevision:task.revision,title:'Review',criteria:['Keep uncertainty'],exclusions:[],kind:'research',reward:100,deadline:'2027-01-01T00:00:00.000Z',verifier:'independent-review-v1'}});
  expect((await service.market(actor('bob'),{})).items).toHaveLength(0);
  expect((await service.freeTaskMutations(['task'])).task).toEqual({ state:'allowed', freeMutationBlocked:false });
  await service.contract(actor('alice'),{op:'fund',requestId:'fund',contractId:'q',expectedRevision:draft.revision});
  expect((await service.market(actor('bob'),{maxChars:4000})).items).toHaveLength(1);
  await expect(service.assertFreeTaskMutation('task')).rejects.toThrow(/quest/);
  expect(await service.workProjection(actor('unapproved'),['task'])).toEqual({});
  expect(await service.freeTaskMutations(['task','free'])).toEqual({
    task:{state:'managed',freeMutationBlocked:true}, free:{state:'allowed',freeMutationBlocked:false},
  });
  await expect(service.contract(actor('alice'),{op:'issue',requestId:'mint',amount:1} as any)).rejects.toThrow(/host|operation/);
  const state=await ledger.snapshot();expect(economyRevision(state.contracts.q)).toBeDefined();
 } finally {await ledger.close();}
});

test('unavailable ledger produces only fail-closed task eligibility and sanitized guard errors',async()=>{
 const {service,ledger}=await fixture();
 try {
  const spy=vi.spyOn(ledger,'snapshot').mockRejectedValue(new Error('private-host-path/secret-ledger'));
  expect(await service.freeTaskMutations(['task'])).toEqual({task:{state:'unavailable',freeMutationBlocked:true}});
  await expect(service.assertFreeTaskMutation('task')).rejects.toThrow('Task management state unavailable');
  spy.mockRestore();
 } finally{await ledger.close();}
});

test('a captured contract cannot disclose its private replacement through market or review',async()=>{
 const {service,ledger,task,fs}=await fixture();
 try {
  const draft=await service.contract(actor('alice'),{op:'draft',requestId:'draft',contractId:'q',expectedRevision:'missing',terms:{taskId:'task',taskRevision:task.revision,title:'Review',criteria:['Keep uncertainty'],exclusions:[],kind:'research',reward:100,deadline:'2027-01-01T00:00:00.000Z',verifier:'independent-review-v1'}});
  await service.contract(actor('alice'),{op:'fund',requestId:'fund',contractId:'q',expectedRevision:draft.revision});
  const before=await fs.readNote('Community/Tasks/task.md');
  await fs.writeNote({path:'Community/Tasks/task.md',content:before.content,frontmatter:{...before.frontmatter,moderation_status:'hidden'},expectedRevision:before.revision});
  const result=await service.market(actor('bob'),{});
  expect(result.items).toHaveLength(0);expect(JSON.stringify(result)).not.toContain('Review');
 } finally {await ledger.close();}
});

test.each(['later-task', 'final-actor'] as const)('market rejects previously gathered task/project rows hidden during %s', async boundary => {
 for (const target of ['Community/Tasks/task.md', 'Community/Projects/demo.md']) {
  const f = await fixture();
  try {
   await f.fs.writeNote({path:'Community/Tasks/second.md',content:'Second',frontmatter:{...f.task.frontmatter,task_id:'second'}});
   const extra = await f.fs.readNote('Community/Tasks/second.md');
   for (const [taskId, revision] of [['task',f.task.revision],['second',extra.revision]]) await f.service.contract(actor('alice'),{
    op:'draft',requestId:`draft-${taskId}`,contractId:taskId,expectedRevision:'missing',terms:{taskId,taskRevision:revision,title:`PRIVATE_TITLE_${taskId}`,criteria:['Check'],exclusions:[],kind:'research',reward:10,deadline:'2027-01-01T00:00:00.000Z',verifier:'independent-review-v1'}} as any);
   const original = f.fs.readNote.bind(f.fs); let hidden = false, actorChecks = 0;
   const hide = async () => { if (hidden) return; hidden = true; const n = await original(target); await f.fs.writeNote({path:target,content:n.content,frontmatter:{...n.frontmatter,moderation_status:'hidden'},expectedRevision:n.revision}); };
   const spy = vi.spyOn(f.fs,'readNote').mockImplementation(async (...args) => {
    const n = await original(...args); if (boundary === 'later-task' && args[0] === 'Community/Tasks/second.md') await hide(); return n;
   });
   const service = new EconomyService(f.fs,f.ledger,p,{assertActor:async()=>{ if (boundary === 'final-actor' && ++actorChecks === 2) await hide(); }});
   await expect(service.market(actor('alice'),{limit:1})).rejects.toThrow(/unavailable|changed/i);
   expect(hidden).toBe(true); spy.mockRestore();
  } finally {await f.ledger.close();}
 }
});

test('market reauthenticates after dependency rereads and ignores writes to skipped hidden tasks',async()=>{
 const f=await fixture();
 try {
  await f.fs.writeNote({path:'Community/Tasks/second.md',content:'Second',frontmatter:{...f.task.frontmatter,task_id:'second'}});
  const second=await f.fs.readNote('Community/Tasks/second.md');
  for(const [taskId,revision] of [['task',f.task.revision],['second',second.revision]])await f.service.contract(actor('alice'),{op:'draft',requestId:`draft-${taskId}`,contractId:taskId,expectedRevision:'missing',terms:{taskId,taskRevision:revision,title:`TITLE_${taskId}`,criteria:['Check'],exclusions:[],kind:'research',reward:10,deadline:'2027-01-01T00:00:00.000Z',verifier:'independent-review-v1'}} as any);
  const original=f.fs.readNote.bind(f.fs);let taskReads=0,revoked=false;
  const spy=vi.spyOn(f.fs,'readNote').mockImplementation(async(...args)=>{const n=await original(...args);if(args[0]==='Community/Tasks/task.md'&&++taskReads===2)revoked=true;return n;});
  const service=new EconomyService(f.fs,f.ledger,p,{assertActor:async()=>{if(revoked)throw Error('Revoked after dependency read');}});
  await expect(service.market(actor('alice'),{})).rejects.toThrow(/revoked/i); spy.mockRestore();
  const hidden=await original('Community/Tasks/task.md');await f.fs.writeNote({path:'Community/Tasks/task.md',content:hidden.content,frontmatter:{...hidden.frontmatter,moderation_status:'hidden'}});
  let changed=false;
  vi.spyOn(f.fs,'readNote').mockImplementation(async(...args)=>{const n=await original(...args);if(args[0]==='Community/Tasks/second.md'&&!changed){changed=true;await f.fs.writeNote({path:'Community/Tasks/task.md',content:'Changed still hidden',frontmatter:{...hidden.frontmatter,moderation_status:'hidden'}});}return n;});
  const result=await f.service.market(actor('alice'),{});expect(result.total).toBe(1);expect(result.items[0].contractId).toBe('second');
 }finally{await f.ledger.close();}
});

test('paid bridge leases do not cross ledgers or survive the awaited bridge',async()=>{
 const first=await fixture(),second=await fixture();
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 let delayed:Promise<string>|undefined;
 const fund=async(f:Awaited<ReturnType<typeof fixture>>)=>{
  const d=await f.service.contract(actor('alice'),{op:'draft',requestId:'draft',contractId:'q',expectedRevision:'missing',terms:{taskId:'task',taskRevision:f.task.revision,title:'Review',criteria:['Keep uncertainty'],exclusions:[],kind:'research',reward:100,deadline:'2027-01-01T00:00:00.000Z',verifier:'independent-review-v1'}});
  return f.service.contract(actor('alice'),{op:'fund',requestId:'fund',contractId:'q',expectedRevision:d.revision});
 };
 try {
  const funded=await fund(first);await fund(second);
  const service=new EconomyService(first.fs,first.ledger,p,{assertActor:async()=>{},claimTask:async()=>{
    await first.service.assertFreeTaskMutation('task');
    await expect(second.service.assertFreeTaskMutation('task')).rejects.toThrow(/quest/);
    delayed=gate.then(()=>first.service.assertFreeTaskMutation('task')).then(()=> 'bypassed',()=> 'denied');
    const before=await first.fs.readNote('Community/Tasks/task.md');
    await first.fs.writeNote({path:'Community/Tasks/task.md',content:before.content,frontmatter:{...before.frontmatter,assignee_account_id:'bob',claim_generation:1,status:'in_progress'},expectedRevision:before.revision});
    const after=await first.fs.readNote('Community/Tasks/task.md');
    return {revision:after.revision,generation:1,requestId:'bridge'};
  }});
  await service.contract(actor('bob'),{op:'claim',requestId:'claim',contractId:'q',expectedRevision:funded.revision,expectedGeneration:0});
  release();expect(await delayed).toBe('denied');
 } finally {release();await first.ledger.close();await second.ledger.close();}
});

test('a Work claim committed before failed ledger authorization cannot be refunded as unclaimed',async()=>{
 const f=await fixture();let rejectAfterBridge=false;
 try {
  const draft=await f.service.contract(actor('alice'),{op:'draft',requestId:'draft',contractId:'q',expectedRevision:'missing',terms:{taskId:'task',taskRevision:f.task.revision,title:'Review',criteria:['Keep uncertainty'],exclusions:[],kind:'research',reward:100,deadline:'2027-01-01T00:00:00.000Z',verifier:'independent-review-v1'}});
  const funded=await f.service.contract(actor('alice'),{op:'fund',requestId:'fund',contractId:'q',expectedRevision:draft.revision});
  const claimant=new EconomyService(f.fs,f.ledger,p,{assertActor:async()=>{if(rejectAfterBridge)throw new Error('revoked');},claimTask:async()=>{
    const before=await f.fs.readNote('Community/Tasks/task.md');
    await f.fs.writeNote({path:'Community/Tasks/task.md',content:before.content,frontmatter:{...before.frontmatter,assignee_account_id:'bob',claim_generation:1,status:'in_progress'},expectedRevision:before.revision});
    rejectAfterBridge=true;return {revision:(await f.fs.readNote('Community/Tasks/task.md')).revision,generation:1,requestId:'bridge'};
  }});
  await expect(claimant.contract(actor('bob'),{op:'claim',requestId:'claim',contractId:'q',expectedRevision:funded.revision,expectedGeneration:0})).rejects.toThrow('revoked');
  await expect(f.service.contract(actor('alice'),{op:'cancel',requestId:'cancel',contractId:'q',expectedRevision:funded.revision})).rejects.toThrow(/reconciliation|Work/);
  expect((await f.ledger.snapshot()).contracts.q!.escrow).toBe(105);
 } finally{await f.ledger.close();}
});
