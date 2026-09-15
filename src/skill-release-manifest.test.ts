import { expect, test } from 'vitest';
const sha='a'.repeat(64),other='b'.repeat(64);
const sample=()=>({version:1,skillId:'review-doc',sourceFingerprint:sha,metadataEvidenceHash:sha,policyRevision:'procedural-release-v1',
  mode:'procedural_reference',mainResource:'procedure',resources:[{id:'procedure',blob:sha,bytes:120,title:'Review procedure',kind:'procedure'}],
  retainedFunctions:['Assess an authorized document.'],limitations:['No bundled code is executable.'],useWhen:['User requests a document review.'],avoidWhen:['Input is outside authorized scope.'],
  review:{reviewer:'current-session',evidenceHashes:[sha],normalCaseHashes:[sha,other,'c'.repeat(64)],adversarialCaseHashes:[sha,other,'c'.repeat(64),'d'.repeat(64)]}});
async function parser(){const m=await import('./skill-release-manifest.js').catch(()=>({parseSkillReleaseManifest:undefined}));
  expect(m.parseSkillReleaseManifest,'release manifests must be bounded declarative data').toBeTypeOf('function');return m.parseSkillReleaseManifest!;}
test('release manifests name hash-bound procedure resources and evidence, not executable grants',async()=>{
  const fn=await parser(),r=fn(sample());expect(r).toMatchObject({skillId:'review-doc',mode:'procedural_reference',mainResource:'procedure'});
  expect(r.resources[0]).toMatchObject({blob:sha,kind:'procedure'});
});
test('rejects missing tests, duplicate resources, missing entrypoint and arbitrary file or executable fields',async()=>{
  const fn=await parser();
  const variants:any[]=[{...sample(),executable:true},{...sample(),approved:true},{...sample(),mainResource:'missing'}];
  const noTests=sample();noTests.review.normalCaseHashes=[];variants.push(noTests);
  const duplicate=sample();duplicate.resources.push(duplicate.resources[0]!);variants.push(duplicate);
  const shell=sample();(shell.resources[0] as any).path='../../credentials';variants.push(shell);
  const binary=sample();binary.resources[0]!.kind='script';variants.push(binary);
  const overflow=sample();overflow.resources[0]!.bytes=1048577;variants.push(overflow);
  for(const value of variants)expect(()=>fn(value)).toThrow('Reviewed skill manifest unavailable');
});
test('limits release text, rejects secret-bearing descriptions and accessor properties',async()=>{
  const fn=await parser(),r=sample();r.limitations=['x'.repeat(513)];expect(()=>fn(r)).toThrow();
  const secret=sample();secret.retainedFunctions=['password=not-a-real-secret'];expect(()=>fn(secret)).toThrow();
  const accessor=sample();let invoked=false;Object.defineProperty(accessor,'review',{get(){invoked=true;return sample().review;},enumerable:true});
  expect(()=>fn(accessor)).toThrow();expect(invoked).toBe(false);
});
