import {spawn,type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {SkillInventory} from './skill-review-inventory.js';
export interface SkillSourceInspection {inventory:SkillInventory;visible:boolean}
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
function validated(value:unknown,root:string):SkillSourceInspection|null{
  if(!value||typeof value!=='object'||!('inventory'in value)||!('visible'in value)||typeof value.visible!=='boolean')return null;
  const r=value.inventory as SkillInventory;
  if(!r||r.version!==1||r.complete!==true||r.executionAuthorized!==false||!Array.isArray(r.reasons)||r.reasons.length
    ||!Array.isArray(r.files)||r.files.length>4096||r.rootId!==digest(process.platform==='win32'?root.toLowerCase():root))return null;
  let previous='',bytes=0;
  for(const f of r.files){
    if(!f||typeof f.path!=='string'||f.path.length>8192||f.path<=previous||f.path.includes('\\')||f.path.includes(':')
      ||f.path.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p))||!Number.isSafeInteger(f.bytes)||f.bytes<0
      ||typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256))return null;
    previous=f.path;bytes+=f.bytes;
  }
  if(bytes>64*1024*1024||r.fingerprint!==digest(JSON.stringify({version:1,rootId:r.rootId,files:r.files})))return null;
  return {inventory:r,visible:value.visible};
}

/** One owned child at a time. No foreground scan, inherited credentials, shell,
 * remote code or automatic dependencies. A busy/timeout/invalid result is unknown.
 * Source-mode tests require a fresh npm build for the fixed compiled worker. */
export function createSkillSourceInspector(vaultPath:string){
  if(!isAbsolute(vaultPath)||/^(?:\\\\|\/\/)[?.]/.test(vaultPath)||vaultPath.split(/[\\/]+/).some(p=>p==='.'||p==='..'))throw Error('Canonical Vault required');
  const vault=resolve(vaultPath);
  const worker=fileURLToPath(new URL(import.meta.url.endsWith('.ts')?'../dist/src/skill-release-source-worker.js':'./skill-release-source-worker.js',import.meta.url));
  let active:ChildProcess|undefined,closed=false;
  return {
    async inspect(sourceName:string,options:{signal?:AbortSignal;timeoutMs?:number}={}):Promise<SkillSourceInspection|null>{
      const timeout=options.timeoutMs??35000;
      if(closed||active||options.signal?.aborted||!/^[a-z0-9][a-z0-9-]{0,99}$/.test(sourceName)||!Number.isSafeInteger(timeout)||timeout<1||timeout>35000)return null;
      const root=join(vault,'Community','Skills',sourceName);
      return await new Promise(resolveResult=>{
        let result:SkillSourceInspection|null=null,failed=false;
        const child=spawn(process.execPath,['--max-old-space-size=128',worker],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],
          env:{...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),...(process.env.TEMP?{TEMP:process.env.TEMP}:{}),...(process.env.TMP?{TMP:process.env.TMP}:{})}});
        active=child;
        const stop=()=>{failed=true;result=null;child.kill();};
        const timer=setTimeout(stop,timeout);options.signal?.addEventListener('abort',stop,{once:true});
        child.once('message',message=>{try{result=validated(message,root);}catch{result=null;}});
        child.once('error',()=>{failed=true;});
        child.once('close',code=>{
          clearTimeout(timer);options.signal?.removeEventListener('abort',stop);if(active===child)active=undefined;
          resolveResult(!closed&&!failed&&code===0?result:null);
        });
        if(child.send)child.send({root},error=>{if(error)stop();});else stop();
      });
    },
    close(){closed=true;active?.kill();},
  };
}
