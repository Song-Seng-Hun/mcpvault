import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { assertPrivateAccountStore } from './account-store.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ScopePrincipal } from './scope-auth.js';
import type { OwnerActivityExecution, OwnerActivityRuntimeOptions } from './owner-activity-runtime.js';
import { OwnerActivityPolicy } from './owner-activity.js';

interface ResearchAuthorization { readonly accountId: string; readonly subject: string }
export type Auth0ResourceChannel = 'primary' | 'local';

export interface Auth0ResourceConfig {
  version: 1;
  issuer: string;
  resource: string;
  scope: string;
  subject: string;
  accountId: string;
  allowedAgentLabels: string[];
  localResource?: { resource: string; clientId: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function httpsUrl(value: unknown, field: string, rootOnly: boolean): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error(`Invalid Auth0 ${field}`);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`Invalid Auth0 ${field}`); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash
    || (rootOnly && url.pathname !== '/') || url.href !== value) {
    throw new Error(`Invalid Auth0 ${field}`);
  }
  return value;
}

function parseLocalResource(value: unknown): NonNullable<Auth0ResourceConfig['localResource']> {
  if (!isRecord(value) || Object.keys(value).some(key => !['resource', 'clientId'].includes(key))
    || typeof value.resource !== 'string' || typeof value.clientId !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(value.clientId)) throw new Error('Invalid Auth0 local resource');
  let url: URL;
  try { url = new URL(value.resource); } catch { throw new Error('Invalid Auth0 local resource'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '8789'
    || url.pathname !== '/antigravity/mcp' || url.username || url.password || url.search || url.hash
    || url.href !== value.resource) throw new Error('Invalid Auth0 local resource');
  return { resource: value.resource, clientId: value.clientId };
}

export function parseAuth0ResourceConfig(value: unknown): Auth0ResourceConfig {
  if (!isRecord(value) || Object.keys(value).some(key => ![
    'version', 'issuer', 'resource', 'scope', 'subject', 'accountId', 'allowedAgentLabels', 'localResource',
  ].includes(key)) || value.version !== 1) throw new Error('Invalid Auth0 resource configuration');
  const issuer = httpsUrl(value.issuer, 'issuer', true);
  const resource = httpsUrl(value.resource, 'resource', false);
  if (typeof value.scope !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(value.scope)) {
    throw new Error('Invalid Auth0 scope');
  }
  if (typeof value.subject !== 'string' || !value.subject || value.subject.length > 255 || /\s/.test(value.subject)) {
    throw new Error('Invalid Auth0 subject');
  }
  if (typeof value.accountId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.accountId)) {
    throw new Error('Invalid Auth0 account ID');
  }
  if (!Array.isArray(value.allowedAgentLabels) || value.allowedAgentLabels.length > 32
    || value.allowedAgentLabels.some(label => typeof label !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(label))
    || new Set(value.allowedAgentLabels).size !== value.allowedAgentLabels.length) {
    throw new Error('Invalid Auth0 agent labels');
  }
  return {
    version: 1, issuer, resource, scope: value.scope, subject: value.subject,
    accountId: value.accountId, allowedAgentLabels: [...value.allowedAgentLabels],
    ...(value.localResource !== undefined && { localResource: parseLocalResource(value.localResource) }),
  };
}

export class Auth0Resource {
  private readonly keys: JWTVerifyGetKey;
  private readonly authorizations = new WeakMap<ResearchAuthorization, number>();
  private readonly deniedPolicy = new OwnerActivityPolicy({ version: 1, owners: {}, grants: [] });
  private readonly requests = new AsyncLocalStorage<{
    accountId: string; sessionId: string; active: boolean; expiresAt: number; policy: OwnerActivityPolicy;
  }>();

  constructor(readonly config: Auth0ResourceConfig, keys?: JWTVerifyGetKey) {
    this.keys = keys ?? createRemoteJWKSet(new URL('.well-known/jwks.json', config.issuer));
  }

  /** HTTP-adapter-only boundary, entered AFTER JWT verification and issuance
   * of the matching internal session. Not exposed as an MCP operation. This
   * identifies the authenticated research channel, never a model or device. */
  async withResearchSession<T>(authorization: ResearchAuthorization, principal: ScopePrincipal, callback: () => Promise<T>): Promise<T> {
    const expiresAt = this.authorizations.get(authorization);
    this.authorizations.delete(authorization);
    if (principal.accountId !== this.config.accountId || principal.role !== 'agent'
      || principal.enterprise || !principal.sessionId || authorization.accountId !== principal.accountId
      || expiresAt === undefined || Date.now() >= expiresAt) throw new Error('Invalid research request session');
    const owner = principal.userId || principal.accountId;
    const policy = new OwnerActivityPolicy({ version: 1, owners: { [principal.accountId]: owner }, grants: [{
      id: 'oauth-research', ownerId: owner, accountIds: [principal.accountId],
      activities: ['collaboration'], actions: ['discover', 'read', 'execute'],
      dataPrefixes: ['Community/Posts', 'Community/Comments'], executionTargets: ['auth0-research'],
      expiresAt: new Date(expiresAt).toISOString(),
    }] });
    const context = { accountId: principal.accountId, sessionId: principal.sessionId, active: true, expiresAt, policy };
    try { return await this.requests.run(context, callback); }
    finally { context.active = false; }
  }

  /** OAuth's approved research scope supplies ordinary collaboration consent.
   * This does not enable features or grant document/account capabilities. */
  ownerActivity(): OwnerActivityRuntimeOptions {
    return {
      policy: () => {
        const context = this.requests.getStore();
        return context?.active && Date.now() < context.expiresAt ? context.policy : this.deniedPolicy;
      },
      execution: principal => this.ownerExecution(principal),
    };
  }

  /** Labels, legacy tokens and localhost alone never enter the verified
   * request context. Independent capability and document checks still apply. */
  ownerExecution(principal?: ScopePrincipal): OwnerActivityExecution | undefined {
    const context = this.requests.getStore();
    if (!context?.active || Date.now() >= context.expiresAt || !principal || principal.accountId !== context.accountId
      || principal.sessionId !== context.sessionId) return undefined;
    return { accountId: context.accountId, executionTarget: 'auth0-research' };
  }

  async verifyAccessToken(token: string, channel: Auth0ResourceChannel = 'primary'): Promise<ResearchAuthorization> {
    if (!token || token.length > 16_384) throw new Error('Invalid Auth0 bearer token');
    const local = channel === 'local' ? this.config.localResource : undefined;
    if (channel === 'local' && !local) throw new Error('Auth0 local resource unavailable');
    const audience = local?.resource ?? this.config.resource;
    const { payload } = await jwtVerify(token, this.keys, {
      issuer: this.config.issuer,
      audience,
      algorithms: ['RS256'],
    });
    const approvedAudience = payload.aud === audience || (
      Array.isArray(payload.aud) && payload.aud.length === 2
      && payload.aud.includes(audience)
      && payload.aud.includes(`${this.config.issuer}userinfo`)
    );
    if (!Number.isSafeInteger(payload.exp) || Math.abs(payload.exp! * 1000) > 8640000000000000 || !approvedAudience
      || (local && payload.azp !== local.clientId)
      || payload.sub !== this.config.subject
      || typeof payload.scope !== 'string'
      || !payload.scope.split(/\s+/).includes(this.config.scope)) {
      throw new Error('Auth0 bearer token is not approved for this resource');
    }
    const authorization = Object.freeze({ accountId: this.config.accountId, subject: payload.sub });
    this.authorizations.set(authorization, payload.exp! * 1000);
    return authorization;
  }

  metadata(channel: Auth0ResourceChannel = 'primary'): { resource: string; authorization_servers: string[]; scopes_supported: string[]; bearer_methods_supported: string[] } {
    const local = channel === 'local' ? this.config.localResource : undefined;
    if (channel === 'local' && !local) throw new Error('Auth0 local resource unavailable');
    return {
      resource: local?.resource ?? this.config.resource,
      authorization_servers: [this.config.issuer],
      scopes_supported: [this.config.scope],
      bearer_methods_supported: ['header'],
    };
  }
}

/** Host-only configuration loader. The resource must be selected explicitly at
 * startup; a model-supplied path or MCP request can never change it. */
export async function loadAuth0Resource(vaultPath: string, path: string): Promise<Auth0Resource> {
  if (!isAbsolute(path)) throw new Error('Auth0 configuration must use an absolute private host path');
  await assertPrivateAccountStore(vaultPath, path);
  try {
    return new Auth0Resource(parseAuth0ResourceConfig(JSON.parse(await readFile(path, 'utf8'))));
  } catch {
    throw new Error('Private Auth0 configuration is invalid or unavailable');
  }
}
