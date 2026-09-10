import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { GitHistoryService, type GitTaskHistory } from './git-history.js';
import { PathFilter } from './pathfilter.js';

const task = 'Community/Tasks/task.md';
const unavailable = 'Task handoff history unresolved or unavailable';
let base: string, root: string, history: GitHistoryService;

// Every mutating Git command in this file is restricted to this disposable repo.
function git(args: string[], input?: Buffer): Promise<string> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['-c', 'core.hooksPath=disabled-hooks', '-c', 'commit.gpgSign=false', ...args], {
      cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
      env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' },
    }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
    child.stdin!.end(input);
  });
}

async function initialize() {
  await mkdir(join(root, 'empty-template'));
  await git(['init', '--initial-branch=main', '--template=empty-template']);
}

// fast-import creates real blobs/trees/commits without 100 separate commit processes.
async function versions(contents: string[], path = task) {
  const chunks: Buffer[] = [];
  for (const [index, content] of contents.entries()) {
    chunks.push(Buffer.from(`commit refs/heads/main\nmark :${index + 1}\ncommitter Fixture <fixture@example.invalid> ${1700000000 + index} +0000\ndata 7\nfixture\n${index ? `from :${index}\n` : ''}M 100644 inline ${path}\ndata ${Buffer.byteLength(content)}\n`));
    chunks.push(Buffer.from(content), Buffer.from('\n'));
  }
  await git(['fast-import', '--quiet'], Buffer.concat(chunks));
}

async function snapshot(): Promise<string> { return git(['rev-parse', 'HEAD']); }
async function read(path = task, canRead: (path: string) => boolean = () => true): Promise<GitTaskHistory> {
  return history.taskHandoffHistory(path, canRead);
}
async function rejects(value: Promise<unknown>) {
  await expect(value).rejects.toThrow(new RegExp(`^${unavailable}$`));
}

// Spy only at the subprocess boundary; successful reads still use real Git.
type Reader = { readTaskGit(args: string[], timeout: number, maxBuffer: number): Promise<Buffer> };
function reader() { return history as unknown as Reader; }

beforeEach(async () => {
  base = await realpath(tmpdir()); root = await mkdtemp(join(base, 'git-handoff-history-'));
  history = new GitHistoryService(root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  const actual = await realpath(root), rel = relative(base, actual);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(actual).startsWith('git-handoff-history-')) throw Error('Unsafe fixture cleanup');
  await rm(actual, { recursive: true, force: true });
});

test('returns exact raw blob states newest first from an explicit fixed HEAD', async () => {
  await initialize(); await versions(['first\r\n한글\n', 'second\n']);
  const head = await snapshot();
  const commits = (await git(['log', '--format=%H'])).split('\n');
  const result = await read();
  expect(result.head).toBe(head);
  expect(Object.keys(result).sort()).toEqual(['head', 'observations']);
  expect(result.observations).toEqual(await Promise.all(commits.map(async (commit, index) => ({
    commit, blob: await git(['rev-parse', `${commit}:${task}`]), content: index ? 'first\r\n한글\n' : 'second\n',
  }))));
  expect(await snapshot()).toBe(head);
});

test('does not initialize a missing repository or discover a parent repository', async () => {
  await rejects(read());
  await initialize(); await versions(['task']);
  await mkdir(join(root, 'nested'));
  history = new GitHistoryService(join(root, 'nested'));
  await rejects(read());
});

test.each(['../Community/Tasks/task.md', '/Community/Tasks/task.md', 'Community/Tasks/../Tasks/task.md',
  'Community/Tasks/task.md/extra', 'Community/Tasks/*.md', 'Community/Tasks/-task.md', 'Community/Tasks/task.md:secret',
  'Community/Tasks/task.md ', 'community/Tasks/task.md', '_scopes/agents/private/task.md'])('rejects non-exact task path %s before Git access', async path => {
  const access = vi.fn(() => true);
  await rejects(read(path, access));
  expect(access).not.toHaveBeenCalled();
});

test('requires both PathFilter and current caller access before reading', async () => {
  await initialize(); await versions(['private marker']);
  await rejects(read(task, () => false));
  history = new GitHistoryService(root, new PathFilter({ ignoredPatterns: ['Community/Tasks/**'] }));
  await rejects(read());
});

test.each(['log', 'cat-file'])('revoked ACL after a real %s read discards every result', async command => {
  await initialize(); await versions(['private marker']);
  const original = reader().readTaskGit.bind(history); let allowed = true, injected = false;
  vi.spyOn(reader(), 'readTaskGit').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[0][0] === command) { allowed = false; injected = true; }
    return result;
  });
  await rejects(read(task, () => allowed)); expect(injected).toBe(true);
});

test('HEAD drift after the fixed log discards the result', async () => {
  await initialize(); await versions(['original']);
  const original = reader().readTaskGit.bind(history); let changed = false;
  vi.spyOn(reader(), 'readTaskGit').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[0][0] === 'log' && !changed) {
      changed = true; await versions(['different HEAD']);
    }
    return result;
  });
  await rejects(read()); expect(changed).toBe(true);
});

test.each(['delete', 'rename'])('a %s away from the exact task path is not historical proof', async operation => {
  await initialize(); await versions(['accepted task']);
  const parent = await snapshot();
  const edits = operation === 'delete' ? `D ${task}\n` : `R ${task} Community/Tasks/renamed.md\n`;
  await git(['fast-import', '--quiet'], Buffer.from(`commit refs/heads/main\ncommitter Fixture <fixture@example.invalid> 1700000100 +0000\ndata 6\nremove\nfrom ${parent}\n${edits}\n`));
  await rejects(read());
});

test('rename into the task path never traverses the former private path', async () => {
  await initialize(); await versions(['private predecessor', 'new body'], '_scopes/agents/private/task.md');
  const parent = await snapshot();
  await git(['fast-import', '--quiet'], Buffer.from(`commit refs/heads/main\ncommitter Fixture <fixture@example.invalid> 1700000100 +0000\ndata 6\nrename\nfrom ${parent}\nR _scopes/agents/private/task.md ${task}\n\n`));
  await git(['config', '--local', 'log.follow', 'true']);
  const result = await read();
  expect(result.observations.map(o => o.content)).toEqual(['new body']);
  expect(result.observations[0].commit).toBe(await snapshot());
});

test.each([0, 512 * 1024 + 1])('rejects blob size %s before body hydration', async size => {
  await initialize(); await versions(['x'.repeat(size)]);
  const spy = vi.spyOn(reader(), 'readTaskGit');
  await rejects(read());
  expect(spy.mock.calls.some(([args]) => args[0] === 'cat-file' && args[1] === 'blob')).toBe(false);
});

test.each([33, 100, 101])('rejects incomplete or over-budget history of %s changed commits without hydration', async count => {
  await initialize(); await versions(Array.from({ length: count }, (_, index) => `body ${index}`));
  const spy = vi.spyOn(reader(), 'readTaskGit');
  await rejects(read());
  expect(spy.mock.calls.some(([args]) => args[0] === 'cat-file' && args[1] === 'blob')).toBe(false);
});

test('total blob byte budget is checked before hydrating an over-budget body', async () => {
  await initialize(); await versions(Array.from({ length: 17 }, (_, index) => `${index}`.padEnd(512 * 1024, 'x')));
  const spy = vi.spyOn(reader(), 'readTaskGit');
  await rejects(read());
  expect(spy.mock.calls.filter(([args]) => args[0] === 'cat-file' && args[1] === 'blob').length).toBeLessThanOrEqual(16);
}, 30_000);

test('a shared deadline includes root discovery and does not restart per subprocess', async () => {
  await initialize(); await versions(['task']);
  let now = 100; vi.spyOn(performance, 'now').mockImplementation(() => now);
  const original = reader().readTaskGit.bind(history);
  const spy = vi.spyOn(reader(), 'readTaskGit').mockImplementation(async (...args) => {
    const result = await original(...args); now += 10_001; return result;
  });
  await rejects(read()); expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0][1]).toBeLessThanOrEqual(10_000);
});

test('subprocess faults never return raw errors, host paths or body text', async () => {
  const spy = vi.spyOn(reader(), 'readTaskGit').mockRejectedValue(Error(`${root}: SECRET BODY from stderr`));
  await rejects(read()); expect(spy).toHaveBeenCalledTimes(1);
});

test('reads only first-parent states, not intermediate commits on a merged side branch', async () => {
  await initialize(); await versions(['base']);
  const parent = await snapshot();
  const stream = `commit refs/heads/side\nmark :1\ncommitter Fixture <fixture@example.invalid> 1700000100 +0000\ndata 4\nside\nfrom ${parent}\nM 100644 inline ${task}\ndata 11\nside secret\ncommit refs/heads/main\ncommitter Fixture <fixture@example.invalid> 1700000200 +0000\ndata 5\nmerge\nfrom ${parent}\nmerge :1\nM 100644 inline ${task}\ndata 6\nmerged\n`;
  await git(['fast-import', '--quiet'], Buffer.from(stream));
  expect((await read()).observations.map(o => o.content)).toEqual(['merged', 'base']);
});

test('local log configuration cannot omit the original predecessor snapshot', async () => {
  await initialize(); await versions(['Alice generation 1', 'Bob generation 2']);
  await git(['config', '--local', 'log.showRoot', 'false']);
  expect((await read()).observations.map(o => o.content)).toEqual(['Bob generation 2', 'Alice generation 1']);
});

test('shallow history is unresolved rather than a partial ancestry proof', async () => {
  await initialize(); await versions(['older', 'newer']);
  await writeFile(join(root, '.git', 'shallow'), `${await snapshot()}\n`);
  await rejects(read());
});
