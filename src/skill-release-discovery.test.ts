import {expect,test} from 'vitest';
import {discoverReviewedProcedures} from './skill-release-discovery.js';
import type {ReviewedSkillHost,ReviewedSkillDeliveryFence} from './skill-release-reader.js';

// The orchestrator is real. Integrity/identity/source authorization are tested
// with the real release service in skill-release-service and MCP suites.
function fixture(ids=['skill-a']){
  let live=true,calls=0;
  const identity:ReviewedSkillDeliveryFence={revalidate:async()=>{if(!live)throw Error('revoked');},assertFresh:()=>{if(!live)throw Error('revoked');}};
  const host={candidates:async()=>ids} as ReviewedSkillHost;
  const read=async(skillId:string,capture:(f:ReviewedSkillDeliveryFence)=>void)=>{
    calls++;capture(identity);
    return {skillId,releaseRevision:'a'.repeat(64),partial:false,executionAuthorized:false,
      limitations:['Do not execute bundled code.'],useWhen:['Authorized review task.'],avoidWhen:['Missing source.'],
      card:{functions:['Review code.'],domains:['software/review'],purpose:'Preserve exact names.',keywords:['검토','빌드'],example:{query:'Review 변경',action:'Existing read tools',expected:'Bounded findings',avoid:'Forbidden action'}},
      nextAction:{endpointId:'skill.resolve',arguments:{skillId,expectedRelease:'a'.repeat(64)}}};
  };
  return {host,identity,read,revoke:()=>{live=false;},get calls(){return calls;}};
}

test('only actual discovery text matches; metadata keys and prohibited examples are not search aliases',async()=>{
  const f=fixture();
  for(const query of ['functions','keywords','Forbidden','Missing','execute']){
    expect((await discoverReviewedProcedures({...f,query})).cards).toEqual([]);
  }
  for(const query of ['검토','review 변경','Preserve names']){
    expect((await discoverReviewedProcedures({...f,query})).cards).toHaveLength(1);
  }
});

test('bounds total JSON without dropping restrictions, duplicates or exposing inaccessible candidate counts',async()=>{
  const f=fixture(['skill-a','skill-a','skill-b','skill-c','skill-d']);
  const small=await discoverReviewedProcedures({...f,query:'review',maxChars:1024});
  expect(JSON.stringify(small).length).toBeLessThanOrEqual(1024);
  for(const card of small.cards)expect(card.limitations).toEqual(['Do not execute bundled code.']);
  const full=await discoverReviewedProcedures({...f,query:'review',maxChars:12000});
  expect(full.cards).toHaveLength(3);expect(new Set(full.cards.map(c=>c.skillId)).size).toBe(3);
  expect((await discoverReviewedProcedures({...f,query:'review',maxChars:12000,limit:1})).cards).toHaveLength(1);
  expect(full.partial).toBe(true);expect(full).not.toHaveProperty('total');
  for(const ids of [Array.from({length:9},(_,i)=>`skill-${i}`),['../secret']]){
    await expect(discoverReviewedProcedures({...fixture(ids),query:'review'})).rejects.toThrow('Reviewed skill unavailable');
  }
});

test('rechecks earlier selected cards after later work; an outer async refresh cannot authorize stale bytes',async()=>{
  const f=fixture(['skill-a','skill-b']);let firstLive=true;
  const read=async(id:string,capture:(f:ReviewedSkillDeliveryFence)=>void)=>{
    const card=await f.read(id,()=>{});
    if(id==='skill-a')capture({revalidate:async()=>{},assertFresh:()=>{if(!firstLive)throw Error('changed');}});
    else capture({revalidate:async()=>{firstLive=false;},assertFresh:()=>{}});
    return card;
  };
  await expect(discoverReviewedProcedures({...f,read,query:'review'})).rejects.toThrow();
});

test('unavailable candidates and strict expressions never trigger unbounded fallback or existence details',async()=>{
  const f=fixture();
  for(const query of ['"review"','review -code','path:x','review OR code']){
    expect((await discoverReviewedProcedures({...f,query})).cards).toEqual([]);
  }
  expect(f.calls).toBe(0);
  const result=await discoverReviewedProcedures({...f,query:'review',read:async()=>{throw Error('hidden-title secret-host-path');}});
  expect(result.cards).toEqual([]);expect(JSON.stringify(result)).not.toMatch(/hidden-title|secret-host-path|skill-a/);
});
