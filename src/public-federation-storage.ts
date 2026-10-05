import { createHash } from 'node:crypto';

/** Display prefix is advisory; full identity digest prevents delimiter/truncation collisions. */
export function federationStorageName(id: string): string {
  return `${id.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 40)}-${createHash('sha256').update(id, 'utf8').digest('hex')}`;
}
