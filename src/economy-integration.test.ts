import { afterEach, expect, test,vi } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { EconomyLedger } from './economy-ledger.js';
import type { EconomyPolicy } from './economy-model.js';
import {FileSystemService} from './filesystem.js';
import {validatePaidClaimRecovery} from './economy-claim-recovery.js';

const roots:string[]=[];
afterEach(async()=>{for(const p of roots.splice(0))await rm(p,{recursive:true,force:true});});
test('quest endpoints preserve five tools, remain disabled without host setup, and reject read-only mutations',async()=>{
 const vault=await mkdtemp(join(tmpdir(),'quest-mcp-'));roots.push(vault);
 const server=createServer(vault,{readOnly:true});const client=new Client({name:'quest-test',version:'1'});
 const [ct,st]=InMemoryTransport.createLinkedPair();await Promise.all([client.connect(ct),server.connect(st)]);
 try {
  expect((await client.listTools()).tools).toHaveLength(5);
  const found=await client.callTool({name:'search_capabilities',arguments:{query:'quest',maxChars:12000}});
  expect(JSON.stringify(found.content)).toContain('quest.market');
  const attempt=await client.callTool({name:'call_endpoint',arguments:{endpointId:'quest.contract',arguments:{op:'fund',contractId:'q',requestId:'x',expectedRevision:'a'.repeat(64)}}});
  expect(attempt.isError).toBe(true);expect(JSON.stringify(attempt.content)).toContain('read-only');
  const unavailable=await client.callTool({name:'call_endpoint',arguments:{endpointId:'quest.market',arguments:{}}});
  expect(unavailable.isError).toBe(true);expect(JSON.stringify(unavailable.content)).toContain('disabled');
 } finally {await client.close();await server.close();}
});
test.each(['research','mechanical','recovery'] as const)('three authenticated owners settle %s work without double payment',async(mode)=>{
 const kind=mode==='recovery'?'research':mode;
 const root=await mkdtemp(join(tmpdir(),'paid-work-mcp-'));roots.push(root);
 const vault=join(root,'vault'),host=join(root,'host');await mkdir(vault);await mkdir(host);
 const policy:EconomyPolicy={version:1,revision:'pilot',enabled:true,treasury:'treasury',operators:['operator'],owners:{treasury:'host',alice:'owner-a',bob:'owner-b',carol:'owner-c'},reviewers:['carol'],subjectiveReview:true,maxSupply:5000,minReward:10,maxReward:100,postingFee:2,reviewFee:5,dailySpend:107,dailyPosts:1,openContracts:2};
 const ledger=await EconomyLedger.initialize({vaultPath:vault,hostPath:host,policy,storageVerified:true});
 await ledger.transact({op:'issue',actor:'operator',requestId:'mint',amount:5000,reason:'approved pilot'});
 await ledger.transact({op:'allocate',actor:'operator',requestId:'budget',account:'alice',amount:200,reason:'owner budget'});
 const server=createServer(vault,{economy:{ledger,policy}}),client=new Client({name:'paid-work',version:'1'});
 const [ct,st]=InMemoryTransport.createLinkedPair();await Promise.all([client.connect(ct),server.connect(st)]);
 const tokens:Record<string,string>={};
 const call=async(account:string,endpointId:string,args:Record<string,unknown>={})=>{
  const r=await client.callTool({name:'call_endpoint',arguments:{endpointId,arguments:args,...(tokens[account]&&{accessToken:tokens[account]})}});
  const text=(r.content as any[]).map(x=>x.text||'').join('\n');if(r.isError)throw new Error(text);return JSON.parse(text);
 };
 try {
  for(const account of ['alice','bob','carol'])tokens[account]=(await call(account,'auth.register',{accountId:account,modelId:'codex',agentId:account,password:'test-only-password-1234'})).accessToken;
  await call('alice','work.project',{op:'create',projectId:'paid',title:'Peer evidence review',goal:'Preserve uncertainty',allowedWork:['Local notes only'],completionCriteria:['Reviewed result'],participants:['alice','bob','carol'],requestId:'project',expectedRevision:'missing'});
  const task=await call('alice','mcp.create_agent_task',{taskId:'paid-one',projectId:'paid',title:'Check a claim',description:'Consider a contrary condition',completionCriteria:['Preserve contrary evidence'],requestId:'task'});
  const draft=await call('alice','quest.contract',{op:'draft',contractId:'q',requestId:'draft',expectedRevision:'missing',terms:{taskId:'paid-one',taskRevision:task.revision,title:'Counterexample review',criteria:kind==='mechanical'?['literal:contrary case limits']:['Preserve contrary evidence'],exclusions:['No external execution'],reward:100,kind,deadline:'2027-01-01T00:00:00.000Z',verifier:kind==='mechanical'?'markdown-literal-v1':'independent-review-v1'}});
  const funded=await call('alice','quest.contract',{op:'fund',contractId:'q',requestId:'fund',expectedRevision:draft.revision});
  await expect(call('bob','work.claim',{op:'start',taskId:'paid-one',requestId:'bypass',expectedRevision:task.revision,expectedGeneration:0})).rejects.toThrow(/quest/);
  let claimed;
  if(mode==='recovery') {
    const original=ledger.transact.bind(ledger);
    const spy=vi.spyOn(ledger,'transact').mockImplementation(async(command,validate)=>{
      if(command.op==='claim')throw new Error('Simulated crash after Work write before journal');
      return original(command,validate);
    });
    await expect(call('bob','quest.contract',{op:'claim',contractId:'q',requestId:'claim',expectedRevision:funded.revision,expectedGeneration:0})).rejects.toThrow(/crash/);
    spy.mockRestore();
    const local=new FileSystemService(vault),n=await local.readNote('Community/Tasks/paid-one.md');
    const recovery={op:'recover_claim' as const,actor:'operator',account:'bob',contractId:'q',expectedRevision:funded.revision,expectedGeneration:0,requestId:'host-repair',reason:'Recover exact committed Work receipt',workBinding:{revision:n.revision,generation:1,requestId:n.frontmatter.economy_claim_request_id}};
    await expect(validatePaidClaimRecovery(await ledger.snapshot(),{...recovery,account:'carol'},local)).rejects.toThrow(/divergence/i);
    claimed=await ledger.transact(recovery,state=>validatePaidClaimRecovery(state,recovery,local));
    expect((await ledger.snapshot()).contracts.q?.escrow).toBe(105);
  } else claimed=await call('bob','quest.contract',{op:'claim',contractId:'q',requestId:'claim',expectedRevision:funded.revision,expectedGeneration:0});
  const paidTask=await call('bob','notes.read',{path:'Community/Tasks/paid-one.md',maxChars:12000});
  expect(paidTask.fm.economy_contract_id).toBe('q');
  expect(paidTask.fm.economy_claim_generation).toBe(1);
  expect(paidTask.fm.economy_claim_request_id).toMatch(/^quest-/);
  expect((await call('bob','work.packet',{taskId:'paid-one',maxChars:12000})).items.find((v:any)=>v.kind==='paidContract').contractId).toBe('q');
  expect(await call('alice','quest.contract',{op:'fund',contractId:'q',requestId:'fund',expectedRevision:draft.revision})).toEqual(funded);
  const result=await call('bob','notes.write',{path:'Knowledge/Result.md',content:'# Result\nA contrary case limits the original claim.',expectedRevision:'missing'});
  const taskPath=join(vault,'Community/Tasks/paid-one.md'), original=await readFile(taskPath,'utf8');
  await writeFile(taskPath,original.replace('claim_generation: 1','claim_generation: 2'));
  await expect(call('bob','quest.contract',{op:'submit',contractId:'q',requestId:'revoked-submit',expectedRevision:claimed.revision,expectedGeneration:1,artifacts:[{path:'Knowledge/Result.md',revision:result.revision}]})).rejects.toThrow(/Work|generation|binding/);
  await writeFile(taskPath,original);
  const submitted=await call('bob','quest.contract',{op:'submit',contractId:'q',requestId:'submit',expectedRevision:claimed.revision,expectedGeneration:1,artifacts:[{path:'Knowledge/Result.md',revision:result.revision}]});
  const assertWorkResult = async (reviewRevision?: string) => {
    const packet = await call('bob','work.packet',{taskId:'paid-one',maxChars:12000,limit:100});
    const settled = packet.items.find((item:any)=>item.kind==='paidContract');
    expect(settled, JSON.stringify(packet)).toMatchObject({status:'settled',freeMutationBlocked:false,workStatusIndependent:true,
      artifacts:expect.arrayContaining([{kind:'submission',path:'Knowledge/Result.md',revision:result.revision,currentRevision:result.revision,stale:false}])});
    if(reviewRevision)expect(settled.artifacts).toContainEqual({kind:'review',path:'Knowledge/Review.md',revision:reviewRevision,currentRevision:reviewRevision,stale:false});
    expect(packet.items.find((item:any)=>item.kind==='task').status).toBe('in_progress');
    expect(packet.items).toContainEqual(expect.objectContaining({kind:'nextAction',tool:'mcp.update_agent_task',requiredInput:['verification or progress fields']}));
  };
  if(kind==='mechanical') {
    expect((await call('bob','quest.market',{contractId:'q'})).items[0].status).toBe('settled');
    expect(await call('bob','quest.contract',{op:'submit',contractId:'q',requestId:'submit',expectedRevision:claimed.revision,expectedGeneration:1,artifacts:[{path:'Knowledge/Result.md',revision:result.revision}]})).toEqual(submitted);
    expect((await call('bob','economy.wallet')).availableXp).toBe(100);
    expect((await call('carol','economy.wallet')).availableXp).toBe(0);
    expect((await ledger.snapshot()).issued).toBe(5000);await assertWorkResult();return;
  }
  const market=await call('carol','quest.market',{contractId:'q'});
  const review=await call('carol','notes.write',{path:'Knowledge/Review.md',content:'# Review\nChecked the original result; contrary condition is explicit.',expectedRevision:'missing'});
  const payload={op:'review',contractId:'q',requestId:'review',expectedRevision:submitted.revision,expectedGeneration:1,basis:market.items[0].submissionBasis,verdict:'approve',reason:'Exact source and uncertainty checked',reviewArtifact:{path:'Knowledge/Review.md',revision:review.revision}};
  const paid=await call('carol','quest.review',payload);expect(paid.status).toBe('settled');
  await assertWorkResult(review.revision);
  const reviewFile = join(vault,'Knowledge/Review.md');
  const reviewRaw = await readFile(reviewFile,'utf8');
  await writeFile(reviewFile, `---\nmoderation_status: hidden\n---\n${reviewRaw}`);
  const hiddenPacket = await call('bob','work.packet',{taskId:'paid-one',maxChars:12000,limit:100});
  expect(hiddenPacket.items.find((item:any)=>item.kind==='paidContract').artifacts).not.toContainEqual(expect.objectContaining({path:'Knowledge/Review.md'}));
  expect(await call('carol','quest.review',payload)).toEqual(paid);
  expect((await call('bob','economy.wallet')).availableXp).toBe(100);
  expect((await call('carol','economy.wallet')).availableXp).toBe(5);
  expect((await ledger.snapshot()).issued).toBe(5000);
 } finally {await client.close();await server.close();await ledger.close();}
});
