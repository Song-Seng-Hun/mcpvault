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
}
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
  op: 'issue' | 'allocate' | 'draft' | 'fund' | 'claim' | 'recover_claim' | 'submit' | 'cancel' | 'review' | 'dispute' | 'resolve';
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
}
export const economyRevision = (value: unknown): string => fingerprint(value);
export const initialEconomy = (): EconomyState => ({ issued: 0, sequence: 0, balances: Object.create(null), contracts: Object.create(null), requests: Object.create(null) });
const id = (s: unknown, field: string) => {
  if (typeof s !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(s)) throw new Error(`Invalid ${field}`);
  const normalized=normalizeScopeId(s, field);
  if(normalized!==s)throw new Error(`Invalid ${field}: use its canonical lowercase identifier`);
  return normalized;
};
function money(n: unknown, max = 1_000_000_000, positive = false): number {
  if (!Number.isSafeInteger(n) || Number(n) < (positive ? 1 : 0) || Number(n) > max) throw new Error('XP must be a bounded nonnegative integer');
  return Number(n);
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('A precise UTC timestamp is required');
  const canonical = new Date(value).toISOString();
  if (canonical !== value.replace(/(?<=\d\d)Z$/, '.000Z') && canonical !== value) throw new Error('Invalid calendar timestamp');
  return canonical;
}
export function validateEconomyPolicy(p: EconomyPolicy): EconomyPolicy {
  if (!p || p.version !== 1 || typeof p.enabled !== 'boolean' || typeof p.subjectiveReview !== 'boolean') throw new Error('Invalid economy policy');
  textField(p.revision, 'policy revision', 128, true); id(p.treasury, 'treasury');
  if (!Array.isArray(p.operators) || !p.operators.length || p.operators.length > 20 || !Array.isArray(p.reviewers) || p.reviewers.length > 100) throw new Error('Invalid approved operator/reviewer pool');
  [...p.operators, ...p.reviewers].forEach(a => id(a, 'account'));
  if (!p.owners || Array.isArray(p.owners) || typeof p.owners !== 'object' || Object.keys(p.owners).length > 1000) throw new Error('Invalid host-verified owners');
  for (const [account, owner] of Object.entries(p.owners)) { id(account, 'account'); id(owner, 'owner'); }
  if (!Object.hasOwn(p.owners, p.treasury) || p.reviewers.some(a => !Object.hasOwn(p.owners, a))) throw new Error('Treasury and reviewers require approved owners');
  if (new Set(Object.values(p.owners)).size > 10) throw new Error('Pilot permits at most ten verified owners');
  money(p.maxSupply, 1_000_000_000, true); money(p.minReward, p.maxSupply, true); money(p.maxReward, p.maxSupply, true);
  if (p.maxReward < p.minReward) throw new Error('Invalid reward range');
  money(p.postingFee, p.maxSupply); money(p.reviewFee, p.maxSupply); money(p.dailySpend, p.maxSupply, true);
  money(p.dailyPosts, 100, true); money(p.openContracts, 100, true);
  if (p.treasuryWeeklyBudget !== undefined) money(p.treasuryWeeklyBudget, p.maxSupply, true);
  return structuredClone(p);
}
function artifacts(value: unknown): QuestArtifact[] {
  if (!Array.isArray(value) || !value.length || value.length > 8) throw new Error('One to eight exact artifacts are required');
  const result = value.map(a => {
    if (!a || typeof a.path !== 'string' || a.path.length > 500 || !a.path || !/^[a-f0-9]{64}$/.test(a.revision)) throw new Error('Artifact path and exact revision are required');
    return { path: a.path, revision: a.revision };
  });
  if (new Set(result.map(a => a.path)).size !== result.length) throw new Error('Duplicate artifact');
  return result;
}
function normalizeTerms(t: QuestTerms | undefined, p: EconomyPolicy, at: string): QuestTerms {
  if (!t) throw new Error('Contract terms are required');
  id(t.taskId, 'taskId');
  if (!/^[a-f0-9]{64}$/.test(t.taskRevision)) throw new Error('Task revision is required');
  const title = textField(t.title, 'title', 180, true);
  const list = (v: unknown, required: boolean) => {
    if (!Array.isArray(v) || v.length > 12 || (required && !v.length)) throw new Error('Bounded completion criteria/exclusions are required');
    return v.map(s => textField(s, 'criterion', 500, true));
  };
  const reward = money(t.reward, p.maxReward, true);
  if (reward < p.minReward) throw new Error('Reward is below pilot minimum');
  if (!['research', 'creative', 'mechanical'].includes(t.kind)) throw new Error('Invalid contract kind');
  if (t.kind !== 'mechanical' && (!p.subjectiveReview || !p.reviewers.length)) throw new Error('An operational independent reviewer pool is required');
  const deadline = date(t.deadline);
  if (deadline <= at) throw new Error('Contract deadline must be in the future');
  const verifier = textField(t.verifier, 'verifier version', 128, true);
  return { taskId: t.taskId, taskRevision: t.taskRevision, title, criteria: list(t.criteria,true), exclusions: list(t.exclusions,false), reward, kind: t.kind, deadline, verifier };
}
export function assertEconomyConservation(s: EconomyState): void {
  const available = Object.values(s.balances).reduce((n,v) => n + money(v), 0);
  const escrow = Object.values(s.contracts).reduce((n,c) => n + money(c.escrow), 0);
  if (!Number.isSafeInteger(available + escrow) || available + escrow !== money(s.issued)) throw new Error('Economy conservation invariant failed; writes suspended');
}
/** Deterministic transitions. Policy and original command accompany each journal event.
 * Live permission, visible exact artifacts and trusted verifier checks belong to the
 * adapter immediately before this reducer, never to caller-authored receipts. */
export function economyRetry(state:EconomyState,command:EconomyCommand):EconomyReceipt|undefined {
  const actor=id(command.actor,'actor'),requestId=textField(command.requestId,'requestId',128,true);
  const prior=state.requests[fingerprint({actor,requestId})];
  if(!prior)return;
  if(prior.payload!==fingerprint(command))throw new Error('requestId already used with a different payload');
  return structuredClone(prior.result);
}
/** Shared read-only owner/deadline/WIP gate. Projection callers compute busy
 * once, without cloning/reducing the complete financial history per candidate. */
export function questClaimAuthority(contract:QuestContract,worker:string,p:EconomyPolicy,at:string,busy:boolean,recovering=false) {
  const workerOwner=Object.hasOwn(p.owners,worker)?p.owners[worker]:undefined;
  if(!workerOwner||workerOwner===contract.requesterOwner)throw new Error('Worker must have a distinct approved owner');
  if(!recovering&&contract.terms.deadline<=at)throw new Error('Contract expired');
  if(busy)throw new Error('Owner paid WIP limit is one');
  const reviewer=contract.terms.kind==='mechanical'?undefined:p.reviewers.find(a=>p.owners[a]!==workerOwner&&p.owners[a]!==contract.requesterOwner);
  if(contract.terms.kind!=='mechanical'&&(!p.subjectiveReview||!reviewer))throw new Error('Independent approved reviewer unavailable');
  return {workerOwner,reviewer};
}
export function applyEconomyCommand(input: EconomyState, command: EconomyCommand, rawPolicy: EconomyPolicy, now: string): { state: EconomyState; receipt: EconomyReceipt } {
  const p = validateEconomyPolicy(rawPolicy); const at = date(now);
  if (!p.enabled) throw new Error('Economy is disabled');
  const actor = id(command.actor, 'actor');
  const requestId = textField(command.requestId, 'requestId', 128, true);
  const payload = fingerprint(command); const key = fingerprint({ actor, requestId });
  const admin = p.operators.includes(actor);
  const owner = Object.hasOwn(p.owners, actor) ? p.owners[actor] : undefined;
  if (!owner && !admin) throw new Error('Host-approved economic owner is required');
  if (['issue','allocate','resolve','recover_claim'].includes(command.op) && !admin) throw new Error('Host operator approval required');
  const prior = economyRetry(input,command);
  if (prior) return { state: input, receipt: prior };
  assertEconomyConservation(input);
  const state = structuredClone(input);
  const add = (account: string, delta: number) => {
    if (!Number.isSafeInteger(delta)) throw new Error('Invalid posting');
    const current = Object.hasOwn(state.balances,account) ? state.balances[account]! : 0;
    state.balances[account] = money(current + delta);
  };
  let contract: QuestContract | undefined;
  if (command.op === 'issue') {
    const amount = money(command.amount, p.maxSupply, true); textField(command.reason, 'issuance reason', 500, true);
    state.issued = money(state.issued + amount, p.maxSupply); add(p.treasury, amount);
  } else if (command.op === 'allocate') {
    const account = id(command.account, 'account');
    if (!Object.hasOwn(p.owners,account)) throw new Error('Recipient needs approved owner');
    const amount = money(command.amount,p.maxSupply,true); textField(command.reason,'budget reason',500,true);
    if (account === p.treasury) throw new Error('Treasury cannot allocate to itself');
    reserveTreasuryBudget(state,p,at,amount);
    add(p.treasury, -amount); add(account, amount);
  } else {
    const contractId = id(command.contractId, 'contractId');
    contract = Object.hasOwn(state.contracts,contractId) ? state.contracts[contractId] : undefined;
    if (command.op === 'draft') {
      if (!owner || contract || command.expectedRevision !== 'missing') throw new Error('New contract requires expectedRevision=missing and approved owner');
      if (Object.values(state.contracts).filter(c=>c.requesterOwner===owner && !['settled','cancelled'].includes(c.status)).length >= p.openContracts) throw new Error('Owner open-contract limit reached');
      const terms = normalizeTerms(command.terms,p,at);
      if (terms.kind !== 'mechanical') assertSubjectiveAdmission(state,at);
      if (Object.values(state.contracts).some(c=>c.terms.taskId===terms.taskId && !['cancelled','settled'].includes(c.status))) throw new Error('Task already has a nonterminal contract');
      contract = { id:contractId,requester:actor,requesterOwner:owner,terms,policyRevision:p.revision,
        postingFee:p.postingFee,reviewFee:terms.kind==='mechanical'?0:p.reviewFee,escrow:0,status:'draft',generation:0,createdAt:at,updatedAt:at,revisionRequests:0 };
      state.contracts[contractId] = contract;
    } else {
      if (!contract) throw new Error('Contract unavailable');
      if (command.expectedRevision !== economyRevision(contract)) throw new Error('Contract revision conflict');
      if (contract.requesterOwner !== p.owners[contract.requester] || (contract.worker && contract.workerOwner !== p.owners[contract.worker]) || (contract.reviewer && contract.reviewerOwner !== p.owners[contract.reviewer])) throw new Error('Economic owner binding changed; host recovery required');
      const requester = () => { if (actor !== contract!.requester) throw new Error('Only requester may perform this transition'); };
      const status = (...allowed: QuestContract['status'][]) => { if (!allowed.includes(contract!.status)) throw new Error('Contract state does not allow this operation'); };
      const generation = () => { if (command.expectedGeneration !== contract!.generation) throw new Error('Revoked claim generation'); };
      const settle = (payment: number, reviewPayment: boolean) => {
        const fee = reviewPayment && contract!.reviewer ? contract!.reviewFee : 0;
        if (payment > 0 && !contract!.worker) throw new Error('Worker missing');
        money(payment,contract!.terms.reward);
        const refund = contract!.escrow - payment - fee;
        if (refund < 0) throw new Error('Escrow insufficient');
        if (payment) add(contract!.worker!, payment);
        if (fee) add(contract!.reviewer!, fee);
        add(contract!.requester,refund); contract!.escrow=0; contract!.status='settled';
      };
      switch(command.op) {
        case 'fund': {
          requester(); status('draft');
          if (contract.terms.deadline<=at) throw new Error('Contract expired before funding');
          if (contract.policyRevision!==p.revision) throw new Error('Funding policy changed; create a new draft');
          if (contract.terms.kind !== 'mechanical') assertSubjectiveAdmission(state,at);
          const existing = Object.values(state.contracts).filter(c=>c.requesterOwner===owner && c.fundedAt?.slice(0,10)===at.slice(0,10));
          const cost=contract.terms.reward+contract.reviewFee+contract.postingFee;
          if (existing.length>=p.dailyPosts || existing.reduce((sum,c)=>sum+c.terms.reward+c.reviewFee+c.postingFee,0)+cost>p.dailySpend) throw new Error('Owner daily posting/spend budget reached');
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
            if(!command.workBinding)throw new Error('Exact Work recovery binding required');
            contract.claimRecovery={operator:actor,reason:textField(command.reason,'recovery reason',1000,true),at,requestId};
          }
          if (reviewer) {
            contract.reviewer=reviewer; contract.reviewerOwner=p.owners[reviewer]!;
          }
          if(command.workBinding) {
            const b=command.workBinding;
            if(!/^[a-f0-9]{64}$/.test(b.revision)||!Number.isSafeInteger(b.generation)||b.generation<1||!b.requestId)throw new Error('Invalid Work binding');
            contract.workBinding=structuredClone(b);
          }
          contract.worker=worker; contract.workerOwner=workerOwner; contract.generation++; contract.status='claimed'; break;
        }
        case 'submit': {
          status('claimed','changes_requested'); generation();
          if (actor!==contract.worker) throw new Error('Only current worker may submit');
          if (contract.terms.deadline<at) throw new Error('Late submission needs operator attention; escrow remains held');
          const submitted = artifacts(command.artifacts);
          contract.submission={artifacts:submitted,basis:fingerprint({terms:contract.terms,generation:contract.generation,artifacts:submitted}),at};
          delete contract.review; contract.status='submitted'; break;
        }
        case 'cancel':
          requester(); status('draft','funded'); add(actor,contract.escrow); contract.escrow=0; contract.status='cancelled'; break;
        case 'review': {
          status('submitted'); generation();
          if (actor!==contract.reviewer || !p.reviewers.includes(actor) || owner===contract.requesterOwner || owner===contract.workerOwner) throw new Error('Assigned independent reviewer required');
          if (command.basis!==contract.submission?.basis) throw new Error('Submission basis changed');
          const reason=textField(command.reason,'review reason',1000,true);
          if (!['approve','changes_requested','dispute'].includes(command.verdict || '')) throw new Error('Invalid verdict');
          const artifact=artifacts([command.reviewArtifact])[0]!;
          contract.review={actor,verdict:command.verdict!,reason,artifact,basis:command.basis!,at};
          if (command.verdict==='approve') settle(contract.terms.reward,true);
          else if (command.verdict==='changes_requested') {
            if (contract.revisionRequests>=1) throw new Error('Agreed revision limit reached; request dispute review');
            contract.revisionRequests++; contract.status='changes_requested';
          } else { contract.status='disputed'; contract.disputeReason=reason; }
          break;
        }
        case 'dispute':
          status('claimed','submitted','changes_requested'); generation();
          if (![contract.requester,contract.worker,contract.reviewer].includes(actor)) throw new Error('Contract participant required');
          contract.disputeReason=textField(command.reason,'dispute reason',1000,true); contract.status='disputed'; break;
        case 'resolve':
          status('claimed','submitted','changes_requested','disputed'); generation();
          textField(command.reason,'operator adjudication reason',1000,true);
          if (command.amount! > 0 && !contract.submission) throw new Error('Payout requires fixed submitted artifacts');
          settle(money(command.amount,contract.terms.reward),Boolean(contract.review)); break;
        default: throw new Error('Unsupported economy operation');
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
