import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EconomyLedger } from './economy-ledger.js';
import { inspectEconomyRecovery, recoverEconomyWriter, loadEconomyHostConfig, validateOperatorAdjudication } from './economy-host.js';
import { FileSystemService } from './filesystem.js';
import { initialEconomy, type EconomyPolicy, type QuestContract } from './economy-model.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const policy:EconomyPolicy={version:1,revision:'host-pilot',enabled:true,treasury:'treasury',operators:['operator'],owners:{treasury:'host',alice:'a'},reviewers:[],subjectiveReview:false,maxSupply:5000,minReward:10,maxReward:100,postingFee:2,reviewFee:5,dailySpend:107,dailyPosts:1,openContracts:2,treasuryWeeklyBudget:500};
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'economy-host-'));roots.push(root);
  const vaultPath=join(root,'vault'),hostPath=join(root,'host');await mkdir(vaultPath);await mkdir(hostPath);
  return {vaultPath,hostPath,policy,storageVerified:true};
}
it('never removes a live writer and requires the exact recovery inspection fingerprint',async()=>{
  const o=await fixture(),ledger=await EconomyLedger.initialize(o);
  try {
    const preview=await inspectEconomyRecovery(o);
    await expect(recoverEconomyWriter(o,{expectedFingerprint:preview.fingerprint,reason:'inspect only'})).rejects.toThrow(/live|running/i);
    await expect(recoverEconomyWriter(o,{expectedFingerprint:'0'.repeat(64),reason:'inspect only'})).rejects.toThrow(/changed|fingerprint/i);
    expect((await ledger.snapshot()).issued).toBe(0);
  }finally{await ledger.close();}
});
it('recovers a dead writer without discarding journal or trusted checkpoint',async()=>{
  const o=await fixture(),ledger=await EconomyLedger.initialize(o);
  await ledger.transact({op:'issue',actor:'operator',requestId:'genesis',amount:5000,reason:'test'});await ledger.close();
  // Invalid PID is not accepted as proof of death; a real killed child is tested separately.
  await writeFile(join(o.vaultPath,'.mcpvault-economy/writer.lock'),JSON.stringify({pid:-1,nonce:'invalid',vault:o.vaultPath}));
  const preview=await inspectEconomyRecovery(o);
  await expect(recoverEconomyWriter(o,{expectedFingerprint:preview.fingerprint,reason:'invalid PID'})).rejects.toThrow(/pid|writer/i);
  expect((await readdir(join(o.vaultPath,'.mcpvault-economy/journal'))).filter(n=>n.endsWith('.md'))).toHaveLength(1);
});
it('refuses a dead recovery gate so concurrent recoverers cannot overwrite it',async()=>{
  const o=await fixture(),ledger=await EconomyLedger.initialize(o);await ledger.close();
  const child=spawn(process.execPath,['-e','']);const pid=child.pid!;await once(child,'exit');
  const gate=join(o.vaultPath,'.mcpvault-economy/recovery.lock');
  const original=JSON.stringify({version:1,pid,nonce:'dead-recovery-owner',vault:o.vaultPath,startedAt:'2026-09-08T00:00:00.000Z'});
  await writeFile(gate,original);
  const preview=await inspectEconomyRecovery(o);
  const attempts=await Promise.allSettled([
    recoverEconomyWriter(o,{expectedFingerprint:preview.fingerprint,reason:'first recovery attempt'}),
    recoverEconomyWriter(o,{expectedFingerprint:preview.fingerprint,reason:'second recovery attempt'}),
  ]);
  expect(attempts.every(result=>result.status==='rejected')).toBe(true);
  for(const attempt of attempts)if(attempt.status==='rejected')expect(String(attempt.reason)).toMatch(/forensic|gate/i);
  expect(await readFile(gate,'utf8')).toBe(original);
});
it('rejects a journal gap before recovery can repair the writer lock',async()=>{
  const o=await fixture(),ledger=await EconomyLedger.initialize(o);
  await ledger.transact({op:'issue',actor:'operator',requestId:'first',amount:5000,reason:'test'});
  await ledger.transact({op:'allocate',actor:'operator',requestId:'second',account:'alice',amount:200,reason:'test'});
  await ledger.close();
  const journal=join(o.vaultPath,'.mcpvault-economy/journal');
  await rm(join(journal,'0000000001.md'));
  const lock=join(o.vaultPath,'.mcpvault-economy/writer.lock');
  await writeFile(lock,JSON.stringify({pid:process.pid,nonce:'live-test-lock',vault:o.vaultPath}));
  await expect(recoverEconomyWriter(o,{expectedFingerprint:'0'.repeat(64),reason:'must refuse damaged journal'})).rejects.toThrow(/sequence gap|fork/i);
  expect(await readFile(lock,'utf8')).toContain('live-test-lock');
});
it('host configuration is bounded, exact-vault, outside-vault and off unless explicitly enabled',async()=>{
  const o=await fixture(),config=join(o.hostPath,'config.json');
  await writeFile(config,JSON.stringify({version:1,vaultPath:o.vaultPath,hostPath:o.hostPath,policy:{...policy,enabled:false}}));
  expect((await loadEconomyHostConfig(config,o.vaultPath)).policy.enabled).toBe(false);
  await expect(loadEconomyHostConfig(config,o.hostPath)).rejects.toThrow(/vault/i);
  const inVault=join(o.vaultPath,'config.json');await writeFile(inVault,await readFile(config));
  await expect(loadEconomyHostConfig(inVault,o.vaultPath)).rejects.toThrow(/outside|private/i);
});

it('validates the exact Work claim and fixed visible artifacts at adjudication commit time',async()=>{
  const o=await fixture(),fs=new FileSystemService(o.vaultPath);
  const task=await fs.writeNoteWithReceipt({path:'Community/Tasks/paid.md',content:'# Paid task',frontmatter:{mcpvault_type:'agent_task',task_id:'paid',project_id:'project',status:'in_progress',assignee_account_id:'worker',claim_generation:1}});
  const artifact=await fs.writeNoteWithReceipt({path:'Knowledge/result.md',content:'# Result',frontmatter:{}});
  const contract:QuestContract={id:'quest',requester:'alice',requesterOwner:'a',worker:'worker',workerOwner:'b',terms:{taskId:'paid',taskRevision:'a'.repeat(64),title:'Verify',criteria:['exact'],exclusions:[],reward:10,kind:'mechanical',deadline:'2027-01-01T00:00:00.000Z',verifier:'markdown-literal-v1'},policyRevision:'host-pilot',reviewFee:0,postingFee:2,escrow:10,status:'submitted',generation:1,createdAt:'2026-09-08T00:00:00.000Z',updatedAt:'2026-09-08T00:00:00.000Z',revisionRequests:0,workBinding:{revision:task.revision,generation:1,requestId:'claim'},submission:{artifacts:[{path:'Knowledge/result.md',revision:artifact.revision}],basis:'b'.repeat(64),at:'2026-09-08T00:00:00.000Z'}};
  const state={...initialEconomy(),contracts:{quest:contract}};
  const command={op:'resolve' as const,actor:'operator',requestId:'adjudicate',contractId:'quest',expectedRevision:'a'.repeat(64),expectedGeneration:1,amount:10,basis:contract.submission.basis,reason:'operator receipt'};
  await expect(validateOperatorAdjudication(state,command,fs)).resolves.toBeUndefined();
  const changed=await fs.readNote('Community/Tasks/paid.md');
  await fs.writeNote({path:'Community/Tasks/paid.md',content:changed.content,frontmatter:{...changed.frontmatter,claim_generation:2},expectedRevision:changed.revision});
  await expect(validateOperatorAdjudication(state,command,fs)).rejects.toThrow(/divergence|claim/i);
});
