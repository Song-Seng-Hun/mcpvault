import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ReferenceService } from './references.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { IdeationService } from './ideation.js';
import { createFacilitation, managedFacilitationMarkdown } from './workshop-facilitation.js';
const roots:string[]=[];
afterEach(async()=>{for(const p of roots.splice(0))await rm(p,{recursive:true,force:true});});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'workshop-integrity-'));roots.push(root);
 const fs=new FileSystemService(root),refs=new ReferenceService(fs,new ScopeAccessPolicy());
 for(const path of ['Evidence.md','Supporting.md'])await fs.writeNote({path,content:'# Evidence'});
 const source=await fs.readNote('Evidence.md'), supporting=await fs.readNote('Supporting.md');
 const facilitation=createFacilitation({version:1,methods:[{methodId:'brainwriting'}],purpose:'Review evidence',scope:'Public',successCriteria:['Actual evidence'],sourceRevisions:[{path:'Evidence.md',revision:source.revision}],facilitatorAccountId:'owner',participants:['owner','peer'],decisionAuthority:{}});
 const path='Community/Workshops/proof.md';
 const authored='# Workshop\n```md\n## Managed facilitation\nDo not erase this example.\n```\n\n## Agenda\nPreserve this agenda.';
 await fs.writeNote({path,content:`${authored}\n\n${managedFacilitationMarkdown(facilitation)}\n\n## Authored follow-up\nKeep this too.`,frontmatter:{mcpvault_type:'workshop',workshop_id:'proof',phase:'diverge',facilitator_account_id:'owner',facilitation}});
 const workshop=await fs.readNote(path);
 for(const accountId of ['owner','peer'])await fs.writeNote({path:`Community/Workshops/proof/Contributions/${accountId}.md`,content:'# Input',frontmatter:{mcpvault_type:'workshop_contribution',workshop_id:'proof',contribution_id:accountId,account_id:accountId,facilitation_step_id:facilitation.currentStepId,workshop_revision:workshop.revision,structured:{variant:'async',ideaIds:[{ideaId:accountId,origin:accountId}],evidence:{path:'Supporting.md',revision:supporting.revision}}}});
 return {fs,path,authored,workshop,service:new IdeationService(fs,refs),principal:{accountId:'owner',modelId:'codex',role:'model' as const}};
}
test.each(['contribution','evidence'])('completion locks its counted %s through final actor revalidation',async(kind)=>{
 const f=await fixture();const target=kind==='contribution'?'Community/Workshops/proof/Contributions/peer.md':'Supporting.md';
 await expect(f.service.updateWorkshopFacilitation({principal:f.principal,workshopId:'proof',expectedRevision:f.workshop.revision,requestId:'advance',operation:'advance',payload:{reason:'Ready'},revalidateActor:async()=>{
  const note=await f.fs.readNote(target);await f.fs.writeNote({path:target,content:note.content+'\nChanged',frontmatter:{...note.frontmatter,moderation_status:'hidden'},expectedRevision:note.revision});return f.principal;
 }})).rejects.toThrow(/revision|changed|conflict/i);
 expect((await f.fs.readNote(f.path)).revision).toBe(f.workshop.revision);
});
test('updating generated facilitation preserves fenced examples and following authored sections',async()=>{
 const f=await fixture();await f.service.updateWorkshopFacilitation({principal:f.principal,workshopId:'proof',expectedRevision:f.workshop.revision,requestId:'resume',operation:'resume',payload:{resumeCondition:'Ready'}});
 const note=await f.fs.readNote(f.path);expect(note.content).toContain(f.authored);expect(note.content).toContain('## Authored follow-up\nKeep this too.');
});

test('new managed configurations cannot forge completed steps or synthesized outputs',async()=>{
 const f=await fixture();const config=f.workshop.frontmatter.facilitation;
 await expect(f.service.createWorkshop({principal:f.principal,workshopId:'forged',title:'Invalid',prompt:'Invalid progress',facilitation:{...config,currentStepId:'brainwriting-build'}})).rejects.toThrow(/initial|first|progress/i);
});

test('earlier transcript volume does not block a later step and large current attendance is guarded',async()=>{
 const f=await fixture();
 const config={...f.workshop.frontmatter.facilitation,currentStepId:'brainwriting-build'};
 await f.fs.writeNote({path:f.path,content:managedFacilitationMarkdown(config),frontmatter:{...f.workshop.frontmatter,facilitation:config},expectedRevision:f.workshop.revision});
 for(let i=0;i<130;i++)await f.fs.writeNote({path:`Community/Workshops/proof/Contributions/history-${i}.md`,content:'Old input',frontmatter:{mcpvault_type:'workshop_contribution',workshop_id:'proof',account_id:'peer',facilitation_step_id:'brainwriting-independent',workshop_revision:f.workshop.revision,structured:{variant:'async',ideaIds:[{ideaId:`old-${i}`,origin:'peer'}]}}});
 const n=await f.fs.readNote(f.path);
 for(const accountId of ['owner','peer'])await f.service.contributeWorkshop({principal:{...f.principal,accountId},workshopId:'proof',kind:'extension',content:'Extend earlier idea',expectedRevision:n.revision,stepId:'brainwriting-build',requestId:accountId,structured:{ideaIds:[{ideaId:`new-${accountId}`,origin:accountId,parentIdeaId:accountId,extension:'Apply a limit'}],extension:'Apply a limit',parentIdeaIds:[accountId]}});
 const read=await f.service.readWorkshopFacilitation({principal:f.principal,workshopId:'proof',limit:1});
 expect(read.nextAction.kind).toBe('record_output');
});

test('submission admission cannot race a scan-through-commit transition', async () => {
 const f=await fixture();
 let entered!:()=>void,release!:()=>void;
 const atCommit=new Promise<void>(resolve=>{entered=resolve;});
 const resume=new Promise<void>(resolve=>{release=resolve;});
 const advance=f.service.updateWorkshopFacilitation({principal:f.principal,workshopId:'proof',expectedRevision:f.workshop.revision,requestId:'serialized-advance',operation:'advance',payload:{reason:'Ready'},revalidateActor:async()=>{entered();await resume;return f.principal;}});
 await atCommit;
 const contribution=f.service.contributeWorkshop({principal:f.principal,workshopId:'proof',kind:'idea',content:'Late first-step input.',expectedRevision:f.workshop.revision,stepId:'brainwriting-independent',structured:{variant:'async',ideaIds:[{ideaId:'late',origin:'owner'}]},requestId:'serialized-late'});
 let settled=false;
 const outcome=contribution.then(()=>{settled=true;return 'accepted';},()=>{settled=true;return 'rejected';});
 // A separate request must remain queued while the transition owns admission.
 await new Promise(resolve=>setTimeout(resolve,100));
 const raced=settled;
 release();
 await advance;
 expect(await outcome).toBe('rejected');
 expect(raced).toBe(false);
});

test('persisted 6-3-5 resumes six distinct cycles without counting old-cycle submissions as current',async()=>{
 const f=await fixture(),accounts=['owner','a','b','c','d','e'];
 const config={...f.workshop.frontmatter.facilitation,participants:accounts};
 await f.service.createWorkshop({principal:f.principal,workshopId:'cycles',title:'Six cycles',prompt:'Consider alternatives',facilitation:config});
 for(let cycle=1;cycle<=6;cycle++) {
  const n=await f.fs.readNote('Community/Workshops/cycles.md'), stepId=n.frontmatter.facilitation.currentStepId;
  expect(n.frontmatter.facilitation.round).toBe(1);
  for(const [index,accountId] of accounts.entries()) {
   const parent=accounts[(index+1)%6];
   await f.service.contributeWorkshop({principal:{...f.principal,accountId},workshopId:'cycles',kind:cycle===1?'idea':'extension',content:'A bounded proposal',expectedRevision:n.revision,stepId,requestId:`${accountId}-${cycle}`,structured:{variant:'6-3-5',cycle,cycleMinutes:5,
    ideaIds:Array.from({length:3},(_,i)=>({ideaId:`${accountId}-${cycle}-${i}`,origin:'Proposal',...(cycle>1?{parentIdeaId:`${parent}-${cycle-1}-${i}`,extension:'Adapt proposal'}:{})})),
    ...(cycle>1?{extension:'Adapt peers',parentIdeaIds:Array.from({length:3},(_,i)=>`${parent}-${cycle-1}-${i}`)}:{})}});
  }
  const packet=await f.service.readWorkshopFacilitation({principal:f.principal,workshopId:'cycles',limit:1});
  expect(packet.submissionTotal).toBe(6);expect(packet.nextAction.kind).toBe(cycle<6?'advance':'record_output');
  if(cycle<6)await f.service.updateWorkshopFacilitation({principal:f.principal,workshopId:'cycles',expectedRevision:n.revision,operation:'advance',requestId:`cycle-${cycle}`,payload:{reason:'Actual submissions received; start next declared cycle'}});
 }
},60000); // Six real file-backed cycles, not a timing benchmark. Baseline measured 20.7s on the Windows host; keep assertions intact with I/O headroom.
