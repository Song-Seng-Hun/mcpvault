import { createHash } from 'node:crypto';
import { parseSkillDescriptor, type SkillDescriptor } from './skill-descriptor.js';
import type { SkillInventory } from './skill-review-inventory.js';

const FIELDS=['kind','domains','purpose','useWhen','avoidWhen','keywords','inputs','outputs','effects','connections','examples','impactClaims','compatibility','relatedSkills','incompatibleSkills'] as const;
type Field=typeof FIELDS[number];
export interface SkillMetadataEvidence {fields:Field[];path:string;sha256:string;startLine:number;endLine:number;quote:string;interpretation:'literal'|'reviewer_inference'}
const fail=():never=>{throw Error('Skill metadata evidence unavailable');};
const sha=(v:unknown):string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:fail();
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return fail();
  if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return fail();
  const out:Record<string,unknown>={};
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string'||!keys.includes(key))return fail();
    const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)return fail();out[key]=d.value;
  }
  return out;
}
function text(value:unknown,max:number):string{
  return typeof value==='string'&&value.trim().length>0&&value.length<=max&&!value.includes('\0')?value:fail();
}
function evidence(value:unknown):SkillMetadataEvidence{
  const row=object(value,['fields','path','sha256','startLine','endLine','quote','interpretation']);
  if(!Array.isArray(row.fields)||!row.fields.length||row.fields.length>FIELDS.length||row.fields.some(f=>!FIELDS.includes(f))||new Set(row.fields).size!==row.fields.length)return fail();
  const path=text(row.path,500);
  if(path.startsWith('/')||path.includes('\\')||path.includes(':')||path.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)))return fail();
  const startLine=row.startLine,endLine=row.endLine;
  if(typeof startLine!=='number'||typeof endLine!=='number'||!Number.isSafeInteger(startLine)||!Number.isSafeInteger(endLine)||startLine<1||endLine<startLine||endLine-startLine>200||endLine>100000)return fail();
  if(row.interpretation!=='literal'&&row.interpretation!=='reviewer_inference')return fail();
  return {fields:row.fields,path,sha256:sha(row.sha256),startLine,endLine,quote:text(row.quote,8192),interpretation:row.interpretation};
}

/** Host-side evidence check only. A quote match proves bytes, not interpretation.
 * readSource must be a confined, bounded host reader, never an endpoint path loader. */
export async function validateSkillMetadataEvidence(input:unknown,inventory:SkillInventory,readSource:(path:string)=>Promise<Buffer>){
  try{
    const row=object(input,['version','targetId','sourceFingerprint','reviewer','descriptor','evidence','unknowns']);
    if(row.version!==1||!inventory.complete||!inventory.fingerprint||row.sourceFingerprint!==inventory.fingerprint)return fail();
    const targetId=sha(row.targetId),sourceFingerprint=sha(row.sourceFingerprint),reviewer=text(row.reviewer,100);
    if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(reviewer))return fail();
    const descriptor:SkillDescriptor=parseSkillDescriptor(row.descriptor);
    if(descriptor.kind==='unknown'||!descriptor.domains.length||!descriptor.useWhen.length||!descriptor.avoidWhen.length)return fail();
    if((descriptor.kind==='tool'||descriptor.kind==='hybrid')&&!descriptor.examples.length)return fail();
    if(!Array.isArray(row.evidence)||!row.evidence.length||row.evidence.length>64)return fail();
    const proofs=row.evidence.map(evidence),unknown=object(row.unknowns,FIELDS),unknowns:Partial<Record<Field,string>>={};
    for(const [key,value] of Object.entries(unknown))unknowns[key as Field]=text(value,512);
    if(JSON.stringify({descriptor,evidence:proofs,unknowns}).length>65536)return fail();
    const covered=new Set(proofs.flatMap(p=>p.fields));
    for(const field of FIELDS){
      const value=descriptor[field],populated=Array.isArray(value)?value.length>0:true;
      if(populated&&!covered.has(field)||!populated&&!covered.has(field)&&!unknowns[field]||covered.has(field)&&unknowns[field])return fail();
    }
    const files=new Map(inventory.files.map(f=>[f.path,f])),cache=new Map<string,string[]>();
    // Validate every locator before asking the host reader for any bytes.
    for(const p of proofs){const f=files.get(p.path);if(!f||f.sha256!==p.sha256||f.bytes>2*1024*1024)return fail();}
    for(const p of proofs){
      if(!cache.has(p.path)){
        const bytes=await readSource(p.path),file=files.get(p.path)!;
        if(!Buffer.isBuffer(bytes)||bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)return fail();
        cache.set(p.path,new TextDecoder('utf-8',{fatal:true}).decode(bytes).split('\n'));
      }
      const lines=cache.get(p.path)!;
      if(p.endLine>lines.length||lines.slice(p.startLine-1,p.endLine).join('\n')!==p.quote)return fail();
    }
    return {version:1 as const,state:'evidence_valid' as const,targetId,sourceFingerprint,reviewer,descriptor,evidence:proofs,unknowns,
      semanticVerification:'not_proven_by_locator_checks' as const,executionAuthorized:false as const,releaseApproved:false as const,
      usage:{resolvedCalls:null,verifiedApplications:null,observation:'not_supplied' as const}};
  }catch{return fail();}
}
