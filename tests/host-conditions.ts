import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Detected host conditions for tests that cannot run on every checkout. Each
// returns why the host is unsuitable, or undefined when the test should run.

/** Print the reason once so a skipped test never looks like a pass. */
export function hostGate(reason: string | undefined): string | undefined {
  // Straight to stderr: the default reporter hides console output of passing files.
  if (reason) process.stderr.write(`[host-gated] ${reason}\n`);
  return reason;
}

/** The test spawns or links a package by path under the checkout itself. */
export function missingLocalPackage(root: string, path: string): string | undefined {
  const target = join(root, 'node_modules', path);
  return existsSync(target) ? undefined : `${target} is missing: this checkout has no local install (for example a worktree)`;
}

/** The repository stores LF; core.autocrlf checked this file out with CRLF. */
export function crlfCheckout(path: string): string | undefined {
  return readFileSync(path, 'utf8').includes('\r\n') ? `${path} is checked out with CRLF line endings` : undefined;
}

/** Vitest cannot import a shebang module with CRLF endings in-process. */
export function crlfShebangModule(path: string): string | undefined {
  const text = readFileSync(path, 'utf8');
  return text.startsWith('#!') && text.includes('\r\n') ? `${path} has a shebang and CRLF line endings, which Vitest cannot import in-process` : undefined;
}
