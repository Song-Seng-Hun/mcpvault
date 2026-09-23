import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ScopeAuthService } from './scope-auth.js';
import { derivedStorageFixture } from '../tests/derived-storage-fixture.js';

test('published server entry point enables the Auth0 gate only with host-private configuration', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-auth0-process-'));
  const privateStore = await derivedStorageFixture(vault);
  const accountPath = join(privateStore.host, 'accounts.json');
  const configPath = join(privateStore.host, 'auth0.json');
  await writeFile(accountPath, JSON.stringify({ version: 1, accounts: [] }), { mode: 0o600 });
  await new ScopeAuthService(vault, { accountStorePath: accountPath }).register({
    accountId: 'research-agent', agentId: 'research-agent', modelId: 'codex', password: 'test-only-password-1234',
  });
  const subject = 'auth0|researcher';
  await writeFile(configPath, JSON.stringify({
    version: 1, issuer: 'https://research.us.auth0.com/', resource: 'https://research.example.com/mcp',
    scope: 'mcpvault:research', subject, accountId: 'research-agent', allowedAgentLabels: ['codex-mac'],
  }), { mode: 0o600 });

  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('MCPVAULT_')) delete env[key];
  delete env.VITEST;
  const child = spawn(process.execPath, [join(process.cwd(), 'dist/server.js'), vault, '--mcp-http-only=0',
    `--account-store=${accountPath}`, `--auth0-config=${configPath}`], {
    cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let stderr = '';
  child.stderr!.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  try {
    const deadline = Date.now() + 8_000;
    while (!/listening on http:\/\/127\.0\.0\.1:\d+\/mcp/.test(stderr)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`Auth0 process did not start: ${stderr}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const url = stderr.match(/http:\/\/127\.0\.0\.1:\d+\/mcp/)![0];
    const metadata = await fetch(new URL('/.well-known/oauth-protected-resource', url));
    expect(metadata.status).toBe(200);
    expect((await metadata.json() as { resource: string }).resource).toBe('https://research.example.com/mcp');
    const denied = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(denied.status).toBe(401);
    expect(stderr).not.toContain(subject);
    expect(stderr).not.toContain(configPath);
  } finally {
    if (child.exitCode === null) child.kill();
    await closed;
    await privateStore.close();
    await rm(vault, { recursive: true, force: true });
  }
}, 15000);
