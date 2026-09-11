import { guidanceError } from './guidance-runtime.js';
import { benchmarkId } from './benchmark-model.js';

export type BenchmarkInitiativeState = 'disabled' | 'pending_approval' | 'active' | 'empty' | 'unknown';
export interface BenchmarkCandidateLink { url: string; reason: string; reuse: 'verified_reusable' | 'unknown' }
export interface BenchmarkInitiativeHost {
 enabled: boolean;
 topic: string;
 /** Verified host identities; retained only in the existing private run receipt. */
 collectorAccounts: readonly string[];
 collectorOwnerIds: readonly string[];
 status(): Promise<{ busy: boolean; pendingApproval: boolean; inFlight: boolean }>;
 /** Existing host-wide atomic DURABLE execution receipt, shared by all accounts
  * and processes. Count reservation even on failure/interruption; never reset it.
  * The host must keep inFlight true until an aborted child actually stops. */
 reserveAttempt(params: { domain: 'benchmark-discovery'; day: string; maxAttempts: 1; maxDurationMs: 300000; deadline: string }): Promise<boolean>;
 finishAttempt(params: { domain: 'benchmark-discovery'; day: string; outcome: string; collectorAccounts: readonly string[]; collectorOwnerIds: readonly string[] }): Promise<void>;
 searchWiki(params: { query: string; urls?: string[]; limit: 3; maxChars: 2000; signal: AbortSignal }): Promise<{ state: 'clear' | 'pending' | 'unknown'; existingUrls: string[] }>;
 /** Host's existing public search connector, NOT an arbitrary fetch/exec hook.
  * No login, paid access, dataset/archive download, enumeration or answer body. */
 searchPublicLinks(params: { query: string; maxLinks: 3; publicOnly: true; linkOnly: true; signal: AbortSignal }): Promise<BenchmarkCandidateLink[]>;
 /** Existing Wiki capture + same-target revision reread. No candidate database.
  * Must check signal at its own durable boundary and use the run's retry key. */
 captureWiki(params: { candidates: Array<BenchmarkCandidateLink & { disposition: 'human_review' | 'link_only_hold' }>; pendingHumanApproval: true;
   requestId: string; signal: AbortSignal }): Promise<{ path: string; revision: string }>;
}

const FUNCTIONS = ['status', 'reserveAttempt', 'finishAttempt', 'searchWiki', 'searchPublicLinks', 'captureWiki'] as const;
function candidate(value: BenchmarkCandidateLink): BenchmarkCandidateLink & { disposition: 'human_review' | 'link_only_hold' } {
 if (!value || typeof value.url !== 'string' || value.url.length > 1000 || typeof value.reason !== 'string'
   || !value.reason.trim() || value.reason.length > 300 || /[\r\n\x00-\x1f]/.test(value.reason)
   || !['verified_reusable','unknown'].includes(value.reuse)) throw guidanceError(Error('Invalid bounded candidate link'), 'guid-a7757ec6aa818d40');
 const url = new URL(value.url);
 // Only public HTTPS links as data. The adapter never dereferences these URLs.
 if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443'
   || !url.hostname.includes('.') || /[\[\]:]/.test(url.hostname) || /^[\d.]+$/.test(url.hostname)
   || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) throw guidanceError(Error('Public link required'), 'guid-ac3420a7017518a2');
 return { url: url.href, reason: value.reason, reuse: value.reuse, disposition: value.reuse === 'unknown' ? 'link_only_hold' : 'human_review' };
}

/** Invoked ONLY by an existing approved host hook. This function installs no
 * scheduler, launches no model, creates no receipts store and opens no challenge.
 * Missing host integrations are an explicit inactive state, never simulated. */
export async function runBenchmarkInitiative(params: {
 host?: BenchmarkInitiativeHost;
 inspect: () => Promise<{ state: BenchmarkInitiativeState }>;
 trigger: 'session_start' | 'work_completion' | 'approved_heartbeat';
 now?: () => number;
}): Promise<Record<string, unknown>> {
 const host = params.host;
 if (!host || FUNCTIONS.some(key => typeof host[key] !== 'function') || typeof params.inspect !== 'function') return { state: 'host_capability_missing' };
 if (host.enabled !== true || !['session_start','work_completion','approved_heartbeat'].includes(params.trigger)) return { state: 'suppressed' };
 const now = params.now ?? Date.now;
 const safe = async () => {
  const status = await host.status();
  return status.busy === false && status.pendingApproval === false && status.inFlight === false && (await params.inspect()).state === 'empty';
 };
 let day: string, deadline: string;
 try {
  if (typeof host.topic !== 'string' || !host.topic.trim() || host.topic.length > 100) throw Error();
  for (const ids of [host.collectorAccounts,host.collectorOwnerIds]) {
   if (!Array.isArray(ids) || !ids.length || ids.length > 32 || new Set(ids).size !== ids.length) throw Error();
   ids.forEach(benchmarkId);
  }
  if (!await safe()) return { state: 'suppressed' };
  const started = now(); day = new Date(started).toISOString().slice(0,10); deadline = new Date(started + 300000).toISOString();
  if (await host.reserveAttempt({ domain:'benchmark-discovery',day,maxAttempts:1,maxDurationMs:300000,deadline }) !== true) return { state:'daily_budget_used' };
 } catch { return { state:'host_unavailable' }; }
 const controller = new AbortController();
 const guard = () => { if (controller.signal.aborted || now() >= Date.parse(deadline)) throw guidanceError(Error('deadline'), 'guid-082deefa6c903eaa'); };
 let timer: ReturnType<typeof setTimeout> | undefined;
 const timeout = new Promise<Record<string,unknown>>(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ state:'timed_out' }); }, Math.max(0,Date.parse(deadline)-now())); });
 const perform = async (): Promise<Record<string,unknown>> => {
  guard();
  const search = { query:host.topic,limit:3 as const,maxChars:2000 as const,signal:controller.signal };
  const prior = await host.searchWiki(search); guard();
  if (prior.state !== 'clear') return { state:'suppressed' };
  const links = await host.searchPublicLinks({ query:host.topic,maxLinks:3,publicOnly:true,linkOnly:true,signal:controller.signal }); guard();
  if (!Array.isArray(links) || links.length > 3) throw guidanceError(Error('Link budget exceeded'), 'guid-90e0e1a6bd2c445f');
  const candidates = links.map(candidate);
  const seen = await host.searchWiki({ ...search,urls:candidates.map(c=>c.url) }); guard();
  if (seen.state !== 'clear' || !Array.isArray(seen.existingUrls) || seen.existingUrls.length > 3) return { state:'suppressed' };
  const unique = candidates.filter((c,i) => candidates.findIndex(other=>other.url===c.url)===i && !seen.existingUrls.includes(c.url));
  if (!unique.length) return { state:'no_candidates' };
  // The host's own run may now be in flight; only other work/pending approval and
  // changed global problem state suppress this capture. No opening is performed.
  const current = await host.status(); guard();
  if (current.busy !== false || current.pendingApproval !== false || (await params.inspect()).state !== 'empty') return { state:'suppressed' };
  guard();
  const captured = await host.captureWiki({ candidates:unique,pendingHumanApproval:true,requestId:`benchmark-discovery:${day}`,signal:controller.signal }); guard();
  if (!captured || typeof captured.path !== 'string' || captured.path.length > 500 || !/^[a-f0-9]{64}$/.test(captured.revision)) throw guidanceError(Error('Verified capture required'), 'guid-d897bfa180b1b4fa');
  return { state:'pending_approval',candidateCount:unique.length,opening:'human_only' };
 };
 let result: Record<string,unknown>;
 try { result = await Promise.race([perform(),timeout]); }
 catch { result = { state:controller.signal.aborted || now() >= Date.parse(deadline) ? 'timed_out' : 'failed' }; }
 finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
 try { await host.finishAttempt({domain:'benchmark-discovery',day,outcome:String(result.state),collectorAccounts:host.collectorAccounts,collectorOwnerIds:host.collectorOwnerIds}); }
 catch { return { state:'receipt_reconciliation_required' }; }
 return result;
}
