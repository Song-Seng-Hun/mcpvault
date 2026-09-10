import { guidanceError } from './guidance-runtime.js';
import {randomUUID} from 'node:crypto';
import {lstat,open,realpath,unlink,type FileHandle} from 'node:fs/promises';
import {isAbsolute,join,relative,sep} from 'node:path';
import {assertHostPrivateStorage} from './skill-evolution-host.js';
import {hostSourceRoots} from './host-source-roots.js';
import {readFederationFile} from './public-federation-storage.js';
import {benchmarkFingerprint} from './benchmark-model.js';
import type {LoadedBenchmarkHostConfig} from './benchmark-host.js';

export interface BenchmarkWriter {close():Promise<void>;assertHeld():Promise<void>}
const inside=(root:string,path:string)=>{const r=relative(root,path);return !r||(!isAbsolute(r)&&r!=='..'&&!r.startsWith(`..${sep}`));};
/** One local host writer per canonical Vault. Runtime and offline host CLI must
 * acquire the same configured host-directory lease before any benchmark write.
 * A leftover marker is a recovery condition, never an invitation to steal it. */
export async function acquireBenchmarkWriter(config:LoadedBenchmarkHostConfig):Promise<BenchmarkWriter>{
 if(!config.enabled)return {close:async()=>{},assertHeld:async()=>{}};
 await config.accountProfiles();
 const host=await realpath(config.hostPath),vault=await realpath(config.vaultPath);
 if(config.hostPath!==host||config.vaultPath!==vault||!isAbsolute(host)||/^\\\\|^\/\//.test(host)||inside(vault,host)||(await hostSourceRoots(import.meta.url)).some(root=>inside(root,host)))throw guidanceError(Error('Benchmark writer requires canonical local host-private storage'), 'guid-03aa23e4697a7317');
 await assertHostPrivateStorage([host]);
 const path=join(host,`benchmark-${benchmarkFingerprint(vault.toLowerCase())}.writer.lock`),nonce=randomUUID();
 let handle:FileHandle;
 try{handle=await open(path,'wx',0o600);}catch{throw guidanceError(Error('Benchmark writer lock exists or is unavailable; stop the owning runtime or perform explicit offline maintenance'), 'guid-d9c63dcf4e0cbde3');}
 const marker={version:1,vault,pid:process.pid,nonce};
 try{await handle.writeFile(JSON.stringify(marker),'utf8');await handle.sync();}catch{await handle.close();throw guidanceError(Error('Benchmark writer marker incomplete; explicit offline maintenance required'), 'guid-74c7e6fb31305c66');}
 let closed=false,closing:Promise<void>|undefined;
 const ownership=async()=>{
  const held=await handle.stat(),current=await lstat(path);
  const value=JSON.parse(await readFederationFile(host,path,{maxBytes:2048}));
  if(current.isSymbolicLink()||held.ino!==current.ino||held.dev!==current.dev||value.version!==1||value.vault!==vault||value.pid!==process.pid||value.nonce!==nonce)throw guidanceError(Error('Benchmark writer ownership changed; lock was not removed'), 'guid-1153d76103722a48');
 };
 return {
  assertHeld:async()=>{if(closed||closing)throw guidanceError(Error('Benchmark writer is closed'), 'guid-9b2090aaa487edde');await config.accountProfiles();try{await ownership();}catch{throw guidanceError(Error('Benchmark writer ownership changed or unavailable'), 'guid-b3d6052946fd715e');}},
  close:()=>{
   closing??=(async()=>{
    try{await ownership();await handle.close();closed=true;
     // Re-read after closing the handle (required for unlink on Windows). A
     // replacement marker is never removed merely because this process exits.
     const current=JSON.parse(await readFederationFile(host,path,{maxBytes:2048}));
     if(current.nonce!==nonce||current.pid!==process.pid||current.vault!==vault)throw guidanceError(Error('Benchmark writer ownership changed; lock was not removed'), 'guid-1153d76103722a48');
     await unlink(path);
    }catch{if(!closed){await handle.close();closed=true;}throw guidanceError(Error('Benchmark writer ownership changed or unavailable; lock was not removed'), 'guid-4e3cbd5b3496144e');}
   })();return closing;
  },
 };
}
