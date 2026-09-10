import { guidanceError } from './guidance-runtime.js';
import { fingerprint, textField } from './work-model.js';
import { normalizeScopeId } from './scopes.js';
import { assertSubjectiveAdmission, reserveTreasuryBudget } from './economy-operations.js';

/** Spendable XP is NOT reputation. Only host approvals introduce supply. */
export interface EconomyPolicy {
  version: 1; revision: string; enabled: boolean; treasury: string; operators: string[];
  owners: Record<string, string>; reviewers: string[]; subjectiveReview: boolean;
  maxSupply: number; minReward: number; maxReward: number; postingFee: number; reviewFee: number;
  dailySpend: number; dailyPosts: number; openContracts: number;
  /** Host-approved rolling seven-day disbursement cap, not new supply. */
  treasuryWeeklyBudget?: number;
  /** Optional, explicit human-approved issuance envelopes. Never inferred from quests. */
  benchmarkPrograms?: BenchmarkIssuanceProgram[];
}
export interface BenchmarkIssuanceProgram {
  id:string; lineage:string; definitionFingerprint:string; criteriaFingerprint:string;
  participants:string[]; reward:number; maxWinners:number; cap:number; closesAt:string;
}
export interface BenchmarkAwardProof {
  programId:string; account:string; definitionFingerprint:string; criteriaFingerprint:string; adjudicationRevision:string;
}
export interface BenchmarkReservation { terms:BenchmarkIssuanceProgram; remaining:number; awarded:number; closed:boolean; cancellation?:{actor:string;reason:string;at:string} }
export interface QuestArtifact { path: string; revision: string }
export interface QuestWorkBinding { revision:string; generation:number; requestId:string }
export interface QuestTerms {
  taskId: string; taskRevision: string; title: string; criteria: string[]; exclusions: string[];
  reward: number; kind: 'research' | 'creative' | 'mechanical'; deadline: string; verifier: string;
}
export interface QuestContract {
  id: string; requester: string; requesterOwner: string; terms: QuestTerms; policyRevision: string;
  reviewFee: number; postingFee: number; escrow: number;
  status: 'draft' | 'funded' | 'claimed' | 'submitted' | 'changes_requested' | 'disputed' | 'settled' | 'cancelled';
  generation: number; createdAt: string; updatedAt: string; fundedAt?: string;
  worker?: string; workerOwner?: string; reviewer?: string; reviewerOwner?: string;
  workBinding?: QuestWorkBinding;
  submission?: { artifacts: QuestArtifact[]; basis: string; at: string };
  review?: { actor: string; verdict: string; reason: string; artifact: QuestArtifact; basis: string; at: string };
  revisionRequests: number; disputeReason?: string;
  claimRecovery?:{operator:string;reason:string;at:string;requestId:string};
}
export interface EconomyCommand {
  op: 'issue' | 'allocate' | 'draft' | 'fund' | 'claim' | 'recover_claim' | 'submit' | 'cancel' | 'review' | 'dispute' | 'resolve' | 'reserve_program' | 'award_program' | 'close_program' | 'cancel_program';
  programId?:string; programFingerprint?:string; award?:BenchmarkAwardProof;
  actor: string; requestId: string; contractId?: string; expectedRevision?: string; expectedGeneration?: number;
  amount?: number; account?: string; reason?: string; terms?: QuestTerms; artifacts?: QuestArtifact[];
  verdict?: 'approve' | 'changes_requested' | 'dispute'; basis?: string; reviewArtifact?: QuestArtifact;
  /** Internal Work adapter receipt; never part of the public input schema. */
  workBinding?: QuestWorkBinding;
}
export interface EconomyReceipt { transactionId: string; sequence: number; contractId?: string; revision?: string; status?: string }
export interface EconomyState {
  issued: number; sequence: number; balances: Record<string, number>; contracts: Record<string, QuestContract>;
  requests: Record<string, { payload: string; result: EconomyReceipt }>;
  treasuryDisbursements?: { at: string; amount: number }[];
  programs?:Record<string,BenchmarkReservation>;
  benchmarkAwards?:Record<string,{programId:string;account:string}>;
}
export const economyRevision = (value: unknown): string => fingerprint(value);
export const initialEconomy = (): EconomyState => ({ issued: 0, sequence: 0, balances: Object.create(null), contracts: Object.create(null), requests: Object.create(null) });
const id = (s: unknown, field: string) => {
  if (typeof s !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(s)) throw guidanceError(new Error(`Invalid ${field}`), 'guid-972520f95c9d5dbd');
  const normalized=normalizeScopeId(s, field);
  if(normalized!==s)throw guidanceError(new Error(`Invalid ${field}: use its canonical lowercase identifier`), 'guid-78286fde3852bdad');
  return normalized;
};
function money(n: unknown, max = 1_000_000_000, positive = false): number {
  if (!Number.isSafeInteger(n) || Number(n) < (positive ? 1 : 0) || Number(n) > max) throw guidanceError(new Error('XP must be a bounded nonnegative integer'), 'guid-82fa48ac5adc97c5');
  return Number(n);
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw guidanceError(new Error('A precise UTC timestamp is required'), 'guid-a3d53a3b0e19ca10');
  const canonical = new Date(value).toISOString();
  if (canonical !== value.replace(/(?<=\d\d)Z$/, '.000Z') && canonical !== value) throw guidanceError(new Error('Invalid calendar timestamp'), 'guid-7d0afde4165ae481');
  return canonical;
}
export function validateEconomyPolicy(p: EconomyPolicy): EconomyPolicy {
  if (!p || p.version !== 1 || typeof p.enabled !== 'boolean' || typeof p.subjectiveReview !== 'boolean') throw guidanceError(new Error('Invalid economy policy'), 'guid-6cf3e34daf1444a8');
  textField(p.revision, 'policy revision', 128, true); id(p.treasury, 'treasury');
  if (!Array.isArray(p.operators) || !p.operators.length || p.operators.length > 20 || !Array.isArray(p.reviewers) || p.reviewers.length > 100) throw guidanceError(new Error('Invalid approved operator/reviewer pool'), 'guid-d549eda839107522');
  [...p.operators, ...p.reviewers].forEach(a => id(a, 'account'));
  if (!p.owners || Array.isArray(p.owners) || typeof p.owners !== 'object' || Object.keys(p.owners).length > 1000) throw guidanceError(new Error('Invalid host-verified owners'), 'guid-2f69c4d30d6e0419');
  for (const [account, owner] of Object.entries(p.owners)) { id(account, 'account'); id(owner, 'owner'); }
  if (!Object.hasOwn(p.owners, p.treasury) || p.reviewers.some(a => !Object.hasOwn(p.owners, a))) throw guidanceError(new Error('Treasury and reviewers require approved owners'), 'guid-56b5b1a0360fd489');
  if (new Set(Object.values(p.owners)).size > 10) throw guidanceError(new Error('Pilot permits at most ten verified owners'), 'guid-4b9dbfe2bb8ac118');
  money(p.maxSupply, 1_000_000_000, true); money(p.minReward, p.maxSupply, true); money(p.maxReward, p.maxSupply, true);
  if (p.maxReward < p.minReward) throw guidanceError(new Error('Invalid reward range'), 'guid-e4be98455942a394');
  money(p.postingFee, p.maxSupply); money(p.reviewFee, p.maxSupply); money(p.dailySpend, p.maxSupply, true);
  money(p.dailyPosts, 100, true); money(p.openContracts, 100, true);
  if (p.treasuryWeeklyBudget !== undefined) money(p.treasuryWeeklyBudget, p.maxSupply, true);
  if (p.benchmarkPrograms !== undefined) {
    if (!Array.isArray(p.benchmarkPrograms) || p.benchmarkPrograms.length>100) throw guidanceError(Error('Invalid benchmark programs'), 'guid-e662dab5127f217c');
    const seen=new Set<string>();
    for(const b of p.benchmarkPrograms) {
      if(!b||typeof b!=='object'||Object.keys(b).some(k=>!['id','lineage','definitionFingerprint','criteriaFingerprint','participants','reward','maxWinners','cap','closesAt'].includes(k)))throw guidanceError(Error('Invalid benchmark program fields'), 'guid-6bf6c708486cc43e');
      id(b.id,'program');id(b.lineage,'lineage');if(seen.has(b.id))throw guidanceError(Error('Duplicate benchmark program'), 'guid-ccf3c720ec8e6141');seen.add(b.id);
      if(!/^[a-f0-9]{64}$/.test(b.definitionFingerprint)||!/^[a-f0-9]{64}$/.test(b.criteriaFingerprint))throw guidanceError(Error('Invalid benchmark fingerprint'), 'guid-adb11cc3fcb264ba');
      if(!Array.isArray(b.participants)||!b.participants.length||b.participants.length>100||new Set(b.participants).size!==b.participants.length)throw guidanceError(Error('Invalid benchmark participants'), 'guid-0e5f391f7f9b9c26');
      for(const a of b.participants){id(a,'participant');if(!Object.hasOwn(p.owners,a))throw guidanceError(Error('Unapproved benchmark participant'), 'guid-f9f408bb8d262d53');}
      money(b.reward,p.maxSupply,true);money(b.maxWinners,b.participants.length,true);money(b.cap,p.maxSupply,true);date(b.closesAt);
      if(b.reward*b.maxWinners>b.cap)throw guidanceError(Error('Benchmark cap cannot cover declared winners'), 'guid-dbae1e085bb9d2ae');
    }
  }
  return structuredClone(p);
}
function artifacts(value: unknown): QuestArtifact[] {
  if (!Array.isArray(value) || !value.length || value.length > 8) throw guidanceError(new Error('One to eight exact artifacts are required'), 'guid-5388aafc71ca2e20');
  const result = value.map(a => {
    if (!a || typeof a.path !== 'string' || a.path.length > 500 || !a.path || !/^[a-f0-9]{64}$/.test(a.revision)) throw guidanceError(new Error('Artifact path and exact revision are required'), 'guid-4b986c8b9b3880fd');
    return { path: a.path, revision: a.revision };
  });
  if (new Set(result.map(a => a.path)).size !== result.length) throw guidanceError(new Error('Duplicate artifact'), 'guid-bec290e31a5f11fd');
  return result;
}
function normalizeTerms(t: QuestTerms | undefined, p: EconomyPolicy, at: string): QuestTerms {
  if (!t) throw guidanceError(new Error('Contract terms are required'), 'guid-8d4a078c61c2d4fa');
  id(t.taskId, 'taskId');
  if (!/^[a-f0-9]{64}$/.test(t.taskRevision)) throw guidanceError(new Error('Task revision is required'), 'guid-c03191651019cd8f');
  const title = textField(t.title, 'title', 180, true);
  const list = (v: unknown, required: boolean) => {
    if (!Array.isArray(v) || v.length > 12 || (required && !v.length)) throw guidanceError(new Error('Bounded completion criteria/exclusions are required'), 'guid-4e59028ab2cc1278');
    return v.map(s => textField(s, 'criterion', 500, true));
  };
  const reward = money(t.reward, p.maxReward, true);
  if (reward < p.minReward) throw guidanceError(new Error('Reward is below pilot minimum'), 'guid-c1523c772830e5c8');
  if (!['research', 'creative', 'mechanical'].includes(t.kind)) throw guidanceError(new Error('Invalid contract kind'), 'guid-d202b5d771132d47');
  if (t.kind !== 'mechanical' && (!p.subjectiveReview || !p.reviewers.length)) throw guidanceError(new Error('An operational independent reviewer pool is required'), 'guid-0fa7d2e10f7dd241');
  const deadline = date(t.deadline);
  if (deadline <= at) throw guidanceError(new Error('Contract deadline must be in the future'), 'guid-0fce1d49dff4c93d');
  const verifier = textField(t.verifier, 'verifier version', 128, true);
  return { taskId: t.taskId, taskRevision: t.taskRevision, title, criteria: list(t.criteria,true), exclusions: list(t.exclusions,false), reward, kind: t.kind, deadline, verifier };
}
export function assertEconomyConservation(s: EconomyState): void {
  const available = Object.values(s.balances).reduce((n,v) => n + money(v), 0);
  const escrow = Object.values(s.contracts).reduce((n,c) => n + money(c.escrow), 0);
  if (!Number.isSafeInteger(available + escrow) || available + escrow !== money(s.issued)) throw guidanceError(new Error('Economy conservation invariant failed; writes suspended'), 'guid-f471ecbe16edf63f');
}
/** Deterministic transitions. Policy and original command accompany each journal event.
 * Live permission, visible exact artifacts and trusted verifier checks belong to the
 * adapter immediately before this reducer, never to caller-authored receipts. */
export function economyRetry(state:EconomyState,command:EconomyCommand):EconomyReceipt|undefined {
  const actor=id(command.actor,'actor'),requestId=textField(command.requestId,'requestId',128,true);
  const prior=state.requests[fingerprint({actor,requestId})];
  if(!prior)return;
  if(prior.payload!==fingerprint(command))throw guidanceError(new Error('requestId already used with a different payload'), 'guid-e4113e04ec49a0bc');
  return structuredClone(prior.result);
}
/** Shared read-only owner/deadline/WIP gate. Projection callers compute busy
 * once, without cloning/reducing the complete financial history per candidate. */
export function questClaimAuthority(contract:QuestContract,worker:string,p:EconomyPolicy,at:string,busy:boolean,recovering=false) {
  const workerOwner=Object.hasOwn(p.owners,worker)?p.owners[worker]:undefined;
  if(!workerOwner||workerOwner===contract.requesterOwner)throw guidanceError(new Error('Worker must have a distinct approved owner'), 'guid-0a88b822fa272636');
  if(!recovering&&contract.terms.deadline<=at)throw guidanceError(new Error('Contract expired'), 'guid-06cef6678f013808');
  if(busy)throw guidanceError(new Error('Owner paid WIP limit is one'), 'guid-e764788572d74944');
  const reviewer=contract.terms.kind==='mechanical'?undefined:p.reviewers.find(a=>p.owners[a]!==workerOwner&&p.owners[a]!==contract.requesterOwner);
  if(contract.terms.kind!=='mechanical'&&(!p.subjectiveReview||!reviewer))throw guidanceError(new Error('Independent approved reviewer unavailable'), 'guid-2626531590e33b5c');
  return {workerOwner,reviewer};
}
export function applyEconomyCommand(input: EconomyState, command: EconomyCommand, rawPolicy: EconomyPolicy, now: string, trustedBenchmarkAuthority?:()=>void): { state: EconomyState; receipt: EconomyReceipt } {
  const p = validateEconomyPolicy(rawPolicy); const at = date(now);
  if (!p.enabled) throw guidanceError(new Error('Economy is disabled'), 'guid-d182c7129828d67a');
  const actor = id(command.actor, 'actor');
  const requestId = textField(command.requestId, 'requestId', 128, true);
  const payload = fingerprint(command); const key = fingerprint({ actor, requestId });
  const admin = p.operators.includes(actor);
  if (['reserve_program','award_program','close_program','cancel_program'].includes(command.op)) {
    if(typeof trustedBenchmarkAuthority!=='function')throw guidanceError(Error('Trusted benchmark authority required'), 'guid-008b7f34aedd8eb3');
    trustedBenchmarkAuthority();
  }
  const owner = Object.hasOwn(p.owners, actor) ? p.owners[actor] : undefined;
  if (!owner && !admin) throw guidanceError(new Error('Host-approved economic owner is required'), 'guid-1e74aaa7d6649083');
  if (['issue','allocate','resolve','recover_claim','reserve_program','close_program','cancel_program'].includes(command.op) && !admin) throw guidanceError(new Error('Host operator approval required'), 'guid-6c38064d6f638816');
  const prior = economyRetry(input,command);
  if (prior) return { state: input, receipt: prior };
  assertEconomyConservation(input);
  const state = structuredClone(input);
  const add = (account: string, delta: number) => {
    if (!Number.isSafeInteger(delta)) throw guidanceError(new Error('Invalid posting'), 'guid-5adffc6d08ead3e4');
    const current = Object.hasOwn(state.balances,account) ? state.balances[account]! : 0;
    state.balances[account] = money(current + delta);
  };
  let contract: QuestContract | undefined;
  const reserved=()=>Object.values(state.programs??{}).reduce((sum,b)=>sum+money(b.remaining),0);
  if (command.op === 'issue') {
    const amount = money(command.amount, p.maxSupply, true); textField(command.reason, 'issuance reason', 500, true);
    if(state.issued+reserved()+amount>p.maxSupply)throw guidanceError(Error('Supply headroom is reserved'), 'guid-e1a56ec813f3d527');
    state.issued = money(state.issued + amount, p.maxSupply); add(p.treasury, amount);
  } else if (['reserve_program','award_program','close_program','cancel_program'].includes(command.op)) {
    const programId=id(command.programId,'programId');
    state.programs??=Object.create(null);state.benchmarkAwards??=Object.create(null);
    let program=state.programs![programId];
    if(command.op==='reserve_program') {
      const terms=p.benchmarkPrograms?.find(b=>b.id===programId);
      if(!terms||program||command.expectedRevision!=='missing')throw guidanceError(Error('Approved new program and missing revision required'), 'guid-0b1bddb83b217abf');
      if(command.programFingerprint!==undefined&&command.programFingerprint!==economyRevision(terms))throw guidanceError(Error('Approved program terms fingerprint differs'), 'guid-baf7eb5f4b22bd6c');
      if(date(terms.closesAt)<=at)throw guidanceError(Error('Program deadline passed'), 'guid-b0efe331df4ba349');
      if(state.issued+reserved()+terms.cap>p.maxSupply)throw guidanceError(Error('Insufficient supply headroom for reservation'), 'guid-f0c60e11e59b54ed');
      program={terms:structuredClone(terms),remaining:terms.cap,awarded:0,closed:false};state.programs![programId]=program;
    } else {
      if(!program||program.closed)throw guidanceError(Error('Program closed or unavailable'), 'guid-3273516b308e0939');
      if(command.op==='close_program'||command.op==='cancel_program') {
        if(command.expectedRevision!==economyRevision(program))throw guidanceError(Error('Program revision conflict'), 'guid-6d1694a08655af0a');
        if(command.op==='close_program'&&date(program.terms.closesAt)>at)throw guidanceError(Error('Program close deadline not reached'), 'guid-6f788df0a40f2d23');
        if(command.op==='cancel_program')program.cancellation={actor,at,reason:textField(command.reason,'cancellation reason',1000,true)};
        program.closed=true;program.remaining=0;
      } else {
        const a=command.award,t=program.terms;
        if(a&&Object.keys(a).some(k=>!['programId','account','definitionFingerprint','criteriaFingerprint','adjudicationRevision'].includes(k)))throw guidanceError(Error('Invalid award proof fields'), 'guid-bdf5076e78db6e33');
        if(!a||a.programId!==programId||a.account!==actor||a.definitionFingerprint!==t.definitionFingerprint||a.criteriaFingerprint!==t.criteriaFingerprint||!/^[a-f0-9]{64}$/.test(a.adjudicationRevision))throw guidanceError(Error('Invalid trusted award basis'), 'guid-f735762dbea87f28');
        if(!t.participants.includes(a.account)||!Object.hasOwn(p.owners,a.account))throw guidanceError(Error('Unapproved award participant'), 'guid-f96bc759251195c3');
        const awardKey=economyRevision({lineage:t.lineage,account:a.account});
        if(state.benchmarkAwards![awardKey])throw guidanceError(Error('Account already awarded once for lineage'), 'guid-705ad09fba4c0d87');
        if(program.awarded>=t.maxWinners||program.remaining<t.reward)throw guidanceError(Error('Program reward budget exhausted'), 'guid-30d92b233b5372f8');
        program.remaining-=t.reward;program.awarded++;state.issued=money(state.issued+t.reward,p.maxSupply);add(a.account,t.reward);
        state.benchmarkAwards![awardKey]={programId,account:a.account};
      }
    }
    if(state.issued+reserved()>p.maxSupply)throw guidanceError(Error('Supply and reservations exceed approved cap'), 'guid-55ba05422d327dfe');
  } else if (command.op === 'allocate') {
    const account = id(command.account, 'account');
    if (!Object.hasOwn(p.owners,account)) throw guidanceError(new Error('Recipient needs approved owner'), 'guid-6124f4c9b478811a');
    const amount = money(command.amount,p.maxSupply,true); textField(command.reason,'budget reason',500,true);
    if (account === p.treasury) throw guidanceError(new Error('Treasury cannot allocate to itself'), 'guid-cee4bc6711f7d4bc');
    reserveTreasuryBudget(state,p,at,amount);
    add(p.treasury, -amount); add(account, amount);
  } else {
    const contractId = id(command.contractId, 'contractId');
    contract = Object.hasOwn(state.contracts,contractId) ? state.contracts[contractId] : undefined;
    if (command.op === 'draft') {
      if (!owner || contract || command.expectedRevision !== 'missing') throw guidanceError(new Error('New contract requires expectedRevision=missing and approved owner'), 'guid-20c8d4a791cabc19');
      if (Object.values(state.contracts).filter(c=>c.requesterOwner===owner && !['settled','cancelled'].includes(c.status)).length >= p.openContracts) throw guidanceError(new Error('Owner open-contract limit reached'), 'guid-fc97403792db51da');
      const terms = normalizeTerms(command.terms,p,at);
      if (terms.kind !== 'mechanical') assertSubjectiveAdmission(state,at);
      if (Object.values(state.contracts).some(c=>c.terms.taskId===terms.taskId && !['cancelled','settled'].includes(c.status))) throw guidanceError(new Error('Task already has a nonterminal contract'), 'guid-f04b67d410cc44b9');
      contract = { id:contractId,requester:actor,requesterOwner:owner,terms,policyRevision:p.revision,
        postingFee:p.postingFee,reviewFee:terms.kind==='mechanical'?0:p.reviewFee,escrow:0,status:'draft',generation:0,createdAt:at,updatedAt:at,revisionRequests:0 };
      state.contracts[contractId] = contract;
    } else {
      if (!contract) throw guidanceError(new Error('Contract unavailable'), 'guid-5173cd783894e32a');
      if (command.expectedRevision !== economyRevision(contract)) throw guidanceError(new Error('Contract revision conflict'), 'guid-0dbd8b8afb18051c');
      if (contract.requesterOwner !== p.owners[contract.requester] || (contract.worker && contract.workerOwner !== p.owners[contract.worker]) || (contract.reviewer && contract.reviewerOwner !== p.owners[contract.reviewer])) throw guidanceError(new Error('Economic owner binding changed; host recovery required'), 'guid-487a86103bd5daa5');
      const requester = () => { if (actor !== contract!.requester) throw guidanceError(new Error('Only requester may perform this transition'), 'guid-e6f37592405ac9ef'); };
      const status = (...allowed: QuestContract['status'][]) => { if (!allowed.includes(contract!.status)) throw guidanceError(new Error('Contract state does not allow this operation'), 'guid-430e382a4372ed28'); };
      const generation = () => { if (command.expectedGeneration !== contract!.generation) throw guidanceError(new Error('Revoked claim generation'), 'guid-e6042ccfc84b07f2'); };
      const settle = (payment: number, reviewPayment: boolean) => {
        const fee = reviewPayment && contract!.reviewer ? contract!.reviewFee : 0;
        if (payment > 0 && !contract!.worker) throw guidanceError(new Error('Worker missing'), 'guid-509305c8a0a22c8c');
        money(payment,contract!.terms.reward);
        const refund = contract!.escrow - payment - fee;
        if (refund < 0) throw guidanceError(new Error('Escrow insufficient'), 'guid-cb6612056d7752c4');
        if (payment) add(contract!.worker!, payment);
        if (fee) add(contract!.reviewer!, fee);
        add(contract!.requester,refund); contract!.escrow=0; contract!.status='settled';
      };
      switch(command.op) {
        case 'fund': {
          requester(); status('draft');
          if (contract.terms.deadline<=at) throw guidanceError(new Error('Contract expired before funding'), 'guid-a892a46f106f8aee');
          if (contract.policyRevision!==p.revision) throw guidanceError(new Error('Funding policy changed; create a new draft'), 'guid-3ae42a7be37f54f2');
          if (contract.terms.kind !== 'mechanical') assertSubjectiveAdmission(state,at);
          const existing = Object.values(state.contracts).filter(c=>c.requesterOwner===owner && c.fundedAt?.slice(0,10)===at.slice(0,10));
          const cost=contract.terms.reward+contract.reviewFee+contract.postingFee;
          if (existing.length>=p.dailyPosts || existing.reduce((sum,c)=>sum+c.terms.reward+c.reviewFee+c.postingFee,0)+cost>p.dailySpend) throw guidanceError(new Error('Owner daily posting/spend budget reached'), 'guid-281ba3ec7b54784b');
          if(actor===p.treasury) reserveTreasuryBudget(state,p,at,contract.terms.reward+contract.reviewFee);
          add(actor,-cost); add(p.treasury,contract.postingFee); contract.escrow=contract.terms.reward+contract.reviewFee; contract.status='funded'; contract.fundedAt=at;
          break;
        }
        case 'recover_claim':
        case 'claim': {
          status('funded'); generation();
          const recovering=command.op==='recover_claim';
          const worker=recovering?id(command.account,'recovered worker'):actor;
          const busy=Object.values(state.contracts).some(c=>c.workerOwner===p.owners[worker]&&['claimed','submitted','changes_requested','disputed'].includes(c.status));
          const {workerOwner,reviewer}=questClaimAuthority(contract,worker,p,at,busy,recovering);
          if(recovering) {
            if(!command.workBinding)throw guidanceError(new Error('Exact Work recovery binding required'), 'guid-1fc239dcabb6675c');
            contract.claimRecovery={operator:actor,reason:textField(command.reason,'recovery reason',1000,true),at,requestId};
          }
          if (reviewer) {
            contract.reviewer=reviewer; contract.reviewerOwner=p.owners[reviewer]!;
          }
          if(command.workBinding) {
            const b=command.workBinding;
            if(!/^[a-f0-9]{64}$/.test(b.revision)||!Number.isSafeInteger(b.generation)||b.generation<1||!b.requestId)throw guidanceError(new Error('Invalid Work binding'), 'guid-11c9fd67e71c3609');
            contract.workBinding=structuredClone(b);
          }
          contract.worker=worker; contract.workerOwner=workerOwner; contract.generation++; contract.status='claimed'; break;
        }
        case 'submit': {
          status('claimed','changes_requested'); generation();
          if (actor!==contract.worker) throw guidanceError(new Error('Only current worker may submit'), 'guid-0b4fc994d1cfc705');
          if (contract.terms.deadline<at) throw guidanceError(new Error('Late submission needs operator attention; escrow remains held'), 'guid-95f7f6523a92d9fd');
          const submitted = artifacts(command.artifacts);
          contract.submission={artifacts:submitted,basis:fingerprint({terms:contract.terms,generation:contract.generation,artifacts:submitted}),at};
          delete contract.review; contract.status='submitted'; break;
        }
        case 'cancel':
          requester(); status('draft','funded'); add(actor,contract.escrow); contract.escrow=0; contract.status='cancelled'; break;
        case 'review': {
          status('submitted'); generation();
          if (actor!==contract.reviewer || !p.reviewers.includes(actor) || owner===contract.requesterOwner || owner===contract.workerOwner) throw guidanceError(new Error('Assigned independent reviewer required'), 'guid-f78a9b487e7e5b53');
          if (command.basis!==contract.submission?.basis) throw guidanceError(new Error('Submission basis changed'), 'guid-884b87db18b05cf9');
          const reason=textField(command.reason,'review reason',1000,true);
          if (!['approve','changes_requested','dispute'].includes(command.verdict || '')) throw guidanceError(new Error('Invalid verdict'), 'guid-cdb1c2db3e92dee0');
          const artifact=artifacts([command.reviewArtifact])[0]!;
          contract.review={actor,verdict:command.verdict!,reason,artifact,basis:command.basis!,at};
          if (command.verdict==='approve') settle(contract.terms.reward,true);
          else if (command.verdict==='changes_requested') {
            if (contract.revisionRequests>=1) throw guidanceError(new Error('Agreed revision limit reached; request dispute review'), 'guid-a2d340858f2a0513');
            contract.revisionRequests++; contract.status='changes_requested';
          } else { contract.status='disputed'; contract.disputeReason=reason; }
          break;
        }
        case 'dispute':
          status('claimed','submitted','changes_requested'); generation();
          if (![contract.requester,contract.worker,contract.reviewer].includes(actor)) throw guidanceError(new Error('Contract participant required'), 'guid-8c1b15ba3f056f63');
          contract.disputeReason=textField(command.reason,'dispute reason',1000,true); contract.status='disputed'; break;
        case 'resolve':
          status('claimed','submitted','changes_requested','disputed'); generation();
          textField(command.reason,'operator adjudication reason',1000,true);
          if (command.amount! > 0 && !contract.submission) throw guidanceError(new Error('Payout requires fixed submitted artifacts'), 'guid-c81583538cf5e180');
          settle(money(command.amount,contract.terms.reward),Boolean(contract.review)); break;
        default: throw guidanceError(new Error('Unsupported economy operation'), 'guid-5f5a3c10a7656317');
      }
      contract.updatedAt=at;
    }
  }
  state.sequence++; assertEconomyConservation(state);
  const receipt: EconomyReceipt={transactionId:fingerprint({sequence:state.sequence,payload,at}),sequence:state.sequence,
    ...(contract && {contractId:contract.id,revision:economyRevision(contract),status:contract.status})};
  state.requests[key]={payload,result:receipt};
  return {state,receipt};
}
