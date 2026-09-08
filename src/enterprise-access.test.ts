import { expect, test } from 'vitest';
import { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';

const company = new ScopeAccessPolicy({ commandCenterId: 'acme', enterprise: { mode: 'company', realmId: 'acme' } } as any);
const actor = (userId = 'u-one', agentId = 'network'): ScopePrincipal => ({
  accountId: `${userId}-${agentId}`, userId, agentId, modelId: 'codex', role: 'agent', commandCenterId: 'acme',
  enterprise: { mode: 'company', realmId: 'acme', runtimeId: 'managed', sharedMemoryEnabled: true },
} as any);

test('enterprise company requires an authenticated realm for all content including aggregates', () => {
  for (const path of ['', 'Community/Posts/hello.md', 'Global.md', '_scopes/agents/network/n.md']) {
    expect(company.canAccessPhysicalPath(path)).toBe(false);
    expect(company.canAccessPhysicalPath(path, { ...actor(), enterprise: undefined } as any)).toBe(false);
  }
  expect(company.scopeRoots()).toEqual([]);
});

test('employee shared memory and agent memory are independent of the model name', () => {
  const own = actor(); const colleague = actor('u-two', 'research');
  expect(company.canAccessPhysicalPath('_scopes/users/u-one/SharedMemory/preferences.md', own)).toBe(true);
  expect(company.canAccessPhysicalPath('_scopes/users/u-one/SharedMemory/preferences.md', colleague)).toBe(false);
  expect(company.canAccessPhysicalPath('_scopes/users/u-one/host-private.md', own)).toBe(false);
  expect(company.canAccessPhysicalPath('_scopes/models/codex/secret.md', own)).toBe(false);
  expect(company.canAccessPhysicalPath('_scopes/agents/network/notes.md', own)).toBe(true);
  expect(company.canAccessPhysicalPath('_scopes/agents/network/notes.md', colleague)).toBe(false);
  expect(company.canAccessPhysicalPath('_scopes/models/codex/_continuity/accounts/u-one-network/community-participation.md', own)).toBe(true);
  expect(company.canAccessPhysicalPath('_scopes/models/codex/_continuity/accounts/u-one-network/community-participation.md', colleague)).toBe(false);
});

test('only the provisioned SharedMemory subtree is addressable through user scope', () => {
  expect(company.resolveExternalPath('scope://user/u-one/SharedMemory/preferences.md', actor())).toBe('_scopes/users/u-one/SharedMemory/preferences.md');
  expect(() => company.resolveExternalPath('scope://user/u-one/host-private.md', actor())).toThrow();
  expect(() => company.resolveExternalPath('scope://user/u-two/SharedMemory/preferences.md', actor())).toThrow();
  expect(() => company.resolveExternalPath('scope://global/_scopes/users/u-one/SharedMemory/preferences.md', actor())).toThrow();
  const unapproved = { ...actor(), enterprise: { ...(actor() as any).enterprise, sharedMemoryEnabled: false } } as any;
  expect(company.canAccessPhysicalPath('_scopes/users/u-one/SharedMemory/preferences.md', unapproved)).toBe(false);
});

test('public profiles do not make legacy company Community readable', () => {
  const publicPolicy = new ScopeAccessPolicy({ commandCenterId: 'public-acme', enterprise: { mode: 'public', realmId: 'public-acme' } } as any);
  const external = { ...actor(), commandCenterId: 'public-acme', enterprise: { mode: 'public', realmId: 'public-acme', runtimeId: 'cloud', sharedMemoryEnabled: true } } as any;
  expect(publicPolicy.canAccessPhysicalPath('Community/Posts/internal.md', external)).toBe(false);
  expect(publicPolicy.canAccessPhysicalPath('PublicCommunity/Local/post.md', external)).toBe(true);
  expect(publicPolicy.canAccessPhysicalPath('PublicCommunity/Local/post.md', actor())).toBe(false);
  expect(publicPolicy.resolveExternalPath('scope://community/public-acme/Local/post.md', external)).toBe('PublicCommunity/Local/post.md');
});

test('path aliases do not turn a private owner into global data', () => {
  for (const path of ['Community/../_scopes/models/codex/private.md', '_scopes./users/u-two/SharedMemory/p.md', '_scopes/users/u-one/SharedMemory/../private.md']) {
    expect(company.canAccessPhysicalPath(path, actor())).toBe(false);
  }
});

test('private and company evidence cannot be referenced from global/public material', () => {
  expect(company.canReferenceFrom('Public.md', 'Community/secret.md')).toBe(false);
  expect(company.canReferenceFrom('PublicCommunity/post.md', 'Community/secret.md')).toBe(false);
  expect(company.canReferenceFrom('Community/result.md', '_scopes/users/u-one/SharedMemory/secret.md')).toBe(false);
  expect(company.canReferenceFrom('_scopes/users/u-one/SharedMemory/result.md', 'Community/source.md')).toBe(true);
});
