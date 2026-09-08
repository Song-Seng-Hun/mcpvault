import { AsyncLocalStorage } from 'node:async_hooks';

export interface GuidanceResolver {
  resolve(id: string, original: string): string;
  resolveDefault(original: string): string;
}
const context = new AsyncLocalStorage<GuidanceResolver | undefined>();
const errorIds = new WeakMap<Error, string>();
export function withGuidance<T>(resolver: GuidanceResolver | undefined, operation: () => T): T {
  return context.run(resolver, operation);
}
export function guidanceText<T extends string>(id: string, original: T): T {
  try { return (context.getStore()?.resolve(id, original) ?? original) as T; }
  catch { return original; }
}
export function guidanceError<T extends Error>(error: T, id: string): T {
  errorIds.set(error, id); return error;
}
export function renderGuidanceError(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown error';
  const id = errorIds.get(error);
  return id ? guidanceText(id, error.message) : error.message;
}

/** Only call on code-owned schemas/policy, NEVER arbitrary tool results/notes. */
export function projectGuidance<T>(trusted: T): T {
  const resolver = context.getStore();
  if (!resolver) return trusted;
  const proseKeys = new Set(['description', 'guidance', 'instruction', 'warning', 'purpose', 'rules', 'avoid', 'invariants', 'markdown', 'joiningSteps', 'endConditions', 'resultLocation', 'contributorAttribution']);
  const visit = (value: unknown, prose = false): unknown => {
    if (typeof value === 'string') { try { return prose ? resolver.resolveDefault(value) : value; } catch { return value; } }
    if (Array.isArray(value)) return value.map(item => visit(item, prose));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
      ['enum', 'const', 'pattern', 'examples', 'default'].includes(key) ? child : visit(child, proseKeys.has(key))]));
  };
  return visit(trusted) as T;
}
