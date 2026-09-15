import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const counters=vi.hoisted(()=>({realpaths:0}));
vi.mock('node:fs',async original=>{
  const fs=await original<typeof import('node:fs')>();
  return {...fs,realpathSync:(...args:Parameters<typeof fs.realpathSync>)=>{counters.realpaths++;return (fs.realpathSync as any)(...args);}};
});
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'skill-inventory-bindings-'));roots.push(root);
  const bundle=join(root,'bundle');await mkdir(join(bundle,'references'),{recursive:true});
  const module=await import('./skill-review-inventory.js');return {root,bundle,...module};
}
test('canonical resolution is per checked object, not repeated for every ancestor of every object',async()=>{
  const f=await fixture();for(let i=0;i<20;i++)await writeFile(join(f.bundle,'references',`${i}.md`),'Keep conditions.');
  counters.realpaths=0;const r=await f.snapshotSkillBundle(f.bundle);
  expect(r.complete).toBe(true);expect(r.files).toHaveLength(20);
  // Two passes, before/after per file, checked directory plus initial/final root.
  // Ancestor lstat checks remain mandatory; only redundant canonical resolution is removed.
  expect(counters.realpaths).toBeLessThanOrEqual(90);
});
test('root and nested junctions remain rejected without caching ancestor trust',async()=>{
  const f=await fixture();await writeFile(join(f.bundle,'SKILL.md'),'Safe source');
  const alias=join(f.root,'alias');await symlink(f.bundle,alias,process.platform==='win32'?'junction':'dir');
  expect(await f.snapshotSkillBundle(alias)).toMatchObject({complete:false,reasons:['linked_path']});
  const external=join(f.root,'external');await mkdir(external);await writeFile(join(external,'secret.md'),'Synthetic outside file');
  await symlink(external,join(f.bundle,'references','alias'),process.platform==='win32'?'junction':'dir');
  const r=await f.snapshotSkillBundle(f.bundle);expect(r.complete).toBe(false);expect(r.reasons).toContain('linked_path');
});
