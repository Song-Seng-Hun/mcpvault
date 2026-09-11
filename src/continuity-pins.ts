import { guidanceError } from './guidance-runtime.js';
import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { isModerationHidden } from './moderation-policy.js';

export interface ContinuityPinSelection { pendingEdits?: number[]; researchTrail?: number[] }
export interface ContinuityPinResult { field:'pendingEdits'|'researchTrail'; index:number; state:'current'|'stale'|'unpinned'|'unavailable' }
export interface ContinuityValidation { checked?:string[]; unchecked?:string[]; pins?:ContinuityPinResult[]; selectedPinsCurrent?:boolean; detailsOmitted?:true }
const PIN_BYTES = 256 * 1024;

/** Explicit indices only. Never execute a stored endpoint or rewrite its guard.
 * Results identify owned checkpoint positions, not hidden targets or fresh prose. */
export async function inspectContinuityPins(fs:FileSystemService,access:ScopeAccessPolicy,principal:ScopePrincipal,
  fm:Record<string,any>,selection:ContinuityPinSelection|undefined,watch:(path:string)=>void) {
  if(selection!==undefined&&(!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).some(key=>!['pendingEdits','researchTrail'].includes(key))))throw guidanceError(Error('Invalid continuity pin selection'), 'guid-7a9ecb14e4955fe5');
  const chosen:Array<{field:ContinuityPinResult['field'];index:number;item:Record<string,unknown>}> = [];
  for(const field of ['pendingEdits','researchTrail'] as const){
    const indices=selection?.[field]??[];
    if(!Array.isArray(indices)||indices.length>20||new Set(indices).size!==indices.length||indices.some(index=>!Number.isSafeInteger(index)||index<0||index>=20))throw guidanceError(Error('Continuity pin indices must be unique integers from 0 to 19'), 'guid-23f7f2bddeae80ca');
    const saved=fm[field==='pendingEdits'?'pending_edits':'research_trail'];
    for(const index of indices){
      const item=Array.isArray(saved)?saved[index]:undefined;
      if(!item||typeof item!=='object'||Array.isArray(item))throw guidanceError(Error('Selected continuity pin is absent; reread checkpoint'), 'guid-a932c5671d89186b');
      chosen.push({field,index,item});
    }
  }
  if(chosen.length>20)throw guidanceError(Error('At most twenty continuity pins can be checked per read'), 'guid-03ca789239274ce2');
  const pins:ContinuityPinResult[]=chosen.map(({field,index})=>({field,index,state:'unpinned'}));
  const check=async()=>{
    for(let i=0;i<chosen.length;i++){
      const {field,item}=chosen[i]!, result=pins[i]!;
      const expected=item[field==='pendingEdits'?'expectedRevision':'revision'];
      if(typeof item.path!=='string'||typeof expected!=='string'||!(/^[a-f0-9]{64}$/.test(expected)||field==='pendingEdits'&&expected==='missing')){result.state='unpinned';continue;}
      try{
        const path=access.resolveExternalPath(item.path,principal);
        if(!access.canAccessPhysicalPath(path,principal))throw Error();
        watch(path);
        if(expected==='missing'){
          // noteExists deliberately conflates denied and missing paths. Require
          // the normal guarded reader's exact ENOENT cause, never false=>absent.
          try{await fs.readNoteRevision(path,PIN_BYTES);}
          catch(error){
            if(error instanceof Error&&error.cause&&typeof error.cause==='object'&&'code' in error.cause&&error.cause.code==='ENOENT'&&access.canAccessPhysicalPath(path,principal)){
              result.state='current';continue;
            }
            throw error;
          }
        }
        const note=(await fs.readNoteMetadata([path],p=>access.canAccessPhysicalPath(p,principal),{fresh:true,strict:true,maxBytes:PIN_BYTES}))[0];
        if(!note||!note.revision||isModerationHidden(note.frontmatter)||note.frontmatter.content_status==='deleted')throw Error();
        result.state=note.revision===expected?'current':'stale';
        if(!access.canAccessPhysicalPath(path,principal))throw Error();
      }catch{result.state='unavailable';}
    }
  };
  await check();
  return {pins,revalidate:check};
}
