import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { WorkshopOutputService } from './workshop-output.js';
const roots: string[] = [];
afterEach(async()=>{ for(const root of roots.splice(0)) await rm(root,{recursive:true,force:true}); });
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'workshop-output-')); roots.push(root);
  const fs=new FileSystemService(root);
  const workshopPath='Community/Workshops/session.md', projectPath='Community/Projects/project.md';
  await fs.writeNote({path:workshopPath,content:'# Meeting',frontmatter:{mcpvault_type:'workshop',facilitator_account_id:'owner',facilitation:{participants:['owner','peer']}}});
  await fs.writeNote({path:projectPath,content:'# Project',frontmatter:{mcpvault_type:'work_project',project_id:'project',owner_account_id:'owner',participants:['owner','peer']}});
  let crash=false, beforeCreate:()=>Promise<void>=async()=>{};
  const service=new WorkshopOutputService(fs,{
    authorizeProject:async(principal,projectId,owner)=>{
      const n=await fs.readNote(projectPath);
      if(projectId!=='project'||!n.frontmatter.participants.includes(principal.accountId)||(owner&&n.frontmatter.owner_account_id!==principal.accountId))throw new Error('Project permission denied');
      return {path:projectPath,expectedRevision:n.revision};
    },
    assertAccess:async()=>{},
    create:async(input,guard,receipt,_principal,_projectId,assertAccess)=>{
      await beforeCreate();
      const result=await fs.writeNoteWithRevisionGuardsAndReceipt({path:input.path,content:input.description||input.decision||'',frontmatter:{workshop_output:receipt},expectedRevision:'missing'},guard,{assertAccess});
      if(crash){crash=false;throw new Error('lost response');}
      return result;
    },
  });
  const owner={accountId:'owner',modelId:'codex',role:'model' as const}, peer={...owner,accountId:'peer'};
  const delegation={projectId:'project',accountId:'peer',decisionKinds:['architecture'],taskKinds:['general'],scope:'Review only repository design; no execution grant',reason:'Owner approval'};
  const output={outputId:'result-one',type:'decision' as const,kind:'architecture',title:'Selected direction',context:'Known constraints',decision:'Use bounded reads',alternatives:['Unlimited reads rejected'],consequences:['No execution permission'],minority:['Consider latency'],uncertainty:['Load unmeasured'],revisit:['After measurement'],evidencePaths:[]};
  return {fs,service,workshopPath,projectPath,owner,peer,delegation,output,crash:()=>{crash=true;},beforeCreate:(fn:()=>Promise<void>)=>{beforeCreate=fn;}};
}
it('requires workshop and project owner authority for delegation',async()=>{
  const f=await fixture();const n=await f.fs.readNote(f.workshopPath);
  await expect(f.service.delegate(f.workshopPath,n,f.peer,f.delegation,async()=>{})).rejects.toThrow(/facilitator|owner/i);
  await f.service.delegate(f.workshopPath,n,f.owner,f.delegation,async()=>{});
  expect((await f.fs.readNote(f.workshopPath)).frontmatter.facilitation_delegation.accountId).toBe('peer');
});
it('rejects an oversized assembled decision before persisting a reservation',async()=>{
 const f=await fixture();await f.service.delegate(f.workshopPath,await f.fs.readNote(f.workshopPath),f.owner,f.delegation,async()=>{});
 const n=await f.fs.readNote(f.workshopPath);
 await expect(f.service.execute(f.workshopPath,n,f.peer,{...f.output,context:'x'.repeat(2000),minority:Array.from({length:5},(_,i)=>`${i}${'y'.repeat(449)}`)},async()=>{})).rejects.toThrow(/context|4000/);
 expect((await f.fs.readNote(f.workshopPath)).revision).toBe(n.revision);
});
it.each([false,true])('cancels a reservation only with current facilitator authority and proven absence (created=%s)',async(created)=>{
 const f=await fixture();await f.service.delegate(f.workshopPath,await f.fs.readNote(f.workshopPath),f.owner,f.delegation,async()=>{});
 if(created)f.crash();else f.beforeCreate(async()=>{throw new Error('invalid adapter preparation');});
 await expect(f.service.execute(f.workshopPath,await f.fs.readNote(f.workshopPath),f.peer,f.output,async()=>{})).rejects.toThrow();
 const pending=await f.fs.readNote(f.workshopPath),payload={outputId:f.output.outputId,reason:'Cancel absent invalid output'};
 await expect(f.service.cancel(f.workshopPath,pending,f.peer,payload,async()=>{})).rejects.toThrow(/facilitator/);
 if(created)await expect(f.service.cancel(f.workshopPath,pending,f.owner,payload,async()=>{})).rejects.toThrow(/missing|revision|exists/i);
 else {
  await f.service.cancel(f.workshopPath,pending,f.owner,payload,async()=>{});
  const n=await f.fs.readNote(f.workshopPath);expect(n.frontmatter.workshop_output_pending).toBeUndefined();expect(n.frontmatter.workshop_output_cancellations).toHaveLength(1);
 }
});
it('a cancelled absent reservation fences a late in-flight output creation',async()=>{
 const f=await fixture();await f.service.delegate(f.workshopPath,await f.fs.readNote(f.workshopPath),f.owner,f.delegation,async()=>{});
 let entered!:()=>void,release!:()=>void;
 const atPreparation=new Promise<void>(resolve=>{entered=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});
 f.beforeCreate(async()=>{entered();await resume;});
 const creating=f.service.execute(f.workshopPath,await f.fs.readNote(f.workshopPath),f.peer,f.output,async()=>{});
 const rejected=expect(creating).rejects.toThrow(/revision|changed|conflict/i);
 await atPreparation;
 const pending=await f.fs.readNote(f.workshopPath),target=pending.frontmatter.workshop_output_pending.input.path;
 try {await f.service.cancel(f.workshopPath,pending,f.owner,{outputId:f.output.outputId,reason:'Cancel before storage'},async()=>{});}finally{release();}
 await rejected;expect(await f.fs.noteExists(target)).toBe(false);
});
it('recovers a committed output after lost response without creating another note',async()=>{
  const f=await fixture();await f.service.delegate(f.workshopPath,await f.fs.readNote(f.workshopPath),f.owner,f.delegation,async()=>{});
  const n=await f.fs.readNote(f.workshopPath);f.crash();
  await expect(f.service.execute(f.workshopPath,n,f.peer,f.output,async()=>{})).rejects.toThrow('lost response');
  const pending=await f.fs.readNote(f.workshopPath);
  expect(pending.frontmatter.workshop_output_pending.input.outputId).toBe(f.output.outputId);
  expect(pending.frontmatter.workshop_output_pending.workshopRevision).toBe(n.revision);
  const result=await f.service.execute(f.workshopPath,pending,f.peer,f.output,async()=>{});
  expect(result.replayed).toBe(true);
  expect((await f.fs.readNote(result.path)).frontmatter.workshop_output.outputId).toBe('result-one');
  expect((await f.fs.readNote(f.workshopPath)).frontmatter.workshop_output_pending).toBeUndefined();
  await expect(f.service.execute(f.workshopPath,await f.fs.readNote(f.workshopPath),f.peer,{...f.output,decision:'Changed decision'},async()=>{})).rejects.toThrow(/different|conflict/i);
});

it.each(['decision','task'] as const)('revalidates the originating actor after %s preparation and recovers only with current authority',async(type)=>{
  const f=await fixture();await f.service.delegate(f.workshopPath,await f.fs.readNote(f.workshopPath),f.owner,f.delegation,async()=>{});
  const output=type==='decision'?f.output:{outputId:'task-one',type,kind:'general',title:'Measure',description:'Measure latency',completionCriteria:['Record timing']};
  let revoked=false;
  const assertActor=async()=>{if(revoked)throw new Error('Originating session revoked');};
  f.beforeCreate(async()=>{revoked=true;});
  await expect(f.service.execute(f.workshopPath,await f.fs.readNote(f.workshopPath),f.peer,output,assertActor)).rejects.toThrow(/revoked/);
  const pending=await f.fs.readNote(f.workshopPath);
  expect(await f.fs.noteExists(pending.frontmatter.workshop_output_pending.input.path)).toBe(false);
  await expect(f.service.execute(f.workshopPath,pending,f.peer,output,assertActor)).rejects.toThrow(/revoked/);
  revoked=false;f.beforeCreate(async()=>{});
  const recovered=await f.service.execute(f.workshopPath,pending,f.peer,output,assertActor);
  expect(recovered.replayed).toBe(false);
  expect((await f.fs.readNote(f.workshopPath)).frontmatter.workshop_output_pending).toBeUndefined();
});

it('pending reservations reject other IDs, changed payloads and changed review basis',async()=>{
  const f=await fixture();await f.service.delegate(f.workshopPath,await f.fs.readNote(f.workshopPath),f.owner,f.delegation,async()=>{});
  f.beforeCreate(async()=>{throw new Error('Interrupted before create');});
  await expect(f.service.execute(f.workshopPath,await f.fs.readNote(f.workshopPath),f.peer,f.output,async()=>{})).rejects.toThrow(/Interrupted/);
  const pending=await f.fs.readNote(f.workshopPath);
  for(const output of [{...f.output,outputId:'another'},{...f.output,decision:'Changed'}]) {
    await expect(f.service.execute(f.workshopPath,pending,f.peer,output,async()=>{})).rejects.toThrow(/pending|conflict/i);
  }
  await f.fs.writeNote({path:f.workshopPath,content:pending.content,frontmatter:{...pending.frontmatter,facilitation:{...pending.frontmatter.facilitation,round:2}},expectedRevision:pending.revision});
  await expect(f.service.execute(f.workshopPath,await f.fs.readNote(f.workshopPath),f.peer,f.output,async()=>{})).rejects.toThrow(/basis|pending/i);
});

it('serializes competing reservations at the workshop revision before creating either output',async()=>{
  const f=await fixture();await f.service.delegate(f.workshopPath,await f.fs.readNote(f.workshopPath),f.owner,f.delegation,async()=>{});
  const note=await f.fs.readNote(f.workshopPath);
  let creates=0;
  f.beforeCreate(async()=>{creates++;expect((await f.fs.readNote(f.workshopPath)).frontmatter.workshop_output_pending).toBeDefined();});
  const results=await Promise.allSettled([f.output,{...f.output,outputId:'competitor'}].map(output=>f.service.execute(f.workshopPath,note,f.peer,output,async()=>{})));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  expect(creates).toBe(1);
  expect((await f.fs.readNote(f.workshopPath)).frontmatter.workshop_outputs).toHaveLength(1);
});

it.each(['delegation','project','body','source'])('pending recovery rejects changed %s without overwriting the created output',async(change)=>{
  const f=await fixture();await f.service.delegate(f.workshopPath,await f.fs.readNote(f.workshopPath),f.owner,f.delegation,async()=>{});
  await f.fs.writeNote({path:'Evidence.md',content:'Original evidence'});
  const evidence=await f.fs.readNote('Evidence.md');
  const guards=[{path:'Evidence.md',expectedRevision:evidence.revision}];
  f.crash();
  await expect(f.service.execute(f.workshopPath,await f.fs.readNote(f.workshopPath),f.peer,f.output,async()=>{},guards)).rejects.toThrow(/lost response/);
  const pending=await f.fs.readNote(f.workshopPath),target=pending.frontmatter.workshop_output_pending.input.path;
  const output=await f.fs.readNote(target);
  if(change==='project') {
    const project=await f.fs.readNote(f.projectPath);
    await f.fs.writeNote({path:f.projectPath,content:project.content,frontmatter:{...project.frontmatter,participants:['owner']},expectedRevision:project.revision});
  } else if(change==='source') {
    await f.fs.writeNote({path:'Evidence.md',content:'Changed evidence',expectedRevision:evidence.revision});
    guards[0]!.expectedRevision=(await f.fs.readNote('Evidence.md')).revision;
  } else {
    await f.fs.writeNote({path:f.workshopPath,content:pending.content+(change==='body'?'\nChanged review':''),frontmatter:{...pending.frontmatter,
      ...(change==='delegation'?{facilitation_delegation:{...pending.frontmatter.facilitation_delegation,revoked:true}}:{})},expectedRevision:pending.revision});
  }
  await expect(f.service.execute(f.workshopPath,await f.fs.readNote(f.workshopPath),f.peer,f.output,async()=>{},guards)).rejects.toThrow(/permission|delegation|basis|pending/i);
  expect((await f.fs.readNote(target)).revision).toBe(output.revision);
  expect((await f.fs.readNote(f.workshopPath)).frontmatter.workshop_output_pending).toBeDefined();
});

it('revoked participation denies delegated output and malformed boolean is refused',async()=>{
 const f=await fixture();
 await expect(f.service.delegate(f.workshopPath,await f.fs.readNote(f.workshopPath),f.owner,{...f.delegation,revoked:'false'},async()=>{})).rejects.toThrow(/revoked/i);
 await f.service.delegate(f.workshopPath,await f.fs.readNote(f.workshopPath),f.owner,f.delegation,async()=>{});
 const n=await f.fs.readNote(f.workshopPath);await f.fs.writeNote({path:f.workshopPath,content:n.content,frontmatter:{...n.frontmatter,facilitation:{participants:['owner']}},expectedRevision:n.revision});
 await expect(f.service.execute(f.workshopPath,await f.fs.readNote(f.workshopPath),f.peer,f.output,async()=>{})).rejects.toThrow(/participant/i);
});

it('output receipt links back to its workshop without a second output type using the same ID',async()=>{
 const f=await fixture();await f.service.delegate(f.workshopPath,await f.fs.readNote(f.workshopPath),f.owner,f.delegation,async()=>{});
 const result=await f.service.execute(f.workshopPath,await f.fs.readNote(f.workshopPath),f.peer,f.output,async()=>{});
 const n=await f.fs.readNote(f.workshopPath);expect(n.content).toContain(`[[${result.path}]]`);
 await expect(f.service.execute(f.workshopPath,n,f.peer,{outputId:f.output.outputId,type:'task',kind:'general',title:'Other',description:'Other',completionCriteria:['Verify']},async()=>{})).rejects.toThrow(/conflict|different|type/i);
});
it('checks revocation and current project membership even on output retries',async()=>{
  const f=await fixture();await f.service.delegate(f.workshopPath,await f.fs.readNote(f.workshopPath),f.owner,f.delegation,async()=>{});
  const n=await f.fs.readNote(f.workshopPath);await f.service.execute(f.workshopPath,n,f.peer,f.output,async()=>{});
  const project=await f.fs.readNote(f.projectPath);await f.fs.writeNote({path:f.projectPath,content:project.content,frontmatter:{...project.frontmatter,participants:['owner']},expectedRevision:project.revision});
  await expect(f.service.execute(f.workshopPath,n,f.peer,f.output,async()=>{})).rejects.toThrow(/permission/i);
});
it('locks delegation revision through final output write',async()=>{
  const f=await fixture();await f.service.delegate(f.workshopPath,await f.fs.readNote(f.workshopPath),f.owner,f.delegation,async()=>{});
  const n=await f.fs.readNote(f.workshopPath);
  await expect(f.service.execute(f.workshopPath,n,f.peer,f.output,async()=>{
    await f.fs.writeNote({path:f.workshopPath,content:n.content,frontmatter:{...n.frontmatter,facilitation_delegation:{...n.frontmatter.facilitation_delegation,revoked:true}},expectedRevision:n.revision});
  })).rejects.toThrow(/revision|changed/i);
});
