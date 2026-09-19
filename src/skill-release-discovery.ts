import {randomUUID} from 'node:crypto';
import {constrainedQuery} from './retrieval/query-policy.js';
import type {ReviewedSkillDeliveryFence,ReviewedSkillHost} from './skill-release-reader.js';

/** Procedural data is deliberately not a RetrievalHit / factual source path. */
export interface ReviewedProcedureCard {
  skillId:string;releaseRevision:string;executionAuthorized:false;
  limitations:string[];useWhen:string[];avoidWhen:string[];
  card:Record<string,unknown>;nextAction:unknown;
}
export interface ReviewedProcedureDiscovery {
  kind:'reviewed_procedures';cards:ReviewedProcedureCard[];partial:true;
  notice:string;nextCursor?:string;
}
const fail=():never=>{throw Error('Reviewed skill unavailable');};
type CandidatePage={candidates:readonly string[];nextCursor?:string;registryGeneration:string};
type CursorState={hostCursor?:string;pending?:CandidatePage;query:string;scope:string;registryGeneration:string};
const cursors=new WeakMap<ReviewedSkillHost,Map<string,CursorState>>();
const publicCursor=()=>randomUUID();
const cursorMap=(host:ReviewedSkillHost)=>{
  let map=cursors.get(host);if(!map){map=new Map();cursors.set(host,map);}return map;
};
const rememberCursor=(host:ReviewedSkillHost,cursor:string,state:CursorState)=>{
  const map=cursorMap(host);
  while(map.size>=128){const oldest=map.keys().next().value as string|undefined;if(oldest===undefined)break;map.delete(oldest);}
  map.set(cursor,state);
};
const validHostCursor=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=256&&/^[\x21-\x7E]+$/.test(value);
const validCandidate=(value:unknown):value is string=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,99}$/.test(value);
export function emptyReviewedProcedureDiscovery():ReviewedProcedureDiscovery{
  return {kind:'reviewed_procedures',cards:[],partial:true,
    notice:'Bounded reviewed procedure discovery, not factual evidence or a complete catalog. Read approval grants no execution. Explicit skill.resolve remains available.'};
}

/** Bounded canary discovery, not a full-library ranker. Only the host can name
 * candidates. The caller supplies the very same verified reader used by resolve.
 * Hidden/revoked/failed/nonmatching candidates produce no titles or counts. */
export async function discoverReviewedProcedures(options:{host:ReviewedSkillHost;query:unknown;maxChars?:unknown;limit?:unknown;cursor?:unknown;scanBudget?:unknown;cursorScope?:unknown;
  identity:ReviewedSkillDeliveryFence;
  read:(skillId:string,capture:(f:ReviewedSkillDeliveryFence)=>void)=>Promise<Record<string,any>>;
},captureDeliveryFence?:(f:ReviewedSkillDeliveryFence)=>void):Promise<ReviewedProcedureDiscovery>{
  try{
    const max=options.maxChars??4000,limit=options.limit??3,scanBudget=options.scanBudget??8;
    if(typeof options.query!=='string'||!options.query.trim()||options.query.length>512
      ||typeof max!=='number'||!Number.isSafeInteger(max)||max<1||max>12000
      ||typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>3
      ||typeof scanBudget!=='number'||!Number.isSafeInteger(scanBudget)||scanBudget<1||scanBudget>128
      ||options.cursor!==undefined&&(typeof options.cursor!=='string'||!/^[0-9a-f-]{36}$/.test(options.cursor)))return fail();
    const query=options.query.normalize('NFC').toLowerCase(),result=emptyReviewedProcedureDiscovery();
    await options.identity.revalidate();options.identity.assertFresh();
    // Keep the documented small-budget behavior: authenticate the request but
    // do not open the private registry or read any candidate metadata.
    if(max<1024){if(JSON.stringify(result).length>max)return fail();return result;}
    const terms=query.trim().split(/\s+/),pageBudget=Math.min(scanBudget,limit),selected:ReviewedSkillDeliveryFence[]=[];
    const searchableQuery=!constrainedQuery(query)&&terms.length<=12&&terms.every(t=>/^[\p{L}\p{N}_-]+$/u.test(t));
    let page:CandidatePage|undefined,continuation:string|undefined;
    let continuationState:{cursor:string;state:CursorState}|undefined;
    if(searchableQuery&&options.host.candidatesPage){
      if(typeof options.cursorScope!=='string'||!options.cursorScope||options.cursorScope.length>256)return fail();
      const map=cursorMap(options.host);let state:CursorState|undefined;
      if(options.cursor!==undefined){
        state=map.get(options.cursor);if(!state||state.query!==query||state.scope!==options.cursorScope)return fail();
      }
      page=state?.pending??await options.host.candidatesPage(state?.hostCursor,pageBudget);
      if(!page||!Array.isArray(page.candidates)||page.candidates.length>pageBudget
        ||page.candidates.some(candidate=>!validCandidate(candidate))||typeof page.registryGeneration!=='string'||!page.registryGeneration
        ||page.registryGeneration.length>256||page.nextCursor!==undefined&&!validHostCursor(page.nextCursor))return fail();
      if(state&&page.registryGeneration!==state.registryGeneration)return fail();
      // Retain the fetched page until the complete response fence succeeds.
      // This makes a failed continuation retryable without exposing the host
      // cursor or consuming the public opaque cursor early.
      if(options.cursor!==undefined&&!state?.pending)map.set(options.cursor,{...state!,pending:page});
    }else if(options.cursor!==undefined)return fail();
    const makePageContinuation=(start:number):{cursor:string;state:CursorState}|undefined=>{
      if(!page)return undefined;
      const remaining=page.candidates.slice(start);
      const state:CursorState|undefined=remaining.length>0
        ?{pending:{...page,candidates:remaining},query,scope:options.cursorScope as string,registryGeneration:page.registryGeneration}
        : page.nextCursor===undefined?undefined:{hostCursor:page.nextCursor,query,scope:options.cursorScope as string,registryGeneration:page.registryGeneration};
      if(!state)return undefined;
      const cursor=publicCursor();return {cursor,state};
    };
    // Unsupported strict expressions never turn into a relaxed metadata query.
    let candidates=page?.candidates;
    if(candidates===undefined&&searchableQuery&&options.host.candidates){
      try{candidates=await options.host.candidates();}catch{candidates=[];}
    }
    if(candidates!==undefined){
      const maxCandidates=page===undefined?8:pageBudget;
      if(!Array.isArray(candidates)||candidates.length>maxCandidates||candidates.some(id=>!validCandidate(id)))return fail();
      const seen=new Set<string>();
      for(let index=0;index<candidates.length;index++){
        const skillId=candidates[index];if(seen.has(skillId))continue;seen.add(skillId);
        options.identity.assertFresh();
        let raw:Record<string,any>,fence:ReviewedSkillDeliveryFence|undefined;
        try{raw=await options.read(skillId,value=>{fence=value;});}catch{continue;}
        if(!fence||raw.partial||!raw.card||raw.executionAuthorized!==false||raw.skillId!==skillId)continue;
        // Search purpose/functions/aliases only, not restrictions or private evidence.
        const c=raw.card;
        const searchable=[raw.skillId,...(c.functions??[]),c.purpose,...(c.keywords??[]),...(c.domains??[]),
          c.example?.query,c.example?.action,c.example?.expected].filter(v=>typeof v==='string').join('\n').normalize('NFC').toLowerCase();
        if(!terms.every(t=>searchable.includes(t)))continue;
        const card:ReviewedProcedureCard={skillId,releaseRevision:raw.releaseRevision,executionAuthorized:false,
          limitations:raw.limitations,useWhen:raw.useWhen,avoidWhen:raw.avoidWhen,card:raw.card,nextAction:raw.nextAction};
        const proposed={...result,cards:[...result.cards,card]};
        if(JSON.stringify(proposed).length>max){
          // Keep a visible match in the bounded response. The caller can use
          // this current-release read action to retry with the full metadata
          // budget; it must not disappear merely because its card is large.
          const bounded:ReviewedProcedureCard={skillId,releaseRevision:raw.releaseRevision,executionAuthorized:false,
            limitations:raw.limitations,useWhen:raw.useWhen,avoidWhen:raw.avoidWhen,card:{},nextAction:{endpointId:'skill.resolve',arguments:{skillId,
              expectedRelease:raw.releaseRevision,view:'metadata',maxChars:12000}}};
          const boundedResult={...result,cards:[...result.cards,bounded]};
          if(JSON.stringify(boundedResult).length>max){
            const pending=makePageContinuation(index);
            if(!pending){result.cards=[];break;}
            const withPending={...result,nextCursor:pending.cursor};
            if(JSON.stringify(withPending).length<=max){
              result.nextCursor=pending.cursor;continuation=pending.cursor;continuationState=pending;break;
            }
            // Previously emitted cards cannot be returned without their retry
            // cursor. Requeue this page from its first candidate rather than
            // silently losing a visible match.
            const restart=makePageContinuation(0);if(!restart)return fail();
            result.cards=[];selected.length=0;result.nextCursor=restart.cursor;
            continuation=restart.cursor;continuationState=restart;break;
          }
          result.cards.push(bounded);selected.push(fence);
        }else{result.cards.push(card);selected.push(fence);}
        if(result.cards.length===limit)break;
      }
      if(!continuationState&&page?.nextCursor!==undefined){
        const pending=makePageContinuation(candidates.length);if(!pending)return fail();
        if(JSON.stringify({...result,nextCursor:pending.cursor}).length>max){
          const restart=makePageContinuation(0);if(!restart)return fail();
          result.cards=[];selected.length=0;result.nextCursor=restart.cursor;
          continuation=restart.cursor;continuationState=restart;
        }else{continuation=pending.cursor;continuationState=pending;}
      }
    }
    if(continuation&&!result.nextCursor)result.nextCursor=continuation;
    const fence:ReviewedSkillDeliveryFence={
      revalidate:async()=>{for(const f of selected)await f.revalidate();await options.identity.revalidate();},
      assertFresh:()=>{options.identity.assertFresh();for(const f of selected)f.assertFresh();},
    };
    await fence.revalidate();fence.assertFresh();
    captureDeliveryFence?.(fence);
    if(options.cursor!==undefined)cursorMap(options.host).delete(options.cursor);
    if(continuationState)rememberCursor(options.host,continuationState.cursor,continuationState.state);
    return result;
  }catch{return fail();}
}
