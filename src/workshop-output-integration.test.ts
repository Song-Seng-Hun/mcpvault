import { expect,it,vi } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client,InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';
import { ScopeAuthService } from './scope-auth.js';
import { ModerationService } from './moderation.js';
const scenarios=[
 {type:'decision',failure:'none'},
 ...['decision','task'].flatMap(type=>['session','capability','moderation','lost response'].map(failure=>({type,failure}))),
];
it.each(scenarios)('normal output services enforce $type persistence and recover $failure',async(scenario)=>{
 const vault=await mkdtemp(join(tmpdir(),'workshop-output-protocol-'));
 const server=createServer(vault),client=new Client({name:'output-protocol',version:'1'}),[ct,st]=InMemoryTransport.createLinkedPair();
 await Promise.all([client.connect(ct),server.connect(st)]);
 let accessToken:string|undefined;
 const call=async(name:string,args:Record<string,unknown>)=>{const r=await client.callTool({name,arguments:{...args,...(accessToken?{accessToken}:{})}});const v=JSON.parse((r.content as any)[0].text.startsWith('{')?(r.content as any)[0].text:JSON.stringify({error:(r.content as any)[0].text}));if(r.isError)throw new Error(v.error||JSON.stringify(v));return v;};
 try {
  accessToken=(await call('register_scope_account',{accountId:'owner',modelId:'codex',password:'isolated-test-only-123'})).accessToken;
  const source=await call('ingest_source',{sourceId:'evidence',title:'Current evidence',content:'# Current evidence\nUse bounded responses.'});
  await call('manage_work_project',{op:'create',projectId:'project',title:'Project',goal:'Bounded responses',allowedWork:['Document an architecture choice'],completionCriteria:['One grounded choice'],participants:['owner'],requestId:'project'});
  let state=await call('create_workshop',{workshopId:'meeting',title:'Checklist review',prompt:'Review bounded response design',facilitation:{version:1,purpose:'Review response design',scope:'Project only',successCriteria:['Choice with caveats'],sourceRevisions:[{path:source.path,revision:source.revision}],methods:[{methodId:'checklist'}],facilitatorAccountId:'owner',participants:['owner'],decisionAuthority:{}}});
  const update=(operation:string,payload:unknown,requestId:string)=>call('update_workshop_facilitation',{workshopId:'meeting',operation,payload,requestId,expectedRevision:state.revision});
  await expect(update('close',{reason:'Premature'},'too-early')).rejects.toThrow(/final|complete|finish/i);
  for(const stepId of ['checklist-prepare','checklist-progress','checklist-close']) {
    await call('contribute_workshop',{workshopId:'meeting',kind:'evaluation',content:'Verified bounded output contract against source.',stepId,expectedRevision:state.revision,requestId:stepId,
      structured:{checks:[{itemId:'bounded-contract',status:'pass',actor:'owner',evidence:'Evidence.md',reason:'Source inspected'}]}});
    if(stepId!=='checklist-close')state=await update('advance',{reason:'Explicit check passed'},`${stepId}-advance`);
  }
  state=await update('synthesize',{synthesis:'Choose bounded responses; latency remains unmeasured.',structured:{adopted:['Bounded responses'],rejected:['Unlimited payloads'],minority:['Latency matters'],uncertainty:['Load unmeasured'],revisit:'After load measurement'}},'synthesis');
  state=await update('delegate',{projectId:'project',accountId:'owner',decisionKinds:['architecture'],taskKinds:['general'],scope:'Document choice and propose measurement; no deployment',reason:'Project owner approval'},'delegation');
  const execute=async(output:Record<string,unknown>,requestId:string)=>{
    if(scenario.failure==='none'||scenario.type!==output.type)return update('execute_output',output,requestId);
    const fs=new FileSystemService(vault),workshopPath='Community/Workshops/meeting.md';
    const originalWrite=FileSystemService.prototype.writeNoteWithRevisionGuardsAndReceipt;
    const originalAuthenticate=ScopeAuthService.prototype.authenticate;
    const originalCapability=ScopeAuthService.prototype.hasCapability;
    const originalBanned=ModerationService.prototype.isBanned;
    let auth:ScopeAuthService|undefined,revoked=false,target='',attempted=false;
    vi.spyOn(ScopeAuthService.prototype,'authenticate').mockImplementation(function(this:ScopeAuthService,token){auth=this;return originalAuthenticate.call(this,token);});
    vi.spyOn(ScopeAuthService.prototype,'hasCapability').mockImplementation(function(this:ScopeAuthService,principal,capability){
      if(revoked&&scenario.failure==='capability'&&capability===(output.type==='decision'?'publish':'task'))return false;
      return originalCapability.call(this,principal,capability);
    });
    vi.spyOn(ModerationService.prototype,'isBanned').mockImplementation(async function(this:ModerationService,accountId,userId){
      return revoked&&scenario.failure==='moderation'||await originalBanned.call(this,accountId,userId);
    });
    vi.spyOn(FileSystemService.prototype,'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async function(this:FileSystemService,write,guards,policy={}){
      if(write.frontmatter?.workshop_output?.outputId!==output.outputId)return originalWrite.call(this,write,guards,policy);
      target=write.path;attempted=true;
      if(scenario.failure==='lost response') {
        const result=await originalWrite.call(this,write,guards,policy);
        throw new Error(`lost response after ${result.revision}`);
      }
      // Revoke after the initial lock-time access check. The real filesystem
      // then awaits revision/serialization/directory preparation before its
      // final dispatch check, which must still carry the originating guard.
      return originalWrite.call(this,write,guards,{...policy,assertAccess:async()=>{
        await policy.assertAccess?.();
        if(!revoked){revoked=true;if(scenario.failure==='session')auth!.logout(accessToken);}
      }});
    });
    try {
      await expect(update('execute_output',output,requestId)).rejects.toThrow(/token|actor|capability|suspended|lost response/i);
      expect(attempted).toBe(true);
      const pending=await fs.readNote(workshopPath);
      expect(pending.frontmatter.workshop_output_pending.input.outputId).toBe(output.outputId);
      expect((pending.frontmatter.workshop_outputs||[]).some((r:any)=>r.outputId===output.outputId)).toBe(false);
      expect(await fs.noteExists(target)).toBe(scenario.failure==='lost response');
      state={...state,revision:pending.revision};
      if(scenario.failure!=='lost response') {
        await expect(update('execute_output',output,`${requestId}-revoked-retry`)).rejects.toThrow(/token|actor|capability|suspended/i);
        expect(await fs.noteExists(target)).toBe(false);
        return undefined;
      }
    } finally {vi.restoreAllMocks();}
    for(const operation of ['redo','close'])await expect(update(operation,{reason:'Attempt to strand output'},`${requestId}-${operation}`)).rejects.toThrow(/pending/i);
    const recovered=await update('execute_output',output,`${requestId}-recover`);
    expect(recovered.path).toBe(target);expect(recovered.replayed).toBe(true);
    expect((await fs.readNote(workshopPath)).frontmatter.workshop_output_pending).toBeUndefined();
    return recovered;
  };
  const decision={outputId:'architecture',type:'decision',kind:'architecture',title:'Bounded response choice',context:'Response budgets preserve source locators.',decision:'Use bounded results',alternatives:['Unlimited output rejected'],consequences:['More continuation reads'],minority:['Latency concern'],uncertainty:['Load unknown'],revisit:['After measurement'],evidencePaths:[source.path]};
  const first=await execute(decision,'decision');
  if(!first)return;
  state={...state,revision:first.workshopRevision};
  expect((await update('execute_output',decision,'decision-retry')).path).toBe(first.path);
  const written=await call('read_note',{path:first.path,maxChars:5000});
  expect(written.fm.decision_status).toBe('accepted');expect(written.content).toContain('Latency concern');
  const task=await execute({outputId:'measure',type:'task',kind:'general',title:'Measure load',description:'Measure response latency within approved local scope.',completionCriteria:['Record timing and limitations'],evidencePaths:[source.path]},'task');
  if(!task)return;
  state={...state,revision:task.workshopRevision};
  expect((await call('read_note',{path:task.path,maxChars:4000})).fm.project_id).toBe('project');
  state=await update('close',{reason:'Decision and proposed follow-up recorded'},'close');
  expect((await call('read_workshop',{workshopId:'meeting'})).workshop.phase).toBe('closed');
 }finally{await client.close();await server.close();await rm(vault,{recursive:true,force:true});}
},20000);
