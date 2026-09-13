import { expect, test } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error The offline checker deliberately remains a non-runtime JS tool.
import { loadArchitectureContract, checkArchitectureContract, contractHash } from '../scripts/check-architecture-contracts.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const bundle = () => loadArchitectureContract(root);
const path = 'docs/architecture/uml/domain.puml';
function replace(b: any, name: string, before: string, after: string) {
  expect(b.files[name]).toContain(before);
  b.files[name] = b.files[name].replace(before, after);
  b.manifest.files[name] = contractHash(b.files[name]);
}

test('architecture contract checks current source and diagrams without claiming test execution or rendering', async () => {
  expect(checkArchitectureContract(await bundle())).toMatchObject({ valid: true, errors: [], testsExecuted: false, rendered: false });
});
test('architecture contract detects source drift without silently refreshing approved hashes', async () => {
  const b = await bundle(); b.files['src/graph-contract.ts'] += '\n// changed\n';
  expect(checkArchitectureContract(b)).toMatchObject({ valid: false, errors: expect.arrayContaining(['hash:src/graph-contract.ts']) });
});
test.each([
  ['  targetReference\n', '  rawSecret\n'],
  ['  contradicts\n', '  agrees_with\n'],
  ['--> "0..1" Revision : resolved target', '--> "1" Revision : resolved target'],
  ['--> "2..8" Revision : exact input pins', '--> "1..8" Revision : exact input pins'],
])('architecture semantic check rejects changed domain contract even after hash update: %s', async (before, after) => {
  const b = await bundle(); replace(b, path, before, after);
  expect(checkArchitectureContract(b).valid).toBe(false);
});
test('architecture contract compares state vocabulary to actual AST declarations', async () => {
  const b = await bundle(); replace(b, 'docs/architecture/uml/states.puml', 'state "waiting" as task_waiting', 'state "pending" as task_waiting');
  expect(checkArchitectureContract(b).valid).toBe(false);
});
test('architecture contract compares source bounds and imports rather than accepting recertified prose', async () => {
  const b = await bundle(); replace(b, 'src/knowledge-synthesis-model.ts', "array(root.inputs, 2, 8, 'inputs')", "array(root.inputs, 1, 8, 'inputs')");
  expect(checkArchitectureContract(b).valid).toBe(false);
  const c = await bundle(); replace(c, 'src/filesystem.ts', "from './pathfilter.js'", "from './unrelated.js'");
  expect(checkArchitectureContract(c).valid).toBe(false);
  const d = await bundle(); replace(d, 'src/graph-assertion.ts', 'target?:', 'target:');
  expect(checkArchitectureContract(d).valid).toBe(false);
});
test('architecture contract requires real linked test titles, not a claimed passing receipt', async () => {
  const b = await bundle(); b.manifest.testLinks[0].title = 'invented passing test';
  expect(checkArchitectureContract(b).valid).toBe(false);
});
test.each(['!include secret.puml', '!pragma layout smetana', 'https://example.invalid/render', '!function unsafe()'])('architecture rejects executable or remote diagram directive %s', async directive => {
  const b = await bundle(); b.files[path] += '\n' + directive;
  b.manifest.files[path] = contractHash(b.files[path]);
  expect(checkArchitectureContract(b).valid).toBe(false);
});
test.each(['../private.json', 'C:/private.json', 'docs/architecture/uml/../../private.json'])('architecture ignores no manifest-selected path: %s', async unsafe => {
  const b = await bundle(); b.manifest.files[unsafe] = '0'.repeat(64);
  expect(checkArchitectureContract(b).valid).toBe(false);
});
test('architecture rejects incomplete inventories and duplicate or missing test coverage categories', async () => {
  const b = await bundle(); delete b.manifest.files['src/endpoint-registry.ts'];
  expect(checkArchitectureContract(b).valid).toBe(false);
  const c = await bundle(); c.manifest.testLinks = [];
  expect(checkArchitectureContract(c).valid).toBe(false);
});
test('architecture loader rejects a reparse source directory before reading an external file', async () => {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-architecture-loader-';
  const fixture = await mkdtemp(join(base, prefix)), other = await mkdtemp(join(base, prefix));
  let linked = false;
  try {
    const b = await bundle();
    await mkdir(join(fixture, 'docs/architecture/uml'), { recursive: true });
    await writeFile(join(fixture, 'docs/architecture/uml/contract.json'), JSON.stringify(b.manifest));
    await symlink(other, join(fixture, 'src'), process.platform === 'win32' ? 'junction' : 'dir'); linked = true;
    await expect(loadArchitectureContract(fixture)).rejects.toThrow(/unsafe|reparse|symlink/i);
  } finally {
    if (linked) await unlink(join(fixture, 'src'));
    for (const dir of [fixture, other]) {
      const target = await realpath(dir), rel = relative(base, target);
      if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw Error('Unsafe fixture cleanup');
      await rm(target, { recursive: true, force: true });
    }
  }
});
