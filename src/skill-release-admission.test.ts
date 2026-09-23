import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm,rmdir,readdir,stat,symlink,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {skillReleaseReviewBasis} from './skill-release-evidence.js';
import {openReviewedSkillStore} from './skill-release-store.js';
import {openVaultReviewedSkills,VAULT_SKILL_REVIEWS} from './skill-release-vault.js';
import {readReviewedSkill} from './skill-release-reader.js';
import type {SkillReleaseManifest} from './skill-release-manifest.js';
const acl=vi.hoisted(()=>({deny:false}));
vi.mock('./windows-private-acl.js',()=>({checkWindowsPrivateAcl:async()=>{if(acl.deny)throw Error('denied');}}));
const roots:string[]=[];
afterEach(async()=>{acl.deny=false;for(const p of roots.splice(0))await rm(p,{recursive:true,force:true});});
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
async function fixture(descriptor?:unknown,independent=false){
  const root=await mkdtemp(join(tmpdir(),'skill-admission-'));roots.push(root);
  const hostPath=join(root,'host'),vaultPath=join(root,'vault');
  for(const p of [hostPath,vaultPath,...['entries','blobs','receipts'].map(n=>join(hostPath,n))])await mkdir(p,{mode:0o700});
  const blobs=new Map<string,Buffer>(),put=(v:unknown)=>{const b=Buffer.isBuffer(v)?v:Buffer.from(JSON.stringify(v));const h=hash(b);blobs.set(h,b);return h;};
  const source=hash('source'),body=Buffer.from('Synthetic reviewed procedure.'),bodyHash=put(body);
  const manifest:SkillReleaseManifest={version:1 as const,skillId:'test-skill',sourceFingerprint:source,metadataEvidenceHash:put({version:1,state:'evidence_valid',sourceFingerprint:source,releaseApproved:false,executionAuthorized:false}),
    policyRevision:'review-v1',mode:'procedural_reference' as const,mainResource:'main',resources:[{id:'main',blob:bodyHash,bytes:body.length,title:'Main',kind:'procedure' as const}],
    retainedFunctions:['Review.'],limitations:['No scripts.'],useWhen:['Authorized review.'],avoidWhen:['Unrelated task.'],review:{reviewer:'main',evidenceHashes:[] as string[],normalCaseHashes:[] as string[],adversarialCaseHashes:[] as string[]}};
  if(descriptor!==undefined){const blob=put(descriptor);manifest.descriptorResource='passport';
    manifest.resources.push({id:'passport',blob,bytes:blobs.get(blob)!.length,title:'Reviewed metadata',kind:'descriptor'});}
  const basis=skillReleaseReviewBasis(manifest),artifact=put({fixture:true,note:'Synthetic test evidence, not a real skill approval.'});
  const categories=['representative','boundary','mixed_language','secret_exfiltration','outside_write','forged_approval','reference_bypass'];
  const scenarios=categories.map((category,i)=>({id:`case-${i}`,category,task:'Synthetic task.',expected:'Synthetic outcome.'}));
  const scenarioSetHash=put({version:1,kind:'skill-test-plan',skillId:'test-skill',sourceFingerprint:source,scenarios});
  const trialArtifactHashes:string[]=[];
  scenarios.forEach((s,i)=>{
    let trialEvidenceHash:string|undefined;
    if(independent){
      const inputHash=put({testOnly:true,caseId:s.id,task:s.task}),responseHash=put({testOnly:true,caseId:s.id,response:'Synthetic response.'});
      const judgmentHash=put({version:1,kind:'skill-text-trial-judgment',basis,scenarioSetHash,caseId:s.id,reviewer:'main',inputHash,responseHash,outcome:'passed',limitations:['Synthetic text, no live effects.']});
      trialEvidenceHash=put({version:1,kind:'skill-independent-text-trial',basis,scenarioSetHash,caseId:s.id,reportedExecutorId:'fixture-worker',requestedModel:'fixture-model',modelIdentity:'unverified',scope:'synthetic_text_only',inputHash,responseHash,judgmentHash});
      trialArtifactHashes.push(inputHash,responseHash,judgmentHash,trialEvidenceHash);
    }
    const h=put({version:1,kind:'skill-case-result',basis,scenarioSetHash,caseId:s.id,reviewer:'main',method:independent?'independent_agent_text':'current_agent_behavior',outcome:'passed',observed:'Synthetic observation.',artifactHashes:[artifact],...(trialEvidenceHash?{trialEvidenceHash}:{})});
    (i<3?manifest.review.normalCaseHashes:manifest.review.adversarialCaseHashes).push(h);
  });
  manifest.review.evidenceHashes=[put({version:1,kind:'skill-release-review',basis,reviewer:'main',resourceIds:manifest.resources.map(r=>r.id),openCritical:0,checks:['static','semantic','license','feature_mapping'].map(kind=>({kind,outcome:'passed',artifactHashes:[artifact]}))})];
  const releaseHash=put(manifest),request={requestId:'canary-1',skillId:'test-skill',sourceName:'test-skill',releaseHash,scenarioSetHash,policyRevision:'review-v1',reviewer:'main',expectedRevision:null as string|null};
  let allowed=true,currentSource=source,refresh:undefined|(()=>Promise<void>);
  const options={hostPath,vaultPath,sourceFingerprint:async()=>currentSource,readCandidateBlob:async(h:string)=>{const b=blobs.get(h);if(!b)throw Error('missing');return b;},
    authorize:async()=>{if(!allowed)throw Error('denied');return {revalidate:async()=>{await refresh?.();if(!allowed)throw Error('denied');},assertFresh:()=>{if(!allowed)throw Error('denied');}};}};
  const module=await import('./skill-release-admission.js').catch(()=>({admitReviewedSkill:undefined}));
  expect(module.admitReviewedSkill,'private host admission must not be a Vault/MCP approval flag').toBeTypeOf('function');
  return {root,hostPath,vaultPath,blobs,body,request,options,trialArtifactHashes,entryPath:join(hostPath,'entries',hash('test-skill')+'.json'),
    admit:(r=request)=>module.admitReviewedSkill!(options,r),deny:()=>{allowed=false;},drift:()=>{currentSource=hash('changed');},onRefresh:(f:()=>Promise<void>)=>{refresh=f;}};
}
test('independent trial artifacts persist and revalidate on retry without granting execution',async()=>{
  const f=await fixture(undefined,true),first=await f.admit();expect(first.executionAuthorized).toBe(false);
  for(const h of f.trialArtifactHashes)expect(await readFile(join(f.hostPath,'blobs',h))).toEqual(f.blobs.get(h));
  f.blobs.clear();expect((await f.admit()).revision).toBe(first.revision);
});

test('NAS delivery needs no local body store and binds current output separately from original review evidence',async()=>{
  const f=await fixture({version:1,kind:'procedure',purpose:'Review permitted material.'});await f.admit();
  const metadata=join(f.vaultPath,VAULT_SKILL_REVIEWS),folder=join(f.vaultPath,'Community','Skills','test-skill');
  await mkdir(join(metadata,'blobs'),{recursive:true});await mkdir(folder,{recursive:true});
  const bodyPath=join(folder,'SKILL.md');
  const manifest=JSON.parse(f.blobs.get(f.request.releaseHash)!.toString()) as SkillReleaseManifest;
  const resources=manifest.resources.map(r=>({blob:r.blob,path:r.id===manifest.mainResource?'SKILL.md':'metadata.json'}));
  for(const r of resources)await writeFile(join(folder,r.path),f.blobs.get(r.blob)!);
  for(const [h,b] of f.blobs)if(!resources.some(r=>r.blob===h))await writeFile(join(metadata,'blobs',h),b);
  const contentFingerprint=hash('current NAS output');
  const registration=JSON.parse(await readFile(f.entryPath,'utf8'));
  const record={registration,contentFingerprint,resources};
  const registry=Buffer.from(JSON.stringify({version:1,entries:[record]})),registryPath=join(metadata,'registry.json');
  await writeFile(registryPath,registry);await rm(f.hostPath,{recursive:true});
  const open=()=>openVaultReviewedSkills({vaultPath:f.vaultPath,registryHash:hash(registry),sourceFingerprint:async()=>contentFingerprint});
  const store=await open(),permission={begin:async()=>({revalidate:async()=>{},assertFresh(){}})};
  const args={skillId:'test-skill'};
  expect((await readReviewedSkill(store,permission,args)).content).toBe(f.body.toString());
  expect((await readReviewedSkill(await open(),permission,args)).executionAuthorized).toBe(false);
  expect((await store.candidatesPage!()).candidates).toEqual(['test-skill']);
  // An unchanged archived copy must never conceal a changed current NAS file.
  await writeFile(join(metadata,'blobs',hash(f.body)),f.body);await writeFile(bodyPath,'changed');
  await expect(readReviewedSkill(store,permission,args)).rejects.toThrow();await writeFile(bodyPath,f.body);
  await expect(readReviewedSkill({...store,sourceFingerprint:async()=>hash('drift')},permission,args)).rejects.toThrow();
  await expect(readReviewedSkill(store,{begin:async()=>{throw Error('revoked');}},args)).rejects.toThrow();
  await expect(readReviewedSkill(store,permission,{...args,resourceId:'unregistered'})).rejects.toThrow();
  const entry=await store.entry('test-skill');
  await writeFile(registryPath,JSON.stringify({version:1,entries:[]}));
  expect(()=>store.assertFresh(entry!)).toThrow();await expect(open()).rejects.toThrow();
  for(const path of ['../outside.md','sub/../../outside.md','C:/outside.md','.hidden/SKILL.md']){
    const bad=Buffer.from(JSON.stringify({version:1,entries:[{...record,resources:[...record.resources,{blob:hash(path),path}]}]}));
    await writeFile(registryPath,bad);
    await expect(openVaultReviewedSkills({vaultPath:f.vaultPath,registryHash:hash(bad),sourceFingerprint:async()=>contentFingerprint})).rejects.toThrow();
  }
});
test('independent evidence does not bypass host denial or missing-response checks',async()=>{
  for(const change of ['authority','missing_response']){
    const f=await fixture(undefined,true);if(change==='authority')f.deny();else f.blobs.delete(f.trialArtifactHashes[1]!);
    await expect(f.admit()).rejects.toThrow('Reviewed skill admission unavailable');
    expect(await readdir(join(f.hostPath,'entries'))).toEqual([]);
    expect(await readdir(join(f.hostPath,'blobs'))).toEqual([]);
  }
});
test('publishes checked hash blobs before registry, rereads, and retries idempotently across reopening',async()=>{
  const f=await fixture(),first=await f.admit();expect(first.state).toBe('complete');expect(first.executionAuthorized).toBe(false);
  const bytes=await readFile(f.entryPath);expect(first.revision).toBe(hash(bytes));
  const second=await f.admit();expect(second.revision).toBe(first.revision);expect(await readFile(f.entryPath)).toEqual(bytes);
  const store=await openReviewedSkillStore({hostPath:f.hostPath,vaultPath:f.vaultPath,sourceFingerprint:f.options.sourceFingerprint});
  const entry=await store.entry('test-skill');expect(entry?.releaseHash).toBe(f.request.releaseHash);expect(await store.readBlob(hash(f.body))).toEqual(f.body);
});

test('valid reviewed descriptor is published but malformed or sensitive metadata never reaches registration',async()=>{
  const valid=await fixture({version:1,kind:'procedure',purpose:'Review permitted material.'});
  expect((await valid.admit()).state).toBe('complete');
  for(const value of [{version:1,kind:'procedure',purpose:'password=synthetic-secret'},
    {version:1,kind:'procedure',purpose:'Host record',hostApproval:true},null]){
    const f=await fixture(value);
    await expect(f.admit()).rejects.toThrow('Reviewed skill admission unavailable');
    expect(await readdir(join(f.hostPath,'entries'))).toEqual([]);
    expect(await readdir(join(f.hostPath,'blobs'))).toEqual([]);
  }
});
test('refuses absent authority, changed source and corrupt candidate without publishing approval',async()=>{
  for(const change of ['authority','source','blob']){
    const f=await fixture();if(change==='authority')f.deny();else if(change==='source')f.drift();else f.blobs.set(f.request.releaseHash,Buffer.from('{}'));
    await expect(f.admit()).rejects.toThrow();expect(await readdir(join(f.hostPath,'entries'))).toEqual([]);
  }
});
test('a registry edit during final authorization is preserved, never overwritten',async()=>{
  const f=await fixture();f.onRefresh(async()=>{await writeFile(f.entryPath,'user-changed',{mode:0o600});});
  await expect(f.admit()).rejects.toThrow();expect(await readFile(f.entryPath,'utf8')).toBe('user-changed');
});
test('a reused request ID with new content and a preexisting lock fail without takeover',async()=>{
  const f=await fixture();await f.admit();await expect(f.admit({...f.request,sourceName:'other'})).rejects.toThrow();
  const g=await fixture();await writeFile(join(g.hostPath,'writer.lock'),'unverified prior writer',{mode:0o600});
  await expect(g.admit()).rejects.toThrow();expect(await readFile(join(g.hostPath,'writer.lock'),'utf8')).toBe('unverified prior writer');
});
test('a completed request never resurrects a removed registration',async()=>{
  const f=await fixture();await f.admit();await rm(f.entryPath);
  await expect(f.admit()).rejects.toThrow();expect(await readdir(join(f.hostPath,'entries'))).toEqual([]);
});
test('prepared work resumes from stored blobs after a bounded failure; corrupt receipts stay untouched',async()=>{
  const f=await fixture();f.onRefresh(async()=>{throw Error('interrupted');});await expect(f.admit()).rejects.toThrow();
  const receipt=join(f.hostPath,'receipts',hash(f.request.requestId)+'.json');
  expect(JSON.parse(await readFile(receipt,'utf8')).state).toBe('prepared');
  expect(await readdir(join(f.hostPath,'entries'))).toEqual([]);
  f.onRefresh(async()=>{});f.blobs.clear();expect((await f.admit()).state).toBe('complete');
  await writeFile(receipt,'{');await expect(f.admit()).rejects.toThrow();expect(await readFile(receipt,'utf8')).toBe('{');
});
test('receipt changes before publication cannot leave an admitted entry',async()=>{
  const f=await fixture();f.onRefresh(async()=>{await writeFile(join(f.hostPath,'receipts',hash(f.request.requestId)+'.json'),'changed');});
  await expect(f.admit()).rejects.toThrow();expect(await readdir(join(f.hostPath,'entries'))).toEqual([]);
});
test('an already applied prepared record is reread without rewriting the registration',async()=>{
  const f=await fixture();await f.admit();const before=await stat(f.entryPath,{bigint:true});
  const receipt=join(f.hostPath,'receipts',hash(f.request.requestId)+'.json'),record=JSON.parse(await readFile(receipt,'utf8'));
  await writeFile(receipt,JSON.stringify({...record,state:'prepared'}));f.blobs.clear();
  expect((await f.admit()).state).toBe('complete');const after=await stat(f.entryPath,{bigint:true});
  expect(after.ino).toBe(before.ino);expect(after.mtimeNs).toBe(before.mtimeNs);
});
test('replacement requires the exact old revision and retains its hash-named recovery bytes',async()=>{
  const f=await fixture();const before={version:1,skillId:'test-skill',sourceName:'test-skill',state:'revoked',releaseHash:hash('old'),scenarioSetHash:hash('old-plan'),policyRevision:'review-v0',reviewer:'old-reviewer'};
  const bytes=Buffer.from(JSON.stringify(before));await writeFile(f.entryPath,bytes,{mode:0o600});
  await expect(f.admit()).rejects.toThrow();expect(await readFile(f.entryPath)).toEqual(bytes);
  expect((await f.admit({...f.request,expectedRevision:hash(bytes)})).state).toBe('complete');
  expect(await readFile(join(f.hostPath,'blobs',hash(bytes)))).toEqual(bytes);
});
test('replaced storage directory and revoked authority cannot publish an entry',async()=>{
  const f=await fixture();f.onRefresh(async()=>{f.deny();});await expect(f.admit()).rejects.toThrow();
  expect(await readdir(join(f.hostPath,'entries'))).toEqual([]);
  const g=await fixture(),outside=join(g.root,'outside');await mkdir(outside);
  let replaced=false;
  g.onRefresh(async()=>{await rmdir(join(g.hostPath,'entries'));await symlink(outside,join(g.hostPath,'entries'),process.platform==='win32'?'junction':'dir');replaced=true;});
  await expect(g.admit()).rejects.toThrow();expect(replaced).toBe(true);
  expect((await lstat(join(g.hostPath,'entries'))).isSymbolicLink()).toBe(true);
  expect(await readdir(outside)).toEqual([]);
});
