import {dirname,parse,join} from 'node:path';
import {lstatSync,realpathSync} from 'node:fs';
import {canonicalRoleplayPath,validateRoleplayStorage} from './roleplay-storage-host.js';
import {assertHostPrivateStorage} from './skill-evolution-host.js';
import {readFederationFile} from './public-federation-storage.js';
import {OwnerActivityPolicy} from './owner-activity.js';
import type {OwnerActivityRuntimeOptions} from './owner-activity-runtime.js';
import {loadOwnerMtlsBindings} from './owner-activity-mtls.js';
import {createSkillSourceInspector} from './skill-release-source.js';
import {openReviewedSkillStore} from './skill-release-store.js';
import type {McpHttpOptions} from './mcp-http.js';

const fail=():never=>{throw Error('Reviewed skill host unavailable');};
function record(v:unknown,keys:string[],optional:string[]=[]):Record<string,any>{
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)&&!optional.includes(k))||keys.some(k=>!Object.hasOwn(v,k)))return fail();
  return v as Record<string,any>;
}
function stamp(path:string,max:number):string{
  const root=parse(path).root;let current=root;
  for(const part of path.slice(root.length).split(/[\\/]+/).filter(Boolean)){
    current=join(current,part);if(lstatSync(current).isSymbolicLink())return fail();
  }
  const s=lstatSync(path,{bigint:true});
  if(!s.isFile()||s.nlink!==1n||s.size<1n||s.size>BigInt(max)||realpathSync(path)!==path)return fail();
  return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}:${s.nlink}:${s.mode}`;
}

/** Explicit host opt-in only. Reads existing private material; never creates an
 * account, certificate, listener, approval, grant, MCP registration or directory.
 * The CLI starts a separate loopback mTLS listener without changing public HTTP.
 * This bridge accepts only skill read/discover grants, even if another activity
 * already has broader consent elsewhere. A reviewed skill grants no execution. */
export async function loadReviewedSkillsHost(path:string,expectedVault:string){
  let source:ReturnType<typeof createSkillSourceInspector>|undefined;
  try{
    const readPrivate=async(p:string,max:number)=>{
      const canonical=await canonicalRoleplayPath(p,true,true);
      await validateRoleplayStorage({hostPath:dirname(canonical),vaultPath:expectedVault});
      await assertHostPrivateStorage([dirname(canonical),canonical]);const before=stamp(canonical,max);
      const text=await readFederationFile(dirname(canonical),canonical,{maxBytes:max});
      await assertHostPrivateStorage([dirname(canonical),canonical]);if(stamp(canonical,max)!==before)return fail();
      return {path:canonical,text,stamp:before,max};
    };
    const config=await readPrivate(path,8192),raw=record(JSON.parse(config.text),['version','vaultPath','hostPath','ownerPolicyPath','bindingsPath','listener'],['expiresAt']);
    // Optional short inspection lease, not an access grant. Its absolute expiry
    // survives reloads; monotonic time also bounds reads after wall-clock rollback.
    let expiresAt=Infinity,deadline=Infinity;
    if(Object.hasOwn(raw,'expiresAt')){
      expiresAt=typeof raw.expiresAt==='string'?Date.parse(raw.expiresAt):NaN;
      const remaining=expiresAt-Date.now();
      if(!Number.isFinite(expiresAt)||new Date(expiresAt).toISOString()!==raw.expiresAt||remaining<=0||remaining>900_000)return fail();
      deadline=performance.now()+remaining;
    }
    if(raw.version!==1||typeof raw.vaultPath!=='string'||await canonicalRoleplayPath(raw.vaultPath,false)!==await canonicalRoleplayPath(expectedVault,false))return fail();
    const {hostPath,vaultPath}=await validateRoleplayStorage({hostPath:raw.hostPath,vaultPath:expectedVault});
    const listenerRaw=record(raw.listener,['port','certPath','keyPath','caPath'],['allowProcedureDiscovery']);
    if(listenerRaw.allowProcedureDiscovery!==undefined&&typeof listenerRaw.allowProcedureDiscovery!=='boolean')return fail();
    if(!Number.isSafeInteger(listenerRaw.port)||listenerRaw.port<0||listenerRaw.port>65535)return fail();
    const cert=await readPrivate(listenerRaw.certPath,65536),key=await readPrivate(listenerRaw.keyPath,65536),ca=await readPrivate(listenerRaw.caPath,262144);
    const pins=[config,cert,key,ca];let closed=false,ready=false,policyStamp:string|undefined;
    const ownerPolicyPath=await canonicalRoleplayPath(raw.ownerPolicyPath,true,true);
    const bindings=await loadOwnerMtlsBindings(raw.bindingsPath,vaultPath);
    let policy=new OwnerActivityPolicy({version:1,owners:{},grants:[]});
    const assertPins=()=>{
      if(Date.now()>=expiresAt||performance.now()>=deadline){closed=true;ready=false;source?.close();}
      if(closed)return fail();for(const pin of pins)if(stamp(pin.path,pin.max)!==pin.stamp)return fail();
    };
    let queue=Promise.resolve();
    const refresh=()=>{
      const run=async()=>{
        ready=false;
        try{
          assertPins();
          for(const pin of pins)await assertHostPrivateStorage([dirname(pin.path),pin.path]);
          const owner=await readPrivate(ownerPolicyPath,262144),data=record(JSON.parse(owner.text),['version','vaultPath','owners','grants']);
          if(typeof data.vaultPath!=='string'||await canonicalRoleplayPath(data.vaultPath,false)!==vaultPath)return fail();
          const next=new OwnerActivityPolicy({version:data.version,owners:data.owners,grants:data.grants});
          if(data.grants.some((g:any)=>g.activities.some((v:string)=>v!=='skill-evolution')||g.actions.some((v:string)=>v!=='read'&&v!=='discover')
            ||g.dataPrefixes.some((v:string)=>v!=='Community/Skills'&&!v.startsWith('Community/Skills/'))))return fail();
          await bindings.refresh();assertPins();if(stamp(owner.path,owner.max)!==owner.stamp)return fail();
          policy=next;policyStamp=owner.stamp;ready=true;
        }catch{policyStamp=undefined;return fail();}
      };
      const pending=queue.then(run,run);queue=pending.catch(()=>undefined);return pending;
    };
    await refresh();
    const ownerActivity:OwnerActivityRuntimeOptions&{refresh:()=>Promise<void>}={refresh,policy:()=>policy,
      execution:principal=>{try{assertPins();if(!ready||!policyStamp||stamp(ownerPolicyPath,262144)!==policyStamp)return undefined;return bindings.execution(principal);}catch{return undefined;}}};
    source=createSkillSourceInspector(vaultPath);const inspector=source;
    const host=await openReviewedSkillStore({hostPath,vaultPath,sourceFingerprint:async name=>{
      const r=await inspector.inspect(name);return r?.visible&&r.inventory.complete?r.inventory.fingerprint:null;
    }});
    const listener:McpHttpOptions={host:'127.0.0.1',port:listenerRaw.port,requireClientCertificate:true,requestProfile:'reviewed-skill-read',
      allowProcedureDiscovery:listenerRaw.allowProcedureDiscovery===true,
      tls:{cert:cert.text,key:key.text,ca:ca.text,requestCert:true,rejectUnauthorized:true}};
    assertPins();
    return {ownerPolicyPath,ownerActivity,reviewedSkills:{host,source:inspector},listener,
      close(){closed=true;ready=false;inspector.close();}};
  }catch{source?.close();return fail();}
}
