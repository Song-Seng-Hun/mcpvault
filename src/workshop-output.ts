import { guidanceError } from './guidance-runtime.js';
import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ParsedNote } from './types.js';
import { normalizeScopeId } from './scopes.js';
import { fingerprint, textField } from './work-model.js';
import { isModerationHidden } from './moderation-policy.js';

export interface WorkshopOutputReceipt { workshopPath:string; outputId:string; payloadFingerprint:string; actor:string }
export interface WorkshopOutputInput {
  outputId:string; type:'decision'|'task'; kind:string; path:string; title:string;
  context?:string; decision?:string; description?:string; alternatives:string[]; consequences:string[];
  minority:string[]; uncertainty:string[]; revisit:string[]; evidencePaths:string[]; completionCriteria:string[];
}
type Guard={path:string;expectedRevision:string};
export function workshopDecisionSeal(frontmatter: ParsedNote['frontmatter'], content: string) {
  const { workshop_output_integrity: _seal, ...state } = frontmatter;
  return { version: 1, fingerprint: fingerprint({ state, content }) };
}
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
  return textField(description, 'Task description and caveats', 4000, true);
}
interface Delegation { projectId:string; accountId:string; grantor:string; decisionKinds:string[]; taskKinds:string[]; scope:string; reason:string; revoked:boolean }
export interface WorkshopOutputAdapter {
  authorizeProject(principal:ScopePrincipal,projectId:string,owner:boolean,delegate?:string,grantor?:string):Promise<Guard>;
  assertAccess(principal:ScopePrincipal,input:WorkshopOutputInput):Promise<void>;
  create(input:WorkshopOutputInput,guards:Guard[],receipt:WorkshopOutputReceipt,principal:ScopePrincipal,projectId:string,assertAccess:()=>Promise<void>):Promise<{revision:string}>;
  assertReadable?(principal:ScopePrincipal,path:string,container:string):Promise<void>;
  verifyTaskOrigin?(note:ParsedNote,input:WorkshopOutputInput,receipt:WorkshopOutputReceipt):void;
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
  async verifyReconciliationReplay(path:string,note:ParsedNote,actor:ScopePrincipal,payload:unknown,revalidate:()=>Promise<void>) {
    const v=object(payload),outputId=normalizeScopeId(text(v.outputId,'outputId',64),'outputId');
    const targetId=`meeting-${fingerprint({path,outputId}).slice(0,32)}`;
    const records=note.frontmatter.workshop_outputs;
    const record=Array.isArray(records)?records.find(r=>r.outputId===outputId):undefined;
    if(!record||![`Community/Knowledge/Decisions/${targetId}.md`,`Community/Tasks/${targetId}.md`].includes(record.path)||!this.adapter.assertReadable)throw guidanceError(Error('Reconciled output unavailable'), 'guid-5fb306842305da44');
    await revalidate();await this.adapter.assertReadable(actor,record.path,path);
    const output=await this.fs.readNote(record.path,8*1024*1024).catch(()=>{throw guidanceError(Error('Reconciled output unavailable'), 'guid-5fb306842305da44');});
    if(output.revision!==v.outputRevision||record.revision!==output.revision||isModerationHidden(output.frontmatter)||output.frontmatter.content_status==='deleted')throw guidanceError(Error('Reconciled output revision or visibility changed'), 'guid-6f5d732996098fd6');
    await this.current(path,note);await revalidate();await this.adapter.assertReadable(actor,record.path,path);
    const opposite=record.path.startsWith('Community/Tasks/')?`Community/Knowledge/Decisions/${targetId}.md`:`Community/Tasks/${targetId}.md`;
    try {
      const [outputRevision,workshopRevision,conflict]=await Promise.all([
        this.fs.readNoteRevision(record.path,8*1024*1024),this.fs.readNoteRevision(path,8*1024*1024),this.fs.noteExists(opposite),
      ]);
      if(conflict||outputRevision!==output.revision||workshopRevision!==note.revision)throw Error();
    }catch{throw guidanceError(Error('Reconciled output or workshop changed, conflicting or unavailable'), 'guid-53a89ba3bad5f234');}
    await revalidate();
  }
  async reconcile(path:string,note:ParsedNote,actor:ScopePrincipal,payload:unknown,revalidate:()=>Promise<void>,mutation:{requestKey:string;payloadHash:string}) {
    if(note.frontmatter.facilitator_account_id!==actor.accountId)throw guidanceError(Error('Only current facilitator may reconcile a pending output'), 'guid-7202cb9204a614de');
    const v=object(payload),outputId=normalizeScopeId(text(v.outputId,'outputId',64),'outputId'),reason=text(v.reason,'reason');
    if(Object.keys(v).some(k=>!['outputId','outputRevision','reason'].includes(k)) || typeof v.outputRevision!=='string' || !/^[a-f0-9]{64}$/.test(v.outputRevision))throw guidanceError(Error('Invalid output reconciliation fields or revision'), 'guid-dfeb17e7004ef4b2');
    const pending=note.frontmatter.workshop_output_pending;
    if(!pending||pending.receipt?.outputId!==outputId||pending.receipt.workshopPath!==path||!['decision','task'].includes(pending.input?.type)||pending.input.outputId!==outputId)throw guidanceError(Error('Pending output receipt does not match'), 'guid-1b41fb0183c04d81');
    const targetId=`meeting-${fingerprint({path,outputId}).slice(0,32)}`;
    const decision=`Community/Knowledge/Decisions/${targetId}.md`,task=`Community/Tasks/${targetId}.md`;
    const target=pending.input.type==='decision'?decision:task,opposite=target===decision?task:decision;
    if(pending.input.path!==target||!this.adapter.assertReadable)throw guidanceError(Error('Output recovery target unavailable'), 'guid-521a97ba8d7b5a6a');
    const checkedPaths:string[]=[];
    const assertAccess=async()=>{
      await revalidate();await this.adapter.assertReadable!(actor,target,path);
      for(const source of checkedPaths)await this.adapter.assertReadable!(actor,source,path);
    };
    await assertAccess();
    let output:ParsedNote;
    try {output=await this.fs.readNote(target,8*1024*1024);}catch{throw guidanceError(Error('Output unavailable; use cancel_output only when absent'), 'guid-c73e9523423c0645');}
    if(output.revision!==v.outputRevision)throw guidanceError(Error('Output revision changed; reread before reconciliation'), 'guid-0aa038bd1e936a26');
    if(isModerationHidden(output.frontmatter)||output.frontmatter.content_status==='deleted'||fingerprint(output.frontmatter.workshop_output??null)!==fingerprint(pending.receipt))throw guidanceError(Error('Output receipt or visibility changed'), 'guid-df052520fefac925');
    if(pending.input.type==='task') {
      if(!this.adapter.verifyTaskOrigin)throw guidanceError(Error('Output integrity verification unavailable'), 'guid-9d8a6a59874a478f');
      this.adapter.verifyTaskOrigin(output,pending.input,pending.receipt);
    } else if(output.frontmatter.llm_wiki_type!=='knowledge'||output.frontmatter.note_kind!=='decision'
      ||fingerprint(output.frontmatter.workshop_output_integrity??null)!==fingerprint(workshopDecisionSeal(output.frontmatter,output.content))) {
      throw guidanceError(Error('Output integrity unavailable or changed; preserve the output and reservation'), 'guid-618f8eded4212103');
    }
    const records=note.frontmatter.workshop_outputs??[];
    if(!Array.isArray(records)||records.length>=16||records.some(r=>r.outputId===outputId))throw guidanceError(Error('Output receipt history full or conflicting'), 'guid-e95a0435c33a41c5');
    if(!Array.isArray(pending.sourceGuards)||pending.sourceGuards.length>126||pending.sourceGuards.some((g:Guard)=>!g||typeof g.path!=='string'||typeof g.expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(g.expectedRevision)))throw guidanceError(Error('Output source guard budget or format is invalid'), 'guid-95bf1b3ef833cb98');
    let outcome:'reconciled'|'unresolved'='reconciled';
    try {if(this.basis(path,note,pending.sourceGuards)!==pending.basisFingerprint)outcome='unresolved';}catch{outcome='unresolved';}
    const guards:Guard[]=[{path:target,expectedRevision:output.revision},{path:opposite,expectedRevision:'missing'}];
    for(const guard of pending.sourceGuards) {
      if(guard.path===path)continue;
      try {
        if(typeof guard.path!=='string'||typeof guard.expectedRevision!=='string')throw Error();
        await this.adapter.assertReadable(actor,guard.path,path);
        const current=await this.fs.readNote(guard.path,8*1024*1024);
        if(isModerationHidden(current.frontmatter)||current.frontmatter.content_status==='deleted')throw Error();
        if(current.revision!==guard.expectedRevision)outcome='unresolved';
        guards.push({path:guard.path,expectedRevision:current.revision});
        checkedPaths.push(guard.path);
      }catch{outcome='unresolved';}
    }
    await assertAccess();await this.current(path,note);
    const result={reconciledOutputId:outputId,outcome};
    const frontmatter:ParsedNote['frontmatter']={...note.frontmatter,
      workshop_outputs:[...records,{...pending.receipt,path:target,revision:output.revision,outcome,reconciledBy:actor.accountId,reason}],
      facilitation_mutation_receipts:[...(note.frontmatter.facilitation_mutation_receipts||[]),{request_key:mutation.requestKey,payload_hash:mutation.payloadHash,operation:'reconcile_output',result}].slice(-16)};
    delete frontmatter.workshop_output_pending;
    let written;
    try {written=await this.fs.writeNoteWithRevisionGuardsAndReceipt({path,content:`${note.content.trimEnd()}\n\n- Output ${outputId}: [[${target}]] (${outcome})\n`,frontmatter,expectedRevision:note.revision},guards,{maxGuards:128,assertAccess});}
    catch {throw guidanceError(Error('Reconciliation unavailable; recheck current authority, output and workshop revisions'), 'guid-cc7fa45d92059f9f');}
    return {success:true,...result,revision:written.revision,authority:'Existing output preserved; no approval or execution permission changed'};
  }
  private basis(path:string,note:ParsedNote,sourceGuards:Guard[]) {
    return fingerprint({delegation:delegation(note.frontmatter.facilitation_delegation),facilitator:note.frontmatter.facilitator_account_id,
      facilitatorGeneration:note.frontmatter.facilitator_generation??null,facilitation:note.frontmatter.facilitation,
      phase:note.frontmatter.phase??null,contentFingerprint:fingerprint(note.content),
      sourceGuards:sourceGuards.filter(g=>g.path.toLowerCase()!==path.toLowerCase()).sort((a,b)=>a.path.localeCompare(b.path))});
  }
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
    const basisFingerprint=this.basis(path,note,sourceGuards);
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
