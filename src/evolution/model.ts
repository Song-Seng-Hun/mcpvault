import type { ScopePrincipal } from '../scope-auth.js';
import type { HostWorkStorage } from '../host-work-storage.js';
import type { Evidence, Evaluation, Feedback, FeedbackProof, Scope, Target } from './policy.js';

export interface EvolutionConfig { version: 1; enabled: boolean }
export interface EvolutionLease {
  ownerId: string; revision: string; sharedOwner: boolean;
  /** Recheck actual actor, runtime, allowed scopes and current policy. Never trust model labels. */
  assertCurrent(): Promise<void>;
}
export interface ResourceSnapshot { revision: string; value: unknown }
export interface ApplyIntent { fingerprint: string; expectedRevision: string; data?: unknown }
export interface Cycle {
  version: 1; id: string; accountId: string; target: Target; scope: Scope;
  feedback: { id: string; revision: string }[]; basis: Evidence[]; authorityRevision: string;
  state: 'observed' | 'candidate' | 'evaluated' | 'applying' | 'reverting' | 'applied' | 'effect_verified' | 'review_required' | 'invalid' | 'withdrawn';
  baseline: ResourceSnapshot; candidate?: unknown; attempts: number; evaluation?: Evaluation; profileFingerprint?: string;
  reason?: string; intent?: ApplyIntent; outputRevision?: string; effect?: { taskId: string; sessionId: string; revision: string; success: boolean;
    method?: 'static' | 'synthetic' | 'agent_behavior' | 'operational'; source?: 'direct_user_review' };
  requests: { id: string; fingerprint: string }[];
}
export interface EvolutionAdapter {
  read(target: Target, principal: ScopePrincipal, feedback?: Feedback): Promise<ResourceSnapshot>;
  preview(cycle: Readonly<Cycle>, principal: ScopePrincipal, assertCurrent: () => Promise<void>): Promise<ApplyIntent>;
  apply(cycle: Readonly<Cycle>, principal: ScopePrincipal, assertCurrent: () => Promise<void>): Promise<{ revision: string }>;
  /** Must inspect actual owner-service receipts. unknown is not permission to retry. */
  reconcile(cycle: Readonly<Cycle>, principal: ScopePrincipal, assertCurrent: () => Promise<void>): Promise<{ state: 'applied' | 'unknown'; revision?: string }>;
  revert?(cycle: Readonly<Cycle>, principal: ScopePrincipal, assertCurrent: () => Promise<void>): Promise<{ revision: string }>;
  reconcileRevert?(cycle: Readonly<Cycle>, principal: ScopePrincipal, assertCurrent: () => Promise<void>): Promise<{ state: 'withdrawn' | 'unknown'; revision?: string }>;
}
export interface EvolutionOptions {
  storage?: HostWorkStorage<EvolutionConfig>; readOnly?: boolean; now?: () => number;
  /** Host-injected callback, never loaded from a skill, MCP argument, or arbitrary module path. */
  authority?(principal: ScopePrincipal, request: Readonly<Record<string, unknown>>): Promise<EvolutionLease>;
  attest?(token: string, principal: ScopePrincipal, feedback: unknown): Promise<FeedbackProof | undefined>;
  verifyEvidence?(evidence: readonly Evidence[], principal: ScopePrincipal): Promise<boolean>;
  adapters?: Partial<Record<Target['kind'], EvolutionAdapter>>;
  profile?(target: Target): { revision: string; caseIds: string[]; targetCaseIds: string[]; holdoutCaseIds: string[] } | undefined;
  evaluate?(cycle: Readonly<Cycle>, principal: ScopePrincipal, signal: AbortSignal): Promise<Evaluation>;
  proveUse?(token: string, cycle: Readonly<Cycle>, principal: ScopePrincipal): Promise<Cycle['effect']>;
}
export interface FeedbackRecord { version: 1; accountId: string; feedback: Feedback; request: { id: string; fingerprint: string } }
export interface IndexRecord { version: 1; feedback: string[]; cycles: string[] }
