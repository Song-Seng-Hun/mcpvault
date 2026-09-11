#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

// Inspect names only: do not read, print, unstage or remove host-owned data.
const blockedComponents = new Set(['.agents', '.mcpvault', '.codex', '__pycache__']);
try {
  if (process.argv.length !== 2) throw new Error('No arguments supported');
  const names = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], {
    encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 5000,
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const blocked = names.split('\0').filter(Boolean).filter(name =>
    name.split(/[\\/]/).some(component => blockedComponents.has(component.toLowerCase()))
    || /\.py[cod]$/i.test(name));
  if (blocked.length) {
    process.stderr.write(`Blocked ${blocked.length} host/cache paths. Inspect git diff --cached --name-only; keep host data out of commits.\n`);
    process.exitCode = 1;
  } else process.stdout.write('Staged paths: safe (path check only; review content separately for secrets).\n');
} catch {
  process.stderr.write('Cannot inspect staged paths safely; run from the Git worktree without arguments.\n');
  process.exitCode = 1;
}
