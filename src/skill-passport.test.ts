import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileSystemService} from './filesystem.js';
import {FrontmatterHandler} from './frontmatter.js';
import {PathFilter} from './pathfilter.js';
import {ScopeAccessPolicy} from './scope-access.js';
import {ScopeAuthService} from './scope-auth.js';
import {SkillEvolutionService} from './skill-evolution.js';
import {projectSkill,previewSkills,applySkills} from './skill-library.js';
const roots:string[]=[];
afterEach(async()=>{for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'skill-passport-'));roots.push(root);
  const fs=new FileSystemService(root),auth=new ScopeAuthService(root),access=new ScopeAccessPolicy();
  const a=await auth.register({accountId:'reader',modelId:'test',password:'synthetic-test-password'});
  const b=await auth.register({accountId:'other',modelId:'other-model',password:'synthetic-test-password'});
  const host={enabled:true,attestationKey:'synthetic-only-test-key-1234567890123456',approverAccounts:[],profiles:[]};
  const service=new SkillEvolutionService(fs,access,auth,host);
  for(const id of ['payment','invoice']){
    const notes=projectSkill({id,origin:'fixture',version:'1',license:'MIT',licenseText:'Permission is hereby granted, free of charge',
      description:'Synthetic procedure',files:[{path:'SKILL.md',text:'# Reference\nNo test executes payments.'}],unavailable:[],
      descriptor:{version:1,kind:'tool',domains:['finance'],purpose:'Review an authorized payment workflow.',effects:id==='payment'?['financial_transaction']:['read_public'],
        examples:[{query:'결제 전 한도 확인',action:'payments.preview',expected:'A preview, not a transaction.'}]}});
    await applySkills(fs,notes,(await previewSkills(fs,notes)).fingerprint);
  }
  await fs.writeNote({path:'Evidence/check.md',content:'Synthetic observation.'});
  const evidence={path:'Evidence/check.md',revision:(await fs.readNote('Evidence/check.md')).revision};
  const params={principal:a.principal,accessToken:a.accessToken,skillId:'payment',maxChars:12000};
  const meta=(section='summary',extra:Record<string,unknown>={})=>service.resolve({...params,view:'metadata',section,...extra});
  const apply=async(skillId:string,requestId:string,taskId='task-one')=>{
    const p={...params,skillId},current=await service.resolve(p);
    return service.experience({...p,requestId,taskId,expectedRevision:'missing',usedVersion:{path:current.path,revision:current.revision},
      applied:true,shareable:true,outcome:'success',context:'Synthetic task',summary:'Caller reports application.',evidence:[evidence]});
  };
  return {root,fs,auth,access,host,service,a,b,params,meta,apply};
}
test('benign payment remains high-impact without a malicious or compliance verdict',async()=>{
  const f=await fixture(),r=await f.meta('impact');
  expect(r.impact).toMatchObject({meaning:'potential_consequence_not_malice_or_probability',maliciousness:'not_assessed',permissionGranted:false,
    axes:{assets:{level:'critical'},policy:{level:'unknown'},legal:{level:'unknown'},domain:{level:'unknown'}}});
  expect(r.impact.coverage).toBe('declared_capabilities_only');
  const selected=await f.meta('impact',{axis:'assets'});
  expect(Object.keys(selected.impact.axes)).toEqual(['assets']);
  await expect(f.meta('usage',{axis:'assets'})).rejects.toThrow(/axis/i);
  await expect(f.meta('impact',{axis:'invented'})).rejects.toThrow(/axis/i);
});
test('metadata resolves examples and reports unknown usage instead of a dead skill',async()=>{
  const f=await fixture(),r=await f.meta('description'),u=await f.meta('usage');
  expect(r.descriptor.examples[0].query).toBe('결제 전 한도 확인');
  expect(u.usage).toMatchObject({coverage:'unobserved',resolvedCalls:null,verifiedApplications:null,retirementDecision:'not_evaluated'});
});
test('usage separates resolutions, idempotent reports and task co-use without crossing actors',async()=>{
  const f=await fixture();await f.service.resolve(f.params);
  expect((await f.meta('usage')).usage.resolvedCalls).toBe(1);
  await f.meta('usage');expect((await f.meta('usage')).usage.resolvedCalls).toBe(1);
  await f.apply('payment','a');await f.apply('payment','a');await f.apply('invoice','b');
  const u=(await f.meta('usage')).usage;
  expect(u.reportedApplications).toBe(1);expect(u.verifiedApplications).toBeNull();
  expect(u.coUsed).toEqual([expect.objectContaining({skillId:'invoice',tasks:1,basis:'caller_reported_task'})]);
  expect((await f.meta('usage',{principal:f.b.principal,accessToken:f.b.accessToken})).usage.coverage).toBe('unobserved');
  const fresh=new SkillEvolutionService(f.fs,f.access,f.auth,f.host);
  expect((await fresh.resolve({...f.params,view:'metadata',section:'usage'})).usage.coverage).toBe('unobserved');
  const note=await f.fs.readNote('Community/Skills/invoice/SKILL.md');
  await writeFile(join(f.root,'Community/Skills/invoice/SKILL.md'),new FrontmatterHandler().stringify({...note.frontmatter,moderation_status:'hidden'},note.content));
  expect(JSON.stringify((await f.meta('usage')).usage.coUsed)).not.toContain('invoice');
});
test('metadata has bounded valid JSON and no quarantine bypass',async()=>{
  const f=await fixture(),r=await f.meta('impact',{maxChars:1024});
  expect(JSON.stringify(r).length).toBeLessThanOrEqual(1024);expect(r.partial).toBe(true);
  expect(r.nextAction.arguments).toMatchObject({view:'metadata',section:'impact',maxChars:12000});
  const locked=new SkillEvolutionService(new FileSystemService(f.root,new PathFilter({quarantineSkills:true})),f.access,f.auth,f.host);
  await expect(locked.resolve({...f.params,view:'metadata'})).rejects.toThrow();
});
test('metadata rereads edited declarations and invalid view/task arguments are rejected',async()=>{
  const f=await fixture(),before=await f.meta('summary'),n=await f.fs.readNote('Community/Skills/payment/SKILL.md');
  await writeFile(join(f.root,'Community/Skills/payment/SKILL.md'),new FrontmatterHandler().stringify({...n.frontmatter,
    skill_descriptor:{...n.frontmatter.skill_descriptor,purpose:'Updated source declaration.'}},n.content));
  expect((await f.meta('description')).descriptor.purpose).toBe('Updated source declaration.');
  expect(before.basis.bundleRevision).toMatch(/^[a-f0-9]{64}$/);
  await expect(f.service.resolve(before.requiredReads[0].arguments)).rejects.toThrow(/revision|basis/i);
  await expect(f.meta('unrecognized')).rejects.toThrow();
  await expect(f.apply('payment','invalid','private/path')).rejects.toThrow();
});
test('metadata followups reject changed reference files even when SKILL.md is unchanged',async()=>{
  const f=await fixture(),before=await f.meta('summary');
  await writeFile(join(f.root,'Community/Skills/payment/IMPORT-LICENSE.md'),'Changed external reference.');
  await expect(f.service.resolve({...f.params,...before.requiredReads[0].arguments})).rejects.toThrow(/basis|revision/i);
});
test('co-use never returns a peer hidden during final basis validation',async()=>{
  const f=await fixture();await f.apply('payment','a');await f.apply('invoice','b');
  const note=await f.fs.readNote('Community/Skills/invoice/SKILL.md'),check=f.service.store.check.bind(f.service.store);
  vi.spyOn(f.service.store,'check').mockImplementationOnce(async(guards,principal)=>{
    await writeFile(join(f.root,'Community/Skills/invoice/SKILL.md'),new FrontmatterHandler().stringify({...note.frontmatter,moderation_status:'hidden'},note.content));
    return check(guards,principal);
  });
  await expect(f.meta('usage')).rejects.toThrow(/unavailable|changed/i);
});
