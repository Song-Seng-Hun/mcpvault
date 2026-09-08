import { expect, test } from 'vitest';
import { isFictionDomain, roleplayOnly } from './fiction-domain.js';

test('treats every nonempty fiction_domain as fiction while preserving unmarked legacy notes', () => {
  expect(isFictionDomain({ fiction_domain: 'roleplay' })).toBe(true);
  expect(isFictionDomain({ fiction_domain: 'alternate-history' })).toBe(true);
  expect(isFictionDomain({ mcpvault_type: 'roleplay_turn' })).toBe(true);
  expect(isFictionDomain({ fiction_domain: '' })).toBe(false);
  expect(isFictionDomain({})).toBe(false);
});

test('roleplay callers must opt into the dedicated fiction-only selector', () => {
  expect(roleplayOnly()).toEqual({ fictionDomain: 'only' });
});
