#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EnterpriseRegistry, type EnterpriseBinding, type EnterpriseMode, type RuntimeKind } from './src/enterprise-registry.js';
import { previewMemoryMigration } from './src/enterprise-migration.js';
import { normalizeScopeId } from './src/scopes.js';

const MAX_ACCOUNT_DATABASE_BYTES = 1_048_576;
const MAX_ACCOUNT_RECORDS = 4_096;
const DEFAULT_PREVIEW_LIMIT = 100;
const MAX_PREVIEW_LIMIT = 500;

interface AdminIo {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
  now?: () => Date;
}

interface MigrationAccount {
  accountId: string;
  modelId: string;
  agentId?: string;
  userId: string;
  role: 'model' | 'agent';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function required(options: Map<string, string | true>, name: string): string {
  const value = options.get(name);
  if (typeof value !== 'string' || !value) throw new Error(`--${name} is required`);
  return value;
}

function optional(options: Map<string, string | true>, name: string): string | undefined {
  const value = options.get(name);
  return typeof value === 'string' ? value : undefined;
}

function parseOptions(args: string[]): Map<string, string | true> {
  const options = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith('--') || token.length === 2) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (options.has(name)) throw new Error(`Duplicate option: --${name}`);
    if (name === 'shared-memory') {
      options.set(name, true);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`);
    options.set(name, value);
    index += 1;
  }
  return options;
}

function assertOnly(options: Map<string, string | true>, allowed: readonly string[]): void {
  for (const name of options.keys()) {
    if (!allowed.includes(name)) throw new Error(`Unknown option: --${name}`);
  }
}

function registryFrom(options: Map<string, string | true>, now?: () => Date): EnterpriseRegistry {
  const registryPath = required(options, 'registry');
  const vaultPath = required(options, 'vault');
  const servicePath = optional(options, 'service-path');
  return new EnterpriseRegistry({ registryPath, vaultPath, ...(servicePath && { servicePaths: [servicePath] }), ...(now && { now }) });
}

export function previewAccountMigration(accountsPathInput: string, limitInput = DEFAULT_PREVIEW_LIMIT): { total: number; shown: number; truncated: boolean; accounts: MigrationAccount[] } {
  const accountsPath = resolve(accountsPathInput);
  if (statSync(accountsPath).size > MAX_ACCOUNT_DATABASE_BYTES) throw new Error('ScopeAuth account database is too large to preview');
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(accountsPath, 'utf8')); } catch { throw new Error('ScopeAuth account database is corrupt'); }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.accounts) || parsed.accounts.length > MAX_ACCOUNT_RECORDS) {
    throw new Error('ScopeAuth account database is corrupt');
  }
  if (!Number.isSafeInteger(limitInput) || limitInput < 1 || limitInput > MAX_PREVIEW_LIMIT) throw new Error(`limit must be 1-${MAX_PREVIEW_LIMIT}`);
  let accounts: MigrationAccount[];
  try {
    accounts = parsed.accounts.map(item => {
      if (!isRecord(item) || (item.role !== 'model' && item.role !== 'agent')) throw new Error();
      const accountId = normalizeScopeId(String(item.accountId || ''), 'accountId');
      const modelId = normalizeScopeId(String(item.modelId || ''), 'modelId');
      const agentId = item.agentId === undefined ? undefined : normalizeScopeId(String(item.agentId), 'agentId');
      if (item.role === 'agent' && !agentId) throw new Error();
      const userId = normalizeScopeId(String(item.userId || accountId), 'userId');
      return { accountId, modelId, ...(agentId && { agentId }), userId, role: item.role };
    });
  } catch {
    throw new Error('ScopeAuth account database is corrupt');
  }
  const shown = Math.min(accounts.length, limitInput);
  return { total: accounts.length, shown, truncated: shown < accounts.length, accounts: accounts.slice(0, shown) };
}

function usage(): string {
  return [
    'Usage: npx tsx enterprise-admin.ts <command> [options]',
    'Commands:',
    '  init --registry PATH --vault PATH --mode public|company --realm ID [--service-path PATH]',
    '  employee-create --registry PATH --vault PATH --user ID [--shared-memory]',
    '  employee-disable --registry PATH --vault PATH --user ID',
    '  account-disable --registry PATH --vault PATH --account ID',
    '  runtime-register --registry PATH --vault PATH --runtime ID --kind external|internal --cert SHA256',
    '  runtime-disable --registry PATH --vault PATH --runtime ID',
    '  invite-create --registry PATH --vault PATH --account ID --agent ID --user ID --model ID --runtime ID --expires-at ISO --secret-file PATH [--display-label TEXT] [--role TEXT]',
    '  migration-preview --accounts PATH [--limit 1-500]',
    '  memory-preview --vault PATH [--limit 1-500]',
  ].join('\n');
}

export async function runEnterpriseAdmin(argv: string[], io: AdminIo = { stdout: console.log, stderr: console.error }): Promise<number> {
  try {
    const command = argv[0];
    if (!command || command === 'help' || command === '--help') {
      io.stdout(usage());
      return command ? 0 : 2;
    }
    const options = parseOptions(argv.slice(1));
    let result: unknown;
    if (command === 'migration-preview') {
      assertOnly(options, ['accounts', 'limit']);
      const limitRaw = optional(options, 'limit');
      const limit = limitRaw === undefined ? DEFAULT_PREVIEW_LIMIT : Number(limitRaw);
      result = previewAccountMigration(required(options, 'accounts'), limit);
    } else if (command === 'memory-preview') {
      assertOnly(options, ['vault', 'limit']);
      const limitRaw = optional(options, 'limit');
      const limit = limitRaw === undefined ? DEFAULT_PREVIEW_LIMIT : Number(limitRaw);
      result = await previewMemoryMigration({ vaultPath: required(options, 'vault'), limit });
    } else {
      const registry = registryFrom(options, io.now);
      if (command === 'init') {
        assertOnly(options, ['registry', 'vault', 'service-path', 'mode', 'realm']);
        const mode = required(options, 'mode') as EnterpriseMode;
        result = await registry.initialize({ mode, realmId: required(options, 'realm'), vaultPath: required(options, 'vault') });
      } else if (command === 'employee-create') {
        assertOnly(options, ['registry', 'vault', 'service-path', 'user', 'shared-memory']);
        result = await registry.createEmployee({ userId: required(options, 'user'), sharedMemoryEnabled: options.get('shared-memory') === true });
      } else if (command === 'employee-disable') {
        assertOnly(options, ['registry', 'vault', 'service-path', 'user']);
        result = await registry.disableEmployee({ userId: required(options, 'user') });
      } else if (command === 'runtime-register') {
        assertOnly(options, ['registry', 'vault', 'service-path', 'runtime', 'kind', 'cert']);
        result = await registry.registerRuntime({ runtimeId: required(options, 'runtime'), kind: required(options, 'kind') as RuntimeKind, certFingerprint: required(options, 'cert') });
      } else if (command === 'account-disable') {
        assertOnly(options, ['registry', 'vault', 'service-path', 'account']);
        result = await registry.disableAccount({ accountId: required(options, 'account') });
      } else if (command === 'runtime-disable') {
        assertOnly(options, ['registry', 'vault', 'service-path', 'runtime']);
        result = await registry.disableRuntime({ runtimeId: required(options, 'runtime') });
      } else if (command === 'invite-create') {
        assertOnly(options, ['registry', 'vault', 'service-path', 'account', 'agent', 'user', 'model', 'runtime', 'expires-at', 'secret-file', 'display-label', 'role']);
        const displayLabel = optional(options, 'display-label');
        const role = optional(options, 'role');
        const binding: EnterpriseBinding = {
          accountId: required(options, 'account'), agentId: required(options, 'agent'), userId: required(options, 'user'),
          modelId: required(options, 'model'), runtimeId: required(options, 'runtime'),
          ...(displayLabel !== undefined ? { displayLabel } : {}),
          ...(role !== undefined ? { role } : {}),
        };
        result = await registry.createInvite({ binding, expiresAt: required(options, 'expires-at'), secretFile: required(options, 'secret-file') });
      } else {
        throw new Error(`Unknown command: ${command}`);
      }
    }
    io.stdout(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runEnterpriseAdmin(process.argv.slice(2));
}
