import { expect, test } from 'vitest';
import { responsibility, resourceKeys } from './work-responsibility.js';

test('resource declarations use literal canonical bounded locators, not scripts or globs', () => {
  for (const path of ['../escape.md', '/absolute.md', 'E:/vault.md', 'a/../b.md', 'a/*.md', 'a/#heading', 'a\\..\\b.md']) {
    expect(() => responsibility({ resources: [{ path }] })).toThrow();
  }
  expect(() => responsibility({ mode: 'exclusive_write', resources: [] })).toThrow();
  expect(() => responsibility({ resources: [{ repository: 'https://user:secret@github.com/test/repo', file: 'src/a.ts' }] })).toThrow();
  expect(resourceKeys(responsibility({ resources: [{ repository: 'https://github.com/test/repo.git/', file: 'src/a.ts' }] })))
    .toEqual(resourceKeys(responsibility({ resources: [{ repository: 'https://github.com/test/repo', file: 'src/a.ts' }] })));
});
