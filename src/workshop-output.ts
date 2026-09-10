import { guidanceError } from './guidance-runtime.js';
import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ParsedNote } from './types.js';
import { normalizeScopeId } from './scopes.js';
import { fingerprint } from './work-model.js';
import { isModerationHidden } from './moderation-policy.js';

export interface WorkshopOutputReceipt { workshopPath:string; outputId:string; payloadFingerprint:string; actor:string }
export interface WorkshopOutputInput {
  outputId:string; type:'decision'|'task'; kind:string; path:string; title:string;
  context?:string; decision?:string; description?:string; alternatives:string[]; consequences:string[];
  minority:string[]; uncertainty:string[]; revisit:string[]; evidencePaths:string[]; completionCriteria:string[];
}
type Guard={path:string;expectedRevision:string};
export function workshopDecisionContext(input:WorkshopOutputInput):string {
  const context=[input.context,'## Minority views',...input.minority,'## Uncertainty',...input.uncertainty,'## Revisit conditions',...input.revisit].join('\n');
  if(Array.from(context).length>4000)throw guidanceError(new Error('Decision context and caveats exceed 4000 characters; shorten without dropping conditions'), 'guid-dc72116623556fdf');
  return context;
}
export function workshopTaskDescription(input:WorkshopOutputInput,workshopPath:string):string {
  const description=[input.description,...([
    ['Alternatives',input.alternatives],['Consequences',input.consequences],['Minority views',input.minority],
    ['Uncertainty',input.uncertainty],['Revisit conditions',input.revisit],
  ] as const).flatMap(([heading,values])=>values.length?[`## ${heading}`,...values]:[]),`Workshop: [[${workshopPath}]]`].join('\n\n');
  if(Array.from(description).length>4000)throw guidanceError(new Error('Task description and caveats exceed 4000 characters; shorten without dropping conditions'), 'guid-7bf9a7bcbdc5c88a');
  return description;
}
interface Delegation { projectId:string; accountId:string; grantor:string; decisionKinds:string[]; taskKinds:string[]; scope:string; reason:string; revoked:boolean }
export interface WorkshopOutputAdapter {
  authorizeProject(principal:ScopePrincipal,projectId:string,owner:boolean,delegate?:string,grantor?:string):Promise<Guard>;
  assertAccess(principal:ScopePrincipal,input:WorkshopOutputInput):Promise<void>;
  create(input:WorkshopOutputInput,guards:Guard[],receipt:WorkshopOutputReceipt,principal:ScopePrincipal,projectId:string,assertAccess:()=>Promise<void>):Promise<{revision:string}>;
}
function object(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw guidanceError(new Error('Expected structured object'), 'guid-95bd017177342779');return value as Record<string,unknown>;
}
function text(value:unknown,field:string,max=500):string {
  if(typeof value!=='string'||!value.trim()||Array.from(value).length>max)throw guidanceError(new Error(`Invalid ${field}`), 'guid-972520f95c9d5dbd');return value.trim();
}
function list(value:unknown,field:string,required=false):string[] {
  if(value===undefined&&!required)return [];
  if(!Array.isArray(value)||value.length>12||(required&&!value.length))throw guidanceError(new Error(`Invalid ${field}`), 'guid-972520f95c9d5dbd');
  return [...new Set(value.map(v=>text(v,field)))];
}
function delegation(value:unknown):Delegation {
  const v=object(value);
  if(v.revoked!==undefined&&typeof v.revoked!=='boolean')throw guidanceError(new Error('revoked must be boolean'), 'guid-36a75840ea0b169c');
  return {projectId:normalizeScopeId(text(v.projectId,'projectId'),'projectId'),accountId:text(v.accountId,'accountId',64),grantor:text(v.grantor,'grantor',64),
    decisionKinds:list(v.decisionKinds,'decisionKinds'),taskKinds:list(v.taskKinds,'taskKinds'),scope:text(v.scope,'scope'),reason:text(v.reason,'reason'),revoked:v.revoked===true};
}
/** Reserve the reviewed output on its workshop before normal services create
 * it. A lost response is recovered by stable ID + exact payload and basis,
 * under current authority; the output receipt is never an access grant. */
export class WorkshopOutputService {
  constructor(private readonly fs:FileSystemService,private readonly adapter:WorkshopOutputAdapter){}
  async cancel(path:string,note:ParsedNote,actor:ScopePrincipal,payload:unknown,revalidate:()=>Promise<void>,mutation?:{requestKey:string;payloadHash:string}) {
    if(note.frontmatter.facilitator_account_id!==actor.accountId)throw guidanceError(new Error('Only current facilitator may cancel a pending output'), 'guid-30244e88203ee24f');
    const v=object(payload),outputId=normalizeScopeId(text(v.outputId,'outputId',64),'outputId'),reason=text(v.reason,'reason');
    if(Object.keys(v).some(k=>!['outputId','reason'].includes(k)))throw guidanceError(new Error('Unknown cancellation field'), 'guid-25f1110ba54a79cb');
    const pending=note.frontmatter.workshop_output_pending;
    if(!pending||pending.receipt?.outputId!==outputId||!['decision','task'].includes(pending.input?.type))throw guidanceError(new Error('Pending output does not match'), 'guid-cfd38985a0e95f2b');
    const id=`meeting-${fingerprint({path,outputId}).slice(0,32)}`;
    const decision=`Community/Knowledge/Decisions/${id}.md`,task=`Community/Tasks/${id}.md`;
    if(pending.input.path!==(pending.input.type==='decision'?decision:task))throw guidanceError(new Error('Malformed pending output path'), 'guid-b3a79bdf2b6b0970');
    const prior=note.frontmatter.workshop_output_cancellations??[];
    if(!Array.isArray(prior)||prior.length>=16)throw guidanceError(new Error('Output cancellation history is full or malformed; inspect before further action'), 'guid-3d677b7c043b2974');
    await revalidate();await this.current(path,note);
    const frontmatter:ParsedNote['frontmatter']={...note.frontmatter,workshop_output_cancellations:[...prior,{outputId,payloadFingerprint:pending.receipt.payloadFingerprint,actor:actor.accountId,reason}]};
    delete frontmatter.workshop_output_pending;
    if(mutation)frontmatter.facilitation_mutation_receipts=[...(note.frontmatter.facilitation_mutation_receipts||[]),{request_key:mutation.requestKey,payload_hash:mutation.payloadHash,operation:'cancel_output',result:{cancelledOutputId:outputId}}].slice(-16);
    const written=await this.fs.writeNoteWithRevisionGuardsAndReceipt({path,content:note.content,frontmatter,expectedRevision:note.revision},[{path:decision,expectedRevision:'missing'},{path:task,expectedRevision:'missing'}],{assertAccess:revalidate});
    return {success:true,revision:written.revision,cancelledOutputId:outputId,authority:'No output was deleted or approved'};
  }
  private async current(path:string,note:ParsedNote):Promise<void> {
    const current=await this.fs.readNote(path);
    if(current.revision!==note.revision||current.frontmatter.mcpvault_type!=='workshop'||isModerationHidden(current.frontmatter))throw guidanceError(new Error('Workshop revision or visibility changed'), 'guid-48844f46b5f07abc');
  }
  async delegate(path:string,note:ParsedNote,actor:ScopePrincipal,payload:unknown,revalidate:()=>Promise<void>,mutation?:{requestKey:string;payloadHash:string}) {
    if(note.frontmatter.facilitator_account_id!==actor.accountId)throw guidanceError(new Error('Only current facilitator may set delegation'), 'guid-11fdcb6ffb7acb7d');
    const v=object(payload);
    if(Object.keys(v).some(k=>!['projectId','accountId','decisionKinds','taskKinds','scope','reason','revoked'].includes(k)))throw guidanceError(new Error('Unknown delegation field'), 'guid-686527e0e3da6ee6');
    const d=delegation({...v,grantor:actor.accountId});
    if(!(note.frontmatter.facilitation?.participants as unknown[])?.includes(d.accountId))throw guidanceError(new Error('Delegate must be a current workshop participant'), 'guid-1457940799ce0e52');
    if(!d.decisionKinds.length&&!d.taskKinds.length&&!d.revoked)throw guidanceError(new Error('Delegation requires exact allowed decision or task kinds'), 'guid-20f9491788250e52');
    if(d.taskKinds.some(k=>!['general','security','permissions','shared_policy','destructive'].includes(k)))throw guidanceError(new Error('Unknown task kind'), 'guid-c723e3a89b00ca00');
    const project=await this.adapter.authorizeProject(actor,d.projectId,true,d.accountId);
    await revalidate();await this.current(path,note);
    const receipts=mutation?[...(note.frontmatter.facilitation_mutation_receipts||[]),{request_key:mutation.requestKey,payload_hash:mutation.payloadHash,operation:'delegate',result:{delegation:d}}].slice(-16):note.frontmatter.facilitation_mutation_receipts;
    const receipt=await this.fs.writeNoteWithRevisionGuardsAndReceipt({path,content:note.content,frontmatter:{...note.frontmatter,facilitation_delegation:d,...(receipts&&{facilitation_mutation_receipts:receipts})},expectedRevision:note.revision},[project],{assertAccess:revalidate});
    return {success:true,revision:receipt.revision,delegation:d,authority:'No external execution permission'};
  }
  async execute(path:string,note:ParsedNote,actor:ScopePrincipal,payload:unknown,revalidate:()=>Promise<void>,sourceGuards:Guard[]=[]) {
    const d=delegation(note.frontmatter.facilitation_delegation);
    if(d.revoked||d.accountId!==actor.accountId)throw guidanceError(new Error('Current explicit output delegation is required'), 'guid-49589e53a41252ce');
    if(!(note.frontmatter.facilitation?.participants as unknown[])?.includes(actor.accountId))throw guidanceError(new Error('Current workshop participant is required'), 'guid-4907969d43110e9e');
    const v=object(payload);
    const allowed=['outputId','type','kind','title','context','decision','description','alternatives','consequences','minority','uncertainty','revisit','evidencePaths','completionCriteria'];
    if(Object.keys(v).some(k=>!allowed.includes(k)))throw guidanceError(new Error('Unknown output field'), 'guid-31fa86eaf99ecb71');
    const outputId=normalizeScopeId(text(v.outputId,'outputId',64),'outputId');
    if(v.type!=='decision'&&v.type!=='task')throw guidanceError(new Error('Output type must be decision or task'), 'guid-8c87a802eb15a281');
    const kind=text(v.kind,'kind',64);
    if(!(v.type==='decision'?d.decisionKinds:d.taskKinds).includes(kind))throw guidanceError(new Error('Output kind is outside delegation'), 'guid-e9bb4504a6efc608');
    const targetId=`meeting-${fingerprint({path,outputId}).slice(0,32)}`;
    const target=v.type==='decision'?`Community/Knowledge/Decisions/${targetId}.md`:`Community/Tasks/${targetId}.md`;
    const opposite=v.type==='task'?`Community/Knowledge/Decisions/${targetId}.md`:`Community/Tasks/${targetId}.md`;
    if(await this.fs.noteExists(opposite))throw guidanceError(new Error('Output ID conflict: already used for a different type'), 'guid-ae96e537e91c04df');
    const input:WorkshopOutputInput={outputId,type:v.type,kind,path:target,title:text(v.title,'title',180),
      alternatives:list(v.alternatives,'alternatives'),consequences:list(v.consequences,'consequences'),
      minority:list(v.minority,'minority',v.type==='decision'),uncertainty:list(v.uncertainty,'uncertainty',v.type==='decision'),revisit:list(v.revisit,'revisit',v.type==='decision'),
      evidencePaths:list(v.evidencePaths,'evidencePaths'),completionCriteria:list(v.completionCriteria,'completionCriteria',v.type==='task'),
      ...(v.type==='decision'?{context:text(v.context,'context',2000),decision:text(v.decision,'decision',2000)}:{description:text(v.description,'description',3000)})};
    if(input.type==='decision')workshopDecisionContext(input);
    else workshopTaskDescription(input,path);
    const receipt:WorkshopOutputReceipt={workshopPath:path,outputId,payloadFingerprint:fingerprint({input,projectId:d.projectId,scope:d.scope}),actor:actor.accountId};
    // This closure is trusted call context. Never persist it or reconstruct
    // authority from the public reservation or output receipt.
    const assertAccess=async()=>{await this.adapter.assertAccess(actor,input);await revalidate();};
    const project=await this.adapter.authorizeProject(actor,d.projectId,false,undefined,d.grantor);
    await assertAccess();await this.current(path,note);
    const records=note.frontmatter.workshop_outputs ?? [];
    if(!Array.isArray(records)||records.length>16)throw guidanceError(new Error('Malformed bounded workshop output receipts'), 'guid-bcedf071cbbe32ba');
    const linked=records.find((r:Record<string,unknown>)=>r.outputId===outputId);
    if(linked&&(linked.path!==target||linked.payloadFingerprint!==receipt.payloadFingerprint))throw guidanceError(new Error('Output ID conflict in workshop receipt'), 'guid-1ecbb61ce380259d');
    if(!linked&&records.length>=16)throw guidanceError(new Error('Workshop output limit reached'), 'guid-2f9c301134e8ad2f');
    const guardMap=new Map<string,Guard>();
    for(const guard of [{path,expectedRevision:note.revision},project,...sourceGuards,{path:opposite,expectedRevision:'missing'}]) {
      const key=guard.path.toLowerCase(),prior=guardMap.get(key);
      if(prior&&prior.expectedRevision!==guard.expectedRevision)throw guidanceError(new Error('Output source changed during validation'), 'guid-7744274e3ff31889');
      guardMap.set(key,guard);
    }
    const basisFingerprint=fingerprint({delegation:d,facilitator:note.frontmatter.facilitator_account_id,
      facilitatorGeneration:note.frontmatter.facilitator_generation??null,facilitation:note.frontmatter.facilitation,
      phase:note.frontmatter.phase??null,contentFingerprint:fingerprint(note.content),
      sourceGuards:sourceGuards.filter(g=>g.path.toLowerCase()!==path.toLowerCase()).sort((a,b)=>a.path.localeCompare(b.path))});
    const pending=note.frontmatter.workshop_output_pending;
    if(pending&&(linked||fingerprint(pending.receipt)!==fingerprint(receipt)||fingerprint(pending.input)!==fingerprint(input)||pending.basisFingerprint!==basisFingerprint)) {
      throw guidanceError(new Error('Pending output conflict: recover the same payload and authority with its unchanged review basis'), 'guid-5ed18b803ee0bdea');
    }
    if(!linked&&!pending) {
      // Reserve before either output service can create an accepted artifact.
      // A crash leaves this revision-safe reservation discoverable and blocks
      // redo/close until the same currently authorized request finishes linking.
      const reservation={receipt,input,basisFingerprint,workshopRevision:note.revision,sourceGuards};
      const reserved=await this.fs.writeNoteWithRevisionGuardsAndReceipt({path,content:note.content,
        frontmatter:{...note.frontmatter,workshop_output_pending:reservation},expectedRevision:note.revision},
        [...guardMap.values()].filter(g=>g.path!==path).concat({path:target,expectedRevision:'missing'}),{maxGuards:128,assertAccess});
      note=await this.fs.readNote(path);
      if(note.revision!==reserved.revision)throw guidanceError(new Error('Workshop revision changed after output reservation; reread before recovery'), 'guid-5579a0209f75d7f1');
      guardMap.set(path.toLowerCase(),{path,expectedRevision:reserved.revision});
    }
    const link=async(revision:string)=>{
      await assertAccess();await this.current(path,note);
      if(linked)return note.revision;
      const guards=[...guardMap.values()].filter(g=>g.path!==path);
      guards.push({path:target,expectedRevision:revision});
      const frontmatter:ParsedNote['frontmatter']={...note.frontmatter,workshop_outputs:[...records,{...receipt,path:target,revision}]};
      delete frontmatter.workshop_output_pending;
      const r=await this.fs.writeNoteWithRevisionGuardsAndReceipt({path,content:`${note.content.trimEnd()}\n\n- Output ${outputId}: [[${target}]]\n`,
        frontmatter,expectedRevision:note.revision},guards,{maxGuards:128,assertAccess});
      return r.revision;
    };
    if(await this.fs.noteExists(target)) {
      const existing=await this.fs.readNote(target);
      if(isModerationHidden(existing.frontmatter)||fingerprint(existing.frontmatter.workshop_output)!==fingerprint(receipt))throw guidanceError(new Error('Output ID conflict or different payload; never overwrite it'), 'guid-99c4501a828d4c82');
      if(existing.frontmatter.workshop_output_content_sha256 && existing.frontmatter.workshop_output_content_sha256!==fingerprint(existing.content))throw guidanceError(new Error('Output content changed; inspect it before further action'), 'guid-7d0c33d56e86a0bb');
      return {success:true,path:target,revision:existing.revision,workshopRevision:await link(existing.revision),replayed:true,outputId};
    }
    if(linked)throw guidanceError(new Error('Linked output is missing; inspect it before further action'), 'guid-b169fc1f9b0acea4');
    const result=await this.adapter.create(input,[...guardMap.values()],receipt,actor,d.projectId,assertAccess);
    return {success:true,path:target,revision:result.revision,workshopRevision:await link(result.revision),replayed:false,outputId};
  }
}
