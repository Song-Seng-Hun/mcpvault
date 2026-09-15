import {afterEach,expect,test} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const roots:string[]=[];
const inspectors:Array<{close():void}>=[];
afterEach(async()=>{for(const inspector of inspectors.splice(0))inspector.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
  const vault=await mkdtemp(join(tmpdir(),'skill-source-worker-'));roots.push(vault);
  const bundle=join(vault,'Community','Skills','test-skill');await mkdir(bundle,{recursive:true});
  await writeFile(join(bundle,'SKILL.md'),'---\nname: test-skill\n---\n# Keep conditions\n');
  const module=await import('./skill-release-source.js').catch(()=>({createSkillSourceInspector:undefined}));
  expect(module.createSkillSourceInspector,'NAS scans must run in a bounded owned child, not the server event loop').toBeTypeOf('function');
  const inspector=module.createSkillSourceInspector!(vault);inspectors.push(inspector);return {vault,bundle,inspector};
}
test('real child inspects source hashes/visibility without returning or executing bundled text',async()=>{
  const f=await fixture();await writeFile(join(f.bundle,'script.js'),"throw Error('NEVER EXECUTE BUNDLE')");
  const result=await f.inspector.inspect('test-skill');
  expect(result?.inventory.complete).toBe(true);expect(result?.visible).toBe(true);
  expect(result?.inventory.files.map(x=>x.path)).toEqual(['SKILL.md','script.js']);
  expect(JSON.stringify(result)).not.toContain('NEVER EXECUTE');
});
test('hidden and invalid Markdown headers prevent release; changed source gets a new fingerprint',async()=>{
  const f=await fixture(),before=await f.inspector.inspect('test-skill');
  await writeFile(join(f.bundle,'SKILL.md'),'---\nmoderation_status: hidden\n---\n# hidden');
  const hidden=await f.inspector.inspect('test-skill');expect(hidden?.visible).toBe(false);expect(hidden?.inventory.fingerprint).not.toBe(before?.inventory.fingerprint);
  await writeFile(join(f.bundle,'SKILL.md'),'---javascript\n({authorized:true})\n---\n# inert');
  expect((await f.inspector.inspect('test-skill'))?.visible).toBe(false);
});
test('rejects path tricks, missing roots, cancellation and deadlines without broad process termination',async()=>{
  const f=await fixture();expect(await f.inspector.inspect('../escape')).toBeNull();expect(await f.inspector.inspect('absent')).toBeNull();
  const controller=new AbortController();controller.abort();expect(await f.inspector.inspect('test-skill',{signal:controller.signal})).toBeNull();
  expect(await f.inspector.inspect('test-skill',{timeoutMs:1})).toBeNull();
  expect((await f.inspector.inspect('test-skill'))?.visible).toBe(true);
});
