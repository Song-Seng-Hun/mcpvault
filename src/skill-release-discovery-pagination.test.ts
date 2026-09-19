import {expect,test} from 'vitest';
import {discoverReviewedProcedures} from './skill-release-discovery.js';
import type {ReviewedSkillDeliveryFence,ReviewedSkillHost} from './skill-release-reader.js';

function fixture(ids:readonly string[],largeIds:readonly string[]=[]){
  const identity:ReviewedSkillDeliveryFence={revalidate:async()=>{},assertFresh:()=>{}};let pageCalls=0;
  const host=({
    candidatesPage:async(cursor?:string,scanBudget=8)=>{
      pageCalls++;
      const start=cursor===undefined?0:Number(cursor.slice('host:'.length));
      const candidates=ids.slice(start,start+scanBudget);
      return {candidates,nextCursor:start+candidates.length<ids.length?`host:${start+candidates.length}`:undefined,registryGeneration:'registry-generation-1'};
    },
  } as unknown as ReviewedSkillHost);
  const read=async(skillId:string,capture:(f:ReviewedSkillDeliveryFence)=>void)=>{
    capture(identity);
    const matching=skillId.startsWith('matching-')||skillId==='matching-late';
    return {skillId,releaseRevision:'a'.repeat(64),partial:false,executionAuthorized:false,
      limitations:['Do not execute bundled code.'],useWhen:['Authorized review task.'],avoidWhen:['Missing source.'],
      card:matching
        ?{functions:[largeIds.includes(skillId)?'x'.repeat(6000):'Match this procedure'],purpose:'Matching discovery query',keywords:['match']}
        :{functions:['Unrelated procedure'],purpose:'Different discovery query',keywords:['other']},
      nextAction:{endpointId:'skill.resolve',arguments:{skillId,expectedRelease:'a'.repeat(64)}}};
  };
  const call=(extra:Record<string,unknown>={})=>discoverReviewedProcedures({
    host,query:'match',maxChars:12000,limit:3,identity,read,cursorScope:'authenticated-session',...extra,
  } as never);
  return {call,get pageCalls(){return pageCalls;}};
}

test('finds a matching release after more than eight registered releases with bounded pages',async()=>{
  const f=fixture([...Array.from({length:8},(_,i)=>`unrelated-${i}`),'matching-late']);let cursor:unknown;
  const cards:any[]=[];
  for(let i=0;i<10;i++){
    const result=await f.call({cursor,scanBudget:3});cards.push(...result.cards);cursor=result.nextCursor;
    if(cursor===undefined)break;
  }
  expect(cards.map(card=>card.skillId)).toEqual(['matching-late']);expect(f.pageCalls).toBe(3);
});

test('returns all nine matching releases across limit-three continuations without skipping a page tail',async()=>{
  const ids=Array.from({length:9},(_,i)=>`matching-${i}`),f=fixture(ids);let cursor:unknown;
  const cards:any[]=[];
  for(let i=0;i<5;i++){
    const result=await f.call({cursor,scanBudget:9});cards.push(...result.cards);cursor=result.nextCursor;
    if(cursor===undefined)break;
  }
  expect(cards.map(card=>card.skillId)).toEqual(ids);expect(f.pageCalls).toBe(3);
});

test('returns all nine matching releases when the scan budget is smaller than the result limit',async()=>{
  const ids=Array.from({length:9},(_,i)=>`matching-${i}`),f=fixture(ids);let cursor:unknown;
  const cards:any[]=[];
  for(let i=0;i<6;i++){
    const result=await f.call({cursor,scanBudget:2});cards.push(...result.cards);cursor=result.nextCursor;
    if(cursor===undefined)break;
  }
  expect(cards.map(card=>card.skillId)).toEqual(ids);expect(f.pageCalls).toBe(5);
});

test('does not permanently drop a matching card that exceeds the response budget',async()=>{
  const ids=Array.from({length:9},(_,i)=>i===1?'matching-large':`matching-${i}`),f=fixture(ids,['matching-large']);let cursor:unknown;
  const cards:any[]=[];
  for(let i=0;i<5;i++){
    const result=await f.call({cursor,scanBudget:9,maxChars:2048});cards.push(...result.cards);cursor=result.nextCursor;
    if(cursor===undefined)break;
  }
  expect(cards.map(card=>card.skillId)).toEqual(ids);
  const large=cards.find(card=>card.skillId==='matching-large');
  expect(large.card).toEqual({});expect(large.nextAction.endpointId).toBe('skill.resolve');
});

test('strict expressions do not open a pageable registry window',async()=>{
  const identity:ReviewedSkillDeliveryFence={revalidate:async()=>{},assertFresh:()=>{}};let pageCalls=0;
  const host=({
    candidatesPage:async()=>{pageCalls++;return {candidates:['hidden-skill'],registryGeneration:'g1'};},
  } as unknown as ReviewedSkillHost);
  const result=await discoverReviewedProcedures({host,query:'"matching"',identity,read:async()=>{
    throw Error('must not read');
  },cursorScope:'authenticated-session'});
  expect(result.cards).toEqual([]);expect(pageCalls).toBe(0);
});

test('continuation is bound to the authenticated query scope and registry generation',async()=>{
  const identity:ReviewedSkillDeliveryFence={revalidate:async()=>{},assertFresh:()=>{}};let generation='g1';
  const host=({
    candidatesPage:async(cursor?:string)=>({candidates:[],nextCursor:cursor===undefined?'internal-page-2':undefined,registryGeneration:generation}),
  } as unknown as ReviewedSkillHost);
  const base={host,query:'matching',identity,read:async(_id:string,capture:(f:ReviewedSkillDeliveryFence)=>void)=>{
    capture(identity);return {skillId:_id,partial:false,executionAuthorized:false,card:{},limitations:[],useWhen:[],avoidWhen:[],nextAction:{}};
  },cursorScope:'authenticated-session'};
  const first=await discoverReviewedProcedures(base);
  await expect(discoverReviewedProcedures({...base,cursor:first.nextCursor,query:'other'})).rejects.toThrow('Reviewed skill unavailable');
  const second=await discoverReviewedProcedures(base);generation='g2';
  await expect(discoverReviewedProcedures({...base,cursor:second.nextCursor})).rejects.toThrow('Reviewed skill unavailable');
});

test('an unavailable candidate read does not stop the current page',async()=>{
  const identity:ReviewedSkillDeliveryFence={revalidate:async()=>{},assertFresh:()=>{}};let failed=true;const calls:string[]=[];
  const host=({
    candidatesPage:async(cursor?:string)=>({
      candidates:cursor===undefined?['matching-first','matching-second']:[],
      nextCursor:cursor===undefined?'host:done':undefined,registryGeneration:'g1',
    }),
  } as unknown as ReviewedSkillHost);
  const read=async(skillId:string,capture:(f:ReviewedSkillDeliveryFence)=>void)=>{
    calls.push(skillId);if(skillId==='matching-first'&&failed){failed=false;throw Error('transient read failure');}
    capture(identity);return {skillId,releaseRevision:'a'.repeat(64),partial:false,executionAuthorized:false,
      limitations:['Do not execute bundled code.'],useWhen:['Authorized review task.'],avoidWhen:['Missing source.'],
      card:{functions:['Match this procedure'],purpose:'Matching discovery query',keywords:['match']},nextAction:{}};
  };
  const base={host,query:'match',maxChars:12000,limit:3,identity,read,cursorScope:'authenticated-session'};
  const failedResult=await discoverReviewedProcedures(base);
  expect(failedResult.cards.map(card=>card.skillId)).toEqual(['matching-second']);
  expect(failedResult.nextCursor).toBeDefined();
  expect(calls).toEqual(['matching-first','matching-second']);
});

test('a delivery-fence failure leaves an existing opaque cursor retryable',async()=>{
  const identity:ReviewedSkillDeliveryFence={revalidate:async()=>{},assertFresh:()=>{}};let failDelivery=true;let pageCalls=0;
  const host=({
    candidatesPage:async(cursor?:string)=>{pageCalls++;return {candidates:cursor===undefined?['matching-first']:['matching-second'],nextCursor:cursor===undefined?'host:second':undefined,registryGeneration:'g1'};},
  } as unknown as ReviewedSkillHost);
  const read=async(skillId:string,capture:(f:ReviewedSkillDeliveryFence)=>void)=>{
    capture({revalidate:async()=>{if(skillId==='matching-second'&&failDelivery)throw Error('stale delivery');},assertFresh:()=>{}});
    return {skillId,releaseRevision:'a'.repeat(64),partial:false,executionAuthorized:false,
      limitations:['Do not execute bundled code.'],useWhen:['Authorized review task.'],avoidWhen:['Missing source.'],
      card:{functions:['Match this procedure'],purpose:'Matching discovery query',keywords:['match']},nextAction:{}};
  };
  const base={host,query:'match',maxChars:12000,limit:3,identity,read,cursorScope:'authenticated-session'};
  const first=await discoverReviewedProcedures(base);
  await expect(discoverReviewedProcedures({...base,cursor:first.nextCursor})).rejects.toThrow('Reviewed skill unavailable');
  failDelivery=false;
  const retry=await discoverReviewedProcedures({...base,cursor:first.nextCursor});
  expect(retry.cards.map(card=>card.skillId)).toEqual(['matching-second']);
  expect(pageCalls).toBe(2);
});

test('a sub-1024 budget returns only the bounded notice without candidate reads',async()=>{
  const identity:ReviewedSkillDeliveryFence={revalidate:async()=>{},assertFresh:()=>{}};let reads=0;
  const host=({candidatesPage:async()=>({candidates:['matching-first'],registryGeneration:'g1'})} as unknown as ReviewedSkillHost);
  const result=await discoverReviewedProcedures({host,query:'match',maxChars:1000,identity,cursorScope:'authenticated-session',read:async()=>{reads++;throw Error('must not read');}});
  expect(result.cards).toEqual([]);expect(result.nextCursor).toBeUndefined();expect(reads).toBe(0);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(1000);
});

test('compact cards preserve mandatory limitations and conditions',async()=>{
  const f=fixture(['matching-large'],['matching-large']);
  const result=await f.call({maxChars:2048});
  expect(result.cards).toHaveLength(1);
  expect(result.cards[0]).toMatchObject({limitations:['Do not execute bundled code.'],useWhen:['Authorized review task.'],avoidWhen:['Missing source.'],card:{},nextAction:{endpointId:'skill.resolve'}});
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(2048);
});

test('a compact overflow returns an opaque cursor for the un-emitted page remainder',async()=>{
  const f=fixture(['matching-0','matching-large','matching-2'],['matching-large']);
  const first=await f.call({maxChars:1400,scanBudget:3});
  expect(first.cards.map(card=>card.skillId)).toEqual(['matching-0','matching-large']);
  expect(first.cards[1]).toMatchObject({limitations:['Do not execute bundled code.'],useWhen:['Authorized review task.'],avoidWhen:['Missing source.'],card:{},nextAction:{endpointId:'skill.resolve'}});
  expect(first.nextCursor).toBeDefined();
  expect(JSON.stringify(first).length).toBeLessThanOrEqual(1400);
  const second=await f.call({cursor:first.nextCursor,maxChars:1400,scanBudget:3});
  expect(second.cards.map(card=>card.skillId)).toEqual(['matching-2']);
  expect(second.nextCursor).toBeUndefined();
});

test('a compact card that cannot fit after an earlier card remains retryable',async()=>{
  const f=fixture(['matching-0','matching-large','matching-2'],['matching-large']);
  const first=await f.call({maxChars:1100,scanBudget:3});
  expect(first.cards.map(card=>card.skillId)).toEqual(['matching-0']);
  expect(first.nextCursor).toBeDefined();
  expect(JSON.stringify(first).length).toBeLessThanOrEqual(1100);
  const second=await f.call({cursor:first.nextCursor,maxChars:1100,scanBudget:3});
  expect(second.cards.map(card=>card.skillId)).toEqual(['matching-large']);
  expect(second.cards[0]).toMatchObject({limitations:['Do not execute bundled code.'],useWhen:['Authorized review task.'],avoidWhen:['Missing source.'],card:{},nextAction:{endpointId:'skill.resolve'}});
  expect(second.nextCursor).toBeDefined();
  const third=await f.call({cursor:second.nextCursor,maxChars:1100,scanBudget:3});
  expect(third.cards.map(card=>card.skillId)).toEqual(['matching-2']);
  expect(third.nextCursor).toBeUndefined();
});

test('hidden, revoked, and nonmatching candidates disclose neither identity nor counts',async()=>{
  const identity:ReviewedSkillDeliveryFence={revalidate:async()=>{},assertFresh:()=>{}};
  const host=({candidatesPage:async(cursor?:string)=>({
    candidates:cursor===undefined?['hidden-secret','revoked-secret','other-secret']:['matching-visible'],
    nextCursor:cursor===undefined?'host:visible':undefined,registryGeneration:'g1',
  })} as unknown as ReviewedSkillHost);
  const read=async(skillId:string,capture:(f:ReviewedSkillDeliveryFence)=>void)=>{
    if(skillId==='hidden-secret'||skillId==='revoked-secret')throw Error('metadata unavailable');
    capture(identity);
    if(skillId==='other-secret')return {skillId,partial:false,executionAuthorized:false,card:{functions:['Different procedure'],purpose:'Different query'},limitations:[],useWhen:[],avoidWhen:[],nextAction:{}};
    return {skillId,partial:false,executionAuthorized:false,card:{functions:['Match this procedure'],purpose:'Matching discovery query'},limitations:[],useWhen:[],avoidWhen:[],nextAction:{}};
  };
  const base={host,query:'match',identity,read,cursorScope:'authenticated-session'};
  const first=await discoverReviewedProcedures(base);
  expect(first.cards).toEqual([]);expect(JSON.stringify(first)).not.toMatch(/hidden-secret|revoked-secret|other-secret|total|count/i);
  const result=await discoverReviewedProcedures({...base,cursor:first.nextCursor});
  expect(result.cards.map(card=>card.skillId)).toEqual(['matching-visible']);
  expect(JSON.stringify(result)).not.toMatch(/hidden-secret|revoked-secret|other-secret|total|count/i);
});
