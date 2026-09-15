import {afterEach,expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ScopeAuthService} from './scope-auth.js';
import {ScopeAccessPolicy} from './scope-access.js';
import {OwnerActivityRuntime} from './owner-activity-runtime.js';
import {OwnerActivityPolicy} from './owner-activity.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const hash=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex');
async function fixture(discover=false){
  const root=await mkdtemp(join(tmpdir(),'skill-release-service-'));roots.push(root);
  const auth=new ScopeAuthService(root),sponsor=await auth.register({accountId:'sponsor',modelId:'test',password:'synthetic-test-password'});
  await auth.register({accountId:'operator',agentId:'operator',modelId:'test',password:'synthetic-test-password',accessToken:sponsor.accessToken});
  await auth.updateAgentCapabilities({accessToken:sponsor.accessToken,agentId:'operator',capabilities:['profile']});
  const session=await auth.login({accountId:'operator',password:'synthetic-test-password'});
  expect(auth.hasCapability(session.principal,'write')).toBe(false);
  const source=hash('source'),body=Buffer.from('Review procedure. No bundled execution.');
  const manifest={version:1,skillId:'test-skill',sourceFingerprint:source,metadataEvidenceHash:hash('metadata'),policyRevision:'review-v1',mode:'procedural_reference',mainResource:'main',
    resources:[{id:'main',blob:hash(body),bytes:body.length,title:'Procedure',kind:'procedure'}],retainedFunctions:['Review source.'],limitations:['No execution.'],useWhen:['Authorized task.'],avoidWhen:['Missing source.'],
    review:{reviewer:'main',evidenceHashes:[hash('e')],normalCaseHashes:['n1','n2','n3'].map(hash),adversarialCaseHashes:['a1','a2','a3','a4'].map(hash)}};
  const m=Buffer.from(JSON.stringify(manifest));let visible=true,available=true,permitted=true,reads=0;
  const blobs=new Map([[hash(body),body],[hash(m),m]]);
  const host={async candidates(){return ['test-skill'];},async entry(){return available?{releaseHash:hash(m),sourceName:'test-skill',generation:'1'}:undefined;},assertFresh(){if(!available)throw Error('revoked');},
    async readBlob(h:string){reads++;return blobs.get(h)!;},async sourceFingerprint(){throw Error('Use inspected source, not a placeholder hash callback');},async verifyEvidence(){return true;}};
  const inspector={async inspect(){return {visible,inventory:{version:1 as const,rootId:hash(root),fingerprint:source,complete:true,reasons:[],executionAuthorized:false as const,
    files:[{path:'SKILL.md',bytes:10,sha256:hash('note')},{path:'private/ref.md',bytes:10,sha256:hash('ref')}]}};}};
  const access=new ScopeAccessPolicy(),original=access.canAccessPhysicalPath.bind(access);
  access.canAccessPhysicalPath=(p,...rest)=>permitted||!p.endsWith('/private/ref.md')?original(p,...rest):false;
  const policy=new OwnerActivityPolicy({version:1,owners:{operator:'owner'},grants:[{id:'grant',ownerId:'owner',accountIds:['operator'],activities:['skill-evolution'],actions:discover?['read','discover']:['read'],
    dataPrefixes:['Community/Skills'],executionTargets:['test-host'],expiresAt:'2999-01-01T00:00:00.000Z'}]});
  const owner=new OwnerActivityRuntime({policy:()=>policy,execution:p=>p?{accountId:p.accountId,executionTarget:'test-host'}:undefined});
  const module=await import('./skill-release-service.js').catch(()=>({ReviewedSkillService:undefined}));
  expect(module.ReviewedSkillService,'reviewed resolution must re-use current auth, source ACL and owner consent').toBeTypeOf('function');
  const service=new module.ReviewedSkillService!(host,inspector,access,auth,owner);
  const read=(extra:Record<string,unknown>={})=>service.resolve({skillId:'test-skill',accessToken:session.accessToken,principal:session.principal,...extra});
  return {read,service,host,auth,session:{accessToken:session.accessToken,principal:session.principal},hide:()=>{visible=false;},revoke:()=>{available=false;},denyReference:()=>{permitted=false;},get reads(){return reads;}};
}
test('current authenticated reader receives approved bytes without requiring write capability',async()=>{
  const f=await fixture();expect((await f.read()).content).toContain('Review procedure');
});
test('anonymous and forged identities cannot read a blob, even with a valid release record',async()=>{
  const f=await fixture();await expect(f.read({accessToken:undefined,principal:undefined})).rejects.toThrow();expect(f.reads).toBe(0);
  await expect(f.read({principal:{accountId:'operator',modelId:'invented',role:'model'}})).rejects.toThrow();expect(f.reads).toBe(0);
});
test('hidden original, inaccessible reference or absent approval cannot fall back to raw source',async()=>{
  for(const kind of ['hidden','reference','approval']){
    const f=await fixture();if(kind==='hidden')f.hide();else if(kind==='reference')f.denyReference();else f.revoke();
    await expect(f.read()).rejects.toThrow('Reviewed skill unavailable');
  }
});
test('logout during resource read invalidates the response',async()=>{
  const f=await fixture(),original=f.host.readBlob;
  f.host.readBlob=async h=>{const b=await original(h);await f.auth.endSession(f.session.accessToken);return b;};
  await expect(f.read()).rejects.toThrow('Reviewed skill unavailable');
});

test('discovery returns separate procedural cards with full conditions and registered reads, never evidence paths',async()=>{
  const f=await fixture(true);expect(f.service.discover).toBeTypeOf('function');
  const result=await f.service.discover({query:'Review',...f.session});
  expect(result.kind).toBe('reviewed_procedures');expect(result.partial).toBe(true);
  expect(result.cards).toHaveLength(1);
  expect(result.cards[0]).toMatchObject({skillId:'test-skill',executionAuthorized:false,limitations:['No execution.'],useWhen:['Authorized task.'],avoidWhen:['Missing source.']});
  expect(result.cards[0].nextAction.endpointId).toBe('skill.resolve');
  expect(JSON.stringify(result)).not.toMatch(/Community\/Skills|sourceFingerprint|physicalPath|"p":|accessToken/);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(4000);
});

test('discovery shares read validity and additionally requires owner discover consent',async()=>{
  for(const reason of ['read-only-consent','hidden','reference','revoked']){
    const f=await fixture(reason!=='read-only-consent');expect(f.service.discover).toBeTypeOf('function');
    if(reason==='hidden')f.hide();else if(reason==='reference')f.denyReference();else if(reason==='revoked')f.revoke();
    const result=await f.service.discover({query:'Review',...f.session});
    expect(result.cards).toEqual([]);expect(JSON.stringify(result)).not.toContain('test-skill');
    expect(result.partial).toBe(true);expect(result).not.toHaveProperty('hiddenCount');
  }
});

test('discovery cannot accept forged identity, candidate IDs, grant claims or relaxed strict queries',async()=>{
  const f=await fixture(true);expect(f.service.discover).toBeTypeOf('function');
  for(const extra of [{principal:undefined},{accessToken:undefined},{candidateIds:['test-skill']},{approved:true}]){
    await expect(f.service.discover({query:'Review',...f.session,...extra})).rejects.toThrow('Reviewed skill unavailable');
  }
  for(const query of ['"Review"','Review -source','path:Community/Skills','Review OR source']){
    const result=await f.service.discover({query,...f.session});expect(result.cards).toEqual([]);
  }
  expect(f.reads).toBe(0);
});

test('discovery revalidates retained cards after async work and again at actual dispatch',async()=>{
  const f=await fixture(true);expect(f.service.discover).toBeTypeOf('function');
  let fence:any;
  const result=await f.service.discover({query:'Review',...f.session},value=>{fence=value;});
  expect(result.cards).toHaveLength(1);expect(fence).toBeDefined();
  await f.auth.endSession(f.session.accessToken);
  expect(()=>fence.assertFresh()).toThrow();await expect(fence.revalidate()).rejects.toThrow();
});
