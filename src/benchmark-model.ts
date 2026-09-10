import { guidanceError } from './guidance-runtime.js';
import { PathFilter } from './pathfilter.js';
import { fingerprint, textField } from './work-model.js';

export const BENCHMARK_MAX_TEXT=12000;
export const benchmarkFingerprint=fingerprint;
export type BenchmarkGrade='pass'|'fail'|'indeterminate';
export type BenchmarkGrader={kind:'exact'}|{kind:'structured_json'}|{kind:'numeric';absoluteTolerance:number};
export interface BenchmarkSource {path:string;revision:string}
export interface BenchmarkCriterion {id:string;description:string;minimum:number}
export interface BenchmarkDefinition {
 id:string;lineage:string;version:string;title:string;problem:string;sources:BenchmarkSource[];
 rubric:BenchmarkCriterion[];deadline:string;allowedTools:string[];mode:'objective'|'peer';answerKnown:boolean;
 grader?:BenchmarkGrader;reward:number;maxWinners:number;cap:number;qualityThreshold:number;
 participants:string[];reviewers:string[];allowSameOwnerReview:boolean;
}
export interface BenchmarkProfile {accountId:string;ownerId:string;modelFamily:string;approved:boolean;modelVerified:boolean}
export interface BenchmarkCriterionReview {criterion:string;score:number;reason:string;sources:BenchmarkSource[];uncertainty:string;evidence:'supported'|'contradicted'|'uncertain'}
export interface BenchmarkReview {id:string;account:string;owner:string;modelFamily:string;entryId:string;criteria:BenchmarkCriterionReview[];resolutionOf:string[]}
export function benchmarkId(v:unknown):string {
 if(typeof v!=='string'||!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(v)||['__proto__','constructor','prototype'].includes(v))throw guidanceError(Error('Invalid benchmark identifier'), 'guid-4088a8b3474d9864');return v;
}
export function benchmarkObject(v:unknown,keys:readonly string[]):Record<string,unknown> {
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw guidanceError(Error('Invalid benchmark fields'), 'guid-e3474f2fd58e7db7');return v as Record<string,unknown>;
}
export function benchmarkInteger(v:unknown,min:number,max:number):number {if(!Number.isSafeInteger(v)||Number(v)<min||Number(v)>max)throw guidanceError(Error('Invalid bounded benchmark number'), 'guid-2b1bd5442c76700e');return Number(v);}
export function benchmarkPath(value:unknown):string {
 const path=textField(value,'source path',500,true);
 if(path!==value||/[\\:\x00-\x1f]/.test(path)||path.startsWith('/')||path.split('/').some(s=>!s||s==='.'||s==='..'||/[. ]$/.test(s))||!path.endsWith('.md')||!new PathFilter().isAllowed(path))throw guidanceError(Error('Invalid benchmark source path'), 'guid-6f9031ebb46854e1');
 return path;
}
export function benchmarkSources(value:unknown):BenchmarkSource[] {
 if(!Array.isArray(value)||!value.length||value.length>8)throw guidanceError(Error('One to eight exact source references required'), 'guid-53a86667706a913f');
 const sources=value.map(s=>{const o=benchmarkObject(s,['path','revision']);if(typeof o.revision!=='string'||!/^[a-f0-9]{64}$/.test(o.revision))throw guidanceError(Error('Invalid source revision'), 'guid-8441bc5889f2e306');return {path:benchmarkPath(o.path),revision:o.revision};});
 if(new Set(sources.map(s=>s.path.toLowerCase())).size!==sources.length)throw guidanceError(Error('Duplicate source reference'), 'guid-a9655f12e38d9515');return sources;
}
function ids(v:unknown,min:number,max:number):string[] {if(!Array.isArray(v)||v.length<min||v.length>max)throw guidanceError(Error('Invalid bounded benchmark pool'), 'guid-23eeaa50fba8cfc3');const list=v.map(benchmarkId);if(new Set(list).size!==list.length)throw guidanceError(Error('Duplicate benchmark identity'), 'guid-ebbbb8ba1c41f86e');return list;}
export function validateBenchmarkDefinition(value:unknown):BenchmarkDefinition {
 const v=benchmarkObject(value,['id','lineage','version','title','problem','sources','rubric','deadline','allowedTools','mode','answerKnown','grader','reward','maxWinners','cap','qualityThreshold','participants','reviewers','allowSameOwnerReview']);
 if(!['objective','peer'].includes(String(v.mode))||typeof v.answerKnown!=='boolean'||typeof v.allowSameOwnerReview!=='boolean')throw guidanceError(Error('Invalid reward mode'), 'guid-219603d7ae9e9b6b');
 if(!v.answerKnown&&v.mode!=='peer')throw guidanceError(Error('Unknown answers require peer mode'), 'guid-96a8ef96c6d867e5');
 if(typeof v.deadline!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.deadline)||!Number.isFinite(Date.parse(v.deadline))||new Date(v.deadline).toISOString()!==v.deadline)throw guidanceError(Error('Canonical UTC deadline required'), 'guid-d306b2ff7d1efa7e');
 if(!Array.isArray(v.rubric)||!v.rubric.length||v.rubric.length>8)throw guidanceError(Error('Bounded rubric required'), 'guid-1c8d1af5c8ba19b5');
 const rubric=v.rubric.map(c=>{const r=benchmarkObject(c,['id','description','minimum']);return {id:benchmarkId(r.id),description:textField(r.description,'criterion description',500,true),minimum:benchmarkInteger(r.minimum,0,100)};});
 if(new Set(rubric.map(c=>c.id)).size!==rubric.length)throw guidanceError(Error('Duplicate criterion'), 'guid-4395dd75f39a3479');
 const participants=ids(v.participants,1,32),reviewers=ids(v.reviewers,0,16);
 if(v.mode==='peer'&&reviewers.length<2)throw guidanceError(Error('Peer mode requires approved reviewers'), 'guid-aaa241712c3887ca');
 const reward=benchmarkInteger(v.reward,0,1_000_000_000),maxWinners=benchmarkInteger(v.maxWinners,1,participants.length),cap=benchmarkInteger(v.cap,0,1_000_000_000);
 if((reward===0&&cap!==0)||reward*maxWinners>cap)throw guidanceError(Error('Explicit cap must cover all declared rewards'), 'guid-4dfa8d1f13ef933f');
 let grader:BenchmarkGrader|undefined;
 if(v.mode==='objective') {const g=benchmarkObject(v.grader,['kind','absoluteTolerance']);if(g.kind==='numeric'){if(typeof g.absoluteTolerance!=='number'||!Number.isFinite(g.absoluteTolerance)||g.absoluteTolerance<0||g.absoluteTolerance>1e9)throw guidanceError(Error('Invalid fixed numeric tolerance'), 'guid-a389ff22a5f1cdce');grader={kind:'numeric',absoluteTolerance:g.absoluteTolerance};}else if((g.kind==='exact'||g.kind==='structured_json')&&Object.keys(g).length===1)grader={kind:g.kind};else throw guidanceError(Error('Unsupported fixed grader'), 'guid-a60149ffc33303fb');}
 else if(v.grader!==undefined)throw guidanceError(Error('Peer mode cannot use an objective grader'), 'guid-3f8c2500031d758d');
 return {id:benchmarkId(v.id),lineage:benchmarkId(v.lineage),version:benchmarkId(v.version),title:textField(v.title,'title',180,true),problem:textField(v.problem,'problem',4000,true),sources:benchmarkSources(v.sources),rubric,deadline:v.deadline,allowedTools:ids(v.allowedTools,0,32),mode:v.mode as 'objective'|'peer',answerKnown:v.answerKnown,...(grader&&{grader}),reward,maxWinners,cap,qualityThreshold:benchmarkInteger(v.qualityThreshold,0,100),participants,reviewers,allowSameOwnerReview:v.allowSameOwnerReview};
}
interface Decimal {coefficient:bigint;exponent:number}
/** Exact coefficient * 10^exponent. Bound the token and exponent BEFORE any
 * BigInt arithmetic; binary floats must never collapse distinct answers. */
function decimal(text:string):Decimal {
 if(text.length>100||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(text))throw guidanceError(Error('Numeric value'), 'guid-e4944c2ff2110b35');
 const [mantissa,rawExponent='0']=text.toLowerCase().split('e');
 const explicitExponent=Number(rawExponent);
 if(!Number.isSafeInteger(explicitExponent)||Math.abs(explicitExponent)>1000)throw guidanceError(Error('Numeric exponent budget'), 'guid-55f6a74270924dd0');
 let coefficient=BigInt(mantissa!.replace('.','')),exponent=explicitExponent-(mantissa!.split('.')[1]?.length??0);
 if(coefficient===0n)return {coefficient:0n,exponent:0};
 while(coefficient%10n===0n){coefficient/=10n;exponent++;}
 return {coefficient,exponent};
}
function decimalWithin(expected:Decimal,actual:Decimal,tolerance:Decimal):boolean {
 const exponent=Math.min(expected.exponent,actual.exponent,tolerance.exponent);
 const scaled=(value:Decimal)=>value.coefficient*10n**BigInt(value.exponent-exponent);
 const difference=scaled(expected)-scaled(actual);
 return (difference<0n?-difference:difference)<=scaled(tolerance);
}
/** Small data-only JSON parser: duplicate keys, depth and node count are bounded.
 * Return canonical JSON tokens directly, so numeric lexemes never pass through
 * JSON.parse/Number or collide with a user-authored string/object sentinel. */
function structuredJSON(text:string):string {
 let i=0,nodes=0;
 const ws=()=>{while(i<text.length&&/[ \t\r\n]/.test(text[i]!))i++;};
 const string=()=>{const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')return JSON.parse(text.slice(start,i)) as string;}throw guidanceError(Error('JSON string'), 'guid-4fd08d12aacf4295');};
 const value=(depth:number):string=>{
  ws();if(depth>20||++nodes>2048)throw guidanceError(Error('JSON budget'), 'guid-ebd77bd807f64553');const c=text[i];
  if(c==='"')return JSON.stringify(string());
  if(c==='{'||c==='['){i++;const object=c==='{',end=object?'}':']',result:Record<string,string>=Object.create(null),array:string[]=[],keys=new Set<string>();ws();if(text[i]===end){i++;return object?'{}':'[]';}
   while(i<text.length){ws();if(object){if(text[i]!=='"')throw guidanceError(Error('JSON key'), 'guid-0da8842b913cd5e9');const key=string();if(keys.has(key)||['__proto__','constructor','prototype'].includes(key))throw guidanceError(Error('JSON key'), 'guid-0da8842b913cd5e9');keys.add(key);ws();if(text[i++]!==':')throw guidanceError(Error('JSON colon'), 'guid-4a1e4f69f81ff9fa');result[key]=value(depth+1);}else array.push(value(depth+1));ws();if(text[i]===end){i++;return object?`{${Object.keys(result).sort().map(k=>`${JSON.stringify(k)}:${result[k]}`).join(',')}}`:`[${array.join(',')}]`;}if(text[i++]!==',')throw guidanceError(Error('JSON comma'), 'guid-18ecf9505701551f');}
   throw guidanceError(Error('JSON unterminated'), 'guid-86f1428f4b55a9c0');
  }
  const token=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i))?.[0];if(!token)throw guidanceError(Error('JSON value'), 'guid-3dd7b847908dacd6');i+=token.length;
  if(token==='true'||token==='false'||token==='null')return token;
  const number=decimal(token);return `${number.coefficient}e${number.exponent}`;
 };
 const result=value(0);ws();if(i!==text.length)throw guidanceError(Error('JSON trailing'), 'guid-5559ac4172ad829d');return result;
}
export function gradeBenchmark(grader:BenchmarkGrader,answer:unknown,submission:unknown):BenchmarkGrade {
 try {
  if(typeof answer!=='string'||answer.length>BENCHMARK_MAX_TEXT||!grader)throw Error();
  let expected:string|Decimal;
  if(grader.kind==='exact')expected=answer;
  else if(grader.kind==='structured_json')expected=structuredJSON(answer);
  else if(grader.kind==='numeric'&&Number.isFinite(grader.absoluteTolerance)&&grader.absoluteTolerance>=0&&grader.absoluteTolerance<=1e9)expected=decimal(answer);
  else throw Error();
  if(typeof submission!=='string'||submission.length>BENCHMARK_MAX_TEXT)return 'fail';
  // The immutable numeric tolerance uses its canonical configured decimal
  // spelling (e.g. 0.1), not an approximation introduced during subtraction.
  try {if(grader.kind==='exact')return expected===submission?'pass':'fail';if(grader.kind==='structured_json')return expected===structuredJSON(submission)?'pass':'fail';return decimalWithin(expected as Decimal,decimal(submission),decimal(String(grader.absoluteTolerance)))?'pass':'fail';}catch{return 'fail';}
 }catch{return 'indeterminate';}
}
export function validateBenchmarkReview(value:unknown,d:BenchmarkDefinition):Pick<BenchmarkReview,'entryId'|'criteria'|'resolutionOf'> {
 const v=benchmarkObject(value,['entryId','criteria','resolutionOf']);
 if(!Array.isArray(v.criteria)||v.criteria.length!==d.rubric.length)throw guidanceError(Error('Every criterion requires a review'), 'guid-b8b407a1a6aacf03');
 const criteria=v.criteria.map((c,index)=>{const r=benchmarkObject(c,['criterion','score','reason','sources','uncertainty','evidence']);if(r.criterion!==d.rubric[index]!.id||!['supported','contradicted','uncertain'].includes(String(r.evidence)))throw guidanceError(Error('Invalid criterion evidence'), 'guid-fee2da281d0afc4f');return {criterion:r.criterion as string,score:benchmarkInteger(r.score,0,100),reason:textField(r.reason,'criterion reason',1000,true),sources:benchmarkSources(r.sources),uncertainty:textField(r.uncertainty,'uncertainty',500,true),evidence:r.evidence as BenchmarkCriterionReview['evidence']};});
 return {entryId:benchmarkId(v.entryId),criteria,resolutionOf:ids(v.resolutionOf??[],0,16)};
}
export function benchmarkPass(d:BenchmarkDefinition,scores:number[]):boolean {return scores.length===d.rubric.length&&scores.every((s,i)=>Number.isFinite(s)&&s>=d.rubric[i]!.minimum)&&scores.reduce((n,s)=>n+s,0)/scores.length>=d.qualityThreshold;}
export function evaluateBenchmarkPeer(d:BenchmarkDefinition,reviews:BenchmarkReview[]):{state:'held'|'pass'|'fail';scores:number[]} {
 const held={state:'held' as const,scores:[]};if(reviews.length<2||new Set(reviews.map(r=>r.modelFamily)).size<2)return held;
 const inconsistent=(r:BenchmarkReview)=>benchmarkPass(d,r.criteria.map(c=>c.score))&&r.criteria.some(c=>c.evidence!=='supported');
 const conflict=(rs:BenchmarkReview[])=>rs.some(inconsistent)||new Set(rs.map(r=>benchmarkPass(d,r.criteria.map(c=>c.score)))).size>1||d.rubric.some((_,i)=>new Set(rs.map(r=>r.criteria[i]!.evidence)).size>1||rs.some(r=>r.criteria[i]!.evidence==='uncertain'));
 let scores:number[];
 if(conflict(reviews)) {
  const last=reviews.at(-1)!,prior=reviews.slice(0,-1);
  if(reviews.length<3||prior.some(r=>r.modelFamily===last.modelFamily)||prior.some(r=>!last.resolutionOf.includes(r.id))||last.criteria.some(c=>c.evidence==='uncertain')||inconsistent(last))return held;
  scores=last.criteria.map(c=>c.score);
 }else scores=d.rubric.map((_,i)=>reviews.reduce((sum,r)=>sum+r.criteria[i]!.score,0)/reviews.length);
 return {state:benchmarkPass(d,scores)?'pass':'fail',scores};
}
export function rankBenchmark(d:BenchmarkDefinition,entries:Array<{entryId:string;sequence:number;scores:number[]}>):string[] {
 const sum=(scores:number[])=>scores.reduce((a,b)=>a+b,0);
 return entries.filter(e=>benchmarkPass(d,e.scores)).sort((a,b)=>{let delta=sum(b.scores)-sum(a.scores);for(let i=0;!delta&&i<d.rubric.length;i++)delta=b.scores[i]!-a.scores[i]!;return delta||a.sequence-b.sequence;}).slice(0,d.maxWinners).map(e=>e.entryId);
}
