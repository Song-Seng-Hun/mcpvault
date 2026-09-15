import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withEnterpriseRequestContext} from './enterprise-request-context.js';
import type {ScopePrincipal} from './scope-auth.js';
const acl=vi.hoisted(()=>({deny:false,hook:undefined as undefined|(()=>Promise<void>)}));
vi.mock('./windows-private-acl.js',()=>({checkWindowsPrivateAcl:async()=>{if(acl.deny)throw Error('denied');await acl.hook?.();}}));
const roots:string[]=[];
afterEach(async()=>{acl.deny=false;acl.hook=undefined;for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const principal:ScopePrincipal={accountId:'operator',modelId:'codex',role:'agent',agentId:'operator',capabilities:[]};
const cert='a'.repeat(64);
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'skill-mtls-owner-'));roots.push(root);
  const vault=join(root,'vault'),host=join(root,'host');await mkdir(vault);await mkdir(host,{mode:0o700});
  const path=join(host,'clients.json');
  const definition={version:1,vaultPath:vault,bindings:[{accountId:'operator',executionTarget:'host-reader',certFingerprint:cert,expiresAt:'2999-01-01T00:00:00.000Z'}]};
  const save=(r:unknown)=>writeFile(path,JSON.stringify(r),{mode:0o600});await save(definition);
  const module=await import('./owner-activity-mtls.js').catch(()=>({loadOwnerMtlsBindings:undefined}));
  expect(module.loadOwnerMtlsBindings,'legacy account labels must not impersonate a verified host channel').toBeTypeOf('function');
  const binding=await module.loadOwnerMtlsBindings!(path,vault);return {path,vault,definition,save,binding};
}
test('a binding file alone gives no execution identity; only TLS context plus matching authenticated account does',async()=>{
  const f=await fixture();expect(f.binding.execution(principal)).toBeUndefined();
  expect(withEnterpriseRequestContext({transport:'http'},()=>f.binding.execution({...principal,certFingerprint:cert} as any))).toBeUndefined();
  expect(withEnterpriseRequestContext({transport:'stdio',certFingerprint:cert},()=>f.binding.execution(principal))).toBeUndefined();
  expect(withEnterpriseRequestContext({transport:'http',certFingerprint:cert},()=>f.binding.execution(undefined))).toBeUndefined();
  expect(withEnterpriseRequestContext({transport:'http',certFingerprint:cert},()=>f.binding.execution({...principal,accountId:'other'}))).toBeUndefined();
  expect(withEnterpriseRequestContext({transport:'http',certFingerprint:cert},()=>f.binding.execution(principal)))
    .toEqual({accountId:'operator',executionTarget:'host-reader'});
});
test('revocation, certificate change, expiration and invalid file clear warm bindings',async()=>{
  const f=await fixture(),resolve=()=>withEnterpriseRequestContext({transport:'http',certFingerprint:cert},()=>f.binding.execution(principal));
  for(const patch of [{bindings:[]},{bindings:[{...f.definition.bindings[0],certFingerprint:'b'.repeat(64)}]},
    {bindings:[{...f.definition.bindings[0],expiresAt:'2000-01-01T00:00:00.000Z'}]}]){
    await f.save({...f.definition,...patch});await f.binding.refresh();expect(resolve()).toBeUndefined();
  }
  await f.save(f.definition);await f.binding.refresh();expect(resolve()).toBeDefined();
  await f.save({...f.definition,local:true});await expect(f.binding.refresh()).rejects.toThrow();expect(resolve()).toBeUndefined();
});
test('rejects ambiguous certificate identities, wrong Vault and forged grant fields',async()=>{
  const f=await fixture();
  const bad=[{...f.definition,vaultPath:join(f.vault,'other')},
    {...f.definition,bindings:[f.definition.bindings[0],{...f.definition.bindings[0],executionTarget:'different'}]},
    {...f.definition,bindings:[{...f.definition.bindings[0],allowWrite:true}]}];
  for(const value of bad){await f.save(value);await expect(f.binding.refresh()).rejects.toThrow();}
});

test('revocation during the final ACL check cannot publish the older binding',async()=>{
  const f=await fixture();let checks=0;
  acl.hook=async()=>{if(++checks===2)await f.save({...f.definition,bindings:[]});};
  await expect(f.binding.refresh()).rejects.toThrow('Owner mTLS binding unavailable');
  expect(withEnterpriseRequestContext({transport:'http',certFingerprint:cert},()=>f.binding.execution(principal))).toBeUndefined();
});
