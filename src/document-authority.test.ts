import { expect, test } from 'vitest';
import { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { withEnterpriseStorageContext, assertEnterpriseStorageAccess } from './enterprise-storage-context.js';
import { documentPolicyPath } from './document-authority.js';

const actor: ScopePrincipal = { accountId: 'alice', userId: 'owner', agentId: 'alice-worker', modelId: 'gpt', role: 'agent' };
function policy(rules: unknown[], local = false) {
  return new ScopeAccessPolicy({ documentRules: () => rules, localInferenceAllowed: () => local } as any);
}

test('long ordinary paths remain readable and long descendants retain recursive restrictions', () => {
  const path = Array.from({ length: 7 }, () => 'a'.repeat(76)).join('/') + '/Note.md';
  expect(policy([]).canAccessPhysicalPath(path, actor)).toBe(true);
  const restricted = [{ path: 'a'.repeat(76), recursive: true, confidential: true }];
  expect(policy(restricted).canAccessPhysicalPath(path, actor)).toBe(false);
  expect(policy(restricted, true).canAccessPhysicalPath(path, actor)).toBe(true);
  expect(documentPolicyPath(path)).toBe(path.toLowerCase());
  expect(() => documentPolicyPath('x'.repeat(32769))).toThrow();
  expect(() => documentPolicyPath(path + '/../escape.md')).toThrow();
});

test('confidential raw files and metadata are unavailable without verified local inference', () => {
  const access = policy([{ path: 'Originals/payroll.pdf', confidential: true }]);
  expect(access.canAccessPhysicalPath('Originals/payroll.pdf', actor)).toBe(false);
  expect(access.canAccessPhysicalPath('Originals/payroll.pdf')).toBe(false);
  expect(access.canAccessPhysicalPath('Public.md', actor)).toBe(true);
});

test('caller labels cannot establish local execution; trusted host admission can', () => {
  const rule = [{ path: 'Secret.md', confidential: true }];
  expect(policy(rule).canAccessPhysicalPath('Secret.md', { ...actor, local: true, runtimeKind: 'internal', executionLocality: 'local' } as any)).toBe(false);
  expect(policy(rule, true).canAccessPhysicalPath('Secret.md', actor)).toBe(true);
});

test('derivative chains inherit confidentiality and cannot be referenced into a public document', () => {
  const access = policy([
    { path: 'Original.pdf', confidential: true },
    { path: 'Parsed.txt', derivedFrom: ['Original.pdf'] },
    { path: 'Knowledge.md', derivedFrom: ['Parsed.txt'] },
  ]);
  expect(access.canAccessPhysicalPath('Knowledge.md', actor)).toBe(false);
  expect(access.canReferenceFrom('Public.md', 'Knowledge.md')).toBe(false);
  expect(access.canReferenceFrom('Knowledge.md', 'Original.pdf')).toBe(true);
});

test('company and department membership come from authenticated identity, not display labels', () => {
  const rules = [{ path: 'Engineering.md', realmId: 'acme', departmentIds: ['engineering'] }];
  const access = policy(rules);
  const employee = { ...actor, enterprise: { mode: 'company', realmId: 'acme', runtimeId: 'r', sharedMemoryEnabled: false, departmentIds: ['engineering'] } } as ScopePrincipal;
  expect(access.canAccessPhysicalPath('Engineering.md', actor)).toBe(false);
  expect(access.canAccessPhysicalPath('Engineering.md', { ...actor, departmentId: 'engineering' } as any)).toBe(false);
  expect(access.canAccessPhysicalPath('Engineering.md', employee)).toBe(true);
  expect(access.canAccessPhysicalPath('Engineering.md', { ...employee, enterprise: { ...employee.enterprise!, departmentIds: ['sales'] } } as any)).toBe(false);
});

test('interdepartment room admission does not grant source department document access', () => {
  const access = policy([
    { path: 'Room.md', realmId: 'acme', accountIds: ['alice', 'bob'] },
    { path: 'Engineering.md', realmId: 'acme', departmentIds: ['engineering'] },
  ]);
  const sales = { ...actor, enterprise: { mode: 'company', realmId: 'acme', runtimeId: 'r', sharedMemoryEnabled: false, departmentIds: ['sales'] } } as ScopePrincipal;
  expect(access.canAccessPhysicalPath('Room.md', sales)).toBe(true);
  expect(access.canAccessPhysicalPath('Engineering.md', sales)).toBe(false);
});

test('mixing sources intersects restrictions rather than widening the audience', () => {
  const access = policy([
    { path: 'A.md', accountIds: ['alice', 'bob'] }, { path: 'B.md', accountIds: ['bob', 'carol'] },
    { path: 'Combined.md', derivedFrom: ['A.md', 'B.md'] },
  ]);
  expect(access.canAccessPhysicalPath('Combined.md', actor)).toBe(false);
  expect(access.canAccessPhysicalPath('Combined.md', { ...actor, accountId: 'bob' })).toBe(true);
  expect(access.canReferenceFrom('A.md', 'Combined.md')).toBe(false);
});

test('policy revocation is checked on an already constructed access policy', () => {
  const rules: any[] = [{ path: 'Restricted.md', accountIds: ['alice'] }];
  const access = policy(rules);
  expect(access.canAccessPhysicalPath('Restricted.md', actor)).toBe(true);
  rules[0] = { path: 'Restricted.md', accountIds: ['bob'] };
  expect(access.canAccessPhysicalPath('Restricted.md', actor)).toBe(false);
});

test('a shallow-frozen rule list cannot conceal mutable access revocation', () => {
  const rule = { path: 'Restricted.md', accountIds: ['alice'] };
  const rules = Object.freeze([rule]);
  const access = new ScopeAccessPolicy({ documentRules: () => rules });
  expect(access.canAccessPhysicalPath('Restricted.md', actor)).toBe(true);
  rule.accountIds[0] = 'bob';
  expect(access.canAccessPhysicalPath('Restricted.md', actor)).toBe(false);
});

test('a captured source envelope and its exact raw companion share restrictions through derived knowledge', () => {
  const source = '_sources/capture.md', raw = '_sources/capture/original.txt';
  for (const protectedPath of [source, raw]) {
    const access = policy([{ path: protectedPath, confidential: true }, { path: 'Knowledge.md', derivedFrom: [source] }]);
    expect(access.canAccessPhysicalPath(source, actor)).toBe(false);
    expect(access.canAccessPhysicalPath(raw, actor)).toBe(false);
    expect(access.canAccessPhysicalPath('Knowledge.md', actor)).toBe(false);
    expect(access.canReferenceFrom('Public.md', raw)).toBe(false);
  }
});

test('malformed and cyclic policy cannot silently downgrade to public', () => {
  for (const rules of [[{ path: 'Secret.md', confidential: 'true' }], [{ path: 'A.md', derivedFrom: ['B.md'] }, { path: 'B.md', derivedFrom: ['A.md'] }]]) {
    expect(() => policy(rules).canAccessPhysicalPath('Secret.md', actor)).toThrow(/policy|cyclic|invalid/i);
  }
});

test('service-local scope instances and privileged nested callbacks retain document restrictions', () => {
  const access = policy([{ path: 'Secret.md', confidential: true }]);
  withEnterpriseStorageContext({ access, principal: actor, assertFresh: () => {} }, () => {
    expect(new ScopeAccessPolicy().canAccessPhysicalPath('Secret.md', actor)).toBe(false);
    expect(() => assertEnterpriseStorageAccess('Secret.md')).toThrow(/protected|denied/i);
    withEnterpriseStorageContext({ access: new ScopeAccessPolicy(), assertFresh: () => {} }, () => {
      expect(new ScopeAccessPolicy().canAccessPhysicalPath('Secret.md')).toBe(false);
      expect(() => assertEnterpriseStorageAccess('Secret.md')).toThrow(/protected|denied/i);
    });
  });
});
