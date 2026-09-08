import { expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { IdeationService } from './ideation.js';

// Recorded outputs are authored by actual isolated model calls, not synthesized
// by this test. Replaying them is protocol validation, NOT another model trial.
for (const arm of ['free','managed']) {
 const outputPath=`docs/research/workshop-evaluation-${arm}.json`;
 test.skipIf(!existsSync(outputPath))(`recorded ${arm} model proposals replay through real workshop services`,async()=>{
  const inputs=JSON.parse(await readFile('docs/research/workshop-evaluation-cases.json','utf8'));
  const output=JSON.parse(await readFile(outputPath,'utf8'));
  expect(output.cases).toHaveLength(12);
  const root=await mkdtemp(join(tmpdir(),`workshop-model-${arm}-`));
  const fs=new FileSystemService(root),service=new IdeationService(fs,new ReferenceService(fs,new ScopeAccessPolicy()));
  const principal={accountId:'evaluator',modelId:'codex',role:'model' as const};
  try {
   for(const c of inputs.cases) {
    const result=output.cases.find((r:any)=>r.id===c.id);expect(result, c.id).toBeTruthy();
    expect(Array.from(JSON.stringify(result.result)).length,`${c.id} result budget`).toBeLessThanOrEqual(1600);
    expect(Array.from(JSON.stringify(result.steps??[])).length,`${c.id} method record budget`).toBeLessThanOrEqual(6000);
    expect(result.result.evidence.every((id:string)=>Object.hasOwn(c.facts,id)),`${c.id} source IDs`).toBe(true);
    const path=`Evidence-${c.id}.md`;
    await fs.writeNote({path,content:Object.entries(c.facts).map(([id,v])=>`## ${id}\n${v}`).join('\n\n')});
    const source=await fs.readNote(path);
    await service.createWorkshop({principal,workshopId:c.id,title:c.task,prompt:`${c.task}\n${c.constraint}`,
     ...(arm==='managed'?{facilitation:{version:1,purpose:c.task,scope:c.constraint,successCriteria:['A bounded proposal retaining known limits'],sourceRevisions:[{path,revision:source.revision}],methods:[{methodId:c.method}],facilitatorAccountId:'evaluator',participants:['evaluator'],decisionAuthority:{}}}:{})});
    const workshopPath=`Community/Workshops/${c.id}.md`;
    if(arm==='free') {
     const proposalPath=`Proposals/${c.id}.md`;
     await fs.writeNote({path:proposalPath,content:JSON.stringify(result.result,null,2)});
     await service.contributeWorkshop({principal,workshopId:c.id,kind:'idea',content:`Bounded free-form proposal: [[${proposalPath}]]. Conditions and uncertainties remain in the source note.`,requestId:`${c.id}-free`});
    } else {
     for(const [index,step] of result.steps.entries()) {
      const note=await fs.readNote(workshopPath);
      expect(step.stepId,`${c.id} actual step order`).toBe(note.frontmatter.facilitation.currentStepId);
      await service.contributeWorkshop({principal,workshopId:c.id,kind:'evaluation',content:result.result.summary,structured:step.structured,stepId:step.stepId,expectedRevision:note.revision,requestId:`${c.id}-${index}`});
      const packet=await service.readWorkshopFacilitation({principal,workshopId:c.id,limit:1,maxChars:12000});
      if(index<result.steps.length-1) {
       expect(packet.nextAction.kind,`${c.id} step ${index}`).toBe('advance');
       await service.updateWorkshopFacilitation({principal,workshopId:c.id,operation:'advance',expectedRevision:note.revision,requestId:`advance-${index}`,payload:{reason:'Explicit bounded model contribution recorded'}});
      } else expect(packet.nextAction.kind,c.id).toBe('record_output');
     }
     const note=await fs.readNote(workshopPath);
     await service.updateWorkshopFacilitation({principal,workshopId:c.id,operation:'synthesize',expectedRevision:note.revision,requestId:'model-synthesis',payload:{synthesis:result.result.summary,structured:{adopted:[result.result.summary],rejected:result.result.alternatives,minority:result.result.risks,uncertainty:result.result.uncertainties,revisit:result.result.nextAction}}});
     const synthesized=await fs.readNote(workshopPath);
     await service.updateWorkshopFacilitation({principal,workshopId:c.id,operation:'close',expectedRevision:synthesized.revision,requestId:'close',payload:{reason:'Recorded proposal only, no implementation or approval'}});
     expect((await fs.readNote(workshopPath)).frontmatter.phase).toBe('closed');
    }
   }
  } finally {await rm(root,{recursive:true,force:true});}
 },60000);
}
