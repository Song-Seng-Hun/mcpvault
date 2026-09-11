import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileSystemService} from './filesystem.js';
import {BenchmarkService,type BenchmarkOptions} from './benchmark-service.js';
import {createBenchmarkIntegrity} from './benchmark-host.js';
import type {BenchmarkDefinition,BenchmarkProfile,BenchmarkGrader} from './benchmark-model.js';
import type {ScopePrincipal} from './scope-auth.js';
import {EconomyLedger} from './economy-ledger.js';
import type {EconomyPolicy} from './economy-model.js';
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const p of roots.splice(0))await rm(p,{recursive:true,force:true});});
const principal=(accountId:string):ScopePrincipal=>({accountId,modelId:'untrusted-session-label',role:'agent'});
async function fixture(mode:'objective'|'peer'='objective') {
 const root=await mkdtemp(join(tmpdir(),'benchmark-service-'));roots.push(root);const vault=join(root,'vault');await mkdir(vault);const fs=new FileSystemService(vault);
 await fs.writeNote({path:'Evidence.md',content:'Authoritative source',expectedRevision:'missing'});const evidence=await fs.readNote('Evidence.md');
 const profiles:Record<string,BenchmarkProfile>=Object.fromEntries(['alice','bob','r1','r2','r3'].map((a,i)=>[a,{accountId:a,ownerId:'same-human',modelFamily:`family-${i}`,approved:true,modelVerified:true}]));profiles.alias={...profiles.alice!};
 const d:BenchmarkDefinition={id:'challenge',lineage:'problem',version:'v1',title:'Question',problem:'Solve it',sources:[{path:'Evidence.md',revision:evidence.revision!}],rubric:[{id:'correct',description:'Correct answer',minimum:60}],deadline:'2026-10-01T00:00:00.000Z',allowedTools:[],mode,answerKnown:mode==='objective',...(mode==='objective'&&{grader:{kind:'exact' as const}}),reward:0,maxWinners:1,cap:0,qualityThreshold:60,participants:['alice','bob'],reviewers:['r1','r2','r3'],allowSameOwnerReview:true};
 let now=new Date('2026-09-11T00:00:00Z'),answer='HOST-SECRET';let revoked=false;
 const options:BenchmarkOptions={enabled:true,definitions:[d],accountProfiles:async()=>structuredClone(profiles),accountAvailable:async()=>!revoked,answerReader:async()=>answer,integrity:createBenchmarkIntegrity(Buffer.alloc(32,9)),assertActor:async(p)=>{if(revoked)throw Error('Revoked');return p;},assertHumanOperator:async(a)=>{if(a!=='operator')throw Error('Human operator required');},now:()=>now};
 const service=new BenchmarkService(fs,options);
 const read=(s=service,field='status',actor='alice')=>s.execute('read',{challengeId:'challenge',field,maxChars:12000},principal(actor));
 const update=async(op:string,extra:Record<string,unknown>={},actor='alice',s=service)=>{const current=await read(s);return s.execute(op,{challengeId:'challenge',expectedRevision:current.revision,requestId:`${op}-${actor}`,maxChars:12000,...extra},principal(actor));};
 return {root,vault,fs,profiles,d,options,service,read,update,late:()=>{now=new Date('2026-10-02T00:00:00Z');},setAnswer:(v:string)=>{answer=v;},revoke:()=>{revoked=true;},open:()=>service.open('challenge','operator',{expectedRevision:'missing',requestId:'open'})};
}
test('only an opted-in human host can open and definitions cannot drift in place',async()=>{
 const f=await fixture();await expect(f.service.open('challenge','alice',{expectedRevision:'missing',requestId:'open'})).rejects.toThrow(/Human/);
 await f.open();const changed=new BenchmarkService(f.fs,{...f.options,definitions:[{...f.d,problem:'Changed'}]});await expect(f.read(changed)).rejects.toThrow(/immutable|changed/);
 await expect(new BenchmarkService(f.fs,{...f.options,enabled:false}).execute('list',{},principal('alice'))).rejects.toThrow(/disabled/i);
});

test('host initiative absence is global, never participant visibility, disabled state or pending approval', async () => {
 const f=await fixture();
 expect((f.service as any).initiativeStatus).toBeTypeOf('function');
 expect((f.service as any).runInitiative).toBeTypeOf('function');
 expect(await (f.service as any).runInitiative('operator','session_start')).toMatchObject({state:'host_capability_missing'});
 await expect((f.service as any).initiativeStatus('alice')).rejects.toThrow(/Human/);
 expect(await (f.service as any).initiativeStatus('operator')).toMatchObject({state:'pending_approval'});
 const empty=new BenchmarkService(f.fs,{...f.options,definitions:[]});
 expect(await (empty as any).initiativeStatus('operator')).toMatchObject({state:'empty'});
 expect(await (new BenchmarkService(f.fs,{...f.options,enabled:false}) as any).initiativeStatus('operator')).toMatchObject({state:'disabled'});
 await f.open();
 // A requester outside all pools still cannot turn a globally active challenge into absence.
 expect(await (f.service as any).initiativeStatus('operator')).toMatchObject({state:'active'});
 expect(await (empty as any).initiativeStatus('operator')).toMatchObject({state:'unknown'});
 await f.update('submit',{answer:'HOST-SECRET'}); f.late();
 expect(await (f.service as any).initiativeStatus('operator')).toMatchObject({state:'active'});
 await f.update('finalize');
 expect(await (f.service as any).initiativeStatus('operator')).toMatchObject({state:'empty'});
 expect(JSON.stringify(await (f.service as any).initiativeStatus('operator'))).not.toMatch(/HOST-SECRET|alice|entries|_whispers/);
 const original=f.fs.readNoteRevision.bind(f.fs);let changed=false;
 vi.spyOn(f.fs,'readNoteRevision').mockImplementation(async(path,...args)=>{
  if(path.startsWith('_whispers/benchmarks/')&&!changed){changed=true;const source=await f.fs.readNote('Evidence.md');await f.fs.writeNote({path:'Evidence.md',content:'Changed basis',expectedRevision:source.revision});}
  return original(path,...args);
 });
 expect(await f.service.initiativeStatus('operator')).toMatchObject({state:'unknown'});
});

test('collector and attested same-owner accounts cannot enter or review a selected problem lineage', async () => {
 const f=await fixture('peer');
 const d={...f.d,collectorAccounts:['r3'],collectorOwnerIds:['same-human']};
 let service:BenchmarkService;
 try { service=new BenchmarkService(f.fs,{...f.options,definitions:[d]}); }
 catch (error) { throw Error(`Collector provenance must be accepted before eligibility is checked: ${error}`); }
 await expect(service.open(d.id,'operator',{expectedRevision:'missing',requestId:'open-collected'})).rejects.toThrow(/collector|owner/i);
 // A separate collector owner does not block unrelated participants/reviewers.
 f.profiles.collector={accountId:'collector',ownerId:'collector-human',modelFamily:'collector-family',approved:true,modelVerified:true};
 const separate={...f.d,collectorAccounts:['collector'],collectorOwnerIds:['collector-human']};
 service=new BenchmarkService(f.fs,{...f.options,definitions:[separate]});
 await expect(service.open(separate.id,'operator',{expectedRevision:'missing',requestId:'open-separate'})).resolves.toMatchObject({state:'open'});
 expect(JSON.stringify(await f.read(service,'definition'))).not.toMatch(/collector-human|collectorAccounts|collectorOwnerIds/);
 const revision=(await f.read(service)).revision;
 // Dropping collector metadata in a later version cannot discard lineage exclusions.
 const next={...f.d,id:'collected-v2',version:'v2',participants:['collector']};
 const restarted=new BenchmarkService(f.fs,{...f.options,definitions:[separate,next]});
 await expect(restarted.open(next.id,'operator',{expectedRevision:revision,requestId:'open-v2'})).rejects.toThrow(/collector|owner/i);
});

test('host initiative does not mistake an omitted retained active version for global absence', async () => {
 const f=await fixture();await f.open();
 const next={...f.d,id:'next',version:'v2'};
 const both=new BenchmarkService(f.fs,{...f.options,definitions:[f.d,next]});
 await both.open('next','operator',{expectedRevision:(await f.read()).revision,requestId:'open-next'});
 await both.execute('submit',{challengeId:'next',expectedRevision:(await f.read(both)).revision,requestId:'submit-next',answer:'HOST-SECRET'},principal('alice'));
 f.late();
 await both.execute('finalize',{challengeId:'next',expectedRevision:(await f.read(both)).revision,requestId:'finalize-next'},principal('alice'));
 const omitted=new BenchmarkService(f.fs,{...f.options,definitions:[next]});
 expect(await omitted.initiativeStatus('operator')).toMatchObject({state:'unknown'});
});

test('new collector provenance cannot overlap omitted retained participant or reviewer pools', async () => {
 const f=await fixture();await f.open();
 f.profiles.separate={accountId:'separate',ownerId:'separate-owner',modelFamily:'separate-family',approved:true,modelVerified:true};
 const next={...f.d,id:'collected-next',version:'v2',participants:['separate'],reviewers:[],collectorAccounts:['bob'],collectorOwnerIds:['same-human']};
 const service=new BenchmarkService(f.fs,{...f.options,definitions:[next]});
 await expect(service.open(next.id,'operator',{expectedRevision:(await f.read()).revision,requestId:'reverse-lineage'})).rejects.toThrow(/collector|owner/i);
 const note=await f.fs.readNote('_whispers/benchmarks/problem.md');
 expect(note.frontmatter.benchmark.versions).toHaveLength(1);
});

test.each(['direct','same-owner','missing-profile'] as const)('retained collector exclusion independently protects %s', async kind => {
 const f=await fixture();
 const older={...f.d,participants:[kind==='direct'?'bob':'alice'],reviewers:[]};
 const initial=new BenchmarkService(f.fs,{...f.options,definitions:[older]});
 await initial.open(older.id,'operator',{expectedRevision:'missing',requestId:'isolated-pool'});
 f.profiles.separate={accountId:'separate',ownerId:'separate-owner',modelFamily:'separate-family',approved:true,modelVerified:true};
 f.profiles.collector={accountId:'collector',ownerId:kind==='same-owner'?'same-human':'collector-owner',modelFamily:'collector-family',approved:true,modelVerified:true};
 if(kind==='missing-profile')delete f.profiles.alice;
 // No aliases of a removed profile remain; this failure concerns the retained pool.
 if(kind==='missing-profile')delete f.profiles.alias;
 const collector=kind==='direct'?'bob':'collector';
 const next={...f.d,id:'separate-next',version:'v2',participants:['separate'],reviewers:[],collectorAccounts:[collector],collectorOwnerIds:[f.profiles[collector]!.ownerId]};
 const service=new BenchmarkService(f.fs,{...f.options,definitions:[next]});
 const failure=kind==='direct'?/collector account cannot/i:kind==='same-owner'?/collector owner cannot/i:/owner binding unavailable/i;
 await expect(service.open(next.id,'operator',{expectedRevision:(await f.fs.readNote('_whispers/benchmarks/problem.md')).revision,requestId:'isolated-exclusion'})).rejects.toThrow(failure);
 expect((await f.fs.readNote('_whispers/benchmarks/problem.md')).frontmatter.benchmark.versions).toHaveLength(1);
});

test('global absence rejects conflicting source pins across versions changed by a separate filesystem writer', async () => {
 const f=await fixture();await f.open();await f.update('submit',{answer:'HOST-SECRET'});f.late();await f.update('finalize');
 const first=await f.fs.readNote('Evidence.md');
 const external=new FileSystemService(f.vault);
 await external.writeNote({path:'Evidence.md',content:'Second revision',expectedRevision:first.revision});
 const second=await external.readNote('Evidence.md');
 let now=new Date('2026-10-02T00:00:00Z');
 const next={...f.d,id:'next-pinned',version:'v2',deadline:'2026-10-03T00:00:00.000Z',sources:[{path:'Evidence.md',revision:second.revision}]};
 const service=new BenchmarkService(f.fs,{...f.options,definitions:[f.d,next],now:()=>now});
 await service.open(next.id,'operator',{expectedRevision:(await f.fs.readNote('_whispers/benchmarks/problem.md')).revision,requestId:'open-next-pinned'});
 now=new Date('2026-10-04T00:00:00Z');
 await service.execute('finalize',{challengeId:next.id,expectedRevision:(await f.fs.readNote('_whispers/benchmarks/problem.md')).revision,requestId:'empty-next-pinned'},principal('alice'));
 await external.writeNote({path:'Evidence.md',content:first.content,frontmatter:first.frontmatter,expectedRevision:second.revision});
 expect((await external.readNote('Evidence.md')).revision).toBe(first.revision);
 const read=f.fs.readNote.bind(f.fs);let raced=false;
 vi.spyOn(f.fs,'readNote').mockImplementation(async(path,...args)=>{
  const note=await read(path,...args);
  if(path==='Evidence.md'&&!raced){raced=true;await external.writeNote({path,content:second.content,frontmatter:second.frontmatter,expectedRevision:first.revision});}
  return note;
 });
 expect(await service.initiativeStatus('operator')).toMatchObject({state:'unknown'});
 expect(raced).toBe(true);
});

test('human selects exact decided result fields as sanitized Wiki evidence without sealed material',async()=>{
 const f=await fixture();await f.open();await f.update('submit',{answer:'HOST-SECRET'});f.late();await f.update('finalize');
 const results=await f.read(f.service,'results'),entryId=results.items[0].entryId;
 const params={challengeId:'challenge',entryId,fields:['outcome','scores'],shareable:true,expectedRevision:results.revision,expectedProjectionRevision:'missing',requestId:'result-evidence'};
 await expect(f.service.executeHost('evidence' as any,{...params,shareable:false},'operator')).rejects.toThrow(/shareable|approval/i);
 await expect(f.service.executeHost('evidence' as any,params,'alice')).rejects.toThrow(/Human/i);
 const exported=await f.service.executeHost('evidence' as any,params,'operator');
 const note=await f.fs.readNote(exported.path),serialized=JSON.stringify(note);
 expect(note.frontmatter.benchmark_result).toEqual({outcome:'pass',scores:[100]});
 expect(note.frontmatter.benchmark_result_revision).toBe(results.revision);
 expect(serialized).not.toMatch(/HOST-SECRET|alice|same-human|family-0|_whispers|answer/i);
 expect(exported.nextAction).toMatchObject({endpointId:'skill.experience',requiredArguments:expect.arrayContaining(['skillId','usedVersion','applied','shareable'])});
 expect((await f.service.executeHost('evidence' as any,params,'operator')).revision).toBe(exported.revision);
 await expect(f.service.executeHost('evidence' as any,{...params,fields:['answer']},'operator')).rejects.toThrow(/fields/i);
 await expect(f.service.executeHost('evidence' as any,{...params,expectedRevision:'0'.repeat(64)},'operator')).rejects.toThrow(/revision/i);
 expect((await f.read()).revision).toBe(results.revision);
 await f.fs.writeNote({path:exported.path,content:note.content,frontmatter:{...note.frontmatter,benchmark_result:{outcome:'fail'}},expectedRevision:note.revision});
 await expect(f.service.executeHost('evidence' as any,params,'operator')).rejects.toThrow(/changed|review/i);
});
test('backend account revocation invalidates authority independently of still-approved host profiles',async()=>{
 const f=await fixture('peer');await f.open();await f.update('submit',{answer:'candidate'});await f.update('submit',{answer:'another'},'bob');f.late();
 const entries=await f.read(f.service,'entries','r1');for(const [i,e]of entries.items.entries())for(const a of ['r1','r2'])await f.update('review',{requestId:`${a}-${i}`,review:review(e.entryId,f.d.sources)},a);
 f.options.accountAvailable=async account=>account!=='r2';
 expect(await f.read()).toMatchObject({freshness:'unavailable_or_changed'});await expect(f.update('finalize')).rejects.toThrow(/profile|account|available/i);
});
test('sealed final submission is once per canonical account/lineage across aliases, sessions, versions and restarts',async()=>{
 const f=await fixture();await f.open();const current=await f.read();const p={challengeId:'challenge',expectedRevision:current.revision,requestId:'final',answer:'HOST-SECRET'};
 const first=await f.service.execute('submit',p,principal('alice'));expect(first).not.toHaveProperty('grade');expect(JSON.stringify(first)).not.toContain('HOST-SECRET');
 const restarted=new BenchmarkService(f.fs,f.options);expect(await restarted.execute('submit',p,{...principal('alias'),sessionId:'new'})).toMatchObject({replay:true});
 await expect(f.update('submit',{answer:'second',requestId:'second'},'alias',restarted)).rejects.toThrow(/sealed|once/i);
 const v2={...f.d,id:'second',version:'v2'},second=new BenchmarkService(f.fs,{...f.options,definitions:[f.d,v2]});const r=await f.read();await second.open('second','operator',{expectedRevision:r.revision,requestId:'open-second'});
 const rr=await second.execute('read',{challengeId:'second'},principal('alice'));await expect(second.execute('submit',{challengeId:'second',expectedRevision:rr.revision,requestId:'other-version',answer:'answer'},principal('alias'))).rejects.toThrow(/sealed|once/);
});
test('practice never grades the hidden answer, seals a reward slot or issues XP',async()=>{
 const f=await fixture();await f.open();const answer=vi.spyOn(f.options,'answerReader');const r=await f.update('submit',{answer:'practice',practice:true});expect(r).toMatchObject({practice:true,rewardEligible:false});expect(answer).not.toHaveBeenCalled();await f.update('submit',{answer:'HOST-SECRET',requestId:'real'});
});
test('CAS, request binding and late actor revocation protect private writes',async()=>{
 const f=await fixture();await f.open();const current=await f.read();
 const submissions=await Promise.allSettled(['alice','bob'].map(a=>f.service.execute('submit',{challengeId:'challenge',expectedRevision:current.revision,requestId:a,answer:'answer'},principal(a))));expect(submissions.filter(s=>s.status==='fulfilled')).toHaveLength(1);
 const original=f.fs.writeNoteWithRevisionGuardsAndReceipt.bind(f.fs);vi.spyOn(f.fs,'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async(...args)=>{f.revoke();return original(...args);});
 await expect(f.update('submit',{answer:'late'},'bob')).rejects.toThrow(/unavailable|actor|Revoked/);
});
test('hidden answer failure is indeterminate and public reads never contain answer material',async()=>{
 const f=await fixture();await f.open();await f.update('submit',{answer:'HOST-SECRET'});f.late();f.setAnswer('x'.repeat(20000));
 expect(await f.update('finalize')).toMatchObject({state:'held'});const publicRead=JSON.stringify(await f.read(f.service,'definition','bob'));expect(publicRead).not.toContain('HOST-SECRET');expect(publicRead).not.toContain('xxxx');
});
test('objective finalization is deterministic and current-source drift invalidates projections and payment proofs',async()=>{
 const f=await fixture();await f.open();await f.update('submit',{answer:'HOST-SECRET'});await f.update('submit',{answer:'HOST-SECRET'},'bob');f.late();const final=await f.update('finalize');expect(final).toMatchObject({state:'decided'});
 const projection=await f.read();expect(projection).toMatchObject({freshness:'current',winnerCount:1});
 const evidence=await f.fs.readNote('Evidence.md');await f.fs.writeNote({path:'Evidence.md',content:'changed',expectedRevision:evidence.revision});expect(await f.read()).toMatchObject({freshness:'unavailable_or_changed'});
 await expect(f.update('finalize',{requestId:'retry'})).rejects.toThrow(/source|current|unavailable/i);
});
const review=(entryId:string,source:BenchmarkDefinition['sources'],score=90,evidence='supported',resolutionOf:string[]=[])=>({entryId,criteria:[{criterion:'correct',score,reason:'Compared exact source',sources:source,uncertainty:'Bounded source',evidence}],resolutionOf});
test('peer review hides authors and other scores, needs two verified families and two comparable entries',async()=>{
 const f=await fixture('peer');await f.open();await f.update('submit',{answer:'first candidate'});f.late();
 const entries=await f.read(f.service,'entries','r1');expect(entries.items).toHaveLength(1);const entry=entries.items[0].entryId;expect(JSON.stringify(entries)).not.toMatch(/alice|same-human|family-0/);
 await f.update('review',{review:review(entry,f.d.sources)},'r1');const hidden=await f.read(f.service,'reviews','r2');expect(hidden.items).toHaveLength(0);
 await f.update('review',{review:review(entry,f.d.sources)},'r2');expect(await f.update('finalize')).toMatchObject({state:'held'});
});
test('peer pass/fail conflicts hold payment until an extra family resolves the exact locked reviews',async()=>{
 const f=await fixture('peer');await f.open();await f.update('submit',{answer:'first candidate'});await f.update('submit',{answer:'second candidate'},'bob');f.late();
 const entries=await f.read(f.service,'entries','r1');
 for(const [i,e]of entries.items.entries())for(const a of ['r1','r2'])await f.update('review',{requestId:`${a}-${i}`,review:review(e.entryId,f.d.sources,a==='r2'&&i===0?10:90,a==='r2'&&i===0?'contradicted':'supported')},a);
 expect(await f.update('finalize')).toMatchObject({state:'held'});
 const locked=await f.read(f.service,'conflicts','r3');const conflict=locked.items[0];expect(JSON.stringify(locked)).not.toMatch(/alice|bob|same-human/);
 await f.update('review',{review:review(conflict.entryId,f.d.sources,95,'supported',conflict.reviewIds)},'r3');expect(await f.update('finalize',{requestId:'resolved'})).toMatchObject({state:'decided'});
});
test('signed private records cannot be edited to inject a winner',async()=>{
 const f=await fixture();await f.open();const note=await f.fs.readNote('_whispers/benchmarks/problem.md');const record=note.frontmatter.benchmark as any;record.sequence=999;
 await f.fs.writeNote({path:'_whispers/benchmarks/problem.md',content:note.content,frontmatter:note.frontmatter,expectedRevision:note.revision});await expect(f.read()).rejects.toThrow(/integrity|unavailable/i);
});
test('bounded paging and path/scope filtering do not disclose hidden sources or unauthorized entries',async()=>{
 const f=await fixture();await f.open();await expect(f.service.execute('read',{challengeId:'../secret'},principal('alice'))).rejects.toThrow();
 const source=await f.fs.readNote('Evidence.md');await f.fs.writeNote({path:'Evidence.md',content:source.content,frontmatter:{moderation_status:'hidden'},expectedRevision:source.revision});
 expect(await f.service.execute('list',{},principal('alice'))).toMatchObject({items:[]});expect(JSON.stringify(await f.read())).not.toContain('Evidence.md');
});
test('mint uses the same canonical ledger with current private adjudication revalidation and crash-safe retries',async()=>{
 const f=await fixture();f.d.reward=10;f.d.cap=10;const host=join(f.root,'host');await mkdir(host);
 let service!:BenchmarkService;
 const program=BenchmarkService.issuanceProgram(f.d);
 const policy:EconomyPolicy={version:1,revision:'approved-test-only',enabled:true,treasury:'treasury',operators:['operator'],owners:{treasury:'host',alice:'same',bob:'same'},reviewers:[],subjectiveReview:false,maxSupply:10,minReward:1,maxReward:10,postingFee:0,reviewFee:0,dailySpend:10,dailyPosts:1,openContracts:1,benchmarkPrograms:[program]};
 const ledger=await EconomyLedger.initialize({vaultPath:f.vault,hostPath:host,policy,storageVerified:true,now:()=>new Date('2026-09-11T00:00:00Z'),benchmarkAuthority:{assertHumanOperator:f.options.assertHumanOperator,validateAward:(proof,state)=>service.validateAwardProof(proof,state)}});
 service=new BenchmarkService(f.fs,{...f.options,definitions:[f.d],ledger});
 try{await service.open('challenge','operator',{expectedRevision:'missing',requestId:'open'});await f.update('submit',{answer:'HOST-SECRET'},'alice',service);f.late();await f.update('finalize',{},'alice',service);expect((await ledger.snapshot()).balances.alice).toBe(10);
 await f.update('finalize',{requestId:'retry'},'bob',service);expect((await ledger.snapshot()).issued).toBe(10);
 }finally{await ledger.close();}
});

async function paidPrecisionFixture(grader:BenchmarkGrader,answer:string,maxWinners=1) {
 const f=await fixture();f.d.grader=grader;f.d.reward=10;f.d.maxWinners=maxWinners;f.d.cap=10*maxWinners;f.setAnswer(answer);
 const host=join(f.root,'precision-host');await mkdir(host);let service!:BenchmarkService;
 const policy:EconomyPolicy={version:1,revision:'precision-regression-test-only',enabled:true,treasury:'treasury',operators:['operator'],owners:{treasury:'host',alice:'same',bob:'same'},reviewers:[],subjectiveReview:false,maxSupply:10*maxWinners,minReward:1,maxReward:10,postingFee:0,reviewFee:0,dailySpend:10,dailyPosts:1,openContracts:1,benchmarkPrograms:[BenchmarkService.issuanceProgram(f.d)]};
 const ledger=await EconomyLedger.initialize({vaultPath:f.vault,hostPath:host,policy,storageVerified:true,now:f.options.now!,benchmarkAuthority:{assertHumanOperator:f.options.assertHumanOperator,validateAward:(proof,state)=>service.validateAwardProof(proof,state)}});
 service=new BenchmarkService(f.fs,{...f.options,definitions:[f.d],ledger});
 return {...f,service,ledger};
}

test.each(['objective','peer'] as const)('normal close requires a durable decision even for zero-reward %s challenges', async mode => {
 const f=await fixture(mode); await f.open(); f.late();
 const before=await f.read();
 await expect(f.service.executeHost('close',{challengeId:'challenge',expectedRevision:before.revision,requestId:'close'},'operator')).rejects.toThrow(/decision|settlement/i);
 if(mode==='objective'){
  const finalized=await f.service.executeHost('finalize',{challengeId:'challenge',expectedRevision:before.revision,requestId:'final'},'operator');
  expect(await f.service.executeHost('close',{challengeId:'challenge',expectedRevision:finalized.revision,requestId:'close'},'operator')).toMatchObject({reservation:'closed',state:'decided'});
 }
});

test.each(['resume','cancel'] as const)('partial winner payment cannot be normally closed; %s preserves issued XP', async terminal => {
 const f=await paidPrecisionFixture({kind:'exact'},'HOST-SECRET',2);
 try {
  await f.service.open('challenge','operator',{expectedRevision:'missing',requestId:'open'});
  await f.update('submit',{answer:'HOST-SECRET'},'alice',f.service); await f.update('submit',{answer:'HOST-SECRET'},'bob',f.service); f.late();
  const transact=f.ledger.transact.bind(f.ledger);
  const fail=vi.spyOn(f.ledger,'transact').mockImplementation(async(command,revalidate)=>{if(command.op==='award_program'&&command.actor==='bob')throw Error('Interrupted second payment');return transact(command,revalidate);});
  await expect(f.update('finalize',{},'alice',f.service)).rejects.toThrow('Interrupted second payment'); fail.mockRestore();
  const current=await f.read(f.service);
  await expect(f.service.executeHost('close',{challengeId:'challenge',expectedRevision:current.revision,requestId:'close'},'operator')).rejects.toThrow(/payment|receipt|settlement/i);
  expect((await f.ledger.snapshot()).programs!.challenge!.closed).toBe(false);
  expect((await f.ledger.snapshot()).issued).toBe(10);
  if(terminal==='cancel'){
   await f.service.executeHost('cancel',{challengeId:'challenge',expectedRevision:current.revision,requestId:'cancel',reason:'Human chose to end interrupted event'},'operator');
   expect((await f.ledger.snapshot()).issued).toBe(10); expect((await f.ledger.snapshot()).balances.alice).toBe(10);
  } else {
   const finalized=await f.update('finalize',{requestId:'resume'},'alice',f.service);
   expect((await f.ledger.snapshot()).issued).toBe(20);
   const params={challengeId:'challenge',expectedRevision:finalized.revision,requestId:'close'};
   expect(await f.service.executeHost('close',params,'operator')).toMatchObject({reservation:'closed'});
   expect(await f.service.executeHost('close',params,'operator')).toMatchObject({reservation:'closed'});
   expect((await f.ledger.snapshot()).issued).toBe(20);
  }
 } finally {await f.ledger.close();}
});

test.each([
 [{kind:'numeric',absoluteTolerance:0},'9007199254740992','9007199254740993'],
 [{kind:'numeric',absoluteTolerance:0},'1e-1000','0'],
 [{kind:'numeric',absoluteTolerance:0.1},'0','0.10000000000000000000000000001'],
 [{kind:'numeric',absoluteTolerance:0},'0','1e-1001'],
 [{kind:'structured_json'},'{"n":9007199254740992}','{"n":9007199254740993}'],
 [{kind:'structured_json'},'{"n":[1e-1000]}','{"n":[0]}'],
 [{kind:'structured_json'},'{"n":0}','{"n":1e-1001}'],
] satisfies Array<[BenchmarkGrader,string,string]>)('paid precision regression %j: wrong early entry cannot receive the later correct entry award',async(grader,answer,submission)=>{
 const f=await paidPrecisionFixture(grader,answer);
 try {
  await f.service.open('challenge','operator',{expectedRevision:'missing',requestId:'open'});
  await f.update('submit',{answer:submission},'alice',f.service);await f.update('submit',{answer},'bob',f.service);f.late();
  expect(await f.update('finalize',{},'alice',f.service)).toMatchObject({state:'decided'});
  const state=await f.ledger.snapshot();expect(state.balances.alice??0).toBe(0);expect(state.balances.bob).toBe(10);expect(state.issued).toBe(10);
  const results=await f.read(f.service,'results');expect(results.items.map((e:any)=>({outcome:e.outcome,winner:e.winner}))).toEqual([{outcome:'fail',winner:false},{outcome:'pass',winner:true}]);
  await f.update('finalize',{requestId:'precision-retry'},'alice',f.service);expect((await f.ledger.snapshot()).issued).toBe(10);
 } finally {await f.ledger.close();}
});

test.each([
 [{kind:'numeric',absoluteTolerance:0},'1e-1001'],
 [{kind:'structured_json'},'{"n":1e-1001}'],
 [{kind:'structured_json'},'1'.repeat(101)],
] satisfies Array<[BenchmarkGrader,string]>)('paid host grading error %j holds adjudication with no award',async(grader,invalid)=>{
 const f=await paidPrecisionFixture(grader,invalid);
 try {
  await f.service.open('challenge','operator',{expectedRevision:'missing',requestId:'open'});
  await f.update('submit',{answer:invalid},'alice',f.service);f.late();const before=await f.read(f.service);
  // The current service represents a host grading_error as held/indeterminate,
  // not as a failed candidate; no final decision or monetary receipt is written.
  expect(await f.update('finalize',{},'alice',f.service)).toMatchObject({state:'held',revision:before.revision});
  expect((await f.read(f.service,'results')).items).toEqual([]);
  const state=await f.ledger.snapshot();expect(state.issued).toBe(0);expect(state.balances.alice??0).toBe(0);expect(state.programs?.challenge?.remaining).toBe(10);expect(state.programs?.challenge?.awarded).toBe(0);
 } finally {await f.ledger.close();}
});
test('host operations expose reviewable status, finalization and sanitized Obsidian snapshots without granting agent authority',async()=>{
 const f=await fixture();await f.open();await f.update('submit',{answer:'HOST-SECRET'});f.late();
 const inspected=await f.service.executeHost('inspect',{challengeId:'challenge'},'operator');
 await expect(f.service.executeHost('finalize',{challengeId:'challenge',expectedRevision:inspected.revision,requestId:'host-final'},'alice')).rejects.toThrow(/Human/);
 const finalized=await f.service.executeHost('finalize',{challengeId:'challenge',expectedRevision:inspected.revision,requestId:'host-final'},'operator');expect(finalized.state).toBe('decided');
 const projected=await f.service.executeHost('project',{challengeId:'challenge',expectedRevision:finalized.revision,expectedProjectionRevision:'missing',requestId:'project'},'operator');
 const note=await f.fs.readNote(String(projected.path));const text=JSON.stringify(note);expect(text).not.toContain('HOST-SECRET');expect(text).not.toContain('alice');expect(note.content).toContain('benchmark.read');expect(note.frontmatter.freshness).toBe('snapshot_requires_revalidation');
 await expect(f.service.execute('project',{},principal('alice'))).rejects.toThrow(/Unsupported/);
});
test('objective reflex provenance reports a fixed comparator, skipped peer correctness and no model calls',async()=>{
 const f=await fixture();await f.open();await f.update('submit',{answer:'HOST-SECRET'});f.late();const result=await f.update('finalize');
 expect(result.route).toMatchObject({kind:'objective',modelCalls:0,peerCorrectnessClaim:false,skipped:['peer_review','model_calls']});expect(result.route.reason.length).toBeLessThan(300);
 const results=await f.read(f.service,'results');expect(results.items[0].outcome).toBe('pass');expect(JSON.stringify(results).length).toBeLessThan(12000);
});
test('an exact comparator and its service route have equivalent results without any model invocation',async()=>{
 const f=await fixture();await f.open();await f.update('submit',{answer:'wrong'});f.late();await f.update('finalize');
 const result=await f.read(f.service,'results');expect(result.items[0].outcome).toBe('fail');expect(result.route.modelCalls).toBe(0);
});
test('late source hiding removes list entries before returning metadata',async()=>{
 const f=await fixture();await f.open();let calls=0;const auth=f.options.assertActor;f.options.assertActor=async p=>{
  if(++calls===2){const note=await f.fs.readNote('Evidence.md');await f.fs.writeNote({path:'Evidence.md',content:note.content,frontmatter:{moderation_status:'hidden'},expectedRevision:note.revision});}return auth(p);
 };
 expect(await f.service.execute('list',{},principal('alice'))).toMatchObject({items:[]});
});
test('pulse suggests eligible pending peer work after deadline without enrolling or calling models',async()=>{
 const f=await fixture('peer');await f.open();await f.update('submit',{answer:'candidate'});await f.update('submit',{answer:'other'},'bob');f.late();
 expect(await f.service.pulse(principal('r1'))).toMatchObject({endpointId:'benchmark.read',arguments:{challengeId:'challenge',field:'entries'}});
 const before=await f.read();await f.service.pulse(principal('r2'));expect((await f.read()).revision).toBe(before.revision);
 expect(await f.service.pulse(principal('unapproved'))).toBeUndefined();
});
test('maximum-size sealed entries remain reviewable through bounded literal chunks',async()=>{
 const f=await fixture('peer');await f.open();const answer='\u0001'.repeat(12000);await f.update('submit',{answer});f.late();
 const entries=await f.read(f.service,'entries','r1');expect(JSON.stringify(entries).length).toBeLessThanOrEqual(12000);expect(entries.items[0]).toHaveProperty('answerTruncated',true);
 let offset=0,joined='';for(let i=0;i<100;i++){const chunk=await f.service.execute('read',{challengeId:'challenge',field:'entry',entryId:entries.items[0].entryId,offset,maxChars:4000},principal('r1'));expect(JSON.stringify(chunk).length).toBeLessThanOrEqual(4000);joined+=chunk.answer;if(chunk.nextOffset===undefined)break;expect(chunk.nextOffset).toBeGreaterThan(offset);offset=chunk.nextOffset;}
 expect(joined).toBe(answer);
});
test('human cancel is durable and available before deadline even after source drift',async()=>{
 const f=await fixture();await f.open();const current=await f.read();const source=await f.fs.readNote('Evidence.md');await f.fs.writeNote({path:'Evidence.md',content:'changed',expectedRevision:source.revision});
 await expect(f.service.executeHost('cancel',{challengeId:'challenge',expectedRevision:current.revision,requestId:'cancel',reason:'No longer appropriate'},'alice')).rejects.toThrow(/Human/);
 const cancelled=await f.service.executeHost('cancel',{challengeId:'challenge',expectedRevision:current.revision,requestId:'cancel',reason:'No longer appropriate'},'operator');expect(cancelled.state).toBe('cancelled');
 expect(await f.read()).toMatchObject({state:'cancelled'});await expect(f.service.execute('cancel',{},principal('alice'))).rejects.toThrow(/Unsupported/);
});
