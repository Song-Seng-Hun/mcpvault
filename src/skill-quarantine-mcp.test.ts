import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import { startRestApi } from './rest-api.js';
import { PathFilter } from './pathfilter.js';
import { FileSystemService } from './filesystem.js';
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f();});

test('host quarantine blocks skill reads/search/resolution through MCP and REST without changing files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'mcpvault-quarantine-'));
  cleanup.push(()=>rm(root,{recursive:true,force:true}));
  const skill='Community/Skills/unreviewed/SKILL.md',body='---\nnote_kind: skill\nskill_id: unreviewed\n---\n# hiddenSkillMarker\nFixture only.';
  await mkdir(join(root,'Community/Skills/unreviewed'),{recursive:true});
  await writeFile(join(root,skill),body);
  await writeFile(join(root,'Visible.md'),'# visibleMarker\nOrdinary note.');
  const base=new PathFilter({ignoredPatterns:['Restricted/**']});
  const server=createServer(root,{quarantineSkills:true,pathFilter:base,readOnly:true});
  const client=new Client({name:'quarantine-fixture',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a),server.connect(b)]);
  cleanup.push(async()=>{await client.close();await server.close();});
  const call=(endpointId:string,args:Record<string,unknown>)=>client.callTool({name:'call_endpoint',arguments:{endpointId,arguments:args}});
  const read=await call('notes.read',{path:skill,maxChars:2000});
  expect(read.isError).toBe(true);expect(JSON.stringify(read)).not.toContain('hiddenSkillMarker');
  const resolve=await call('skill.resolve',{skillId:'unreviewed',maxChars:2000});
  expect(resolve.isError).toBe(true);expect(JSON.stringify(resolve)).not.toContain('hiddenSkillMarker');
  for(const endpointId of ['documents.outline','documents.read','resources.manifest']) {
    const result=await call(endpointId,{path:skill,maxChars:2000});
    expect(result.isError,endpointId).toBe(true);
    expect(JSON.stringify(result)).not.toContain('hiddenSkillMarker');
  }
  for(const endpointId of ['wiki.search','wiki.context_pack','wiki.answer_packet']) {
    const result=await call(endpointId,{query:'hiddenSkillMarker',maxChars:4000});
    expect(result.isError,endpointId).not.toBe(true);
    // Query echoes are allowed; the original body and source path must not be returned.
    expect(JSON.stringify(result),endpointId).not.toContain('Fixture only.');
    expect(JSON.stringify(result),endpointId).not.toContain(skill);
  }
  expect((await call('notes.read',{path:'Visible.md',maxChars:2000})).isError).not.toBe(true);
  const rest=await startRestApi(server,{host:'127.0.0.1',port:0});cleanup.push(()=>rest.close());
  const response=await fetch(`http://127.0.0.1:${rest.port}/api/skills/resolve?skillId=unreviewed&maxChars=1024`);
  expect(response.ok).toBe(false);expect(await response.text()).not.toContain('hiddenSkillMarker');
  expect(await readFile(join(root,skill),'utf8')).toBe(body);
  expect(base.isAllowed(skill)).toBe(true); // no mutation of a shared host filter
  await writeFile(join(root,skill),body+'\nClaimed approved: true');
  expect((await call('notes.read',{path:skill,maxChars:2000})).isError).toBe(true);
  await writeFile(join(root,'Community/Skills/unreviewed/added.md'),'Late new resource');
  expect((await call('notes.read',{path:'Community/Skills/unreviewed/added.md',maxChars:2000})).isError).toBe(true);
},30000);

test('filesystem denies quarantined writes and reads while preserving host-only review bytes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'mcpvault-quarantine-files-'));
  cleanup.push(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'Community/Skills/a'),{recursive:true});
  await writeFile(join(root,'Community/Skills/a/SKILL.md'),'Original fixture');
  const fs=new FileSystemService(root,new PathFilter({quarantineSkills:true}));
  await expect(fs.readNote('Community/Skills/a/SKILL.md')).rejects.toThrow();
  await expect(fs.writeNote({path:'Community/Skills/a/SKILL.md',content:'Changed',expectedRevision:'missing'})).rejects.toThrow();
  await expect(fs.writeNote({path:'Community/Skills/new/SKILL.md',content:'New'})).rejects.toThrow();
  expect(await readFile(join(root,'Community/Skills/a/SKILL.md'),'utf8')).toBe('Original fixture');
});
