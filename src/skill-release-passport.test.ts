import {expect,test} from 'vitest';
import {createHash} from 'node:crypto';
import {readReviewedSkill,type ReviewedSkillDeliveryFence} from './skill-release-reader.js';
import {parseSkillReleaseManifest} from './skill-release-manifest.js';
import {skillReleaseReviewBasis} from './skill-release-evidence.js';
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
function fixture(descriptor:unknown={version:1,kind:'procedure',domains:['software-engineering/review'],purpose:'Review an authorized change.',
  useWhen:['A supplied diff needs review.'],avoidWhen:['Unrelated work.'],keywords:['review','검토'],
  effects:['read_private'],connections:[{kind:'path',target:'registered-resource:guide',effects:[]}],
  examples:[{query:'검토만 해줘',action:'review_change',expected:'Report evidence without editing.'}],
  impactClaims:[{axis:'accounts',level:'high',scenario:'A bad review can miss revoked access.',assumptions:['A separate actor implements the suggestion.'],jurisdictions:[],references:['procedure:line1']}]
}){
  const blobs=new Map<string,Buffer>(),put=(value:unknown)=>{const b=Buffer.from(JSON.stringify(value));blobs.set(hash(b),b);return hash(b);};
  const body=Buffer.from('Review current evidence.');blobs.set(hash(body),body);
  const descriptorHash=put(descriptor),source=hash('original');
  const manifest:any={version:1,skillId:'review-skill',sourceFingerprint:source,
    metadataEvidenceHash:put({purpose:'UNREVIEWED SOURCE DECLARATION',state:'evidence_valid'}),policyRevision:'review-v1',mode:'procedural_reference',mainResource:'procedure',descriptorResource:'passport',
    resources:[{id:'procedure',blob:hash(body),bytes:body.length,title:'Procedure',kind:'procedure'},
      {id:'passport',blob:descriptorHash,bytes:blobs.get(descriptorHash)!.length,title:'Reviewed metadata',kind:'descriptor'}],
    retainedFunctions:['Review evidence.'],limitations:['No execution or new permissions.'],useWhen:['Authorized review.'],avoidWhen:['Outside actual scope.'],
    review:{reviewer:'reviewer',evidenceHashes:[hash('e')],normalCaseHashes:[hash('n1'),hash('n2'),hash('n3')],adversarialCaseHashes:[hash('a1'),hash('a2'),hash('a3'),hash('a4')]}};
  let release=put(manifest),allowed=true,generation='one';
  const host={entry:async()=>({releaseHash:release,generation,sourceName:'review-skill'}),
    readBlob:async(h:string)=>{const b=blobs.get(h);if(!b)throw Error('missing');return b;},
    sourceFingerprint:async()=>source,verifyEvidence:async()=>true,
    assertFresh:(e:{generation:string},hashes:readonly string[]=[])=>{if(e.generation!==generation)throw Error('revoked');for(const h of hashes){const b=blobs.get(h);if(!b||hash(b)!==h)throw Error('changed');}}};
  const security={begin:async()=>{if(!allowed)throw Error('denied');return {revalidate:async()=>{if(!allowed)throw Error('denied');},assertFresh:()=>{if(!allowed)throw Error('denied');}};}};
  return {manifest,descriptor,descriptorHash,blobs,host,security,put,
    republish:()=>{release=put(manifest);},deny:()=>{allowed=false;},revoke:()=>{generation='two';},
    read:(p:Record<string,unknown>={},capture?:(f:ReviewedSkillDeliveryFence)=>void)=>readReviewedSkill(host,security,{skillId:'review-skill',view:'metadata',...p},capture)};
}
test('a distinct reviewed descriptor is a registered bounded resource, not source evidence',()=>{
  const f=fixture();expect(parseSkillReleaseManifest(f.manifest)).toMatchObject({descriptorResource:'passport'});
  for(const mutate of [(m:any)=>{m.descriptorResource='procedure';},(m:any)=>{delete m.descriptorResource;},
    (m:any)=>{m.resources[1].bytes=32769;},(m:any)=>{m.resources.push({...m.resources[1],id:'second'}); }]){
    const m=structuredClone(f.manifest);mutate(m);expect(()=>parseSkillReleaseManifest(m)).toThrow();
  }
});
test('approved description, search card and examples come from the separate resource',async()=>{
  const f=fixture(),r=await f.read({section:'description',maxChars:12000});
  expect(r.descriptor.purpose).toBe('Review an authorized change.');
  expect(r.metadataScope).toBe('reviewed_release_descriptor');expect(r.executionAuthorized).toBe(false);
  expect(JSON.stringify(r)).not.toContain('UNREVIEWED SOURCE');expect(JSON.stringify(r)).not.toContain('metadataEvidenceHash');
  const card=await f.read();expect(card.card.domains).toEqual(['software-engineering/review']);
  expect(card.card.example.action).toBe('review_change');expect(card.requiredReads.some((a:any)=>a.arguments.section==='impact')).toBe(true);
});
test('impact retains conditional consequences while real grants and usage remain unknown',async()=>{
  const f=fixture(),r=await f.read({section:'impact',axis:'accounts',maxChars:12000});
  expect(r.impact.axes.accounts.level).toBe('high');expect(r.impact.permissionGranted).toBe(false);
  expect(r.claims[0].assumptions).toEqual(['A separate actor implements the suggestion.']);
  expect((await f.read({section:'connections'})).connections[0].target).toBe('registered-resource:guide');
  expect((await f.read({section:'usage'})).usage).toBeNull();
});
test('legacy release without descriptor remains readable and does not borrow source declarations',async()=>{
  const f=fixture();delete f.manifest.descriptorResource;f.manifest.resources.pop();f.republish();
  const r=await f.read();expect(r.missing).toContain('reviewed_descriptor');expect(r.card.purpose).toBeUndefined();
  expect((await f.read({section:'impact',axis:'accounts'})).impact.axes.accounts.level).toBe('unknown');
});
test('malformed, sensitive or foreign passport data prevents metadata and body delivery',async()=>{
  for(const descriptor of [{version:1,kind:'procedure',purpose:'password=fake-value'},
    {version:1,kind:'procedure',purpose:'Private path',connections:[{kind:'path',target:'C:/Users/private/secret',effects:[]}]},
    {version:1,kind:'procedure',purpose:'Declared approved',approved:true}]){
    const f=fixture(descriptor);for(const p of [{},{view:'procedure'}])await expect(f.read(p)).rejects.toThrow('Reviewed skill unavailable');
  }
});
test('small packets do not drop conditions while exposing functional recommendations',async()=>{
  const f=fixture();f.manifest.limitations=Array.from({length:8},(_,i)=>`Required limit ${i}: `+'x'.repeat(200));f.republish();
  const r=await f.read({maxChars:1024});expect(JSON.stringify(r).length).toBeLessThanOrEqual(1024);
  expect(r.partial).toBe(true);expect(r.card).toBeUndefined();expect(r.nextAction.arguments.expectedRelease).toBe(r.releaseRevision);
});
test('descriptor changes during final permission refresh invalidate metadata and dispatcher delivery',async()=>{
  for(const refresh of [1,2]){
    const f=fixture(),begin=f.security.begin;let count=0;
    f.security.begin=async()=>{const lease=await begin();return {...lease,revalidate:async()=>{await lease.revalidate();if(++count===refresh)f.blobs.set(f.descriptorHash,Buffer.from('{}'));}};};
    let fence:ReviewedSkillDeliveryFence|undefined;
    if(refresh===1)await expect(f.read()).rejects.toThrow('Reviewed skill unavailable');
    else {await f.read({},v=>{fence=v;});await expect(fence!.revalidate()).rejects.toThrow('Reviewed skill unavailable');}
  }
});
test('current permission and registry revocation still refuse reviewed descriptor output',async()=>{
  for(const revoke of ['account','entry']){
    const f=fixture(),begin=f.security.begin;
    f.security.begin=async()=>{const lease=await begin();return {...lease,revalidate:async()=>{await lease.revalidate();revoke==='account'?f.deny():f.revoke();}};};
    await expect(f.read()).rejects.toThrow('Reviewed skill unavailable');
  }
});
test('changing the descriptor pointer changes the immutable evidence basis',()=>{
  const f=fixture(),before=skillReleaseReviewBasis(f.manifest);f.manifest.descriptorResource='other';
  expect(skillReleaseReviewBasis(f.manifest)).not.toBe(before);
});

test('large impact packets continue by axis instead of repeating the same oversized request',async()=>{
  const claims=['domain','policy','legal','assets','accounts','data','system'].map(axis=>({axis,level:'high',
    scenario:'s'.repeat(480),assumptions:['a'.repeat(230)],references:['r'.repeat(120),'q'.repeat(120)],jurisdictions:[]}));
  const f=fixture({version:1,kind:'procedure',purpose:'Synthetic bounded impact test',impactClaims:claims});
  const packet=await f.read({section:'impact',maxChars:12000});
  expect(JSON.stringify(packet).length).toBeLessThanOrEqual(12000);expect(packet.partial).toBe(true);
  expect(packet.nextAction.arguments.axis).toBe('domain');expect(packet.requiredReads).toHaveLength(7);
  const detail=await f.read(packet.nextAction.arguments);expect(detail.partial).toBe(false);
  expect(Object.keys(detail.impact.axes)).toEqual(['domain']);
});

test('an oversized full descriptor continues as exact registered bytes with every restriction retained',async()=>{
  const descriptor={version:1,kind:'procedure',purpose:'Bounded descriptor',keywords:Array.from({length:24},(_,i)=>`${i}-`+'k'.repeat(100)),
    outputs:Array.from({length:8},(_,i)=>`${i}-`+'o'.repeat(240))};
  const f=fixture(descriptor);f.manifest.limitations=Array.from({length:12},(_,i)=>`${i}:`+'x'.repeat(498));
  f.manifest.useWhen=Array.from({length:8},(_,i)=>`${i}:`+'y'.repeat(248));f.republish();
  const packet=await f.read({section:'description',maxChars:12000});
  expect(packet.partial).toBe(true);expect(JSON.stringify(packet).length).toBeLessThanOrEqual(12000);
  expect(packet.nextAction.arguments).toMatchObject({view:'procedure',resourceId:'passport'});
  let action=packet.nextAction.arguments,content='',finished=false;
  for(let i=0;i<8;i++){
    const page=await readReviewedSkill(f.host,f.security,action);expect(page.limitations).toEqual(f.manifest.limitations);
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(12000);content+=page.content;
    if(!page.partial){finished=true;break;}
    expect(page.nextAction.arguments.offset).toBeGreaterThan(page.offset);action=page.nextAction.arguments;
  }
  expect(finished).toBe(true);expect(JSON.parse(content)).toEqual(descriptor);
});
