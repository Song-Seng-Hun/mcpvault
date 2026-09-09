import { guidanceError } from './guidance-runtime.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { posix } from 'node:path';

const writes = new AsyncLocalStorage<{ path: string; active: boolean }>();
const normalized = (value: string) => posix.normalize(value.replace(/\\/g, '/').split('/').map(p => p === '.' || p === '..' ? p : p.replace(/[. ]+$/, '')).join('/')).replace(/^\/+|\/+$/g, '').toLowerCase();

/** Exact, synchronous-lifetime authority issued by trusted service code only. */
export async function withStoryWrite<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const grant = { path: normalized(path), active: true };
  return writes.run(grant, async () => { try { return await operation(); } finally { grant.active = false; } });
}
export function assertStoryMutationBoundary(path: string): void {
  const target = normalized(path);
  const managed = target === 'community/stories' || target.startsWith('community/stories/');
  const ancestor = target === 'community' || target === '.' || target === '';
  if (!managed && !ancestor) return;
  const grant = writes.getStore();
  if (!grant?.active || grant.path !== target) throw guidanceError(new Error('Managed story records cannot be edited, moved or deleted through generic tools; use story endpoints'), 'guid-05e318910a3f8833');
}
