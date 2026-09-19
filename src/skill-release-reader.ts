import {createHash} from 'node:crypto';
import {parseSkillReleaseManifest,type SkillReleaseManifest} from './skill-release-manifest.js';
import {reviewedSkillCard} from './skill-release-card.js';
import {parseReleaseDescriptor} from './skill-release-descriptor.js';
import type {SkillDescriptor} from './skill-descriptor.js';

/** Host-code adapters only; never construct these from an endpoint argument. */
export interface ReviewedSkillHost {
  /** Private bounded discovery window, not an inventory or an access decision.
   * IDs must never be returned until the same release reader authorizes them. */
  candidates?():Promise<readonly string[]>;
  /** Bounded, resumable registry iteration. The host cursor is private to the
   * adapter; discovery replaces it with an authenticated opaque cursor. */
  candidatesPage?(cursor?:string,scanBudget?:number):Promise<{
    candidates:readonly string[];nextCursor?:string;registryGeneration:string;
  }>;
  entry(skillId:string):Promise<{releaseHash:string;generation:string;sourceName:string}|undefined>;
  /** Final synchronous registry and complete delivered-resource fence. Optional
   * hashes preserve entry-only host checks; readers always provide their full set.
   * No callback or awaited IO may follow the delivery fence. */
  assertFresh(entry:{releaseHash:string;generation:string;sourceName:string},blobHashes?:readonly string[]):void;
  readBlob(sha256:string):Promise<Buffer>;
  sourceFingerprint(sourceName:string):Promise<string|null>;
  verifyEvidence(manifest:SkillReleaseManifest):Promise<boolean>;
}
export interface ReviewedSkillAuthorization {
  /** Must check real current identity, original ACL, owner consent and runtime. */
  begin(skillId:string,sourceName:string):Promise<{revalidate():Promise<void>;assertFresh():void}>;
}
export interface ReviewedSkillDeliveryFence {revalidate():Promise<void>;assertFresh():void}
const fail=():never=>{throw Error('Reviewed skill unavailable');};
const id=(v:unknown):string=>typeof v==='string'&&/^[a-z0-9][a-z0-9-]{0,99}$/.test(v)?v:fail();
const sha=(v:unknown):string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:fail();
const digest=(v:Buffer)=>createHash('sha256').update(v).digest('hex');

/** No fallback to a mutable or quarantined source. Blob IO must be bounded by the host. */
export async function readReviewedSkill(host:ReviewedSkillHost,authorization:ReviewedSkillAuthorization,p:Record<string,unknown>,
  captureDeliveryFence?:(fence:ReviewedSkillDeliveryFence)=>void):Promise<Record<string,any>>{
  try{
    if(Object.keys(p).some(k=>!['skillId','resourceId','expectedRelease','maxChars','offset','view','section','axis'].includes(k)))return fail();
    const metadata=p.view==='metadata';
    if(p.view!==undefined&&p.view!=='procedure'&&!metadata||!metadata&&(p.section!==undefined||p.axis!==undefined)
      ||metadata&&(p.resourceId!==undefined||p.offset!==undefined))return fail();
    const skillId=id(p.skillId),max=p.maxChars??4000,offset=p.offset??0;
    if(typeof max!=='number'||!Number.isSafeInteger(max)||max<1024||max>12000||typeof offset!=='number'||!Number.isSafeInteger(offset)||offset<0||offset>1048576)return fail();
    const entry=await host.entry(skillId);if(!entry)return fail();
    const release=sha(entry.releaseHash),generation=entry.generation;
    const permission=await authorization.begin(skillId,entry.sourceName);
    if(p.expectedRelease!==undefined&&sha(p.expectedRelease)!==release)return fail();
    const manifestBytes=await host.readBlob(release);
    if(!Buffer.isBuffer(manifestBytes)||manifestBytes.length>65536||digest(manifestBytes)!==release)return fail();
    const manifest=parseSkillReleaseManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes)));
    const deliveredBlobs=Object.freeze([...new Set([release,...manifest.resources.map(r=>r.blob)])]);
    if(manifest.skillId!==skillId||await host.sourceFingerprint(entry.sourceName)!==manifest.sourceFingerprint||!await host.verifyEvidence(manifest))return fail();
    const resourceId=p.resourceId===undefined?manifest.mainResource:id(p.resourceId),resource=manifest.resources.find(r=>r.id===resourceId);
    if(!resource)return fail();
    const checkResources=async()=>{
      let selected='',descriptor:SkillDescriptor|undefined;
      // Admission binds the whole resource set, not only the currently read page.
      // Manifest bounds cap this at 32 files / 4 MiB; no dependency crawling.
      for(const item of manifest.resources){
        const bytes=await host.readBlob(item.blob);
        if(!Buffer.isBuffer(bytes)||bytes.length!==item.bytes||digest(bytes)!==item.blob)return fail();
        const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
        if(item.id===manifest.descriptorResource)descriptor=parseReleaseDescriptor(item,bytes);
        if(item.id===resourceId)selected=text;
      }
      return {selected,descriptor};
    };
    const checked=await checkResources(),content=checked.selected;if(offset>content.length)return fail();
    // Do not split UTF-16 surrogate pairs at a caller-supplied continuation boundary.
    if(offset>0&&/[\uD800-\uDBFF]/.test(content[offset-1]!)&&/[\uDC00-\uDFFF]/.test(content[offset]??''))return fail();
    const action=(start:number)=>({endpointId:'skill.resolve',arguments:{skillId,resourceId,expectedRelease:release,offset:start,maxChars:12000}});
    const base={skillId,status:'reviewed_limited',releaseRevision:release,sourceFingerprint:manifest.sourceFingerprint,resourceId,
      executionAuthorized:false,limitations:manifest.limitations,useWhen:manifest.useWhen,avoidWhen:manifest.avoidWhen,
      notice:'Reviewed procedural data only. Existing tool permissions still apply.'};
    // Oversized conditions cannot be hidden behind a body or an impossible retry.
    if(JSON.stringify(base).length>11000)return fail();
    let result:Record<string,any>={...base,content:content.slice(offset),offset,partial:false};
    if(JSON.stringify(result).length>max){
      const partial={...base,content:'',offset,partial:true,nextAction:action(offset)};
      if(JSON.stringify(partial).length>max)result={skillId,status:'reviewed_limited',releaseRevision:release,resourceId,executionAuthorized:false,
        partial:true,omitted:['conditions','content'],nextAction:action(offset)};
      else{
        let lo=0,hi=content.length-offset;
        while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(JSON.stringify({...partial,content:content.slice(offset,offset+mid),nextAction:action(offset+mid)}).length<=max)lo=mid;else hi=mid-1;}
        if(lo>0&&/[\uD800-\uDBFF]/.test(content[offset+lo-1]!)&&/[\uDC00-\uDFFF]/.test(content[offset+lo]??''))lo--;
        result={...partial,content:content.slice(offset,offset+lo),nextAction:action(offset+lo)};
      }
    }
    if(metadata)result=reviewedSkillCard(manifest,release,max,p,checked.descriptor);
    if(JSON.stringify(result).length>max)return fail();
    if(await host.sourceFingerprint(entry.sourceName)!==manifest.sourceFingerprint)return fail();
    await checkResources();
    const current=await host.entry(skillId);
    if(!current||current.releaseHash!==release||current.generation!==generation||current.sourceName!==entry.sourceName)return fail();
    await permission.revalidate();
    permission.assertFresh();
    host.assertFresh(entry,deliveredBlobs);
    // Trusted adapter callback, never response data. A dispatcher can await other
    // checks after this service returns; fence the actual delivery boundary too.
    captureDeliveryFence?.({
      revalidate:async()=>{
        try{
          if(await host.sourceFingerprint(entry.sourceName)!==manifest.sourceFingerprint)return fail();
          await checkResources();
          await permission.revalidate();permission.assertFresh();host.assertFresh(entry,deliveredBlobs);
        }catch{return fail();}
      },
      assertFresh:()=>{try{permission.assertFresh();host.assertFresh(entry,deliveredBlobs);}catch{return fail();}},
    });
    return result;
  }catch{return fail();}
}
