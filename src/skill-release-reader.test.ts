import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
async function fixture(){
  const body=Buffer.from('# Review\nPreserve source exceptions.\n');
  const reference=Buffer.from('# Reference\nKeep the original condition.\n');
  const source=hash('source'),policy='procedural-release-v1';
  const manifest={version:1,skillId:'review-doc',sourceFingerprint:source,metadataEvidenceHash:hash('metadata'),policyRevision:policy,mode:'procedural_reference',mainResource:'procedure',
    resources:[{id:'procedure',blob:hash(body),bytes:body.length,title:'Review',kind:'procedure'},
      {id:'reference',blob:hash(reference),bytes:reference.length,title:'Reference',kind:'reference'}],retainedFunctions:['Review source conditions.'],limitations:['No script execution.'],useWhen:['A document review is requested.'],avoidWhen:['Source is inaccessible.'],
    review:{reviewer:'main',evidenceHashes:[hash('review')],normalCaseHashes:[hash('n1'),hash('n2'),hash('n3')],adversarialCaseHashes:[hash('a1'),hash('a2'),hash('a3'),hash('a4')]}};
  const bytes=Buffer.from(JSON.stringify(manifest));let generation='1',allowed=true,currentSource=source,reads=0;
  const blobs=new Map([[hash(body),body],[hash(reference),reference],[hash(bytes),bytes]]);
  const host={
    async entry(id:string){return id==='review-doc'?{releaseHash:hash(bytes),generation,sourceName:id}:undefined;},
    assertFresh(entry:{generation:string},blobHashes:readonly string[]=[]){
      if(entry.generation!==generation)throw Error('registry changed');
      for(const sha of blobHashes){const bytes=blobs.get(sha);if(!bytes||hash(bytes)!==sha)throw Error('blob changed');}
    },
    async readBlob(sha:string){reads++;const b=blobs.get(sha);if(!b)throw Error('missing');return b;},
    async sourceFingerprint(){return currentSource;},
    async verifyEvidence(){return true;},
  };
  const security={async begin(){if(!allowed)throw Error('denied');return {async revalidate(){if(!allowed)throw Error('denied');},assertFresh(){if(!allowed)throw Error('denied');}};}};
  const module=await import('./skill-release-reader.js').catch(()=>({readReviewedSkill:undefined}));
  expect(module.readReviewedSkill,'reviewed reader must not fall back to a quarantined source').toBeTypeOf('function');
  return {read:(p:Record<string,unknown>={})=>module.readReviewedSkill!(host,security,{skillId:'review-doc',...p}),host,security,blobs,body,reference,
    deny:()=>{allowed=false;},drift:()=>{currentSource=hash('new source');},revoke:()=>{generation='2';},get reads(){return reads;}};
}
test('returns only registered hash-verified procedure bytes, without executable permission or host path',async()=>{
  const f=await fixture(),r=await f.read();expect(r.content).toBe(f.body.toString());expect(r.executionAuthorized).toBe(false);
  expect(r.status).toBe('reviewed_limited');expect(r.limitations).toContain('No script execution.');
  expect(JSON.stringify(r)).not.toContain('sourceName');expect(JSON.stringify(r)).not.toContain('readBlob');
});
test('anonymous/denied reads do not load any blobs; source drift and invalid evidence stay unavailable',async()=>{
  const f=await fixture();f.deny();await expect(f.read()).rejects.toThrow('Reviewed skill unavailable');expect(f.reads).toBe(0);
  const g=await fixture();g.drift();await expect(g.read()).rejects.toThrow('Reviewed skill unavailable');
  const h=await fixture();h.host.verifyEvidence=async()=>false;await expect(h.read()).rejects.toThrow('Reviewed skill unavailable');
});
test('rejects tampered resources, unregistered IDs and stale expected release',async()=>{
  const f=await fixture();f.blobs.set(hash(f.body),Buffer.from('tampered'));
  await expect(f.read()).rejects.toThrow();
  const g=await fixture();await expect(g.read({resourceId:'../secret'})).rejects.toThrow();
  await expect(g.read({expectedRelease:'0'.repeat(64)})).rejects.toThrow();
});
test('rechecks authorization and registry generation after the final resource read',async()=>{
  for(const kind of ['permission','registry']){
    const f=await fixture(),read=f.host.readBlob;
    f.host.readBlob=async sha=>{const value=await read(sha);if(sha===hash(f.body)){if(kind==='permission')f.deny();else f.revoke();}return value;};
    await expect(f.read()).rejects.toThrow('Reviewed skill unavailable');
  }
});
test('bounded continuation retains exact release and resource; does not send notes.read to original',async()=>{
  const f=await fixture(),r=await f.read({maxChars:1024});expect(JSON.stringify(r).length).toBeLessThanOrEqual(1024);
  expect(r.executionAuthorized).toBe(false);
  await expect(f.read({maxChars:1})).rejects.toThrow();
});
test('registry revoked during final permission refresh is not returned as an approved result',async()=>{
  const f=await fixture(),begin=f.security.begin;
  f.security.begin=async()=>{const lease=await begin();return {...lease,async revalidate(){await lease.revalidate();f.revoke();}};};
  await expect(f.read()).rejects.toThrow('Reviewed skill unavailable');
});

test('tampering with an unrequested approved reference invalidates the whole release',async()=>{
  const f=await fixture();f.blobs.set(hash(f.reference),Buffer.from('changed reference'));
  await expect(f.read({resourceId:'procedure'})).rejects.toThrow('Reviewed skill unavailable');
});

test('final dispatcher permission refresh cannot conceal a changed unrequested reference',async()=>{
  const f=await fixture(),begin=f.security.begin;let refreshes=0;
  f.security.begin=async()=>{const lease=await begin();return {...lease,async revalidate(){
    await lease.revalidate();if(++refreshes===2)f.blobs.set(hash(f.reference),Buffer.from('late reference change'));
  }};};
  const {readReviewedSkill}=await import('./skill-release-reader.js');
  let fence:import('./skill-release-reader.js').ReviewedSkillDeliveryFence|undefined;
  await readReviewedSkill(f.host,f.security,{skillId:'review-doc'},value=>{fence=value;});
  await expect(fence!.revalidate()).rejects.toThrow('Reviewed skill unavailable');
  expect(()=>fence!.assertFresh()).toThrow('Reviewed skill unavailable');
});

test('approved discovery is a bounded card, not source metadata or procedure text',async()=>{
  const f=await fixture(),r=await f.read({view:'metadata'});
  expect(r.view).toBe('metadata');expect(r.content).toBeUndefined();
  expect(r.card.functions).toEqual(['Review source conditions.']);
  expect(r.nextAction.arguments).toMatchObject({view:'procedure',expectedRelease:r.releaseRevision,resourceId:'procedure'});
  expect(r.resources.map((v:any)=>v.resourceId)).toEqual(['procedure','reference']);
  expect(JSON.stringify(r)).not.toContain('evidenceHashes');
  expect(JSON.stringify(r)).not.toContain('metadataEvidenceHash');
  expect(r.executionAuthorized).toBe(false);
  expect(JSON.stringify(await f.read({view:'metadata',maxChars:1024})).length).toBeLessThanOrEqual(1024);
  await expect(f.read({view:'metadata',offset:1})).rejects.toThrow();
});

test('metadata cards share source integrity, permission and revocation checks',async()=>{
  for(const kind of ['source','reference','permission','registry']){
    const f=await fixture();
    if(kind==='source')f.drift();else if(kind==='reference')f.blobs.set(hash(f.reference),Buffer.from('tampered'));
    else {const begin=f.security.begin;f.security.begin=async()=>{const lease=await begin();return {...lease,async revalidate(){await lease.revalidate();kind==='permission'?f.deny():f.revoke();}};};}
    await expect(f.read({view:'metadata'})).rejects.toThrow('Reviewed skill unavailable');
  }
});

test('unreviewed impact, usage and connections stay explicitly unknown, not approved low risk',async()=>{
  const f=await fixture();
  const impact=await f.read({view:'metadata',section:'impact',axis:'assets'});
  expect(impact.impact.axes.assets.level).toBe('unknown');expect(impact.impact.permissionGranted).toBe(false);
  expect((await f.read({view:'metadata',section:'usage'})).usage).toBeNull();
  expect((await f.read({view:'metadata',section:'connections'})).connections).toBeNull();
  await expect(f.read({view:'metadata',section:'usage',axis:'assets'})).rejects.toThrow();
  await expect(f.read({view:'procedure',section:'summary'})).rejects.toThrow();
});
