import { createHash } from 'node:crypto';
import { posix } from 'node:path';

/** Allocate distinct physical destinations within one bounded proposal snapshot.
 * This is not a filesystem reservation or an authorization check. Callers must
 * still validate visibility and require a current/missing revision for writes. */
export function allocateProposalPaths(items: Array<{ path: string; identity: string }>): string[] {
  const paths = items.map(item => item.path.replace(/\\/g, '/'));
  const counts = new Map<string, number>();
  for (const path of paths) counts.set(path.toLowerCase(), (counts.get(path.toLowerCase()) || 0) + 1);
  const reserved = new Set(counts.keys());
  const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const collisions = items.map((item, index) => ({ ...item, path: paths[index]!, index }))
    .filter(item => counts.get(item.path.toLowerCase())! > 1)
    .sort((left, right) => compare(left.identity, right.identity) || compare(left.path, right.path));
  for (const item of collisions) {
    const extension = posix.extname(item.path), stem = item.path.slice(0, item.path.length - extension.length);
    const digest = createHash('sha256').update(item.identity).digest('hex').slice(0, 12);
    const base = `${stem} - ${digest}`;
    let target = `${base}${extension}`, counter = 2;
    while (reserved.has(target.toLowerCase())) target = `${base}-${counter++}${extension}`;
    reserved.add(target.toLowerCase());
    paths[item.index] = target;
  }
  return paths;
}
