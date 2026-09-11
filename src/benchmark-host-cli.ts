import { guidanceError } from './guidance-runtime.js';
import { isAbsolute } from 'node:path';
import { benchmarkId } from './benchmark-model.js';

export const BENCHMARK_HOST_USAGE = 'Host-only benchmark maintenance (stop the configured writer before mutations).\nUsage: node scripts/benchmark-host.mjs inspect|open|finalize|close|cancel|project|evidence <absolute-vault> <absolute-private-config> <human-operator> <challenge-id> [--expected-revision REV] [--request-id ID] [--expected-projection-revision REV] [--economy-config ABSOLUTE_FILE] [--reason TEXT]\nevidence additionally requires --entry-id ID --fields outcome,scores --shareable true (one or both fields). inspect and initiative-status are read-only. Global absence: node scripts/benchmark-host.mjs initiative-status <absolute-vault> <absolute-private-config> <human-operator>. A missing live ledger leaves rewarded settlement unknown. Mutation guards and approvals are never inferred; no model, account, answer/key file, wallet or supply cap is created.';
export interface BenchmarkHostArguments {
  operation: 'inspect' | 'open' | 'finalize' | 'close' | 'cancel' | 'project' | 'evidence' | 'initiative-status';
  vaultPath: string; configPath: string; actor: string; economyConfig?: string;
  params: Record<string, unknown>;
}
export function parseBenchmarkHostArgs(args: string[]): BenchmarkHostArguments {
  const [operation, vaultPath, configPath, actor, challengeId, ...tail] = args;
  if (operation === 'initiative-status') {
    if (args.length !== 4 || !vaultPath || !configPath || !actor || !isAbsolute(vaultPath) || !isAbsolute(configPath)) throw guidanceError(Error('initiative-status requires only absolute Vault/config paths and a human operator'), 'guid-f6e95d560d7b05c8');
    benchmarkId(actor);
    return { operation, vaultPath, configPath, actor, params: {} };
  }
  if (!['inspect', 'open', 'finalize', 'close', 'cancel', 'project', 'evidence'].includes(operation ?? '') || !vaultPath || !configPath || !actor || !challengeId) throw Error(BENCHMARK_HOST_USAGE);
  if (!isAbsolute(vaultPath) || !isAbsolute(configPath)) throw guidanceError(Error('Explicit absolute Vault and private configuration paths required'), 'guid-39edd1c8184c1ae9');
  benchmarkId(actor); benchmarkId(challengeId);
  const fields: Record<string, string> = {};
  for (let index = 0; index < tail.length; index += 2) {
    const key = tail[index]!, value = tail[index + 1];
    if (!['--expected-revision', '--request-id', '--expected-projection-revision', '--economy-config', '--reason', '--entry-id', '--fields', '--shareable'].includes(key)) throw guidanceError(Error('Unknown host option'), 'guid-d736b84efc34473b');
    if (Object.hasOwn(fields, key)) throw guidanceError(Error('Duplicate host option'), 'guid-c49f86d7253f3ad8');
    if (!value || value.startsWith('--')) throw guidanceError(Error('Host option value required'), 'guid-78328b0019933dc8');
    fields[key] = value;
  }
  if (operation === 'inspect' && tail.length) throw guidanceError(Error('Inspect accepts no mutation options'), 'guid-e06dfbdb32e28f89');
  const revision = (value: string | undefined) => Boolean(value && /^(missing|[a-f0-9]{64})$/.test(value));
  if (operation !== 'inspect' && (!revision(fields['--expected-revision']) || !fields['--request-id'] || fields['--request-id']!.length > 128)) throw guidanceError(Error('Explicit exact revision and bounded request ID required'), 'guid-9657b6b6dd4e9d0a');
  if (['project','evidence'].includes(operation!) && !revision(fields['--expected-projection-revision'])) throw guidanceError(Error('Exact projection revision or missing required'), 'guid-8b877c6e379f143e');
  if (!['project','evidence'].includes(operation!) && fields['--expected-projection-revision']) throw guidanceError(Error('Projection revision is only for project/evidence'), 'guid-de88371725e7a0d0');
  if (operation === 'evidence') {
    if (fields['--shareable'] !== 'true') throw guidanceError(Error('Explicit --shareable true approval required'), 'guid-8f3b1456bec1194c');
    benchmarkId(fields['--entry-id']);
    const selected = fields['--fields']?.split(',');
    if (!selected?.length || selected.length > 2 || new Set(selected).size !== selected.length || selected.some(f => !['outcome','scores'].includes(f))) throw guidanceError(Error('Select outcome,scores fields explicitly'), 'guid-c30a0838eb426ea6');
  } else if (['--shareable','--entry-id','--fields'].some(f => fields[f] !== undefined)) throw guidanceError(Error('Result field approval is only for evidence'), 'guid-8fa47807447c851a');
  if (operation === 'cancel' && (!fields['--reason'] || fields['--reason']!.length > 500)) throw guidanceError(Error('Explicit bounded cancellation reason required'), 'guid-3098cf994860ad68');
  if (operation !== 'cancel' && fields['--reason']) throw guidanceError(Error('Reason is only for cancel'), 'guid-d919e07a8a537f3d');
  if (fields['--economy-config'] && !isAbsolute(fields['--economy-config'])) throw guidanceError(Error('Absolute economy configuration required'), 'guid-1d4b7400faef02a1');
  return { operation: operation as BenchmarkHostArguments['operation'], vaultPath, configPath, actor,
    ...(fields['--economy-config'] && { economyConfig: fields['--economy-config'] }),
    params: { challengeId, ...(fields['--expected-revision'] && { expectedRevision: fields['--expected-revision'] }),
      ...(fields['--request-id'] && { requestId: fields['--request-id'] }), ...(fields['--expected-projection-revision'] && { expectedProjectionRevision: fields['--expected-projection-revision'] }),
      ...(fields['--reason'] && { reason: fields['--reason'] }),
      ...(operation === 'evidence' && { entryId: fields['--entry-id'], fields: fields['--fields']!.split(','), shareable: true }) } };
}

/** Offline host adapter. No listeners, enrollment, implicit approvals or arbitrary
 * ledger commands. Reuses the actual auth/moderation services, without constructing
 * the server's startup maintenance/index lifecycle for read-only inspection. */
export async function runBenchmarkHost(args: string[]): Promise<Record<string, unknown>> {
  const parsed = parseBenchmarkHostArgs(args);
  const { loadBenchmarkHostConfig } = await import('./benchmark-host.js');
  const { acquireBenchmarkWriter } = await import('./benchmark-runtime.js');
  const { loadEconomyHostConfig, probeEconomyStorage } = await import('./economy-host.js');
  const { EconomyLedger } = await import('./economy-ledger.js');
  const { BenchmarkService } = await import('./benchmark-service.js');
  const { FileSystemService } = await import('./filesystem.js');
  const { ScopeAuthService } = await import('./scope-auth.js');
  const { ModerationService } = await import('./moderation.js');
  const { readEnterpriseVaultMarker } = await import('./enterprise-vault-marker.js');
  if (readEnterpriseVaultMarker(parsed.vaultPath)) throw guidanceError(Error('Benchmark maintenance requires a matching enterprise host adapter; legacy fallback is forbidden'), 'guid-8d70ca22053887b3');
  const host = await loadBenchmarkHostConfig(parsed.configPath, parsed.vaultPath);
  if (!host.enabled) throw guidanceError(Error('Benchmarks disabled by host'), 'guid-88bac2dd0ec5651e');
  await host.assertHumanOperator(parsed.actor);
  let lock: import('./benchmark-runtime.js').BenchmarkWriter | undefined;
  let ledger: import('./economy-ledger.js').EconomyLedger | undefined;
  let service: import('./benchmark-service.js').BenchmarkService | undefined;
  try {
    if (parsed.operation !== 'inspect' && parsed.operation !== 'initiative-status') lock = await acquireBenchmarkWriter(host);
    const economy = parsed.economyConfig ? await loadEconomyHostConfig(parsed.economyConfig, parsed.vaultPath) : undefined;
    if (economy) {
      if (!economy.policy.enabled) throw guidanceError(Error('Economy disabled by host'), 'guid-3953d384face7ff8');
      for (const path of [economy.ledgerPath ?? economy.vaultPath, economy.hostPath]) await probeEconomyStorage(path);
      ledger = await EconomyLedger.open({ ...economy, storageVerified: true, benchmarkAuthority: {
        assertHumanOperator: host.assertHumanOperator,
        validateAward: async (proof, state) => { if (!service) throw guidanceError(Error('Current adjudication service unavailable'), 'guid-a0a53a5025a03623'); await service.validateAwardProof(proof, state); },
      } });
    }
    const fs = new FileSystemService(parsed.vaultPath), auth = new ScopeAuthService(parsed.vaultPath), moderation = new ModerationService(parsed.vaultPath, fs, auth);
    const accountAvailable = async (accountId: string) => {
      const current = (await auth.listPrincipals()).find(p => p.accountId === accountId);
      return Boolean(current && auth.hasCapability(current, 'task') && !await moderation.isBanned(current.accountId, current.userId));
    };
    service = new BenchmarkService(fs, { ...host, ...(ledger && { ledger }), accountAvailable,
      accountProfiles: async () => { await lock?.assertHeld(); return host.accountProfiles(); },
      assertHumanOperator: async actor => { await lock?.assertHeld(); await host.assertHumanOperator(actor); },
      assertActor: async principal => {
        const current = (await auth.listPrincipals()).find(p => p.accountId === principal.accountId);
        if (!current || current.agentId !== principal.agentId || current.modelId !== principal.modelId || !await accountAvailable(current.accountId)) throw guidanceError(Error('Current task account required'), 'guid-0699e6101be7cddd');
        return current;
      },
    });
    return parsed.operation === 'initiative-status' ? await service.initiativeStatus(parsed.actor) : await service.executeHost(parsed.operation, parsed.params, parsed.actor);
  } finally {
    try { await ledger?.close(); } finally { await lock?.close(); }
  }
}
