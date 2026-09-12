import { describe, expect, test } from 'vitest';
import { OwnerActivityPolicy, type OwnerActivityConfig } from './owner-activity.js';
import { OwnerActivityRuntime } from './owner-activity-runtime.js';

const future = '2999-01-01T00:00:00.000Z';
function policy(overrides: Partial<OwnerActivityConfig> = {}) {
  return new OwnerActivityPolicy({ version: 1, owners: { account1: 'owner1' }, grants: [{
    id: 'grant1', ownerId: 'owner1', accountIds: ['account1'], activities: ['collaboration'],
    actions: ['discover', 'read', 'claim', 'execute'], dataPrefixes: ['Community/Allowed'],
    executionTargets: ['runtime1'], expiresAt: future,
  }], ...overrides });
}

describe('trusted owner activity runtime', () => {
  test('defaults to no consent when trusted host authority is absent', async () => {
    await expect(new OwnerActivityRuntime().begin('collaboration', 'discover'))
      .rejects.toThrow(/consent|authority/i);
  });

  test('binds one grant and filters every candidate path through it', async () => {
    const runtime = new OwnerActivityRuntime({ policy, execution: () => ({ accountId: 'account1', executionTarget: 'runtime1' }) });
    const operation = await runtime.begin('collaboration', 'discover');
    expect(operation.grantId).toBe('grant1');
    expect(operation.canAccessPath('Community/Allowed/post.md')).toBe(true);
    expect(operation.canAccessPath('Community/Secret/post.md')).toBe(false);
    expect(operation.canTraversePath('Community')).toBe(true);
    expect(operation.canTraversePath('Community/Secret')).toBe(false);
  });

  test('never combines grants while checking operation paths', async () => {
    const split = policy({ grants: [
      { id: 'grant1', ownerId: 'owner1', accountIds: ['account1'], activities: ['collaboration'], actions: ['read'], dataPrefixes: ['A'], executionTargets: ['runtime1'], expiresAt: future },
      { id: 'grant2', ownerId: 'owner1', accountIds: ['account1'], activities: ['collaboration'], actions: ['read'], dataPrefixes: ['B'], executionTargets: ['runtime1'], expiresAt: future },
    ] });
    const runtime = new OwnerActivityRuntime({ policy: () => split, execution: () => ({ accountId: 'account1', executionTarget: 'runtime1' }) });
    await expect(runtime.begin('collaboration', 'read', ['A/a.md', 'B/b.md'])).rejects.toThrow(/consent|scope/i);
  });

  test('rechecks refresh, policy fingerprint, expiry and execution identity', async () => {
    let current = policy(); let target = 'runtime1'; let refreshes = 0;
    const runtime = new OwnerActivityRuntime({ refresh: async () => { refreshes += 1; }, policy: () => current,
      execution: () => ({ accountId: 'account1', executionTarget: target }) });
    const operation = await runtime.begin('collaboration', 'read', ['Community/Allowed/post.md']);
    await operation.beforeWrite('Community/Allowed/post.md');
    expect(refreshes).toBe(2);
    target = 'runtime2';
    await expect(operation.revalidate()).rejects.toThrow(/changed|consent|target/i);
    target = 'runtime1'; current = policy({ grants: [] });
    await expect(operation.revalidate()).rejects.toThrow(/changed|consent/i);
  });
});
