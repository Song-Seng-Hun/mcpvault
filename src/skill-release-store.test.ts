import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,link,symlink,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const acl=vi.hoisted(()=>({deny:false}));
// File confinement is real; only OS ACL observations are simulated in this suite.
vi.mock('./windows-private-acl.js',()=>({checkWindowsPrivateAcl:async()=>{if(acl.deny)throw Error('denied');}}));
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const roots:string[]=[];
afterEach(async()=>{acl.deny=false;for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'skill-release-store-'));roots.push(root);
  const hostPath=join(root,'host'),vaultPath=join(root,'vault');
  for(const p of [hostPath,vaultPath,join(hostPath,'blobs'),join(hostPath,'entries')])await mkdir(p,{mode:0o700});
  const m=await import('./skill-release-store.js').catch(()=>({openReviewedSkillStore:undefined}));
  expect(m.openReviewedSkillStore,'reviewed resources require a confined host store').toBeTypeOf('function');
  const body=Buffer.from('Reviewed procedure only.');await writeFile(join(hostPath,'blobs',hash(body)),body,{mode:0o600});
  const entryPath=join(hostPath,'entries',`${hash('test-skill')}.json`);
  const record={version:1,skillId:'test-skill',sourceName:'test-skill',state:'admitted',releaseHash:hash('release'),
    scenarioSetHash:hash('test-plan'),policyRevision:'review-v1',reviewer:'main'};
  await writeFile(entryPath,JSON.stringify(record),{mode:0o600});
  const open=(path=hostPath)=>m.openReviewedSkillStore!({hostPath:path,vaultPath,sourceFingerprint:async()=>hash('source')});
  const store=await open();return {root,hostPath,vaultPath,entryPath,record,body,store,open};
}
test('reads only bounded hash-named blobs and host-provisioned entries; survives reopening',async()=>{
  const f=await fixture();expect(await f.store.readBlob(hash(f.body))).toEqual(f.body);
  const e=await f.store.entry('test-skill');expect(e?.releaseHash).toBe(f.record.releaseHash);f.store.assertFresh(e!);
  expect((await (await f.open()).entry('test-skill'))?.generation).toBe(e?.generation);
  await expect(f.store.readBlob('../secret')).rejects.toThrow('Reviewed skill store unavailable');
  await expect(f.store.entry('../secret')).rejects.toThrow('Reviewed skill store unavailable');
});

test('discovery enumerates a bounded private registration window, not blobs or quarantined source files',async()=>{
  const f=await fixture();
  expect(f.store.candidates,'host-owned candidate discovery must be available').toBeTypeOf('function');
  expect(await f.store.candidates!()).toEqual(['test-skill']);
  await writeFile(f.entryPath,JSON.stringify({...f.record,state:'revoked'}));
  expect(await f.store.candidates!()).toEqual([]);
  for(let i=0;i<15;i++){
    const skillId=`skill-${i}`;
    await writeFile(join(f.hostPath,'entries',`${hash(skillId)}.json`),JSON.stringify({...f.record,skillId,sourceName:skillId}),{mode:0o600});
  }
  const ids=await f.store.candidates!();expect(ids.length).toBeLessThanOrEqual(8);
  expect(ids.every(id=>/^skill-\d+$/.test(id))).toBe(true);
});

test('pageable discovery scans only one bounded registration window and reaches later releases',async()=>{
  const f=await fixture();
  for(let i=0;i<15;i++){
    const skillId=`skill-${i}`;
    await writeFile(join(f.hostPath,'entries',`${hash(skillId)}.json`),JSON.stringify({...f.record,skillId,sourceName:skillId}),{mode:0o600});
  }
  expect(f.store.candidatesPage,'host-owned pageable discovery must be available').toBeTypeOf('function');
  const first=await f.store.candidatesPage!(undefined,8);
  expect(first.candidates.length).toBeLessThanOrEqual(8);
  expect(first.nextCursor).toBeTypeOf('string');
  const second=await f.store.candidatesPage!(first.nextCursor,8);
  expect(second.candidates.length).toBeLessThanOrEqual(8);
  expect(new Set([...first.candidates,...second.candidates]).size).toBeGreaterThan(8);
  expect(second.registryGeneration).toBe(first.registryGeneration);
});

test('candidate discovery rejects misnamed, corrupt or linked registry data without returning its contents',async()=>{
  for(const kind of ['misnamed','corrupt','linked']){
    const f=await fixture();expect(f.store.candidates).toBeTypeOf('function');
    if(kind==='misnamed')await writeFile(f.entryPath,JSON.stringify({...f.record,skillId:'private-other-name'}));
    else if(kind==='corrupt')await writeFile(f.entryPath,'{private invalid data');
    else{await rm(f.entryPath);await writeFile(join(f.root,'outside-entry'),JSON.stringify(f.record));await link(join(f.root,'outside-entry'),f.entryPath);}
    await expect(f.store.candidates!()).rejects.toThrow('Reviewed skill store unavailable');
  }
});
test('registry revocation or deletion invalidates an issued lease and never recreates state',async()=>{
  const f=await fixture(),e=await f.store.entry('test-skill');
  await writeFile(f.entryPath,JSON.stringify({...f.record,state:'revoked'}));
  expect(()=>f.store.assertFresh(e!)).toThrow();expect(await f.store.entry('test-skill')).toBeUndefined();
  await rm(f.entryPath);expect(await f.store.entry('test-skill')).toBeUndefined();
  expect(()=>f.store.assertFresh(e!)).toThrow();
});

test('final delivery fence rechecks all named blobs after asynchronous permission validation',async()=>{
  const f=await fixture(),entry=await f.store.entry('test-skill'),blobHash=hash(f.body),path=join(f.hostPath,'blobs',blobHash);
  expect(await f.store.readBlob(blobHash)).toEqual(f.body);
  expect(()=>f.store.assertFresh(entry!,[blobHash])).not.toThrow();
  await writeFile(path,'changed during final permission refresh');
  expect(()=>f.store.assertFresh(entry!,[blobHash])).toThrow();
  await rm(path);
  expect(()=>f.store.assertFresh(entry!,[blobHash])).toThrow();
});

test('final blob fence rejects traversal, excess fanout and linked content',async()=>{
  const f=await fixture(),entry=await f.store.entry('test-skill'),blobHash=hash(f.body),path=join(f.hostPath,'blobs',blobHash);
  expect(()=>f.store.assertFresh(entry!,['../outside'])).toThrow();
  expect(()=>f.store.assertFresh(entry!,Array.from({length:34},(_,i)=>hash(String(i))))).toThrow();
  await rm(path);await writeFile(join(f.root,'outside'),f.body);await link(join(f.root,'outside'),path);
  expect(()=>f.store.assertFresh(entry!,[blobHash])).toThrow();
});
test('corrupt registry, hash mismatch, hardlink and oversized files fail closed without resetting bytes',async()=>{
  const f=await fixture();await writeFile(f.entryPath,'{');await expect(f.store.entry('test-skill')).rejects.toThrow();
  expect(await readFile(f.entryPath,'utf8')).toBe('{');
  const p=join(f.hostPath,'blobs',hash(f.body));await writeFile(p,'changed');await expect(f.store.readBlob(hash(f.body))).rejects.toThrow();
  await rm(p);await writeFile(join(f.root,'outside'),f.body);await link(join(f.root,'outside'),p);await expect(f.store.readBlob(hash(f.body))).rejects.toThrow();
  await rm(p);await writeFile(p,Buffer.alloc(1048577));await expect(f.store.readBlob(hash(f.body))).rejects.toThrow();
});
test('refuses Vault/source roots and junction aliases, including a replaced storage directory',async()=>{
  const f=await fixture();await expect(f.open(f.vaultPath)).rejects.toThrow();await expect(f.open(process.cwd())).rejects.toThrow();
  const alias=join(f.root,'alias');await symlink(f.hostPath,alias,process.platform==='win32'?'junction':'dir');await expect(f.open(alias)).rejects.toThrow();
  const e=await f.store.entry('test-skill');await rm(join(f.hostPath,'entries'),{recursive:true});
  await mkdir(join(f.root,'entries'));await symlink(join(f.root,'entries'),join(f.hostPath,'entries'),process.platform==='win32'?'junction':'dir');
  expect(()=>f.store.assertFresh(e!)).toThrow();await expect(f.store.entry('test-skill')).rejects.toThrow();
  await expect(f.store.candidates!()).rejects.toThrow();
});
test.skipIf(process.platform!=='win32')('revalidates private ACL before reads; a prior check is not permanent permission',async()=>{
  const f=await fixture();acl.deny=true;await expect(f.store.readBlob(hash(f.body))).rejects.toThrow();await expect(f.store.entry('test-skill')).rejects.toThrow();await expect(f.store.candidates!()).rejects.toThrow();
});
