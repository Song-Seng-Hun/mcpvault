import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import type { SkillInventory } from './skill-review-inventory.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const source='# Document review\r\nPreserve exceptions (예외) 😀.\r\nNever publish without permission.\r\n';
const file={path:'SKILL.md',bytes:Buffer.byteLength(source),sha256:hash(source)};
const inventory:SkillInventory={version:1,rootId:hash('root'),complete:true,fingerprint:hash('inventory'),files:[file],reasons:[],executionAuthorized:false};
function record(){return {version:1,targetId:hash('document-review'),sourceFingerprint:inventory.fingerprint,reviewer:'current-session',
  descriptor:{version:1,kind:'procedure',domains:['documentation/review'],purpose:'Review a document while preserving exceptions.',
    useWhen:['Reviewing a document.'],avoidWhen:['No source text is available.'],effects:[],connections:[],examples:[{query:'Review 예외 in a document',action:'review_document',expected:'Preserve exceptions and do not publish.'}]},
  evidence:[{fields:['kind','purpose','domains','useWhen','avoidWhen','effects','connections','examples'],path:file.path,sha256:file.sha256,startLine:1,endLine:3,
    quote:source.split('\n').slice(0,3).join('\n'),interpretation:'reviewer_inference'}],
  unknowns:{compatibility:'Runtime not specified by source.',relatedSkills:'Not assessed.',incompatibleSkills:'Not assessed.',inputs:'Implicit document input.',outputs:'No fixed output format.',keywords:'No explicit alias declaration.',impactClaims:'No qualified legal or policy assessment.'}};}
async function validate(){const m=await import('./skill-review-evidence.js').catch(()=>({validateSkillMetadataEvidence:undefined}));
  expect(m.validateSkillMetadataEvidence,'metadata must carry source-bound evidence').toBeTypeOf('function');return m.validateSkillMetadataEvidence!;}

test('preserves exact bilingual/CRLF source locators and distinguishes inference from approval',async()=>{
  const fn=await validate(),r=await fn(record(),inventory,async()=>Buffer.from(source));
  expect(r.state).toBe('evidence_valid');expect(r.executionAuthorized).toBe(false);expect(r.releaseApproved).toBe(false);
  expect(r.semanticVerification).toBe('not_proven_by_locator_checks');expect(r.descriptor.domains).toEqual(['documentation/review']);
  expect(r.evidence[0]!.quote).toContain('예외');expect(r.usage).toEqual({resolvedCalls:null,verifiedApplications:null,observation:'not_supplied'});
});
test('rejects source drift, missing coverage and falsely quoted source without returning raw secrets',async()=>{
  const fn=await validate();
  for(const change of ['bundle','quote','hash','missing']){
    const r=record();if(change==='bundle')r.sourceFingerprint=hash('other');if(change==='quote')r.evidence[0]!.quote='Pretend source says safe';
    if(change==='hash')r.evidence[0]!.sha256=hash('other');if(change==='missing')r.evidence[0]!.fields=[];
    await expect(fn(r,inventory,async()=>Buffer.from(source))).rejects.toThrow('Skill metadata evidence unavailable');
  }
  await expect(fn(record(),inventory,async()=>Buffer.from('changed'))).rejects.toThrow('Skill metadata evidence unavailable');
  await expect(fn(record(),{...inventory,complete:false,fingerprint:null},async()=>Buffer.from(source))).rejects.toThrow('Skill metadata evidence unavailable');
});
test('invented lifetime counts, approval claims and arbitrary paths cannot enter review evidence',async()=>{
  const fn=await validate();
  for(const extra of [{usage:{calls:999}},{approved:true},{permission:'all'}])await expect(fn({...record(),...extra},inventory,async()=>Buffer.from(source))).rejects.toThrow();
  const r=record();r.evidence[0]!.path='../private.md';let touched=false;
  await expect(fn(r,inventory,async()=>{touched=true;return Buffer.from(source);})).rejects.toThrow();expect(touched).toBe(false);
});
test('tool metadata requires a searchable example and cannot mark a populated field unknown instead of supporting it',async()=>{
  const fn=await validate(),r=record();r.descriptor.kind='tool';r.descriptor.examples=[];
  await expect(fn(r,inventory,async()=>Buffer.from(source))).rejects.toThrow();
  const weak=record();weak.evidence[0]!.fields=weak.evidence[0]!.fields.filter(f=>f!=='purpose');
  (weak.unknowns as Record<string,string>).purpose='No evidence';
  await expect(fn(weak,inventory,async()=>Buffer.from(source))).rejects.toThrow();
});
