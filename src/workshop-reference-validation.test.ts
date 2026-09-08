import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ReferenceService } from './references.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { validateWorkshopReferences } from './workshop-reference-validation.js';
const roots:string[]=[];
afterEach(async()=>{for(const p of roots.splice(0))await rm(p,{recursive:true,force:true});});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'workshop-refs-'));roots.push(root);const fs=new FileSystemService(root);return {fs,refs:new ReferenceService(fs,new ScopeAccessPolicy())};}
test('typed nested source locators return exact deduplicated guards',async()=>{
 const {fs,refs}=await fixture();await fs.writeNote({path:'Evidence.md',content:'# Evidence'});const note=await fs.readNote('Evidence.md');
 const guards=await validateWorkshopReferences(fs,refs,{outputs:[{evidence:{path:'Evidence.md',revision:note.revision},references:['Evidence.md']}]},'Community/Workshops/demo.md');
 expect(guards).toEqual([{path:'Evidence.md',expectedRevision:note.revision}]);
 await expect(validateWorkshopReferences(fs,refs,{evidence:{path:'Evidence.md',revision:'a'.repeat(64)}},'Community/Workshops/demo.md')).rejects.toThrow(/unavailable|changed/);
});
test('hidden notes and private typed paths cannot enter a public structured payload',async()=>{
 const {fs,refs}=await fixture();await fs.writeNote({path:'Hidden.md',content:'# Hidden',frontmatter:{moderation_status:'hidden'}});
 for(const value of [{evidence:{path:'Hidden.md'}},{outputs:[{references:['_scopes/agents/secret/Private.md']}]},{evidence:{path:'_scopes/agents/secret/Private.md',revision:'a'.repeat(64)}},{evidence:'[[Hidden]]'}]) {
  await expect(validateWorkshopReferences(fs,refs,value,'Community/Workshops/demo.md')).rejects.toThrow('Workshop reference unavailable or changed');
 }
});
test('malformed references and excessive structure fail closed',async()=>{
 const {fs,refs}=await fixture();
 await expect(validateWorkshopReferences(fs,refs,{references:[true]},'Community/Workshops/demo.md')).rejects.toThrow();
 const cyclic:any={};cyclic.child=cyclic;
 await expect(validateWorkshopReferences(fs,refs,cyclic,'Community/Workshops/demo.md')).rejects.toThrow();
});
