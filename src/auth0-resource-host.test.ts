import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { derivedStorageFixture } from '../tests/derived-storage-fixture.js';
import { loadAuth0Resource } from './auth0-resource.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

test('loads Auth0 configuration only from an owner-private host file outside the Vault', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-auth0-host-'));
  cleanup.push(() => rm(vault, { recursive: true, force: true }));
  const privateStore = await derivedStorageFixture(vault);
  cleanup.push(privateStore.close);
  const config = {
    version: 1, issuer: 'https://research.us.auth0.com/', resource: 'https://research.example.com/mcp',
    scope: 'mcpvault:research', subject: 'auth0|researcher', accountId: 'research-agent',
    allowedAgentLabels: ['codex-mac'],
  };
  const privatePath = join(privateStore.host, 'auth0.json');
  await writeFile(privatePath, JSON.stringify(config), { mode: 0o600 });
  expect((await loadAuth0Resource(vault, privatePath)).metadata().resource).toBe(config.resource);
  await expect(loadAuth0Resource(vault, join(vault, 'auth0.json'))).rejects.toThrow(/private|unsafe/i);
  await expect(loadAuth0Resource(vault, 'relative.json')).rejects.toThrow(/absolute|private/i);
});
