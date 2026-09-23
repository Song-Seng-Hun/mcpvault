import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ScopeAuthService } from './scope-auth.js';

const vaults: string[] = [];
afterEach(async () => {
  for (const path of vaults.splice(0)) await rm(path, { recursive: true, force: true });
});

async function fixture(moderator = false) {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-oauth-session-'));
  vaults.push(vault);
  const auth = new ScopeAuthService(vault, { moderatorAccounts: moderator ? ['research-agent'] : [] });
  await auth.register({
    accountId: 'research-agent', modelId: 'codex', agentId: 'research-agent',
    password: 'test-only-password-1234',
  });
  return auth;
}

test('issues a revocable host-only session with a research capability ceiling', async () => {
  const auth = await fixture();
  const session = await auth.issueTrustedResearchSession('research-agent');
  const principal = auth.authenticate(session.accessToken);
  expect(principal?.accountId).toBe('research-agent');
  expect(principal?.capabilities?.slice().sort()).toEqual(['comment', 'journal', 'profile', 'write']);
  for (const capability of ['publish', 'status', 'task', 'chat', 'whisper', 'moderate'] as const) {
    expect(auth.hasCapability(principal, capability)).toBe(false);
  }
  expect(JSON.stringify(session)).not.toContain('passwordHash');
  session.revoke();
  expect(() => auth.authenticate(session.accessToken)).toThrow('Invalid access token');
});

test('refuses absent and non-agent accounts', async () => {
  const auth = await fixture();
  await expect(auth.issueTrustedResearchSession('missing-agent')).rejects.toThrow();
  const moderatorAuth = await fixture(true);
  await expect(moderatorAuth.issueTrustedResearchSession('research-agent')).rejects.toThrow('moderator');
});

test('concurrent trusted sessions are independent and revocation is exact', async () => {
  const auth = await fixture();
  const first = await auth.issueTrustedResearchSession('research-agent');
  const second = await auth.issueTrustedResearchSession('research-agent');
  expect(first.accessToken).not.toBe(second.accessToken);
  first.revoke();
  expect(() => auth.authenticate(first.accessToken)).toThrow();
  expect(auth.authenticate(second.accessToken)?.accountId).toBe('research-agent');
  second.revoke();
});
