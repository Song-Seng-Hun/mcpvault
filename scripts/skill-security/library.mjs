// Host-owned sequential orchestration. Targets are read-only data, never imports.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { auditSkillDirectory } from './audit.mjs';
import { hash } from './contract.mjs';
const ownFile=fileURLToPath(import.meta.url);
function unlinked(full) {
  for(let p=full;;p=path.dirname(p)) {
    if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('LINK_REJECTED');
    if(p===path.dirname(p))break;
  }
}
function inventory(root) {
  unlinked(root);
  const entries=[],handle=fs.opendirSync(root);let count=0;
  try { for(let ent;(ent=handle.readSync());) {
    if(++count>10000)throw Error('LIBRARY_ENUMERATION_LIMIT');
    // Links get their own incomplete scan; never follow them during discovery.
    if(ent.isDirectory()||ent.isSymbolicLink())entries.push(ent.name);
  }} finally {handle.closeSync();}
  return entries.sort();
}
export async function scanLibrary(root,output,options,onProgress=()=>{}) {
  if(!path.isAbsolute(root)||!path.isAbsolute(output))throw Error('ABSOLUTE_PATH_REQUIRED');
  root=path.resolve(root);output=path.resolve(output);
  const relative=path.relative(root,output);
  if(!relative||(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)))throw Error('OUTPUT_INSIDE_TARGET');
  unlinked(output);
  const names=inventory(root),runnerHash=hash(fs.readFileSync(ownFile));
  fs.mkdirSync(output);fs.mkdirSync(path.join(output,'receipts'));
  const put=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2),{flag:'wx'});
  put('inventory.json',{root,startedAt:new Date().toISOString(),runnerHash,
    targets:names.map(name=>({name,id:hash(path.join(root,name))}))});
  const statusCounts={},rules={},summary={scanned:0,planned:names.length,statusCounts,
    enumerationStable:false,engineStable:true,runnerHash,executionAuthorized:false,targetsModified:false};
  let basis,stopReason;
  for(const name of names) {
    if(os.freemem()<2.3*1024**3){stopReason='MEMORY_GUARD';break;}
    const target=path.join(root,name),id=hash(target);
    const report=await auditSkillDirectory(target,options);
    put(`receipts/${id}.json`,report);
    summary.scanned++;statusCounts[report.status]=(statusCounts[report.status]??0)+1;
    for(const rule of new Set(report.findings.map(f=>f.rule)))rules[rule]=(rules[rule]??0)+1;
    const current=[report.engineHash,report.rulesHash??null,report.rulesMode];
    if(!basis&&report.rulesHash)basis=current;
    if(basis&&(report.engineHash!==basis[0] || report.rulesHash&&JSON.stringify(current)!==JSON.stringify(basis))) {summary.engineStable=false;stopReason='BASIS_CHANGED';}
    if(hash(fs.readFileSync(ownFile))!==runnerHash){summary.engineStable=false;stopReason='RUNNER_CHANGED';}
    onProgress({scanned:summary.scanned,planned:names.length,statusCounts:{...statusCounts}});
    if(stopReason)break;
    if(report.status==='ERROR'&&!report.rulesHash){stopReason='ENGINE_OR_RULES_ERROR';break;}
  }
  try {summary.enumerationStable=JSON.stringify(inventory(root))===JSON.stringify(names);}
  catch {stopReason??='LIBRARY_UNAVAILABLE';}
  if(hash(fs.readFileSync(ownFile))!==runnerHash){summary.engineStable=false;stopReason='RUNNER_CHANGED';}
  Object.assign(summary,{basis,rules,stopReason:stopReason??null,finishedAt:new Date().toISOString(),
    runCompleted:summary.scanned===names.length&&summary.enumerationStable&&summary.engineStable&&!stopReason,
    allSkillsSafe:false,snapshotScope:'per-bundle; not an atomic whole-library snapshot'});
  put('summary.json',summary);return summary;
}
if(process.argv[1]&&path.resolve(process.argv[1])===ownFile) {
  const [root,output,rulesPath,expectedRulesHash,...extra]=process.argv.slice(2);
  try {
    if(extra.length||!rulesPath||!/^[a-f0-9]{64}$/.test(expectedRulesHash??''))throw Error('ARGUMENTS');
    const report=await scanLibrary(root,output,{rulesPath,expectedRulesHash},progress=>{
      if(progress.scanned%25===0||progress.scanned===progress.planned)console.log(JSON.stringify(progress));
    });
    console.log(JSON.stringify(report));process.exitCode=report.runCompleted?0:2;
  } catch {console.error('LIBRARY_SCAN_STOPPED; retained receipts are partial; no clean-library claim');process.exitCode=3;}
}
