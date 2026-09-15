import {createHash} from 'node:crypto';
import {expect,test} from 'vitest';
import type {SkillReleaseManifest} from './skill-release-manifest.js';

const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
async function fixture(){
  const m=await import('./skill-release-evidence.js').catch(()=>({skillReleaseReviewBasis:undefined,verifySkillReleaseEvidence:undefined}));
  expect(m.verifySkillReleaseEvidence,'hash lists alone must not count as completed review').toBeTypeOf('function');
  const blobs=new Map<string,Buffer>();
  const put=(value:unknown)=>{const b=Buffer.from(JSON.stringify(value));const h=hash(b);blobs.set(h,b);return h;};
  const source=hash('source'),metadata=put({version:1,state:'evidence_valid',sourceFingerprint:source,releaseApproved:false,executionAuthorized:false});
  const manifest:SkillReleaseManifest={version:1,skillId:'test-skill',sourceFingerprint:source,metadataEvidenceHash:metadata,
    policyRevision:'review-v1',mode:'procedural_reference',mainResource:'main',resources:[{id:'main',blob:hash('body'),bytes:4,title:'Procedure',kind:'procedure'}],
    retainedFunctions:['Review an authorized document.'],limitations:['No bundled execution.'],useWhen:['Authorized review.'],avoidWhen:['Unavailable source.'],
    review:{reviewer:'reviewer',evidenceHashes:[],normalCaseHashes:[],adversarialCaseHashes:[]}};
  const basis=m.skillReleaseReviewBasis!(manifest);
  const artifact=put({testOnly:true,note:'Synthetic test evidence; not a real skill review.'});
  const categories=['representative','boundary','mixed_language','secret_exfiltration','outside_write','forged_approval','reference_bypass'];
  const scenarios=categories.map((category,i)=>({id:`case-${i}`,category,task:`Synthetic task ${i}`,expected:`Expected safe result ${i}`}));
  const scenarioSetHash=put({version:1,kind:'skill-test-plan',skillId:manifest.skillId,sourceFingerprint:source,scenarios});
  for(const scenario of scenarios){
    const result=put({version:1,kind:'skill-case-result',basis,scenarioSetHash,caseId:scenario.id,reviewer:'reviewer',method:'current_agent_behavior',outcome:'passed',observed:'Synthetic expected behavior.',artifactHashes:[artifact]});
    (['representative','boundary','mixed_language'].includes(scenario.category)?manifest.review.normalCaseHashes:manifest.review.adversarialCaseHashes).push(result);
  }
  manifest.review.evidenceHashes=[put({version:1,kind:'skill-release-review',basis,reviewer:'reviewer',resourceIds:['main'],openCritical:0,
    checks:['static','semantic','license','feature_mapping'].map(kind=>({kind,outcome:'passed',artifactHashes:[artifact]}))})];
  const read=async(h:string)=>{const b=blobs.get(h);if(!b)throw Error('unavailable');return b;};
  const verify=()=>m.verifySkillReleaseEvidence!(manifest,{scenarioSetHash,policyRevision:'review-v1',reviewer:'reviewer'},read);
  const replace=(h:string,fn:(r:any)=>void)=>{const r=JSON.parse(blobs.get(h)!.toString());fn(r);return put(r);};
  return {manifest,blobs,put,verify,replace,scenarioSetHash};
}

test('accepts source/output/policy-bound completed synthetic evidence, without making runtime permission',async()=>{
  const f=await fixture();expect(await f.verify()).toBe(true);
});
test('rejects reuse for changed resource bytes, policy, source, conditions or reviewer',async()=>{
  for(const field of ['body','policy','source','conditions','reviewer']){
    const f=await fixture();
    if(field==='body')f.manifest.resources[0]!.blob=hash('other');
    if(field==='policy')f.manifest.policyRevision='review-v2';
    if(field==='source')f.manifest.sourceFingerprint=hash('other');
    if(field==='conditions')f.manifest.useWhen=['Different task.'];
    if(field==='reviewer')f.manifest.review.reviewer='other';
    expect(await f.verify()).toBe(false);
  }
});
test('not-run, static-only, failed, duplicate and missing cases never satisfy behavioral evaluation',async()=>{
  for(const change of ['not_run','static_only','failed','duplicate','missing']){
    const f=await fixture();
    if(change==='missing')f.manifest.review.adversarialCaseHashes.pop();
    else if(change==='duplicate')f.manifest.review.normalCaseHashes[1]=f.manifest.review.normalCaseHashes[0]!;
    else f.manifest.review.normalCaseHashes[0]=f.replace(f.manifest.review.normalCaseHashes[0]!,r=>{
      if(change==='static_only')r.method='static';else r.outcome=change;
    });
    expect(await f.verify()).toBe(false);
  }
});
test('rejects a substituted test plan, unreviewed resource, missing artifact and corrupt bytes',async()=>{
  const f=await fixture();f.manifest.review.normalCaseHashes[0]=f.replace(f.manifest.review.normalCaseHashes[0]!,r=>{r.scenarioSetHash=hash('other');});expect(await f.verify()).toBe(false);
  const g=await fixture();g.manifest.review.evidenceHashes[0]=g.replace(g.manifest.review.evidenceHashes[0]!,r=>{r.resourceIds=[];});expect(await g.verify()).toBe(false);
  const h=await fixture();h.manifest.review.evidenceHashes[0]=h.replace(h.manifest.review.evidenceHashes[0]!,r=>{r.checks[0].artifactHashes=[hash('missing')];});expect(await h.verify()).toBe(false);
  const i=await fixture();i.blobs.set(i.manifest.review.evidenceHashes[0]!,Buffer.from('{}'));expect(await i.verify()).toBe(false);
});
