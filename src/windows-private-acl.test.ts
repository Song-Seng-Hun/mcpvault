import { afterEach, expect, test, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { assertHostPrivateStorage } from './skill-evolution-host.js';
import { checkWindowsPrivateAcl } from './windows-private-acl.js';

const observed = vi.hoisted(() => ({ starts: 0, workers: [] as any[] }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual,
    execFile: (...args: any[]) => {
      if (/powershell\.exe$/i.test(String(args[0]))) observed.starts++;
      return (actual.execFile as any)(...args);
    },
    spawn: (...args: any[]) => {
      const child = (actual.spawn as any)(...args);
      if (/powershell\.exe$/i.test(String(args[0]))) { observed.starts++; observed.workers.push(child); }
      return child;
    },
  };
});
const roots: string[] = [];
afterEach(async () => {
  for (const child of observed.workers.splice(0)) if (child.exitCode === null && child.signalCode === null) {
    await new Promise<void>(resolve => { child.once('close', () => resolve()); child.kill(); });
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'private-acl-worker-'))); roots.push(root);
  await promisify(execFile)('icacls.exe', [root, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
  observed.starts = 0;
  return root;
}

test.runIf(process.platform === 'win32')('successive private ACL checks reuse only the inspector, not permission decisions', async () => {
  const root = await fixture();
  await assertHostPrivateStorage([root]);
  await assertHostPrivateStorage([root]);
  await assertHostPrivateStorage([root]);
  expect(observed.starts).toBe(1);
  await promisify(execFile)('icacls.exe', [root, '/grant', '*S-1-1-0:(OI)(CI)R'], { windowsHide: true });
  await expect(assertHostPrivateStorage([root])).rejects.toThrow(/permission|private/i);
  expect(observed.starts).toBe(1);
}, 30000);

test.runIf(process.platform === 'win32')('inspector loss while a verification is pending rejects the request', async () => {
  const root = await fixture();
  await assertHostPrivateStorage([root]);
  const pending = checkWindowsPrivateAcl([root]);
  const rejected = expect(pending).rejects.toThrow(/permissions/i);
  observed.workers[0].kill();
  await rejected;
  await assertHostPrivateStorage([root]);
  expect(observed.starts).toBe(2);
}, 30000);

test.runIf(process.platform === 'win32').each(['bad\n', '999999:0\n', 'x'.repeat(1025)])('invalid inspector output fails closed (%#)', async frame => {
  const root = await fixture();
  await assertHostPrivateStorage([root]);
  const pending = checkWindowsPrivateAcl([root]);
  const rejected = expect(pending).rejects.toThrow(/permissions/i);
  // Fault injection only at the transport; permissions still use native ACLs.
  observed.workers[0].stdout.emit('data', frame);
  await rejected;
  await promisify(execFile)('icacls.exe', [root, '/grant', '*S-1-1-0:(OI)(CI)R'], { windowsHide: true });
  await expect(assertHostPrivateStorage([root])).rejects.toThrow(/permissions/i);
  expect(observed.starts).toBe(2);
}, 30000);

test.runIf(process.platform === 'win32')('verification transport bounds path count, payload and outstanding requests', async () => {
  const root = await fixture();
  await expect(checkWindowsPrivateAcl(Array(65).fill(root))).rejects.toThrow(/permissions/i);
  await expect(checkWindowsPrivateAcl(['x'.repeat(256 * 1024)])).rejects.toThrow(/permissions/i);
  expect(observed.starts).toBe(0);
  const requests = Array.from({ length: 64 }, () => checkWindowsPrivateAcl([root]));
  await expect(checkWindowsPrivateAcl([root])).rejects.toThrow(/permissions/i);
  await Promise.all(requests);
  expect(observed.starts).toBe(1);
}, 30000);

test.runIf(process.platform === 'win32')('idle inspectors exit and the next check verifies with a fresh process', async () => {
  const root = await fixture();
  await assertHostPrivateStorage([root]);
  await new Promise<void>(resolve => observed.workers[0].once('close', () => resolve()));
  await assertHostPrivateStorage([root]);
  expect(observed.starts).toBe(2);
}, 15000);

test.runIf(process.platform === 'win32')('a dead inspector is restarted without treating missing verification as permission', async () => {
  const root = await fixture();
  await assertHostPrivateStorage([root]);
  expect(observed.workers).toHaveLength(1);
  const child = observed.workers[0];
  await new Promise<void>(resolve => { child.once('close', () => resolve()); child.kill(); });
  await assertHostPrivateStorage([root]);
  expect(observed.starts).toBe(2);
  await promisify(execFile)('icacls.exe', [root, '/grant', '*S-1-1-0:(OI)(CI)R'], { windowsHide: true });
  await expect(assertHostPrivateStorage([root])).rejects.toThrow(/permission|private/i);
}, 30000);
