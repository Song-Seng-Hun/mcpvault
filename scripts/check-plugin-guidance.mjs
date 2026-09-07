import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUIDES = ['skills/mcpvault-agent/SKILL.md', 'skills/mcpvault-agent/resources/HEARTBEAT.md'];
const MAX_GUIDE_BYTES = 32 * 1024;
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../plugins/mcpvault-local');

async function fingerprint(path) {
  let handle;
  try {
    const absolute = resolve(path);
    let cursor = parse(absolute).root;
    let inspected;
    // This is a check of ordinary installed files, not symlink-based discovery.
    // Inspect ancestors as well: a directory junction can redirect both guides.
    for (const part of absolute.slice(cursor.length).split(sep)) {
      cursor = join(cursor, part);
      inspected = await lstat(cursor);
      if (inspected.isSymbolicLink()) return { status: 'linked-path' };
      if (cursor !== absolute && !inspected.isDirectory()) return { status: 'not-directory' };
    }
    if (!inspected?.isFile()) return { status: 'not-file' };
    handle = await open(absolute, 'r');
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== inspected.dev || opened.ino !== inspected.ino) {
      return { status: 'changed-during-check' };
    }
    const buffer = Buffer.alloc(MAX_GUIDE_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_GUIDE_BYTES) return { status: 'oversized' };
    const after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      return { status: 'changed-during-check' };
    }
    return { status: 'read', sha256: createHash('sha256').update(buffer.subarray(0, size)).digest('hex') };
  } catch (error) {
    return { status: error?.code === 'ENOENT' ? 'missing' : 'unreadable' };
  } finally {
    await handle?.close();
  }
}

/** Optional, read-only host deployment check; not a client runtime requirement. */
export async function checkPluginGuidance(source, installed) {
  const files = [];
  for (const path of GUIDES) {
    const expected = await fingerprint(join(source, path));
    const actual = await fingerprint(join(installed, path));
    const status = expected.status !== 'read' ? `source-${expected.status}`
      : actual.status !== 'read' ? actual.status
        : actual.sha256 === expected.sha256 ? 'current' : 'different';
    files.push({ path, status, expectedSha256: expected.sha256, installedSha256: actual.sha256 });
  }
  return { current: files.every(file => file.status === 'current'), files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--installed-root' || !isAbsolute(args[1])) {
    console.error('Usage: node scripts/check-plugin-guidance.mjs --installed-root <absolute-plugin-directory>');
    process.exitCode = 2;
  } else {
    const report = await checkPluginGuidance(sourceRoot, args[1]);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.current ? 0 : 1;
  }
}
