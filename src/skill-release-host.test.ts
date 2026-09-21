import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withEnterpriseRequestContext} from './enterprise-request-context.js';
import type {ScopePrincipal} from './scope-auth.js';
import {OwnerActivityRuntime} from './owner-activity-runtime.js';
const acl=vi.hoisted(()=>({deny:false}));
vi.mock('./windows-private-acl.js',()=>({checkWindowsPrivateAcl:async()=>{if(acl.deny)throw Error('denied');}}));
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();acl.deny=false;for(const p of roots.splice(0))await rm(p,{recursive:true,force:true});});
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

test('account-only reviewed reads need no certificates, bindings or extra listener',async()=>{
  const f=await fixture();
  f.policy.grants[0]!.executionTargets=['authenticated-skill-read'];await f.savePolicy();
  const grant=f.policy.grants[0]!;
  await writeFile(f.path,JSON.stringify({version:2,authorization:'account',vaultPath:f.config.vaultPath,hostPath:f.hostPath,ownerPolicyPath:f.ownerPolicyPath}));
  for(const path of [f.bindingsPath,f.config.listener.certPath,f.config.listener.keyPath,f.config.listener.caPath])await rm(path);
  const host=await f.load(),runtime=new OwnerActivityRuntime(host.ownerActivity);
  try{
    expect(host.listener).toBeUndefined();
    const paths=['Community/Skills/test-skill/SKILL.md'];
    const lease=await runtime.begin('skill-evolution','read',paths,principal);
    expect(lease.canAccessPath(paths[0]!)).toBe(true);
    await expect(runtime.begin('skill-evolution','read',paths)).rejects.toThrow();
    await expect(runtime.begin('skill-evolution','read',paths,{accountId:'other'} as ScopePrincipal)).rejects.toThrow();
    await expect(runtime.begin('skill-evolution','execute',paths,principal)).rejects.toThrow();
    f.policy.grants=[];await f.savePolicy();
    await expect(lease.revalidate()).rejects.toThrow();
  }finally{host.close();}
  f.policy.grants=[{...grant,executionTargets:['verified-host']}];await f.savePolicy();
  await expect(f.load()).rejects.toThrow('Reviewed skill host unavailable');
});

test('source-access host uses existing document permissions without an owner grant or certificate',async()=>{
  const f=await fixture();
  await writeFile(f.path,JSON.stringify({version:3,authorization:'source-access',vaultPath:f.config.vaultPath,hostPath:f.hostPath}));
  for(const p of [f.ownerPolicyPath,f.bindingsPath,f.config.listener.certPath,f.config.listener.keyPath,f.config.listener.caPath])await rm(p);
  const host=await f.load();
  try{
    expect(host.listener).toBeUndefined();expect(host.ownerActivity).toBeUndefined();expect(host.ownerPolicyPath).toBeUndefined();
    expect(host.reviewedSkills.authorization).toBeDefined();
    await host.reviewedSkills.authorization!.revalidate();
    expect(await host.reviewedSkills.host.entry('not-admitted')).toBeUndefined();
    await writeFile(f.path,(await readFile(f.path,'utf8'))+'\n');
    await expect(host.reviewedSkills.authorization!.revalidate()).rejects.toThrow();
    expect(()=>host.reviewedSkills.authorization!.assertFresh()).toThrow();
  }finally{host.close();}
});

test('a short host deadline expires warm authority and cannot be reopened after expiry',async()=>{
  const f=await fixture(),now=Date.now();
  (f.config as any).expiresAt=new Date(now+60_000).toISOString();await f.save();
  const host=await f.load();
  try{
    expect(withEnterpriseRequestContext(peer,()=>host.ownerActivity.execution(principal))).toBeDefined();
    const clock=vi.spyOn(Date,'now').mockReturnValue(now+60_000);
    expect(withEnterpriseRequestContext(peer,()=>host.ownerActivity.execution(principal))).toBeUndefined();
    await expect(host.ownerActivity.refresh()).rejects.toThrow();
    await expect(f.load()).rejects.toThrow();
    clock.mockReturnValue(now);
    expect(withEnterpriseRequestContext(peer,()=>host.ownerActivity.execution(principal))).toBeUndefined();
  }finally{host.close();}
});

test('host deadline rejects malformed, elapsed and longer-than-fifteen-minute windows',async()=>{
  const f=await fixture(),now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);
  for(const expiresAt of [null,42,'tomorrow',new Date(now).toISOString(),new Date(now+900_001).toISOString()]){
    (f.config as any).expiresAt=expiresAt;await f.save();await expect(f.load()).rejects.toThrow();
  }
});

test('elapsed monotonic time expires the host even when the wall clock moves backward',async()=>{
  const f=await fixture(),now=Date.now(),elapsed=performance.now();
  (f.config as any).expiresAt=new Date(now+60_000).toISOString();await f.save();
  vi.spyOn(performance,'now').mockReturnValue(elapsed);
  const host=await f.load();
  try{
    vi.spyOn(Date,'now').mockReturnValue(now-3600_000);
    vi.spyOn(performance,'now').mockReturnValue(elapsed+60_000);
    expect(withEnterpriseRequestContext(peer,()=>host.ownerActivity.execution(principal))).toBeUndefined();
    await expect(host.ownerActivity.refresh()).rejects.toThrow();
  }finally{host.close();}
});

test('discovery is disabled by default and only a pinned host config can opt in',async()=>{
  const f=await fixture(),before=await f.load();
  expect(before.listener.allowProcedureDiscovery).toBe(false);before.close();
  (f.config.listener as any).allowProcedureDiscovery=true;await f.save();
  const enabled=await f.load();
  try{
    expect(enabled.listener.allowProcedureDiscovery).toBe(true);
    (f.config.listener as any).allowProcedureDiscovery=false;await f.save();
    await expect(enabled.ownerActivity.refresh()).rejects.toThrow();
  }finally{enabled.close();}
  (f.config.listener as any).allowProcedureDiscovery='true';await f.save();
  await expect(f.load()).rejects.toThrow('Reviewed skill host unavailable');
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
