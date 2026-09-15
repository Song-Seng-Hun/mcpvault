import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'skill-review-inventory-'));roots.push(root);
  const bundle=join(root,'alpha');await mkdir(bundle);
  await writeFile(join(bundle,'SKILL.md'),'# Useful procedure\r\n조건 유지. 😀\r\n');
  const mod=await import('./skill-review-inventory.js').catch(()=>({snapshotSkillBundle:undefined,listSkillReviewTargets:undefined,compareSkillInventories:undefined}));
  expect(mod.snapshotSkillBundle,'host-only byte inventory is implemented').toBeTypeOf('function');
  return {root,bundle,...mod};
}
test('hashes all source members, including hidden, binary and executable data, without executing them',async()=>{
  const f=await fixture();await mkdir(join(f.bundle,'.config'));
  const script="throw Error('MUST NEVER RUN')";
  await writeFile(join(f.bundle,'install.js'),script);await writeFile(join(f.bundle,'.config','rules.json'),'{}');
  await writeFile(join(f.bundle,'binary.bin'),Buffer.from([0,255,254]));
  const r=await f.snapshotSkillBundle!(f.bundle);
  expect(r.complete).toBe(true);expect(r.files.map(x=>x.path)).toEqual(['.config/rules.json','SKILL.md','binary.bin','install.js']);
  expect(r.files.find(x=>x.path==='install.js')?.sha256).toBe(createHash('sha256').update(script).digest('hex'));
  expect(r.executionAuthorized).toBe(false);expect(JSON.stringify(r)).not.toContain('MUST NEVER RUN');
  expect((await f.snapshotSkillBundle!(f.bundle)).fingerprint).toBe(r.fingerprint);
});
test('changed bytes, added references, removed files and unavailable roots never reuse a complete basis',async()=>{
  const f=await fixture(),before=await f.snapshotSkillBundle!(f.bundle);
  await writeFile(join(f.bundle,'reference.md'),'New condition');
  const added=await f.snapshotSkillBundle!(f.bundle);expect(added.fingerprint).not.toBe(before.fingerprint);
  expect(f.compareSkillInventories!(before,added)).toMatchObject({state:'changed',added:['reference.md'],removed:[],changed:[]});
  await writeFile(join(f.bundle,'SKILL.md'),'# New procedure');
  const changed=await f.snapshotSkillBundle!(f.bundle);
  expect(f.compareSkillInventories!(added,changed)).toMatchObject({state:'changed',changed:['SKILL.md']});
  await rm(join(f.bundle,'reference.md'));
  expect(f.compareSkillInventories!(changed,await f.snapshotSkillBundle!(f.bundle))).toMatchObject({state:'changed',removed:['reference.md']});
  const unavailable=await f.snapshotSkillBundle!(join(f.root,'missing'));
  expect(unavailable).toMatchObject({complete:false,fingerprint:null});
  expect(f.compareSkillInventories!(before,unavailable)).toMatchObject({state:'unverified',removed:[]});
});
test('resource limits record incomplete coverage and never give a reusable fingerprint',async()=>{
  const f=await fixture();await writeFile(join(f.bundle,'more.md'),'More');
  for(const options of [{maxFiles:1},{maxTotalBytes:2},{maxDepth:0}]){
    if(options.maxDepth===0){await mkdir(join(f.bundle,'nested'));await writeFile(join(f.bundle,'nested','ref.md'),'Ref');}
    const r=await f.snapshotSkillBundle!(f.bundle,options);
    expect(r.complete).toBe(false);expect(r.fingerprint).toBeNull();expect(r.reasons.length).toBeGreaterThan(0);
  }
  await expect(f.snapshotSkillBundle!(f.bundle,{maxFiles:Infinity})).rejects.toThrow(/limit/i);
});
test('hard-linked files remain review gaps instead of becoming safe byte snapshots',async()=>{
  const f=await fixture();await link(join(f.bundle,'SKILL.md'),join(f.bundle,'alias.md'));
  const r=await f.snapshotSkillBundle!(f.bundle);
  expect(r).toMatchObject({complete:false,fingerprint:null});expect(r.reasons).toContain('linked_file');
});
test('library inventory keeps noncanonical skill names for review rather than silently dropping them',async()=>{
  const f=await fixture();await mkdir(join(f.root,'UPPER'));await mkdir(join(f.root,'.hidden'));
  const r=await f.listSkillReviewTargets!(f.root);
  expect(r.complete).toBe(true);expect(r.targets.map(x=>x.name)).toEqual(['.hidden','UPPER','alpha']);
  expect(r.targets.find(x=>x.name==='UPPER')).toMatchObject({canonicalSkillId:null,requiresReview:true});
  expect(r.targets.find(x=>x.name==='alpha')).toMatchObject({canonicalSkillId:'alpha',requiresReview:false});
  expect((await f.listSkillReviewTargets!(join(f.root,'absent')))).toMatchObject({complete:false,fingerprint:null});
});
