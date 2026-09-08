import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EconomyLedger, admitEconomyEventBytes } from './economy-ledger.js';
import type { EconomyPolicy } from './economy-model.js';

const dirs: string[] = [];
afterEach(async () => { for (const p of dirs.splice(0)) await rm(p, { recursive: true, force: true }); });
const policy: EconomyPolicy = { version:1,revision:'pilot',enabled:true,treasury:'treasury',operators:['operator'],owners:{treasury:'host',alice:'a'},reviewers:[],subjectiveReview:false,maxSupply:5000,minReward:10,maxReward:100,postingFee:2,reviewFee:5,dailySpend:107,dailyPosts:1,openContracts:2 };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-economy-')); dirs.push(root);
  const vaultPath = join(root,'vault'); const hostPath = join(root,'host');
  await mkdir(vaultPath); await mkdir(hostPath);
  return { vaultPath, hostPath, policy, storageVerified: true as const };
}
test('ledger replays committed Markdown and permanent request ids across restart', async () => {
  const options = await fixture(); const ledger = await EconomyLedger.initialize(options);
  const command = { op:'issue' as const, actor:'operator',requestId:'initial-issuance',amount:5000,reason:'host-approved pilot' };
  const receipt = await ledger.transact(command);
  await ledger.close();
  const reopened = await EconomyLedger.open(options);
  try {
    expect(await reopened.transact(command)).toEqual(receipt);
    expect((await reopened.snapshot()).issued).toBe(5000);
    const files = await readdir(join(options.vaultPath,'.mcpvault-economy','journal'));
    expect(files.filter(f=>f.endsWith('.md'))).toHaveLength(1);
    expect(await readFile(join(options.vaultPath,'.mcpvault-economy','journal',files[0]!), 'utf8')).toContain('mcpvault_type: economy_transaction');
  } finally { await reopened.close(); }
});
test('a second writer is refused and concurrent issuance remains conserved', async () => {
  const options = await fixture(); const ledger = await EconomyLedger.initialize(options);
  try {
    await expect(EconomyLedger.open(options)).rejects.toThrow(/writer/);
    const results = await Promise.allSettled([1,2].map(i=>ledger.transact({op:'issue',actor:'operator',requestId:`initial-${i}`,amount:5000,reason:'approval'})));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((await ledger.snapshot()).issued).toBe(5000);
  } finally { await ledger.close(); }
});
test('trusted external checkpoint detects tail deletion rather than paying from rolled-back state', async () => {
  const options=await fixture(); const ledger=await EconomyLedger.initialize(options);
  await ledger.transact({op:'issue',actor:'operator',requestId:'supply',amount:5000,reason:'approval'});
  await ledger.close();
  const journal=join(options.vaultPath,'.mcpvault-economy','journal');
  for (const f of await readdir(journal)) await unlink(join(journal,f));
  await expect(EconomyLedger.open(options)).rejects.toThrow(/checkpoint|rollback/);
});
test('missing checkpoint is not interpreted as fresh issuance permission',async()=>{
 const options=await fixture(); await expect(EconomyLedger.open(options)).rejects.toThrow(/initialized|checkpoint/);
 const ledger=await EconomyLedger.initialize(options); await ledger.close();
 for(const f of await readdir(options.hostPath))await unlink(join(options.hostPath,f));
 await expect(EconomyLedger.open(options)).rejects.toThrow(/initialized|checkpoint/);
});
test('a dot-prefixed ordinary child is still inside the Vault',async()=>{
 const o=await fixture();const child=join(o.vaultPath,'..private');await mkdir(child);
 await expect(EconomyLedger.open({...o,hostPath:child})).rejects.toThrow(/outside/);
});
test('mutation of caller-owned input during validation cannot alter committed command',async()=>{
 const o=await fixture();const ledger=await EconomyLedger.initialize(o);
 const command={op:'issue' as const,actor:'operator',requestId:'mint',amount:5000,reason:'approval'};
 try {
  await ledger.transact(command,async()=>{command.amount=1;command.requestId='changed';});
  expect((await ledger.snapshot()).issued).toBe(5000);
 } finally {await ledger.close();}
});
test('aggregate replay budget is checked before committing a transaction',()=>{
 expect(()=>admitEconomyEventBytes(32*1024*1024-10,11)).toThrow(/replay byte/);
 expect(()=>admitEconomyEventBytes(0,256*1024+1)).toThrow(/event byte/);
 expect(()=>admitEconomyEventBytes(32*1024*1024-10,10)).not.toThrow();
});
test('unverified storage and checkpoint inside vault fail closed', async () => {
  const o = await fixture();
  await expect(EconomyLedger.open({...o,storageVerified:false})).rejects.toThrow(/storage/);
  await expect(EconomyLedger.open({...o,hostPath:o.vaultPath})).rejects.toThrow(/outside/);
});

test('close stops new admission, drains accepted writes, and releases once',async()=>{
 const o=await fixture();const ledger=await EconomyLedger.initialize(o);
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 const accepted=ledger.transact({op:'issue',actor:'operator',requestId:'close-test',amount:5000,reason:'approval'},()=>gate);
 const closing=ledger.close();const sameClose=ledger.close();
 const refused=expect(ledger.snapshot()).rejects.toThrow(/closing|closed/);
 release();await accepted;await Promise.all([closing,sameClose,refused]);
 const reopened=await EconomyLedger.open(o);
 try {expect((await reopened.snapshot()).issued).toBe(5000);}finally{await reopened.close();}
});
