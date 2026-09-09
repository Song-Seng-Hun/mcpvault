import { guidanceError } from './guidance-runtime.js';
import { lstat, realpath, open, readdir, rename, unlink, statfs, link } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, sep,basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFederationFile, writeFederationFileAtomic, ensureFederationDirectory } from './public-federation-storage.js';
import { economyRevision, validateEconomyPolicy, type EconomyCommand, type EconomyPolicy, type EconomyState } from './economy-model.js';
import { assertContiguousEconomyJournalNames } from './economy-ledger.js';
import type { FileSystemService } from './filesystem.js';
import { isModerationHidden } from './moderation-policy.js';
import { assertLegacyEconomyStorage, bindEconomyStorage, validateEconomyStoragePaths, type EconomyStoragePaths } from './economy-storage.js';

const inside=(base:string,path:string)=>{const r=relative(base,path);return !r||(!r.startsWith(`..${sep}`)&&r!=='..'&&!isAbsolute(r));};
const missing=(e:unknown)=>Boolean(e&&typeof e==='object'&&'code'in e&&e.code==='ENOENT');
async function optional(root:string,path:string,maxBytes:number):Promise<string|undefined>{
  try{return await readFederationFile(root,path,{maxBytes});}catch(e){if(missing(e))return undefined;throw e;}
}
export interface EconomyHostConfig { version:1; vaultPath:string; hostPath:string; ledgerPath?:string; policy:EconomyPolicy }

interface RecoveryGate { version:1; pid:number; nonce:string; vault:string; startedAt:string }
const deadProcess=async(pid:number):Promise<boolean>=>{
  try {process.kill(pid,0);return false;}
  catch(e){if(e&&typeof e==='object'&&'code'in e&&e.code==='ESRCH')return true;throw guidanceError(new Error('Cannot establish recovery process death'), 'guid-7345f9b0283e1960');}
};
async function releaseRecoveryGate(path:string,gate:RecoveryGate):Promise<void>{
  await assertRecoveryGate(path,gate);
  await unlink(path);
}
async function assertRecoveryGate(path:string,gate:RecoveryGate):Promise<void>{
  const stat=await lstat(path);if(stat.isSymbolicLink())throw guidanceError(new Error('Recovery lock symlink refused'), 'guid-2204c0ef15898d33');
  const current=JSON.parse(await readFederationFile(dirname(path),path,{maxBytes:1024})) as RecoveryGate;
  if(current.nonce!==gate.nonce||current.pid!==gate.pid||current.vault!==gate.vault)throw guidanceError(new Error('Recovery lock fencing failed'), 'guid-5c758dcf9f6b5e82');
}
/** Publish a complete gate with an atomic hard-link, so a killed recovery never
 * leaves the empty exclusive-create file that the old protocol could not own. */
async function acquireRecoveryGate(vault:string,path:string):Promise<RecoveryGate>{
  const gate:RecoveryGate={version:1,pid:process.pid,nonce:randomUUID(),vault,startedAt:new Date().toISOString()};
  const temporary=join(dirname(path),`.recovery-${gate.nonce}.tmp`);
  try {
    const handle=await open(temporary,'wx',0o600);
    try {await handle.writeFile(JSON.stringify(gate),'utf8');await handle.sync();} finally {await handle.close();}
    await link(temporary,path);
    return gate;
  } catch(e) {
    if(e&&typeof e==='object'&&'code'in e&&e.code==='EEXIST')throw guidanceError(new Error('Recovery gate already exists; automatic stale-gate deletion is unsafe. Require explicit offline forensic recovery'), 'guid-ecb2649b49eed7d1');
    throw e;
  } finally {try{await unlink(temporary);}catch(e){if(!missing(e))throw e;}}
}

/** Configuration is a host file, never a note or MCP argument. Loading is read-only. */
export async function loadEconomyHostConfig(configPath:string,expectedVault:string):Promise<EconomyHostConfig> {
  if(!isAbsolute(configPath)||!isAbsolute(expectedVault))throw guidanceError(new Error('Absolute private config and vault paths required'), 'guid-a6109f2e1dc424ff');
  const actualConfig=await realpath(configPath),root=dirname(actualConfig),vault=await realpath(expectedVault);
  const compiledRoot=dirname(dirname(fileURLToPath(import.meta.url)));
  const moduleRoot=basename(compiledRoot)==='dist'?dirname(compiledRoot):compiledRoot;
  const source=moduleRoot.endsWith(`${sep}dist`)?dirname(moduleRoot):moduleRoot;
  if(inside(vault,actualConfig)||inside(source,actualConfig))throw guidanceError(new Error('Economy config must be private, outside Vault and source'), 'guid-b5d3635a1bb10ce3');
  const raw=JSON.parse(await readFederationFile(root,actualConfig,{maxBytes:32768}));
  if(!raw||raw.version!==1||Object.keys(raw).some(k=>!['version','vaultPath','hostPath','ledgerPath','policy'].includes(k)))throw guidanceError(new Error('Invalid host economy configuration'), 'guid-fb1b25c7414d31b7');
  if(typeof raw.vaultPath!=='string'||typeof raw.hostPath!=='string'||!isAbsolute(raw.vaultPath)||!isAbsolute(raw.hostPath))throw guidanceError(new Error('Invalid vault/host path'), 'guid-231b0a938277f5a3');
  const configuredVault=await realpath(raw.vaultPath),host=await realpath(raw.hostPath);
  if(configuredVault!==vault)throw guidanceError(new Error('Economy config belongs to another vault'), 'guid-ddfb5503c236a2ba');
  if(inside(vault,host)||inside(source,host)||!inside(host,actualConfig))throw guidanceError(new Error('Config and checkpoint require a private host directory outside Vault/source'), 'guid-3b9689fb5daac093');
  const separated = raw.ledgerPath === undefined ? undefined : await validateEconomyStoragePaths(raw);
  const policy=validateEconomyPolicy(raw.policy);
  if(policy.enabled&&policy.treasuryWeeklyBudget===undefined)throw guidanceError(new Error('Enabled host policy requires explicit treasuryWeeklyBudget (pilot: 500)'), 'guid-40f10ea885c6fdc1');
  return {version:1,vaultPath:vault,hostPath:host,...(separated && {ledgerPath:separated.ledgerPath}),policy};
}

/** Conservative OS classification plus a bounded exclusive-create/fsync/rename
 * probe. This checks supported local semantics, not power-loss hardware claims. */
export async function probeEconomyStorage(directory:string):Promise<{path:string;filesystem:string;probe:'exclusive-create-sync-rename'}> {
  const path=await realpath(directory);
  if(/^\\\\|^\/\//.test(path))throw guidanceError(new Error('Network storage cannot host economy'), 'guid-6142a1479af1f5a3');
  let filesystem:string;
  if(process.platform==='win32') {
    const drive=/^([a-z]):\\/i.exec(path)?.[1];
    if(!drive)throw guidanceError(new Error('Unknown Windows volume'), 'guid-9e7750ccca1796cd');
    // Only a validated drive LETTER is inserted; no caller-authored shell text.
    const script=`Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive.toUpperCase()}:'" | Select-Object DriveType,FileSystem | ConvertTo-Json -Compress`;
    const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:10000,maxBuffer:4096});
    const disk=JSON.parse(stdout);
    if(disk.DriveType!==3||!['NTFS','ReFS'].includes(disk.FileSystem))throw guidanceError(new Error('Economy requires a fixed local NTFS/ReFS volume; removable/NAS/unknown volumes refused'), 'guid-64b857a57bb41700');
    filesystem=disk.FileSystem;
  } else {
    const type=Number((await statfs(path)).type);
    const supported=new Map([[0xef53,'ext'],[0x58465342,'xfs'],[0x9123683e,'btrfs']]);
    const name=supported.get(type);
    if(!name)throw guidanceError(new Error('Economy filesystem is not in the verified local allowlist'), 'guid-f521184c2f7d4974');
    filesystem=name;
  }
  const name=`.economy-probe-${randomUUID()}`,from=join(path,name),to=join(path,`${name}.done`);
  let handle;
  try {
    handle=await open(from,'wx',0o600);await handle.writeFile(name);await handle.sync();
    let exclusive=false;
    try { const duplicate=await open(from,'wx',0o600);await duplicate.close(); }
    catch(e){if(e&&typeof e==='object'&&'code'in e&&e.code==='EEXIST')exclusive=true;else throw e;}
    if(!exclusive)throw guidanceError(new Error('Exclusive creation probe failed'), 'guid-d77b2fd6dca3af09');
    await handle.close();handle=undefined;await rename(from,to);
    if(await readFederationFile(path,to,{maxBytes:256})!==name)throw guidanceError(new Error('Atomic rename probe failed'), 'guid-383a12515f2b8b0c');
    return {path,filesystem,probe:'exclusive-create-sync-rename'};
  } finally {
    await handle?.close();
    for(const target of [from,to])try{await unlink(target);}catch(e){if(!missing(e))throw e;}
  }
}

export async function inspectEconomyRecovery(options:EconomyStoragePaths) {
  if (options.ledgerPath === undefined) await assertLegacyEconomyStorage(options);
  const binding = options.ledgerPath === undefined ? undefined : await bindEconomyStorage(options);
  const vault=await realpath(binding?.ledgerPath ?? options.vaultPath),host=await realpath(options.hostPath);
  const lockPath=join(vault,'.mcpvault-economy','writer.lock');
  const lock=await optional(vault,lockPath,1024);
  const checkpoint=await optional(host,join(host,`economy-${economyRevision(vault.toLowerCase())}.checkpoint.json`),2048);
  const names=assertContiguousEconomyJournalNames(await readdir(join(vault,'.mcpvault-economy','journal')));
  return {fingerprint:economyRevision({vault,lock,checkpoint,names,...(binding && {wiki:binding.vaultPath})}),lock:lock?JSON.parse(lock):null,
    checkpoint:checkpoint?JSON.parse(checkpoint):null,journalFiles:names.length,action:'Stop the exact server, inspect, then recover only a confirmed dead writer. Never reset journal/checkpoint.'};
}

/** Runs inside the ledger's serialized commit path.  It deliberately receives
 * the already-replayed state so callers never call ledger.snapshot() recursively. */
export async function validateOperatorAdjudication(state:EconomyState,command:EconomyCommand,fs:FileSystemService):Promise<void> {
  if(command.op!=='resolve'||typeof command.amount!=='number'||command.amount<=0)return;
  const contract=command.contractId?state.contracts[command.contractId]:undefined;
  if(!contract?.submission||contract.submission.basis!==command.basis)throw guidanceError(new Error('Adjudication must identify the exact submitted basis'), 'guid-1441233faac18aff');
  const task=await fs.readNote(`Community/Tasks/${contract.terms.taskId}.md`);
  if(!contract.workBinding||task.revision!==contract.workBinding.revision||task.frontmatter.assignee_account_id!==contract.worker||Number(task.frontmatter.claim_generation)!==contract.workBinding.generation||task.frontmatter.status!=='in_progress')throw guidanceError(new Error('Work claim divergence: reconcile exact claim before payout'), 'guid-7e77ba244896e090');
  for(const artifact of contract.submission.artifacts) {
    const note=await fs.readNote(artifact.path);
    if(note.revision!==artifact.revision||isModerationHidden(note.frontmatter))throw guidanceError(new Error('Artifact changed/hidden; payout held'), 'guid-3bf4d34b6fab629a');
  }
}

export async function recoverEconomyWriter(options:EconomyStoragePaths,approval:{expectedFingerprint:string;reason:string}) {
  if(typeof approval.reason!=='string'||!approval.reason.trim()||approval.reason.length>1000)throw guidanceError(new Error('Recovery reason required'), 'guid-43c69bbc4794e61b');
  if (options.ledgerPath === undefined) await assertLegacyEconomyStorage(options);
  const binding = options.ledgerPath === undefined ? undefined : await bindEconomyStorage(options);
  const vault=await realpath(binding?.ledgerPath ?? options.vaultPath),host=await realpath(options.hostPath);
  const gatePath=join(vault,'.mcpvault-economy','recovery.lock');
  await ensureFederationDirectory(vault,dirname(gatePath));
  const gate=await acquireRecoveryGate(vault,gatePath);
  try {
    const state=await inspectEconomyRecovery(options);
    if(state.fingerprint!==approval.expectedFingerprint)throw guidanceError(new Error('Recovery inspection fingerprint changed'), 'guid-14f2d2a3c0317484');
    const lock=state.lock;
    if(!lock||!Number.isSafeInteger(lock.pid)||lock.pid<=0||lock.vault!==vault||typeof lock.nonce!=='string')throw guidanceError(new Error('Writer PID/identity is invalid; manual forensic recovery required'), 'guid-9b4f7885419fc7b8');
    if(!await deadProcess(lock.pid))throw guidanceError(new Error('Writer PID is live/running; it will not be stopped or unlocked'), 'guid-ff0e84ea3584327e');
    if((await inspectEconomyRecovery(options)).fingerprint!==state.fingerprint)throw guidanceError(new Error('Writer changed during recovery'), 'guid-c63746521df7a0e4');
    // Preserve the exact old lock and approval as host audit evidence. No
    // journal/checkpoint mutation, lock timeout, or PID-reuse override exists.
    const auditName=`economy-recovery-${randomUUID()}.json`;
    await writeFederationFileAtomic(host,join(host,auditName),JSON.stringify({version:1,at:new Date().toISOString(),reason:approval.reason,inspection:state}),{maxBytes:8192});
    const target=join(vault,'.mcpvault-economy','writer.lock');
    // A second recoverer cannot take this gate automatically. Reassert our
    // nonce immediately before the irreversible writer-lock unlink anyway.
    await assertRecoveryGate(gatePath,gate);
    await binding?.assertBinding();
    if((await lstat(target)).isSymbolicLink())throw guidanceError(new Error('Writer lock symlink refused'), 'guid-a8b59a887636dcbe');
    await unlink(target);
    return {recovered:true,audit:auditName,nextAction:'Open ledger to validate checkpoint/replay before serving any financial request'};
  }finally{await releaseRecoveryGate(gatePath,gate);}
}
