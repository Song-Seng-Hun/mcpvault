import {createHash,randomUUID} from 'node:crypto';
import {constants,openSync,closeSync,writeFileSync,fsyncSync,fstatSync,lstatSync,readSync,realpathSync,renameSync,unlinkSync,type BigIntStats} from 'node:fs';
import {join,dirname,parse} from 'node:path';
import {validateRoleplayStorage,canonicalRoleplayPath} from './roleplay-storage-host.js';
import {assertHostPrivateStorage} from './skill-evolution-host.js';
import {parseSkillReleaseManifest} from './skill-release-manifest.js';
import {verifySkillReleaseEvidence} from './skill-release-evidence.js';
import {parseReviewedSkillRegistration,type ReviewedSkillRegistration} from './skill-release-store.js';

const fail=():never=>{throw Error('Reviewed skill admission unavailable; preserve host records for review');};
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-z0-9][a-z0-9-]{0,99}$/.test(v);
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const identity=(s:BigIntStats)=>`${s.dev}:${s.ino}`;
const stamp=(s:BigIntStats)=>`${identity(s)}:${s.size}:${s.mtimeNs}:${s.ctimeNs}:${s.nlink}:${s.mode}`;
const missing=(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code==='ENOENT';
const encode=(v:unknown)=>Buffer.from(JSON.stringify(v));
export interface ReviewedSkillAdmissionRequest {
  requestId:string;skillId:string;sourceName:string;releaseHash:string;scenarioSetHash:string;
  policyRevision:string;reviewer:string;expectedRevision:string|null;
}
export interface ReviewedSkillAdmissionOptions {
  hostPath:string;vaultPath:string;
  sourceFingerprint:(sourceName:string)=>Promise<string|null>;
  readCandidateBlob:(hash:string)=>Promise<Buffer>;
  /** Trusted host policy callback only; reading a skill never supplies this authority. */
  authorize:(request:Readonly<ReviewedSkillAdmissionRequest>)=>Promise<{revalidate():Promise<void>;assertFresh():void}>;
}
function request(value:ReviewedSkillAdmissionRequest):Readonly<ReviewedSkillAdmissionRequest>{
  const keys=['requestId','skillId','sourceName','releaseHash','scenarioSetHash','policyRevision','reviewer','expectedRevision'];
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length
    ||Reflect.ownKeys(value).some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k)!,'value'))
    ||typeof value.requestId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value.requestId)
    ||!['skillId','sourceName','policyRevision','reviewer'].every(k=>id((value as any)[k]))
    ||!sha(value.releaseHash)||!sha(value.scenarioSetHash)||value.expectedRevision!==null&&!sha(value.expectedRevision))return fail();
  return Object.freeze(Object.fromEntries(keys.map(k=>[k,(value as any)[k]]))) as unknown as Readonly<ReviewedSkillAdmissionRequest>;
}

/** Host CLI/admin path only. No endpoint and no directory provisioning or stale-lock takeover.
 * Orphan hash blobs are harmless pending data; registry publication is last.
 * A prepared receipt allows re-verification of an already applied exact result. */
export async function admitReviewedSkill(options:ReviewedSkillAdmissionOptions,input:ReviewedSkillAdmissionRequest){
  let unlock:(()=>void)|undefined;
  try{
    const r=request(input),authorization=await options.authorize(r);
    authorization.assertFresh();
    const {hostPath}=await validateRoleplayStorage(options),directories=[hostPath,...['entries','blobs','receipts'].map(n=>join(hostPath,n))];
    for(const p of directories)await canonicalRoleplayPath(p,true);
    await assertHostPrivateStorage(directories);
    const bindings=new Map(directories.map(p=>[p,identity(lstatSync(p,{bigint:true}))]));
    const fence=()=>{
      const root=parse(hostPath).root;let p=root;
      for(const part of ['',...hostPath.slice(root.length).split(/[\\/]+/).filter(Boolean)]){
        if(part)p=join(p,part);const s=lstatSync(p);if(s.isSymbolicLink()||!s.isDirectory())return fail();
      }
      for(const p of directories){const s=lstatSync(p,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||identity(s)!==bindings.get(p)||realpathSync(p)!==p)return fail();}
    };
    const read=(path:string,max:number):Buffer|undefined=>{
      fence();let before:BigIntStats;try{before=lstatSync(path,{bigint:true});}catch(e){if(missing(e))return undefined;throw e;}
      if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size<1n||before.size>BigInt(max)||realpathSync(path)!==path)return fail();
      if(process.platform!=='win32'&&((before.mode&0o077n)!==0n||(process.getuid&&before.uid!==BigInt(process.getuid()))))return fail();
      const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      try{
        if(stamp(fstatSync(fd,{bigint:true}))!==stamp(before))return fail();
        const b=Buffer.alloc(Number(before.size));let n=0;while(n<b.length){const c=readSync(fd,b,n,b.length-n,n);if(!c)return fail();n+=c;}
        if(stamp(fstatSync(fd,{bigint:true}))!==stamp(before)||stamp(lstatSync(path,{bigint:true}))!==stamp(before))return fail();fence();return b;
      }finally{closeSync(fd);}
    };
    const checked=async(path:string,max:number)=>{
      fence();try{lstatSync(path);}catch(e){if(missing(e))return undefined;throw e;}
      await assertHostPrivateStorage([...directories,path]);return read(path,max);
    };
    const writeExclusive=(path:string,b:Buffer)=>{
      fence();authorization.assertFresh();const fd=openSync(path,'wx',0o600);
      try{writeFileSync(fd,b);fsyncSync(fd);return stamp(fstatSync(fd,{bigint:true}));}finally{closeSync(fd);}
    };
    const lock=join(hostPath,'writer.lock'),lockStamp=writeExclusive(lock,encode({version:1,requestHash:hash(encode(r)),nonce:randomUUID()}));
    unlock=()=>{try{fence();if(stamp(lstatSync(lock,{bigint:true}))===lockStamp)unlinkSync(lock);}catch{/* preserve unknown lock */}};
    const assertLock=()=>{fence();if(stamp(lstatSync(lock,{bigint:true}))!==lockStamp)return fail();authorization.assertFresh();};
    const atomic=(path:string,bytes:Buffer,expected:string|null,max:number)=>{
      assertLock();const temporary=join(dirname(path),`.pending-${randomUUID()}`),owned=writeExclusive(temporary,bytes);
      try{
        assertLock();const now=read(path,max);if((now?hash(now):null)!==expected)return fail();
        if(stamp(lstatSync(temporary,{bigint:true}))!==owned)return fail();
        renameSync(temporary,path);const result=read(path,max);if(!result||!result.equals(bytes))return fail();
      }finally{try{if(stamp(lstatSync(temporary,{bigint:true}))===owned)unlinkSync(temporary);}catch{/* renamed or changed */}}
    };
    const entryPath=join(hostPath,'entries',hash(r.skillId)+'.json'),receiptPath=join(hostPath,'receipts',hash(r.requestId)+'.json');
    const initial=await checked(entryPath,8192);if(initial)parseReviewedSkillRegistration(initial,r.skillId);
    const prior=await checked(receiptPath,8192),operationHash=hash(encode(r));
    let previous:any;
    if(prior){
      previous=JSON.parse(prior.toString());
      if(!previous||Object.keys(previous).sort().join(',')!=='operationHash,resultRevision,state,version'||previous.version!==1||previous.operationHash!==operationHash
        ||!['prepared','complete'].includes(previous.state)||!sha(previous.resultRevision))return fail();
    }
    const registration:ReviewedSkillRegistration={version:1,skillId:r.skillId,sourceName:r.sourceName,state:'admitted',releaseHash:r.releaseHash,
      scenarioSetHash:r.scenarioSetHash,policyRevision:r.policyRevision,reviewer:r.reviewer};
    const target=encode(registration),revision=hash(target),initialRevision=initial?hash(initial):null;
    if(previous?.state==='complete'&&initialRevision!==revision)return fail();
    if(previous&&previous.resultRevision!==revision||initialRevision!==r.expectedRevision&&!(previous&&initialRevision===revision))return fail();
    const blobs=new Map<string,Buffer>();let total=0;
    const load=async(h:string)=>{
      if(!sha(h))return fail();const cached=blobs.get(h);if(cached)return cached;if(blobs.size>=160)return fail();
      const stored=await checked(join(hostPath,'blobs',h),1048576),b=stored??await options.readCandidateBlob(h);
      if(!Buffer.isBuffer(b)||!b.length||b.length>1048576||hash(b)!==h||(total+=b.length)>6291456)return fail();
      const copy=Buffer.from(b);blobs.set(h,copy);return copy;
    };
    const manifestBytes=await load(r.releaseHash);if(manifestBytes.length>65536)return fail();
    const manifest=parseSkillReleaseManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes)));
    if(manifest.skillId!==r.skillId||await options.sourceFingerprint(r.sourceName)!==manifest.sourceFingerprint||!await verifySkillReleaseEvidence(manifest,r,load))return fail();
    for(const resource of manifest.resources){const b=await load(resource.blob);if(b.length!==resource.bytes)return fail();new TextDecoder('utf-8',{fatal:true}).decode(b);}
    for(const [h,b]of blobs){const p=join(hostPath,'blobs',h),exists=await checked(p,1048576);if(exists){if(!exists.equals(b))return fail();}else{assertLock();writeExclusive(p,b);}}
    const prepared=encode({version:1,operationHash,resultRevision:revision,state:'prepared'});
    if(!prior)atomic(receiptPath,prepared,null,8192);
    if(await options.sourceFingerprint(r.sourceName)!==manifest.sourceFingerprint)return fail();
    await authorization.revalidate();await assertHostPrivateStorage(directories);assertLock();
    for(const [h,b]of blobs){const stored=read(join(hostPath,'blobs',h),1048576);if(!stored||!stored.equals(b))return fail();}
    const current=read(entryPath,8192),currentRevision=current?hash(current):null;
    if(currentRevision!==initialRevision)return fail();
    const receiptCurrent=read(receiptPath,8192);if(!receiptCurrent||hash(receiptCurrent)!==hash(prior??prepared))return fail();
    // Already applied prepared/complete request: reread; never reapply old patches.
    if(currentRevision!==revision){if(currentRevision!==r.expectedRevision)return fail();
      if(current){const backup=join(hostPath,'blobs',hash(current));const found=read(backup,8192);if(found&&!found.equals(current))return fail();if(!found)writeExclusive(backup,current);}
      atomic(entryPath,target,currentRevision,8192);
    }
    if(previous?.state!=='complete')atomic(receiptPath,encode({version:1,operationHash,resultRevision:revision,state:'complete'}),hash(receiptCurrent),8192);
    assertLock();if(!read(entryPath,8192)?.equals(target))return fail();
    return {state:'complete' as const,skillId:r.skillId,revision,releaseHash:r.releaseHash,executionAuthorized:false as const};
  }catch{return fail();}finally{unlock?.();}
}
