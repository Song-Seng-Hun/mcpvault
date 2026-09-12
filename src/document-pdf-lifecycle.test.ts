import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const io = vi.hoisted(() => ({ mkdir: vi.fn(), writeFile: vi.fn(), readFile: vi.fn(), lstat: vi.fn(), open: vi.fn(), rm: vi.fn(), unlink: vi.fn(), access: vi.fn(), spawn: vi.fn() }));
vi.mock('node:fs/promises', () => io);
vi.mock('node:child_process', () => ({ spawn: io.spawn }));
import { LocalPdfProvider, assertNoPdfHostLinks } from './document-pdf-host.js';
import { derivedCacheBudget } from './cache-budget.js';

const root = 'E:\\private\\pdf-host-v1';
const config = { version: 1, boundaryRoot: root, python: root+'\\runtime\\python.exe', worker: root+'\\runtime\\document_pdf_worker.py',
  sandboxHost: root+'\\host.exe', aclHelper: root+'\\acl.ps1', powershell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' };
const snapshot = { path: 'fixture.pdf', mediaType: 'application/pdf', bytes: Buffer.from('synthetic'), revision: 'a'.repeat(64) };
let uncertainAt = '', killFails = false, uncertainWithOutput = false;
let handle: { writeFile: ReturnType<typeof vi.fn>; sync: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks(); uncertainAt = ''; killFails = false; uncertainWithOutput = false;
  handle = { writeFile: vi.fn().mockResolvedValue(undefined), sync: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
  io.open.mockResolvedValue(handle);
  io.lstat.mockResolvedValue({ isSymbolicLink: () => false, isDirectory: () => true });
  io.access.mockRejectedValue(Object.assign(new Error('gone'), { code: 'ENOENT' }));
  io.spawn.mockImplementation((_exe: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { pid: 99, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => !killFails) });
    queueMicrotask(() => {
      if (args.includes(uncertainAt)) {
        if (uncertainWithOutput) child.stdout.emit('data', Buffer.alloc(8 * 1024 * 1024));
        if (killFails) child.stdout.emit('data', Buffer.alloc(129 * 1024));
        else child.emit('error', new Error('kill failed'));
        return;
      }
      const profile = args[args.indexOf('--profile')+1];
      let data: any = { version: 1, applied: true };
      if (args.includes('--create-profile')) data = { profile, profileCreated: true };
      if (args.includes('--delete-profile')) data = { profile, profileDeleted: true };
      if (args.includes('--provision-job')) data = { version: 1, profile, applied: false, containerSid: 'S-1-15-2-1-2-3-4-5-6-7', roots: [{ path: args[args.indexOf('--provision-job')+1] }] };
      if (args.includes('--python')) data = { version: 1, sourceSha256: snapshot.revision, profile: 'mcpvault-pdf-v1:'+'b'.repeat(64), pages: [{ page: 1, text: 'Text', status: 'ok', gaps: [], regions: [] }], gaps: [],
        metrics: { totalPages: 1, requestedPages: 1, processedPages: 1, failedPages: 0, threads: 2, exitCode: 0, elapsedMs: 1, inputBytes: 9 } };
      child.stdout.emit('data', Buffer.from(JSON.stringify(data))); child.emit('close', 0);
    });
    return child;
  });
});
afterEach(() => { vi.useRealTimers(); });

describe.skipIf(process.platform !== 'win32')('PDF host fail-closed lifecycle', () => {
  it('checks an ancestor junction before any mkdir, lock or unsandboxed helper', async () => {
    io.lstat.mockImplementation(async (path: string) => ({ isSymbolicLink: () => path === 'E:\\private', isDirectory: () => true }));
    await expect(new LocalPdfProvider(config).extract(snapshot)).rejects.toThrow(/links/);
    expect(io.mkdir).not.toHaveBeenCalled(); expect(io.open).not.toHaveBeenCalled(); expect(io.spawn).not.toHaveBeenCalled();
    await expect(assertNoPdfHostLinks(root+'\\runtime\\python.exe')).rejects.toThrow(/links/);
  });
  it('closes and retains a failed ledger before creating any OS identity', async () => {
    handle.sync.mockRejectedValue(new Error('sync failed'));
    const provider = new LocalPdfProvider(config);
    await expect(provider.extract(snapshot)).rejects.toThrow(/sync failed/);
    expect(handle.close).toHaveBeenCalledOnce(); expect(io.unlink).not.toHaveBeenCalled(); expect(io.spawn).not.toHaveBeenCalled();
    await expect(provider.extract(snapshot)).rejects.toThrow(/unavailable/);
  });
  it.each(['--create-profile', '--provision-job', '--python', '--delete-profile', '-Operation'])('retains all recovery state when %s exit is unconfirmed', async step => {
    uncertainAt = step;
    const provider = new LocalPdfProvider(config);
    await expect(provider.extract(snapshot)).rejects.toThrow(/exit unconfirmed/);
    const calls = io.spawn.mock.calls;
    expect(calls.at(-1)?.[1]).toContain(step);
    expect(io.rm).not.toHaveBeenCalled(); expect(io.unlink).not.toHaveBeenCalled(); expect(handle.close).toHaveBeenCalledOnce();
    await expect(provider.extract(snapshot)).rejects.toThrow(/unavailable/);
  });
  it('does not clean up after kill returns false on output overflow', async () => {
    uncertainAt = '--create-profile'; killFails = true;
    await expect(new LocalPdfProvider(config).extract(snapshot)).rejects.toThrow(/exit unconfirmed/);
    expect(io.spawn).toHaveBeenCalledOnce(); expect(io.rm).not.toHaveBeenCalled(); expect(io.unlink).not.toHaveBeenCalled();
  });
  it('stages bytes only after private job grant and cleans up confirmed exits', async () => {
    const provider = new LocalPdfProvider(config);
    expect((await provider.extract(snapshot)).raw).toBe('Text');
    const grantCall = io.spawn.mock.calls.findIndex(([, args]) => args.includes('-Kind') && args.includes('job'));
    expect(io.spawn.mock.invocationCallOrder[grantCall]).toBeLessThan(io.writeFile.mock.invocationCallOrder[0]);
    expect(handle.close).toHaveBeenCalledOnce(); expect(io.rm).toHaveBeenCalledOnce(); expect(io.unlink).toHaveBeenCalledOnce();
    const count = io.spawn.mock.calls.length;
    await provider.extract(snapshot); expect(io.spawn).toHaveBeenCalledTimes(count);
  });
  it('its hot PDF generation is evictable under the process-wide memory budget', async () => {
    const provider = new LocalPdfProvider(config);
    await provider.extract(snapshot);
    const count = io.spawn.mock.calls.length;
    const held = derivedCacheBudget.reserveWork(derivedCacheBudget.maxWorkingBytes);
    held.release();
    await provider.extract(snapshot);
    expect(io.spawn.mock.calls.length).toBeGreaterThan(count);
  });
  it('unconfirmed worker exit disposes parent output collectors before releasing the operation', async () => {
    uncertainAt = '--python'; uncertainWithOutput = true;
    await expect(new LocalPdfProvider(config).extract(snapshot)).rejects.toThrow(/exit unconfirmed/);
    const worker = io.spawn.mock.results.at(-1)!.value;
    expect(worker.stdout.listenerCount('data')).toBe(0);
    expect(worker.stderr.listenerCount('data')).toBe(0);
    expect(worker.stdout.destroyed).toBe(true);
    expect(worker.stderr.destroyed).toBe(true);
    expect(io.rm).not.toHaveBeenCalled(); expect(io.unlink).not.toHaveBeenCalled();
  });
});
