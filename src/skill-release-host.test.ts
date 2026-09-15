import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withEnterpriseRequestContext} from './enterprise-request-context.js';
import type {ScopePrincipal} from './scope-auth.js';
const acl=vi.hoisted(()=>({deny:false}));
vi.mock('./windows-private-acl.js',()=>({checkWindowsPrivateAcl:async()=>{if(acl.deny)throw Error('denied');}}));
const roots:string[]=[];
afterEach(async()=>{acl.deny=false;for(const p of roots.splice(0))await rm(p,{recursive:true,force:true});});
const principal={accountId:'operator'} as ScopePrincipal;
const peer={transport:'http' as const,certFingerprint:'a'.repeat(64)};
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'reviewed-host-'));roots.push(root);
  const vaultPath=join(root,'vault'),hostPath=join(root,'host');
  for(const p of [vaultPath,hostPath,...['entries','blobs','receipts'].map(n=>join(hostPath,n))])await mkdir(p,{mode:0o700});
  const ownerPolicyPath=join(hostPath,'owner.json'),bindingsPath=join(hostPath,'bindings.json');
  const policy={version:1,vaultPath,owners:{operator:'owner'},grants:[{id:'read',ownerId:'owner',accountIds:['operator'],activities:['skill-evolution'],actions:['read','discover'],dataPrefixes:['Community/Skills'],executionTargets:['verified-host'],expiresAt:'2999-01-01T00:00:00.000Z'}]};
  const binding={version:1,vaultPath,bindings:[{accountId:'operator',executionTarget:'verified-host',certFingerprint:'a'.repeat(64),expiresAt:'2999-01-01T00:00:00.000Z'}]};
  const listener={port:0,certPath:join(hostPath,'cert.pem'),keyPath:join(hostPath,'key.pem'),caPath:join(hostPath,'ca.pem')};
  for(const p of [listener.certPath,listener.keyPath,listener.caPath])await writeFile(p,'Synthetic TLS material; no real listener in this unit test.',{mode:0o600});
  await writeFile(ownerPolicyPath,JSON.stringify(policy),{mode:0o600});await writeFile(bindingsPath,JSON.stringify(binding),{mode:0o600});
  const config={version:1,vaultPath,hostPath,ownerPolicyPath,bindingsPath,listener},path=join(hostPath,'reviewed.json');
  await writeFile(path,JSON.stringify(config),{mode:0o600});
  const module=await import('./skill-release-host.js').catch(()=>({loadReviewedSkillsHost:undefined}));
  expect(module.loadReviewedSkillsHost).toBeTypeOf('function');
  return {config,path,policy,ownerPolicyPath,bindingsPath,hostPath,load:()=>module.loadReviewedSkillsHost!(path,vaultPath),
    save:async()=>{await writeFile(path,JSON.stringify(config));},savePolicy:async()=>{await writeFile(ownerPolicyPath,JSON.stringify(policy));}};
}

test('loads an explicit private read-only skill bridge, with fixed loopback mandatory mTLS',async()=>{
  const f=await fixture(),host=await f.load();
  try{
    expect(host.listener).toMatchObject({host:'127.0.0.1',port:0,requireClientCertificate:true,requestProfile:'reviewed-skill-read',tls:{requestCert:true,rejectUnauthorized:true}});
    expect(host.ownerActivity.execution(principal)).toBeUndefined();
    expect(withEnterpriseRequestContext(peer,()=>host.ownerActivity.execution(principal))).toEqual({accountId:'operator',executionTarget:'verified-host'});
    expect(await host.reviewedSkills.host.entry('not-admitted')).toBeUndefined();
    expect(host).not.toHaveProperty('admit');
  }finally{host.close();}
});

test('rejects malformed config, private ACL failure, broad action grants and non-skill paths',async()=>{
  for(const kind of ['config','acl','action','activity','path']){
    const f=await fixture();
    if(kind==='config'){(f.config.listener as any).host='0.0.0.0';await f.save();}
    else if(kind==='acl')acl.deny=true;
    else {const g=f.policy.grants[0]!;if(kind==='action')g.actions.push('execute');else if(kind==='activity')g.activities.push('economy');else g.dataPrefixes=['.'];await f.savePolicy();}
    await expect(f.load()).rejects.toThrow('Reviewed skill host unavailable');acl.deny=false;
  }
});

test('live config and TLS file changes invalidate the bridge rather than silently rebinding',async()=>{
  for(const kind of ['config','key']){
    const f=await fixture(),host=await f.load();
    try{
      const p=kind==='config'?f.path:f.config.listener.keyPath;await writeFile(p,(await readFile(p,'utf8'))+'\n');
      expect(withEnterpriseRequestContext(peer,()=>host.ownerActivity.execution(principal))).toBeUndefined();
      await expect(host.ownerActivity.refresh()).rejects.toThrow();
    }finally{host.close();}
  }
});

test('policy broadening and binding revocation fail before current reads; closing revokes local bridge',async()=>{
  const f=await fixture(),host=await f.load();
  try{
    f.policy.grants[0]!.actions.push('execute');await f.savePolicy();
    await expect(host.ownerActivity.refresh()).rejects.toThrow();
    expect(withEnterpriseRequestContext(peer,()=>host.ownerActivity.execution(principal))).toBeUndefined();
  }finally{host.close();}
  const g=await fixture(),other=await g.load();
  try{
    await writeFile(g.bindingsPath,'{');await expect(other.ownerActivity.refresh()).rejects.toThrow();
    expect(withEnterpriseRequestContext(peer,()=>other.ownerActivity.execution(principal))).toBeUndefined();
  }finally{other.close();}
  expect(withEnterpriseRequestContext(peer,()=>other.ownerActivity.execution(principal))).toBeUndefined();
});
