import { guidanceError, guidanceText } from './guidance-runtime.js';
import type {FileSystemService} from './filesystem.js';
import type {ScopePrincipal} from './scope-auth.js';
import {ScopeAccessPolicy} from './scope-access.js';
import {PathFilter} from './pathfilter.js';
import {isModerationHidden} from './moderation-policy.js';
import {coordinate,page,textField} from './work-model.js';
import type {EconomyLedger} from './economy-ledger.js';
import {economyRevision,type BenchmarkAwardProof,type BenchmarkIssuanceProgram,type EconomyState} from './economy-model.js';
import {validateBenchmarkProfiles,type BenchmarkIntegrity} from './benchmark-host.js';
import {BENCHMARK_MAX_TEXT,benchmarkFingerprint,benchmarkId,benchmarkInteger,benchmarkObject,validateBenchmarkDefinition,validateBenchmarkReview,gradeBenchmark,evaluateBenchmarkPeer,rankBenchmark,type BenchmarkDefinition,type BenchmarkProfile,type BenchmarkReview,type BenchmarkSource} from './benchmark-model.js';

export interface BenchmarkOptions {
 enabled:boolean;definitions:readonly BenchmarkDefinition[];
 accountProfiles:()=>Promise<Record<string,BenchmarkProfile>>;
 /** Current authentication/moderation backend, not the host approval list. */
 accountAvailable:(accountId:string)=>Promise<boolean>;
 /** Called again at every durable boundary. Never trust principal model labels. */
 assertActor:(principal:ScopePrincipal)=>Promise<ScopePrincipal>;
 assertHumanOperator:(actor:string)=>Promise<void>;
 answerReader:(definitionId:string)=>Promise<unknown>;
 integrity:BenchmarkIntegrity;
 ledger?:EconomyLedger;
 access?:ScopeAccessPolicy;pathFilter?:PathFilter;now?:()=>Date;
}
interface Entry {id:string;definitionId:string;account:string;owner:string;modelFamily:string;answer:string;sequence:number;at:string}
interface Decision {definitionFingerprint:string;winners:string[];entries:Array<{entryId:string;scores:number[];outcome:'pass'|'fail'}>}
interface Version {definition:BenchmarkDefinition;phase:'open'|'decided'|'cancelled';decision?:Decision;cancellation?:{reason:string;operator:string;at:string}}
interface RecordState {version:1;lineage:string;sequence:number;versions:Version[];entries:Entry[];reviews:BenchmarkReview[];receipts:Array<{key:string;payload:string}>}
interface Loaded {record:RecordState;revision:string}
type Actor={principal:ScopePrincipal;profile:BenchmarkProfile};
export type BenchmarkOperation='list'|'read'|'submit'|'review'|'finalize';
export type BenchmarkHostOperation='inspect'|'open'|'finalize'|'close'|'cancel'|'project';
const OPERATIONS:readonly string[]=['list','read','submit','review','finalize'];
const unavailable=()=>guidanceError(Error('Benchmark record or source unavailable'), 'guid-406f6e5b477288d0');
/** Fixed managed private Markdown paths; never expose records through generic notes.
 * Host opening is deliberately separate from the agent operation dispatcher. */
export class BenchmarkService {
 private readonly definitions:BenchmarkDefinition[];
 private readonly access:ScopeAccessPolicy;
 private readonly filter:PathFilter;
 constructor(private readonly fs:FileSystemService,private readonly options:BenchmarkOptions){
  if(typeof options.enabled!=='boolean'||!Array.isArray(options.definitions)||options.definitions.length>100)throw guidanceError(Error('Invalid benchmark configuration'), 'guid-759eedf911b2dc8b');
  this.definitions=options.definitions.map(validateBenchmarkDefinition);
  if(new Set(this.definitions.map(d=>d.id)).size!==this.definitions.length||new Set(this.definitions.map(d=>`${d.lineage}/${d.version}`)).size!==this.definitions.length)throw guidanceError(Error('Duplicate immutable benchmark version'), 'guid-1760df2941aba35a');
  this.access=options.access??new ScopeAccessPolicy();this.filter=options.pathFilter??new PathFilter();
 }
 static issuanceProgram(definition:BenchmarkDefinition):BenchmarkIssuanceProgram {
  const d=validateBenchmarkDefinition(definition);
  return {id:d.id,lineage:d.lineage,definitionFingerprint:benchmarkFingerprint(d),criteriaFingerprint:benchmarkFingerprint({rubric:d.rubric,qualityThreshold:d.qualityThreshold,mode:d.mode,maxWinners:d.maxWinners,tieBreak:'total-criterion-order-sequence',allowSameOwnerReview:d.allowSameOwnerReview}),participants:[...d.participants],reward:d.reward,maxWinners:d.maxWinners,cap:d.cap,closesAt:d.deadline};
 }
 private enabled(){if(!this.options.enabled)throw guidanceError(Error('Benchmarks are disabled'), 'guid-fba473777275b3d5');}
 private definition(id:unknown){this.enabled();const d=this.definitions.find(d=>d.id===benchmarkId(id));if(!d)throw unavailable();return d;}
 private path(d:BenchmarkDefinition){return `_whispers/benchmarks/${d.lineage}.md`;}
 private now(){return (this.options.now?.()??new Date()).toISOString();}
 private route(d:BenchmarkDefinition){return {kind:d.mode,reason:d.mode==='objective'?'A host-configured fixed comparator determines correctness against a private immutable answer.':'Host-approved reviewers assess ordered criteria; model diversity may share a human owner.',skipped:d.mode==='objective'?['peer_review','model_calls']:['objective_comparator','model_calls'],modelCalls:0,peerCorrectnessClaim:false};}
 private async profiles(){return validateBenchmarkProfiles(await this.options.accountProfiles());}
 private async actor(principal?:ScopePrincipal):Promise<Actor>{
  this.enabled();if(!principal)throw guidanceError(Error('Authenticated approved benchmark account required'), 'guid-3801f15dd1869f48');
  const current=await this.options.assertActor(principal);if(current.accountId!==principal.accountId)throw guidanceError(Error('Authenticated account changed'), 'guid-79b96b44539f977d');
  const p=(await this.profiles())[current.accountId];if(!p?.approved||!await this.options.accountAvailable(p.accountId))throw guidanceError(Error('Approved current persistent benchmark account required'), 'guid-f37c1c82c415b5d9');
  return {principal:current,profile:p};
 }
 private async sources(d:BenchmarkDefinition,principal?:ScopePrincipal,extra:BenchmarkSource[]=[]):Promise<void>{
  for(const source of [...d.sources,...extra]) {
   if(!this.filter.isAllowed(source.path)||!this.access.canAccessPhysicalPath(source.path,principal)||!this.access.canReferenceFrom(d.sources[0]!.path,source.path))throw unavailable();
   try {const note=await this.fs.readNote(source.path);if(note.revision!==source.revision||isModerationHidden(note.frontmatter)||note.frontmatter.content_status==='deleted')throw unavailable();}catch{throw unavailable();}
  }
 }
 private version(r:RecordState,d:BenchmarkDefinition):Version {
  const v=r.versions.find(v=>v.definition.id===d.id);if(!v)throw guidanceError(Error('Benchmark is not opened by a human operator'), 'guid-8f47c0e2ec2a17a8');
  if(benchmarkFingerprint(v.definition)!==benchmarkFingerprint(d))throw guidanceError(Error('Immutable benchmark definition changed; configure a new version'), 'guid-aaafdc999a694500');return v;
 }
 private async load(d:BenchmarkDefinition,allowMissing=false):Promise<Loaded>{
  const path=this.path(d);
  if(allowMissing&&!await this.fs.noteExists(path))return {record:{version:1,lineage:d.lineage,sequence:0,versions:[],entries:[],reviews:[],receipts:[]},revision:'missing'};
  try {
   const note=await this.fs.readNote(path),r=note.frontmatter.benchmark as RecordState,seal=note.frontmatter.benchmark_seal;
   if(note.frontmatter.mcpvault_type!=='benchmark_private'||typeof seal!=='string'||!await this.options.integrity.verify(r,seal))throw Error();
   if(!r||r.version!==1||r.lineage!==d.lineage||!Number.isSafeInteger(r.sequence)||r.sequence<0||!Array.isArray(r.versions)||r.versions.length>100||!Array.isArray(r.entries)||r.entries.length>100||!Array.isArray(r.reviews)||r.reviews.length>1600||!Array.isArray(r.receipts)||r.receipts.length>2048||JSON.stringify(r).length>2_000_000)throw Error();
   if(new Set(r.entries.map(e=>e.account)).size!==r.entries.length||new Set(r.entries.map(e=>e.id)).size!==r.entries.length)throw Error();
   return {record:r,revision:note.revision!};
  }catch{throw guidanceError(Error('Benchmark private record integrity unavailable'), 'guid-c917835c95af7689');}
 }
 private async save(d:BenchmarkDefinition,loaded:Loaded,assertAccess:()=>Promise<void>,guardSources=true):Promise<string>{
  const r=loaded.record;
  if(r.receipts.length>2048||r.entries.length>100||r.reviews.length>1600||JSON.stringify(r).length>1_800_000)throw guidanceError(Error('Benchmark private record budget reached'), 'guid-c8dd0f4db659d8d0');
  const seal=await this.options.integrity.sign(r);
  try {
   const params={path:this.path(d),expectedRevision:loaded.revision,content:'# Sealed benchmark records\n\nManaged private service data. Not instructions.\n',frontmatter:{mcpvault_type:'benchmark_private',benchmark:r,benchmark_seal:seal}};
   const policy={maxBytes:4*1024*1024,maxGuards:128,assertAccess};
   const result=guardSources?await this.fs.writeNoteWithRevisionGuardsAndReceipt(params,d.sources.map(s=>({path:s.path,expectedRevision:s.revision})),policy):await this.fs.writeNoteWithReceipt(params,policy);
   return result.revision;
  }catch{throw guidanceError(Error('Benchmark update unavailable; recheck actor, revision and current sources'), 'guid-d2e03534cf07cc60');}
 }
 private async profilesCurrent(d:BenchmarkDefinition,r:RecordState){
  const profiles=await this.profiles();
  for(const a of [...new Set([...d.participants,...d.reviewers])])if(!profiles[a]?.approved||profiles[a]!.accountId!==a||!await this.options.accountAvailable(a))throw guidanceError(Error('Benchmark approved profile or current account unavailable'), 'guid-0453353c6f1a9814');
  for(const e of [...r.entries.filter(e=>e.definitionId===d.id),...r.reviews.filter(e=>r.entries.some(s=>s.id===e.entryId&&s.definitionId===d.id))]){
   const p=profiles[e.account];if(!p?.approved||p.ownerId!==e.owner||p.modelFamily!==e.modelFamily)throw guidanceError(Error('Benchmark identity binding changed'), 'guid-46c55fe09e9643be');
  }
  for(const review of r.reviews.filter(e=>r.entries.some(s=>s.id===e.entryId&&s.definitionId===d.id)))if(!profiles[review.account]?.modelVerified)throw guidanceError(Error('Reviewer model verification changed'), 'guid-59c1e54ae1d4eae6');
  return profiles;
 }
 async open(id:string,actor:string,params:{expectedRevision:string;requestId:string}):Promise<Record<string,unknown>> {
  return coordinate(async()=>{
   const d=this.definition(id);await this.options.assertHumanOperator(actor);benchmarkId(actor);const requestId=textField(params.requestId,'requestId',128,true);
   const loaded=await this.load(d,true),r=loaded.record;await this.profilesCurrent(d,r);await this.sources(d);
   const key=benchmarkFingerprint({actor,requestId}),payload=benchmarkFingerprint({op:'open',definition:d});const retry=r.receipts.find(e=>e.key===key);
   if(retry){if(retry.payload!==payload)throw guidanceError(Error('requestId payload changed'), 'guid-36eae6b77005b616');this.version(r,d);return {challengeId:id,revision:loaded.revision,replay:true};}
   if(params.expectedRevision!==loaded.revision)throw guidanceError(Error('Benchmark revision conflict'), 'guid-c8b1f68aad910cf1');
   if(this.now()>=d.deadline)throw guidanceError(Error('Benchmark opening deadline passed'), 'guid-4a27604075f44165');
   if(r.versions.some(v=>v.definition.id===d.id||v.definition.version===d.version))throw guidanceError(Error('Benchmark immutable version already opened'), 'guid-3e40bd247b504de9');
   if(d.reward>0){
    if(!this.options.ledger)throw guidanceError(Error('Explicit approved wallet cap and ledger required'), 'guid-b6f3a2a8abebe38d');
    const state=await this.options.ledger.snapshot(),existing=state.programs?.[d.id];
    if(existing){if(existing.closed||economyRevision(existing.terms)!==economyRevision(BenchmarkService.issuanceProgram(d)))throw guidanceError(Error('Approved issuance program differs'), 'guid-6449a9952864f5e7');}
    else await this.options.ledger.transact({op:'reserve_program',actor,requestId:`benchmark-open:${d.id}`,programId:d.id,programFingerprint:economyRevision(BenchmarkService.issuanceProgram(d)),expectedRevision:'missing'},async()=>{await this.options.assertHumanOperator(actor);await this.sources(d);});
    const reserved=(await this.options.ledger.snapshot()).programs?.[d.id];if(!reserved||economyRevision(reserved.terms)!==economyRevision(BenchmarkService.issuanceProgram(d)))throw guidanceError(Error('Approved issuance program differs'), 'guid-6449a9952864f5e7');
   }
   r.versions.push({definition:structuredClone(d),phase:'open'});r.receipts.push({key,payload});
   const revision=await this.save(d,loaded,async()=>{await this.options.assertHumanOperator(actor);await this.sources(d);await this.profilesCurrent(d,r);});
   return {challengeId:id,revision,state:'open'};
  });
 }
 private budget(params:Record<string,unknown>){return benchmarkInteger(params.maxChars??4000,512,12000);}
 private bounded(result:Record<string,unknown>,params:Record<string,unknown>){if(JSON.stringify(result).length>this.budget(params))throw guidanceError(Error('Benchmark response exceeds maxChars'), 'guid-52be862c10914dc3');return result;}
 private chunk(base:Record<string,unknown>,value:string,params:Record<string,unknown>,key='text'):Record<string,unknown>{
  const offset=benchmarkInteger(params.offset??0,0,value.length),requested=benchmarkInteger(params.textLimit??4000,1,4000);
  let length=Math.min(requested,value.length-offset);
  for(;;){const end=offset+length,result={...base,[key]:value.slice(offset,end),offset,totalChars:value.length,...(end<value.length&&{nextOffset:end})};
   if(JSON.stringify(result).length<=this.budget(params))return result;if(length<=1)throw guidanceError(Error('Benchmark response envelope exceeds maxChars'), 'guid-29db3f93edc87555');length=Math.max(1,Math.floor(length/2));
  }
 }
 private async freshness(d:BenchmarkDefinition,r:RecordState,a:Actor):Promise<'current'|'unavailable_or_changed'>{try{await this.sources(d,a.principal);await this.profilesCurrent(d,r);return 'current';}catch{return 'unavailable_or_changed';}}
 private async read(d:BenchmarkDefinition,params:Record<string,unknown>,a:Actor):Promise<Record<string,unknown>>{
  const loaded=await this.load(d),r=loaded.record,v=this.version(r,d),field=params.field??'status';
  if(params.expectedRevision!==undefined&&params.expectedRevision!==loaded.revision)throw guidanceError(Error('Benchmark revision conflict'), 'guid-c8b1f68aad910cf1');
  const freshness=await this.freshness(d,r,a),current=freshness==='current';
  const common={challengeId:d.id,revision:loaded.revision,state:v.phase,freshness,route:this.route(d)};let result:Record<string,unknown>;
  if(field==='status')result={...common,...(current&&v.decision&&{winnerCount:v.decision.winners.length}),sealed:r.entries.some(e=>e.account===a.profile.accountId),rewardMode:d.reward?'bounded-mint':'no-mint'};
  else {
   if(!current)throw unavailable();
   if(field==='definition'){
    const {participants:_p,reviewers:_r,...definition}=d;result={...common,definition};
    if(JSON.stringify(result).length>this.budget(params)){const {problem:_problem,rubric:_rubric,sources:_sources,...summary}=definition;result={...common,definition:summary,omittedFields:['problem','rubric','sources'],detailFields:['problem','rubric','sources']};}
   }else if(field==='problem')result=this.chunk(common,d.problem,params);
   else if(field==='rubric'||field==='sources')result=page(field==='rubric'?d.rubric:d.sources,common,benchmarkFingerprint({revision:loaded.revision,field}),params,`benchmark-${field}`);
   else if(field==='entry'){
    if(d.mode!=='peer'||!d.reviewers.includes(a.profile.accountId)||!a.profile.modelVerified||this.now()<d.deadline)throw guidanceError(Error('Blind peer entries unavailable'), 'guid-5d491f39cbfb9acb');
    const entry=r.entries.find(e=>e.id===benchmarkId(params.entryId)&&e.definitionId===d.id);
    if(!entry||entry.account===a.profile.accountId||(!d.allowSameOwnerReview&&entry.owner===a.profile.ownerId))throw unavailable();
    result=this.chunk({...common,entryId:entry.id},entry.answer,params,'answer');
   }else if(field==='submission'){
    const own=r.entries.find(e=>e.account===a.profile.accountId&&e.definitionId===d.id);result=own?this.chunk({...common,entryId:own.id},own.answer,params,'answer'):common;
   }else if(field==='review'){
    const review=r.reviews.find(e=>e.id===benchmarkId(params.reviewId)&&r.entries.some(s=>s.id===e.entryId&&s.definitionId===d.id));
    if(!review||(v.phase!=='decided'&&!r.reviews.some(own=>own.entryId===review.entryId&&own.account===a.profile.accountId)))throw unavailable();
    result=this.chunk({...common,reviewId:review.id,entryId:review.entryId,format:'json'},JSON.stringify({criteria:review.criteria,resolutionOf:review.resolutionOf}),params);
   }else {
    let items:Array<Record<string,unknown>>=[];const entries=r.entries.filter(e=>e.definitionId===d.id);
    if(field==='entries') {
     if(d.mode!=='peer'||!d.reviewers.includes(a.profile.accountId)||!a.profile.modelVerified||this.now()<d.deadline)throw guidanceError(Error('Blind peer entries unavailable'), 'guid-5d491f39cbfb9acb');
     items=entries.filter(e=>e.account!==a.profile.accountId&&(d.allowSameOwnerReview||e.owner!==a.profile.ownerId)).map(e=>({entryId:e.id,answer:e.answer.slice(0,300),answerTruncated:e.answer.length>300,totalChars:e.answer.length,detailField:'entry'}));
    }else if(field==='reviews'){
     const reviews=r.reviews.filter(e=>entries.some(s=>s.id===e.entryId));
     // Score and prose disclosure requires the requesting reviewer's locked
     // review for this entry, or the immutable final decision.
     items=reviews.filter(e=>v.phase==='decided'||e.account===a.profile.accountId||reviews.some(own=>own.entryId===e.entryId&&own.account===a.profile.accountId)).map(e=>({reviewId:e.id,entryId:e.entryId,criteria:e.criteria.map(c=>({criterion:c.criterion,score:c.score,evidence:c.evidence})),resolutionOf:e.resolutionOf,detailField:'review'}));
    }else if(field==='conflicts'){
     if(d.mode!=='peer'||!d.reviewers.includes(a.profile.accountId)||this.now()<d.deadline)throw unavailable();
     items=entries.filter(e=>e.account!==a.profile.accountId).flatMap(e=>{const reviews=r.reviews.filter(r=>r.entryId===e.id);return reviews.length>=2&&evaluateBenchmarkPeer(d,reviews).state==='held'?[{entryId:e.id,reviewIds:reviews.map(r=>r.id),reason:guidanceText('guid-5b74bee3890bfac8', 'Additional independent family review required')}]:[];});
    }else if(field==='results')items=(v.decision?.entries??[]).map(e=>({...e,winner:v.decision!.winners.includes(e.entryId)}));
    else throw guidanceError(Error('Unsupported benchmark read field'), 'guid-24909e36d7176bdf');
    result=page(items,common,benchmarkFingerprint({revision:loaded.revision,field,account:a.profile.accountId}),params,`benchmark-${String(field)}`);
   }
  }
  const fresh=await this.actor(a.principal);if((await this.load(d)).revision!==loaded.revision||await this.freshness(d,r,fresh)!==freshness)throw guidanceError(Error('Benchmark context changed during read'), 'guid-14e4e4fa1a62e6ca');
  return this.bounded(result,params);
 }
 private async decide(d:BenchmarkDefinition,r:RecordState):Promise<Decision|undefined>{
  await this.profilesCurrent(d,r);if(this.now()<d.deadline)throw guidanceError(Error('Benchmark submission deadline not reached'), 'guid-005700cc391673ed');
  const entries=r.entries.filter(e=>e.definitionId===d.id),results:Decision['entries']=[];
  if(d.mode==='peer'&&entries.length<2)return;
  let expected:unknown;
  if(d.mode==='objective'){try{expected=await this.options.answerReader(d.id);}catch{return;}}
  for(const e of entries){
   if(d.mode==='objective'){
    const outcome=gradeBenchmark(d.grader!,expected,e.answer);if(outcome==='indeterminate')return;
    results.push({entryId:e.id,scores:d.rubric.map(()=>outcome==='pass'?100:0),outcome});
   }else{
    const reviews=r.reviews.filter(r=>r.entryId===e.id),grade=evaluateBenchmarkPeer(d,reviews);if(grade.state==='held')return;
    results.push({entryId:e.id,scores:grade.scores,outcome:grade.state});
   }
  }
  return {definitionFingerprint:benchmarkFingerprint(d),entries:results,winners:rankBenchmark(d,results.filter(e=>e.outcome==='pass').map(e=>({...e,sequence:entries.find(s=>s.id===e.entryId)!.sequence})))};
 }
 private proof(d:BenchmarkDefinition,decision:Decision,account:string):BenchmarkAwardProof {const program=BenchmarkService.issuanceProgram(d);return {programId:d.id,account,definitionFingerprint:program.definitionFingerprint,criteriaFingerprint:program.criteriaFingerprint,adjudicationRevision:benchmarkFingerprint(decision)};}
 /** Host-only receipt adapter called INSIDE ledger serialization. It must not
  * snapshot/transact the same ledger, which would deadlock its writer queue. */
 async validateAwardProof(proof:BenchmarkAwardProof,state:EconomyState):Promise<void>{
  const d=this.definition(proof.programId),loaded=await this.load(d),r=loaded.record,v=this.version(r,d);
  await this.sources(d);const decision=await this.decide(d,r);
  if(!decision||!v.decision||v.phase!=='decided'||benchmarkFingerprint(decision)!==benchmarkFingerprint(v.decision)||benchmarkFingerprint(this.proof(d,decision,proof.account))!==benchmarkFingerprint(proof))throw guidanceError(Error('Trusted current adjudication proof required'), 'guid-df0c8cec3f5dfe53');
  const entry=r.entries.find(e=>e.account===proof.account&&e.definitionId===d.id);
  if(!entry||!decision.winners.includes(entry.id))throw guidanceError(Error('Account is not an adjudicated winner'), 'guid-ef01929bb5467dad');
  const program=state.programs?.[d.id];if(!program||economyRevision(program.terms)!==economyRevision(BenchmarkService.issuanceProgram(d)))throw guidanceError(Error('Reserved issuance terms differ'), 'guid-c73e6ad39820a021');
  await this.sources(d);await this.profilesCurrent(d,r);if((await this.load(d)).revision!==loaded.revision)throw guidanceError(Error('Adjudication changed during validation'), 'guid-89850daa27c2090f');
 }
 private async pay(d:BenchmarkDefinition,r:RecordState,authority:ScopePrincipal|(()=>Promise<void>)):Promise<void>{
  if(!d.reward)return;if(!this.options.ledger)throw guidanceError(Error('Approved ledger unavailable'), 'guid-84a14277563138e2');const decision=this.version(r,d).decision!;
  const assertAuthority=async()=>{if(typeof authority==='function')await authority();else await this.actor(authority);};
  for(const id of decision.winners){const entry=r.entries.find(e=>e.id===id)!;await assertAuthority();
   await this.options.ledger.transact({op:'award_program',actor:entry.account,requestId:`benchmark-award:${d.lineage}:${entry.account}`,programId:d.id,award:this.proof(d,decision,entry.account)},async()=>{await assertAuthority();await this.sources(d);});
  }
 }
 /** CLI/host-only pathway. Never map these operations to agent endpoints. */
 async executeHost(op:BenchmarkHostOperation,params:Record<string,unknown>,operator:string):Promise<Record<string,any>> {
  params=structuredClone(params);
  benchmarkObject(params,['challengeId','expectedRevision','expectedProjectionRevision','requestId','maxChars','reason']);this.budget(params);
  const d=this.definition(params.challengeId);await this.options.assertHumanOperator(operator);
  if(op==='open')return this.open(d.id,operator,{expectedRevision:String(params.expectedRevision),requestId:textField(params.requestId,'requestId',128,true)});
  return coordinate(async()=>{
   await this.options.assertHumanOperator(operator);const loaded=await this.load(d,op==='inspect'),r=loaded.record;
   if(op==='inspect'){
    const version=r.versions.find(v=>v.definition.id===d.id);if(version)this.version(r,d);
    let freshness='current';try{await this.sources(d);await this.profilesCurrent(d,r);}catch{freshness='unavailable_or_changed';}
    return this.bounded({challengeId:d.id,revision:loaded.revision,state:version?.phase??'not_opened',freshness,route:this.route(d)},params);
   }
   const v=this.version(r,d),requestId=textField(params.requestId,'requestId',128,true);
   if(op==='cancel'){
    const reason=textField(params.reason,'cancellation reason',1000,true),key=benchmarkFingerprint({actor:operator,requestId}),payload=benchmarkFingerprint({op:'host-cancel',challengeId:d.id,reason});
    const previous=r.receipts.find(e=>e.key===key);if(previous&&previous.payload!==payload)throw guidanceError(Error('requestId payload changed'), 'guid-36eae6b77005b616');
    if(!previous&&params.expectedRevision!==loaded.revision)throw guidanceError(Error('Benchmark revision conflict'), 'guid-c8b1f68aad910cf1');
    if(d.reward&&!this.options.ledger)throw guidanceError(Error('Approved ledger unavailable'), 'guid-84a14277563138e2');
    const assertHost=()=>this.options.assertHumanOperator(operator);
    if(v.phase!=='cancelled'){v.phase='cancelled';v.cancellation={operator,reason,at:this.now()};r.receipts.push({key,payload});loaded.revision=await this.save(d,loaded,assertHost,false);}
    else if(v.cancellation?.reason!==reason)throw guidanceError(Error('Cancellation already finalized with a different reason'), 'guid-872e353ae50583b9');
    if(d.reward){const state=await this.options.ledger!.snapshot(),program=state.programs?.[d.id];if(!program)throw guidanceError(Error('Program unavailable'), 'guid-dbd5e1abe1f9b42f');
     if(!program.closed)await this.options.ledger!.transact({op:'cancel_program',actor:operator,requestId:`benchmark-cancel:${d.id}`,programId:d.id,expectedRevision:economyRevision(program),reason},assertHost);
    }
    return this.bounded({challengeId:d.id,revision:loaded.revision,state:'cancelled',reservation:'released'},params);
   }
   await this.sources(d);await this.profilesCurrent(d,r);
   const assertCurrent=async()=>{await this.options.assertHumanOperator(operator);await this.sources(d);await this.profilesCurrent(d,r);};
   const key=benchmarkFingerprint({actor:operator,requestId}),payload=benchmarkFingerprint({op:`host-${op}`,challengeId:d.id});
   const prior=r.receipts.find(e=>e.key===key);if(prior&&prior.payload!==payload)throw guidanceError(Error('requestId payload changed'), 'guid-36eae6b77005b616');
   if(!prior&&params.expectedRevision!==loaded.revision)throw guidanceError(Error('Benchmark revision conflict'), 'guid-c8b1f68aad910cf1');
   if(op==='finalize') {
    if(v.phase==='cancelled')throw guidanceError(Error('Benchmark was cancelled'), 'guid-0d120fec6e9fdd94');
    if(!v.decision){const decision=await this.decide(d,r);if(!decision)return this.bounded({challengeId:d.id,revision:loaded.revision,state:'held',route:this.route(d)},params);v.decision=decision;v.phase='decided';r.receipts.push({key,payload});loaded.revision=await this.save(d,loaded,assertCurrent);}
    await this.pay(d,r,assertCurrent);return this.bounded({challengeId:d.id,revision:loaded.revision,state:'decided',route:this.route(d)},params);
   }
   if(op==='close') {
    if(this.now()<d.deadline)throw guidanceError(Error('Benchmark close deadline not reached'), 'guid-efaa3e1720508488');
    if(d.reward){if(!this.options.ledger)throw guidanceError(Error('Approved ledger unavailable'), 'guid-84a14277563138e2');const state=await this.options.ledger.snapshot(),program=state.programs?.[d.id];if(!program)throw guidanceError(Error('Program unavailable'), 'guid-dbd5e1abe1f9b42f');
     if(!program.closed)await this.options.ledger.transact({op:'close_program',actor:operator,requestId:`benchmark-close:${d.id}`,programId:d.id,expectedRevision:economyRevision(program)},assertCurrent);
    }
    return this.bounded({challengeId:d.id,revision:loaded.revision,state:v.phase,reservation:'closed'},params);
   }
   if(op!=='project')throw guidanceError(Error('Unsupported benchmark host operation'), 'guid-1a3fc132563809b4');
   const path=`${this.access.getCommunityRoot()}/Benchmarks/${d.id}.md`;
   if(!this.filter.isAllowed(path)||!d.sources.every(s=>this.access.canReferenceFrom(path,s.path)))throw unavailable();
   const existing=await this.fs.noteExists(path)?await this.fs.readNote(path):undefined;
   if(existing&&(existing.frontmatter.mcpvault_type!=='benchmark_projection'||existing.frontmatter.benchmark_id!==d.id))throw guidanceError(Error('Unmanaged Obsidian note will not be overwritten'), 'guid-1a4d2d3a6c9a42f3');
   const snapshot=benchmarkFingerprint({definition:d,decision:v.decision??null,phase:v.phase});
   if(existing?.frontmatter.benchmark_snapshot===snapshot)return {challengeId:d.id,path,revision:existing.revision,replay:true};
   if(params.expectedProjectionRevision!==(existing?.revision??'missing'))throw guidanceError(Error('Benchmark projection revision conflict'), 'guid-2ac6b39ddec401fc');
   const content=`# ${d.title}\n\n${d.problem}\n\nMode: ${d.mode}. Deadline: ${d.deadline}.\n\nSnapshot phase: ${v.phase}. Winners at snapshot: ${v.decision?.winners.length??0}.\n\nThis is a sanitized snapshot, not current approval or payout authority. Revalidate with benchmark.read (challengeId: ${d.id}, field: status). Sources, account approval and host configuration may have changed.\n\n${this.route(d).reason}\n\nSame-owner peer review: ${d.allowSameOwnerReview?'permitted; weaker independence':'not permitted'}.\n`;
   try {
    const receipt=await this.fs.writeNoteWithRevisionGuardsAndReceipt({path,content,expectedRevision:existing?.revision??'missing',frontmatter:{mcpvault_type:'benchmark_projection',benchmark_id:d.id,benchmark_lineage:d.lineage,benchmark_version:d.version,benchmark_snapshot:snapshot,freshness:'snapshot_requires_revalidation'}},[{path:this.path(d),expectedRevision:loaded.revision},...d.sources.map(s=>({path:s.path,expectedRevision:s.revision}))],{maxGuards:128,assertAccess:assertCurrent});
    const written=await this.fs.readNote(path);if(written.revision!==receipt.revision)throw Error();return {challengeId:d.id,path,revision:receipt.revision};
   }catch{throw guidanceError(Error('Benchmark projection unavailable; recheck revision and current authority'), 'guid-38380c683d25e219');}
  });
 }
 async execute(op:string,params:Record<string,unknown>,principal?:ScopePrincipal):Promise<Record<string,any>>{
  params=structuredClone(params);
  if(!OPERATIONS.includes(op))throw guidanceError(Error('Unsupported benchmark operation'), 'guid-cd031fb724370070');
  const allowed=['challengeId','field','expectedRevision','requestId','answer','practice','review','limit','maxChars','cursor','entryId','reviewId','offset','textLimit'];benchmarkObject(params,allowed);this.budget(params);
  const actor=await this.actor(principal);
  if(op==='list') {
   const items:Array<Record<string,unknown>>=[];
   for(const d of this.definitions){try{const loaded=await this.load(d);this.version(loaded.record,d);if(await this.freshness(d,loaded.record,actor)==='current')items.push({challengeId:d.id,title:d.title,mode:d.mode,deadline:d.deadline,reward:d.reward,state:this.version(loaded.record,d).phase});}catch{/* No counts, titles or paths for unavailable entries. */}}
   const current=await this.actor(principal),visible:Array<Record<string,unknown>>=[];
   for(const item of items){try{const d=this.definition(item.challengeId),loaded=await this.load(d);this.version(loaded.record,d);if(await this.freshness(d,loaded.record,current)==='current')visible.push(item);}catch{/* Late visibility changes also remove counts and metadata. */}}
   return page(visible,{},benchmarkFingerprint({items:visible,account:actor.profile.accountId}),params,'benchmark-list');
  }
  const d=this.definition(params.challengeId);if(op==='read')return this.read(d,params,actor);
  return coordinate(async()=>{
   const a=await this.actor(principal),loaded=await this.load(d),r=loaded.record,v=this.version(r,d);
   await this.sources(d,a.principal);await this.profilesCurrent(d,r);
   const requestId=textField(params.requestId,'requestId',128,true),key=benchmarkFingerprint({account:a.profile.accountId,requestId});
   const payload=benchmarkFingerprint({op,challengeId:d.id,answer:params.answer??null,practice:params.practice??false,review:params.review??null});
   const prior=r.receipts.find(e=>e.key===key);
   if(prior){if(prior.payload!==payload)throw guidanceError(Error('requestId payload changed'), 'guid-36eae6b77005b616');if(op==='finalize'&&v.decision)await this.pay(d,r,a.principal);return this.bounded({challengeId:d.id,revision:loaded.revision,state:v.phase,replay:true,route:this.route(d)},params);}
   if(params.expectedRevision!==loaded.revision)throw guidanceError(Error('Benchmark revision conflict'), 'guid-c8b1f68aad910cf1');
   if(op==='submit') {
    if(typeof params.answer!=='string'||!params.answer.length||params.answer.length>BENCHMARK_MAX_TEXT)throw guidanceError(Error('Bounded literal submission required'), 'guid-ec4c39c74125f685');
    if(params.practice!==undefined&&typeof params.practice!=='boolean')throw guidanceError(Error('Invalid practice flag'), 'guid-79305386cfdaf323');
    if(!d.participants.includes(a.profile.accountId))throw guidanceError(Error('Approved challenge participant required'), 'guid-80f667efd0f9c62d');
    if(params.practice===true){await this.actor(principal);return {challengeId:d.id,revision:loaded.revision,practice:true,rewardEligible:false,stored:false};}
    if(v.phase!=='open'||this.now()>=d.deadline)throw guidanceError(Error('Final submission deadline or phase closed'), 'guid-c3bb78533fac1bec');
    if(r.entries.some(e=>e.account===a.profile.accountId))throw guidanceError(Error('One sealed final submission per persistent account and lineage'), 'guid-86a827f19059f071');
    r.sequence++;r.entries.push({id:`entry-${r.sequence}`,definitionId:d.id,account:a.profile.accountId,owner:a.profile.ownerId,modelFamily:a.profile.modelFamily,answer:params.answer,sequence:r.sequence,at:this.now()});
   }else if(op==='review'){
    if(d.mode!=='peer'||v.phase!=='open'||this.now()<d.deadline||!d.reviewers.includes(a.profile.accountId)||!a.profile.modelVerified)throw guidanceError(Error('Approved verified blind peer review unavailable'), 'guid-e2b6091358d22917');
    const review=validateBenchmarkReview(params.review,d),entry=r.entries.find(e=>e.id===review.entryId&&e.definitionId===d.id);
    if(!entry||entry.account===a.profile.accountId)throw guidanceError(Error('Self review forbidden or entry unavailable'), 'guid-b2c2201ea4ac8bb4');
    if(!d.allowSameOwnerReview&&entry.owner===a.profile.ownerId)throw guidanceError(Error('Same owner peer review not approved'), 'guid-065e1d6d2cb75c19');
    if(r.reviews.some(e=>e.entryId===entry.id&&e.account===a.profile.accountId))throw guidanceError(Error('Review is already locked'), 'guid-8186e49ed22a9306');
    const previous=r.reviews.filter(e=>e.entryId===entry.id);if(review.resolutionOf.some(id=>!previous.some(e=>e.id===id)))throw guidanceError(Error('Resolution references unknown locked reviews'), 'guid-082223b3a823093e');
    for(const source of review.criteria.flatMap(c=>c.sources))if(!d.sources.some(s=>s.path===source.path&&s.revision===source.revision))throw guidanceError(Error('Review must cite exact configured source revisions'), 'guid-995f5902f8e68b8e');
    await this.sources(d,a.principal,review.criteria.flatMap(c=>c.sources));
    r.reviews.push({id:`review-${r.reviews.length+1}`,account:a.profile.accountId,owner:a.profile.ownerId,modelFamily:a.profile.modelFamily,...review});
   }else{
    if(!d.participants.includes(a.profile.accountId)&&!d.reviewers.includes(a.profile.accountId))throw guidanceError(Error('Approved challenge account required'), 'guid-f1016b73060986bb');
    if(v.phase==='cancelled')throw guidanceError(Error('Benchmark was cancelled'), 'guid-0d120fec6e9fdd94');
    if(v.decision){await this.pay(d,r,a.principal);return this.bounded({challengeId:d.id,revision:loaded.revision,state:'decided',replay:true,route:this.route(d)},params);}
    const decision=await this.decide(d,r);if(!decision)return this.bounded({challengeId:d.id,revision:loaded.revision,state:'held',reason:guidanceText('guid-118bf5e22a39f2e2', 'Current determinate grades, two comparable peer entries and independent reviews required'),route:this.route(d)},params);
    v.decision=decision;v.phase='decided';
   }
   r.receipts.push({key,payload});
   const revision=await this.save(d,loaded,async()=>{const current=await this.actor(principal);await this.sources(d,current.principal);await this.profilesCurrent(d,r);if((op==='submit'&&!params.practice)&&this.now()>=d.deadline)throw guidanceError(Error('Deadline passed'), 'guid-48fa014012723970');});
   if(op==='finalize')await this.pay(d,r,a.principal);
   return this.bounded({challengeId:d.id,revision,state:v.phase,route:this.route(d)},params);
  });
 }
 /** Opt-in suggestion only: no enrollment, model call, timer or mutation. */
 async pulse(principal:ScopePrincipal):Promise<{endpointId:string;arguments:Record<string,unknown>;reason:string}|undefined>{
  if(!this.options.enabled)return undefined;
  let a:Actor;try{a=await this.actor(principal);}catch{return undefined;}
  for(const d of this.definitions){
   try{
    const loaded=await this.load(d),r=loaded.record,v=this.version(r,d);
    if(v.phase!=='open'||await this.freshness(d,r,a)!=='current')continue;
    if(d.participants.includes(a.profile.accountId)&&this.now()<d.deadline&&!r.entries.some(e=>e.account===a.profile.accountId))return {endpointId:'benchmark.read',arguments:{challengeId:d.id,field:'definition'},reason:guidanceText('guid-f7eaac504aa50299', 'An opt-in host-approved challenge is available; participation is optional')};
    if(d.mode==='peer'&&this.now()>=d.deadline&&d.reviewers.includes(a.profile.accountId)&&a.profile.modelVerified){
     const pending=r.entries.some(e=>e.definitionId===d.id&&e.account!==a.profile.accountId&&(d.allowSameOwnerReview||e.owner!==a.profile.ownerId)&&!r.reviews.some(review=>review.entryId===e.id&&review.account===a.profile.accountId)&&evaluateBenchmarkPeer(d,r.reviews.filter(review=>review.entryId===e.id)).state==='held');
     if(pending)return {endpointId:'benchmark.read',arguments:{challengeId:d.id,field:'entries'},reason:guidanceText('guid-7952113ef86336f4', 'Optional blind peer review is pending after the submission deadline; no model is invoked')};
    }
   }catch{/* Hidden/stale definitions never become pulse suggestions. */}
  }
  return undefined;
 }
}
