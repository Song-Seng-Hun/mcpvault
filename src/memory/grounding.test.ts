import { test, expect } from 'vitest';
import { memoryGrounding } from './grounding.js';
const item = { path: 'Memory.md', revision: 'a'.repeat(64), role: 'semantic', validity: 'unspecified', state: 'active', basis: [{ path: 'Source.md', revision: 'b'.repeat(64), state: 'current_revision' }] };
test('current bytes never attest environment truth or automatic synthesis authorization', () => {
  const r = memoryGrounding(item);
  expect(r).toMatchObject({ state: 'ready_for_comparison', sourceIntegrity: 'current_revision', environment: 'not_verified', automaticApplication: false });
  expect(r.nextAction.endpointId).toBe('evolution.cycle');
});
test('expired memory, missing basis, changed revision and unresolved locator cannot be consolidated as verified', () => {
  for (const value of [{ ...item, validity: 'expired' }, { ...item, basis: [] }, { ...item, basis: [{ ...item.basis[0], state: 'changed' }] }, { ...item, basis: [{ state: 'locator_unchecked' }] }]) {
    expect(memoryGrounding(value).state).toBe('verification_required');
  }
});
test('translations sharing exact source revisions share a family; unavailable sources do not expose names', () => {
  expect(memoryGrounding(item).sourceFamily).toBe(memoryGrounding({ ...item, path: 'Translation.md' }).sourceFamily);
  const hidden = memoryGrounding({ ...item, basis: [{ path: 'secret.md', state: 'unavailable' }] });
  expect(JSON.stringify(hidden)).not.toContain('secret.md');
});
