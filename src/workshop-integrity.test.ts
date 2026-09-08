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
 for(const accountId of ['owner','peer'])await fs.writeNote({path:`Community/Workshops/proof/Contributions/${accountId}.md`,content:'# Input',frontmatter:{mcpvault_type:'workshop_contribution',workshop_id:'proof',contribution_id:accountId,account_id:accountId,facilitation_step_id:facilitation.currentStepId,workshop_revision:workshop.revision,structured:{ideaIds:[accountId],origin:accountId,evidence:{path:'Supporting.md',revision:supporting.revision}}}});
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

test('submission admission cannot race a scan-through-commit transition', async () => {
 const f=await fixture();
 let entered!:()=>void,release!:()=>void;
 const atCommit=new Promise<void>(resolve=>{entered=resolve;});
 const resume=new Promise<void>(resolve=>{release=resolve;});
 const advance=f.service.updateWorkshopFacilitation({principal:f.principal,workshopId:'proof',expectedRevision:f.workshop.revision,requestId:'serialized-advance',operation:'advance',payload:{reason:'Ready'},revalidateActor:async()=>{entered();await resume;return f.principal;}});
 await atCommit;
 const contribution=f.service.contributeWorkshop({principal:f.principal,workshopId:'proof',kind:'idea',content:'Late first-step input.',expectedRevision:f.workshop.revision,stepId:'brainwriting-independent',structured:{ideaIds:['late'],origin:'owner'},requestId:'serialized-late'});
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
