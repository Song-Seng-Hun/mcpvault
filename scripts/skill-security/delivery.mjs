// Host deployment utility: only the two explicitly authorized skills are in scope.
// No source imports from NAS; snapshots are data. No automatic rollback or deletion.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from './contract.mjs';
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vault = '\\\\172.30.1.24\\MCPVault\\Community\\Skills';
const ids = ['skill-security-auditor', 'prompt-injection-defense'];
const codeFiles = ['contract.mjs','decode.mjs','signals.mjs','detect.mjs','bundle.mjs','references.mjs','scanner.mjs','worker.mjs','evolve_rules.mjs','audit.mjs'];
const pinnedRules = 'e3768de982df1a576274c3831ade5b4402e3003bd4a5a1a3a20f9976d64f6f47';
function safe(root, relative = '') {
  if (relative && (path.isAbsolute(relative) || relative.split(/[\\/]/).some(x => !x || x === '..' || x === '.'))) throw Error('PATH_REJECTED');
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw Error('PATH_REJECTED');
  for (let p = target; ; p = path.dirname(p)) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw Error('LINK_REJECTED');
    if (p === path.dirname(p)) break;
  }
  return target;
}
function tree(root, rel = '', result = []) {
  for (const ent of fs.readdirSync(safe(root, rel), { withFileTypes:true })) {
    const next = rel ? `${rel}/${ent.name}` : ent.name, full = safe(root, next);
    if (ent.isDirectory()) tree(root, next, result);
    else if (ent.isFile()) {
      const stat=fs.lstatSync(full);
      if (stat.size > 2097152 || result.length >= 100) throw Error('SNAPSHOT_LIMIT');
      result.push({ path:next, sha256:hash(fs.readFileSync(full)) });
    } else throw Error('SPECIAL_FILE_REJECTED');
  }
  return result.sort((a,b)=>a.path.localeCompare(b.path));
}
function putNew(target, bytes) {
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.writeFileSync(target, bytes, {flag:'wx'});
  if (hash(fs.readFileSync(target)) !== hash(bytes)) throw Error('COPY_VERIFICATION_FAILED');
}
export function prepare(run) {
  safe(path.dirname(run),path.basename(run)); fs.mkdirSync(run);
  const baseline = {}, changes = [];
  for (const id of ids) {
    const root=safe(vault,id); baseline[id]=tree(root);
    for (const item of baseline[id]) putNew(safe(run,`backup/${id}/${item.path}`), fs.readFileSync(safe(root,item.path)));
    if (JSON.stringify(tree(root)) !== JSON.stringify(baseline[id])) throw Error('SOURCE_CHANGED');
    for (const item of tree(safe(repository,`skills/${id}`))) {
      const bytes=fs.readFileSync(safe(repository,`skills/${id}/${item.path}`));
      putNew(safe(run,`next/${id}/${item.path}`),bytes);
      changes.push({id,path:item.path,before:baseline[id].find(b=>b.path===item.path)?.sha256??null,after:hash(bytes)});
    }
  }
  for (const file of codeFiles) {
    const bytes=fs.readFileSync(safe(repository,`scripts/skill-security/${file}`));
    putNew(safe(run,`host/${file}`),bytes);
    putNew(safe(run,`next/skill-security-auditor/scripts/${file}`),bytes);
    changes.push({id:ids[0],path:`scripts/${file}`,before:baseline[ids[0]].find(b=>b.path===`scripts/${file}`)?.sha256??null,after:hash(bytes)});
  }
  const rules=fs.readFileSync(safe(run,'backup/skill-security-auditor/scripts/rules.json'));
  if (hash(rules)!==pinnedRules) throw Error('RETAINED_RULES_CHANGED_REVIEW_REQUIRED');
  putNew(safe(run,'host/rules.json'),rules);
  // Supporting code first; audit entrypoint and manuals last. Not a multi-file transaction.
  changes.sort((a,b)=>Number(/(?:SKILL\.md|scripts\/audit\.mjs)$/.test(a.path))-Number(/(?:SKILL\.md|scripts\/audit\.mjs)$/.test(b.path)));
  const manifest={version:1,baseline,changes,host:tree(safe(run,'host'))};
  putNew(safe(run,'manifest.json'),JSON.stringify(manifest,null,2));
  return {prepared:true,run,files:changes.length,manifestHash:hash(JSON.stringify(manifest))};
}
export function apply(run, expectedManifestHash, verifyOnly=false) {
  const manifest=JSON.parse(fs.readFileSync(safe(run,'manifest.json'),'utf8'));
  if (manifest.version!==1 || hash(JSON.stringify(manifest))!==expectedManifestHash) throw Error('MANIFEST_CHANGED');
  if (JSON.stringify(tree(safe(run,'host')))!==JSON.stringify(manifest.host)) throw Error('HOST_CHANGED');
  for (const id of ids) {
    const allowed=new Map(manifest.baseline[id].map(x=>[x.path,[x.sha256]]));
    for (const c of manifest.changes.filter(c=>c.id===id)) allowed.set(c.path,[c.before,c.after]);
    const actual=tree(safe(vault,id)), paths=new Set(actual.map(x=>x.path));
    for (const entry of actual) if (!allowed.get(entry.path)?.includes(entry.sha256)) throw Error('LIVE_USER_CHANGE');
    for (const original of manifest.baseline[id]) if (!paths.has(original.path)) throw Error('LIVE_FILE_REMOVED');
  }
  let changed=0;
  for (const c of manifest.changes) {
    if (!ids.includes(c.id)) throw Error('TARGET_REJECTED');
    const root=safe(vault,c.id), target=safe(root,c.path), next=safe(run,`next/${c.id}/${c.path}`);
    const actual=fs.existsSync(target)?hash(fs.readFileSync(target)):null;
    if (actual===c.after) continue;
    if (verifyOnly || actual!==c.before) throw Error('REVISION_CHANGED');
    const bytes=fs.readFileSync(next);
    if (hash(bytes)!==c.after) throw Error('STAGED_CHANGE');
    if (c.before!==null && hash(fs.readFileSync(safe(run,`backup/${c.id}/${c.path}`)))!==c.before) throw Error('BACKUP_CHANGED');
    fs.mkdirSync(path.dirname(target),{recursive:true}); safe(root,c.path);
    const temporary=target+'.mcpvault-security-next';
    let created=false;
    try {
      fs.writeFileSync(temporary,bytes,{flag:'wx'}); created=true;
      if ((fs.existsSync(target)?hash(fs.readFileSync(target)):null)!==c.before) throw Error('REVISION_CHANGED');
      fs.renameSync(temporary,target); created=false;
    } finally { if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    if (hash(fs.readFileSync(target))!==c.after) throw Error('REREAD_FAILED');
    changed++;
  }
  return {verified:true,changed,files:manifest.changes.length,run,backupRetained:true};
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [mode,runName,stamp]=process.argv.slice(2);
    if (!/^[a-z0-9-]{1,64}$/.test(runName||'') || !['prepare','apply','verify'].includes(mode)) throw Error('ARGUMENTS_REJECTED');
    const run=safe(repository,`.mcpvault/skill-security-${runName}`);
    console.log(JSON.stringify(mode==='prepare'?prepare(run):apply(run,stamp,mode==='verify')));
  } catch { console.error('SKILL_SECURITY_DELIVERY_STOPPED; preserve snapshot and inspect current revisions'); process.exitCode=1; }
}
