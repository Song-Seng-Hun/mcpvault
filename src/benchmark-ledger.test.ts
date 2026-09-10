import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EconomyLedger } from './economy-ledger.js';
import { applyEconomyCommand, initialEconomy, economyRevision, type EconomyPolicy } from './economy-model.js';

const roots: string[] = [];
afterEach(async () => { for (const p of roots.splice(0)) await rm(p, { recursive: true, force: true }); });
const program = { id:'contest', lineage:'problem', definitionFingerprint:'a'.repeat(64), criteriaFingerprint:'b'.repeat(64), participants:['alice','bob'], reward:20, maxWinners:2, cap:40, closesAt:'2026-10-01T00:00:00.000Z' };
const policy: EconomyPolicy = { version:1, revision:'pilot', enabled:true, treasury:'treasury', operators:['operator'], owners:{treasury:'host',alice:'same',bob:'same'}, reviewers:[], subjectiveReview:false, maxSupply:100,minReward:1,maxReward:50,postingFee:0,reviewFee:0,dailySpend:100,dailyPosts:10,openContracts:10, benchmarkPrograms:[program] };
const reserve = {op:'reserve_program' as const, actor:'operator', requestId:'reserve', programId:'contest', expectedRevision:'missing'};
const proof = {programId:'contest', account:'alice', definitionFingerprint:program.definitionFingerprint, criteriaFingerprint:program.criteriaFingerprint, adjudicationRevision:'c'.repeat(64)};
async function setup() {
 const root=await mkdtemp(join(tmpdir(),'benchmark-ledger-')); roots.push(root);
 const vaultPath=join(root,'vault'),hostPath=join(root,'host');await mkdir(vaultPath);await mkdir(hostPath);
 let current=true; let now=new Date('2026-09-11T00:00:00Z');
 const options={vaultPath,hostPath,storageVerified:true,policy,now:()=>now,benchmarkAuthority:{assertHumanOperator:async(actor:string)=>{if(actor!=='operator')throw Error('human required');},validateAward:async(p:typeof proof)=>{if(!current||p.adjudicationRevision!==proof.adjudicationRevision)throw Error('stale proof');}}};
 return {options,setCurrent:(v:boolean)=>{current=v;},setNow:(v:string)=>{now=new Date(v);}};
}
test('reserves headroom without issuance; ordinary issue respects all reservations',async()=>{
 const f=await setup(),l=await EconomyLedger.initialize(f.options);
 try {await l.transact(reserve);expect((await l.snapshot()).issued).toBe(0);
 await expect(l.transact({op:'issue',actor:'operator',requestId:'too-much',amount:61,reason:'approved'})).rejects.toThrow(/headroom|supply|reservation/i);
 await l.transact({op:'issue',actor:'operator',requestId:'fits',amount:60,reason:'approved'});
 expect((await l.snapshot()).programs?.contest?.remaining).toBe(40);
 }finally{await l.close();}
});
test('JSON claims cannot mint through reducer or an unconfigured ledger',async()=>{
 expect(()=>applyEconomyCommand(initialEconomy(),reserve,policy,'2026-09-11T00:00:00Z')).toThrow(/trusted|authority/i);
 const f=await setup(); const {benchmarkAuthority:_,...options}=f.options;const l=await EconomyLedger.initialize(options);
 try {await expect(l.transact(reserve)).rejects.toThrow(/authority/i);}finally{await l.close();}
});
test('trusted awards deduplicate lineage/account across concurrency, request ids and restarts',async()=>{
 const f=await setup();let l=await EconomyLedger.initialize(f.options);
 await l.transact(reserve);
 const award={op:'award_program' as const,actor:'alice',requestId:'award',programId:'contest',award:proof};
 const [a,b]=await Promise.all([l.transact(award),l.transact(award)]);expect(a).toEqual(b);
 await expect(l.transact({...award,requestId:'alias-retry'})).rejects.toThrow(/already|once/i);
 await l.close();l=await EconomyLedger.open(f.options);
 try{expect(await l.transact(award)).toEqual(a);f.setCurrent(false);await expect(l.transact(award)).rejects.toThrow(/stale/);
 expect((await l.snapshot()).balances.alice).toBe(20);expect((await l.snapshot()).issued).toBe(20);
 }finally{await l.close();}
});
test('same human approved accounts can win independently; close releases only unused headroom',async()=>{
 const f=await setup(),l=await EconomyLedger.initialize(f.options);
 try{await l.transact(reserve);await l.transact({op:'award_program',actor:'alice',requestId:'a',programId:'contest',award:proof});
 const close=()=>({op:'close_program' as const,actor:'operator',requestId:'close',programId:'contest'});
 await expect(l.transact({...close(),expectedRevision:economyRevision((await l.snapshot()).programs!.contest)})).rejects.toThrow(/close|deadline/i);
 f.setNow('2026-10-02T00:00:00Z');await l.transact({...close(),expectedRevision:economyRevision((await l.snapshot()).programs!.contest)});
 const s=await l.snapshot();expect(s.programs!.contest!.remaining).toBe(0);expect(s.issued).toBe(20);
 await l.transact({op:'issue',actor:'operator',requestId:'rest',amount:80,reason:'approved'});
 }finally{await l.close();}
});
test('program reservations race atomically and exact definition mismatch leaves no reservation',async()=>{
 const f=await setup();f.options.policy={...policy,benchmarkPrograms:[{...program,cap:60},{...program,id:'second',cap:60}]};
 const l=await EconomyLedger.initialize(f.options);try{
  await expect(l.transact({...reserve,programFingerprint:'f'.repeat(64)})).rejects.toThrow(/fingerprint|terms/i);
  expect((await l.snapshot()).programs).toBeUndefined();
  const results=await Promise.allSettled(['contest','second'].map(programId=>l.transact({...reserve,programId,requestId:programId})));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await l.snapshot()).issued).toBe(0);
 }finally{await l.close();}
});
test('global lineage dedup spans versions while same-owner approved canonical accounts each receive their reward',async()=>{
 const f=await setup();f.options.policy={...policy,benchmarkPrograms:[program,{...program,id:'second'}]};const l=await EconomyLedger.initialize(f.options);
 try{await l.transact(reserve);await l.transact({...reserve,programId:'second',requestId:'open-second'});
 await l.transact({op:'award_program',actor:'alice',requestId:'a',programId:'contest',award:proof});
 await expect(l.transact({op:'award_program',actor:'alice',requestId:'another-version',programId:'second',award:{...proof,programId:'second'}})).rejects.toThrow(/once|already/);
 await l.transact({op:'award_program',actor:'bob',requestId:'b',programId:'contest',award:{...proof,account:'bob'}});
 expect((await l.snapshot()).balances).toMatchObject({alice:20,bob:20});expect((await l.snapshot()).issued).toBe(40);
 }finally{await l.close();}
});
test('trusted current adjudication validation is repeated after caller revalidation, before durable intent',async()=>{
 const f=await setup(),l=await EconomyLedger.initialize(f.options);try{await l.transact(reserve);
 await expect(l.transact({op:'award_program',actor:'alice',requestId:'a',programId:'contest',award:proof},async()=>f.setCurrent(false))).rejects.toThrow(/stale/);
 expect((await l.snapshot()).issued).toBe(0);
 }finally{await l.close();}
});
test('human cancellation releases unused reserves before deadline, preserving issued rewards and requiring reason/CAS',async()=>{
 const f=await setup(),l=await EconomyLedger.initialize(f.options);try{await l.transact(reserve);await l.transact({op:'award_program',actor:'alice',requestId:'paid',programId:'contest',award:proof});
 const expectedRevision=economyRevision((await l.snapshot()).programs!.contest),cancel={op:'cancel_program' as const,programId:'contest',actor:'operator',requestId:'cancel',expectedRevision,reason:'Human cancelled this tournament'};
 await expect(l.transact({...cancel,actor:'alice'})).rejects.toThrow(/human|operator/i);await expect(l.transact({...cancel,reason:''})).rejects.toThrow(/reason/i);await expect(l.transact({...cancel,expectedRevision:'wrong'})).rejects.toThrow(/revision/i);
 const receipt=await l.transact(cancel);expect(await l.transact(cancel)).toEqual(receipt);const s=await l.snapshot();expect(s.programs!.contest).toMatchObject({closed:true,remaining:0});expect(s.issued).toBe(20);expect(s.balances.alice).toBe(20);
 await expect(l.transact({op:'award_program',actor:'bob',requestId:'unpaid',programId:'contest',award:{...proof,account:'bob'}})).rejects.toThrow(/closed/i);
 await l.transact({op:'issue',actor:'operator',requestId:'released',amount:80,reason:'approved'});
 }finally{await l.close();}
});
