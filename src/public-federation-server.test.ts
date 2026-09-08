import { execFileSync } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { runPublicFederationServer } from '../public-federation-server.js';

const roots: string[] = [];
let tlsDirectory: string;
let keyPath: string;
let certPath: string;

async function certificates(): Promise<void> {
  tlsDirectory = await mkdtemp(join(tmpdir(), 'mcpvault-public-server-tls-'));
  roots.push(tlsDirectory);
  const config = join(tlsDirectory, 'openssl.cnf');
  await writeFile(config, '[ req ]\ndistinguished_name = subject\n[ subject ]\n', 'utf8');
  execFileSync('openssl.exe', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.crt',
    '-subj', '/CN=localhost', '-days', '1',
  ], { cwd: tlsDirectory, stdio: 'ignore', env: { ...process.env, OPENSSL_CONF: config } });
  keyPath = join(tlsDirectory, 'server.key');
  certPath = join(tlsDirectory, 'server.crt');
}

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
  return port;
}

function baseConfig(root: string, port: number) {
  return {
    root: join(root, 'hub-data'),
    signingKeyPath: join(root, 'private', 'signing-key.pem'),
    keyPath,
    certPath,
    host: '127.0.0.1',
    port,
    credentials: { 'writer-token': { origin: 'company-a', agentId: 'alice' } },
  };
}

async function configFile(root: string, value: unknown): Promise<string> {
  const path = join(root, 'private', 'hub-config.json');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
  return path;
}

beforeAll(certificates, 20_000);
afterAll(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test('canonicalizes every referenced path and rejects service-checkout storage or secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-public-server-paths-'));
  roots.push(root);
  const port = await freePort();
  const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  for (const override of [
    { root: join(serviceRoot, 'hub-data') },
    { signingKeyPath: join(serviceRoot, 'private-signing-key.pem') },
    { keyPath: join(serviceRoot, 'package.json') },
    { certPath: join(serviceRoot, 'README.md') },
  ]) {
    const path = await configFile(root, { ...baseConfig(root, port), ...override });
    await expect(runPublicFederationServer([path])).rejects.toThrow(/outside the service checkout/i);
  }
  await expect(runPublicFederationServer([join(serviceRoot, 'package.json')])).rejects.toThrow(/outside the service checkout/i);
});

test.runIf(process.platform === 'win32')('rejects a junction alias whose target is the service checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-public-server-alias-'));
  roots.push(root);
  const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const alias = join(root, 'service-alias');
  await symlink(serviceRoot, alias, 'junction');
  const path = await configFile(root, { ...baseConfig(root, await freePort()), root: join(alias, 'hub-data') });
  await expect(runPublicFederationServer([path])).rejects.toThrow(/outside the service checkout/i);
});

test('starts with host-private material, avoids secret logging, and closes idempotently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-public-server-live-'));
  roots.push(root);
  const config = baseConfig(root, await freePort());
  const path = await configFile(root, config);
  const logs: string[] = [];
  const handle = await runPublicFederationServer([path], line => logs.push(line));
  expect(handle?.port).toBe(config.port);
  expect(logs.join('\n')).toContain('Public Federation Hub listening on https://');
  expect(logs.join('\n')).not.toContain('writer-token');
  expect(logs.join('\n')).not.toContain((await readFile(keyPath, 'utf8')).slice(0, 40));
  await handle!.close();
  await expect(handle!.close()).resolves.toBeUndefined();
});
