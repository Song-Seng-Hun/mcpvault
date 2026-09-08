import { describe, expect, it } from 'vitest';
import { initialEconomy, applyEconomyCommand, economyRevision, validateEconomyPolicy, type EconomyPolicy, type EconomyCommand } from './economy-model.js';

const policy: EconomyPolicy = {
  version: 1, revision: 'pilot-1', enabled: true, treasury: 'treasury', operators: ['operator'],
  owners: { alice: 'owner-a', bob: 'owner-b', carol: 'owner-c', alice2: 'owner-a', treasury: 'host' },
  reviewers: ['carol'], subjectiveReview: true, maxSupply: 5000, maxReward: 100, minReward: 10,
  postingFee: 2, reviewFee: 5, dailySpend: 107, dailyPosts: 1, openContracts: 2,
};
const time = '2026-09-08T01:00:00.000Z';
it('economic identities must already be canonical, preventing case-split owner independence',()=>{
  for(const owner of ['Owner-a',' owner-a ','__Proto__'])expect(()=>validateEconomyPolicy({...policy,owners:{...policy.owners,alice:owner}})).toThrow(/canonical|Invalid|lowercase/);
  expect(()=>applyEconomyCommand(initialEconomy(),{op:'issue',actor:'Operator',requestId:'issue',amount:5000,reason:'approval'},policy,time)).toThrow(/canonical|Invalid/);
});
const terms = { taskId: 'task-one', taskRevision: 'a'.repeat(64), title: 'Find a counterexample',
  criteria: ['Preserve contrary findings and uncertainty'], exclusions: ['No external execution authority'],
  reward: 100, kind: 'research' as const, deadline: '2026-09-10T00:00:00.000Z', verifier: 'independent-review-v1' };
function seeded() {
  let state = initialEconomy();
  state = applyEconomyCommand(state, { op: 'issue', actor: 'operator', requestId: 'genesis', amount: 5000, reason: 'Approved pilot' }, policy, time).state;
  return applyEconomyCommand(state, { op: 'allocate', actor: 'operator', requestId: 'budget', account: 'alice', amount: 200, reason: 'Approved owner budget' }, policy, time).state;
}
function funded() {
  let state = seeded();
  state = applyEconomyCommand(state, { op: 'draft', actor: 'alice', requestId: 'draft', contractId: 'quest-one', expectedRevision: 'missing', terms }, policy, time).state;
  return applyEconomyCommand(state, { op: 'fund', actor: 'alice', requestId: 'fund', contractId: 'quest-one', expectedRevision: economyRevision(state.contracts['quest-one']!) }, policy, time).state;
}
function next(state: ReturnType<typeof seeded>, command: EconomyCommand) { return applyEconomyCommand(state, command, policy, time); }

describe('conserved quest economy', () => {
  it('escrows reward plus review fee and sends posting fee to treasury without minting', () => {
    const s = funded();
    expect(s.balances.alice).toBe(93);
    expect(s.balances.treasury).toBe(4802);
    expect(s.contracts['quest-one']!.escrow).toBe(105);
    expect(Object.values(s.balances).reduce((a,b) => a+b, 0) + 105).toBe(s.issued);
  });
  it('refunds only escrow, and a retry cannot refund twice even after later transactions', () => {
    const s = funded();
    const cmd: EconomyCommand = { op: 'cancel', actor: 'alice', requestId: 'cancel', contractId: 'quest-one', expectedRevision: economyRevision(s.contracts['quest-one']!) };
    const first = next(s, cmd);
    expect(first.state.balances.alice).toBe(198);
    expect(next(first.state, cmd).state).toEqual(first.state);
    expect(() => next(first.state, { ...cmd, reason: 'different' })).toThrow(/requestId/);
  });
  it('requires independent verified owners and rejects self-declared/unapproved accounts', () => {
    const s = funded(); const base = { op: 'claim' as const, requestId: 'claim', contractId: 'quest-one', expectedRevision: economyRevision(s.contracts['quest-one']!), expectedGeneration: 0 };
    expect(() => next(s, { ...base, actor: 'alice2' })).toThrow(/owner/);
    for (let i=0; i<1000; i++) expect(() => next(s, { ...base, actor: `unapproved-${i}` })).toThrow(/approved/);
    const claimed = next(s, { ...base, actor: 'bob' }).state;
    expect(claimed.contracts['quest-one']!.generation).toBe(1);
    expect(() => next(claimed, { ...base, actor: 'carol' })).toThrow(/revision/);
  });
  it('pays fixed reviewed artifacts once without creating reputation or supply', () => {
    let s = funded();
    const command = (op: EconomyCommand['op'], actor: string, extra: Partial<EconomyCommand> = {}) => ({ op, actor, requestId: op, contractId: 'quest-one', expectedRevision: economyRevision(s.contracts['quest-one']!), expectedGeneration: s.contracts['quest-one']!.generation, ...extra });
    s = next(s, command('claim','bob')).state;
    expect(() => next(s, command('submit','bob',{ expectedGeneration: 0, artifacts: [{ path: 'Knowledge/result.md', revision: 'b'.repeat(64) }] }))).toThrow(/generation/);
    s = next(s, command('submit','bob',{ artifacts: [{ path: 'Knowledge/result.md', revision: 'b'.repeat(64) }] })).state;
    const basis = s.contracts['quest-one']!.submission!.basis;
    expect(() => next(s, command('review','alice',{ verdict: 'approve', basis, reason: 'Looks good' }))).toThrow(/reviewer/);
    expect(() => next(s, command('review','carol',{ verdict: 'approve', basis: 'stale', reason: 'Looks good' }))).toThrow(/basis/);
    s = next(s, command('review','carol',{ verdict: 'approve', basis, reason: 'Checked exact source and uncertainty', reviewArtifact: { path: 'Knowledge/review.md', revision: 'c'.repeat(64) } })).state;
    expect(s.balances.bob).toBe(100); expect(s.balances.carol).toBe(5);
    expect(s.issued).toBe(5000); expect(s.contracts['quest-one']!.escrow).toBe(0);
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER, NaN, Infinity])('rejects invalid issuance amount %s', amount => {
    expect(() => next(initialEconomy(), { op:'issue', actor:'operator',requestId:'bad',amount,reason:'approved' })).toThrow();
  });
  it('requires host issuance, does not convert likes, and is disabled by default policy', () => {
    expect(() => next(initialEconomy(), { op:'issue', actor:'alice',requestId:'bad',amount:100,reason:'likes' })).toThrow(/operator/);
    expect(() => applyEconomyCommand(seeded(), { op:'draft', actor:'alice', requestId:'draft', contractId:'one', expectedRevision:'missing',terms }, { ...policy, enabled:false }, time)).toThrow(/disabled/);
  });
  it('a three-owner trading circle conserves supply and cannot harvest completion XP',()=>{
    const rules={...policy,reviewers:['alice','bob','carol']};
    let s=seeded();
    for(const account of ['bob','carol'])s=applyEconomyCommand(s,{op:'allocate',actor:'operator',account,amount:200,reason:'approved pilot budget',requestId:`budget-${account}`},rules,time).state;
    const peers=['alice','bob','carol'];
    for(let i=0;i<3;i++) {
      const requester=peers[i]!, worker=peers[(i+1)%3]!,reviewer=peers[(i+2)%3]!,contractId=`circle-${i}`;
      const run=(op:EconomyCommand['op'],actor:string,extra:Partial<EconomyCommand>={})=>{
        const c=s.contracts[contractId];
        s=applyEconomyCommand(s,{op,actor,requestId:`${contractId}-${op}`,contractId,expectedRevision:c?economyRevision(c):'missing',expectedGeneration:c?.generation??0,...extra},rules,time).state;
      };
      run('draft',requester,{terms:{...terms,taskId:`circle-task-${i}`}});run('fund',requester);run('claim',worker);
      run('submit',worker,{artifacts:[{path:`Knowledge/result-${i}.md`,revision:'b'.repeat(64)}]});
      run('review',reviewer,{verdict:'approve',basis:s.contracts[contractId]!.submission!.basis,reason:'verified fixed criteria',reviewArtifact:{path:`Knowledge/review-${i}.md`,revision:'c'.repeat(64)}});
    }
    expect(s.issued).toBe(5000);
    expect(Object.values(s.balances).reduce((a,b)=>a+b,0)).toBe(5000);
    expect(s.balances.treasury).toBe(4406);
    expect(peers.map(a=>s.balances[a])).toEqual([198,198,198]);
  });
  it('aliases owned by the same human share the posting budget',()=>{
    let s=funded();
    s=next(s,{op:'allocate',actor:'operator',requestId:'alias-budget',account:'alice2',amount:200,reason:'approved budget'}).state;
    s=next(s,{op:'draft',actor:'alice2',requestId:'alias-draft',contractId:'alias-quest',expectedRevision:'missing',terms:{...terms,taskId:'alias-task'}}).state;
    expect(()=>next(s,{op:'fund',actor:'alice2',requestId:'alias-fund',contractId:'alias-quest',expectedRevision:economyRevision(s.contracts['alias-quest']!)})).toThrow(/Owner daily/);
  });
});
