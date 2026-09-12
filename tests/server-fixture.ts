import { createServer as createCoreServer, type CreateServerOptions } from '../src/createServer.js';
import { HOST_FEATURE_IDS_V1 } from '../src/host-features.js';
import { OwnerActivityPolicy, type Activity } from '../src/owner-activity.js';
export { getServerRuntime } from '../src/createServer.js';
export type { CreateServerOptions, ServerRuntime } from '../src/createServer.js';

const activities: Activity[] = ['collaboration', 'ideation-research', 'explanation-translation',
  'benchmarks', 'economy', 'roleplay', 'skill-evolution'];
const fixtureOwnerPolicy = new OwnerActivityPolicy({ version: 1, owners: { 'fixture-account': 'fixture-owner' }, grants: [{
  id: 'fixture-all-current', ownerId: 'fixture-owner', accountIds: ['fixture-account'], activities,
  actions: ['discover', 'read', 'claim', 'execute'], dataPrefixes: ['.'], executionTargets: ['fixture-runtime'],
  expiresAt: '2999-01-01T00:00:00.000Z',
}] });
const fixtureOwnerActivity: NonNullable<CreateServerOptions['ownerActivity']> = {
  policy: () => fixtureOwnerPolicy,
  execution: () => ({ accountId: 'fixture-account', executionTarget: 'fixture-runtime' }),
};

/** Existing full-application regressions opt in explicitly. New-install and
 * selection tests import the real factory directly; no production/test-mode
 * default, global environment override, or mocked implementation is involved. */
export function createServer(vaultPath: string, options: CreateServerOptions = {}) {
  return createCoreServer(vaultPath, { features: { version: 1, selected: [...HOST_FEATURE_IDS_V1] },
    ownerActivity: fixtureOwnerActivity, ...options });
}
