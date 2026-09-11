import { expect, test, vi } from 'vitest';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { mkdtemp, mkdir, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { parseBenchmarkHostArgs, runBenchmarkHost } from './benchmark-host-cli.js';
import * as hostModule from './benchmark-host.js';
import * as writerModule from './benchmark-runtime.js';
import { FileSystemService } from './filesystem.js';
import { ScopeAuthService } from './scope-auth.js';
const vault = resolve('test-vault'), config = resolve('test-private.json');
test('host inspect is read-only and requires explicit absolute paths and operator', () => {
  expect(parseBenchmarkHostArgs(['inspect', vault, config, 'operator', 'demo'])).toMatchObject({ operation: 'inspect', vaultPath: vault, configPath: config, actor: 'operator', params: { challengeId: 'demo' } });
  expect(() => parseBenchmarkHostArgs(['inspect', 'relative', config, 'operator', 'demo'])).toThrow(/absolute/i);
  expect(() => parseBenchmarkHostArgs(['award', vault, config, 'operator', 'demo'])).toThrow(/operation|usage/i);
});

test('global initiative status is a read-only host command without a participant or challenge filter', () => {
 expect(parseBenchmarkHostArgs(['initiative-status',vault,config,'operator'])).toMatchObject({operation:'initiative-status',params:{}});
 expect(()=>parseBenchmarkHostArgs(['initiative-status',vault,config,'operator','demo'])).toThrow();
});
test('result evidence CLI requires explicit selected fields and shareable approval', () => {
  const args = ['evidence', vault, config, 'operator', 'demo', '--expected-revision', 'a'.repeat(64), '--request-id', 'export', '--expected-projection-revision', 'missing', '--entry-id', 'entry', '--fields', 'outcome,scores'];
  expect(() => parseBenchmarkHostArgs(args)).toThrow(/shareable/i);
  expect(parseBenchmarkHostArgs([...args, '--shareable', 'true']).params).toMatchObject({ entryId: 'entry', fields: ['outcome', 'scores'], shareable: true });
  expect(() => parseBenchmarkHostArgs([...args, '--shareable', 'false'])).toThrow(/shareable/i);
});
test('mutation CLI never invents revision, request ID, projection overwrite or wallet config', () => {
  const head = ['open', vault, config, 'operator', 'demo'];
  expect(() => parseBenchmarkHostArgs(head)).toThrow(/revision|request/i);
  const parsed = parseBenchmarkHostArgs([...head, '--expected-revision', 'missing', '--request-id', 'open-demo']);
  expect(parsed.params).toMatchObject({ expectedRevision: 'missing', requestId: 'open-demo' }); expect(parsed.economyConfig).toBeUndefined();
  expect(() => parseBenchmarkHostArgs([...head, '--expected-revision', 'missing', '--request-id', 'open', '--request-id', 'again'])).toThrow(/duplicate/i);
  expect(() => parseBenchmarkHostArgs([...head, '--expected-revision', 'missing', '--request-id', 'open', '--approve-cap', '999'])).toThrow(/unknown/i);
  expect(() => parseBenchmarkHostArgs(['project', vault, config, 'operator', 'demo', '--expected-revision', 'a'.repeat(64), '--request-id', 'project'])).toThrow(/projection/i);
});

test('host inspect has no file writes; mutations reuse actual task accounts and release the owned writer', async () => {
  const base = await realpath(tmpdir()), root = await mkdtemp(join(base, 'mcpvault-benchmark-cli-')), vaultPath = join(root, 'vault'), hostPath = join(root, 'host');
  await mkdir(vaultPath); await mkdir(hostPath);
  const fs = new FileSystemService(vaultPath), auth = new ScopeAuthService(vaultPath);
  await auth.register({ accountId: 'participant', agentId: 'participant', modelId: 'gpt', userId: 'human', password: 'temporary-cli-fixture-only' });
  await fs.writeNote({ path: 'Evidence.md', content: 'A problem source.', expectedRevision: 'missing' });
  const evidence = await fs.readNote('Evidence.md');
  const profiles = { participant: { accountId: 'participant', ownerId: 'human', modelFamily: 'gpt', approved: true, modelVerified: true } };
  const assertHumanOperator = async (actor: string) => { if (actor !== 'operator') throw Error('Human operator required'); };
  const configSpy = vi.spyOn(hostModule, 'loadBenchmarkHostConfig').mockResolvedValue({ version: 1, enabled: true, vaultPath, hostPath, integrityKeyFile: 'fixture-key', operators: ['operator'], profiles,
    definitions: [{ id: 'demo', lineage: 'problem', version: 'v1', title: 'Demo', problem: 'Example', sources: [{ path: 'Evidence.md', revision: evidence.revision }], rubric: [{ id: 'correct', description: 'Correct', minimum: 60 }], deadline: '2999-10-01T00:00:00.000Z', allowedTools: [], mode: 'objective', answerKnown: true, grader: { kind: 'exact' }, reward: 0, maxWinners: 1, cap: 0, qualityThreshold: 60, participants: ['participant'], reviewers: [], allowSameOwnerReview: false }],
    accountProfiles: async () => profiles, answerReader: async () => 'private-answer', integrity: hostModule.createBenchmarkIntegrity(Buffer.alloc(32, 3)), assertHumanOperator,
  });
  const close = vi.fn(async () => {}), held = vi.fn(async () => {});
  const lockSpy = vi.spyOn(writerModule, 'acquireBenchmarkWriter').mockResolvedValue({ close, assertHeld: held });
  const snapshot = async () => {
    const paths = (await readdir(root, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).map(e => join(e.parentPath, e.name)).sort();
    return Promise.all(paths.map(async path => [relative(root, path), createHash('sha256').update(await readFile(path)).digest('hex')]));
  };
  const args = [vaultPath, join(hostPath, 'config.json'), 'operator', 'demo'];
  try {
    const before = await snapshot();
    expect(await runBenchmarkHost(['inspect', ...args])).toMatchObject({ revision: 'missing', state: 'not_opened', freshness: 'current' });
    expect(await snapshot()).toEqual(before); expect(lockSpy).not.toHaveBeenCalled();
    expect(await runBenchmarkHost(['open', ...args, '--expected-revision', 'missing', '--request-id', 'open'])).toMatchObject({ state: 'open' });
    expect(lockSpy).toHaveBeenCalledTimes(1); expect(held).toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
    const inspect = await runBenchmarkHost(['inspect', ...args]);
    expect(inspect.state).toBe('open');
    await expect(runBenchmarkHost(['finalize', ...args, '--expected-revision', String(inspect.revision), '--request-id', 'too-early'])).rejects.toThrow(/deadline/i);
    expect(close).toHaveBeenCalledTimes(2);
  } finally {
    configSpy.mockRestore(); lockSpy.mockRestore();
    const actual = await realpath(root), rel = relative(base, actual);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(actual).startsWith('mcpvault-benchmark-cli-')) throw Error('Unsafe cleanup');
    await rm(actual, { recursive: true, force: true });
  }
});
