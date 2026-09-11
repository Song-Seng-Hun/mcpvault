import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileSystemService} from './filesystem.js';
import {ContinuityService} from './continuity.js';
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});

test('resume distinguishes saved fields from explicitly checked pins without rewriting guards',async()=>{
 const root=await mkdtemp(join(tmpdir(),'continuity-pins-'));roots.push(root);
 const fs=new FileSystemService(root), service=new ContinuityService(fs),principal={accountId:'owner',modelId:'codex',agentId:'worker',role:'agent' as const};
 await fs.writeNote({path:'A.md',content:'Original A'});await fs.writeNote({path:'B.md',content:'Original B'});
 const a=await fs.readNoteRevision('A.md'), b=await fs.readNoteRevision('B.md');
 const saved=await service.save({principal,topic:'Pinned checks',summary:'Checkpoint',nextAction:'Review before editing',
  pendingEdits:[{path:'A.md',expectedRevision:a,endpointId:'notes.patch'},{path:'Unselected.md',expectedRevision:'missing',endpointId:'notes.write'}],
  researchTrail:[{kind:'read',summary:'Earlier read',path:'B.md',revision:b},{kind:'finding',summary:'No pinned source'}]});
 const original=await fs.readNote('_scopes/agents/worker/_continuity/work-state.md');
 const reads=vi.spyOn(fs,'readNoteMetadata');
 const ordinary=await service.read({principal,maxChars:6000}) as any;
 expect(ordinary.validation).toMatchObject({checked:['checkpoint'],unchecked:expect.arrayContaining(['pendingEdits','researchTrail','otherSavedFields'])});
 expect(reads).not.toHaveBeenCalled();
 await fs.writeNote({path:'B.md',content:'Changed B'});
 const selected=await service.read({principal,maxChars:6000,validatePins:{pendingEdits:[0],researchTrail:[0,1]}} as any) as any;
 expect(selected.validation.pins).toEqual([{field:'pendingEdits',index:0,state:'current'},{field:'researchTrail',index:0,state:'stale'},{field:'researchTrail',index:1,state:'unpinned'}]);
 expect(reads.mock.calls.flatMap(call=>call[0])).not.toContain('Unselected.md');
 expect(selected.route).toBeUndefined();
 expect(selected.fm.pending_edits).toEqual(original.frontmatter.pending_edits);
 expect((await fs.readNote('_scopes/agents/worker/_continuity/work-state.md')).revision).toBe(saved.revision);
 const note=await fs.readNote('A.md');await fs.writeNote({path:'A.md',content:note.content,frontmatter:{moderation_status:'hidden'}});
 const hidden=await service.read({principal,maxChars:1200,validatePins:{pendingEdits:[0]}} as any) as any;
 expect(hidden.validation.pins).toEqual([{field:'pendingEdits',index:0,state:'unavailable'}]);
 expect(JSON.stringify(hidden.validation)).not.toMatch(/A\.md|Original|Changed/);
});

test('missing guards are never validated from denied paths, and invalid selection cannot expand the read',async()=>{
 const root=await mkdtemp(join(tmpdir(),'continuity-pins-'));roots.push(root);
 const fs=new FileSystemService(root),service=new ContinuityService(fs),principal={accountId:'owner',modelId:'codex',agentId:'worker',role:'agent' as const};
 await service.save({principal,topic:'Missing targets',summary:'Do not infer absence from denial',nextAction:'Review',pendingEdits:[
  {path:'New.md',expectedRevision:'missing',endpointId:'notes.write'},{path:'.obsidian/Hidden.md',expectedRevision:'missing',endpointId:'notes.write'}]});
 const result=await service.read({principal,validatePins:{pendingEdits:[0,1]},maxChars:6000}) as any;
 expect(result.validation.pins.map((pin:any)=>pin.state)).toEqual(['current','unavailable']);
 for(const validatePins of [{pendingEdits:[0,0]},{pendingEdits:[2]},{researchTrail:[-1]},{everything:true}])await expect(service.read({principal,validatePins} as any)).rejects.toThrow(/selection|indices|absent/i);
});
