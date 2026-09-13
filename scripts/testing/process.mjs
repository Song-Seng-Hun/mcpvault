import { spawn, spawnSync } from 'node:child_process';
import { freemem } from 'node:os';
import { join } from 'node:path';

/** Owns one fresh process tree. Memory protection is best-effort sampling, not
 * an OOM guarantee. Cancellation never targets unrelated Node/app processes. */
export async function runNode(root, args, options = {}) {
  const available = options.availableMemory ?? (() => freemem() / 2 ** 30);
  let minimum = available(), reason, output = '', stopped = false;
  if (!Number.isFinite(minimum) || minimum < 2.3 || options.signal?.aborted) return {
    started: false, code: null, stopped: true, reason: options.signal?.aborted ? 'cancelled' : 'memory', minimumFreeGiB: minimum, output };
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const start = Date.now(); let timer, finished = false, totalBytes = 0;
    const stop = cause => {
      if (finished || stopped || child.exitCode !== null || !child.pid) return;
      reason = cause; stopped = true;
      if (process.platform === 'win32') {
        const result = spawnSync(join(process.env.SystemRoot || 'C:/Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
        if (result.status !== 0) child.kill('SIGKILL');
      } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const abort = () => stop('cancelled'); options.signal?.addEventListener('abort', abort, { once: true });
    const consume = chunk => {
      totalBytes += chunk.length;
      output = (output + chunk.toString()).slice(-(options.captureLimit ?? 16384));
      options.onOutput?.(chunk.toString());
      if (totalBytes > (options.maxOutputBytes ?? 32 * 1024 * 1024)) stop('output_limit');
    };
    child.stdout.on('data', consume); child.stderr.on('data', consume);
    child.once('spawn', () => { if (options.signal?.aborted) abort(); });
    timer = setInterval(() => {
      minimum = Math.min(minimum, available());
      if (!Number.isFinite(minimum) || minimum < 2) stop('memory');
      if (Date.now() - start > (options.timeoutMs ?? 15 * 60_000)) stop('timeout');
    }, 50);
    const finish = code => {
      if (finished) return; finished = true; clearInterval(timer); options.signal?.removeEventListener('abort', abort);
      resolve({ started: Boolean(child.pid), code, stopped, ...(reason && { reason }), minimumFreeGiB: minimum, output });
    };
    child.once('error', () => { reason = 'spawn_failed'; finish(1); }); child.once('close', finish);
  });
}
