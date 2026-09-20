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

test('wiki-owned cleanup is separate from generic paths and cannot grant lifecycle or bundle writes', () => {
  const grant = { accountId: 'operator', owner: 'wiki_knowledge', paths: ['Community/Knowledge/A.md'], operations: ['deduplicate_relations'] };
  const config = (g: unknown) => ({ version: 1, enabled: true, curation: [g] });
  expect(validateEvolutionConfig(config(grant)).curation).toEqual([grant]);
  for (const change of [{ owner: undefined }, { owner: 'community' }, { operations: ['merge_passages'] },
    { operations: ['archive_duplicate'] }, { paths: ['A.md'] }, { paths: ['Community/Posts/A.md'] },
    { paths: ['Community/Knowledge/_wiki/A.md'] }]) {
    expect(() => validateEvolutionConfig(config({ ...grant, ...change }))).toThrow();
  }
});
