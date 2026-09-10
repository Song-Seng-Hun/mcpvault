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

async function paidPrecisionFixture(grader:BenchmarkGrader,answer:string) {
 const f=await fixture();f.d.grader=grader;f.d.reward=10;f.d.cap=10;f.setAnswer(answer);
 const host=join(f.root,'precision-host');await mkdir(host);let service!:BenchmarkService;
 const policy:EconomyPolicy={version:1,revision:'precision-regression-test-only',enabled:true,treasury:'treasury',operators:['operator'],owners:{treasury:'host',alice:'same',bob:'same'},reviewers:[],subjectiveReview:false,maxSupply:10,minReward:1,maxReward:10,postingFee:0,reviewFee:0,dailySpend:10,dailyPosts:1,openContracts:1,benchmarkPrograms:[BenchmarkService.issuanceProgram(f.d)]};
 const ledger=await EconomyLedger.initialize({vaultPath:f.vault,hostPath:host,policy,storageVerified:true,now:()=>new Date('2026-09-11T00:00:00Z'),benchmarkAuthority:{assertHumanOperator:f.options.assertHumanOperator,validateAward:(proof,state)=>service.validateAwardProof(proof,state)}});
 service=new BenchmarkService(f.fs,{...f.options,definitions:[f.d],ledger});
 return {...f,service,ledger};
}

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
