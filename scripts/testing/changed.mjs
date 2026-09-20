import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function normalize(record) {
  if (!Array.isArray(record)) return record;
  const [status, first, second] = record;
  return status?.startsWith('R') || status?.startsWith('C')
    ? { status, path: second, previousPath: first } : { status, path: first };
}
export function changedRecords(records) {
  const seen = new Set(), result = [];
  for (const record of records.map(normalize)) {
    const key = JSON.stringify(record);
    if (!seen.has(key)) { seen.add(key); result.push(record); }
  }
  return result.sort((a, b) => `${a.path}\0${a.status}`.localeCompare(`${b.path}\0${b.status}`));
}
export function changedPaths(records) {
  const paths = new Set();
  for (const record of changedRecords(records)) for (const path of [record.path, record.previousPath]) if (path) paths.add(path);
  return [...paths].sort();
}
function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed`); return result.stdout;
}
function parseDiff(output) {
  const parts = output.split('\0').filter(Boolean), result = [];
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i], path = parts[++i];
    result.push(status?.startsWith('R') || status?.startsWith('C') ? [status, path, parts[++i]] : [status, path]);
  }
  return result;
}
function records(root, base) {
  const result = [...parseDiff(git(root, ['-c', 'core.quotepath=false', 'diff', '--name-status', '-z', base])),
    ...parseDiff(git(root, ['-c', 'core.quotepath=false', 'diff', '--cached', '--name-status', '-z', base]))];
  for (const item of git(root, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0').filter(Boolean))
    if (item.startsWith('?? ')) result.push(['??', item.slice(3)]);
  return changedRecords(result);
}
export function resolveBase(root, base = 'HEAD') {
  assert(typeof base === 'string' && /^[A-Za-z0-9._/-]+$/.test(base) && !base.startsWith('-') && !base.includes('..'), 'Unsafe git base');
  const sha = git(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
  assert(/^[0-9a-f]{40,64}$/.test(sha), 'Git base is not a commit SHA'); return sha;
}
export function repositoryChanges(root, base = 'HEAD') {
  const baseSha = resolveBase(root, base), changes = records(root, baseSha);
  return { baseSha, records: changes, paths: changedPaths(changes) };
}
export function repositoryChangedPaths(root, base = 'HEAD') { return repositoryChanges(root, base).paths; }

export function changedTestSelection({ changed, vitest, all }) {
  const records = changed.map(item => typeof item === 'string' ? { status: 'M', path: item } : item);
  const paths = records.flatMap(item => [item.path, item.previousPath]).filter(Boolean);
  const source = records.filter(item => !/\.test\.ts$/.test(item.path));
  const removed = records.some(item => item.status?.startsWith('D') || item.status?.startsWith('R') || item.status?.startsWith('C'));
  const related = vitest.filter(file => all.includes(file));
  // Files read as data, URL workers and dynamic service registrations are not
  // fully represented by Vitest's import graph. Keep these boundaries explicit.
  const dynamicBoundary = /^src\/(?:memory\/|story-|benchmark-|semantic-search\.|guidance-|.*-tools\.|createServer\.|cli\.|filesystem\.|scope-auth\.|enterprise-)/;
  const uncertainSource = source.some(item => item.status === '??' || !/^src\/.*\.ts$/.test(item.path)
    || dynamicBoundary.test(item.path) || !related.includes(item.path.replace(/\.ts$/, '.test.ts')));
  const direct = paths.filter(file => /\.test\.ts$/.test(file) && all.includes(file));
  const files = [...new Set([...direct, ...related])].sort();
  const uncertain = !files.length || (source.length > 0 && related.length === all.length)
    || removed || uncertainSource;
  if (uncertain) return { files: all, fullRequired: true, reason: 'vitest-changed-uncertain' };
  return { files, fullRequired: false, reason: 'vitest-changed' };
}
