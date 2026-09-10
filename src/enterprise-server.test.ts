import { generateKeyPairSync, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { parseEnterpriseServerArgs, runEnterpriseServer } from '../enterprise-server.js';
import { EnterpriseRegistry, type EnterpriseMode } from './enterprise-registry.js';
import { startEnterpriseServer, type EnterpriseServerConfig, type EnterpriseServerHandle } from './enterprise-server.js';
import { startGlobalSyncHub, type GlobalSyncHubHttpHandle } from './global-sync.js';

interface Certificates {
  directory: string;
  caPath: string;
  serverCertPath: string;
  serverKeyPath: string;
  otherServerKeyPath: string;
  clientCertPath: string;
  clientKeyPath: string;
  secondClientCertPath: string;
  secondClientKeyPath: string;
  wrongClientCertPath: string;
  wrongClientKeyPath: string;
  clientFingerprint: string;
  secondClientFingerprint: string;
}

let certificates: Certificates;
let root: string;
let vaultPath: string;
let registryPath: string;
const handles: EnterpriseServerHandle[] = [];
const globalHubs: GlobalSyncHubHttpHandle[] = [];
const federationPublicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();

async function createCertificates(): Promise<Certificates> {
  const directory = await mkdtemp(join(tmpdir(), 'mcpvault-enterprise-server-tls-'));
  const configPath = join(directory, 'openssl.cnf');
  await writeFile(configPath, '[ req ]\ndistinguished_name = subject\n[ subject ]\n', 'utf8');
  const run = (...args: string[]) => execFileSync('openssl.exe', args, {
    cwd: directory,
    stdio: 'ignore',
    env: { ...process.env, OPENSSL_CONF: configPath },
  });
  run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', '/CN=enterprise-test-ca', '-days', '1');
  for (const name of ['server', 'other-server', 'client', 'second-client']) {
    run('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${name === 'server' || name === 'other-server' ? 'localhost' : name}`);
    run('x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', `${name}.crt`, '-days', '1');
  }
  run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'wrong-client.key', '-out', 'wrong-client.crt', '-subj', '/CN=wrong-client', '-days', '1');
  const path = (name: string) => join(directory, name);
  const fingerprint = async (name: string) => new X509Certificate(await readFile(path(name))).fingerprint256.replaceAll(':', '').toLowerCase();
  return {
    directory,
    caPath: path('ca.crt'),
    serverCertPath: path('server.crt'),
    serverKeyPath: path('server.key'),
    otherServerKeyPath: path('other-server.key'),
    clientCertPath: path('client.crt'),
    clientKeyPath: path('client.key'),
    secondClientCertPath: path('second-client.crt'),
    secondClientKeyPath: path('second-client.key'),
    wrongClientCertPath: path('wrong-client.crt'),
    wrongClientKeyPath: path('wrong-client.key'),
    clientFingerprint: await fingerprint('client.crt'),
    secondClientFingerprint: await fingerprint('second-client.crt'),
  };
}

async function initializeRegistry(options: {
  path?: string;
  mode?: EnterpriseMode;
  realmId?: string;
  runtimeFingerprint?: string;
} = {}): Promise<EnterpriseRegistry> {
  const path = options.path || registryPath;
  const registry = new EnterpriseRegistry({ registryPath: path, vaultPath });
  await registry.initialize({ mode: options.mode || 'company', realmId: options.realmId || 'acme', vaultPath });
  if (options.runtimeFingerprint) {
    await registry.registerRuntime({
      runtimeId: 'runtime-one',
      kind: options.mode === 'public' ? 'external' : 'internal',
      certFingerprint: options.runtimeFingerprint,
    });
  }
  return registry;
}

function config(overrides: Partial<EnterpriseServerConfig> = {}): EnterpriseServerConfig {
  return {
    registryPath,
    realmId: 'acme',
    host: '127.0.0.1',
    port: 0,
    certPath: certificates.serverCertPath,
    keyPath: certificates.serverKeyPath,
    caPath: certificates.caPath,
    ...overrides,
  };
}

async function start(overrides: Partial<EnterpriseServerConfig> = {}): Promise<EnterpriseServerHandle> {
  const handle = await startEnterpriseServer(config(overrides));
  handles.push(handle);
  return handle;
}

async function requestMcp(handle: EnterpriseServerHandle, options: {
  certPath?: string;
  keyPath?: string;
  bearer?: string;
  body: unknown;
}): Promise<{ status: number; body: string }> {
  const [ca, cert, key] = await Promise.all([
    readFile(certificates.caPath),
    options.certPath ? readFile(options.certPath) : undefined,
    options.keyPath ? readFile(options.keyPath) : undefined,
  ]);
  return new Promise((resolvePromise, reject) => {
    const request = httpsRequest({
      hostname: handle.host,
      port: handle.port,
      path: '/mcp',
      method: 'POST',
      servername: 'localhost',
      ca,
      ...(cert && { cert }),
      ...(key && { key }),
      headers: {
        host: handle.host,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-11-25',
        ...(options.bearer && { authorization: `Bearer ${options.bearer}` }),
      },
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolvePromise({ status: response.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.once('error', reject);
    request.end(JSON.stringify(options.body));
  });
}

beforeAll(async () => {
  certificates = await createCertificates();
}, 30_000);

afterAll(async () => {
  await rm(certificates.directory, { recursive: true, force: true });
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-enterprise-server-'));
  vaultPath = join(root, 'vault');
  registryPath = join(root, 'host-private', 'enterprise.json');
  await mkdir(vaultPath, { recursive: true });
});

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close();
  for (const hub of globalHubs.splice(0)) await hub.close();
  await rm(root, { recursive: true, force: true });
});

describe('configuration and CLI', () => {
  test('requires absolute host paths, a complete TLS configuration, and the expected registry realm', async () => {
    await expect(startEnterpriseServer(config({ registryPath: 'relative.json' }))).rejects.toThrow(/registryPath.*absolute/i);
    await expect(startEnterpriseServer(config({ keyPath: 'relative.key' }))).rejects.toThrow(/keyPath.*absolute/i);
    await expect(startEnterpriseServer(config({ caPath: '' }))).rejects.toThrow(/caPath.*absolute/i);

    await initializeRegistry();
    await expect(startEnterpriseServer(config({ realmId: 'another-realm' }))).rejects.toThrow(/realm/i);

    const keyInsideVault = join(vaultPath, 'server.key');
    await writeFile(keyInsideVault, await readFile(certificates.serverKeyPath));
    await expect(startEnterpriseServer(config({ keyPath: keyInsideVault }))).rejects.toThrow(/key.*outside.*Vault/i);
  });

  test('rejects credential-bearing files stored in the service checkout', async () => {
    const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const checkoutFile = join(serviceRoot, 'package.json');
    await initializeRegistry();
    await expect(startEnterpriseServer(config({ keyPath: checkoutFile }))).rejects.toThrow(/key.*outside.*service checkout/i);
    await expect(startEnterpriseServer(config({ globalImportConfigPath: checkoutFile }))).rejects.toThrow(/globalImportConfigPath.*outside.*service checkout/i);

    const publicRegistryPath = join(root, 'host-private', 'public-enterprise.json');
    vaultPath = join(root, 'public-vault'); await mkdir(vaultPath);
    await initializeRegistry({ path: publicRegistryPath, mode: 'public', realmId: 'public-realm' });
    await expect(startEnterpriseServer(config({
      registryPath: publicRegistryPath,
      realmId: 'public-realm',
      federationConfigPath: checkoutFile,
    }))).rejects.toThrow(/federationConfigPath.*outside.*service checkout/i);
  });

  test.runIf(process.platform === 'win32')('rejects checkout credentials reached through a junction alias outside the Vault', async () => {
    const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const alias = join(root, 'service-alias');
    await symlink(serviceRoot, alias, 'junction');
    const aliasedCheckoutFile = join(alias, 'package.json');
    await initializeRegistry();
    await expect(startEnterpriseServer(config({ keyPath: aliasedCheckoutFile }))).rejects.toThrow(/key.*outside.*service checkout/i);
    await expect(startEnterpriseServer(config({ globalImportConfigPath: aliasedCheckoutFile }))).rejects.toThrow(/globalImportConfigPath.*outside.*service checkout/i);

    const publicRegistryPath = join(root, 'host-private', 'public-enterprise.json');
    vaultPath = join(root, 'public-vault'); await mkdir(vaultPath);
    await initializeRegistry({ path: publicRegistryPath, mode: 'public', realmId: 'public-realm' });
    await expect(startEnterpriseServer(config({
      registryPath: publicRegistryPath,
      realmId: 'public-realm',
      federationConfigPath: aliasedCheckoutFile,
    }))).rejects.toThrow(/federationConfigPath.*outside.*service checkout/i);
  });

  test('parses the complete CLI contract and rejects unknown, duplicate, and invalid arguments', () => {
    const parsed = parseEnterpriseServerArgs([
      '--registry', 'D:\\service\\enterprise.json', '--realm', 'acme', '--host', '10.0.0.8', '--port', '8443',
      '--cert', 'D:\\tls\\server.crt', '--key', 'D:\\tls\\server.key', '--ca', 'D:\\tls\\clients-ca.crt',
      '--federation-config', 'D:\\service\\federation.json',
      '--global-import-config', 'D:\\service\\global-import.json',
    ]);
    expect(parsed).toEqual({
      registryPath: 'D:\\service\\enterprise.json', realmId: 'acme', host: '10.0.0.8', port: 8443,
      certPath: 'D:\\tls\\server.crt', keyPath: 'D:\\tls\\server.key', caPath: 'D:\\tls\\clients-ca.crt',
      federationConfigPath: 'D:\\service\\federation.json',
      globalImportConfigPath: 'D:\\service\\global-import.json',
    });
    expect(() => parseEnterpriseServerArgs(['--unknown', 'value'])).toThrow(/unknown option/i);
    expect(() => parseEnterpriseServerArgs(['--registry', 'a', '--registry', 'b'])).toThrow(/duplicate option/i);
    expect(() => parseEnterpriseServerArgs(['--registry'])).toThrow(/requires a value/i);
    expect(() => parseEnterpriseServerArgs(['--port', '1.5'])).toThrow(/port/i);
  });

  test('--help returns without reading configuration or starting a listener', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = await runEnterpriseServer(['--help'], { stdout: value => stdout.push(value), stderr: value => stderr.push(value) });
    expect(result).toBeUndefined();
    expect(stdout.join('\n')).toContain('Usage: mcpvault-enterprise');
    expect(stderr).toEqual([]);
  });
});

describe('optional company Global import', () => {
  test('pulls bounded read-only pages before listening and returns completion status', async () => {
    const hub = await startGlobalSyncHub(join(root, 'global-hub'), {
      host: '127.0.0.1', port: 0, authToken: 'write-token', readToken: 'read-token', reviewerToken: 'review-token',
    });
    globalHubs.push(hub);
    const globalImportConfigPath = join(root, 'host-private', 'global-import.json');
    await mkdir(dirname(globalImportConfigPath), { recursive: true });
    await writeFile(globalImportConfigPath, JSON.stringify({
      baseUrl: `http://${hub.host}:${hub.port}`,
      readToken: 'read-token',
      trustedPublicKey: hub.hub.getPublicKey(),
    }));
    await initializeRegistry({ mode: 'company' });

    const handle = await start({ globalImportConfigPath });
    expect(handle.globalImport).toEqual({ applied: [], conflicts: [], cursor: 0, hasMore: false, status: 'complete', pages: 1, appliedListComplete: true });
  }, 20_000);

  test('requires host-private configuration and rejects write-capable import on public instances', async () => {
    const globalImportConfigPath = join(root, 'host-private', 'global-import.json');
    await mkdir(dirname(globalImportConfigPath), { recursive: true });
    await writeFile(globalImportConfigPath, JSON.stringify({
      baseUrl: 'https://global.example.test', readToken: 'read-token', trustedPublicKey: federationPublicKey,
    }));
    await initializeRegistry({ mode: 'public' });
    await expect(startEnterpriseServer(config({ globalImportConfigPath }))).rejects.toThrow(/company|public.*Global/i);
    await expect(startEnterpriseServer(config({ globalImportConfigPath: 'relative.json' }))).rejects.toThrow(/globalImportConfigPath.*absolute/i);

    const companyRegistryPath = join(root, 'company-host-private', 'enterprise.json');
    vaultPath = join(root, 'company-vault'); await mkdir(vaultPath);
    await initializeRegistry({ path: companyRegistryPath, mode: 'company' });
    await writeFile(globalImportConfigPath, JSON.stringify({
      baseUrl: 'https://global.example.test', readToken: 'read-token', trustedPublicKey: federationPublicKey,
      authToken: 'write-token',
    }));
    await expect(startEnterpriseServer(config({ registryPath: companyRegistryPath, globalImportConfigPath }))).rejects.toThrow(/only.*baseUrl.*readToken.*trustedPublicKey/i);
  });
});

describe('TLS-only server lifecycle', () => {
  test('starts a real mTLS-only MCP listener and closes idempotently', async () => {
    await initializeRegistry({ runtimeFingerprint: certificates.clientFingerprint });
    const handle = await start();
    expect(handle).toMatchObject({ host: '127.0.0.1', realmId: 'acme', mode: 'company', protocol: 'https', path: '/mcp' });
    expect(handle.port).toBeGreaterThan(0);
    const lockPath = join(await realpath(vaultPath), '.mcpvault', 'enterprise-server.lock');
    expect(existsSync(lockPath)).toBe(true);

    await expect(requestMcp(handle, {
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'orient_wiki', arguments: {} } },
    })).rejects.toBeInstanceOf(Error);

    const authenticatedTransport = await requestMcp(handle, {
      certPath: certificates.clientCertPath,
      keyPath: certificates.clientKeyPath,
      bearer: 'invalid-token',
      body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'orient_wiki', arguments: {} } },
    });
    expect(authenticatedTransport.status).toBe(200);
    expect(authenticatedTransport.body).toMatch(/invalid access token/i);

    await handle.close();
    await handle.close();
    expect(existsSync(lockPath)).toBe(false);
  }, 20_000);

  test('rejects a second owner from another registry for the same canonical Vault', async () => {
    await initializeRegistry();
    const otherRegistryPath = join(root, 'second-host-private', 'enterprise.json');
    await initializeRegistry({ path: otherRegistryPath });
    await start();
    await expect(startEnterpriseServer(config({ registryPath: otherRegistryPath }))).rejects.toThrow(/already owns this Vault/i);
  });

  test('recovers a well-formed dead-owner lock but refuses an invalid lock', async () => {
    await initializeRegistry();
    const lockPath = join(await realpath(vaultPath), '.mcpvault', 'enterprise-server.lock');
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({ version: 1, pid: 2_147_483_647, nonce: 'a'.repeat(32), vaultPath: await realpath(vaultPath) })}\n`);
    const recovered = await start();
    await recovered.close();

    await writeFile(lockPath, '{broken');
    await expect(startEnterpriseServer(config())).rejects.toThrow(/lock.*corrupt|lock.*invalid/i);
    expect(await readFile(lockPath, 'utf8')).toBe('{broken');
  });

  test('releases the Vault lock after startup failure and permits a clean retry', async () => {
    await initializeRegistry();
    await expect(startEnterpriseServer(config({ keyPath: certificates.otherServerKeyPath }))).rejects.toThrow(/private key.*certificate/i);
    const handle = await start();
    await handle.close();
    await handle.close();
  });

  test('rejects missing or malformed certificates and CAs before listening', async () => {
    await initializeRegistry();
    await expect(startEnterpriseServer(config({ certPath: join(root, 'missing.crt') }))).rejects.toThrow();
    const malformedCa = join(root, 'host-private', 'bad-ca.crt');
    await writeFile(malformedCa, 'not a certificate');
    await expect(startEnterpriseServer(config({ caPath: malformedCa }))).rejects.toThrow(/certificate|PEM|CA/i);
  });

  test('denies untrusted client CAs and registry fingerprint mismatches', async () => {
    await initializeRegistry({ runtimeFingerprint: certificates.secondClientFingerprint });
    const handle = await start();
    await expect(requestMcp(handle, {
      certPath: certificates.wrongClientCertPath,
      keyPath: certificates.wrongClientKeyPath,
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'orient_wiki', arguments: {} } },
    })).rejects.toBeInstanceOf(Error);

    const response = await requestMcp(handle, {
      certPath: certificates.clientCertPath,
      keyPath: certificates.clientKeyPath,
      body: {
        jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'call_endpoint', arguments: {
          endpointId: 'auth.register', arguments: {
            accountId: 'acct-one', agentId: 'agent-one', userId: 'employee-one', modelId: 'codex',
            password: 'enterprise-password-123', invitationToken: 'invalid', sessionId: 'session-one',
          },
        } },
      },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatch(/certificate is not registered/i);
  }, 20_000);
});

describe('optional public federation configuration', () => {
  test('accepts host-private public configuration without network activity and rejects it for company mode', async () => {
    const federationConfigPath = join(root, 'host-private', 'federation.json');
    await mkdir(dirname(federationConfigPath), { recursive: true });
    await writeFile(federationConfigPath, JSON.stringify({
      baseUrl: 'https://federation.example.test',
      trustedHubPublicKey: federationPublicKey,
      actors: { 'agent-one': { authToken: 'host-private-token' } },
    }));

    await initializeRegistry({ mode: 'company' });
    await expect(startEnterpriseServer(config({ federationConfigPath }))).rejects.toThrow(/public.*federation|company/i);

    await rm(registryPath);
    vaultPath = join(root, 'public-vault'); await mkdir(vaultPath);
    await initializeRegistry({ mode: 'public' });
    const handle = await start({ federationConfigPath });
    expect(handle.mode).toBe('public');
  });

  test('requires federation configuration to be an absolute host-private bounded JSON file', async () => {
    await initializeRegistry({ mode: 'public' });
    await expect(startEnterpriseServer(config({ federationConfigPath: 'relative.json' }))).rejects.toThrow(/federationConfigPath.*absolute/i);
    const insideVault = join(vaultPath, 'federation.json');
    await writeFile(insideVault, JSON.stringify({ baseUrl: 'https://example.test', trustedHubPublicKey: 'key', actors: {} }));
    await expect(startEnterpriseServer(config({ federationConfigPath: insideVault }))).rejects.toThrow(/federation.*outside.*Vault/i);

    const outsideVault = join(root, 'host-private', 'invalid-federation.json');
    await writeFile(outsideVault, JSON.stringify({
      baseUrl: 'https://example.test', trustedHubPublicKey: federationPublicKey, origin: 'spoofed', actors: {},
    }));
    await expect(startEnterpriseServer(config({ federationConfigPath: outsideVault }))).rejects.toThrow(/federation.*invalid/i);
  });
});
