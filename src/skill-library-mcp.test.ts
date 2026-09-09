import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';
import { GlobalSyncHub } from './global-sync.js';
import { projectSkill, previewSkills, applySkills } from './skill-library.js';

test('imported Community skill is searchable and readable through existing bounded MCP routes', async () => {
  const root=await mkdtemp(join(tmpdir(),'mcpvault-skill-mcp-'));
  const fs=new FileSystemService(root);
  const server=createServer(root,{version:'1.0.0',readOnly:true});
  const [a,b]=InMemoryTransport.createLinkedPair();
  const client=new Client({name:'skill-test',version:'1.0.0'});
  try {
    const notes=projectSkill({id:'test-reference',origin:'test',version:'1',license:'MIT',licenseText:'MIT License\nPermission is hereby granted, free of charge',description:'A bounded procedural reference',files:[{path:'SKILL.md',text:'# artifactFluxMarker\n\nOnly with authorization.\n'+'Example '.repeat(600)}],unavailable:[]});
    await applySkills(fs,notes,(await previewSkills(fs,notes)).fingerprint);
    await Promise.all([client.connect(a),server.connect(b)]);
    const call=async(endpointId:string,args:Record<string,unknown>)=>{
      const response=await client.callTool({name:'call_endpoint',arguments:{endpointId,arguments:args}});
      expect(response.isError).not.toBe(true);
      return JSON.parse((response.content[0] as {text:string}).text);
    };
    const found=await call('wiki.search',{query:'artifactFluxMarker',limit:3,maxChars:2000});
    expect(JSON.stringify(found)).toContain('Community/Skills/test-reference/SKILL.md');
    expect(found.find((r:any)=>r.p===notes[0].path)?.t).toBe('test-reference');
    expect(JSON.stringify(found).length).toBeLessThanOrEqual(2000);
    const read=await call('notes.read',{path:notes[0].path,maxChars:1000});
    expect(JSON.stringify(read)).toContain('not execution permission');
    expect(read.revision).toMatch(/^[a-f0-9]{64}$/);
    const context=await call('wiki.context_pack',{query:'artifactFluxMarker',path:notes[0].path,maxChars:4000});
    expect(JSON.stringify(context)).toContain(notes[0].path);
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(4000);
    expect(context.sources[0].role).toBe('procedural_reference');
    const discovered=await call('wiki.context_pack',{query:'artifactFluxMarker',maxChars:4000});
    expect(discovered.sources.some((s:any)=>s.path===notes[0].path && s.role==='procedural_reference')).toBe(true);
    expect(discovered.gaps).toContain('no_verified_immutable_evidence');
    const template=await call('wiki.note_template',{noteKind:'skill'});
    expect(JSON.stringify(template)).toContain('skill');
    const policy=await call('wiki.policy',{topic:'retrieval',maxChars:12000});
    expect(JSON.stringify(policy)).toContain('Community/Skills');
    const hub=new GlobalSyncHub(join(root,'hub-test'),{hubId:'skill-test'});
    await expect(hub.submitProposal({documentId:notes[0].path,content:notes[0].content,author:'test',reason:'scope check',origin:'test'})).rejects.toThrow(/Global document|private or service/);
    const mutation=await client.callTool({name:'call_endpoint',arguments:{endpointId:'notes.write',arguments:{path:notes[0].path,content:'Overwrite'}}});
    expect(mutation.isError).toBe(true);
  } finally { await client.close();await server.close();await rm(root,{recursive:true,force:true}); }
},30000);
