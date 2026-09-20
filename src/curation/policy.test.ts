import { expect, test } from 'vitest';
import { validateEvolutionConfig } from '../evolution/host.js';

test('curation grants are optional, exact, host-owned and operation bounded', () => {
  expect(validateEvolutionConfig({ version: 1, enabled: true })).toEqual({ version: 1, enabled: true });
  const curation = [{ accountId: 'operator', paths: ['Notes/A.md'], operations: ['deduplicate_relations'] }];
  expect(validateEvolutionConfig({ version: 1, enabled: true, curation }).curation).toEqual(curation);
  for (const path of ['../A.md', 'Notes/*.md', 'Community/Skills/A.md', '_wiki/A.md'])
    expect(() => validateEvolutionConfig({ version: 1, enabled: true, curation: [{ ...curation[0], paths: [path] }] })).toThrow();
  expect(() => validateEvolutionConfig({ version: 1, enabled: true, curation: [{ ...curation[0], operations: ['delete'] }] })).toThrow();
});
