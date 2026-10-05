import { expect, test } from 'vitest';
import { federationStorageName } from './public-federation-storage.js';

test('storage names cannot collide when separators or long identifiers differ', () => {
  expect(federationStorageName('actor:a_b:c')).not.toBe(federationStorageName('actor:a:b_c'));
  expect(federationStorageName('a'.repeat(300) + 'x')).not.toBe(federationStorageName('a'.repeat(300) + 'y'));
  expect(federationStorageName('a'.repeat(512)).length).toBeLessThan(128);
});
