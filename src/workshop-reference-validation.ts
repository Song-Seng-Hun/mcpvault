import { guidanceError } from './guidance-runtime.js';
import type { FileSystemService } from './filesystem.js';
import type { ReferenceService } from './references.js';
import type { ScopePrincipal } from './scope-auth.js';
import { isModerationHidden } from './moderation-policy.js';

/** Structured Properties are not Markdown. Explicit path locators need the
 * same authorization as wikilinks; JSON.stringify alone cannot provide it. */
export async function validateWorkshopReferences(
  fs:FileSystemService, references:ReferenceService, value:unknown,
  containerPath:string, principal?:ScopePrincipal,
):Promise<Array<{path:string;expectedRevision:string}>> {
  try {
    const encoded=JSON.stringify(value);
    if(encoded && encoded.length>128000)throw new Error();
    const locators:Array<{path:string;revision?:string}>=[],bodies:string[]=[];
    let visited=0;
    const collect=(path:unknown,revision?:unknown)=>{
      if(typeof path!=='string'||!path.trim()||path.length>500)throw new Error();
      if(revision!==undefined && (typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision)))throw new Error();
      locators.push({path,...(typeof revision==='string'&&{revision})});
      if(locators.length>128)throw new Error();
    };
    const walk=(node:unknown,depth:number)=>{
      if(depth>12||++visited>4000)throw new Error();
      if(typeof node==='string') {if(/\[\[|\]\(/.test(node)){bodies.push(node);if(bodies.length>128)throw new Error();}return;}
      if(node===null||node===undefined||typeof node!=='object')return;
      if(Array.isArray(node)){for(const item of node)walk(item,depth+1);return;}
      const object=node as Record<string,unknown>;
      if(Object.hasOwn(object,'path'))collect(object.path,object.revision??object.expectedRevision);
      for(const [key,item] of Object.entries(object)){
        if(key==='references'||key==='evidencePaths') {
          if(!Array.isArray(item))throw new Error();
          for(const ref of item)if(typeof ref==='string')collect(ref);else if(!ref||typeof ref!=='object'||!Object.hasOwn(ref,'path'))throw new Error();
        }
        walk(item,depth+1);
      }
    };
    walk(value,0);
    const guards=new Map<string,{path:string;expectedRevision:string}>();
    const inspect=async(path:string,expected?:string)=>{
      const note=await fs.readNote(path);
      if(isModerationHidden(note.frontmatter)||note.frontmatter.content_status==='deleted'||(expected && expected!==note.revision))throw new Error();
      const key=path.toLowerCase(),prior=guards.get(key);
      if(prior && prior.expectedRevision!==note.revision)throw new Error();
      guards.set(key,{path,expectedRevision:note.revision});
      if(guards.size>8)throw new Error();
    };
    for(const locator of locators){
      const normalized=await references.validateAndNormalize([locator.path],containerPath,principal,'',{strictBodyLinks:true});
      if(normalized.length!==1)throw new Error();
      await inspect(normalized[0]!,locator.revision);
    }
    for(const body of bodies)for(const path of await references.validateAndNormalize([],containerPath,principal,body,{strictBodyLinks:true}))await inspect(path);
    return [...guards.values()];
  } catch {throw guidanceError(new Error('Workshop reference unavailable or changed'), 'guid-a5b455bae1611262');}
}
