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
  return {manifest,blobs,put,verify,replace,scenarioSetHash,basis,artifact};
}

async function independentFixture(){
  const f=await fixture();
  const inputHash=f.put({testOnly:true,tasks:['Synthetic task 0'],expectedAnswersIncluded:false});
  const responseHash=f.put({testOnly:true,caseId:'case-0',answer:'Synthetic expected behavior.'});
  const judgmentHash=f.put({version:1,kind:'skill-text-trial-judgment',basis:f.basis,scenarioSetHash:f.scenarioSetHash,
    caseId:'case-0',reviewer:'reviewer',inputHash,responseHash,outcome:'passed',limitations:['Synthetic text only; no tool-effect or runtime-isolation proof.']});
  const trial={version:1,kind:'skill-independent-text-trial',basis:f.basis,scenarioSetHash:f.scenarioSetHash,caseId:'case-0',
    reportedExecutorId:'separate-test-worker',requestedModel:'test-model',modelIdentity:'unverified',scope:'synthetic_text_only',inputHash,responseHash,judgmentHash};
  const result=JSON.parse(f.blobs.get(f.manifest.review.normalCaseHashes[0]!)!.toString());
  const setTrial=(change:(value:any)=>void=()=>{})=>{const next=structuredClone(trial);change(next);const trialEvidenceHash=f.put(next);
    f.manifest.review.normalCaseHashes[0]=f.put({...result,method:'independent_agent_text',trialEvidenceHash});};
  setTrial();return {...f,trial,result,setTrial,inputHash,responseHash,judgmentHash};
}

test('accepts independently reported text trials with bound raw input, response and main judgment, without relabeling the method',async()=>{
  const f=await independentFixture();expect(await f.verify()).toBe(true);
  expect(JSON.parse(f.blobs.get(f.manifest.review.normalCaseHashes[0]!)!.toString()).method).toBe('independent_agent_text');
});
test('an independent method label alone or an author-method record carrying independent proof is rejected',async()=>{
  const f=await fixture();f.manifest.review.normalCaseHashes[0]=f.replace(f.manifest.review.normalCaseHashes[0]!,r=>{r.method='independent_agent_text';});expect(await f.verify()).toBe(false);
  const g=await independentFixture();g.manifest.review.normalCaseHashes[0]=g.replace(g.manifest.review.normalCaseHashes[0]!,r=>{r.method='current_agent_behavior';});expect(await g.verify()).toBe(false);
});
test('independent trial identity, basis, case, scope and artifact gaps fail closed',async()=>{
  for(const change of [
    (t:any)=>{t.basis=hash('other');},(t:any)=>{t.scenarioSetHash=hash('other');},(t:any)=>{t.caseId='case-1';},
    (t:any)=>{t.reportedExecutorId='reviewer';},(t:any)=>{t.requestedModel='';},(t:any)=>{t.modelIdentity='verified';},
    (t:any)=>{t.scope='live_execution';},(t:any)=>{t.inputHash=hash('missing');},(t:any)=>{t.responseHash=t.inputHash;},
    (t:any)=>{t.judgmentHash=hash('missing');},(t:any)=>{t.approved=true;},
  ]){const f=await independentFixture();f.setTrial(change);expect(await f.verify()).toBe(false);}
});
test('failed, absent or mismatched independent judgments do not become passing observations',async()=>{
  for(const change of [
    (j:any)=>{j.outcome='failed';},(j:any)=>{j.outcome='not_run';},(j:any)=>{j.reviewer='another';},
    (j:any)=>{j.caseId='case-1';},(j:any)=>{j.inputHash=hash('other');},(j:any)=>{j.responseHash=hash('other');},
    (j:any)=>{j.limitations=[];},(j:any)=>{j.basis=hash('other');},
  ]){const f=await independentFixture();const h=f.replace(f.judgmentHash,change);f.setTrial(t=>{t.judgmentHash=h;});expect(await f.verify()).toBe(false);}
});

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
