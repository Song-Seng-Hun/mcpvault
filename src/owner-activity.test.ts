import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { OwnerActivityPolicy } from './owner-activity.js';
import type { Activity, OwnerActivityConfig, OwnerActivityRequest } from './owner-activity.js';

const now = Date.parse('2026-09-12T00:00:00.000Z');
function config(): OwnerActivityConfig {
  return { version: 1, owners: { account1: 'owner1', account2: 'owner2' }, grants: [{
    id: 'grant1', ownerId: 'owner1', accountIds: ['account1'],
    activities: ['collaboration'], actions: ['discover', 'read', 'claim', 'execute'],
    dataPrefixes: ['Community/Allowed'], executionTargets: ['runtime1'],
    expiresAt: '2026-09-13T00:00:00.000Z',
  }] };
}
function request(overrides: Partial<OwnerActivityRequest> = {}): OwnerActivityRequest {
  return { accountId: 'account1', executionTarget: 'runtime1', activity: 'collaboration',
    action: 'read', paths: ['Community/Allowed/post.md'], now, ...overrides };
}
const denied = (reason: string) => ({ allowed: false, reason, permissionsGranted: false });
const granted = { allowed: true, reason: 'granted', grantId: 'grant1', permissionsGranted: false };

describe('owner activity consent decisions', () => {
  test('grant-bound traversal admits only canonical proper ancestors of a consent prefix', () => {
    const policy = new OwnerActivityPolicy(config());
    expect(policy.canTraverse('grant1', '.')).toBe(true);
    expect(policy.canTraverse('grant1', 'Community')).toBe(true);
    expect(policy.canTraverse('grant1', 'Community/Allowed')).toBe(false);
    expect(policy.canTraverse('grant1', 'Community/Other')).toBe(false);
    expect(policy.canTraverse('unknown', 'Community')).toBe(false);
    for (const alias of ['', './Community', 'Community/.', 'Community\\Allowed', '../Community']) {
      expect(policy.canTraverse('grant1', alias)).toBe(false);
    }
  });

  test('dot prefix permits root traversal without authorizing through another grant id', () => {
    const input = config(); input.grants[0]!.dataPrefixes = ['.'];
    const policy = new OwnerActivityPolicy(input);
    expect(policy.canTraverse('grant1', '.')).toBe(true);
    expect(policy.canTraverse('grant1', 'Any/Canonical/Directory')).toBe(true);
    expect(policy.canTraverse('grant2', '.')).toBe(false);
  });

  test('explicit owner consent covers each action but never grants document permissions', () => {
    const policy = new OwnerActivityPolicy(config());
    for (const action of ['discover', 'read', 'claim', 'execute'] as const) {
      expect(policy.decision(request({ action }))).toEqual(granted);
    }
  });

  test('unknown owners and known accounts without consent fail closed', () => {
    const policy = new OwnerActivityPolicy(config());
    expect(policy.decision(request({ accountId: 'unknown' }))).toEqual(denied('owner_unknown'));
    expect(policy.decision(request({ accountId: 'account2' }))).toEqual(denied('consent_required'));
    expect(new OwnerActivityPolicy({ version: 1, owners: {}, grants: [] }).decision(request()))
      .toEqual(denied('owner_unknown'));
  });

  test('all optional activities need their own explicit grant', () => {
    const activities: Activity[] = ['collaboration', 'ideation-research', 'explanation-translation',
      'benchmarks', 'economy', 'roleplay', 'skill-evolution'];
    for (const activity of activities) {
      const input = config();
      input.grants[0]!.activities = [activity];
      const policy = new OwnerActivityPolicy(input);
      expect(policy.decision(request({ activity }))).toEqual(granted);
      const other = activity === 'economy' ? 'collaboration' : 'economy';
      expect(policy.decision(request({ activity: other }))).toEqual(denied('consent_required'));
    }
  });

  test('actions are independent and claim never implies execute', () => {
    const input = config(); input.grants[0]!.actions = ['claim'];
    const policy = new OwnerActivityPolicy(input);
    expect(policy.decision(request({ action: 'claim' }))).toEqual(granted);
    expect(policy.decision(request({ action: 'execute' }))).toEqual(denied('consent_required'));
  });

  test('no-path discovery only establishes eligibility; each candidate must be checked', () => {
    const policy = new OwnerActivityPolicy(config());
    const discovery = request({ action: 'discover' }); delete discovery.paths;
    expect(policy.decision(discovery)).toEqual(granted);
    expect(policy.decision(request({ action: 'discover', paths: ['Community/Private/post.md'] })))
      .toEqual(denied('data_scope_mismatch'));
    for (const action of ['read', 'claim', 'execute'] as const) {
      const omitted = request({ action }); delete omitted.paths;
      expect(policy.decision(omitted)).toEqual(denied('data_scope_mismatch'));
      expect(policy.decision(request({ action, paths: [] }))).toEqual(granted);
    }
  });

  test('prefix matching respects exact case, slash boundaries and every supplied path', () => {
    const policy = new OwnerActivityPolicy(config());
    expect(policy.decision(request({ paths: ['Community/Allowed', 'Community/Allowed/deep/a.md'] }))).toEqual(granted);
    for (const path of ['Community/AllowedOther/a.md', 'Community', 'community/allowed/a.md', '.']) {
      expect(policy.decision(request({ paths: [path] }))).toEqual(denied('data_scope_mismatch'));
    }
    expect(policy.decision(request({ paths: ['Community/Allowed/a.md', 'Private/b.md'] })))
      .toEqual(denied('data_scope_mismatch'));
  });

  test('dot is an explicit all-path consent prefix, still never document access', () => {
    const input = config(); input.grants[0]!.dataPrefixes = ['.'];
    expect(new OwnerActivityPolicy(input).decision(request({ paths: ['Private/a.md'] }))).toEqual(granted);
  });

  test('target, exact expiry boundary, and revocation are rechecked at execution', () => {
    const input = config(), policy = new OwnerActivityPolicy(input);
    expect(policy.decision(request({ executionTarget: 'runtime2' }))).toEqual(denied('execution_target_mismatch'));
    expect(policy.decision(request({ action: 'claim' }))).toEqual(granted);
    const expiry = Date.parse(input.grants[0]!.expiresAt);
    expect(policy.decision(request({ now: expiry - 1 }))).toEqual(granted);
    expect(policy.decision(request({ action: 'execute', now: expiry }))).toEqual(denied('expired'));
    input.grants[0]!.revoked = true;
    expect(new OwnerActivityPolicy(input).decision(request({ action: 'execute' }))).toEqual(denied('revoked'));
  });

  test('one grant with two distinct prefixes authorizes one operation spanning both', () => {
    const input = config();
    input.grants[0]!.dataPrefixes = ['Community/Allowed', 'Private'];
    const policy = new OwnerActivityPolicy(input);
    expect(policy.decision(request({ action: 'execute', paths: ['Community/Allowed/a.md', 'Private/b.md'] })))
      .toEqual(granted);
  });

  test('one alternative must cover all paths, action and target; never union grants', () => {
    const input = config(), first = input.grants[0]!;
    input.grants.push({ ...first, id: 'grant2', dataPrefixes: ['Private'] });
    let policy = new OwnerActivityPolicy(input);
    expect(policy.decision(request({ paths: ['Community/Allowed/a.md', 'Private/b.md'] })))
      .toEqual(denied('data_scope_mismatch'));
    input.grants[1]!.executionTargets = ['runtime2'];
    policy = new OwnerActivityPolicy(input);
    expect(policy.decision(request({ paths: ['Private/b.md'] })).allowed).toBe(false);
    input.grants[1]!.executionTargets = ['runtime1'];
    input.grants[1]!.actions = ['claim'];
    expect(new OwnerActivityPolicy(input).decision(request({ action: 'execute', paths: ['Private/b.md'] })).allowed).toBe(false);
  });

  test('unusable alternatives cannot veto a whole valid grant; ordering is deterministic', () => {
    const input = config(), first = input.grants[0]!;
    input.grants.unshift({ ...first, id: 'aaa', revoked: true });
    input.grants.push({ ...first, id: 'zzz' });
    expect(new OwnerActivityPolicy(input).decision(request())).toEqual(granted);
    input.grants.reverse();
    expect(new OwnerActivityPolicy(input).decision(request())).toEqual(granted);
  });

  test('denials reveal no other owner or grant details', () => {
    const input = config(); input.grants[0]!.revoked = true;
    const result = new OwnerActivityPolicy(input).decision(request({ accountId: 'account2' }));
    expect(result).toEqual(denied('consent_required'));
    expect(JSON.stringify(result)).not.toMatch(/owner1|grant1|Community/);
  });

  test('no ambient clock; absent or invalid host time cannot authorize', () => {
    const policy = new OwnerActivityPolicy(config()), absent = request(); delete absent.now;
    expect(policy.decision(absent)).toEqual(denied('consent_required'));
    for (const time of [NaN, Infinity, -Infinity, 0.1, 8640000000000001]) {
      expect(policy.decision(request({ now: time })).allowed).toBe(false);
    }
  });

  test('malformed requests and preference or locality claims cannot supply consent', () => {
    const policy = new OwnerActivityPolicy(config());
    for (const patch of [{ local: true }, { modelId: 'gemini' }, { enabled: true },
      { accountCapability: true }, { roomMembership: true }, { activity: 'work' },
      { activity: 'personal-memory' }, { action: 'approve' }, { accountId: 'Account1' },
      { executionTarget: '*' }]) {
      expect(policy.decision({ ...request(), ...patch } as OwnerActivityRequest).allowed).toBe(false);
    }
    expect(policy.decision(null as unknown as OwnerActivityRequest).allowed).toBe(false);
    expect(policy.decision(request({ paths: Array(33).fill('Community/Allowed/a.md') })).allowed).toBe(false);
  });
});

describe('bounded, immutable owner activity configuration', () => {
  test('mutable caller input is deeply snapshotted, fingerprinted and not frozen by side effect', () => {
    const input = config(), policy = new OwnerActivityPolicy(input), fingerprint = policy.fingerprint;
    input.owners.account1 = 'owner2';
    input.grants[0]!.accountIds[0] = 'account2'; input.grants[0]!.activities[0] = 'economy';
    input.grants[0]!.actions[0] = 'execute'; input.grants[0]!.dataPrefixes[0] = '.';
    input.grants[0]!.executionTargets[0] = 'runtime2'; input.grants[0]!.revoked = true;
    expect(policy.decision(request())).toEqual(granted);
    expect(policy.fingerprint).toBe(fingerprint);
    expect(policy.decision(request({ paths: ['Private/a.md'] })).allowed).toBe(false);
  });

  test('SHA256 canonical fingerprint is insensitive to object/list order and changes on revocation', () => {
    const input = config(); input.grants[0]!.activities.push('economy');
    const policy = new OwnerActivityPolicy(input);
    const canonical = { version: 1, owners: { account1: 'owner1', account2: 'owner2' },
      grants: [{ ...input.grants[0]!, actions: ['claim', 'discover', 'execute', 'read'], revoked: false }] };
    expect(policy.fingerprint).toBe(createHash('sha256').update(JSON.stringify(canonical)).digest('hex'));
    input.owners = { account2: 'owner2', account1: 'owner1' };
    input.grants[0]!.activities.reverse(); input.grants[0]!.actions.reverse();
    expect(new OwnerActivityPolicy(input).fingerprint).toBe(policy.fingerprint);
    input.grants[0]!.revoked = true;
    expect(new OwnerActivityPolicy(input).fingerprint).not.toBe(policy.fingerprint);
  });

  test('every grant account must bind to that exact owner and grant IDs must be unique', () => {
    for (const accounts of [['unknown'], ['account2'], ['account1', 'account2']]) {
      const input = config(); input.grants[0]!.accountIds = accounts;
      expect(() => new OwnerActivityPolicy(input)).toThrow('Invalid owner activity policy');
    }
    const input = config(); input.grants.push({ ...input.grants[0]! });
    expect(() => new OwnerActivityPolicy(input)).toThrow('Invalid owner activity policy');
  });

  test('strict UTC timestamps reject rollover dates, offsets, loose forms and invalid leap days', () => {
    for (const expiresAt of ['2026-02-29T00:00:00.000Z', '2026-04-31T00:00:00Z', '2026-09-13',
      '2026-09-13T24:00:00Z', '2026-09-13T00:00:00+00:00', '2026-09-13t00:00:00z',
      '2026-09-13T00:00:00.1Z', '2026-09-13T00:00:60Z']) {
      const input = config(); input.grants[0]!.expiresAt = expiresAt;
      expect(() => new OwnerActivityPolicy(input)).toThrow('Invalid owner activity policy');
    }
    for (const expiresAt of ['2028-02-29T00:00:00Z', '2028-02-29T00:00:00.123Z']) {
      const input = config(); input.grants[0]!.expiresAt = expiresAt;
      expect(new OwnerActivityPolicy(input).decision(request())).toEqual(granted);
    }
  });

  const badPaths = ['', '/absolute', 'C:/absolute', '\\server\\share', 'a\\b', '../x', 'a/../b',
    './a', 'a/./b', 'a//b', 'a/', 'a.', 'a ', ' a', 'a/*', 'a/?', 'a/[x]', 'a/{x}',
    'a|alias', '[[a]]', 'a#heading', 'a%2fb', '~user/x', 'a\u0000b', 'CON', 'a/NUL.txt',
    'a/COM1.md', 'e\u0301.md', 'a'.repeat(501)];
  test.each(badPaths)('rejects noncanonical prefix and candidate %j, even under root consent', path => {
    const input = config(); input.grants[0]!.dataPrefixes = [path];
    expect(() => new OwnerActivityPolicy(input)).toThrow('Invalid owner activity policy');
    input.grants[0]!.dataPrefixes = ['.'];
    expect(new OwnerActivityPolicy(input).decision(request({ paths: [path] })).allowed).toBe(false);
  });

  test('accepts canonical Unicode and spaces within path segments', () => {
    const input = config(); input.grants[0]!.dataPrefixes = ['자료/Shared notes'];
    expect(new OwnerActivityPolicy(input).decision(request({ paths: ['자료/Shared notes/회의.md'] }))).toEqual(granted);
  });

  test('rejects empty, oversized, duplicate and sparse grant lists', () => {
    for (const key of ['accountIds', 'activities', 'actions', 'dataPrefixes', 'executionTargets'] as const) {
      for (const value of [[], Array(33).fill(config().grants[0]![key][0]),
        [config().grants[0]![key][0], config().grants[0]![key][0]], new Array(1)]) {
        const input = config(); Object.assign(input.grants[0]!, { [key]: value });
        expect(() => new OwnerActivityPolicy(input)).toThrow('Invalid owner activity policy');
      }
    }
  });

  test('owner and grant count limits are inclusive', () => {
    const owners = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`account${i}`, 'owner1']));
    const grants = Array.from({ length: 256 }, (_, i) => ({ ...config().grants[0]!, id: `grant${i}` }));
    expect(new OwnerActivityPolicy({ version: 1, owners, grants }).decision(request()).allowed).toBe(true);
    expect(() => new OwnerActivityPolicy({ version: 1, owners: { ...owners, extra: 'owner1' }, grants })).toThrow();
    expect(() => new OwnerActivityPolicy({ version: 1, owners, grants: [...grants, { ...grants[0]!, id: 'extra' }] })).toThrow();
  });

  test('ID length bound and lowercase opaque syntax apply throughout config', () => {
    for (const id of ['', 'UPPER', 'with space', 'a/b', '*', 'a'.repeat(101)]) {
      for (const patch of [{ id }, { ownerId: id }, { accountIds: [id] }, { executionTargets: [id] }]) {
        const input = config(); Object.assign(input.grants[0]!, patch);
        expect(() => new OwnerActivityPolicy(input)).toThrow();
      }
      expect(() => new OwnerActivityPolicy({ version: 1, owners: { [id]: 'owner1' }, grants: [] })).toThrow();
      expect(() => new OwnerActivityPolicy({ version: 1, owners: { account1: id }, grants: [] })).toThrow();
    }
    const input = config(); input.grants[0]!.id = 'a'.repeat(100);
    expect(new OwnerActivityPolicy(input).decision(request()).allowed).toBe(true);
  });

  test('rejects unknown fields, malformed objects, hidden/accessor fields without invoking getters', () => {
    const malformed: unknown[] = [null, [], { ...config(), version: 2 }, { ...config(), enabled: true },
      { ...config(), grants: {} }, { ...config(), owners: [] }, Object.create(config())];
    const extra = config(); Object.assign(extra.grants[0]!, { local: true }); malformed.push(extra);
    const wrong = config(); Object.assign(wrong.grants[0]!, { revoked: 'false' }); malformed.push(wrong);
    const hidden = config(); Object.defineProperty(hidden, 'hidden', { value: true }); malformed.push(hidden);
    const symbol = config(); Object.assign(symbol, { [Symbol('extra')]: true }); malformed.push(symbol);
    let reads = 0;
    const accessor = config(); Object.defineProperty(accessor.grants[0]!, 'ownerId', { get: () => { reads++; return 'owner1'; } });
    malformed.push(accessor);
    for (const input of malformed) expect(() => new OwnerActivityPolicy(input)).toThrow('Invalid owner activity policy');
    expect(reads).toBe(0);
  });
});
