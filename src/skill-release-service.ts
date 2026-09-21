import {readReviewedSkill,type ReviewedSkillHost,type ReviewedSkillAuthorization,type ReviewedSkillDeliveryFence} from './skill-release-reader.js';
import type {SkillSourceInspection} from './skill-release-source.js';
import type {ScopeAccessPolicy} from './scope-access.js';
import type {ScopeAuthService,ScopePrincipal} from './scope-auth.js';
import type {OwnerActivityRuntime,OwnerActivityOperation} from './owner-activity-runtime.js';
import {fingerprint} from './skill-evolution-store.js';
import {discoverReviewedProcedures} from './skill-release-discovery.js';
const fail=():never=>{throw Error('Reviewed skill unavailable');};
export interface ReviewedSkillInspector {inspect(sourceName:string):Promise<SkillSourceInspection|null>}

/** Shared read service. Original PathFilter quarantine remains untouched.
 * Raw bytes are inspected only by the host-owned verifier, never returned here. */
export class ReviewedSkillService {
  constructor(private readonly host:ReviewedSkillHost,private readonly source:ReviewedSkillInspector,
    private readonly access:ScopeAccessPolicy,private readonly auth:ScopeAuthService,private readonly authorization:OwnerActivityRuntime|ReviewedSkillDeliveryFence,
    private readonly options:{assertActor?:(p:ScopePrincipal)=>Promise<void>;refreshAccess?:()=>Promise<void>}={}){}

  async resolve(p:Record<string,any>,captureDeliveryFence?:(fence:ReviewedSkillDeliveryFence)=>void):Promise<Record<string,any>>{
    return this.read(p,captureDeliveryFence,false);
  }

  async discover(p:Record<string,any>,captureDeliveryFence?:(fence:ReviewedSkillDeliveryFence)=>void){
    try{
      if(Object.keys(p).some(k=>!['query','maxChars','limit','cursor','scanBudget','accessToken','principal'].includes(k)))return fail();
      const identity=this.identity(p);
      return await discoverReviewedProcedures({host:this.host,query:p.query,maxChars:p.maxChars,limit:p.limit,cursor:p.cursor,scanBudget:p.scanBudget,cursorScope:identity.scopeKey,identity,
        read:(skillId,capture)=>this.read({skillId,view:'metadata',section:'summary',maxChars:12000,
          accessToken:p.accessToken,principal:p.principal},capture,true)},captureDeliveryFence);
    }catch{return fail();}
  }

  private identity(p:Record<string,any>){
    const principal=this.auth.authenticate(p.accessToken);
    if(!principal||!p.principal||fingerprint(principal)!==fingerprint(p.principal))return fail();
    const originalIdentity=fingerprint(principal),boundary=this.access.captureDocumentBoundary(principal);
    const assertFresh=()=>{const now=this.auth.authenticate(p.accessToken);if(!now||fingerprint(now)!==originalIdentity)return fail();boundary();};
    const revalidate=async()=>{
      await this.options.refreshAccess?.();
      const current=(await this.auth.listPrincipals({fresh:true})).find(a=>a.accountId===principal.accountId);
      if(!current||['accountId','modelId','agentId','userId','commandCenterId','role','capabilities','enterprise'].some(k=>fingerprint((current as any)[k]??null)!==fingerprint((principal as any)[k]??null)))return fail();
      await this.options.assertActor?.(principal);assertFresh();
    };
    return {principal,scopeKey:originalIdentity,revalidate,assertFresh};
  }

  private async read(p:Record<string,any>,captureDeliveryFence:((fence:ReviewedSkillDeliveryFence)=>void)|undefined,discovery:boolean):Promise<Record<string,any>>{
    try{
      if(Object.keys(p).some(k=>!['skillId','accessToken','principal','resourceId','expectedRelease','expectedRevision','offset','maxChars','view','section','axis','prettyPrint'].includes(k))
        ||p.view!==undefined&&p.view!=='procedure'&&p.view!=='metadata'||p.expectedRelease!==undefined&&p.expectedRevision!==undefined&&p.expectedRelease!==p.expectedRevision)return fail();
      const {principal,assertFresh:assertIdentity,revalidate:refreshActor}=this.identity(p);
      // Reviewed document reads use current source ACLs. Legacy hosts may also
      // require owner consent; never invent a grant to satisfy that policy.
      const owner='begin' in this.authorization?this.authorization:undefined;
      const hostFence='revalidate' in this.authorization?this.authorization:undefined;
      let lease:OwnerActivityOperation|undefined,discoveryLease:OwnerActivityOperation|undefined,sourceName:string|undefined,paths:readonly string[]=[];
      const assertPaths=()=>{
        assertIdentity();hostFence?.assertFresh();if(!paths.length||owner&&!lease)return fail();lease?.assertFresh();
        discoveryLease?.assertFresh();
        for(const path of paths)if(!this.access.canAccessPhysicalPath(path,principal)
          ||owner&&(!lease?.canAccessPath(path)||discovery&&!discoveryLease?.canAccessPath(path)))return fail();
      };
      const authorization:ReviewedSkillAuthorization={begin:async(_id,name)=>{
        await refreshActor();await hostFence?.revalidate();
        if(!/^[a-z0-9][a-z0-9-]{0,99}$/.test(name))return fail();sourceName=name;
        paths=[`Community/Skills/${name}/SKILL.md`];
        lease=await owner?.begin('skill-evolution','read',paths,principal);
        if(discovery)discoveryLease=await owner?.begin('skill-evolution','discover',paths,principal);assertPaths();
        return {revalidate:async()=>{await refreshActor();await hostFence?.revalidate();await lease?.revalidate();await discoveryLease?.revalidate();assertPaths();},assertFresh:assertPaths};
      }};
      const checkedHost:ReviewedSkillHost={
        entry:this.host.entry.bind(this.host),assertFresh:this.host.assertFresh.bind(this.host),readBlob:this.host.readBlob.bind(this.host),verifyEvidence:this.host.verifyEvidence.bind(this.host),
        sourceFingerprint:async name=>{
          if(name!==sourceName||!paths.length||owner&&!lease)return null;assertPaths();
          const snapshot=await this.source.inspect(name);
          if(!snapshot?.visible||!snapshot.inventory.complete||!snapshot.inventory.fingerprint||!snapshot.inventory.files.length||snapshot.inventory.files.length>4096)return null;
          paths=snapshot.inventory.files.map(file=>{
            if(typeof file.path!=='string'||file.path.includes('\\')||file.path.includes(':')||file.path.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)))return fail();
            return `Community/Skills/${name}/${file.path}`;
          });
          assertPaths();return snapshot.inventory.fingerprint;
        },
      };
      return await readReviewedSkill(checkedHost,authorization,{skillId:p.skillId,
        ...(p.view!==undefined?{view:p.view}:{}),...(p.section!==undefined?{section:p.section}:{}),...(p.axis!==undefined?{axis:p.axis}:{}),
        ...(p.resourceId!==undefined?{resourceId:p.resourceId}:{}),...(p.offset!==undefined?{offset:p.offset}:{}),...(p.maxChars!==undefined?{maxChars:p.maxChars}:{}),
        ...((p.expectedRelease??p.expectedRevision)!==undefined?{expectedRelease:p.expectedRelease??p.expectedRevision}:{})},captureDeliveryFence);
    }catch{return fail();}
  }
}
