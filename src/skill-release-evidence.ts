import {createHash} from 'node:crypto';
import {parseSkillReleaseManifest,type SkillReleaseManifest} from './skill-release-manifest.js';
import {parseReleaseDescriptor} from './skill-release-descriptor.js';

const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const fail=():never=>{throw Error('Reviewed skill evidence unavailable');};
const text=(v:unknown,max=4096):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!/[\u0000\u202a-\u202e\u2066-\u2069]/.test(v);
const normal=['representative','boundary','mixed_language'];
const adversarial=['secret_exfiltration','outside_write','forged_approval','reference_bypass'];
function row(v:unknown,keys:string[]):Record<string,any>{
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(v,k)))return fail();
  return v as Record<string,any>;
}
function hashes(v:unknown):string[]{
  if(!Array.isArray(v)||v.length<1||v.length>16||!v.every(hash)||new Set(v).size!==v.length)return fail();return v;
}

/** Consistency of a reported independent text trial, not attestation that a
 * different model ran, saw no expected answers, or enforced real tool effects. */
async function independentTextTrial(h:unknown,expected:{basis:string;scenarioSetHash:string;caseId:string;reviewer:string},
  json:(hash:string)=>Promise<any>,bytes:(hash:string)=>Promise<Buffer>):Promise<boolean>{
  if(!hash(h))return false;
  const t=row(await json(h),['version','kind','basis','scenarioSetHash','caseId','reportedExecutorId','requestedModel','modelIdentity','scope','inputHash','responseHash','judgmentHash']);
  if(t.version!==1||t.kind!=='skill-independent-text-trial'||t.basis!==expected.basis||t.scenarioSetHash!==expected.scenarioSetHash||t.caseId!==expected.caseId
    ||!text(t.reportedExecutorId,100)||!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(t.reportedExecutorId)||t.reportedExecutorId===expected.reviewer
    ||!text(t.requestedModel,160)||t.modelIdentity!=='unverified'||t.scope!=='synthetic_text_only'
    ||![t.inputHash,t.responseHash,t.judgmentHash].every(hash)||new Set([t.inputHash,t.responseHash,t.judgmentHash]).size!==3)return false;
  await bytes(t.inputHash);await bytes(t.responseHash);
  const j=row(await json(t.judgmentHash),['version','kind','basis','scenarioSetHash','caseId','reviewer','inputHash','responseHash','outcome','limitations']);
  return j.version===1&&j.kind==='skill-text-trial-judgment'&&j.basis===expected.basis&&j.scenarioSetHash===expected.scenarioSetHash&&j.caseId===expected.caseId
    &&j.reviewer===expected.reviewer&&j.inputHash===t.inputHash&&j.responseHash===t.responseHash&&j.outcome==='passed'
    &&Array.isArray(j.limitations)&&j.limitations.length>=1&&j.limitations.length<=8&&j.limitations.every((v:unknown)=>text(v,512));
}

/** Excludes evidence hashes to avoid a circular digest. Includes every delivered
 * resource and condition: tests of an earlier derivative cannot approve new text. */
export function skillReleaseReviewBasis(m:SkillReleaseManifest):string{
  return digest(JSON.stringify({version:m.version,skillId:m.skillId,sourceFingerprint:m.sourceFingerprint,
    metadataEvidenceHash:m.metadataEvidenceHash,policyRevision:m.policyRevision,mode:m.mode,mainResource:m.mainResource,
    resources:m.resources,retainedFunctions:m.retainedFunctions,limitations:m.limitations,useWhen:m.useWhen,avoidWhen:m.avoidWhen,
    reviewer:m.review.reviewer,...(m.descriptorResource?{descriptorResource:m.descriptorResource}:{})}));
}

/** This trust anchor is provisioned by the host, never from a skill or MCP input.
 * Host preparation must pin the scenario set BEFORE authoring the derivative.
 * Hashes alone cannot prove when a human/agent actually performed a review. */
export interface SkillReleaseEvidenceAnchor {scenarioSetHash:string;policyRevision:string;reviewer:string}

/** Verifies bounded evidence-record consistency, not truth, legal clearance or
 * runtime authority. Actual review observations and host admission remain required. */
export async function verifySkillReleaseEvidence(input:SkillReleaseManifest,anchor:SkillReleaseEvidenceAnchor,
  readBlob:(hash:string)=>Promise<Buffer>):Promise<boolean>{
  try{
    const m=parseSkillReleaseManifest(input),basis=skillReleaseReviewBasis(m);
    if(m.policyRevision!==anchor.policyRevision||m.review.reviewer!==anchor.reviewer||!hash(anchor.scenarioSetHash))return false;
    let total=0;
    const cache=new Map<string,Buffer>();
    const bytes=async(h:string)=>{
      if(!hash(h))return fail();const found=cache.get(h);if(found)return found;
      if(cache.size>=128)return fail();
      const b=await readBlob(h);
      if(!Buffer.isBuffer(b)||!b.length||b.length>65536||digest(b)!==h||(total+=b.length)>1048576)return fail();
      cache.set(h,b);return b;
    };
    const json=async(h:string)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(h)));
    const artifacts=async(v:unknown)=>{for(const h of hashes(v))await bytes(h);};
    if(m.descriptorResource){
      const resource=m.resources.find(r=>r.id===m.descriptorResource)!;
      parseReleaseDescriptor(resource,await bytes(resource.blob));
    }
    const metadata=await json(m.metadataEvidenceHash);
    if(metadata?.version!==1||metadata.state!=='evidence_valid'||metadata.sourceFingerprint!==m.sourceFingerprint
      ||metadata.releaseApproved!==false||metadata.executionAuthorized!==false)return false;
    const plan=row(await json(anchor.scenarioSetHash),['version','kind','skillId','sourceFingerprint','scenarios']);
    if(plan.version!==1||plan.kind!=='skill-test-plan'||plan.skillId!==m.skillId||plan.sourceFingerprint!==m.sourceFingerprint
      ||!Array.isArray(plan.scenarios)||plan.scenarios.length!==7)return false;
    const scenarios=new Map<string,string>();
    for(const value of plan.scenarios){
      const s=row(value,['id','category','task','expected']);
      if(!text(s.id,100)||scenarios.has(s.id)||![...normal,...adversarial].includes(s.category)||!text(s.task)||!text(s.expected))return false;
      scenarios.set(s.id,s.category);
    }
    if(new Set(scenarios.values()).size!==7)return false;
    if(m.review.evidenceHashes.length!==1||m.review.normalCaseHashes.length!==3||m.review.adversarialCaseHashes.length!==4)return false;
    const review=row(await json(m.review.evidenceHashes[0]!),['version','kind','basis','reviewer','resourceIds','openCritical','checks']);
    if(review.version!==1||review.kind!=='skill-release-review'||review.basis!==basis||review.reviewer!==anchor.reviewer||review.openCritical!==0
      ||!Array.isArray(review.resourceIds)||review.resourceIds.length!==m.resources.length
      ||new Set(review.resourceIds).size!==m.resources.length||m.resources.some(r=>!review.resourceIds.includes(r.id))
      ||!Array.isArray(review.checks)||review.checks.length!==4)return false;
    const seenChecks=new Set<string>();
    for(const value of review.checks){
      const c=row(value,['kind','outcome','artifactHashes']);
      if(!['static','semantic','license','feature_mapping'].includes(c.kind)||seenChecks.has(c.kind)||c.outcome!=='passed')return false;
      seenChecks.add(c.kind);await artifacts(c.artifactHashes);
    }
    const seenCases=new Set<string>();
    for(const [caseHashes,categories] of [[m.review.normalCaseHashes,normal],[m.review.adversarialCaseHashes,adversarial]] as const){
      for(const h of caseHashes){
        const raw=await json(h);
        const independent=raw?.method==='independent_agent_text';
        const c=row(raw,['version','kind','basis','scenarioSetHash','caseId','reviewer','method','outcome','observed','artifactHashes',...(independent?['trialEvidenceHash']:[])]);
        if(c.version!==1||c.kind!=='skill-case-result'||c.basis!==basis||c.scenarioSetHash!==anchor.scenarioSetHash
          ||c.reviewer!==anchor.reviewer||!['current_agent_behavior','independent_agent_text'].includes(c.method)||c.outcome!=='passed'||!text(c.observed)
          ||seenCases.has(c.caseId)||!categories.includes(scenarios.get(c.caseId)??''))return false;
        if(independent&&!await independentTextTrial(c.trialEvidenceHash,{basis,scenarioSetHash:anchor.scenarioSetHash,caseId:c.caseId,reviewer:anchor.reviewer},json,bytes))return false;
        seenCases.add(c.caseId);await artifacts(c.artifactHashes);
      }
    }
    return seenCases.size===7;
  }catch{return false;}
}
