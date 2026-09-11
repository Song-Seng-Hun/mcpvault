import { guidanceError } from './guidance-runtime.js';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,sep} from 'node:path';
import {readFederationFile} from './public-federation-storage.js';
import {assertHostPrivateStorage} from './skill-evolution-host.js';
import {hostSourceRoots} from './host-source-roots.js';
import {benchmarkFingerprint,benchmarkId,benchmarkObject,validateBenchmarkDefinition,type BenchmarkDefinition,type BenchmarkProfile} from './benchmark-model.js';
import { assertBenchmarkCollectorIsolation } from './benchmark-model.js';
export {acquireBenchmarkWriter,type BenchmarkWriter} from './benchmark-runtime.js';

export interface BenchmarkIntegrity {sign:(record:unknown)=>Promise<string>;verify:(record:unknown,seal:string)=>Promise<boolean>}
export interface BenchmarkHostConfig {
 version:1;enabled:boolean;vaultPath:string;hostPath:string;operators:string[];
 definitions:BenchmarkDefinition[];profiles:Record<string,BenchmarkProfile>;integrityKeyFile:string;answerFile?:string;
}
export interface LoadedBenchmarkHostConfig extends BenchmarkHostConfig {
 answerReader:(definitionId:string)=>Promise<string>;
 integrity:BenchmarkIntegrity;
 accountProfiles:()=>Promise<Record<string,BenchmarkProfile>>;
 assertHumanOperator:(actor:string)=>Promise<void>;
}
export function validateBenchmarkProfiles(raw:unknown):Record<string,BenchmarkProfile> {
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length>256)throw guidanceError(Error('Invalid benchmark account profiles'), 'guid-63546345ee1451eb');
 const result:Record<string,BenchmarkProfile>=Object.create(null);
 for(const [alias,value]of Object.entries(raw)){
  benchmarkId(alias);const v=benchmarkObject(value,['accountId','ownerId','modelFamily','approved','modelVerified']);
  if(typeof v.approved!=='boolean'||typeof v.modelVerified!=='boolean')throw guidanceError(Error('Host account approval required'), 'guid-6d7527ea88bd53a6');
  result[alias]={accountId:benchmarkId(v.accountId),ownerId:benchmarkId(v.ownerId),modelFamily:benchmarkId(v.modelFamily),approved:v.approved,modelVerified:v.modelVerified};
 }
 for(const p of Object.values(result))if(!result[p.accountId]||benchmarkFingerprint(result[p.accountId])!==benchmarkFingerprint(p))throw guidanceError(Error('Aliases must bind one canonical persistent account profile'), 'guid-290766e03afa6364');
 return result;
}
export function validateBenchmarkHostConfig(raw:unknown):BenchmarkHostConfig {
 const v=benchmarkObject(raw,['version','enabled','vaultPath','hostPath','operators','definitions','profiles','integrityKeyFile','answerFile']);
 if(v.version!==1||typeof v.enabled!=='boolean'||typeof v.vaultPath!=='string'||!isAbsolute(v.vaultPath)||typeof v.hostPath!=='string'||!isAbsolute(v.hostPath))throw guidanceError(Error('Invalid explicit host benchmark configuration'), 'guid-78172f22c4bb493d');
 if(!Array.isArray(v.operators)||!v.operators.length||v.operators.length>20||!Array.isArray(v.definitions)||v.definitions.length>100)throw guidanceError(Error('Invalid bounded benchmark configuration'), 'guid-5c002f40ee592bb2');
 const operators=v.operators.map(benchmarkId),definitions=v.definitions.map(validateBenchmarkDefinition),profiles=validateBenchmarkProfiles(v.profiles);
 if(new Set(operators).size!==operators.length||new Set(definitions.map(d=>d.id)).size!==definitions.length||new Set(definitions.map(d=>`${d.lineage}/${d.version}`)).size!==definitions.length)throw guidanceError(Error('Duplicate configured identity/version'), 'guid-3bd8a842f6bdf30a');
 if(operators.some(a=>Object.hasOwn(profiles,a)))throw guidanceError(Error('Human operators cannot be benchmark agent profiles'), 'guid-433afcc2491880ec');
 for(const d of definitions){
  assertBenchmarkCollectorIsolation(d,definitions,profiles);
  for(const a of [...d.participants,...d.reviewers])if(!profiles[a]?.approved||profiles[a]!.accountId!==a)throw guidanceError(Error('Definition requires explicitly approved canonical accounts'), 'guid-3c38c00cbe6635d0');
  if(d.mode==='peer'&&new Set(d.reviewers.filter(a=>profiles[a]!.modelVerified).map(a=>profiles[a]!.modelFamily)).size<2)throw guidanceError(Error('Two host-verified reviewer model families required'), 'guid-a04ffa120d56beeb');
 }
 const file=(v:unknown)=>{if(typeof v!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(v)||v==='.'||v==='..')throw guidanceError(Error('Private host file basename required'), 'guid-105f30db688ecafd');return v;};
 return {version:1,enabled:v.enabled,vaultPath:v.vaultPath,hostPath:v.hostPath,operators,definitions,profiles,integrityKeyFile:file(v.integrityKeyFile),...(v.answerFile!==undefined&&{answerFile:file(v.answerFile)})};
}
/** Key is supplied by a verified host-private reader, never a note/endpoint. */
export function createBenchmarkIntegrity(key:Uint8Array):BenchmarkIntegrity {
 if(!(key instanceof Uint8Array)||key.length<32||key.length>128)throw guidanceError(Error('Private integrity key must contain 32..128 bytes'), 'guid-7af3cddc985d0df9');
 const privateKey=Buffer.from(key);
 const sign=async(record:unknown)=>createHmac('sha256',privateKey).update(benchmarkFingerprint(record)).digest('hex');
 return {sign,verify:async(record,seal)=>typeof seal==='string'&&/^[a-f0-9]{64}$/.test(seal)&&timingSafeEqual(Buffer.from(await sign(record),'hex'),Buffer.from(seal,'hex'))};
}
const inside=(root:string,path:string)=>{const r=relative(root,path);return !r||(!isAbsolute(r)&&r!=='..'&&!r.startsWith(`..${sep}`));};
/** Read-only host loader. No numerical approval, key, directory or answer is created. */
export async function loadBenchmarkHostConfig(configPath:string,expectedVault:string):Promise<LoadedBenchmarkHostConfig> {
 try {
  if(!isAbsolute(configPath)||!isAbsolute(expectedVault))throw Error();
  const config=await realpath(configPath),vault=await realpath(expectedVault);
  const sourceRoots=await hostSourceRoots(import.meta.url);
  if(configPath!==config||inside(vault,config)||sourceRoots.some(source=>inside(source,config)))throw Error();
  const initialConfig=await readFederationFile(dirname(config),config,{maxBytes:512*1024});
  const parsed=validateBenchmarkHostConfig(JSON.parse(initialConfig));
  const host=await realpath(parsed.hostPath);
  if(await realpath(parsed.vaultPath)!==vault||parsed.hostPath!==host||inside(vault,host)||sourceRoots.some(source=>inside(source,host))||!inside(host,config)||/^\\\\|^\/\//.test(host))throw Error();
  const keyPath=join(host,parsed.integrityKeyFile),answerPath=parsed.answerFile?join(host,parsed.answerFile):undefined;
  const privatePaths=[host,config,keyPath,...(answerPath?[answerPath]:[])];
  await assertHostPrivateStorage(privatePaths);
  const initialKey=await readFederationFile(host,keyPath,{maxBytes:300}),keyText=initialKey.trim();
  if(!/^[a-f0-9]{64,256}$/i.test(keyText)||keyText.length%2)throw Error();
  const initialAnswers=answerPath?await readFederationFile(host,answerPath,{maxBytes:2*1024*1024}):'{}';
  const answers:unknown=JSON.parse(initialAnswers);
  if(!answers||typeof answers!=='object'||Array.isArray(answers)||Object.keys(answers).length>100)throw Error();
  for(const [id,value]of Object.entries(answers)){benchmarkId(id);if(typeof value!=='string'||value.length>12000)throw Error();}
  const frozenAnswers=answers as Record<string,string>,privateIntegrity=createBenchmarkIntegrity(Buffer.from(keyText,'hex'));
  let invalidated=false;
  const assertCurrent=async()=>{
   try {
    if(invalidated||await realpath(configPath)!==config||await realpath(parsed.hostPath)!==host||await realpath(expectedVault)!==vault)throw Error();
    await assertHostPrivateStorage(privatePaths);
    const [currentConfig,currentKey,currentAnswers]=await Promise.all([readFederationFile(host,config,{maxBytes:512*1024}),readFederationFile(host,keyPath,{maxBytes:300}),answerPath?readFederationFile(host,answerPath,{maxBytes:2*1024*1024}):Promise.resolve('{}')]);
    if(currentConfig!==initialConfig||currentKey!==initialKey||currentAnswers!==initialAnswers)throw Error();
   }catch{invalidated=true;throw guidanceError(Error('Benchmark host configuration changed or unavailable; verified restart required'), 'guid-14ae396d64012180');}
  };
  // Bind each record only to the answers for objective versions actually in that
  // record. Adding another definition does not invalidate old records; changing
  // an existing answer cannot silently regrade sealed entries after a restart.
  // This is keyed authentication: neither answer text nor a guessable answer
  // digest is stored in Markdown, a public definition, or the economy journal.
  const bound=(record:unknown)=>{
   const versions=(record as {versions?:Array<{definition:{id:string;mode:string}}>})?.versions??[];
   const expected=versions.filter(v=>v.definition.mode==='objective').map(v=>{const id=benchmarkId(v.definition.id);if(!Object.hasOwn(frozenAnswers,id))throw guidanceError(Error('Benchmark host answer unavailable'), 'guid-ed9abf92cea0ff6f');return {id,answer:frozenAnswers[id]};});
   return {domain:'benchmark-private-binding-v1',record,expected};
  };
  const integrity:BenchmarkIntegrity={sign:async r=>{await assertCurrent();return privateIntegrity.sign(bound(r));},verify:async(r,s)=>{await assertCurrent();return privateIntegrity.verify(bound(r),s);}};
  const profiles=structuredClone(parsed.profiles),operators=[...parsed.operators];
  return {...parsed,vaultPath:vault,hostPath:host,integrity,accountProfiles:async()=>{await assertCurrent();return structuredClone(profiles);},assertHumanOperator:async(actor)=>{await assertCurrent();if(!operators.includes(actor))throw guidanceError(Error('Human host operator required'), 'guid-57ee1ee12053015f');},answerReader:async(definitionId)=>{
   try {await assertCurrent();benchmarkId(definitionId);
    if(!Object.hasOwn(frozenAnswers,definitionId))throw Error();return frozenAnswers[definitionId]!;
   }catch{throw guidanceError(Error('Benchmark host answer unavailable'), 'guid-ed9abf92cea0ff6f');}
  }};
 }catch{throw guidanceError(Error('Benchmark host configuration unavailable; require private files outside Vault and source'), 'guid-f41ca1df3ef61ec6');}
}
