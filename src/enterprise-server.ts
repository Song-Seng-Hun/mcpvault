import { guidanceError } from './guidance-runtime.js';
import { createPrivateKey, randomBytes, X509Certificate } from 'node:crypto';
import { open, readFile, realpath, stat, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureFederationDirectory } from './public-federation-storage.js';
import { createServer } from './createServer.js';
import type { PublicFederationHostConfig } from './enterprise-federation.js';
import { EnterpriseRegistry, type EnterpriseMode } from './enterprise-registry.js';
import { GlobalSyncReadClient, GlobalSyncReplica, type GlobalImportResult } from './global-sync.js';
import { startMcpHttpApi, type McpHttpHandle } from './mcp-http.js';
import { normalizeScopeId } from './scopes.js';

const LOCK_VERSION = 1;
const MAX_LOCK_BYTES = 4_096;
const MAX_FEDERATION_CONFIG_BYTES = 1_048_576;
const MAX_FEDERATION_ACTORS = 4_096;
const MAX_FEDERATION_TOKEN_LENGTH = 8_192;

export interface EnterpriseServerConfig {
  registryPath: string;
  realmId: string;
  host: string;
  port: number;
  certPath: string;
  keyPath: string;
  caPath: string;
  federationConfigPath?: string;
  globalImportConfigPath?: string;
}

export interface EnterpriseServerHandle {
  host: string;
  port: number;
  path: '/mcp';
  protocol: 'https';
  transport: 'mcp-http';
  vaultPath: string;
  registryPath: string;
  realmId: string;
  mode: EnterpriseMode;
  globalImport?: GlobalImportResult;
  close(): Promise<void>;
}

interface GlobalImportHostConfig {
  baseUrl: string;
  readToken: string;
  trustedPublicKey: string;
}

interface VaultLockRecord {
  version: 1;
  pid: number;
  nonce: string;
  vaultPath: string;
}

interface VaultLock {
  handle: FileHandle;
  path: string;
  record: VaultLockRecord;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(isRecord(error) && error.code === 'ESRCH');
  }
}

function absolute(path: string, label: string): string {
  if (!path || !isAbsolute(path)) throw guidanceError(new Error(`${label} must be an explicit absolute path`), 'guid-622ae60cd2274500');
  return resolve(path);
}

function pathIsInside(parent: string, child: string): boolean {
  const relation = relative(parent.toLowerCase(), child.toLowerCase());
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

async function canonicalFileOutsideVault(path: string, vaultPath: string, label: string): Promise<string> {
  const canonical = await realpath(path);
  const file = await stat(canonical);
  if (!file.isFile()) throw guidanceError(new Error(`${label} must identify a file`), 'guid-76f303e2b093def0');
  const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const serviceRoot = moduleRoot.endsWith(`${process.platform === 'win32' ? '\\' : '/'}dist`) ? resolve(moduleRoot, '..') : moduleRoot;
  if (pathIsInside(vaultPath, canonical) || pathIsInside(await realpath(serviceRoot), canonical)) throw guidanceError(new Error(`${label} must be outside the Vault and service checkout`), 'guid-63507b893e3d6cfc');
  return canonical;
}

async function readLock(path: string, canonicalVaultPath: string): Promise<VaultLockRecord> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_LOCK_BYTES) {
    throw guidanceError(new Error('Enterprise server lock is invalid; refusing to remove it automatically'), 'guid-7c4ad3cbf894d11d');
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') throw error;
    throw guidanceError(new Error('Enterprise server lock is corrupt; refusing to remove it automatically'), 'guid-592f2b080b57effe');
  }
  if (!isRecord(value)
    || value.version !== LOCK_VERSION
    || !Number.isSafeInteger(value.pid)
    || Number(value.pid) <= 0
    || typeof value.nonce !== 'string'
    || !/^[a-f0-9]{32}$/.test(value.nonce)
    || typeof value.vaultPath !== 'string'
    || resolve(value.vaultPath).toLowerCase() !== canonicalVaultPath.toLowerCase()) {
    throw guidanceError(new Error('Enterprise server lock is invalid; refusing to remove it automatically'), 'guid-7c4ad3cbf894d11d');
  }
  return value as unknown as VaultLockRecord;
}

async function acquireVaultLock(vaultPath: string): Promise<() => Promise<void>> {
  const canonicalVaultPath = await realpath(vaultPath);
  const directory = join(canonicalVaultPath, '.mcpvault');
  const path = join(directory, 'enterprise-server.lock');
  await ensureFederationDirectory(canonicalVaultPath, directory);

  let lock: VaultLock | undefined;
  for (let attempt = 0; attempt < 4 && !lock; attempt += 1) {
    const record: VaultLockRecord = {
      version: LOCK_VERSION,
      pid: process.pid,
      nonce: randomBytes(16).toString('hex'),
      vaultPath: canonicalVaultPath,
    };
    let handle: FileHandle | undefined;
    try {
      handle = await open(path, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
      await handle.sync();
      lock = { handle, path, record };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (!(isRecord(error) && error.code === 'EEXIST')) {
        if (handle) await unlink(path).catch(() => undefined);
        throw error;
      }
      let existing: VaultLockRecord;
      try {
        existing = await readLock(path, canonicalVaultPath);
      } catch (readError) {
        if (isRecord(readError) && readError.code === 'ENOENT') continue;
        throw readError;
      }
      if (processIsAlive(existing.pid)) {
        throw guidanceError(new Error(`An enterprise server already owns this Vault (process ${existing.pid})`), 'guid-256a71d2ccfca7be');
      }
      try {
        await unlink(path);
      } catch (unlinkError) {
        if (!(isRecord(unlinkError) && unlinkError.code === 'ENOENT')) throw unlinkError;
      }
    }
  }
  if (!lock) throw guidanceError(new Error('Unable to acquire the enterprise server Vault lock'), 'guid-95bd571f6b93b603');

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await lock!.handle.close().catch(() => undefined);
    try {
      const current = await readLock(lock!.path, canonicalVaultPath);
      if (current.nonce === lock!.record.nonce) await unlink(lock!.path);
    } catch (error) {
      if (!(isRecord(error) && error.code === 'ENOENT')) throw error;
    }
  };
}

function parseFederationConfig(value: unknown): PublicFederationHostConfig {
  if (!isRecord(value)
    || Object.keys(value).some(key => !['baseUrl', 'trustedHubPublicKey', 'actors'].includes(key))
    || typeof value.baseUrl !== 'string'
    || !value.baseUrl
    || typeof value.trustedHubPublicKey !== 'string'
    || !value.trustedHubPublicKey
    || !isRecord(value.actors)) {
    throw guidanceError(new Error('Public federation configuration is invalid'), 'guid-ab8c844cc79b3994');
  }
  const url = new URL(value.baseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))) {
    throw guidanceError(new Error('Public federation baseUrl must use HTTPS except on loopback'), 'guid-0ad4e7dc35f92d37');
  }
  const entries = Object.entries(value.actors);
  if (entries.length > MAX_FEDERATION_ACTORS) throw guidanceError(new Error('Public federation actor capacity exceeded'), 'guid-bcebacbf89ad3ce5');
  const actors: Record<string, { authToken: string }> = Object.create(null) as Record<string, { authToken: string }>;
  for (const [agentIdInput, actor] of entries) {
    const agentId = normalizeScopeId(agentIdInput, 'federation agentId');
    if (agentId !== agentIdInput || !isRecord(actor) || Object.keys(actor).some(key => key !== 'authToken') || typeof actor.authToken !== 'string'
      || !actor.authToken || actor.authToken.length > MAX_FEDERATION_TOKEN_LENGTH) {
      throw guidanceError(new Error('Public federation actor configuration is invalid'), 'guid-22fa77d70746cec9');
    }
    actors[agentId] = { authToken: actor.authToken };
  }
  return { baseUrl: url.href.replace(/\/$/, ''), trustedHubPublicKey: value.trustedHubPublicKey, actors };
}

async function loadFederationConfig(path: string, canonicalVaultPath: string): Promise<PublicFederationHostConfig> {
  const canonicalPath = await canonicalFileOutsideVault(path, canonicalVaultPath, 'federationConfigPath');
  if ((await stat(canonicalPath)).size > MAX_FEDERATION_CONFIG_BYTES) {
    throw guidanceError(new Error('Public federation configuration is too large'), 'guid-d1121a2956add89b');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(canonicalPath, 'utf8'));
  } catch {
    throw guidanceError(new Error('Public federation configuration is not valid JSON'), 'guid-71a076b24ddc8030');
  }
  return parseFederationConfig(parsed);
}

function parseGlobalImportConfig(value: unknown): GlobalImportHostConfig {
  if (!isRecord(value)
    || Object.keys(value).some(key => !['baseUrl', 'readToken', 'trustedPublicKey'].includes(key))
    || typeof value.baseUrl !== 'string'
    || !value.baseUrl
    || typeof value.readToken !== 'string'
    || !value.readToken
    || value.readToken.length > MAX_FEDERATION_TOKEN_LENGTH
    || typeof value.trustedPublicKey !== 'string'
    || !value.trustedPublicKey) {
    throw guidanceError(new Error('Global import configuration must contain only baseUrl, readToken, and trustedPublicKey'), 'guid-5b55bae8ba50b098');
  }
  return { baseUrl: value.baseUrl, readToken: value.readToken, trustedPublicKey: value.trustedPublicKey };
}

async function loadGlobalImportConfig(path: string, canonicalVaultPath: string): Promise<GlobalImportHostConfig> {
  const canonicalPath = await canonicalFileOutsideVault(path, canonicalVaultPath, 'globalImportConfigPath');
  if ((await stat(canonicalPath)).size > MAX_FEDERATION_CONFIG_BYTES) throw guidanceError(new Error('Global import configuration is too large'), 'guid-e7cc434be06a087b');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(canonicalPath, 'utf8'));
  } catch {
    throw guidanceError(new Error('Global import configuration is not valid JSON'), 'guid-8d050893320611a6');
  }
  return parseGlobalImportConfig(parsed);
}

function validateTls(cert: Buffer, key: Buffer, ca: Buffer): void {
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(cert);
  } catch {
    throw guidanceError(new Error('TLS certificate is not a valid X.509 certificate'), 'guid-11bc6b224e0da208');
  }
  try {
    if (!certificate.checkPrivateKey(createPrivateKey(key))) {
      throw guidanceError(new Error('TLS private key does not match the server certificate'), 'guid-c0075d6c5e08e0ec');
    }
  } catch (error) {
    if (error instanceof Error && /does not match/.test(error.message)) throw error;
    throw guidanceError(new Error('TLS private key is invalid or does not match the server certificate'), 'guid-2a55c9c7eeeec3be');
  }
  try {
    new X509Certificate(ca);
  } catch {
    throw guidanceError(new Error('TLS CA is not a valid X.509 certificate'), 'guid-f6d2c26865fb5574');
  }
}

async function closeResources(http: McpHttpHandle | undefined, runtime: ReturnType<typeof createServer> | undefined, release: () => Promise<void>): Promise<unknown[]> {
  http?.server.closeAllConnections();
  const results = await Promise.allSettled([
    ...(http ? [http.close()] : []),
    ...(runtime ? [runtime.close()] : []),
  ]);
  try {
    await release();
  } catch (error) {
    results.push({ status: 'rejected', reason: error });
  }
  return results.filter(result => result.status === 'rejected').map(result => result.reason);
}

export async function startEnterpriseServer(config: EnterpriseServerConfig): Promise<EnterpriseServerHandle> {
  const registryPath = absolute(config.registryPath, 'registryPath');
  const certPath = absolute(config.certPath, 'certPath');
  const keyPath = absolute(config.keyPath, 'keyPath');
  const caPath = absolute(config.caPath, 'caPath');
  const federationConfigPath = config.federationConfigPath === undefined
    ? undefined
    : absolute(config.federationConfigPath, 'federationConfigPath');
  const globalImportConfigPath = config.globalImportConfigPath === undefined
    ? undefined
    : absolute(config.globalImportConfigPath, 'globalImportConfigPath');
  const realmId = normalizeScopeId(config.realmId, 'realmId');
  if (!config.host || typeof config.host !== 'string') throw guidanceError(new Error('host is required'), 'guid-2ef65809cfe9cfe7');
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65_535) throw guidanceError(new Error('port must be 0 through 65535'), 'guid-a430320c01788f07');

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(registryPath, 'utf8'));
  } catch {
    throw guidanceError(new Error('Enterprise registry is missing or corrupt'), 'guid-412eab1c897c6890');
  }
  const policyVault = isRecord(raw) && isRecord(raw.profile) && typeof raw.profile.vaultPath === 'string' ? raw.profile.vaultPath : '';
  if (!isAbsolute(policyVault)) throw guidanceError(new Error('Enterprise registry has no valid Vault path'), 'guid-5b05b94e1cbd131e');
  const verifiedRegistry = new EnterpriseRegistry({ registryPath, vaultPath: policyVault });
  const profile = verifiedRegistry.getPolicy();
  if (profile.realmId !== realmId) throw guidanceError(new Error(`Enterprise registry realm '${profile.realmId}' does not match configured realm '${realmId}'`), 'guid-df09bbabd6aee122');

  const canonicalVaultPath = await realpath(profile.vaultPath);
  const [canonicalRegistryPath, canonicalCertPath, canonicalKeyPath, canonicalCaPath] = await Promise.all([
    canonicalFileOutsideVault(registryPath, canonicalVaultPath, 'registryPath'),
    canonicalFileOutsideVault(certPath, canonicalVaultPath, 'certPath'),
    canonicalFileOutsideVault(keyPath, canonicalVaultPath, 'TLS private key'),
    canonicalFileOutsideVault(caPath, canonicalVaultPath, 'TLS CA'),
  ]);
  const publicFederation = federationConfigPath === undefined
    ? undefined
    : profile.mode !== 'public'
      ? (() => { throw guidanceError(new Error('Public federation configuration is forbidden for a company enterprise instance'), 'guid-2ee24fa850bba9fc'); })()
      : await loadFederationConfig(federationConfigPath, canonicalVaultPath);
  const globalImportConfig = globalImportConfigPath === undefined
    ? undefined
    : profile.mode !== 'company'
      ? (() => { throw guidanceError(new Error('Global import configuration is allowed only for a company enterprise instance'), 'guid-571a728ef2780d41'); })()
      : await loadGlobalImportConfig(globalImportConfigPath, canonicalVaultPath);

  const release = await acquireVaultLock(canonicalVaultPath);
  let runtime: ReturnType<typeof createServer> | undefined;
  let http: McpHttpHandle | undefined;
  try {
    const [cert, key, ca] = await Promise.all([
      readFile(canonicalCertPath),
      readFile(canonicalKeyPath),
      readFile(canonicalCaPath),
    ]);
    validateTls(cert, key, ca);
    const globalImport = globalImportConfig
      ? await new GlobalSyncReplica({
          vaultPath: profile.vaultPath,
          client: new GlobalSyncReadClient({ baseUrl: globalImportConfig.baseUrl, readToken: globalImportConfig.readToken }),
          trustedPublicKey: globalImportConfig.trustedPublicKey,
        }).pullPages()
      : undefined;
    runtime = createServer(profile.vaultPath, {
      enterpriseRegistryPath: canonicalRegistryPath,
      commandCenterId: profile.realmId,
      ...(publicFederation && { publicFederation }),
    });
    http = await startMcpHttpApi(runtime, {
      host: config.host,
      port: config.port,
      path: '/mcp',
      requireClientCertificate: true,
      tls: { cert, key, ca },
    });
    let closed = false;
    return {
      host: http.host,
      port: http.port,
      path: '/mcp',
      protocol: 'https',
      transport: 'mcp-http',
      vaultPath: profile.vaultPath,
      registryPath: canonicalRegistryPath,
      realmId: profile.realmId,
      mode: profile.mode,
      ...(globalImport && { globalImport }),
      close: async () => {
        if (closed) return;
        closed = true;
        const failures = await closeResources(http, runtime, release);
        if (failures.length > 0) throw failures[0];
      },
    };
  } catch (error) {
    await closeResources(http, runtime, release);
    throw error;
  }
}

export function enterpriseServerHelp(): string {
  return [
    'Usage: mcpvault-enterprise --registry <absolute-path> --realm <realm-id> --host <loopback-or-private-ip> --port <port> --cert <absolute-path> --key <absolute-path> --ca <absolute-path> [--federation-config <absolute-path>] [--global-import-config <absolute-path>]',
    '',
    'Starts one mTLS-only MCP Streamable HTTP listener. It does not start stdio or REST transports.',
  ].join('\n');
}
