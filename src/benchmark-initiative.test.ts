import { expect, test, vi } from 'vitest';
import * as serviceModule from './benchmark-service.js';

function fixture() {
 const attempts=new Set<string>();
 let now=Date.parse('2026-09-11T00:00:00Z');
 const host={
  enabled:true, topic:'reasoning', collectorAccounts:['collector'], collectorOwnerIds:['owner'],
  status:vi.fn(async()=>({busy:false,pendingApproval:false,inFlight:false})),
  // Fake boundary for the existing host's atomic durable execution receipts.
  reserveAttempt:vi.fn(async(p:any)=>{if(attempts.has(p.day))return false;attempts.add(p.day);return true;}),
  finishAttempt:vi.fn(async()=>{}),
  searchWiki:vi.fn(async()=>({state:'clear',existingUrls:[]})),
  searchPublicLinks:vi.fn(async()=>[{url:'https://example.org/problem',reason:'One short reasoning problem',reuse:'unknown'}]),
  captureWiki:vi.fn(async()=>({path:'Inbox/candidates.md',revision:'a'.repeat(64)})),
 };
 const inspect=vi.fn(async()=>({state:'empty'}));
 const run=(extra:Record<string,unknown>={})=>(serviceModule as any).runBenchmarkInitiative({host,inspect,trigger:'session_start',now:()=>now,...extra});
 return {host,inspect,run,nextDay:()=>{now+=86_400_000;}};
}

test('benchmark initiative requires existing host capabilities and a globally empty idle state',async()=>{
 expect((serviceModule as any).runBenchmarkInitiative).toBeTypeOf('function');
 const f=fixture();
 expect(await f.run({host:undefined})).toMatchObject({state:'host_capability_missing'});
 for(const state of ['disabled','unknown','active','pending_approval']) {
  f.inspect.mockResolvedValueOnce({state});
  expect(await f.run()).toMatchObject({state:'suppressed'});
 }
 f.host.status.mockResolvedValueOnce({busy:true,pendingApproval:false,inFlight:false});
 expect(await f.run()).toMatchObject({state:'suppressed'});
 expect(f.host.reserveAttempt).not.toHaveBeenCalled();
 expect(f.host.searchPublicLinks).not.toHaveBeenCalled();
 expect(await f.run({trigger:'timer'})).toMatchObject({state:'suppressed'});
});

test('benchmark initiative reuses host-wide daily receipts, searches Wiki, captures only short links and holds rights',async()=>{
 const f=fixture();
 const results=await Promise.all([f.run(),f.run()]);
 expect(results.filter(r=>r.state==='pending_approval')).toHaveLength(1);
 expect(f.host.searchPublicLinks).toHaveBeenCalledTimes(1);
 expect(f.host.searchPublicLinks.mock.calls[0]![0]).toMatchObject({maxLinks:3,publicOnly:true,linkOnly:true});
 expect(f.host.reserveAttempt.mock.calls[0]![0]).toMatchObject({domain:'benchmark-discovery',day:'2026-09-11',maxAttempts:1,maxDurationMs:300000});
 expect(f.host.searchWiki).toHaveBeenCalledTimes(2);
 const capture=f.host.captureWiki.mock.calls[0]![0] as any;
 expect(capture).toMatchObject({pendingHumanApproval:true});
 expect(capture).not.toHaveProperty('collectorOwnerIds');
 expect(f.host.finishAttempt).toHaveBeenCalledWith(expect.objectContaining({collectorAccounts:['collector'],collectorOwnerIds:['owner']}));
 expect(capture.candidates).toEqual([{url:'https://example.org/problem',reason:'One short reasoning problem',reuse:'unknown',disposition:'link_only_hold'}]);
 expect(await f.run()).toMatchObject({state:'daily_budget_used'});
 f.nextDay();
 f.host.searchWiki.mockResolvedValueOnce({state:'pending',existingUrls:[]});
 expect(await f.run()).toMatchObject({state:'suppressed'});
 expect(f.host.searchPublicLinks).toHaveBeenCalledTimes(1);
});

test('failed discovery consumes the attempt and late deadline results cannot capture',async()=>{
 const f=fixture();
 f.host.searchPublicLinks.mockRejectedValueOnce(Error('provider failed'));
 expect(await f.run()).toMatchObject({state:'failed'});
 expect(await f.run()).toMatchObject({state:'daily_budget_used'});
 expect(f.host.finishAttempt).toHaveBeenCalledWith(expect.objectContaining({outcome:'failed'}));
 f.nextDay();
 vi.useFakeTimers();
 try {
  let signal:AbortSignal|undefined;
  f.host.searchPublicLinks.mockImplementationOnce(async(p:any)=>{signal=p.signal;return new Promise(()=>{});});
  const pending=f.run();
  await vi.advanceTimersByTimeAsync(300001);
  expect(await pending).toMatchObject({state:'timed_out'});
  expect(signal?.aborted).toBe(true);
  expect(f.host.captureWiki).not.toHaveBeenCalled();
 } finally {vi.useRealTimers();}
});
