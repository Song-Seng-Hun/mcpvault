import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage();
const errorIds = new WeakMap();
export function withGuidance(resolver, operation) {
    return context.run(resolver, operation);
}
export function guidanceText(id, original) {
    try {
        return (context.getStore()?.resolve(id, original) ?? original);
    }
    catch {
        return original;
    }
}
export function guidanceError(error, id) {
    errorIds.set(error, id);
    return error;
}
export function renderGuidanceError(error) {
    if (!(error instanceof Error))
        return 'Unknown error';
    const id = errorIds.get(error);
    return id ? guidanceText(id, error.message) : error.message;
}
/** Only call on code-owned schemas/policy, NEVER arbitrary tool results/notes. */
export function projectGuidance(trusted) {
    const resolver = context.getStore();
    if (!resolver)
        return trusted;
    const proseKeys = new Set(['description', 'guidance', 'instruction', 'warning', 'purpose', 'rules', 'avoid', 'invariants', 'markdown', 'joiningSteps', 'endConditions', 'resultLocation', 'contributorAttribution']);
    const visit = (value, prose = false) => {
        if (typeof value === 'string') {
            try {
                return prose ? resolver.resolveDefault(value) : value;
            }
            catch {
                return value;
            }
        }
        if (Array.isArray(value))
            return value.map(item => visit(item, prose));
        if (!value || typeof value !== 'object')
            return value;
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
            ['enum', 'const', 'pattern', 'examples', 'default'].includes(key) ? child : visit(child, proseKeys.has(key))]));
    };
    return visit(trusted);
}
