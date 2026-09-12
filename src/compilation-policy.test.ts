import { expect, test } from 'vitest';
import { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { inspectCompilationPolicy, validateCompilationConfig } from './compilation-policy.js';

const actor: ScopePrincipal = { accountId: 'worker', modelId: 'test', role: 'agent', agentId: 'worker', userId: 'owner',
  commandCenterId: 'local', capabilities: ['write', 'publish'], enterprise: { mode: 'company', realmId: 'company', runtimeId: 'internal',
    sharedMemoryEnabled: false, departmentIds: ['engineering', 'legal'] } };
const config = () => ({ version: 1, enabled: true, accountId: 'worker', projects: [{ id: 'project', ruleVersion: 'v1',
  sources: [{ path: 'Knowledge/A.md', classification: 'resolved', mode: 'synthesis_allowed' }],
  outputPaths: ['Knowledge/B.md'], runtimeIds: ['internal'], operations: ['index', 'synthesize', 'embed', 'vision', 'convert'] }] });
const runtime = () => ({ id: 'internal', revision: 'verified-1', local: true, operations: ['index', 'synthesize', 'embed', 'vision', 'convert'] as const });
const access = (allowed = true) => new ScopeAccessPolicy({ enterprise: { mode: 'company', realmId: 'company' },
  documentRules: () => [{ path: 'Knowledge/A.md', confidential: true, realmId: 'company', departmentIds: ['engineering'] }],
  localInferenceAllowed: () => allowed });
function check(overrides: Record<string, unknown> = {}) {
  return inspectCompilationPolicy({ config: validateCompilationConfig(config()), projectId: 'project',
    principal: actor, access: access(), paths: ['Knowledge/A.md'], outputPath: 'Knowledge/B.md', operation: 'synthesize', runtime: runtime(), ...overrides } as any);
}

test('compilation requires its own exact host grant; maintenance and client approval are not grants', () => {
  expect(check({ config: undefined })).toMatchObject({ status: 'diagnostic_only' });
  expect(() => validateCompilationConfig({ version: 1, enabled: true, accountId: 'worker', paths: ['Knowledge/A.md'], operations: ['cache_refresh'] })).toThrow();
  expect(() => validateCompilationConfig({ ...config(), approved: true })).toThrow();
  expect(check()).toMatchObject({ status: 'ready' });
});

test.each(['../A.md', 'Knowledge/*', 'Knowledge/./A.md', 'C:/A.md', 'Knowledge/A.md ', 'Knowledge/CON.md', 'Knowledge\\A.md'])('rejects ambiguous host path %s', path => {
  const value = config(); value.projects[0]!.sources[0]!.path = path;
  expect(() => validateCompilationConfig(value)).toThrow();
});

test('unknown fields, duplicate paths, runtime names and project ids fail closed', () => {
  for (const update of [
    { sources: [...config().projects[0]!.sources, { path: 'knowledge/a.md', classification: 'resolved', mode: 'source_only' }] },
    { runtimeIds: [] }, { operations: ['merge'] }, { outputPaths: ['_sources/original.md'] }, { arbitraryProvider: true },
  ]) { const value = config(); Object.assign(value.projects[0]!, update); expect(() => validateCompilationConfig(value)).toThrow(); }
  const value = config(); value.projects.push(value.projects[0]!); expect(() => validateCompilationConfig(value)).toThrow();
});

test('unresolved classification sends to review without collecting a body', () => {
  const value = config(); value.projects[0]!.sources[0]!.classification = 'unresolved';
  expect(check({ config: validateCompilationConfig(value) })).toMatchObject({ status: 'review_required' });
});

test('source_only permits authorized indexing but never synthesis', () => {
  const value = config(); value.projects[0]!.sources[0]!.mode = 'source_only';
  expect(check({ config: validateCompilationConfig(value) })).toMatchObject({ status: 'review_required' });
  expect(check({ config: validateCompilationConfig(value), operation: 'index' })).toMatchObject({ status: 'ready' });
});

test.each(['synthesize', 'embed', 'vision', 'convert'])('no suitable verified runtime means wait with no %s fallback', operation => {
  expect(check({ operation, runtime: undefined })).toMatchObject({ status: 'waiting_runtime' });
  expect(check({ operation, runtime: { ...runtime(), local: false } })).toMatchObject({ status: 'waiting_runtime' });
  expect(check({ operation, runtime: { ...runtime(), operations: ['index'] } })).toMatchObject({ status: 'waiting_runtime' });
});

test('read authority is independent of host execution allowance and cannot leak hidden paths or department names', () => {
  for (const principal of [undefined, { ...actor, enterprise: { ...actor.enterprise!, departmentIds: ['legal'] } }, { ...actor, accountId: 'admin' }]) {
    const result = check({ principal });
    expect(result.status).not.toBe('ready');
    expect(JSON.stringify(result)).not.toMatch(/Knowledge|engineering|confidential|company/);
  }
  expect(check({ access: access(false) }).status).not.toBe('ready');
});

test('policy/runtime/rule change fingerprints invalidate work without relying on body edits', () => {
  const ready = check();
  expect(check({ runtime: { ...runtime(), revision: 'verified-2' } }).fingerprint).not.toBe(ready.fingerprint);
  const value = config(); value.projects[0]!.ruleVersion = 'v2';
  expect(check({ config: validateCompilationConfig(value) }).fingerprint).not.toBe(ready.fingerprint);
  const membership = { ...actor, enterprise: { ...actor.enterprise!, departmentIds: ['engineering'] } };
  expect(check({ principal: membership }).fingerprint).not.toBe(ready.fingerprint);
});

test('unrelated project changes do not invalidate this project and output is not accepted as an input', () => {
  const value = config(); value.projects.push({ ...value.projects[0]!, id: 'unrelated', ruleVersion: 'v9' });
  expect(check({ config: validateCompilationConfig(value) }).fingerprint).toBe(check().fingerprint);
  expect(check({ paths: ['Knowledge/B.md'] }).status).not.toBe('ready');
  expect(check({ outputPath: 'Knowledge/Unapproved.md' }).status).not.toBe('ready');
});

test('only effective dependency restrictions change the fingerprint, not unrelated policy edits', () => {
  let rules = [{ path: 'Knowledge/A.md', confidential: false }];
  const policy = new ScopeAccessPolicy({ documentRules: () => rules });
  const first = policy.documentDependencyFingerprint(['Knowledge/A.md']);
  rules = [...rules, { path: 'Unrelated.md', confidential: true }];
  expect(policy.documentDependencyFingerprint(['Knowledge/A.md'])).toBe(first);
  rules = [{ path: 'Knowledge/A.md', confidential: true }];
  expect(policy.documentDependencyFingerprint(['Knowledge/A.md'])).not.toBe(first);
});
