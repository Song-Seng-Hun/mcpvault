import { expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = (path: string) => resolve(process.cwd(), path);

test('website command selects the existing Bun application', () => {
  const pkg = JSON.parse(readFileSync(root('package.json'), 'utf8'));
  expect(pkg.scripts.website).toBe('cd website-shibumi && bun dev');
  expect(existsSync(root('website-shibumi/package.json'))).toBe(true);
});

test.each(['economy-simulation', 'question-corpus'])('%s remains an evaluation fixture outside production sources', name => {
  expect(existsSync(root(`src/${name}.ts`))).toBe(false);
  expect(existsSync(root(`tests/fixtures/${name}.ts`))).toBe(true);
  const build = JSON.parse(readFileSync(root('tsconfig.build.json'), 'utf8'));
  expect(build.exclude).toContain('tests/**/*');
});
