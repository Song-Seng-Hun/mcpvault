import { expect, test, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Auth0Resource, parseAuth0ResourceConfig } from './auth0-resource.js';
import type { ScopePrincipal } from './scope-auth.js';

const config = {
  version: 1,
  issuer: 'https://research.us.auth0.com/',
  resource: 'https://research.example.com/mcp',
  scope: 'mcpvault:research',
  subject: 'auth0|researcher',
  accountId: 'research-agent',
  allowedAgentLabels: ['codex-mac', 'claude-code'],
};

async function fixture() {
  const pair = await generateKeyPair('RS256');
  const jwk = await exportJWK(pair.publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] });
  const resource = new Auth0Resource(parseAuth0ResourceConfig(config), keys);
  const sign = async (claims: Record<string, unknown> = {}, algorithm = 'RS256') => {
    const payload = {
      iss: config.issuer, aud: config.resource, sub: config.subject,
      scope: config.scope, exp: Math.floor(Date.now() / 1000) + 300,
      ...claims,
    };
    return new SignJWT(payload).setProtectedHeader({ alg: algorithm, kid: 'test-key' }).sign(pair.privateKey);
  };
  return { resource, sign };
}

test('accepts only a signed token for the exact approved subject, audience and scope', async () => {
  const { resource, sign } = await fixture();
  expect(await resource.verifyAccessToken(await sign())).toEqual({ accountId: 'research-agent', subject: 'auth0|researcher' });
  expect(await resource.verifyAccessToken(await sign({
    aud: [config.resource, `${config.issuer}userinfo`], scope: `openid ${config.scope}`,
  }))).toEqual({ accountId: 'research-agent', subject: 'auth0|researcher' });
  expect(resource.metadata()).toEqual({
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [config.scope],
    bearer_methods_supported: ['header'],
  });
});

test('rejects wrong issuer, audience, subject, scope and expiration', async () => {
  const { resource, sign } = await fixture();
  for (const claim of [
    { iss: 'https://other.us.auth0.com/' },
    { aud: 'https://other.example.com/mcp' },
    { aud: [config.resource, 'https://other.example.com/mcp'] },
    { aud: [config.resource, `${config.issuer}userinfo`, 'https://other.example.com/mcp'] },
    { sub: 'auth0|attacker' },
    { scope: 'openid profile' },
    { exp: Math.floor(Date.now() / 1000) - 1 },
    { exp: undefined },
    { nbf: Math.floor(Date.now() / 1000) + 300 },
  ]) {
    await expect(resource.verifyAccessToken(await sign(claim))).rejects.toThrow();
  }
});

test('rejects unsupported signing algorithms and malformed configuration', async () => {
  const { resource } = await fixture();
  const hmacKey = new TextEncoder().encode('not-an-auth0-jwks-key-not-an-auth0-jwks-key');
  const forged = await new SignJWT({ ...config, exp: Math.floor(Date.now() / 1000) + 300 })
    .setProtectedHeader({ alg: 'HS256', kid: 'test-key' }).sign(hmacKey);
  await expect(resource.verifyAccessToken(forged)).rejects.toThrow();
  for (const change of [
    { issuer: 'http://research.us.auth0.com/' },
    { issuer: 'https://research.us.auth0.com/path/' },
    { resource: 'http://research.example.com/mcp' },
    { subject: '' },
    { scope: 'mcpvault:research other' },
    { accountId: '../research' },
    { allowedAgentLabels: ['codex-mac', 'codex-mac'] },
  ]) {
    expect(() => parseAuth0ResourceConfig({ ...config, ...change })).toThrow();
  }
});

test('accepts only the fixed loopback Antigravity resource configuration', () => {
  const localResource = {
    resource: 'http://127.0.0.1:8789/antigravity/mcp',
    clientId: 'antigravity-public-client-id',
  };
  expect(parseAuth0ResourceConfig({ ...config, localResource }).localResource).toEqual(localResource);
  for (const change of [
    { resource: 'http://localhost:8789/antigravity/mcp' },
    { resource: 'http://127.0.0.1:8789/mcp' },
    { resource: 'http://127.0.0.1:8789/antigravity/mcp?token=unsafe' },
    { clientId: '' },
  ]) {
    expect(() => parseAuth0ResourceConfig({ ...config, localResource: { ...localResource, ...change } })).toThrow();
  }
});

test('local audience is accepted only with its approved OAuth client ID', async () => {
  const localResource = { resource: 'http://127.0.0.1:8789/antigravity/mcp', clientId: 'antigravity-public-client-id' };
  const pair = await generateKeyPair('RS256');
  const jwk = await exportJWK(pair.publicKey);
  const resource = new Auth0Resource(parseAuth0ResourceConfig({ ...config, localResource }),
    createLocalJWKSet({ keys: [{ ...jwk, kid: 'local-key', alg: 'RS256', use: 'sig' }] }));
  const sign = (claims: Record<string, unknown>) => new SignJWT({
    iss: config.issuer, sub: config.subject, scope: config.scope,
    exp: Math.floor(Date.now() / 1000) + 300, ...claims,
  }).setProtectedHeader({ alg: 'RS256', kid: 'local-key' }).sign(pair.privateKey);
  const local = await sign({ aud: localResource.resource, azp: localResource.clientId });
  expect(await resource.verifyAccessToken(local, 'local')).toEqual({ accountId: config.accountId, subject: config.subject });
  await expect(resource.verifyAccessToken(local)).rejects.toThrow();
  await expect(resource.verifyAccessToken(await sign({ aud: config.resource }), 'local')).rejects.toThrow();
  await expect(resource.verifyAccessToken(await sign({ aud: localResource.resource, azp: 'other-client' }), 'local')).rejects.toThrow();
  expect(resource.metadata('local').resource).toBe(localResource.resource);
});

test('owner execution belongs only to the active matching research request, not labels or another session', async () => {
  const { resource, sign } = await fixture();
  const authorize = async () => resource.verifyAccessToken(await sign());
  const principal: ScopePrincipal = { accountId: config.accountId, modelId: 'codex', role: 'agent', sessionId: 'first' };
  expect(resource.ownerExecution(principal)).toBeUndefined();
  await Promise.all(['first', 'second'].map(async sessionId => resource.withResearchSession(await authorize(), { ...principal, sessionId }, async () => {
    await Promise.resolve();
    expect(resource.ownerExecution({ ...principal, sessionId, reportedAgentLabel: 'untrusted-name' }))
      .toEqual({ accountId: config.accountId, executionTarget: 'auth0-research' });
    expect(resource.ownerExecution({ ...principal, sessionId: sessionId === 'first' ? 'second' : 'first' })).toBeUndefined();
    expect(resource.ownerExecution({ ...principal, sessionId, accountId: 'other' })).toBeUndefined();
  })));
  expect(resource.ownerExecution(principal)).toBeUndefined();
  let resume!: () => void;
  let detached!: Promise<unknown>;
  const authorization = await authorize();
  await resource.withResearchSession(authorization, principal, async () => {
    detached = new Promise<void>(resolve => { resume = resolve; }).then(() => resource.ownerExecution(principal));
  });
  resume();
  expect(await detached).toBeUndefined();
  await expect(resource.withResearchSession(authorization, principal, async () => undefined)).rejects.toThrow('Invalid research');
  await expect(resource.withResearchSession(await authorize(), principal, async () => { throw new Error('test failure'); })).rejects.toThrow('test failure');
  expect(resource.ownerExecution(principal)).toBeUndefined();
  for (const changed of [{ accountId: 'other' }, { sessionId: undefined }, { role: 'model' as const }]) {
    await expect(resource.withResearchSession(await authorize(), { ...principal, ...changed }, async () => undefined)).rejects.toThrow('Invalid research');
  }
  await expect(resource.withResearchSession({ accountId: config.accountId, subject: config.subject }, principal, async () => undefined))
    .rejects.toThrow('Invalid research');
});

test('OAuth scope policy stays within normal collaboration and expires with the verified token', async () => {
  const { resource, sign } = await fixture();
  const exp = Math.floor(Date.now() / 1000) + 60;
  const authorization = await resource.verifyAccessToken(await sign({ exp }));
  const principal: ScopePrincipal = { accountId: config.accountId, modelId: 'codex', role: 'agent', sessionId: 'request' };
  const owner = resource.ownerActivity();
  const request = { accountId: config.accountId, executionTarget: 'auth0-research', activity: 'collaboration' as const,
    action: 'execute' as const, paths: ['Community/Comments/example/comment.md'], now: Date.now() };
  expect(owner.policy().decision(request).allowed).toBe(false);
  await resource.withResearchSession(authorization, principal, async () => {
    expect(owner.policy().decision(request).allowed).toBe(true);
    expect(owner.policy().decision({ ...request, paths: ['Private/secret.md'] }).allowed).toBe(false);
    expect(owner.policy().decision({ ...request, activity: 'economy' }).allowed).toBe(false);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(exp * 1000);
    try {
      expect(owner.execution(principal)).toBeUndefined();
      expect(owner.policy().decision({ ...request, now: Date.now() }).allowed).toBe(false);
    } finally { clock.mockRestore(); }
  });
  expect(owner.policy().decision(request).allowed).toBe(false);
});
